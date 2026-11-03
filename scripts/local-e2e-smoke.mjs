import "dotenv/config";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { spawn } from "node:child_process";
import { inflateRawSync } from "node:zlib";
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

const baseUrl = process.env.E2E_BASE_URL;
const testPassword = process.env.E2E_PASSWORD;
const databaseUrl = process.env.DATABASE_URL;
if (process.env.E2E_MODE !== "true" || !baseUrl || !testPassword || !databaseUrl) {
  throw new Error("Run this smoke test only through npm run e2e:local.");
}

async function startLocalSmtpFixture() {
  const messages = [];
  const fixture = createNetServer((socket) => {
    socket.setEncoding("utf8");
    socket.on("error", () => undefined);
    socket.write("220 localhost ESMTP local-test-fixture\r\n");
    let buffer = "";
    let message = "";
    let readingMessage = false;

    socket.on("data", (chunk) => {
      buffer += chunk;
      while (buffer.includes("\r\n")) {
        const boundary = buffer.indexOf("\r\n");
        const line = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (readingMessage) {
          if (line === ".") {
            messages.push(message);
            message = "";
            readingMessage = false;
            socket.write("250 queued\r\n");
          } else {
            message += `${line.startsWith("..") ? line.slice(1) : line}\r\n`;
          }
          continue;
        }

        const command = line.split(/\s/, 1)[0].toUpperCase();
        if (command === "EHLO" || command === "HELO") {
          socket.write("250-localhost\r\n250-PIPELINING\r\n250 SIZE 10485760\r\n");
        } else if (command === "MAIL" || command === "RCPT" || command === "RSET") {
          socket.write("250 accepted\r\n");
        } else if (command === "DATA") {
          readingMessage = true;
          socket.write("354 end with <CRLF>.<CRLF>\r\n");
        } else if (command === "NOOP") {
          socket.write("250 ok\r\n");
        } else if (command === "QUIT") {
          socket.write("221 bye\r\n");
          socket.end();
        } else {
          socket.write("500 unsupported test SMTP command\r\n");
        }
      }
    });
  });

  await new Promise((resolve, reject) => {
    fixture.once("error", reject);
    fixture.listen(0, "127.0.0.1", resolve);
  });
  const address = fixture.address();
  ensure(address && typeof address !== "string", "Could not start the local SMTP test fixture.");

  return {
    messages,
    port: address.port,
    close: () =>
      new Promise((resolve, reject) =>
        fixture.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

const smtpFixture = await startLocalSmtpFixture();
Object.assign(process.env, {
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: String(smtpFixture.port),
  SMTP_USER: "",
  SMTP_PASSWORD: "",
  SMTP_FROM: "Kzhexly E2E <no-reply@localhost>",
  SMTP_REQUIRE_TLS: "false",
});

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const storageClient =
  process.env.MINIO_ENDPOINT && process.env.MINIO_ACCESS_KEY && process.env.MINIO_SECRET_KEY
    ? new S3Client({
        endpoint: `http://${process.env.MINIO_ENDPOINT}`,
        region: "us-east-1",
        forcePathStyle: true,
        credentials: {
          accessKeyId: process.env.MINIO_ACCESS_KEY,
          secretAccessKey: process.env.MINIO_SECRET_KEY,
        },
      })
    : null;
const uploadedObjects = [];
class E2EAxeOnlyComplete extends Error {}
const users = [
  ["superadmin", "SUPER_ADMIN"],
  ["admin01", "ADMIN"],
  ["teacher01", "TEACHER"],
  ["teacher02", "TEACHER"],
  ["student01", "STUDENT"],
  ["student02", "STUDENT"],
  ["student03", "STUDENT"],
  ["student04", "STUDENT"],
  ["student05", "STUDENT"],
];

let server;
let serverOutput = "";
let serverError = "";
const sessions = new Map();
const csrfTokens = new Map();
let signInNumber = 0;

function pass(label) {
  console.info(`PASS ${label}`);
}

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

function jsonHeaders(cookie, clientIp) {
  return {
    "Content-Type": "application/json",
    ...(cookie ? { Cookie: cookie } : {}),
    ...(clientIp ? { "X-Forwarded-For": clientIp } : {}),
    Origin: baseUrl,
  };
}

async function jsonResponse(response) {
  return response.json().catch(() => null);
}

function unzipTextEntries(archive) {
  const entries = new Map();
  let offset = 0;
  while (archive.readUInt32LE(offset) === 0x04034b50) {
    const compression = archive.readUInt16LE(offset + 8);
    const compressedSize = archive.readUInt32LE(offset + 18);
    const nameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    const dataOffset = offset + 30 + nameLength + extraLength;
    const name = archive.toString("utf8", offset + 30, offset + 30 + nameLength);
    const compressed = archive.subarray(dataOffset, dataOffset + compressedSize);
    const content = compression === 8 ? inflateRawSync(compressed) : compressed;
    entries.set(name, content.toString("utf8"));
    offset = dataOffset + compressedSize;
  }
  return entries;
}

function cookieFrom(response) {
  const cookies = response.headers.getSetCookie?.() ?? [];
  return cookies
    .map((cookie) => cookie.split(";", 1)[0])
    .filter(Boolean)
    .join("; ");
}

async function waitForServer() {
  const deadline = Date.now() + 360_000;
  let lastError;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(
        `Next.js exited before becoming ready. ${serverError}\n${serverOutput.slice(-5000)}`,
      );
    }
    try {
      const response = await fetch(`${baseUrl}/login`, { signal: AbortSignal.timeout(30_000) });
      if (response.status === 200) return;
      lastError = new Error(`Login page returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `Next.js did not become ready: ${String(lastError)}\n${serverError}\n${serverOutput.slice(-5000)}`,
  );
}

async function signIn(username, password = testPassword) {
  const clientIp = `192.0.2.${10 + signInNumber++}`;
  const response = await fetch(`${baseUrl}/api/v1/auth/sign-in/username`, {
    method: "POST",
    headers: jsonHeaders(undefined, clientIp),
    body: JSON.stringify({ username, password, callbackURL: "/dashboard" }),
    redirect: "manual",
  });
  const body = await jsonResponse(response);
  const cookie = cookieFrom(response);
  ensure(
    response.ok && body?.user && cookie,
    `Sign-in failed for ${username} (HTTP ${response.status}).`,
  );
  return { user: body.user, cookie };
}

async function csrfFor(cookie) {
  ensure(cookie, "Cannot get a CSRF token without an authenticated session cookie.");
  if (csrfTokens.has(cookie)) return csrfTokens.get(cookie);

  const response = await fetch(`${baseUrl}/api/v1/security/csrf`, {
    headers: { Cookie: cookie, Origin: baseUrl },
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await jsonResponse(response);
  ensure(
    response.ok && typeof payload?.token === "string",
    `CSRF token request failed (HTTP ${response.status}).`,
  );
  csrfTokens.set(cookie, payload.token);
  return payload.token;
}

async function api(path, { cookie, method = "GET", body, redirect = "manual", csrfToken } = {}) {
  const headers =
    body === undefined
      ? { ...(cookie ? { Cookie: cookie } : {}), Origin: baseUrl }
      : jsonHeaders(cookie);
  if (!["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase()) && cookie) {
    const token = csrfToken === undefined ? await csrfFor(cookie) : csrfToken;
    if (token) headers["X-CSRF-Token"] = token;
  }

  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect,
  });
}

async function multipartApi(path, { cookie, form, method = "POST" }) {
  const headers = { Origin: baseUrl, ...(cookie ? { Cookie: cookie } : {}) };
  if (cookie) headers["X-CSRF-Token"] = await csrfFor(cookie);
  return fetch(`${baseUrl}${path}`, { method, headers, body: form, redirect: "manual" });
}

async function uploadPresignedFile(upload, bytes, filename, mimeType) {
  const form = new FormData();
  for (const [name, value] of Object.entries(upload.fields)) form.append(name, String(value));
  form.append("file", new Blob([bytes], { type: mimeType }), filename);
  return fetch(upload.url, { method: "POST", headers: { Origin: baseUrl }, body: form });
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  if (process.platform === "win32" && server.pid) {
    await new Promise((resolve) => {
      const killer = spawn("taskkill.exe", ["/PID", String(server.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.once("error", resolve);
      killer.once("exit", resolve);
    });
  } else {
    server.kill("SIGTERM");
  }
  await new Promise((resolve) => {
    if (server.exitCode !== null) return resolve();
    const timeout = setTimeout(resolve, 3000);
    server.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function stopWorker(worker) {
  if (!worker || worker.exitCode !== null || worker.signalCode !== null || !worker.pid) return;
  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn("taskkill.exe", ["/PID", String(worker.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.once("error", resolve);
      killer.once("exit", resolve);
    });
    return;
  }
  worker.kill("SIGTERM");
  await new Promise((resolve) => {
    if (worker.exitCode !== null || worker.signalCode !== null) return resolve();
    const timeout = setTimeout(resolve, 5000);
    worker.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function createClamavWorkerFixtures(uploadedById) {
  const cleanBytes = Buffer.from("Kzhexly clean worker scanner fixture", "ascii");
  const eicarBytes = Buffer.from(
    "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*",
    "ascii",
  );
  const cleanKey = `e2e/clean-${randomUUID()}.txt`;
  const eicarKey = `e2e/eicar-${randomUUID()}.txt`;
  const expiredKey = `e2e/expired-${randomUUID()}.txt`;
  const objects = new Map([
    [cleanKey, cleanBytes],
    [eicarKey, eicarBytes],
    [expiredKey, cleanBytes],
  ]);
  const deletedKeys = new Set();
  const mockStorage = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://127.0.0.1").pathname);
    const storageKey = pathname.split("/").slice(2).join("/");

    if (request.method === "GET") {
      const object = objects.get(storageKey);
      if (!object) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(object.length),
      });
      response.end(object);
      return;
    }

    if (request.method === "DELETE") {
      objects.delete(storageKey);
      deletedKeys.add(storageKey);
      response.writeHead(204).end();
      return;
    }

    response.writeHead(405).end();
  });
  await new Promise((resolve, reject) => {
    mockStorage.once("error", reject);
    mockStorage.listen(0, "127.0.0.1", resolve);
  });
  const address = mockStorage.address();
  ensure(address && typeof address !== "string", "The disposable worker storage did not start.");

  const makeFile = async (storageKey, bytes, originalName, createdAt, uploadStatus) =>
    prisma.storedFile.create({
      data: {
        storageKey,
        bucket: "worker-e2e",
        originalName,
        mimeType: "text/plain",
        sizeBytes: BigInt(bytes.length),
        checksumSha256: createHash("sha256").update(bytes).digest("hex"),
        uploadedById,
        visibility: "PRIVATE",
        uploadStatus,
        virusScanStatus: "PENDING",
        ...(createdAt ? { createdAt } : {}),
      },
      select: { id: true, storageKey: true },
    });

  const files = {
    clean: await makeFile(cleanKey, cleanBytes, "clean.txt", undefined, "READY"),
    eicar: await makeFile(eicarKey, eicarBytes, "eicar.txt", undefined, "READY"),
    expired: await makeFile(
      expiredKey,
      cleanBytes,
      "expired.txt",
      new Date(Date.now() - 25 * 60 * 60 * 1000),
      "PENDING",
    ),
  };

  return {
    endpoint: `127.0.0.1:${address.port}`,
    files,
    cleanKey,
    eicarKey,
    expiredKey,
    deletedKeys,
    close: () => new Promise((resolve) => mockStorage.close(resolve)),
  };
}

async function verifyDeadlineReminderWorker(courseId, teacherCookie, studentId) {
  const title = `E2E Worker Reminder ${randomUUID().slice(0, 8)}`;
  const dueAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const response = await api(`/api/v1/courses/${courseId}/assignments`, {
    cookie: teacherCookie,
    method: "POST",
    body: {
      title,
      description: "Disposable pg-boss reminder fixture.",
      instructions: "No submission is expected.",
      type: "TEXT",
      maxScore: 100,
      weight: 1,
      dueAt: dueAt.toISOString(),
      status: "PUBLISHED",
      maxAttempts: 1,
    },
  });
  const result = await jsonResponse(response);
  ensure(
    response.status === 201 && result?.assignment?.id,
    "Could not create a worker reminder fixture.",
  );
  ensure(
    Math.abs(new Date(result.assignment.dueAt).getTime() - dueAt.getTime()) < 1000,
    "The assignment deadline changed across the API/database timezone boundary.",
  );
  const dedupeKey = `assignment:${result.assignment.id}:deadline-24h`;
  const scannerFixture =
    process.env.E2E_CLAMAV_RUNTIME === "true" ? await createClamavWorkerFixtures(studentId) : null;
  const worker = spawn(process.execPath, ["scripts/worker.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DEADLINE_REMINDER_CRON: "* * * * *",
      EMAIL_OUTBOX_CRON: "* * * * *",
      ...(scannerFixture
        ? {
            MINIO_ENDPOINT: scannerFixture.endpoint,
            MINIO_ACCESS_KEY: "e2e-local-access-key",
            MINIO_SECRET_KEY: "e2e-local-secret-key",
            MINIO_BUCKET: "worker-e2e",
            MINIO_USE_SSL: "false",
            FILE_SCAN_CRON: "* * * * *",
            PENDING_FILE_CLEANUP_CRON: "* * * * *",
            PENDING_FILE_CLEANUP_AGE_HOURS: "24",
          }
        : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let workerOutput = "";
  let workerError = "";
  worker.stdout?.on("data", (chunk) => {
    workerOutput = (workerOutput + chunk.toString()).slice(-5000);
  });
  worker.stderr?.on("data", (chunk) => {
    workerError = (workerError + chunk.toString()).slice(-5000);
  });

  try {
    const startDeadline = Date.now() + 30_000;
    while (Date.now() < startDeadline && !workerOutput.includes("Background worker is ready")) {
      ensure(
        worker.exitCode === null && worker.signalCode === null,
        `Worker exited during startup. ${workerError}`,
      );
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    ensure(
      workerOutput.includes("Background worker is ready"),
      `Worker did not become ready. ${workerError}`,
    );

    const notificationDeadline = Date.now() + 100_000;
    let notification = null;
    while (Date.now() < notificationDeadline && !notification) {
      ensure(
        worker.exitCode === null && worker.signalCode === null,
        `Worker exited before its reminder ran. ${workerError}`,
      );
      notification = await prisma.notification.findFirst({
        where: { userId: studentId, dedupeKey },
        select: { id: true, type: true, dedupeKey: true },
      });
      if (!notification) await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    ensure(
      notification?.type === "ASSIGNMENT_DEADLINE",
      "The worker did not create the expected deadline notification.",
    );
    const repeatDeadline = Date.now() + 85_000;
    while (
      Date.now() < repeatDeadline &&
      workerOutput.split("Assignment deadline reminder run completed").length - 1 < 2
    ) {
      ensure(
        worker.exitCode === null && worker.signalCode === null,
        `Worker exited before its repeat run. ${workerError}`,
      );
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    ensure(
      workerOutput.split("Assignment deadline reminder run completed").length - 1 >= 2,
      "The scheduled deadline reminder did not run a second time.",
    );
    const duplicateCount = await prisma.notification.count({
      where: { userId: studentId, dedupeKey },
    });
    ensure(duplicateCount === 1, "The worker created duplicate deadline notifications.");
    const emailDedupeKey = `${dedupeKey}:email:${studentId}`;
    const emailDeadline = Date.now() + 20_000;
    let sentEmail;
    while (Date.now() < emailDeadline) {
      sentEmail = await prisma.emailOutbox.findUnique({
        where: { dedupeKey: emailDedupeKey },
        select: { id: true, status: true, toEmail: true },
      });
      if (sentEmail?.status === "SENT") break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    ensure(sentEmail?.status === "SENT", "The worker did not deliver the reminder to local SMTP.");
    ensure(
      smtpFixture.messages.some((message) => message.includes(sentEmail.toEmail)),
      "The local SMTP fixture did not capture the reminder message.",
    );
    pass("pg-boss emits a scoped deadline reminder and delivers its email through local SMTP");

    if (scannerFixture) {
      const scanDeadline = Date.now() + 90_000;
      let scannedFiles;
      while (Date.now() < scanDeadline) {
        ensure(
          worker.exitCode === null && worker.signalCode === null,
          `Worker exited during ClamAV file checks. ${workerError}`,
        );
        scannedFiles = await Promise.all(
          Object.values(scannerFixture.files).map((file) =>
            prisma.storedFile.findUnique({
              where: { id: file.id },
              select: {
                uploadStatus: true,
                virusScanStatus: true,
                scannedAt: true,
                deletedAt: true,
              },
            }),
          ),
        );
        const [cleanFile, infectedFile, expiredFile] = scannedFiles;
        if (
          cleanFile?.virusScanStatus === "CLEAN" &&
          infectedFile?.virusScanStatus === "INFECTED" &&
          expiredFile?.uploadStatus === "REJECTED" &&
          expiredFile.deletedAt
        ) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      const [cleanFile, infectedFile, expiredFile] = scannedFiles ?? [];
      ensure(
        cleanFile?.uploadStatus === "READY" &&
          cleanFile.virusScanStatus === "CLEAN" &&
          cleanFile.scannedAt,
        `The worker did not mark a clean upload as CLEAN. ${workerError}`,
      );
      ensure(
        infectedFile?.uploadStatus === "REJECTED" &&
          infectedFile.virusScanStatus === "INFECTED" &&
          infectedFile.scannedAt &&
          scannerFixture.deletedKeys.has(scannerFixture.eicarKey),
        `The worker did not reject and remove the EICAR test object. ${workerError}`,
      );
      ensure(
        expiredFile?.uploadStatus === "REJECTED" &&
          expiredFile.deletedAt &&
          scannerFixture.deletedKeys.has(scannerFixture.expiredKey),
        `The worker did not remove the expired incomplete upload. ${workerError}`,
      );
      const scanAudit = await prisma.auditLog.count({
        where: {
          entityId: { in: [scannerFixture.files.clean.id, scannerFixture.files.eicar.id] },
          action: { in: ["file.virus_scan.clean", "file.virus_scan.infected"] },
        },
      });
      ensure(scanAudit === 2, "The ClamAV outcomes were not recorded in the audit log.");
      ensure(
        !scannerFixture.deletedKeys.has(scannerFixture.cleanKey),
        "The worker deleted a clean object from storage.",
      );
      pass("worker streams clean/EICAR objects through ClamAV and removes expired uploads");
    }
  } finally {
    await stopWorker(worker);
    if (scannerFixture) await scannerFixture.close();
  }
}

try {
  server = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "dev",
      "--webpack",
      "--hostname",
      "127.0.0.1",
      "--port",
      new URL(baseUrl).port,
    ],
    { cwd: process.cwd(), env: process.env, windowsHide: true },
  );
  server.stdout?.on("data", (chunk) => {
    serverOutput = (serverOutput + chunk.toString()).slice(-12_000);
  });
  server.stderr?.on("data", (chunk) => {
    serverError = (serverError + chunk.toString()).slice(-12_000);
  });
  await waitForServer();

  const home = await fetch(`${baseUrl}/`);
  ensure(home.status === 200, `Public landing page returned HTTP ${home.status}.`);
  const homeHtml = await home.text();
  ensure(
    /<meta[^>]+name="robots"[^>]+content="noindex,\s*nofollow"/i.test(homeHtml),
    "The local landing page must stay out of search results until a production domain is approved.",
  );
  const robotsResponse = await fetch(`${baseUrl}/robots.txt`);
  const robotsText = await robotsResponse.text();
  const sitemapResponse = await fetch(`${baseUrl}/sitemap.xml`);
  const sitemapText = await sitemapResponse.text();
  ensure(
    robotsResponse.status === 200 &&
      robotsText.includes("Disallow: /api/") &&
      !robotsText.toLowerCase().includes("sitemap:") &&
      sitemapResponse.status === 200 &&
      !sitemapText.includes("127.0.0.1") &&
      !/<url>/.test(sitemapText),
    "The non-production robots and sitemap resources expose local URLs or advertise a sitemap.",
  );
  const protectedPage = await fetch(`${baseUrl}/login`);
  ensure(
    protectedPage.status === 200 && protectedPage.headers.get("x-robots-tag")?.includes("noindex"),
    "The sign-in page must send an X-Robots-Tag noindex header.",
  );
  pass("local SEO policy prevents indexing and exposes no localhost sitemap URLs");
  pass("public landing page loads");
  const csp = home.headers.get("content-security-policy") ?? "";
  ensure(
    csp.includes("default-src 'self'") &&
      csp.includes("'nonce-") &&
      home.headers.get("x-content-type-options") === "nosniff" &&
      home.headers.get("x-frame-options") === "DENY",
    "The page is missing its nonce CSP or baseline security headers.",
  );
  const manifestResponse = await fetch(`${baseUrl}/manifest.webmanifest`);
  const manifest = await jsonResponse(manifestResponse);
  const serviceWorkerResponse = await fetch(`${baseUrl}/sw.js`);
  const serviceWorker = await serviceWorkerResponse.text();
  const offlinePage = await fetch(`${baseUrl}/offline.html`);
  ensure(
    manifestResponse.status === 200 &&
      manifest?.display === "standalone" &&
      serviceWorkerResponse.status === 200 &&
      serviceWorker.includes("kzhexly-shell-v2") &&
      offlinePage.status === 200,
    "The PWA manifest, service worker, or offline fallback is unavailable.",
  );
  pass("nonce CSP, security headers, and PWA offline assets");

  const healthResponse = await fetch(`${baseUrl}/api/v1/health`);
  const health = await jsonResponse(healthResponse);
  ensure(health?.checks?.database === "healthy", "The API health check cannot reach PostgreSQL.");
  ensure(
    (health?.checks?.storage === "healthy" && healthResponse.status === 200) ||
      (health?.checks?.storage === "unavailable" && healthResponse.status === 503),
    "The API health status does not match its storage check.",
  );
  ensure(
    healthResponse.headers.has("x-request-id"),
    "The health check omitted its request id header.",
  );
  pass("API reaches the isolated PostgreSQL database");

  for (const [username, role] of users) {
    const session = await signIn(username);
    ensure(session.user.role === role, `Account ${username} returned the wrong role.`);
    ensure(
      session.user.mustChangePassword === false,
      `E2E account ${username} is not ready for route tests.`,
    );
    const meResponse = await api("/api/v1/auth/me", { cookie: session.cookie });
    const me = await jsonResponse(meResponse);
    ensure(
      meResponse.status === 200 && me?.user?.role === role,
      `Session check failed for ${username}.`,
    );
    sessions.set(username, { ...session, role });
  }
  pass("username sign-in and session identity for all four roles");

  const dashboardPaths = {
    SUPER_ADMIN: "/admin",
    ADMIN: "/admin",
    TEACHER: "/teacher",
    STUDENT: "/student",
  };
  for (const [username, role] of users) {
    const response = await api(dashboardPaths[role], { cookie: sessions.get(username).cookie });
    ensure(response.status === 200, `${role} dashboard returned HTTP ${response.status}.`);
  }
  pass("role dashboards load for SUPER_ADMIN, ADMIN, TEACHER, and STUDENT");

  if (process.env.E2E_AXE_AUDIT === "true") {
    const { auditRolePages } = await import("./local-a11y-audit.mjs");
    const reports = await auditRolePages({
      baseUrl,
      sessions,
      outputDirectory: process.env.E2E_AXE_OUTPUT_DIR,
      loginCredentials: { username: "student01", password: testPassword },
    });
    for (const report of reports) {
      const violations = report.violations.map((violation) => violation.id).join(", ") || "none";
      const manual = report.incomplete.map((item) => item.id).join(", ") || "none";
      console.info(
        `AXE ${report.role} ${report.viewport} ${report.uiState ?? "page"} ${report.url}: violations=${violations}; manual=${manual}`,
      );
    }
    pass(`axe-core role pages audited (${reports.length} routes)`);
    if (process.env.E2E_AXE_ONLY === "true") throw new E2EAxeOnlyComplete();
  }

  for (const [username, role] of users) {
    const response = await api("/api/v1/admin/users", { cookie: sessions.get(username).cookie });
    const expected = role === "SUPER_ADMIN" || role === "ADMIN" ? 200 : 403;
    ensure(
      response.status === expected,
      `${role} user-list access returned HTTP ${response.status}.`,
    );
  }
  const anonymousUsers = await api("/api/v1/admin/users");
  ensure(anonymousUsers.status === 401, "Anonymous access to admin users was not rejected.");
  for (const [username, role] of users) {
    const response = await api("/api/v1/admin/audit", { cookie: sessions.get(username).cookie });
    const expected = role === "SUPER_ADMIN" || role === "ADMIN" ? 200 : 403;
    ensure(response.status === expected, `${role} audit access returned HTTP ${response.status}.`);
  }
  const anonymousAudit = await api("/api/v1/admin/audit");
  ensure(anonymousAudit.status === 401, "Anonymous access to the audit log was not rejected.");
  pass("admin routes reject anonymous users and non-admin roles");

  const courseRows = await prisma.course.findMany({
    where: { deletedAt: null, status: "PUBLISHED" },
    select: {
      id: true,
      slug: true,
      termId: true,
      enrollments: { where: { status: "ACTIVE" }, select: { studentId: true, groupId: true } },
      teacherAssignments: { select: { teacherId: true } },
    },
  });
  const student = sessions.get("student01").user;
  const teacher = sessions.get("teacher01").user;
  const ownStudentCourse = courseRows.find((course) =>
    course.enrollments.some((row) => row.studentId === student.id),
  );
  const foreignStudentCourse = courseRows.find(
    (course) => !course.enrollments.some((row) => row.studentId === student.id),
  );
  const ownTeacherCourse = courseRows.find((course) =>
    course.teacherAssignments.some((row) => row.teacherId === teacher.id),
  );
  const sharedCourse = courseRows.find(
    (course) =>
      course.enrollments.some((row) => row.studentId === student.id) &&
      course.teacherAssignments.some((row) => row.teacherId === teacher.id),
  );
  const foreignTeacherCourse = courseRows.find(
    (course) => !course.teacherAssignments.some((row) => row.teacherId === teacher.id),
  );
  ensure(
    ownStudentCourse &&
      foreignStudentCourse &&
      ownTeacherCourse &&
      foreignTeacherCourse &&
      sharedCourse,
    "E2E course fixtures do not cover both allowed and denied course access.",
  );
  await verifyDeadlineReminderWorker(sharedCourse.id, sessions.get("teacher01").cookie, student.id);

  const studentOwnById = await api(`/api/v1/courses/${ownStudentCourse.id}`, {
    cookie: sessions.get("student01").cookie,
  });
  const studentOwnBySlug = await api(`/api/v1/courses/${ownStudentCourse.slug}`, {
    cookie: sessions.get("student01").cookie,
  });
  const studentForeign = await api(`/api/v1/courses/${foreignStudentCourse.id}`, {
    cookie: sessions.get("student01").cookie,
  });
  const studentForeignBySlug = await api(`/api/v1/courses/${foreignStudentCourse.slug}`, {
    cookie: sessions.get("student01").cookie,
  });
  const teacherOwn = await api(`/api/v1/courses/${ownTeacherCourse.id}`, {
    cookie: sessions.get("teacher01").cookie,
  });
  const teacherForeign = await api(`/api/v1/courses/${foreignTeacherCourse.id}`, {
    cookie: sessions.get("teacher01").cookie,
  });
  ensure(
    studentOwnById.status === 200 && studentOwnBySlug.status === 200,
    "Student cannot read an enrolled course by id and slug.",
  );
  ensure(
    studentForeign.status === 404 && studentForeignBySlug.status === 404,
    "Student can read a course without enrollment by id or slug.",
  );
  ensure(
    teacherOwn.status === 200 && teacherForeign.status === 404,
    "Teacher course assignment access filter failed.",
  );
  const studentGradebook = await api(`/api/v1/courses/${ownStudentCourse.id}/gradebook`, {
    cookie: sessions.get("student01").cookie,
  });
  ensure(
    studentGradebook.status === 403 || studentGradebook.status === 404,
    "Student can read the course-wide gradebook.",
  );
  pass("course ID and slug access filters prevent cross-course IDOR");

  const richTextSectionResponse = await api(`/api/v1/courses/${sharedCourse.id}/sections`, {
    cookie: sessions.get("teacher01").cookie,
    method: "POST",
    body: { title: `E2E Rich Text Section ${randomUUID().slice(0, 8)}`, isPublished: true },
  });
  const richTextSectionResult = await jsonResponse(richTextSectionResponse);
  ensure(
    richTextSectionResponse.status === 201 && richTextSectionResult?.section?.id,
    "The assigned teacher could not create a section for the rich-text check.",
  );
  const dirtyLessonContent =
    '<h2>Safe lesson</h2><p onclick="alert(1)">Formatted text</p><script>alert(2)</script><a href="javascript:alert(3)">unsafe link</a>';
  const richTextLessonResponse = await api(
    `/api/v1/sections/${richTextSectionResult.section.id}/lessons`,
    {
      cookie: sessions.get("teacher01").cookie,
      method: "POST",
      body: {
        type: "TEXT",
        title: `E2E Rich Text ${randomUUID().slice(0, 8)}`,
        content: dirtyLessonContent,
        isPublished: true,
      },
    },
  );
  const richTextLessonResult = await jsonResponse(richTextLessonResponse);
  ensure(
    richTextLessonResponse.status === 201 &&
      richTextLessonResult?.lesson?.content ===
        "<h2>Safe lesson</h2><p>Formatted text</p><a>unsafe link</a>",
    "Rich text was not sanitized before storage.",
  );
  const lessonSectionsResponse = await api(`/api/v1/courses/${sharedCourse.id}/sections`, {
    cookie: sessions.get("teacher01").cookie,
  });
  const lessonSectionsResult = await jsonResponse(lessonSectionsResponse);
  const visibleRichText = lessonSectionsResult?.sections
    ?.flatMap((section) => section.lessons ?? [])
    .find((lesson) => lesson.id === richTextLessonResult.lesson.id)?.content;
  ensure(
    visibleRichText === richTextLessonResult.lesson.content,
    "The course material API returned unsanitized rich text.",
  );
  const emptyRichTextResponse = await api(
    `/api/v1/sections/${richTextSectionResult.section.id}/lessons`,
    {
      cookie: sessions.get("teacher01").cookie,
      method: "POST",
      body: {
        type: "TEXT",
        title: `E2E Empty Rich Text ${randomUUID().slice(0, 8)}`,
        content: "<script>alert(4)</script>",
      },
    },
  );
  ensure(emptyRichTextResponse.status === 422, "A sanitized empty lesson was accepted.");
  pass("course rich text accepts formatting and strips XSS on write and read");

  if (health.checks.storage === "healthy" && storageClient) {
    const sectionResponse = await api(`/api/v1/courses/${sharedCourse?.id ?? ""}/sections`, {
      cookie: sessions.get("teacher01").cookie,
      method: "POST",
      body: { title: `E2E File Section ${randomUUID().slice(0, 8)}`, isPublished: true },
    });
    const sectionResult = await jsonResponse(sectionResponse);
    ensure(
      sectionResponse.status === 201 && sectionResult?.section?.id,
      "The assigned teacher could not create a file section.",
    );
    const lessonResponse = await api(`/api/v1/sections/${sectionResult.section.id}/lessons`, {
      cookie: sessions.get("teacher01").cookie,
      method: "POST",
      body: {
        type: "FILE",
        title: `E2E PDF ${randomUUID().slice(0, 8)}`,
        isPublished: true,
      },
    });
    const lessonResult = await jsonResponse(lessonResponse);
    ensure(
      lessonResponse.status === 201 && lessonResult?.lesson?.id,
      "The file lesson could not be created.",
    );

    const pdf = Buffer.from("%PDF-1.4\nKzhexly disposable local upload check\n%%EOF\n", "ascii");
    const presignResponse = await api("/api/v1/files/presign", {
      cookie: sessions.get("teacher01").cookie,
      method: "POST",
      body: {
        lessonId: lessonResult.lesson.id,
        originalName: "e2e-storage-check.pdf",
        mimeType: "application/pdf",
        sizeBytes: pdf.length,
      },
    });
    const presign = await jsonResponse(presignResponse);
    ensure(
      presignResponse.status === 201 &&
        presign?.upload?.fileId &&
        presign.upload.url &&
        presign.upload.fields,
      "The app could not create a presigned S3 upload.",
    );
    const storedFile = await prisma.storedFile.findUnique({
      where: { id: presign.upload.fileId },
      select: { bucket: true, storageKey: true },
    });
    ensure(storedFile, "The app did not create the private file record.");
    uploadedObjects.push(storedFile);

    const objectResponse = await uploadPresignedFile(
      presign.upload,
      pdf,
      "e2e-storage-check.pdf",
      "application/pdf",
    );
    ensure(
      [200, 201, 204].includes(objectResponse.status),
      `S3 presigned form upload returned HTTP ${objectResponse.status}: ${(await objectResponse.text()).slice(0, 800)}`,
    );

    const completeResponse = await api(`/api/v1/files/${presign.upload.fileId}/complete`, {
      cookie: sessions.get("teacher01").cookie,
      method: "POST",
      body: {},
    });
    const completedFile = await jsonResponse(completeResponse);
    const expectedChecksum = createHash("sha256").update(pdf).digest("hex");
    ensure(
      completeResponse.status === 200 &&
        completedFile?.file?.status === "READY" &&
        completedFile.file.checksumSha256 === expectedChecksum,
      "The app could not validate and complete the uploaded PDF.",
    );

    const visibleSections = await api(`/api/v1/courses/${sharedCourse.id}/sections`, {
      cookie: sessions.get("student01").cookie,
    });
    const visibleSectionsResult = await jsonResponse(visibleSections);
    ensure(
      visibleSections.status === 200 &&
        visibleSectionsResult?.sections?.some((section) =>
          section.lessons?.some((lesson) =>
            lesson.attachments?.some((attachment) => attachment.file?.id === presign.upload.fileId),
          ),
        ),
      "The enrolled student cannot see the published lesson attachment.",
    );
    const studentDownload = await api(`/api/v1/files/${presign.upload.fileId}/download`, {
      cookie: sessions.get("student01").cookie,
    });
    const foreignStudent = [...sessions.values()].find(
      (session) =>
        session.user.role === "STUDENT" &&
        !sharedCourse.enrollments.some((row) => row.studentId === session.user.id),
    );
    ensure(
      foreignStudent,
      "E2E fixtures do not cover a student outside the uploaded file's course.",
    );
    const foreignDownload = await api(`/api/v1/files/${presign.upload.fileId}/download`, {
      cookie: foreignStudent.cookie,
    });
    ensure(
      studentDownload.status === 200 &&
        Buffer.from(await studentDownload.arrayBuffer()).equals(pdf) &&
        studentDownload.headers.get("x-content-type-options") === "nosniff" &&
        foreignDownload.status === 404,
      "The private object download or cross-course file isolation failed.",
    );

    const fileAssignmentResponse = await api(`/api/v1/courses/${sharedCourse.id}/assignments`, {
      cookie: sessions.get("teacher01").cookie,
      method: "POST",
      body: {
        title: `E2E File Assignment ${randomUUID().slice(0, 8)}`,
        description: "Disposable file upload E2E fixture.",
        instructions: "Upload the generated PDF.",
        type: "FILE",
        maxScore: 100,
        weight: 1,
        dueAt: new Date(Date.now() + 86_400_000).toISOString(),
        status: "PUBLISHED",
        maxAttempts: 1,
      },
    });
    const fileAssignment = await jsonResponse(fileAssignmentResponse);
    ensure(
      fileAssignmentResponse.status === 201 && fileAssignment?.assignment?.id,
      "The assigned teacher could not create a file assignment.",
    );
    const fileSubmissionResponse = await api(
      `/api/v1/assignments/${fileAssignment.assignment.id}/submissions`,
      { cookie: sessions.get("student01").cookie, method: "POST", body: {} },
    );
    const fileSubmission = await jsonResponse(fileSubmissionResponse);
    ensure(
      fileSubmissionResponse.status === 201 && fileSubmission?.submission?.id,
      "The enrolled student could not create a file assignment draft.",
    );
    const strangerSubmissionPresign = await api("/api/v1/files/presign", {
      cookie: foreignStudent.cookie,
      method: "POST",
      body: {
        submissionId: fileSubmission.submission.id,
        originalName: "e2e-assignment.pdf",
        mimeType: "application/pdf",
        sizeBytes: pdf.length,
      },
    });
    ensure(
      strangerSubmissionPresign.status === 404,
      "A different student can request a presigned upload for a private submission.",
    );
    const submissionPresignResponse = await api("/api/v1/files/presign", {
      cookie: sessions.get("student01").cookie,
      method: "POST",
      body: {
        submissionId: fileSubmission.submission.id,
        originalName: "e2e-assignment.pdf",
        mimeType: "application/pdf",
        sizeBytes: pdf.length,
      },
    });
    const submissionPresign = await jsonResponse(submissionPresignResponse);
    ensure(
      submissionPresignResponse.status === 201 && submissionPresign?.upload?.fileId,
      "The submission owner could not request a presigned file upload.",
    );
    const submissionStoredFile = await prisma.storedFile.findUnique({
      where: { id: submissionPresign.upload.fileId },
      select: { bucket: true, storageKey: true },
    });
    ensure(submissionStoredFile, "The app did not create the submission file record.");
    uploadedObjects.push(submissionStoredFile);
    const submissionObjectResponse = await uploadPresignedFile(
      submissionPresign.upload,
      pdf,
      "e2e-assignment.pdf",
      "application/pdf",
    );
    ensure(
      [200, 201, 204].includes(submissionObjectResponse.status),
      `S3 submission upload returned HTTP ${submissionObjectResponse.status}: ${(await submissionObjectResponse.text()).slice(0, 800)}`,
    );
    const submissionComplete = await api(
      `/api/v1/files/${submissionPresign.upload.fileId}/complete`,
      { cookie: sessions.get("student01").cookie, method: "POST", body: {} },
    );
    const completedSubmissionFile = await jsonResponse(submissionComplete);
    ensure(
      submissionComplete.status === 200 && completedSubmissionFile?.file?.status === "READY",
      "The student's uploaded submission file could not be verified.",
    );
    const submitFileAssignment = await api(
      `/api/v1/submissions/${fileSubmission.submission.id}/submit`,
      { cookie: sessions.get("student01").cookie, method: "POST", body: {} },
    );
    ensure(submitFileAssignment.status === 200, "Student could not submit a file assignment.");
    const teacherFileDownload = await api(
      `/api/v1/files/${submissionPresign.upload.fileId}/download`,
      { cookie: sessions.get("teacher01").cookie },
    );
    const otherStudentFileDownload = await api(
      `/api/v1/files/${submissionPresign.upload.fileId}/download`,
      { cookie: foreignStudent.cookie },
    );
    ensure(
      teacherFileDownload.status === 200 &&
        Buffer.from(await teacherFileDownload.arrayBuffer()).equals(pdf) &&
        otherStudentFileDownload.status === 404,
      "A submitted file is not visible to its assigned teacher or leaked to another student.",
    );
    pass(
      "S3 object-store lesson and assignment uploads, file validation, private downloads, and course isolation",
    );
  } else {
    console.info(
      "SKIP object upload runtime checks: the S3-compatible storage health check is unavailable.",
    );
  }

  const sharedCourseMembership = sharedCourse.enrollments.find(
    (row) => row.studentId === student.id,
  );
  const assignmentTitle = `E2E Assignment ${randomUUID().slice(0, 8)}`;
  const assignmentResponse = await api(`/api/v1/courses/${sharedCourse.id}/assignments`, {
    cookie: sessions.get("teacher01").cookie,
    method: "POST",
    body: {
      title: assignmentTitle,
      description: "Disposable API end-to-end fixture.",
      instructions: "Submit a short answer.",
      type: "TEXT",
      maxScore: 100,
      weight: 1,
      dueAt: new Date(Date.now() + 86_400_000).toISOString(),
      status: "PUBLISHED",
      maxAttempts: 1,
    },
  });
  const assignmentResult = await jsonResponse(assignmentResponse);
  ensure(
    assignmentResponse.status === 201 && assignmentResult?.assignment?.id,
    "The assigned teacher could not create a published assignment.",
  );
  const studentAssignmentsResponse = await api(`/api/v1/courses/${sharedCourse.id}/assignments`, {
    cookie: sessions.get("student01").cookie,
  });
  const studentAssignments = await jsonResponse(studentAssignmentsResponse);
  ensure(
    studentAssignmentsResponse.status === 200 &&
      studentAssignments?.assignments?.some((item) => item.id === assignmentResult.assignment.id),
    "The enrolled student cannot see the published assignment.",
  );
  const draftResponse = await api(
    `/api/v1/assignments/${assignmentResult.assignment.id}/submissions`,
    {
      cookie: sessions.get("student01").cookie,
      method: "POST",
      body: { textContent: "Disposable E2E answer." },
    },
  );
  const draft = await jsonResponse(draftResponse);
  ensure(
    draftResponse.status === 201 && draft?.submission?.id,
    "Student could not save an assignment draft.",
  );
  const otherStudentSubmission = await api(`/api/v1/submissions/${draft.submission.id}`, {
    cookie: sessions.get("student02").cookie,
  });
  ensure(otherStudentSubmission.status === 404, "Another student can read a private submission.");
  const submitResponse = await api(`/api/v1/submissions/${draft.submission.id}/submit`, {
    cookie: sessions.get("student01").cookie,
    method: "POST",
    body: {},
  });
  ensure(submitResponse.status === 200, "Student could not submit a text assignment.");
  const teacherSubmissionsResponse = await api(
    `/api/v1/assignments/${assignmentResult.assignment.id}/submissions`,
    { cookie: sessions.get("teacher01").cookie },
  );
  const teacherSubmissions = await jsonResponse(teacherSubmissionsResponse);
  ensure(
    teacherSubmissionsResponse.status === 200 &&
      teacherSubmissions?.submissions?.some((item) => item.id === draft.submission.id),
    "The assigned teacher cannot see a submitted answer.",
  );
  const gradeResponse = await api(`/api/v1/submissions/${draft.submission.id}/grade`, {
    cookie: sessions.get("teacher01").cookie,
    method: "POST",
    body: { score: 87, feedback: "E2E grade." },
  });
  const graded = await jsonResponse(gradeResponse);
  ensure(
    gradeResponse.status === 200 &&
      graded?.submission?.status === "GRADED" &&
      Number(graded.submission.score) === 87,
    "The assigned teacher could not grade the submitted answer.",
  );
  const gradeAudit = await prisma.auditLog.findFirst({
    where: {
      action: "submission.graded",
      entityType: "Submission",
      entityId: draft.submission.id,
      actorId: sessions.get("teacher01").user.id,
    },
    select: { beforeJson: true, afterJson: true },
  });
  ensure(
    gradeAudit?.beforeJson?.status === "SUBMITTED" &&
      Number(gradeAudit.afterJson?.score) === 87 &&
      gradeAudit.afterJson?.feedback === "E2E grade.",
    "Grading a submission was not recorded with its previous state and new grade in the audit log.",
  );
  pass("grading changes are recorded in the audit log");
  const studentGradesResponse = await api("/api/v1/me/grades", {
    cookie: sessions.get("student01").cookie,
  });
  const studentGrades = await jsonResponse(studentGradesResponse);
  ensure(
    studentGradesResponse.status === 200 &&
      studentGrades?.grades?.some(
        (item) => item.id === draft.submission.id && Number(item.score) === 87,
      ),
    "The student cannot read the grade for their own submission.",
  );
  const weightedAssignmentResponse = await api(`/api/v1/courses/${sharedCourse.id}/assignments`, {
    cookie: sessions.get("teacher01").cookie,
    method: "POST",
    body: {
      title: `E2E Weighted Assignment ${randomUUID().slice(0, 8)}`,
      type: "TEXT",
      maxScore: 20,
      weight: 3,
      status: "PUBLISHED",
      maxAttempts: 1,
    },
  });
  const weightedAssignment = await jsonResponse(weightedAssignmentResponse);
  ensure(
    weightedAssignmentResponse.status === 201 && weightedAssignment?.assignment?.id,
    "The assigned teacher could not create the weighted gradebook fixture.",
  );
  const weightedDraftResponse = await api(
    `/api/v1/assignments/${weightedAssignment.assignment.id}/submissions`,
    {
      cookie: sessions.get("student01").cookie,
      method: "POST",
      body: { textContent: "Disposable weighted gradebook answer." },
    },
  );
  const weightedDraft = await jsonResponse(weightedDraftResponse);
  ensure(
    weightedDraftResponse.status === 201 && weightedDraft?.submission?.id,
    "Student could not save the weighted gradebook assignment draft.",
  );
  const weightedSubmitResponse = await api(
    `/api/v1/submissions/${weightedDraft.submission.id}/submit`,
    {
      cookie: sessions.get("student01").cookie,
      method: "POST",
      body: {},
    },
  );
  ensure(
    weightedSubmitResponse.status === 200,
    "Student could not submit the weighted assignment.",
  );
  const weightedGradeResponse = await api(
    `/api/v1/submissions/${weightedDraft.submission.id}/grade`,
    {
      cookie: sessions.get("teacher01").cookie,
      method: "POST",
      body: { score: 7, feedback: "Weighted gradebook fixture." },
    },
  );
  ensure(
    weightedGradeResponse.status === 200,
    "The assigned teacher could not grade the weighted assignment.",
  );
  const weightedGradebookResponse = await api(`/api/v1/courses/${sharedCourse.id}/gradebook`, {
    cookie: sessions.get("teacher01").cookie,
  });
  const weightedGradebook = await jsonResponse(weightedGradebookResponse);
  const weightedStudentRow = weightedGradebook?.gradebook?.rows?.find(
    (row) => row.student.id === sessions.get("student01").user.id,
  );
  ensure(
    weightedGradebookResponse.status === 200 &&
      weightedStudentRow?.calculatedPercent === 48 &&
      weightedStudentRow?.gradeLabel === "48%",
    "The gradebook did not calculate the weighted average from graded assignment scores.",
  );
  pass("gradebook calculates a student's final result using assignment weights");
  const gradebookExport = await api(`/api/v1/courses/${sharedCourse.id}/gradebook/export`, {
    cookie: sessions.get("teacher01").cookie,
  });
  const gradebookCsv = await gradebookExport.text();
  const studentGradebookExport = await api(`/api/v1/courses/${sharedCourse.id}/gradebook/export`, {
    cookie: sessions.get("student01").cookie,
  });
  ensure(
    gradebookExport.status === 200 &&
      gradebookExport.headers.get("content-type")?.includes("text/csv") &&
      gradebookCsv.includes(assignmentTitle) &&
      gradebookCsv.includes("87") &&
      studentGradebookExport.status === 403,
    "The CSV gradebook export is missing its grade or accessible to a student.",
  );
  const gradebookXlsxResponse = await api(
    `/api/v1/courses/${sharedCourse.id}/gradebook/export?format=xlsx`,
    { cookie: sessions.get("teacher01").cookie },
  );
  const gradebookXlsx = unzipTextEntries(Buffer.from(await gradebookXlsxResponse.arrayBuffer()));
  const gradebookWorksheet = gradebookXlsx.get("xl/worksheets/sheet1.xml") ?? "";
  ensure(
    gradebookXlsxResponse.status === 200 &&
      gradebookXlsxResponse.headers
        .get("content-type")
        ?.includes("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") &&
      gradebookWorksheet.includes(assignmentTitle) &&
      gradebookWorksheet.includes("<v>48</v>") &&
      !gradebookWorksheet.includes("<f>"),
    "The XLSX gradebook export is invalid, missing the graded result, or interprets cells as formulas.",
  );
  const studentGradebookXlsx = await api(
    `/api/v1/courses/${sharedCourse.id}/gradebook/export?format=xlsx`,
    { cookie: sessions.get("student01").cookie },
  );
  ensure(
    studentGradebookXlsx.status === 403,
    "A student can download the teacher gradebook export.",
  );
  pass("CSV and XLSX gradebook exports include grades and enforce teacher access");

  const strictDeadline = new Date(Date.now() + 30_000);
  const strictDeadlineAssignmentResponse = await api(
    `/api/v1/courses/${sharedCourse.id}/assignments`,
    {
      cookie: sessions.get("teacher01").cookie,
      method: "POST",
      body: {
        title: `E2E Strict Deadline ${randomUUID().slice(0, 8)}`,
        description: "Disposable deadline boundary fixture.",
        instructions: "Submit before the deadline.",
        type: "TEXT",
        maxScore: 100,
        weight: 1,
        dueAt: strictDeadline.toISOString(),
        status: "PUBLISHED",
        maxAttempts: 1,
      },
    },
  );
  const strictDeadlineAssignment = await jsonResponse(strictDeadlineAssignmentResponse);
  ensure(
    strictDeadlineAssignmentResponse.status === 201 && strictDeadlineAssignment?.assignment?.id,
    "Could not create the strict deadline fixture.",
  );
  const strictDeadlineDraftResponse = await api(
    `/api/v1/assignments/${strictDeadlineAssignment.assignment.id}/submissions`,
    {
      cookie: sessions.get("student01").cookie,
      method: "POST",
      body: { textContent: "Saved before the deadline." },
    },
  );
  const strictDeadlineDraft = await jsonResponse(strictDeadlineDraftResponse);
  ensure(
    strictDeadlineDraftResponse.status === 201 && strictDeadlineDraft?.submission?.id,
    "Student could not save a draft before the deadline.",
  );
  await new Promise((resolve) =>
    setTimeout(resolve, Math.max(0, strictDeadline.getTime() - Date.now() + 200)),
  );
  const expiredSubmissionResponse = await api(
    `/api/v1/submissions/${strictDeadlineDraft.submission.id}/submit`,
    { cookie: sessions.get("student01").cookie, method: "POST", body: {} },
  );
  const expiredSubmissionResponseBody = await expiredSubmissionResponse.text();
  ensure(
    expiredSubmissionResponse.status === 409,
    `A strict-deadline draft was not rejected after the deadline passed (HTTP ${expiredSubmissionResponse.status}): ${expiredSubmissionResponseBody}`,
  );

  const lateAssignmentResponse = await api(`/api/v1/courses/${sharedCourse.id}/assignments`, {
    cookie: sessions.get("teacher01").cookie,
    method: "POST",
    body: {
      title: `E2E Late Assignment ${randomUUID().slice(0, 8)}`,
      description: "Disposable late policy fixture.",
      instructions: "Late work is accepted with a penalty.",
      type: "TEXT",
      maxScore: 100,
      weight: 1,
      dueAt: new Date(Date.now() - 60_000).toISOString(),
      allowLate: true,
      latePenaltyPercent: 25,
      status: "PUBLISHED",
      maxAttempts: 1,
    },
  });
  const lateAssignment = await jsonResponse(lateAssignmentResponse);
  ensure(
    lateAssignmentResponse.status === 201 && lateAssignment?.assignment?.id,
    "Could not create the late-policy fixture.",
  );
  const lateDraftResponse = await api(
    `/api/v1/assignments/${lateAssignment.assignment.id}/submissions`,
    {
      cookie: sessions.get("student01").cookie,
      method: "POST",
      body: { textContent: "Submitted with an explicit late policy." },
    },
  );
  const lateDraft = await jsonResponse(lateDraftResponse);
  ensure(
    lateDraftResponse.status === 201 && lateDraft?.submission?.id,
    "Late-allowed work could not be drafted.",
  );
  const lateSubmitResponse = await api(`/api/v1/submissions/${lateDraft.submission.id}/submit`, {
    cookie: sessions.get("student01").cookie,
    method: "POST",
    body: {},
  });
  const lateSubmission = await jsonResponse(lateSubmitResponse);
  ensure(
    lateSubmitResponse.status === 200 && lateSubmission?.submission?.isLate === true,
    "Work accepted after due time was not marked late.",
  );
  const lateGradeResponse = await api(`/api/v1/submissions/${lateDraft.submission.id}/grade`, {
    cookie: sessions.get("teacher01").cookie,
    method: "POST",
    body: { score: 80, feedback: "E2E late penalty." },
  });
  const lateGrade = await jsonResponse(lateGradeResponse);
  ensure(
    lateGradeResponse.status === 200 && Number(lateGrade?.submission?.score) === 60,
    "The configured 25% late penalty was not applied to the grade.",
  );
  const searchOwn = await api(`/api/v1/search?q=${encodeURIComponent(assignmentTitle)}`, {
    cookie: sessions.get("student01").cookie,
  });
  const searchForeign = await api(`/api/v1/search?q=${encodeURIComponent(assignmentTitle)}`, {
    cookie: sessions.get("student04").cookie,
  });
  const ownSearchResults = await jsonResponse(searchOwn);
  const foreignSearchResults = await jsonResponse(searchForeign);
  ensure(
    searchOwn.status === 200 &&
      ownSearchResults?.some((item) => item.id === assignmentResult.assignment.id) &&
      searchForeign.status === 200 &&
      !foreignSearchResults?.some((item) => item.id === assignmentResult.assignment.id),
    "Global search leaked course content to a student without enrollment.",
  );
  pass(
    "assignment lifecycle, exact deadline boundary, late marking and penalty, grade visibility, and scoped search",
  );

  const testTitle = `E2E Quiz ${randomUUID().slice(0, 8)}`;
  const testCreateResponse = await api(`/api/v1/courses/${sharedCourse.id}/tests`, {
    cookie: sessions.get("teacher01").cookie,
    method: "POST",
    body: { title: testTitle, attemptsAllowed: 1, shuffleQuestions: false, passingPercent: 50 },
  });
  const testCreateResult = await jsonResponse(testCreateResponse);
  ensure(
    testCreateResponse.status === 201 && testCreateResult?.test?.id,
    "The assigned teacher could not create a quiz.",
  );
  const questionCreateResponse = await api(`/api/v1/tests/${testCreateResult.test.id}/questions`, {
    cookie: sessions.get("teacher01").cookie,
    method: "POST",
    body: {
      type: "SINGLE",
      prompt: "Which answer is correct in this disposable E2E quiz?",
      points: 10,
      options: [
        { text: "Correct option", isCorrect: true },
        { text: "Incorrect option", isCorrect: false },
      ],
    },
  });
  const questionResult = await jsonResponse(questionCreateResponse);
  ensure(
    questionCreateResponse.status === 201 && questionResult?.question?.id,
    "The teacher could not add a quiz question.",
  );
  const correctOption = questionResult.question.options.find((option) => option.isCorrect);
  ensure(correctOption, "The created quiz question has no correct option.");
  const essayQuestionResponse = await api(`/api/v1/tests/${testCreateResult.test.id}/questions`, {
    cookie: sessions.get("teacher01").cookie,
    method: "POST",
    body: {
      type: "ESSAY",
      prompt: "Explain the result in this disposable essay question.",
      points: 5,
    },
  });
  const essayQuestionResult = await jsonResponse(essayQuestionResponse);
  ensure(
    essayQuestionResponse.status === 201 && essayQuestionResult?.question?.id,
    "The teacher could not add an essay question.",
  );
  const publishTest = await api(`/api/v1/tests/${testCreateResult.test.id}`, {
    cookie: sessions.get("teacher01").cookie,
    method: "PATCH",
    body: { status: "PUBLISHED" },
  });
  ensure(publishTest.status === 200, "The teacher could not publish a valid quiz.");
  const studentAttemptResponse = await api(`/api/v1/tests/${testCreateResult.test.id}/attempts`, {
    cookie: sessions.get("student01").cookie,
    method: "POST",
    body: {},
  });
  const studentAttemptResult = await jsonResponse(studentAttemptResponse);
  const attemptQuestion = studentAttemptResult?.attempt?.questions?.[0];
  ensure(
    studentAttemptResponse.status === 201 && attemptQuestion,
    "The enrolled student could not start a quiz attempt.",
  );
  ensure(
    attemptQuestion.options.every((option) => !Object.hasOwn(option, "isCorrect")),
    "The quiz leaked correct-answer flags to a student.",
  );
  const foreignAttempt = await api(`/api/v1/tests/${testCreateResult.test.id}/attempts`, {
    cookie: sessions.get("student04").cookie,
    method: "POST",
    body: {},
  });
  ensure(foreignAttempt.status === 404, "A student outside the course can start its quiz.");
  const submitQuiz = await api(`/api/v1/attempts/${studentAttemptResult.attempt.id}/submit`, {
    cookie: sessions.get("student01").cookie,
    method: "POST",
    body: [
      { questionId: questionResult.question.id, answer: correctOption.id },
      {
        questionId: essayQuestionResult.question.id,
        answer: "My worked explanation is included for manual review.",
      },
    ],
  });
  const submittedQuiz = await jsonResponse(submitQuiz);
  ensure(
    submitQuiz.status === 200 &&
      submittedQuiz?.attempt?.status === "NEEDS_REVIEW" &&
      Number(submittedQuiz.attempt.score) === 10,
    "The quiz did not auto-grade the objective answer and send the essay to manual review.",
  );
  const essayGradeResponse = await api(
    `/api/v1/attempts/${studentAttemptResult.attempt.id}/grade`,
    {
      cookie: sessions.get("teacher01").cookie,
      method: "POST",
      body: {
        scores: [
          {
            questionId: essayQuestionResult.question.id,
            points: 4,
            feedback: "Clear explanation.",
          },
        ],
      },
    },
  );
  const essayGrade = await jsonResponse(essayGradeResponse);
  ensure(
    essayGradeResponse.status === 200 &&
      essayGrade?.status === "GRADED" &&
      Number(essayGrade.score) === 14,
    "The teacher could not manually grade the essay and finalize the quiz result.",
  );
  const studentReviewedAttemptResponse = await api(
    `/api/v1/attempts/${studentAttemptResult.attempt.id}`,
    { cookie: sessions.get("student01").cookie },
  );
  const studentReviewedAttempt = await jsonResponse(studentReviewedAttemptResponse);
  ensure(
    studentReviewedAttemptResponse.status === 200 &&
      studentReviewedAttempt?.attempt?.status === "GRADED" &&
      Number(studentReviewedAttempt.attempt.score) === 14,
    "The student cannot see the result after the teacher manually grades the essay.",
  );
  const lockedQuestion = await api(`/api/v1/tests/${testCreateResult.test.id}/questions`, {
    cookie: sessions.get("teacher01").cookie,
    method: "POST",
    body: { type: "ESSAY", prompt: "Locked question", points: 1 },
  });
  ensure(
    lockedQuestion.status === 409,
    "Quiz content was editable after a student attempt started.",
  );
  pass(
    "quiz publication, enrollment access, hidden answer keys, auto-grading, manual essay grading, result visibility, and content lock",
  );

  const sourceGradebookSettings = await prisma.gradebookSettings.findUnique({
    where: { courseId: sharedCourse.id },
  });
  const copyCourseResponse = await api(`/api/v1/courses/${sharedCourse.id}/copy`, {
    cookie: sessions.get("teacher01").cookie,
    method: "POST",
  });
  const copyCourseResult = await jsonResponse(copyCourseResponse);
  ensure(
    copyCourseResponse.status === 201 &&
      copyCourseResult?.item?.id &&
      copyCourseResult.item.status === "DRAFT" &&
      copyCourseResult.item.slug !== sharedCourse.slug,
    "The assigned teacher could not create a unique draft course copy.",
  );
  const copiedCourseGraph = await prisma.course.findUnique({
    where: { id: copyCourseResult.item.id },
    include: {
      teacherAssignments: true,
      enrollments: true,
      sections: { include: { lessons: { include: { attachments: true, progress: true } } } },
      assignments: { include: { submissions: true } },
      gradebookSettings: true,
      finalGrades: true,
      scheduleEntries: true,
      tests: {
        include: {
          questions: { include: { options: true, answers: true } },
          attempts: true,
        },
      },
      announcements: true,
    },
  });
  ensure(
    copiedCourseGraph &&
      copiedCourseGraph.teacherAssignments.length === 1 &&
      copiedCourseGraph.teacherAssignments[0]?.teacherId === teacher.id &&
      copiedCourseGraph.enrollments.length === 0 &&
      copiedCourseGraph.finalGrades.length === 0 &&
      copiedCourseGraph.scheduleEntries.length === 0 &&
      copiedCourseGraph.announcements.length === 0 &&
      copiedCourseGraph.sections.every(
        (section) =>
          !section.isPublished &&
          section.availableFrom === null &&
          section.availableUntil === null &&
          section.lessons.every(
            (lesson) =>
              !lesson.isPublished &&
              lesson.availableFrom === null &&
              lesson.availableUntil === null &&
              lesson.progress.length === 0,
          ),
      ) &&
      copiedCourseGraph.assignments.every(
        (assignment) =>
          assignment.status === "DRAFT" &&
          assignment.dueAt === null &&
          assignment.submissions.length === 0,
      ) &&
      copiedCourseGraph.tests.every(
        (test) =>
          test.status === "DRAFT" &&
          test.attempts.length === 0 &&
          test.questions.every((question) => question.answers.length === 0),
      ) &&
      copiedCourseGraph.tests.some((test) =>
        test.questions.some((question) => question.options.length > 0),
      ),
    "The course copy is missing content or copied roster, results, publication, or schedule state.",
  );
  ensure(
    copiedCourseGraph.gradebookSettings?.scale === sourceGradebookSettings?.scale &&
      copiedCourseGraph.gradebookSettings?.passingScore.toString() ===
        sourceGradebookSettings?.passingScore.toString() &&
      copiedCourseGraph.gradebookSettings?.rounding === sourceGradebookSettings?.rounding,
    "The copied course did not retain its gradebook settings.",
  );
  const copyAudit = await prisma.auditLog.findFirst({
    where: { entityId: copiedCourseGraph.id, action: "course.copied" },
  });
  ensure(copyAudit, "Course copy was not written to the audit log.");
  const expectedAdminTeacherIds = (
    await prisma.courseTeacher.findMany({
      where: {
        courseId: sharedCourse.id,
        teacher: { role: "TEACHER", status: "ACTIVE", deletedAt: null },
      },
      select: { teacherId: true },
    })
  )
    .map((assignment) => assignment.teacherId)
    .sort();
  const adminCopyResponse = await api(`/api/v1/courses/${sharedCourse.id}/copy`, {
    cookie: sessions.get("admin01").cookie,
    method: "POST",
  });
  const adminCopyResult = await jsonResponse(adminCopyResponse);
  ensure(
    adminCopyResponse.status === 201 &&
      adminCopyResult?.item?.id &&
      adminCopyResult.item.status === "DRAFT" &&
      adminCopyResult.item.slug !== copyCourseResult.item.slug,
    "The administrator could not create a second unique course copy.",
  );
  const adminCopiedTeacherIds = (
    await prisma.courseTeacher.findMany({
      where: { courseId: adminCopyResult.item.id },
      select: { teacherId: true },
    })
  )
    .map((assignment) => assignment.teacherId)
    .sort();
  ensure(
    JSON.stringify(adminCopiedTeacherIds) === JSON.stringify(expectedAdminTeacherIds),
    "The administrator copy did not preserve the source course's active teacher assignments.",
  );
  const studentCourseCopy = await api(`/api/v1/courses/${sharedCourse.id}/copy`, {
    cookie: sessions.get("student01").cookie,
    method: "POST",
  });
  ensure(studentCourseCopy.status === 403, "A student could copy a course.");
  const assignedTeacherIds = await prisma.courseTeacher.findMany({
    where: { courseId: sharedCourse.id },
    select: { teacherId: true },
  });
  const deniedTeacherUsername = ["teacher01", "teacher02"].find(
    (username) =>
      !assignedTeacherIds.some(
        (assignment) => assignment.teacherId === sessions.get(username).user.id,
      ),
  );
  if (deniedTeacherUsername) {
    const deniedTeacherCopy = await api(`/api/v1/courses/${sharedCourse.id}/copy`, {
      cookie: sessions.get(deniedTeacherUsername).cookie,
      method: "POST",
    });
    ensure(
      deniedTeacherCopy.status === 404,
      "An unassigned teacher could copy someone else's course.",
    );
  }
  pass(
    "teacher and admin course copies retain content, settings, and intended assignments as unpublished drafts without rosters, results, schedules, or announcements; copy access and audit are enforced",
  );

  const announcementTitle = `E2E Notice ${randomUUID().slice(0, 8)}`;
  const announcementResponse = await api("/api/v1/announcements", {
    cookie: sessions.get("teacher01").cookie,
    method: "POST",
    body: {
      scope: "COURSE",
      courseId: sharedCourse.id,
      title: announcementTitle,
      body: "Disposable course audience notification.",
      publish: true,
    },
  });
  const announcementResult = await jsonResponse(announcementResponse);
  ensure(
    announcementResponse.status === 201 && announcementResult?.announcement?.id,
    "The assigned teacher could not publish a course announcement.",
  );
  const groupAnnouncementResponse = await api("/api/v1/announcements", {
    cookie: sessions.get("teacher01").cookie,
    method: "POST",
    body: {
      scope: "GROUP",
      groupId: sharedCourseMembership.groupId,
      courseId: sharedCourse.id,
      title: `${announcementTitle} · group`,
      body: "A group-targeted notice from the assigned teacher.",
      publish: true,
    },
  });
  const groupAnnouncementResult = await jsonResponse(groupAnnouncementResponse);
  ensure(
    groupAnnouncementResponse.status === 201 && groupAnnouncementResult?.announcement?.id,
    "The assigned teacher could not publish a group announcement.",
  );
  const groupAnnouncementEdit = await api(
    `/api/v1/announcements/${groupAnnouncementResult.announcement.id}`,
    {
      cookie: sessions.get("teacher01").cookie,
      method: "PATCH",
      body: { title: `${announcementTitle} · edited` },
    },
  );
  ensure(
    groupAnnouncementEdit.status === 200,
    "The teacher could not edit their own group announcement.",
  );
  const studentNoticesResponse = await api("/api/v1/announcements", {
    cookie: sessions.get("student01").cookie,
  });
  const foreignNoticesResponse = await api("/api/v1/announcements", {
    cookie: sessions.get("student04").cookie,
  });
  const studentNotices = await jsonResponse(studentNoticesResponse);
  const foreignNotices = await jsonResponse(foreignNoticesResponse);
  ensure(
    studentNotices?.announcements?.some((item) => item.id === announcementResult.announcement.id) &&
      studentNotices?.announcements?.some(
        (item) => item.id === groupAnnouncementResult.announcement.id,
      ) &&
      !foreignNotices?.announcements?.some(
        (item) => item.id === announcementResult.announcement.id,
      ),
    "A course announcement was delivered outside its enrolled audience.",
  );
  const notificationsResponse = await api("/api/v1/me/notifications", {
    cookie: sessions.get("student01").cookie,
  });
  const notifications = await jsonResponse(notificationsResponse);
  const studentAnnouncementEmail = await prisma.emailOutbox.findUnique({
    where: {
      dedupeKey: `announcement:${announcementResult.announcement.id}:user:${sessions.get("student01").user.id}`,
    },
    select: { toEmail: true, subject: true, body: true, status: true },
  });
  ensure(
    notifications?.items?.some(
      (item) => item.dataJson?.announcementId === announcementResult.announcement.id,
    ) &&
      studentAnnouncementEmail?.toEmail === sessions.get("student01").user.email &&
      studentAnnouncementEmail.subject.includes(announcementTitle) &&
      studentAnnouncementEmail.body.includes(`${baseUrl}/announcements`) &&
      studentAnnouncementEmail.status === "PENDING",
    "The published announcement did not create both its in-app notice and deduplicated email outbox item.",
  );
  const markNotificationsRead = await api("/api/v1/me/notifications", {
    cookie: sessions.get("student01").cookie,
    method: "PATCH",
    body: {},
  });
  const readNotifications = await jsonResponse(markNotificationsRead);
  ensure(
    markNotificationsRead.status === 200 && readNotifications?.updated >= 1,
    "The student could not mark notifications as read.",
  );
  pass("course announcement audience, in-app notice, and transactional email outbox delivery/read");

  const scheduleTerm = await prisma.term.findUnique({
    where: { id: sharedCourse.termId },
    select: { id: true, startsOn: true, endsOn: true },
  });
  ensure(
    scheduleTerm && sharedCourseMembership?.groupId,
    "The shared course has no valid term or group.",
  );
  const scheduleDate = scheduleTerm.startsOn.toISOString().slice(0, 10);
  const scheduleDateValue = new Date(`${scheduleDate}T00:00:00.000Z`);
  const dayOfWeek = ((scheduleDateValue.getUTCDay() + 6) % 7) + 1;
  const scheduleBody = {
    termId: scheduleTerm.id,
    groupId: sharedCourseMembership.groupId,
    courseId: sharedCourse.id,
    teacherId: teacher.id,
    room: "E2E-101",
    dayOfWeek,
    startTime: "10:00",
    endTime: "11:00",
    weekPattern: "EVERY",
  };
  const scheduleCreateResponse = await api("/api/v1/schedule", {
    cookie: sessions.get("superadmin").cookie,
    method: "POST",
    body: scheduleBody,
  });
  const scheduleCreateResult = await jsonResponse(scheduleCreateResponse);
  ensure(
    scheduleCreateResponse.status === 201 && scheduleCreateResult?.entry?.id,
    "The administrator could not create a valid schedule entry.",
  );
  const conflictingSchedule = await api("/api/v1/schedule", {
    cookie: sessions.get("superadmin").cookie,
    method: "POST",
    body: scheduleBody,
  });
  ensure(
    conflictingSchedule.status === 409,
    "The scheduler accepted a conflicting group/teacher/room entry.",
  );
  const teacherScheduleResponse = await api("/api/v1/schedule", {
    cookie: sessions.get("teacher01").cookie,
  });
  const studentScheduleResponse = await api("/api/v1/schedule", {
    cookie: sessions.get("student01").cookie,
  });
  const foreignScheduleResponse = await api("/api/v1/schedule", {
    cookie: sessions.get("student04").cookie,
  });
  const teacherSchedule = await jsonResponse(teacherScheduleResponse);
  const studentSchedule = await jsonResponse(studentScheduleResponse);
  const foreignSchedule = await jsonResponse(foreignScheduleResponse);
  ensure(
    teacherSchedule?.entries?.some((item) => item.id === scheduleCreateResult.entry.id) &&
      studentSchedule?.entries?.some((item) => item.id === scheduleCreateResult.entry.id) &&
      !foreignSchedule?.entries?.some((item) => item.id === scheduleCreateResult.entry.id),
    "The personal schedule did not enforce teacher assignment and student group access.",
  );
  const scheduleRoster = await prisma.groupMember.findMany({
    where: {
      groupId: sharedCourseMembership.groupId,
      leftAt: null,
      student: { status: "ACTIVE", deletedAt: null },
    },
    select: { studentId: true },
  });
  ensure(scheduleRoster.length > 0, "The E2E schedule has no enrolled students for attendance.");
  const attendanceRecords = scheduleRoster.map(({ studentId }) => ({
    studentId,
    status: studentId === student.id ? "ABSENT" : "PRESENT",
    note: studentId === student.id ? "E2E absence." : null,
  }));
  const groupBeforeCurator = await prisma.studyGroup.findUnique({
    where: { id: sharedCourseMembership.groupId },
    select: { curatorId: true },
  });
  await prisma.studyGroup.update({
    where: { id: sharedCourseMembership.groupId },
    data: { curatorId: null },
  });
  const foreignTeacherAttendance = await api(
    `/api/v1/schedule/${scheduleCreateResult.entry.id}/attendance`,
    {
      cookie: sessions.get("teacher02").cookie,
      method: "POST",
      body: { date: scheduleDate, records: attendanceRecords },
    },
  );
  ensure(
    foreignTeacherAttendance.status === 403,
    "An unassigned teacher can mark another teacher's attendance.",
  );
  const adminAttendanceMark = await api(
    `/api/v1/schedule/${scheduleCreateResult.entry.id}/attendance`,
    {
      cookie: sessions.get("superadmin").cookie,
      method: "POST",
      body: { date: scheduleDate, records: attendanceRecords },
    },
  );
  const adminAttendanceReport = await api(
    `/api/v1/attendance/report?from=${scheduleDate}&to=${scheduleDate}`,
    { cookie: sessions.get("superadmin").cookie },
  );
  ensure(
    adminAttendanceMark.status === 403 && adminAttendanceReport.status === 403,
    "Administrators must not access or mark attendance.",
  );
  const ordinaryTeacherAttendanceResponse = await api(
    `/api/v1/schedule/${scheduleCreateResult.entry.id}/attendance`,
    {
      cookie: sessions.get("teacher01").cookie,
      method: "POST",
      body: { date: scheduleDate, records: attendanceRecords },
    },
  );
  ensure(
    ordinaryTeacherAttendanceResponse.status === 403,
    "An ordinary assigned teacher must not mark group attendance.",
  );
  await prisma.studyGroup.update({
    where: { id: sharedCourseMembership.groupId },
    data: { curatorId: sessions.get("teacher02").user.id },
  });
  const curatorScheduleResponse = await api("/api/v1/schedule", {
    cookie: sessions.get("teacher02").cookie,
  });
  const curatorSchedule = await jsonResponse(curatorScheduleResponse);
  ensure(
    curatorSchedule?.entries?.some(
      (item) => item.id === scheduleCreateResult.entry.id && item.canMarkAttendance,
    ),
    "The group curator cannot see the group schedule or mark attendance.",
  );
  const curatorAttendance = await api(
    `/api/v1/schedule/${scheduleCreateResult.entry.id}/attendance`,
    {
      cookie: sessions.get("teacher02").cookie,
      method: "POST",
      body: { date: scheduleDate, records: attendanceRecords },
    },
  );
  ensure(curatorAttendance.status === 200, "The group curator could not mark attendance.");
  const leaderMembership = await prisma.groupMember.findFirst({
    where: { groupId: sharedCourseMembership.groupId, studentId: student.id, leftAt: null },
    select: { id: true },
  });
  ensure(leaderMembership, "The E2E student is not an active member of their course group.");
  await prisma.groupMember.updateMany({
    where: { groupId: sharedCourseMembership.groupId, leftAt: null, isGroupLeader: true },
    data: { isGroupLeader: false },
  });
  await prisma.groupMember.update({
    where: { id: leaderMembership.id },
    data: { isGroupLeader: true },
  });
  const leaderScheduleResponse = await api("/api/v1/schedule", {
    cookie: sessions.get("student01").cookie,
  });
  const leaderSchedule = await jsonResponse(leaderScheduleResponse);
  ensure(
    leaderSchedule?.entries?.some(
      (item) => item.id === scheduleCreateResult.entry.id && item.canMarkAttendance,
    ),
    "The group leader cannot mark attendance from the group schedule.",
  );
  const leaderAttendance = await api(
    `/api/v1/schedule/${scheduleCreateResult.entry.id}/attendance`,
    {
      cookie: sessions.get("student01").cookie,
      method: "POST",
      body: { date: scheduleDate, records: attendanceRecords },
    },
  );
  ensure(leaderAttendance.status === 200, "The group leader could not mark group attendance.");
  const dailyAttendanceCount = await prisma.groupDailyAttendance.count({
    where: {
      groupId: sharedCourseMembership.groupId,
      sessionDate: new Date(`${scheduleDate}T00:00:00.000Z`),
    },
  });
  ensure(
    dailyAttendanceCount === scheduleRoster.length,
    "Repeated marks created multiple records per student, group, and date.",
  );
  const ownAttendanceResponse = await api(
    `/api/v1/me/attendance?from=${scheduleDate}&to=${scheduleDate}`,
    { cookie: sessions.get("student01").cookie },
  );
  const foreignAttendanceResponse = await api(
    `/api/v1/me/attendance?from=${scheduleDate}&to=${scheduleDate}`,
    { cookie: sessions.get("student04").cookie },
  );
  const ownAttendance = await jsonResponse(ownAttendanceResponse);
  const foreignAttendance = await jsonResponse(foreignAttendanceResponse);
  ensure(
    ownAttendance?.records?.some((item) => item.status === "ABSENT") &&
      foreignAttendance?.total === 0,
    "Attendance history is not scoped to the authenticated student.",
  );
  const attendanceXlsxResponse = await api(
    `/api/v1/attendance/report?format=xlsx&from=${scheduleDate}&to=${scheduleDate}`,
    { cookie: sessions.get("teacher02").cookie },
  );
  const attendanceXlsx = unzipTextEntries(Buffer.from(await attendanceXlsxResponse.arrayBuffer()));
  const attendanceWorksheet = attendanceXlsx.get("xl/worksheets/sheet1.xml") ?? "";
  ensure(
    attendanceXlsxResponse.status === 200 &&
      attendanceXlsxResponse.headers
        .get("content-type")
        ?.includes("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") &&
      attendanceWorksheet.includes(student.name) &&
      attendanceWorksheet.includes("ABSENT") &&
      !attendanceWorksheet.includes("<f>"),
    "The attendance XLSX export is missing the recorded attendance or interprets cells as formulas.",
  );
  pass("XLSX attendance report contains the recorded roster and literal cell values");
  await prisma.studyGroup.update({
    where: { id: sharedCourseMembership.groupId },
    data: { curatorId: groupBeforeCurator?.curatorId ?? null },
  });
  const studentIcsResponse = await api("/api/v1/me/schedule.ics", {
    cookie: sessions.get("student01").cookie,
  });
  const studentIcs = await studentIcsResponse.text();
  ensure(
    studentIcsResponse.status === 200 &&
      studentIcsResponse.headers.get("content-type")?.includes("text/calendar") &&
      studentIcs.includes("BEGIN:VCALENDAR") &&
      studentIcs.includes("SUMMARY:"),
    "The student's recurring schedule did not export as a valid calendar.",
  );
  pass(
    "schedule conflicts, curator and group-leader access, admin attendance denial, group roster, private history, and ICS export",
  );

  const student04Cookie = sessions.get("student04").cookie;
  const missingCsrfToken = await api("/api/v1/me/preferences", {
    cookie: student04Cookie,
    method: "PATCH",
    body: { locale: "en" },
    csrfToken: "",
  });
  const invalidCsrfToken = await api("/api/v1/me/preferences", {
    cookie: student04Cookie,
    method: "PATCH",
    body: { locale: "en" },
    csrfToken: "v1.invalid",
  });
  const csrfTokenResponse = await fetch(`${baseUrl}/api/v1/security/csrf`, {
    headers: { Cookie: student04Cookie, Origin: baseUrl },
  });
  const csrfTokenBody = await jsonResponse(csrfTokenResponse);
  ensure(
    missingCsrfToken.status === 403 &&
      (await jsonResponse(missingCsrfToken))?.error?.code === "CSRF_TOKEN_INVALID" &&
      invalidCsrfToken.status === 403 &&
      (await jsonResponse(invalidCsrfToken))?.error?.code === "CSRF_TOKEN_INVALID" &&
      csrfTokenResponse.ok &&
      typeof csrfTokenBody?.token === "string" &&
      csrfTokenResponse.headers.get("cache-control")?.includes("no-store"),
    "The API did not reject missing/invalid CSRF tokens or cache the session token safely.",
  );
  pass("session-bound CSRF token issuance, cache policy, and missing/invalid token rejection");

  const localeChange = await api("/api/v1/me/preferences", {
    cookie: student04Cookie,
    method: "PATCH",
    body: { locale: "kk" },
  });
  const localeResult = await jsonResponse(localeChange);
  const localeSession = await api("/api/v1/auth/me", {
    cookie: student04Cookie,
  });
  const localeSessionResult = await jsonResponse(localeSession);
  ensure(
    localeChange.status === 200 &&
      localeResult?.locale === "kk" &&
      localeSessionResult?.user?.locale === "kk",
    `The language preference did not persist to the user's session (PATCH HTTP ${localeChange.status}, saved=${localeResult?.locale ?? "missing"}, session HTTP ${localeSession.status}, locale=${localeSessionResult?.user?.locale ?? "missing"}).`,
  );
  pass("saved language preference and authenticated session update");
  const localeCookie = localeChange.headers.get("set-cookie") ?? "";
  const localizedLanding = await fetch(`${baseUrl}/?locale=kk`, {
    headers: { Cookie: "lms_locale=kk" },
  });
  const localizedLandingHtml = await localizedLanding.text();
  const localizedTitle = localizedLandingHtml.match(/<title>(.*?)<\/title>/i)?.[1] ?? "";
  const localizedDescription =
    localizedLandingHtml.match(/<meta[^>]+name="description"[^>]+content="([^"]*)"/i)?.[1] ?? "";
  ensure(
    localeCookie.startsWith("lms_locale=kk;") &&
      localizedLanding.status === 200 &&
      /<html[^>]*lang="kk"/.test(localizedLandingHtml) &&
      localizedTitle.includes("Хекслет Колледжі — оқу платформасы") &&
      localizedDescription.includes("Хекслет Колледжінің студенттері"),
    `The saved language preference did not update the document language and page metadata (HTTP ${localizedLanding.status}, lang=${localizedLandingHtml.match(/<html[^>]*lang="([^"]*)"/i)?.[1] ?? "missing"}, title=${localizedTitle || "missing"}, description=${localizedDescription || "missing"}).`,
  );
  pass("saved language preference updates document language and metadata");

  const initialUserCount = await prisma.user.count();
  const signupResponse = await fetch(`${baseUrl}/api/v1/auth/sign-up/email`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({
      name: "Public Sign-up Probe",
      email: `signup-probe-${randomUUID()}@kzhexly.test`,
      password: testPassword,
    }),
  });
  ensure(signupResponse.status >= 400, "Public account registration is enabled.");
  ensure(
    (await prisma.user.count()) === initialUserCount,
    "A public sign-up request created a user.",
  );
  pass("public registration is disabled");

  const failedSignIn = async (username, clientIp) => {
    const response = await fetch(`${baseUrl}/api/v1/auth/sign-in/username`, {
      method: "POST",
      headers: jsonHeaders(undefined, clientIp),
      body: JSON.stringify({ username, password: `Invalid-${randomUUID()}!`, callbackURL: "/" }),
      redirect: "manual",
    });
    return { response, body: await jsonResponse(response) };
  };
  const knownUserFailure = await failedSignIn("student01", "198.51.100.10");
  const unknownUserFailure = await failedSignIn(
    `missing${randomUUID().replaceAll("-", "").slice(0, 8)}`,
    "198.51.100.11",
  );
  const authErrorShape = ({ response, body }) => ({
    status: response.status,
    code: body?.code,
    message: body?.message,
  });
  ensure(
    JSON.stringify(authErrorShape(knownUserFailure)) ===
      JSON.stringify(authErrorShape(unknownUserFailure)),
    "Sign-in responses reveal whether a username exists.",
  );
  const failedSignInStatuses = [];
  for (let attempt = 0; attempt < 7; attempt += 1) {
    const { response } = await failedSignIn("student01", "198.51.100.12");
    failedSignInStatuses.push(response.status);
  }
  ensure(
    failedSignInStatuses.slice(0, 6).every((status) => status === 401) &&
      failedSignInStatuses[6] === 429,
    "Repeated sign-in failures were not temporarily rate limited.",
  );
  pass("sign-in errors do not expose usernames and repeated failures are rate limited");

  const adminCookie = sessions.get("admin01").cookie;
  const importUsername = `csvstudent${randomUUID().replaceAll("-", "").slice(0, 8)}`;
  const importEmail = `${importUsername}@kzhexly.test`;
  const usersCsv = [
    "username,email,role,firstName,lastName,middleName,phone,locale",
    `${importUsername},${importEmail},STUDENT,=2+2,Imported,,,ru`,
    `badrole${importUsername},badrole${randomUUID()}@kzhexly.test,ADMIN,Not,Allowed,,,ru`,
    `bademail${importUsername},not-an-email,STUDENT,Bad,Email,,,ru`,
  ].join("\r\n");
  const createUsersForm = () => {
    const form = new FormData();
    form.append("file", new Blob([usersCsv], { type: "text/csv" }), "users.csv");
    return form;
  };
  const unauthorizedImport = await multipartApi("/api/v1/admin/users/import", {
    cookie: sessions.get("teacher01").cookie,
    form: createUsersForm(),
  });
  const importedUsersResponse = await multipartApi("/api/v1/admin/users/import", {
    cookie: adminCookie,
    form: createUsersForm(),
  });
  const importedUsers = await jsonResponse(importedUsersResponse);
  ensure(
    unauthorizedImport.status === 403 &&
      importedUsersResponse.status === 200 &&
      importedUsers?.result?.createdCount === 1 &&
      importedUsers?.result?.errorCount === 2 &&
      importedUsers?.result?.created?.[0]?.username === importUsername &&
      importedUsers?.result?.created?.[0]?.temporaryPassword,
    "CSV user import failed row validation, role restrictions, or one-time credentials.",
  );
  const importedUserExport = await api(
    `/api/v1/admin/users/export?q=${encodeURIComponent(importUsername)}`,
    { cookie: adminCookie },
  );
  const importedUserCsv = await importedUserExport.text();
  const studentUserExport = await api("/api/v1/admin/users/export", {
    cookie: sessions.get("student01").cookie,
  });
  const anonymousUserExport = await api("/api/v1/admin/users/export");
  ensure(
    importedUserExport.status === 200 &&
      importedUserExport.headers.get("content-type")?.includes("text/csv") &&
      importedUserCsv.includes(importUsername) &&
      importedUserCsv.includes(importEmail) &&
      importedUserCsv.includes('"\'=2+2"') &&
      !importedUserCsv.includes(importedUsers.result.created[0].temporaryPassword) &&
      studentUserExport.status === 403 &&
      anonymousUserExport.status === 401,
    "CSV user export omitted the imported user, exposed a password, or ignored role restrictions/formula escaping.",
  );
  const repeatedImportResponse = await multipartApi("/api/v1/admin/users/import", {
    cookie: adminCookie,
    form: createUsersForm(),
  });
  const repeatedImport = await jsonResponse(repeatedImportResponse);
  ensure(
    repeatedImportResponse.status === 200 &&
      repeatedImport?.result?.createdCount === 0 &&
      repeatedImport?.result?.errors?.some((item) => item.email === importEmail),
    "Repeating a user CSV import created a duplicate account or did not report the conflict.",
  );
  pass(
    "CSV user import/export, row-level errors, safe repeat, formula escaping, and access control",
  );

  const adminCreate = async (role, username) =>
    api("/api/v1/admin/users", {
      cookie: adminCookie,
      method: "POST",
      body: {
        email: `${username}@kzhexly.test`,
        username,
        role,
        firstName: "E2E",
        lastName: "Account",
        locale: "ru",
      },
    });
  const createdStudent = await adminCreate("STUDENT", `e2estudent${randomUUID().slice(0, 8)}`);
  const createdTeacher = await adminCreate("TEACHER", `e2eteacher${randomUUID().slice(0, 8)}`);
  const adminCannotCreateAdmin = await adminCreate("ADMIN", `e2eadmin${randomUUID().slice(0, 8)}`);
  const adminCannotCreateSuperAdmin = await adminCreate(
    "SUPER_ADMIN",
    `e2esuper${randomUUID().slice(0, 8)}`,
  );
  ensure(
    createdStudent.status === 201 && createdTeacher.status === 201,
    "ADMIN cannot create permitted student/teacher accounts.",
  );
  ensure(
    adminCannotCreateAdmin.status === 403 && adminCannotCreateSuperAdmin.status === 403,
    "ADMIN can create a privileged administrator account.",
  );

  const studentAccount = await jsonResponse(createdStudent);
  const teacherAccount = await jsonResponse(createdTeacher);
  ensure(
    studentAccount?.user?.id &&
      studentAccount?.temporaryPassword &&
      teacherAccount?.user?.id &&
      teacherAccount?.temporaryPassword,
    "The account API did not return temporary credentials for the admin to deliver.",
  );
  const activeGroupsForAssignment = await prisma.studyGroup.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take: 2,
  });
  ensure(activeGroupsForAssignment.length === 2, "The E2E fixture needs two active groups.");
  const [initialGroup, transferGroup] = activeGroupsForAssignment;
  const assignStudentGroup = await api(`/api/v1/admin/users/${studentAccount.user.id}`, {
    cookie: adminCookie,
    method: "PATCH",
    body: { studentGroupId: initialGroup.id, isGroupLeader: true },
  });
  const firstMembership = await prisma.groupMember.findFirst({
    where: { studentId: studentAccount.user.id, groupId: initialGroup.id, leftAt: null },
    select: { isGroupLeader: true },
  });
  ensure(
    assignStudentGroup.status === 200 && firstMembership?.isGroupLeader,
    "ADMIN could not assign a group and group-leader role to a student.",
  );
  const transferStudentGroup = await api(`/api/v1/admin/users/${studentAccount.user.id}`, {
    cookie: adminCookie,
    method: "PATCH",
    body: { studentGroupId: transferGroup.id, isGroupLeader: false },
  });
  const membershipHistory = await prisma.groupMember.findMany({
    where: { studentId: studentAccount.user.id },
    select: { groupId: true, leftAt: true, isGroupLeader: true },
    orderBy: { joinedAt: "asc" },
  });
  ensure(
    transferStudentGroup.status === 200 &&
      membershipHistory.length === 2 &&
      membershipHistory[0].groupId === initialGroup.id &&
      membershipHistory[0].leftAt !== null &&
      membershipHistory[1].groupId === transferGroup.id &&
      membershipHistory[1].leftAt === null &&
      !membershipHistory[1].isGroupLeader,
    "ADMIN could not transfer the student while preserving membership history.",
  );
  const assignNewGroupLeader = await api(`/api/v1/admin/users/${studentAccount.user.id}`, {
    cookie: adminCookie,
    method: "PATCH",
    body: { studentGroupId: transferGroup.id, isGroupLeader: true },
  });
  const removeE2eMembership = await api(`/api/v1/admin/users/${studentAccount.user.id}`, {
    cookie: adminCookie,
    method: "PATCH",
    body: { studentGroupId: null, isGroupLeader: false },
  });
  ensure(
    assignNewGroupLeader.status === 200 && removeE2eMembership.status === 200,
    "ADMIN could not change the group-leader role or remove an E2E group assignment.",
  );
  pass("admin student group assignment, transfer history, and group-leader management");

  const createdStudentSession = await signIn(
    studentAccount.user.username,
    studentAccount.temporaryPassword,
  );
  ensure(
    createdStudentSession.user.mustChangePassword,
    "A newly created student is not required to change the temporary password.",
  );
  const blockStudent = await api(`/api/v1/admin/users/${studentAccount.user.id}`, {
    cookie: adminCookie,
    method: "PATCH",
    body: { status: "BLOCKED" },
  });
  ensure(blockStudent.status === 200, "ADMIN could not block a student account.");
  const blockedSession = await api("/api/v1/auth/me", { cookie: createdStudentSession.cookie });
  const blockedSignIn = await fetch(`${baseUrl}/api/v1/auth/sign-in/username`, {
    method: "POST",
    headers: jsonHeaders(undefined, `192.0.2.${10 + signInNumber++}`),
    body: JSON.stringify({
      username: studentAccount.user.username,
      password: studentAccount.temporaryPassword,
    }),
  });
  ensure(
    blockedSession.status === 401 && blockedSignIn.status === 401,
    "A blocked account kept a session or could sign in.",
  );
  const restoreStudent = await api(`/api/v1/admin/users/${studentAccount.user.id}`, {
    cookie: adminCookie,
    method: "PATCH",
    body: { status: "ACTIVE" },
  });
  ensure(restoreStudent.status === 200, "ADMIN could not reactivate a blocked student account.");
  const activeStudentSession = await signIn(
    studentAccount.user.username,
    studentAccount.temporaryPassword,
  );
  const archiveStudent = await api(`/api/v1/admin/users/${studentAccount.user.id}`, {
    cookie: adminCookie,
    method: "DELETE",
  });
  ensure(archiveStudent.status === 200, "ADMIN could not archive a student account.");
  const archivedSession = await api("/api/v1/auth/me", { cookie: activeStudentSession.cookie });
  ensure(archivedSession.status === 401, "Archiving an account did not revoke its sessions.");

  const initialTeacherSession = await signIn(
    teacherAccount.user.username,
    teacherAccount.temporaryPassword,
  );
  ensure(
    initialTeacherSession.user.mustChangePassword,
    "A newly created teacher is not required to change the temporary password.",
  );
  const passwordReset = await api(`/api/v1/admin/users/${teacherAccount.user.id}/reset-password`, {
    cookie: adminCookie,
    method: "POST",
  });
  const resetResult = await jsonResponse(passwordReset);
  ensure(
    passwordReset.status === 200 &&
      resetResult?.user?.mustChangePassword &&
      resetResult?.temporaryPassword,
    "ADMIN could not reset a teacher password and mark it for replacement.",
  );
  const resetOldSession = await api("/api/v1/auth/me", { cookie: initialTeacherSession.cookie });
  ensure(
    resetOldSession.status === 401,
    "Password reset did not revoke the previous teacher session.",
  );
  const firstLoginSession = await signIn(
    teacherAccount.user.username,
    resetResult.temporaryPassword,
  );
  ensure(
    firstLoginSession.user.mustChangePassword,
    "A reset account can skip its forced password change.",
  );
  const forcedPassword = `E2E-${randomBytes(24).toString("base64url")}!9Z`;
  const forcedChange = await api("/api/v1/auth/change-password", {
    cookie: firstLoginSession.cookie,
    method: "POST",
    body: {
      currentPassword: resetResult.temporaryPassword,
      newPassword: forcedPassword,
      confirmPassword: forcedPassword,
    },
  });
  ensure(forcedChange.status === 200, "The forced first-login password change failed.");
  const forcedOldSession = await api("/api/v1/auth/me", { cookie: firstLoginSession.cookie });
  ensure(
    forcedOldSession.status === 401,
    "The forced password change did not revoke its old session.",
  );
  const teacherAfterForcedChange = await signIn(teacherAccount.user.username, forcedPassword);
  ensure(
    !teacherAfterForcedChange.user.mustChangePassword,
    "The teacher remains forced to change an updated password.",
  );
  await api("/api/v1/auth/sign-out", {
    cookie: teacherAfterForcedChange.cookie,
    method: "POST",
    body: {},
  });
  pass(
    "block, restore, archive, password reset, forced first-login change, and session revocation",
  );

  const rootCookie = sessions.get("superadmin").cookie;
  const rootCreateAdmin = await api("/api/v1/admin/users", {
    cookie: rootCookie,
    method: "POST",
    body: {
      email: `e2e-root-admin-${randomUUID()}@kzhexly.test`,
      username: `e2eroot${randomUUID().slice(0, 8)}`,
      role: "ADMIN",
      firstName: "E2E",
      lastName: "Administrator",
      locale: "ru",
    },
  });
  const rootAdminResult = await jsonResponse(rootCreateAdmin);
  ensure(
    rootCreateAdmin.status === 201 && rootAdminResult?.user?.id,
    "SUPER_ADMIN cannot create an ADMIN account.",
  );

  const adminCannotEditAdmin = await api(`/api/v1/admin/users/${rootAdminResult.user.id}`, {
    cookie: adminCookie,
    method: "PATCH",
    body: { status: "BLOCKED" },
  });
  const adminCannotDeleteAdmin = await api(`/api/v1/admin/users/${rootAdminResult.user.id}`, {
    cookie: adminCookie,
    method: "DELETE",
  });
  ensure(
    adminCannotEditAdmin.status === 403 && adminCannotDeleteAdmin.status === 403,
    "ADMIN can edit or archive another administrator account.",
  );

  const superAdminId = sessions.get("superadmin").user.id;
  const adminCannotEditSuperAdmin = await api(`/api/v1/admin/users/${superAdminId}`, {
    cookie: adminCookie,
    method: "PATCH",
    body: { status: "BLOCKED" },
  });
  const rootCannotDisableLastAdmin = await api(`/api/v1/admin/users/${superAdminId}`, {
    cookie: rootCookie,
    method: "PATCH",
    body: { status: "BLOCKED" },
  });
  ensure(adminCannotEditSuperAdmin.status === 403, "ADMIN can modify a SUPER_ADMIN account.");
  ensure(rootCannotDisableLastAdmin.status === 409, "The last active SUPER_ADMIN can be disabled.");

  const concurrentRootUsername = `e2erace${randomUUID().slice(0, 8)}`;
  const concurrentRootResponse = await api("/api/v1/admin/users", {
    cookie: rootCookie,
    method: "POST",
    body: {
      email: `e2e-concurrent-root-${randomUUID()}@kzhexly.test`,
      username: concurrentRootUsername,
      role: "SUPER_ADMIN",
      firstName: "E2E",
      lastName: "Concurrent Administrator",
      locale: "ru",
    },
  });
  const concurrentRootAccount = await jsonResponse(concurrentRootResponse);
  ensure(
    concurrentRootResponse.status === 201 &&
      concurrentRootAccount?.user?.id &&
      concurrentRootAccount.temporaryPassword,
    "SUPER_ADMIN could not create a disposable second SUPER_ADMIN for the concurrency check.",
  );
  const concurrentRootSession = await signIn(
    concurrentRootUsername,
    concurrentRootAccount.temporaryPassword,
  );
  const concurrentRootPassword = `E2E-${randomBytes(24).toString("base64url")}!9Z`;
  const concurrentRootPasswordChange = await api("/api/v1/auth/change-password", {
    cookie: concurrentRootSession.cookie,
    method: "POST",
    body: {
      currentPassword: concurrentRootAccount.temporaryPassword,
      newPassword: concurrentRootPassword,
      confirmPassword: concurrentRootPassword,
    },
  });
  ensure(
    concurrentRootPasswordChange.status === 200,
    "The temporary concurrent SUPER_ADMIN could not complete first-login password change.",
  );
  const authenticatedConcurrentRoot = await signIn(concurrentRootUsername, concurrentRootPassword);
  const [disableFirstRoot, disableSecondRoot] = await Promise.all([
    api(`/api/v1/admin/users/${superAdminId}`, {
      cookie: rootCookie,
      method: "PATCH",
      body: { status: "BLOCKED" },
    }),
    api(`/api/v1/admin/users/${concurrentRootAccount.user.id}`, {
      cookie: authenticatedConcurrentRoot.cookie,
      method: "PATCH",
      body: { status: "BLOCKED" },
    }),
  ]);
  const activeRootCount = await prisma.user.count({
    where: { role: "SUPER_ADMIN", status: "ACTIVE", deletedAt: null },
  });
  ensure(
    ((disableFirstRoot.status === 200 && disableSecondRoot.status === 409) ||
      (disableFirstRoot.status === 409 && disableSecondRoot.status === 200)) &&
      activeRootCount === 1,
    `Concurrent changes to the last SUPER_ADMIN were unsafe (HTTP ${disableFirstRoot.status}/${disableSecondRoot.status}, active=${activeRootCount}).`,
  );
  pass(
    "user creation, administrator management restrictions, last-SUPER_ADMIN protection, and concurrent race prevention",
  );

  const auditResponse = await api("/api/v1/admin/audit?perPage=100", { cookie: adminCookie });
  const auditResult = await jsonResponse(auditResponse);
  ensure(
    auditResponse.status === 200 &&
      auditResult?.items?.some((item) => item.action === "user.created") &&
      auditResult.items.some((item) => item.action === "user.password_reset") &&
      auditResult.items.some((item) => item.action === "user.updated") &&
      auditResult.items.some((item) => item.action === "user.locale.updated"),
    "Admin audit log did not record the user lifecycle events.",
  );
  pass("sensitive account lifecycle actions are visible in the audit log");

  const countBeforePasswordChange = await prisma.user.count();
  const changedPassword = `E2E-${randomBytes(24).toString("base64url")}!9Z`;
  const student05 = sessions.get("student05");
  const passwordChange = await api("/api/v1/auth/change-password", {
    cookie: student05.cookie,
    method: "POST",
    body: {
      currentPassword: testPassword,
      newPassword: changedPassword,
      confirmPassword: changedPassword,
    },
  });
  const changeResult = await jsonResponse(passwordChange);
  ensure(
    passwordChange.status === 200 && changeResult?.changed && changeResult?.sessionsRevoked,
    "Password change failed or did not revoke sessions.",
  );
  const oldSession = await api("/api/v1/auth/me", { cookie: student05.cookie });
  ensure(oldSession.status === 401, "The previous session remains active after a password change.");
  const newSession = await signIn("student05", changedPassword);
  ensure(newSession.user.role === "STUDENT", "The new password cannot sign in.");
  const newSessionMe = await api("/api/v1/auth/me", { cookie: newSession.cookie });
  ensure(newSessionMe.status === 200, "The replacement session is invalid.");
  pass("password change revokes the old session and allows a new sign-in");

  const activeRoot = await prisma.user.findFirst({
    where: { role: "SUPER_ADMIN", status: "ACTIVE", deletedAt: null },
    select: { username: true },
  });
  ensure(activeRoot?.username, "The E2E fixture has no active SUPER_ADMIN for rate-limit checks.");
  const activeRootPassword =
    activeRoot.username === concurrentRootUsername ? concurrentRootPassword : testPassword;
  const activeRootSession = await signIn(activeRoot.username, activeRootPassword);
  const resetRateStatuses = [];
  for (let attempt = 0; attempt < 13; attempt += 1) {
    const response = await api(`/api/v1/admin/users/${randomUUID()}/reset-password`, {
      cookie: activeRootSession.cookie,
      method: "POST",
    });
    resetRateStatuses.push(response.status);
  }
  ensure(
    resetRateStatuses.slice(0, 12).every((status) => status === 404) &&
      resetRateStatuses[12] === 429,
    "The administrator password reset endpoint did not enforce its request limit.",
  );

  const uploadRateStatuses = [];
  for (let attempt = 0; attempt < 31; attempt += 1) {
    const response = await api("/api/v1/files/presign", {
      cookie: newSession.cookie,
      method: "POST",
      body: {},
    });
    uploadRateStatuses.push(response.status);
  }
  ensure(
    uploadRateStatuses.slice(0, 30).every((status) => status === 422) &&
      uploadRateStatuses[30] === 429,
    "The file upload endpoint did not enforce its request limit.",
  );
  pass("per-account rate limits protect password reset and file upload endpoints");

  for (const session of sessions.values()) {
    await api("/api/v1/auth/sign-out", { cookie: session.cookie, method: "POST", body: {} });
  }
  await api("/api/v1/auth/sign-out", { cookie: newSession.cookie, method: "POST", body: {} });
  await api("/api/v1/auth/sign-out", {
    cookie: activeRootSession.cookie,
    method: "POST",
    body: {},
  });
  ensure(
    (await prisma.user.count()) >= countBeforePasswordChange,
    "The account workflow unexpectedly removed a user.",
  );
  console.info(
    "PASS local API smoke checks completed without changing the primary development database",
  );
} catch (error) {
  if (error instanceof E2EAxeOnlyComplete) {
    pass("stopped after the optional accessibility audit");
  } else {
    console.error(
      `${error instanceof Error ? error.message : String(error)}\n${serverError}\n${serverOutput.slice(-5000)}`,
    );
    process.exitCode = 1;
  }
} finally {
  if (storageClient) {
    await Promise.all(
      uploadedObjects.map((object) =>
        storageClient
          .send(new DeleteObjectCommand({ Bucket: object.bucket, Key: object.storageKey }))
          .catch(() => undefined),
      ),
    );
  }
  await prisma.$disconnect();
  storageClient?.destroy();
  await stopServer();
  await smtpFixture.close();
}
