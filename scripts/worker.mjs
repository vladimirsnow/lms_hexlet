import "dotenv/config";
import { DeleteObjectCommand, GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import pino from "pino";
import { PgBoss } from "pg-boss";
import { Pool } from "pg";
import { scanStream } from "./clamav-scanner.mjs";
import { createSmtpTransport } from "./smtp-mailer.mjs";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });
const connectionString =
  process.env.WORKER_DATABASE_URL ?? process.env.DIRECT_URL ?? process.env.DATABASE_URL;

if (!connectionString) {
  logger.fatal("DATABASE_URL is required to start the worker");
  process.exit(1);
}

const boss = new PgBoss(connectionString);
const database = new Pool({ connectionString, max: 4, idleTimeoutMillis: 30_000 });
const reminderQueue = "assignment-deadline-reminders";
const reminderCron = process.env.DEADLINE_REMINDER_CRON ?? "*/15 * * * *";
const fileScanQueue = "file-virus-scans";
const fileScanCron = process.env.FILE_SCAN_CRON ?? "* * * * *";
const pendingFileCleanupQueue = "pending-file-cleanup";
const pendingFileCleanupCron = process.env.PENDING_FILE_CLEANUP_CRON ?? "*/15 * * * *";
const pendingFileCleanupAgeHours = Number(process.env.PENDING_FILE_CLEANUP_AGE_HOURS ?? 24);
const emailOutboxQueue = "email-outbox-delivery";
const emailOutboxCron = process.env.EMAIL_OUTBOX_CRON ?? "* * * * *";
const emailOutboxBatchSize = 10;
const emailOutboxMaxAttempts = 5;
let stopping = false;

const minioEndpoint = process.env.S3_ENDPOINT ?? process.env.MINIO_ENDPOINT;
const minioAccessKey = process.env.S3_ACCESS_KEY ?? process.env.MINIO_ACCESS_KEY;
const minioSecretKey = process.env.S3_SECRET_KEY ?? process.env.MINIO_SECRET_KEY;
const minioBucket = process.env.S3_BUCKET ?? process.env.MINIO_BUCKET;
const minioRegion = process.env.S3_REGION ?? "us-east-1";
const maxUploadBytes = Number(process.env.UPLOAD_MAX_MB ?? 100) * 1024 * 1024;
const clamavHost = process.env.CLAMAV_HOST ?? "127.0.0.1";
const clamavPort = Number(process.env.CLAMAV_PORT ?? 3310);
const clamavTimeoutMs = Number(process.env.CLAMAV_SCAN_TIMEOUT_MS ?? 900_000);
let emailMailer;

try {
  emailMailer = createSmtpTransport(process.env);
} catch {
  logger.fatal("Invalid SMTP configuration; check SMTP_HOST, SMTP_FROM, and paired credentials.");
  process.exit(1);
}

if (!minioEndpoint || !minioAccessKey || !minioSecretKey || !minioBucket) {
  logger.fatal(
    "S3 endpoint, access key, secret key, and bucket settings are required to start the worker",
  );
  process.exit(1);
}
if (
  !Number.isInteger(clamavPort) ||
  clamavPort < 1 ||
  clamavPort > 65535 ||
  !Number.isSafeInteger(maxUploadBytes) ||
  maxUploadBytes < 1 ||
  !Number.isFinite(pendingFileCleanupAgeHours) ||
  pendingFileCleanupAgeHours <= 0
) {
  logger.fatal("Invalid ClamAV port, upload size limit, or pending file cleanup age");
  process.exit(1);
}

const minioProtocol =
  (process.env.S3_USE_SSL ?? process.env.MINIO_USE_SSL) === "true" ? "https" : "http";
const storage = new S3Client({
  endpoint: `${minioProtocol}://${minioEndpoint}`,
  region: minioRegion,
  forcePathStyle: true,
  credentials: { accessKeyId: minioAccessKey, secretAccessKey: minioSecretKey },
});

boss.on("error", (error) => {
  logger.error({ errorType: error instanceof Error ? error.name : "UnknownError" }, "Queue error");
});

await boss.start();
await boss.createQueue(reminderQueue);
await boss.createQueue(fileScanQueue);
await boss.createQueue(pendingFileCleanupQueue);
await boss.work(reminderQueue, { localConcurrency: 1 }, async () => {
  const result = await database.query(
    `WITH created_notifications AS (
       INSERT INTO notifications (
         id, user_id, type, title, body, link, data_json, dedupe_key, created_at
       )
       SELECT
         gen_random_uuid(), e.student_id, 'ASSIGNMENT_DEADLINE', 'Скоро срок сдачи',
         a.title || ' — срок сдачи в течение суток', '/assignments/' || a.id::text,
         jsonb_build_object('assignmentId', a.id, 'dueAt', a.due_at),
         'assignment:' || a.id::text || ':deadline-24h', NOW()
       FROM assignments a
       JOIN enrollments e ON e.course_id = a.course_id AND e.status = 'ACTIVE'
       JOIN users u ON u.id = e.student_id AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
       WHERE a.status = 'PUBLISHED'
         AND a.deleted_at IS NULL
         AND a.due_at > NOW()
         AND a.due_at <= NOW() + INTERVAL '24 hours'
         AND NOT EXISTS (
           SELECT 1 FROM submissions s
           WHERE s.assignment_id = a.id
             AND s.student_id = e.student_id
             AND s.status IN ('SUBMITTED', 'GRADED')
         )
       ON CONFLICT (user_id, dedupe_key) DO NOTHING
       RETURNING user_id, title, body, link, dedupe_key
     ), queued_emails AS (
       INSERT INTO email_outbox (
         id, to_email, subject, body, status, attempts, scheduled_at,
         dedupe_key, created_at, updated_at
       )
       SELECT
         gen_random_uuid(), u.email, LEFT('Хекслет Колледжі: ' || n.title, 998),
         n.body || E'\\n\\nОткрыть: ' || $2::text || n.link,
         'PENDING', 0, NOW(), LEFT(n.dedupe_key || ':email:' || n.user_id::text, 250), NOW(), NOW()
       FROM created_notifications n
       JOIN users u ON u.id = n.user_id
       WHERE $1::boolean
       ON CONFLICT (dedupe_key) DO NOTHING
       RETURNING id
     )
     SELECT
       (SELECT COUNT(*)::int FROM created_notifications) AS notifications_created,
       (SELECT COUNT(*)::int FROM queued_emails) AS emails_queued`,
    [Boolean(emailMailer), process.env.APP_URL ?? "http://127.0.0.1:3000"],
  );
  logger.info(
    {
      created: result.rows[0]?.notifications_created ?? 0,
      emailsQueued: result.rows[0]?.emails_queued ?? 0,
    },
    "Assignment deadline reminder run completed",
  );
});
await boss.schedule(reminderQueue, reminderCron, {}, { tz: "Asia/Almaty", missed: "once" });

async function claimEmailOutboxBatch() {
  const connection = await database.connect();
  try {
    await connection.query("BEGIN");
    await connection.query(
      `UPDATE email_outbox
       SET status = 'FAILED', locked_at = NULL, last_error = 'delivery_timeout', updated_at = NOW()
       WHERE status = 'PROCESSING'
         AND locked_at < NOW() - INTERVAL '15 minutes'
         AND attempts >= $1`,
      [emailOutboxMaxAttempts],
    );
    const selected = await connection.query(
      `SELECT id
       FROM email_outbox
       WHERE (status = 'PENDING' AND scheduled_at <= NOW() AND attempts < $1)
          OR (status = 'PROCESSING' AND locked_at < NOW() - INTERVAL '15 minutes' AND attempts < $1)
       ORDER BY scheduled_at ASC, created_at ASC
       LIMIT $2
       FOR UPDATE SKIP LOCKED`,
      [emailOutboxMaxAttempts, emailOutboxBatchSize],
    );
    const ids = selected.rows.map((row) => row.id);
    if (!ids.length) {
      await connection.query("COMMIT");
      return [];
    }
    const claimed = await connection.query(
      `UPDATE email_outbox
       SET status = 'PROCESSING', attempts = attempts + 1, locked_at = NOW(),
           last_error = NULL, updated_at = NOW()
       WHERE id = ANY($1::uuid[])
       RETURNING id, to_email, subject, body, attempts`,
      [ids],
    );
    await connection.query("COMMIT");
    return claimed.rows;
  } catch (error) {
    await connection.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
}

async function deliverEmailOutboxBatch() {
  const messages = await claimEmailOutboxBatch();
  let sent = 0;
  for (const message of messages) {
    try {
      await emailMailer.transport.sendMail({
        from: emailMailer.from,
        to: message.to_email,
        subject: message.subject,
        text: message.body,
      });
      await database.query(
        `UPDATE email_outbox
         SET status = 'SENT', sent_at = NOW(), locked_at = NULL,
             last_error = NULL, updated_at = NOW()
         WHERE id = $1 AND status = 'PROCESSING'`,
        [message.id],
      );
      sent += 1;
    } catch (error) {
      const code = error?.code;
      const errorType =
        typeof code === "string" && /^[A-Za-z0-9_]{1,80}$/.test(code)
          ? code
          : error instanceof Error
            ? error.name
            : "UnknownError";
      const retryDelayMinutes = Math.min(60, 2 ** Math.max(0, message.attempts - 1));
      const status = message.attempts >= emailOutboxMaxAttempts ? "FAILED" : "PENDING";
      await database.query(
        `UPDATE email_outbox
         SET status = $2::"EmailOutboxStatus",
             scheduled_at = NOW() + ($3::double precision * INTERVAL '1 minute'),
             last_error = $4, locked_at = NULL, updated_at = NOW()
         WHERE id = $1 AND status = 'PROCESSING'`,
        [message.id, status, retryDelayMinutes, errorType],
      );
      logger.warn(
        { outboxId: message.id, attempt: message.attempts, errorType },
        "Email delivery failed",
      );
    }
  }
  if (messages.length) {
    logger.info({ claimed: messages.length, sent }, "Email outbox batch completed");
  }
}

if (emailMailer) {
  await boss.createQueue(emailOutboxQueue);
  await boss.work(emailOutboxQueue, { localConcurrency: 1 }, deliverEmailOutboxBatch);
  await boss.schedule(emailOutboxQueue, emailOutboxCron, {}, { tz: "Asia/Almaty", missed: "once" });
}

await boss.work(fileScanQueue, { localConcurrency: 1 }, async () => {
  const pendingFiles = await database.query(`
    SELECT id, bucket, storage_key, size_bytes
    FROM files
    WHERE upload_status = 'READY'
      AND virus_scan_status = 'PENDING'
      AND deleted_at IS NULL
    ORDER BY created_at ASC
    LIMIT 8
  `);

  for (const file of pendingFiles.rows) {
    const connection = await database.connect();
    let locked = false;
    try {
      const lock = await connection.query(
        "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired",
        [file.id],
      );
      locked = lock.rows[0]?.acquired === true;
      if (!locked) continue;

      const current = await connection.query(
        `SELECT id, bucket, storage_key, size_bytes
         FROM files
         WHERE id = $1 AND upload_status = 'READY'
           AND virus_scan_status = 'PENDING' AND deleted_at IS NULL`,
        [file.id],
      );
      if (!current.rowCount) continue;

      const currentFile = current.rows[0];
      const sizeBytes = Number(currentFile.size_bytes);
      if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > maxUploadBytes) {
        throw new Error("FILE_SIZE_OUTSIDE_SCAN_LIMIT");
      }

      const object = await storage.send(
        new GetObjectCommand({
          Bucket: currentFile.bucket,
          Key: currentFile.storage_key,
        }),
      );
      if (!object.Body) throw new Error("STORAGE_READ_FAILED");

      const result = await scanStream(object.Body, {
        host: clamavHost,
        port: clamavPort,
        expectedBytes: sizeBytes,
        maxBytes: maxUploadBytes,
        timeoutMs: clamavTimeoutMs,
      });

      await connection.query("BEGIN");
      const status = result.clean ? "CLEAN" : "INFECTED";
      const uploadStatus = result.clean ? "READY" : "REJECTED";
      const update = await connection.query(
        `UPDATE files
         SET virus_scan_status = $2::"VirusScanStatus",
             upload_status = $3::"FileUploadStatus",
             scanned_at = NOW()
         WHERE id = $1 AND virus_scan_status = 'PENDING' AND deleted_at IS NULL`,
        [currentFile.id, status, uploadStatus],
      );
      if (update.rowCount) {
        await connection.query(
          `INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, after_json, created_at)
           VALUES (gen_random_uuid(), NULL, $1, 'FILE', $2, $3::jsonb, NOW())`,
          [
            result.clean ? "file.virus_scan.clean" : "file.virus_scan.infected",
            currentFile.id,
            JSON.stringify({ status, scanner: "clamav", result: result.result }),
          ],
        );
      }
      await connection.query("COMMIT");

      if (!result.clean && update.rowCount) {
        await storage.send(
          new DeleteObjectCommand({ Bucket: currentFile.bucket, Key: currentFile.storage_key }),
        );
        logger.warn(
          { fileId: currentFile.id, scanResult: result.result },
          "Infected upload rejected and removed from storage",
        );
      } else if (update.rowCount) {
        logger.info({ fileId: currentFile.id }, "File passed ClamAV scan");
      }
    } catch (error) {
      await connection.query("ROLLBACK").catch(() => undefined);
      logger.warn(
        { fileId: file.id, errorType: error instanceof Error ? error.message : "UnknownError" },
        "ClamAV scan did not complete; file remains unavailable",
      );
    } finally {
      if (locked) {
        await connection
          .query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [file.id])
          .catch(() => undefined);
      }
      connection.release();
    }
  }
});
await boss.schedule(fileScanQueue, fileScanCron, {}, { tz: "Asia/Almaty", missed: "once" });

await boss.work(pendingFileCleanupQueue, { localConcurrency: 1 }, async () => {
  const expiredFiles = await database.query(
    `
    SELECT id, bucket, storage_key, upload_status
    FROM files
    WHERE deleted_at IS NULL
      AND scanned_at IS NULL
      AND created_at < NOW() - ($1::double precision * INTERVAL '1 hour')
      AND upload_status IN ('PENDING', 'REJECTED')
    ORDER BY created_at ASC
    LIMIT 25
  `,
    [pendingFileCleanupAgeHours],
  );

  for (const file of expiredFiles.rows) {
    if (file.upload_status === "PENDING") {
      const rejected = await database.query(
        `WITH expired AS (
           UPDATE files
           SET upload_status = 'REJECTED'
           WHERE id = $1
             AND upload_status = 'PENDING'
             AND deleted_at IS NULL
             AND scanned_at IS NULL
             AND created_at < NOW() - ($2::double precision * INTERVAL '1 hour')
           RETURNING id
         )
         INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, after_json, created_at)
         SELECT gen_random_uuid(), NULL, 'file.upload.expired', 'StoredFile', id,
                '{"reason":"INCOMPLETE_UPLOAD"}'::jsonb, NOW()
         FROM expired
         RETURNING entity_id`,
        [file.id, pendingFileCleanupAgeHours],
      );
      if (!rejected.rowCount) continue;
    }

    try {
      await storage.send(new DeleteObjectCommand({ Bucket: file.bucket, Key: file.storage_key }));
      await database.query(
        `UPDATE files
         SET deleted_at = NOW()
         WHERE id = $1 AND upload_status = 'REJECTED'
           AND scanned_at IS NULL AND deleted_at IS NULL`,
        [file.id],
      );
      logger.info({ fileId: file.id }, "Expired upload removed from storage");
    } catch (error) {
      logger.warn(
        { fileId: file.id, errorType: error instanceof Error ? error.name : "UnknownError" },
        "Expired upload cleanup will retry",
      );
    }
  }
});
await boss.schedule(
  pendingFileCleanupQueue,
  pendingFileCleanupCron,
  {},
  { tz: "Asia/Almaty", missed: "once" },
);
logger.info({ emailEnabled: Boolean(emailMailer) }, "Background worker is ready");

async function stop(signal) {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, "Stopping background worker");
  await boss.stop({ graceful: true, timeout: 10_000 });
  await database.end();
  storage.destroy();
  emailMailer?.transport.close();
}

process.once("SIGINT", () => void stop("SIGINT"));
process.once("SIGTERM", () => void stop("SIGTERM"));
