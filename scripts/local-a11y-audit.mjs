import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";

const axeSource = readFileSync(path.resolve("node_modules/axe-core/axe.min.js"), "utf8");

function edgeExecutable() {
  const candidates = [
    process.env.E2E_EDGE_PATH,
    process.env["ProgramFiles(x86)"] &&
      path.join(process.env["ProgramFiles(x86)"], "Microsoft/Edge/Application/msedge.exe"),
    process.env.ProgramFiles &&
      path.join(process.env.ProgramFiles, "Microsoft/Edge/Application/msedge.exe"),
  ].filter(Boolean);
  const executable = candidates.find((candidate) => existsSync(candidate));
  if (!executable) {
    throw new Error("Set E2E_EDGE_PATH or install Microsoft Edge to run the optional axe audit.");
  }
  return executable;
}

async function startBrowser() {
  const profile = await mkdtemp(path.join(os.tmpdir(), "kzhexly-a11y-"));
  const debugPort = await new Promise((resolve, reject) => {
    const listener = createServer();
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const address = listener.address();
      listener.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
  const psLiteral = (value) => `'${String(value).replaceAll("'", "''")}'`;
  const browserArguments = [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${debugPort}`,
    "--remote-allow-origins=*",
    `--user-data-dir=\"${profile}\"`,
    "about:blank",
  ];
  const powershell = [
    `$edge=${psLiteral(edgeExecutable())}`,
    `$arguments=@(${browserArguments.map(psLiteral).join(",")})`,
    "$process=Start-Process -FilePath $edge -ArgumentList $arguments -WindowStyle Hidden -PassThru",
    "[Console]::Out.Write($process.Id)",
  ].join("; ");
  let browserPid;

  try {
    const started = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(powershell, "utf16le").toString("base64"),
      ],
      { encoding: "utf8", timeout: 20_000, windowsHide: true },
    );
    if (started.error) throw started.error;
    browserPid = Number(started.stdout.trim());
    if (started.status !== 0 || !Number.isInteger(browserPid) || browserPid < 1) {
      throw new Error(`Could not start headless Edge: ${started.stderr || started.stdout}`);
    }

    let page;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      try {
        const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
        if (response.ok) {
          const targets = await response.json();
          page = targets.find((target) => target.type === "page");
          if (page) break;
        }
      } catch {
        // Edge can take several seconds to open its local DevTools endpoint.
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!page) throw new Error("Headless Edge did not expose its DevTools page target.");

    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", reject, { once: true });
    });

    let nextId = 0;
    const pending = new Map();
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id || !pending.has(message.id)) return;
      const request = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    });
    const send = (method, params = {}, timeoutMs = 45_000) =>
      new Promise((resolve, reject) => {
        const id = ++nextId;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Timed out waiting for CDP command ${method}.`));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        ws.send(JSON.stringify({ id, method, params }));
      });

    await Promise.all([send("Page.enable"), send("Runtime.enable"), send("Network.enable")]);
    await send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    return { browserPid, debugPort, profile, send, ws };
  } catch (error) {
    await stopBrowser(browserPid, profile, debugPort);
    throw error;
  }
}

async function stopBrowser(browserPid, profile, debugPort) {
  if (browserPid && process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", String(browserPid), "/T", "/F"], {
      encoding: "utf8",
      timeout: 20_000,
      windowsHide: true,
    });
  } else if (browserPid) {
    spawnSync("kill", ["-TERM", String(browserPid)], {
      encoding: "utf8",
      timeout: 5_000,
    });
  }

  if (debugPort) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        await fetch(`http://127.0.0.1:${debugPort}/json/version`, {
          signal: AbortSignal.timeout(500),
        });
        await new Promise((resolve) => setTimeout(resolve, 250));
      } catch {
        break;
      }
    }
  }

  if (profile) {
    const tempRoot = `${path.resolve(os.tmpdir())}${path.sep}`;
    const resolvedProfile = path.resolve(profile);
    if (!resolvedProfile.startsWith(tempRoot)) {
      throw new Error("Refusing to remove an Edge profile outside the system temp directory.");
    }
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        await rm(resolvedProfile, { recursive: true, force: true });
        break;
      } catch (error) {
        if (!error || !["EBUSY", "ENOTEMPTY", "EPERM"].includes(error.code) || attempt === 39) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
  }
}

function cookiePairs(header) {
  return header
    .split(/;\s*/)
    .filter(Boolean)
    .map((pair) => {
      const separator = pair.indexOf("=");
      if (separator < 1) throw new Error("An E2E session cookie has an invalid name/value pair.");
      return { name: pair.slice(0, separator), value: pair.slice(separator + 1) };
    });
}

async function waitForPageReady(browser, timeoutMs = 85_000) {
  const started = Date.now();
  let stableChecks = 0;
  let latest = { settled: false, loadingText: false, ariaBusy: false };

  while (Date.now() - started < timeoutMs) {
    try {
      const result = await browser.send("Runtime.evaluate", {
        expression: `(()=>{const text=document.body?.innerText??'';const loadingText=/Загружа(?:ю|ем)|Loading|Жүктелуде/i.test(text);const ariaBusy=Boolean(document.querySelector('[aria-busy="true"]'));const hasAppContent=Boolean(document.querySelector('.app-page-wrap,.auth-page'));return {loadingText,ariaBusy,loading:loadingText||(ariaBusy&&!hasAppContent)}})()`,
        returnByValue: true,
      });
      const state = result.result?.value;
      if (!state) {
        stableChecks = 0;
      } else {
        latest = { settled: false, loadingText: state.loadingText, ariaBusy: state.ariaBusy };
        stableChecks = state.loading ? 0 : stableChecks + 1;
        if (stableChecks >= 3) return { ...latest, settled: true };
      }
    } catch (error) {
      if (!String(error?.message).includes("Inspected target navigated or closed")) throw error;
      stableChecks = 0;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return latest;
}

async function waitForBrowserPath(browser, expectedPath, timeoutMs = 20_000) {
  const started = Date.now();
  let stableChecks = 0;

  while (Date.now() - started < timeoutMs) {
    try {
      const result = await browser.send("Runtime.evaluate", {
        expression: "({path:location.pathname,ready:document.readyState})",
        returnByValue: true,
      });
      const page = result.result?.value;
      const documentStarted = page?.ready === "interactive" || page?.ready === "complete";
      stableChecks = page?.path === expectedPath && documentStarted ? stableChecks + 1 : 0;
      if (stableChecks >= 2) return expectedPath;
    } catch (error) {
      if (!String(error?.message).includes("Inspected target navigated or closed")) throw error;
      stableChecks = 0;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return null;
}

async function navigateBrowserToPath(browser, url, expectedPath, timeoutMs = 45_000) {
  const navigation = await browser.send("Page.navigate", { url });
  if (navigation.errorText)
    throw new Error(`Could not navigate to ${expectedPath}: ${navigation.errorText}`);

  const path = await waitForBrowserPath(browser, expectedPath, timeoutMs);
  if (!path) throw new Error(`The browser did not finish loading ${expectedPath}.`);
}

async function waitForAuthenticatedBrowserSession(browser, expectedRole, timeoutMs = 20_000) {
  const started = Date.now();
  let stablePath = null;
  let stableChecks = 0;

  while (Date.now() - started < timeoutMs) {
    try {
      const pathResult = await browser.send("Runtime.evaluate", {
        expression: "location.pathname",
        returnByValue: true,
      });
      const pathname = pathResult.result?.value;
      if (typeof pathname === "string" && pathname !== "/login") {
        stableChecks = pathname === stablePath ? stableChecks + 1 : 1;
        stablePath = pathname;

        if (stableChecks >= 3) {
          const sessionResult = await browser.send("Runtime.evaluate", {
            expression: `fetch('/api/v1/auth/me',{cache:'no-store'}).then(async response=>{const body=await response.json().catch(()=>({}));return {path:location.pathname,status:response.status,role:body.user?.role}})`,
            awaitPromise: true,
            returnByValue: true,
            timeout: 10_000,
          });
          const session = sessionResult.result?.value;
          if (session?.status === 200 && session.role === expectedRole) return session;
        }
      } else {
        stablePath = null;
        stableChecks = 0;
      }
    } catch (error) {
      if (!String(error?.message).includes("Inspected target navigated or closed")) throw error;
      stablePath = null;
      stableChecks = 0;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return null;
}

async function waitForBrowserSelector(browser, selector, timeoutMs = 15_000) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    try {
      const result = await browser.send("Runtime.evaluate", {
        expression: `Boolean(document.querySelector(${JSON.stringify(selector)}))`,
        returnByValue: true,
      });
      if (result.result?.value === true) return true;
    } catch (error) {
      if (!String(error?.message).includes("Inspected target navigated or closed")) throw error;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return false;
}

export async function auditRolePages({ baseUrl, sessions, outputDirectory, loginCredentials }) {
  const mobileViewportWidth = Number(process.env.E2E_AXE_MOBILE_WIDTH ?? 390);
  if (
    !Number.isInteger(mobileViewportWidth) ||
    mobileViewportWidth < 320 ||
    mobileViewportWidth > 1024
  ) {
    throw new Error("E2E_AXE_MOBILE_WIDTH must be an integer between 320 and 1024.");
  }
  const browser = await startBrowser();
  const allRoutes =
    process.env.E2E_AXE_LOGIN_ONLY === "true"
      ? []
      : [
          { role: "SUPER_ADMIN", username: "superadmin", path: "/admin" },
          { role: "ADMIN", username: "admin01", path: "/admin/users" },
          { role: "ADMIN", username: "admin01", path: "/admin/academic" },
          { role: "ADMIN", username: "admin01", path: "/admin/audit" },
          { role: "TEACHER", username: "teacher01", path: "/teacher" },
          { role: "TEACHER", username: "teacher01", path: "/courses/demo-algorithms-2026" },
          { role: "TEACHER", username: "teacher01", path: "/schedule" },
          { role: "TEACHER", username: "teacher01", path: "/announcements" },
          { role: "TEACHER", username: "teacher01", path: "/notifications" },
          { role: "STUDENT", username: "student01", path: "/student" },
          { role: "STUDENT", username: "student01", path: "/courses/demo-algorithms-2026" },
          { role: "STUDENT", username: "student01", path: "/student/grades" },
          { role: "STUDENT", username: "student01", path: "/schedule" },
          { role: "STUDENT", username: "student01", path: "/announcements" },
          { role: "STUDENT", username: "student01", path: "/notifications" },
        ];
  const routeFilter = process.env.E2E_AXE_ROUTE_ONLY;
  const routes = routeFilter ? allRoutes.filter((route) => route.path === routeFilter) : allRoutes;
  if (routeFilter && routes.length === 0)
    throw new Error(`Unknown E2E_AXE_ROUTE_ONLY: ${routeFilter}`);
  const reports = [];

  try {
    if (outputDirectory) await mkdir(outputDirectory, { recursive: true });

    for (const route of routes) {
      const session = sessions.get(route.username);
      if (!session?.cookie) throw new Error(`No active E2E session for ${route.username}.`);
      await browser.send("Network.clearBrowserCookies");
      for (const cookie of cookiePairs(session.cookie)) {
        const result = await browser.send("Network.setCookie", {
          ...cookie,
          url: baseUrl,
          path: "/",
          httpOnly: true,
        });
        if (result.success === false)
          throw new Error(`Could not set ${route.role} test session cookie.`);
      }

      await navigateBrowserToPath(browser, new URL(route.path, baseUrl).toString(), route.path);
      const desktopReadiness = await waitForPageReady(browser);
      if (!desktopReadiness.settled) {
        throw new Error(
          `${route.role} route ${route.path} did not finish loading on desktop (loadingText=${desktopReadiness.loadingText}, ariaBusy=${desktopReadiness.ariaBusy}).`,
        );
      }
      const expression = `${axeSource};window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','best-practice']}}).then(r=>({url:location.pathname,title:document.title,violations:r.violations.map(v=>({id:v.id,impact:v.impact,help:v.help,nodes:v.nodes.slice(0,10).map(n=>({target:n.target,html:n.html.slice(0,240),summary:n.failureSummary}))})),incomplete:r.incomplete.map(v=>({id:v.id,nodes:v.nodes.slice(0,5).map(n=>({target:n.target,html:n.html.slice(0,240)}))})),passes:r.passes.length}))`;
      const evaluated = await browser.send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
        timeout: 40_000,
      });
      if (evaluated.exceptionDetails) {
        throw new Error(evaluated.exceptionDetails.text ?? "axe-core evaluation failed.");
      }
      const report = {
        role: route.role,
        username: route.username,
        expectedPath: route.path,
        viewport: "desktop",
        dataSettled: desktopReadiness.settled,
        ...evaluated.result.value,
      };
      if (report.url !== route.path) {
        throw new Error(`${route.role} route ${route.path} redirected to ${report.url}.`);
      }
      reports.push(report);

      if (
        outputDirectory &&
        ["/admin", "/admin/users", "/admin/academic", "/teacher", "/student"].includes(route.path)
      ) {
        const screenshot = await browser.send("Page.captureScreenshot", {
          format: "png",
          captureBeyondViewport: true,
        });
        const routeName = route.path.slice(1).replaceAll("/", "-") || "dashboard";
        const screenshotPath = path.join(
          outputDirectory,
          `${route.role.toLowerCase()}-${routeName}.png`,
        );
        await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
        report.screenshot = screenshotPath;
      }
      if (outputDirectory) {
        await writeFile(
          path.join(outputDirectory, "axe-report.json"),
          JSON.stringify(reports, null, 2),
        );
      }

      if (route.path === "/teacher" && process.env.E2E_AXE_TEST_COURSE_COPY === "true") {
        if (!(await waitForBrowserSelector(browser, ".course-card-copy-action button", 15_000))) {
          throw new Error("The teacher dashboard did not render the course-copy button.");
        }
        await new Promise((resolve) => setTimeout(resolve, 1_500));
        const clicked = await browser.send("Runtime.evaluate", {
          expression: `(()=>{const button=document.querySelector('.course-card-copy-action button');if(!button||button.disabled)return false;button.click();return true})()`,
          returnByValue: true,
        });
        if (clicked.result?.value !== true) {
          throw new Error("The teacher dashboard did not expose an enabled course-copy button.");
        }
        if (
          !(await waitForBrowserSelector(browser, '.course-copy-feedback[role="status"]', 30_000))
        ) {
          const error = await browser.send("Runtime.evaluate", {
            expression:
              "document.querySelector('.course-copy-error')?.textContent ?? 'no response'",
            returnByValue: true,
          });
          throw new Error(
            `The teacher dashboard course-copy action failed: ${error.result?.value}.`,
          );
        }
        const feedback = await browser.send("Runtime.evaluate", {
          expression:
            "document.querySelector('.course-copy-feedback[role=\"status\"]')?.textContent ?? ''",
          returnByValue: true,
        });
        if (!feedback.result?.value) {
          throw new Error("The teacher dashboard course-copy action returned an empty status.");
        }
        console.info("BROWSER COURSE COPY created a draft from the teacher dashboard");
      }

      if (route.path === "/admin/users" && process.env.E2E_AXE_SKIP_EXTRA_STATES !== "true") {
        const opened = await browser.send("Runtime.evaluate", {
          expression: `new Promise(resolve=>{const button=document.querySelector('.app-page-header button');if(!button){resolve(false);return}button.click();requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(Boolean(document.querySelector('.create-user-panel form')))))})`,
          awaitPromise: true,
          returnByValue: true,
        });
        if (opened.result?.value !== true) {
          throw new Error("The admin create-account form did not open in the browser.");
        }
        const formReadiness = await waitForPageReady(browser);
        if (!formReadiness.settled) {
          throw new Error("The admin create-account form did not finish loading.");
        }
        const formAudit = await browser.send("Runtime.evaluate", {
          expression,
          awaitPromise: true,
          returnByValue: true,
          timeout: 40_000,
        });
        if (formAudit.exceptionDetails) {
          throw new Error(formAudit.exceptionDetails.text ?? "Account-form axe evaluation failed.");
        }
        const formReport = {
          role: route.role,
          username: route.username,
          expectedPath: route.path,
          viewport: "desktop",
          uiState: "create-account-form",
          dataSettled: formReadiness.settled,
          ...formAudit.result.value,
        };
        reports.push(formReport);
        if (outputDirectory) {
          const screenshot = await browser.send("Page.captureScreenshot", {
            format: "png",
            captureBeyondViewport: true,
          });
          const screenshotPath = path.join(outputDirectory, "admin-admin-users-create-form.png");
          await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
          formReport.screenshot = screenshotPath;
          await writeFile(
            path.join(outputDirectory, "axe-report.json"),
            JSON.stringify(reports, null, 2),
          );
        }
      }

      if (route.path === "/admin/academic" && process.env.E2E_AXE_SKIP_EXTRA_STATES !== "true") {
        const academicSections = [
          "academic-years",
          "terms",
          "specialties",
          "groups",
          "subjects",
          "courses",
        ];
        for (const [index, uiState] of academicSections.entries()) {
          const selected = await browser.send("Runtime.evaluate", {
            expression: `new Promise(resolve=>{const button=document.querySelectorAll('.academic-tabs button')[${index}];button?.click();requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(Boolean(button?.classList.contains('academic-tab-active')&&document.querySelector('.academic-page .admin-panel form')))))})`,
            awaitPromise: true,
            returnByValue: true,
          });
          if (selected.result?.value !== true) {
            throw new Error(`The admin ${uiState} form did not become visible in the browser.`);
          }
          const sectionReadiness = await waitForPageReady(browser);
          if (!sectionReadiness.settled) {
            throw new Error(`The admin ${uiState} form did not finish loading.`);
          }
          const sectionAudit = await browser.send("Runtime.evaluate", {
            expression,
            awaitPromise: true,
            returnByValue: true,
            timeout: 40_000,
          });
          if (sectionAudit.exceptionDetails) {
            throw new Error(
              sectionAudit.exceptionDetails.text ?? `Axe failed on admin ${uiState}.`,
            );
          }
          const sectionReport = {
            role: route.role,
            username: route.username,
            expectedPath: route.path,
            viewport: "desktop",
            uiState,
            dataSettled: sectionReadiness.settled,
            ...sectionAudit.result.value,
          };
          reports.push(sectionReport);
          if (outputDirectory) {
            const screenshot = await browser.send("Page.captureScreenshot", {
              format: "png",
              captureBeyondViewport: true,
            });
            const screenshotPath = path.join(outputDirectory, `admin-academic-${uiState}.png`);
            await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
            sectionReport.screenshot = screenshotPath;
            await writeFile(
              path.join(outputDirectory, "axe-report.json"),
              JSON.stringify(reports, null, 2),
            );
          }
        }
      }

      if (route.role) {
        await browser.send("Emulation.setDeviceMetricsOverride", {
          width: mobileViewportWidth,
          height: 844,
          deviceScaleFactor: 1,
          mobile: true,
        });
        const menu = await browser.send("Runtime.evaluate", {
          expression: `(()=>{const details=document.querySelector('.app-mobile-nav');if(details&&!details.open)details.querySelector('summary')?.click();return Boolean(details?.open)})()`,
          returnByValue: true,
        });
        if (menu.result?.value !== true) {
          throw new Error(`${route.role} mobile navigation did not open on ${route.path}.`);
        }
        const mobileReadiness = await waitForPageReady(browser);
        if (!mobileReadiness.settled) {
          throw new Error(
            `${route.role} route ${route.path} did not finish loading on mobile (loadingText=${mobileReadiness.loadingText}, ariaBusy=${mobileReadiness.ariaBusy}).`,
          );
        }
        const mobileDimensions = await browser.send("Runtime.evaluate", {
          expression: `(()=>{const viewportWidth=document.documentElement.clientWidth;const documentWidth=document.documentElement.scrollWidth;const bodyScrollWidth=document.body.scrollWidth;const rootOverflowX=getComputedStyle(document.documentElement).overflowX;const describe=el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {tag:el.tagName.toLowerCase(),className:typeof el.className==='string'?el.className:'',left:Math.round(r.left),right:Math.round(r.right),width:Math.round(r.width),scrollWidth:el.scrollWidth,clientWidth:el.clientWidth,overflowX:s.overflowX,minWidth:s.minWidth,display:s.display,position:s.position}};const scroller=document.querySelector('.users-table-scroll');const edgeOffenders=[...document.body.querySelectorAll('*')].filter(el=>!scroller?.contains(el)).map(el=>({el,...describe(el)})).filter(item=>item.width>0&&(item.left<-1||item.right>viewportWidth+1)).sort((a,b)=>a.left-b.left).slice(0,20).map(({el,...rest})=>rest);const layoutElements=['.app-layout','.app-sidebar','.app-main','.app-page-wrap','.users-panel','.users-filter-bar','.users-search-field','.app-mobile-nav'].map(selector=>{const el=document.querySelector(selector);return el?{selector,...describe(el)}:null}).filter(Boolean);const table=document.querySelector('.users-table');const tableAncestors=[];for(let el=table;el;el=el.parentElement)tableAncestors.push(describe(el));return {viewportWidth,documentWidth,bodyScrollWidth,rootOverflowX,edgeOffenders,layoutElements,tableAncestors}})()`,
          returnByValue: true,
        });
        const mobileLayout = mobileDimensions.result?.value;
        if (outputDirectory) {
          const screenshot = await browser.send("Page.captureScreenshot", {
            format: "png",
            captureBeyondViewport: true,
          });
          const routeName = route.path.slice(1).replaceAll("/", "-") || "dashboard";
          const screenshotPath = path.join(
            outputDirectory,
            `${route.role.toLowerCase()}-${routeName}-mobile.png`,
          );
          await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
        }
        if (
          !mobileLayout ||
          mobileLayout.rootOverflowX !== "clip" ||
          mobileLayout.bodyScrollWidth > mobileLayout.viewportWidth + 1 ||
          mobileLayout.edgeOffenders.length > 0
        ) {
          throw new Error(
            `${route.role} route ${route.path} overflows at ${mobileViewportWidth}px (${JSON.stringify(mobileLayout)}).`,
          );
        }
        const mobile = await browser.send("Runtime.evaluate", {
          expression,
          awaitPromise: true,
          returnByValue: true,
          timeout: 40_000,
        });
        if (mobile.exceptionDetails) {
          throw new Error(mobile.exceptionDetails.text ?? "Mobile axe-core evaluation failed.");
        }
        const mobileReport = {
          role: route.role,
          username: route.username,
          expectedPath: route.path,
          viewport: "mobile",
          viewportWidth: mobileViewportWidth,
          horizontalOverflow: false,
          dataSettled: mobileReadiness.settled,
          ...mobile.result.value,
        };
        if (mobileReport.url !== route.path) {
          throw new Error(
            `${route.role} mobile route ${route.path} redirected to ${mobileReport.url}.`,
          );
        }
        reports.push(mobileReport);
        if (outputDirectory) {
          const routeName = route.path.slice(1).replaceAll("/", "-") || "dashboard";
          const screenshotPath = path.join(
            outputDirectory,
            `${route.role.toLowerCase()}-${routeName}-mobile.png`,
          );
          mobileReport.screenshot = screenshotPath;
          await writeFile(
            path.join(outputDirectory, "axe-report.json"),
            JSON.stringify(reports, null, 2),
          );
        }
        await browser.send("Emulation.setDeviceMetricsOverride", {
          width: 1440,
          height: 1000,
          deviceScaleFactor: 1,
          mobile: false,
        });
      }
    }

    if (process.env.E2E_AXE_SKIP_PUBLIC_MOBILE !== "true") {
      for (const route of [
        "/",
        "/login",
        "/catalog?locale=ru",
        "/catalog/demo-algorithms-2026?locale=ru",
      ]) {
        await browser.send("Network.clearBrowserCookies");
        await browser.send("Emulation.setDeviceMetricsOverride", {
          width: mobileViewportWidth,
          height: 844,
          deviceScaleFactor: 1,
          mobile: true,
        });
        await navigateBrowserToPath(
          browser,
          new URL(route, baseUrl).toString(),
          route.split("?")[0],
        );
        const readiness = await waitForPageReady(browser);
        if (!readiness.settled) throw new Error(`Public route ${route} did not finish loading.`);
        const dimensions = await browser.send("Runtime.evaluate", {
          expression:
            "(()=>({viewportWidth:document.documentElement.clientWidth,documentWidth:Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)}))()",
          returnByValue: true,
        });
        const layout = dimensions.result?.value;
        if (!layout || layout.documentWidth > layout.viewportWidth + 1) {
          throw new Error(
            `Public route ${route} overflows at ${mobileViewportWidth}px (viewport=${layout?.viewportWidth}, document=${layout?.documentWidth}).`,
          );
        }
        reports.push({
          role: "PUBLIC",
          expectedPath: route.split("?")[0],
          url: new URL(route, baseUrl).pathname,
          viewport: "mobile",
          viewportWidth: mobileViewportWidth,
          horizontalOverflow: false,
          dataSettled: readiness.settled,
          violations: [],
          incomplete: [],
        });
        if (outputDirectory) {
          await writeFile(
            path.join(outputDirectory, "axe-report.json"),
            JSON.stringify(reports, null, 2),
          );
        }
      }
    }

    if (process.env.E2E_AXE_SKIP_BROWSER_LOGIN !== "true") {
      if (!loginCredentials?.username || !loginCredentials.password) {
        throw new Error("A disposable E2E account is required to verify the browser login form.");
      }
      await browser.send("Network.clearBrowserCookies");
      await navigateBrowserToPath(browser, new URL("/login", baseUrl).toString(), "/login");
      const loginReadiness = await waitForPageReady(browser);
      if (!loginReadiness.settled) throw new Error("The login form did not finish loading.");

      const filled = await browser.send("Runtime.evaluate", {
        expression: `(()=>{const identifier=document.querySelector('#login-identifier');const password=document.querySelector('#login-password');if(!identifier||!password)return false;const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(identifier,${JSON.stringify(loginCredentials.username)});identifier.dispatchEvent(new Event('input',{bubbles:true}));setter.call(password,${JSON.stringify(loginCredentials.password)});password.dispatchEvent(new Event('input',{bubbles:true}));return Boolean(document.querySelector('.auth-form'))})()`,
        returnByValue: true,
      });
      if (filled.result?.value !== true) throw new Error("Could not fill the browser login form.");

      const submitted = await browser.send("Runtime.evaluate", {
        expression: `(()=>{const form=document.querySelector('.auth-form');if(!form)return false;form.requestSubmit();return true})()`,
        returnByValue: true,
      });
      if (submitted.result?.value !== true)
        throw new Error("Could not submit the browser login form.");

      const browserSession = await waitForAuthenticatedBrowserSession(browser, "STUDENT");
      if (!browserSession) {
        throw new Error(
          "The browser login form did not establish an authenticated student session.",
        );
      }
      console.info(
        `BROWSER LOGIN ${loginCredentials.username} completed at ${browserSession.path}`,
      );

      const studentDashboardPath = await waitForBrowserPath(browser, "/student", 30_000);
      if (!studentDashboardPath) {
        throw new Error("The browser did not finish redirecting to the student dashboard.");
      }
      const authenticatedPageReadiness = await waitForPageReady(browser);
      if (!authenticatedPageReadiness.settled) {
        throw new Error("The authenticated student dashboard did not finish loading.");
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));

      if (!(await waitForBrowserSelector(browser, ".app-sign-out"))) {
        throw new Error("The authenticated page did not show the sign-out button.");
      }

      const signOutClicked = await browser.send("Runtime.evaluate", {
        expression: `(()=>{const button=document.querySelector('.app-sign-out');if(!button||button.disabled)return false;button.click();return true})()`,
        returnByValue: true,
      });
      if (signOutClicked.result?.value !== true) {
        throw new Error("The authenticated page did not expose the sign-out button.");
      }
      const logoutPath = await waitForBrowserPath(browser, "/login", 15_000);
      if (!logoutPath) {
        throw new Error("The sign-out button did not return the browser to /login.");
      }
      const signedOut = await browser.send("Runtime.evaluate", {
        expression: `fetch('/api/v1/auth/me',{cache:'no-store'}).then(response=>({path:location.pathname,status:response.status}))`,
        awaitPromise: true,
        returnByValue: true,
        timeout: 10_000,
      });
      const logoutResult = signedOut.result?.value;
      if (logoutResult?.path !== "/login" || logoutResult.status === 200) {
        throw new Error(
          `The authenticated sign-out button did not clear the student session (path=${logoutResult?.path}, status=${logoutResult?.status}, error=${logoutResult?.error ?? "none"}).`,
        );
      }
      console.info("BROWSER LOGOUT cleared the student session and returned to /login");
    }
  } finally {
    browser.ws.close();
    await stopBrowser(browser.browserPid, browser.profile, browser.debugPort);
  }

  return reports;
}
