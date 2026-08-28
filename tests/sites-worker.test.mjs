import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import worker, { FrontmendAuditGate, FrontmendAuditJob } from "../worker/index.js";
import { createLocalAuditRuntime } from "../worker/local-runtime.js";

const execFileAsync = promisify(execFile);
const projectRoot = fileURLToPath(new URL("..", import.meta.url));

async function ensureSitesBuild() {
  await execFileAsync("bun", ["run", "build"], {
    cwd: projectRoot,
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
  });
}

function callLocalRuntime(middleware, { method = "GET", url, body = "", headers = {} }) {
  return new Promise((resolve, reject) => {
    const request = Readable.from(body ? [Buffer.from(body)] : []);
    Object.assign(request, {
      method,
      url,
      headers,
      socket: { remoteAddress: "127.0.0.1" },
    });
    const responseHeaders = new Map();
    const response = {
      statusCode: 200,
      setHeader(name, value) {
        responseHeaders.set(name.toLowerCase(), String(value));
      },
      end(value = "") {
        resolve({
          status: this.statusCode,
          headers: responseHeaders,
          body: Buffer.isBuffer(value) ? value.toString("utf8") : String(value),
        });
      },
    };
    Promise.resolve(middleware(request, response, () => reject(new Error("Unexpected next()."))))
      .catch(reject);
  });
}

test("serves existing static assets without a fallback", async () => {
  const calls = [];
  const response = await worker.fetch(new Request("https://example.test/assets/app.js"), {
    ASSETS: {
      fetch: async (request) => {
        calls.push(new URL(request.url).pathname);
        return new Response("asset", { status: 200 });
      },
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["/assets/app.js"]);
  assert.equal(response.headers.get("origin-agent-cluster"), "?1");
  assert.equal(response.headers.get("permissions-policy"), "tools=(self)");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("content-security-policy"), null);
});

test("falls back to index.html for an unknown app route", async () => {
  const calls = [];
  const response = await worker.fetch(
    new Request("https://example.test/audits/demo?source=share", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async (request) => {
          const url = new URL(request.url);
          calls.push(url.pathname + url.search);
          return new Response(url.pathname === "/index.html" ? "app" : "missing", {
            status: url.pathname === "/index.html" ? 200 : 404,
            headers: { "content-type": "text/html" },
          });
        },
      },
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["/audits/demo?source=share", "/index.html"]);
  assert.match(response.headers.get("content-security-policy"), /script-src 'self'/);
  assert.match(
    response.headers.get("content-security-policy"),
    /script-src 'self' https:\/\/static\.cloudflareinsights\.com/,
  );
  assert.match(
    response.headers.get("content-security-policy"),
    /connect-src 'self' https:\/\/cloudflareinsights\.com/,
  );
  assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/);
});

test("does not turn missing API or write requests into the app shell", async () => {
  const cases = [
    {
      request: new Request("https://example.test/api/missing", {
        headers: { accept: "application/json" },
      }),
      assetCalls: 0,
    },
    {
      request: new Request("https://example.test/audits", {
        method: "POST",
        headers: { accept: "text/html" },
      }),
      assetCalls: 1,
    },
  ];
  for (const { request, assetCalls } of cases) {
    let calls = 0;
    const response = await worker.fetch(request, {
      ASSETS: {
        fetch: async () => {
          calls += 1;
          return new Response("missing", { status: 404 });
        },
      },
    });

    assert.equal(response.status, 404);
    assert.equal(calls, assetCalls);
  }
});

test("starts a same-origin public audit through the job boundary", async () => {
  const jobId = "b8b16bf0-913c-40ea-a741-bb4bf76d326b";
  const calls = [];
  const response = await worker.fetch(
    new Request("https://frontmend.test/api/audits", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        origin: "https://frontmend.test",
      },
      body: JSON.stringify({ url: "removemyexif.com", source: "agent" }),
    }),
    {
      AUDIT_GATE: {
        idFromName: (name) => name,
        get: () => ({
          fetch: async () => Response.json({ allowed: true, jobId, reused: false }),
        }),
      },
      AUDIT_JOBS: {
        idFromName: (name) => name,
        get: (id) => ({
          fetch: async (_url, init) => {
            calls.push({ id, input: JSON.parse(init.body) });
            return Response.json({
              ok: true,
              data: {
                id,
                url: "https://removemyexif.com/",
                source: "agent",
                status: "queued",
              },
            });
          },
        }),
      },
    },
  );

  assert.equal(response.status, 202);
  assert.equal(response.headers.get("location"), `/api/audits/${jobId}`);
  assert.equal(calls[0].input.url, "https://removemyexif.com/");
  assert.equal(calls[0].input.source, "agent");
});

test("starts a related audit only from the parent job's authoritative route input", async () => {
  const parentId = "19474d5a-a536-4cb3-84bf-99f00ba585c0";
  const childId = "232d593c-6c81-48c3-b137-a3df269454ff";
  const calls = [];
  const response = await worker.fetch(
    new Request(`https://frontmend.test/api/audits/${parentId}/routes`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://frontmend.test",
      },
      body: JSON.stringify({ path: "/privacy", source: "agent" }),
    }),
    {
      AUDIT_GATE: {
        idFromName: (name) => name,
        get: () => ({
          fetch: async (_url, init) => {
            calls.push({ boundary: "gate", input: JSON.parse(init.body) });
            return Response.json({ allowed: true, jobId: childId, reused: false });
          },
        }),
      },
      AUDIT_JOBS: {
        idFromName: (name) => name,
        get: (id) => ({
          fetch: async (url, init = {}) => {
            const pathname = new URL(url).pathname;
            calls.push({ boundary: id, pathname, input: init.body ? JSON.parse(init.body) : null });
            if (id === parentId) {
              assert.equal(pathname, "/route-input");
              return Response.json({
                ok: true,
                data: {
                  url: "https://removemyexif.com/privacy",
                  exploration: {
                    rootAuditId: parentId,
                    parentAuditId: parentId,
                    observedPath: "/privacy",
                    depth: 1,
                    trail: [{ auditId: parentId, path: "/" }],
                  },
                },
              });
            }
            return Response.json({
              ok: true,
              data: {
                id: childId,
                url: "https://removemyexif.com/privacy",
                source: "agent",
                status: "queued",
              },
            }, { status: 202 });
          },
        }),
      },
    },
  );

  assert.equal(response.status, 202);
  assert.equal(response.headers.get("location"), `/api/audits/${childId}`);
  const childStart = calls.find((call) => call.boundary === childId);
  assert.equal(childStart.pathname, "/start");
  assert.equal(childStart.input.exploration.parentAuditId, parentId);
  assert.equal(childStart.input.exploration.observedPath, "/privacy");
});

test("audit jobs derive route lineage from completed retained evidence", async () => {
  const auditId = "19474d5a-a536-4cb3-84bf-99f00ba585c0";
  const values = new Map([["state", {
    id: auditId,
    url: "https://removemyexif.com/",
    status: "complete",
    report: {
      auditId,
      finalUrl: "https://removemyexif.com/",
      documentProfile: { routes: ["/privacy"] },
    },
  }]]);
  const job = new FrontmendAuditJob({
    storage: {
      get: async (key) => values.get(key),
    },
  }, {});

  const response = await job.fetch(new Request("https://frontmend.internal/route-input", {
    method: "POST",
    body: JSON.stringify({ path: "/privacy" }),
  }));
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.data.url, "https://removemyexif.com/privacy");
  assert.deepEqual(payload.data.exploration.trail, [{ auditId, path: "/" }]);
});

test("starts one durable site exploration through atomic batch admission", async () => {
  const rootId = "19474d5a-a536-4cb3-84bf-99f00ba585c0";
  const childIds = [
    "be37882f-87f6-45cf-8c85-49f28fdef131",
    "e76477a9-bf2a-4530-8891-fc8978d3058c",
  ];
  const calls = [];
  let retainedMission;
  const response = await worker.fetch(
    new Request(`https://frontmend.test/api/audits/${rootId}/explorations`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://frontmend.test" },
      body: JSON.stringify({ paths: ["/privacy", "/terms"], source: "agent" }),
    }),
    {
      AUDIT_GATE: {
        idFromName: (name) => name,
        get: () => ({
          fetch: async (_url, init) => {
            const input = JSON.parse(init.body);
            calls.push({ boundary: "gate", input });
            return Response.json({
              allowed: true,
              admissions: childIds.map((jobId) => ({ jobId, reused: false })),
            });
          },
        }),
      },
      AUDIT_JOBS: {
        idFromName: (name) => name,
        get: (id) => ({
          fetch: async (url, init = {}) => {
            const pathname = new URL(url).pathname;
            const input = init.body ? JSON.parse(init.body) : null;
            calls.push({ boundary: id, pathname, input });
            if (id === rootId && pathname === "/exploration-inputs") {
              return Response.json({
                ok: true,
                data: {
                  rootAuditId: rootId,
                  routes: ["/privacy", "/terms"].map((path) => ({
                    path,
                    url: `https://removemyexif.com${path}`,
                    exploration: {
                      rootAuditId: rootId,
                      parentAuditId: rootId,
                      observedPath: path,
                      depth: 1,
                      trail: [{ auditId: rootId, path: "/" }],
                    },
                  })),
                },
              });
            }
            if (id === rootId && pathname.startsWith("/explorations/")) {
              retainedMission = input;
              return Response.json({ ok: true, data: input }, { status: 201 });
            }
            return Response.json({
              ok: true,
              data: {
                id,
                status: "queued",
                progress: 4,
                url: input.url,
                source: input.source,
                siteExploration: input.siteExploration,
              },
            }, { status: 202 });
          },
        }),
      },
    },
  );

  const payload = await response.json();
  assert.equal(response.status, 202);
  assert.equal(payload.data.summary.pagesRequested, 2);
  assert.equal(calls.find((call) => call.boundary === "gate").input.items.length, 2);
  assert.equal(retainedMission.children.length, 2);
  assert.equal(retainedMission.source, "agent");
  const childStart = calls.find((call) => call.boundary === childIds[0]);
  assert.equal(childStart.input.siteExploration.rootAuditId, rootId);
  assert.equal(childStart.input.siteExploration.total, 2);
});

test("returns accepted when a deduplicated failed job begins a fresh attempt", async () => {
  const jobId = "b8b16bf0-913c-40ea-a741-bb4bf76d326b";
  const response = await worker.fetch(
    new Request("https://frontmend.test/api/audits", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://frontmend.test",
      },
      body: JSON.stringify({ url: "removemyexif.com", source: "agent" }),
    }),
    {
      AUDIT_GATE: {
        idFromName: (name) => name,
        get: () => ({
          fetch: async () => Response.json({ allowed: true, jobId, reused: true }),
        }),
      },
      AUDIT_JOBS: {
        idFromName: (name) => name,
        get: () => ({
          fetch: async () => Response.json({
            ok: true,
            data: {
              id: jobId,
              attempt: 2,
              url: "https://removemyexif.com/",
              source: "agent",
              status: "queued",
            },
          }, { status: 202 }),
        }),
      },
    },
  );

  assert.equal(response.status, 202);
  assert.equal((await response.json()).data.attempt, 2);
});

test("failed Durable Object jobs restart under the same stable audit ID", async () => {
  const auditId = "b8b16bf0-913c-40ea-a741-bb4bf76d326b";
  const values = new Map([[
    "state",
    {
      id: auditId,
      attempt: 1,
      url: "https://removemyexif.com/",
      source: "human",
      status: "failed",
      phase: "failed",
      phaseLabel: "Live audit failed",
      progress: 42,
      report: null,
      error: { code: "DOCUMENT_TIMEOUT", message: "Timed out.", recoverable: true },
      startedAt: 100,
    },
  ]]);
  let scheduled;
  const job = new FrontmendAuditJob(
    {
      storage: {
        get: async (key) => values.get(key),
        put: async (key, value) => values.set(key, structuredClone(value)),
      },
      waitUntil: (promise) => { scheduled = promise; },
    },
    {},
  );
  let restartedState;
  job.run = async (state) => { restartedState = state; };
  const response = await job.fetch(new Request("https://frontmend.internal/start", {
    method: "POST",
    body: JSON.stringify({
      id: auditId,
      url: "https://removemyexif.com/",
      source: "human",
    }),
  }));
  await scheduled;

  const payload = await response.json();
  assert.equal(response.status, 202);
  assert.equal(payload.data.id, auditId);
  assert.equal(payload.data.attempt, 2);
  assert.equal(payload.data.status, "queued");
  assert.equal(values.get("state").error, null);
  assert.equal(restartedState.attempt, 2);
});

test("proxies a completed audit report through the stable public route", async () => {
  const auditId = "b8b16bf0-913c-40ea-a741-bb4bf76d326b";
  const calls = [];
  const response = await worker.fetch(
    new Request(`https://frontmend.test/api/audits/${auditId}/report`),
    {
      AUDIT_JOBS: {
        idFromName: (name) => name,
        get: (id) => ({
          fetch: async (url) => {
            calls.push({ id, pathname: new URL(url).pathname });
            return new Response("# Frontmend audit report", {
              headers: { "content-type": "text/markdown; charset=utf-8" },
            });
          },
        }),
      },
    },
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/markdown/);
  assert.deepEqual(calls, [{ id: auditId, pathname: "/report" }]);
});

test("proxies same-origin audit cancellation through the stable public route", async () => {
  const auditId = "b8b16bf0-913c-40ea-a741-bb4bf76d326b";
  const calls = [];
  const response = await worker.fetch(
    new Request(`https://frontmend.test/api/audits/${auditId}`, {
      method: "DELETE",
      headers: { origin: "https://frontmend.test" },
    }),
    {
      AUDIT_JOBS: {
        idFromName: (name) => name,
        get: (id) => ({
          fetch: async (url, init) => {
            calls.push({ id, pathname: new URL(url).pathname, method: init.method });
            return Response.json({
              ok: true,
              data: { id, status: "cancelled", phase: "cancelled" },
            });
          },
        }),
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.status, "cancelled");
  assert.deepEqual(calls, [{ id: auditId, pathname: "/", method: "DELETE" }]);
});

test("Durable Object cancellation is persisted, aborts the provider, and is idempotent", async () => {
  const auditId = "b8b16bf0-913c-40ea-a741-bb4bf76d326b";
  const values = new Map([["state", {
    id: auditId,
    attempt: 1,
    url: "https://removemyexif.com/",
    source: "human",
    status: "running",
    phase: "capture",
    phaseLabel: "Running mobile Lighthouse audit",
    progress: 18,
    report: null,
    error: null,
  }]]);
  let aborts = 0;
  let alarmAt = null;
  const job = new FrontmendAuditJob({
    storage: {
      get: async (key) => values.get(key),
      put: async (key, value) => values.set(key, structuredClone(value)),
      setAlarm: async (timestamp) => { alarmAt = timestamp; },
    },
  }, {});
  job.abortController = { abort: () => { aborts += 1; } };

  const first = await job.fetch(new Request("https://frontmend.internal/", { method: "DELETE" }));
  const replay = await job.fetch(new Request("https://frontmend.internal/", { method: "DELETE" }));
  const payload = await first.json();

  assert.equal(first.status, 200);
  assert.equal(payload.data.status, "cancelled");
  assert.equal(payload.data.phaseLabel, "Audit cancelled");
  assert.equal((await replay.json()).data.status, "cancelled");
  assert.equal(values.get("state").status, "cancelled");
  assert.equal(aborts, 1);
  assert.equal(Number.isFinite(alarmAt), true);
});

test("local development exports the same completed audit report contract", async () => {
  const middleware = createLocalAuditRuntime({
    fetchImpl: async (input) => {
      const url = new URL(input);
      if (url.hostname === "pagespeedonline.googleapis.com") {
        return Response.json({ error: { message: "rate limited" } }, { status: 429 });
      }
      return new Response(
        '<!doctype html><html lang="en"><head><title>Remove My EXIF</title><meta name="viewport" content="width=device-width"></head><body><main><h1>Remove metadata</h1></main></body></html>',
        {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "content-security-policy": "default-src 'self'",
            "x-content-type-options": "nosniff",
          },
        },
      );
    },
  });
  const start = await callLocalRuntime(middleware, {
    method: "POST",
    url: "/api/audits",
    headers: {
      host: "localhost:3434",
      origin: "http://localhost:3434",
    },
    body: JSON.stringify({ url: "https://removemyexif.com/", source: "human" }),
  });
  const auditId = JSON.parse(start.body).data.id;
  let report;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    report = await callLocalRuntime(middleware, {
      url: `/api/audits/${auditId}/report`,
    });
    if (report.status === 200) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  assert.equal(report.status, 200);
  assert.match(report.headers.get("content-type"), /text\/markdown/);
  assert.match(report.headers.get("content-disposition"), new RegExp(auditId));
  assert.equal(report.headers.get("cache-control"), "no-store");
  assert.match(report.body, /# Frontmend audit report/);
  assert.match(report.body, /https:\/\/removemyexif\.com\//);
  assert.match(report.body, /does not claim it deployed, changed/);
});

test("local development persists related-route lineage into snapshots and reports", async () => {
  const middleware = createLocalAuditRuntime({
    fetchImpl: async (input) => {
      const url = new URL(input);
      if (url.hostname === "pagespeedonline.googleapis.com") {
        return Response.json({ error: { message: "rate limited" } }, { status: 429 });
      }
      return new Response(
        '<!doctype html><html lang="en"><head><title>Remove My EXIF</title><meta name="viewport" content="width=device-width"></head><body><main><h1>Remove metadata</h1><a href="/privacy">Privacy</a><a href="/tools">Tools</a></main></body></html>',
        { headers: { "content-type": "text/html; charset=utf-8" } },
      );
    },
  });
  const start = await callLocalRuntime(middleware, {
    method: "POST",
    url: "/api/audits",
    headers: { origin: "http://frontmend.local", host: "frontmend.local" },
    body: JSON.stringify({ url: "https://removemyexif.com/", source: "human" }),
  });
  const parentId = JSON.parse(start.body).data.id;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const current = await callLocalRuntime(middleware, { url: `/api/audits/${parentId}` });
    if (JSON.parse(current.body).data.status === "complete") break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  const related = await callLocalRuntime(middleware, {
    method: "POST",
    url: `/api/audits/${parentId}/routes`,
    headers: { origin: "http://frontmend.local", host: "frontmend.local" },
    body: JSON.stringify({ path: "/privacy", source: "agent" }),
  });
  const queued = JSON.parse(related.body).data;
  assert.equal(related.status, 202);
  assert.equal(queued.exploration.parentAuditId, parentId);
  assert.equal(queued.exploration.depth, 1);

  let complete;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    complete = await callLocalRuntime(middleware, { url: `/api/audits/${queued.id}` });
    if (JSON.parse(complete.body).data.status === "complete") break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const completed = JSON.parse(complete.body).data;
  assert.equal(completed.report.exploration.rootAuditId, parentId);
  assert.deepEqual(completed.report.exploration.trail, [{ auditId: parentId, path: "/" }]);

  const report = await callLocalRuntime(middleware, { url: `/api/audits/${queued.id}/report` });
  assert.match(report.body, /## Route journey/);
  assert.match(report.body, new RegExp(`Parent audit: ${parentId}`));
});

test("local development runs and exports a recurring cross-page exploration", async () => {
  const middleware = createLocalAuditRuntime({
    fetchImpl: async (input) => {
      const url = new URL(input);
      if (url.hostname === "pagespeedonline.googleapis.com") {
        return Response.json({ error: { message: "rate limited" } }, { status: 429 });
      }
      return new Response(
        '<!doctype html><html lang="en"><head><title>Remove My EXIF</title><meta name="viewport" content="width=device-width"></head><body><main><h1>Remove metadata</h1><a href="/privacy">Privacy</a><a href="/terms">Terms</a></main></body></html>',
        { headers: { "content-type": "text/html; charset=utf-8" } },
      );
    },
  });
  const start = await callLocalRuntime(middleware, {
    method: "POST",
    url: "/api/audits",
    headers: { origin: "http://frontmend.local", host: "frontmend.local" },
    body: JSON.stringify({ url: "https://removemyexif.com/", source: "human" }),
  });
  const rootId = JSON.parse(start.body).data.id;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const current = await callLocalRuntime(middleware, { url: `/api/audits/${rootId}` });
    if (JSON.parse(current.body).data.status === "complete") break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  const started = await callLocalRuntime(middleware, {
    method: "POST",
    url: `/api/audits/${rootId}/explorations`,
    headers: { origin: "http://frontmend.local", host: "frontmend.local" },
    body: JSON.stringify({ paths: ["/privacy", "/terms"], source: "agent" }),
  });
  const mission = JSON.parse(started.body).data;
  assert.equal(started.status, 202);
  assert.equal(mission.summary.pagesRequested, 2);

  let aggregate;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const current = await callLocalRuntime(middleware, {
      url: `/api/audits/${rootId}/explorations/${mission.id}`,
    });
    aggregate = JSON.parse(current.body).data;
    if (["complete", "partial", "failed"].includes(aggregate.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(aggregate.status, "complete");
  assert.equal(aggregate.summary.pagesComplete, 2);
  assert.ok(aggregate.summary.recurringIssues >= 1);
  assert.equal(aggregate.issues.find((issue) => issue.occurrenceCount === 2).occurrenceCount, 2);

  const report = await callLocalRuntime(middleware, {
    url: `/api/audits/${rootId}/explorations/${mission.id}/report`,
  });
  assert.equal(report.status, 200);
  assert.match(report.body, /# Frontmend site exploration/);
  assert.match(report.body, /Observed on: 2 selected pages/);
});

test("local development retries a failed audit as a fresh stable attempt", async () => {
  let documentAttempts = 0;
  const middleware = createLocalAuditRuntime({
    fetchImpl: async (input) => {
      const url = new URL(input);
      if (url.hostname === "pagespeedonline.googleapis.com") {
        return Response.json({ error: { message: "rate limited" } }, { status: 429 });
      }
      documentAttempts += 1;
      if (documentAttempts === 1) {
        return new Response("temporarily unavailable", {
          status: 503,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      return new Response(
        '<!doctype html><html lang="en"><head><title>Recovered</title><meta name="viewport" content="width=device-width"></head><body><main><h1>Recovered</h1></main></body></html>',
        {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "content-security-policy": "default-src 'self'",
            "x-content-type-options": "nosniff",
          },
        },
      );
    },
  });
  const startRequest = () => callLocalRuntime(middleware, {
    method: "POST",
    url: "/api/audits",
    headers: { host: "localhost:3434", origin: "http://localhost:3434" },
    body: JSON.stringify({ url: "https://removemyexif.com/", source: "human" }),
  });
  const first = await startRequest();
  const firstPayload = JSON.parse(first.body).data;
  let failed;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    failed = await callLocalRuntime(middleware, { url: `/api/audits/${firstPayload.id}` });
    if (JSON.parse(failed.body).data.status === "failed") break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(JSON.parse(failed.body).data.status, "failed");

  const retry = await startRequest();
  const retryPayload = JSON.parse(retry.body).data;
  assert.equal(retry.status, 202);
  assert.equal(retryPayload.id, firstPayload.id);
  assert.equal(retryPayload.attempt, 2);
  let complete;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    complete = await callLocalRuntime(middleware, { url: `/api/audits/${retryPayload.id}` });
    if (JSON.parse(complete.body).data.status === "complete") break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(JSON.parse(complete.body).data.status, "complete");
  assert.equal(JSON.parse(complete.body).data.attempt, 2);
});

test("local development cancels an active provider request and retries the stable audit", async () => {
  let markFetchStarted;
  const fetchStarted = new Promise((resolve) => { markFetchStarted = resolve; });
  let calls = 0;
  const middleware = createLocalAuditRuntime({
    fetchImpl: async (input, init = {}) => {
      calls += 1;
      if (calls === 1) {
        markFetchStarted();
        return new Promise((_resolve, reject) => {
          init.signal.addEventListener(
            "abort",
            () => reject(new DOMException("The operation was aborted.", "AbortError")),
            { once: true },
          );
        });
      }
      const url = new URL(input);
      if (url.hostname === "pagespeedonline.googleapis.com") {
        return new Response("rate limited", { status: 429 });
      }
      return new Response(
        '<!doctype html><html lang="en"><head><title>Retry</title><meta name="viewport" content="width=device-width"></head><body><main><h1>Retry</h1></main></body></html>',
        {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "content-security-policy": "default-src 'self'",
            "x-content-type-options": "nosniff",
          },
        },
      );
    },
  });
  const headers = { host: "localhost:3434", origin: "http://localhost:3434" };
  const startRequest = () => callLocalRuntime(middleware, {
    method: "POST",
    url: "/api/audits",
    headers,
    body: JSON.stringify({ url: "https://removemyexif.com/", source: "human" }),
  });

  const started = await startRequest();
  const first = JSON.parse(started.body).data;
  await fetchStarted;
  const cancelled = await callLocalRuntime(middleware, {
    method: "DELETE",
    url: `/api/audits/${first.id}`,
    headers,
  });
  const replay = await callLocalRuntime(middleware, {
    method: "DELETE",
    url: `/api/audits/${first.id}`,
    headers,
  });
  assert.equal(JSON.parse(cancelled.body).data.status, "cancelled");
  assert.equal(JSON.parse(replay.body).data.status, "cancelled");

  const retry = await startRequest();
  const retried = JSON.parse(retry.body).data;
  assert.equal(retry.status, 202);
  assert.equal(retried.id, first.id);
  assert.equal(retried.attempt, 2);
  let terminal;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    terminal = await callLocalRuntime(middleware, { url: `/api/audits/${first.id}` });
    if (JSON.parse(terminal.body).data.status === "complete") break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(JSON.parse(terminal.body).data.status, "complete");
  assert.equal(JSON.parse(terminal.body).data.attempt, 2);
});

test("rejects cross-origin and private audit starts before allocating a job", async () => {
  let allocations = 0;
  const env = {
    AUDIT_GATE: {
      idFromName: () => "gate",
      get: () => {
        allocations += 1;
        return { fetch: async () => Response.json({ allowed: true }) };
      },
    },
  };
  const requests = [
    new Request("https://frontmend.test/api/audits", {
      method: "POST",
      headers: { origin: "https://attacker.test" },
      body: JSON.stringify({ url: "removemyexif.com" }),
    }),
    new Request("https://frontmend.test/api/audits", {
      method: "POST",
      headers: { origin: "https://frontmend.test" },
      body: JSON.stringify({ url: "http://169.254.169.254/latest/meta-data" }),
    }),
  ];

  for (const request of requests) {
    const response = await worker.fetch(request, env);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).ok, false);
  }
  assert.equal(allocations, 0);
});

test("gate deduplicates a URL and enforces a bounded per-client window", async () => {
  const values = new Map();
  const gate = new FrontmendAuditGate({
    storage: {
      get: async (key) => values.get(key),
      put: async (key, value) => values.set(key, structuredClone(value)),
    },
  });
  const admit = (now, urlHash = "url-a") =>
    gate.fetch(
      new Request("https://frontmend.internal/admit", {
        method: "POST",
        body: JSON.stringify({ fingerprint: "client-a", urlHash, now }),
      }),
    );

  const first = await (await admit(1_000)).json();
  const second = await (await admit(2_000)).json();
  assert.equal(second.jobId, first.jobId);
  assert.equal(second.reused, true);
  await admit(3_000, "url-b");
  await admit(4_000, "url-c");
  await admit(5_000, "url-d");
  const limited = await (await admit(6_000, "url-e")).json();
  assert.equal(limited.allowed, false);
  assert.ok(limited.retryAfterMs > 0);
});

test("gate admits a bounded exploration batch atomically", async () => {
  const values = new Map();
  const gate = new FrontmendAuditGate({
    storage: {
      get: async (key) => values.get(key),
      put: async (key, value) => values.set(key, structuredClone(value)),
    },
  });
  const admitBatch = (items, now) =>
    gate.fetch(new Request("https://frontmend.internal/admit-batch", {
      method: "POST",
      body: JSON.stringify({ fingerprint: "client-a", items, now }),
    }));

  const first = await (await admitBatch(
    [{ urlHash: "route-a" }, { urlHash: "route-b" }, { urlHash: "route-c" }],
    1_000,
  )).json();
  assert.equal(first.allowed, true);
  assert.equal(first.admissions.length, 3);
  const retainedAfterFirst = structuredClone(values.get("gate"));

  const rejected = await (await admitBatch(
    [{ urlHash: "route-d" }, { urlHash: "route-e" }, { urlHash: "route-f" }],
    2_000,
  )).json();
  assert.equal(rejected.allowed, false);
  assert.deepEqual(values.get("gate"), retainedAfterFirst);
});

test("gate enforces a service-wide provider budget", async () => {
  const values = new Map();
  const gate = new FrontmendAuditGate({
    storage: {
      get: async (key) => values.get(key),
      put: async (key, value) => values.set(key, structuredClone(value)),
    },
  });
  let result;
  for (let index = 0; index <= 60; index += 1) {
    result = await (
      await gate.fetch(
        new Request("https://frontmend.internal/admit", {
          method: "POST",
          body: JSON.stringify({
            fingerprint: `client-${index}`,
            urlHash: `url-${index}`,
            now: 1_000 + index,
          }),
        }),
      )
    ).json();
  }
  assert.equal(result.allowed, false);
  assert.ok(result.retryAfterMs > 0);
});

test("expired audit jobs remove their retained state", async () => {
  let deleted = false;
  const job = new FrontmendAuditJob(
    { storage: { deleteAll: async () => { deleted = true; } } },
    {},
  );
  await job.alarm();
  assert.equal(deleted, true);
});

test("audit jobs export portable receipts only for completed verification proof", async () => {
  const auditId = "c1de4f26-c222-4e44-a7e5-884ba6d9fe9a";
  const state = {
    id: auditId,
    status: "complete",
    report: {
      auditId,
      url: "https://removemyexif.com/",
      verification: {
        status: "still-present",
        findingId: "document-content-security-policy",
        findingTitle: "No Content Security Policy header was observed",
        findingSource: {
          provider: "Frontmend document audit",
          auditId: "content-security-policy",
          strategy: "document",
        },
        ruleOutcome: "failed",
        comparable: true,
        metricComparable: true,
        comparisonReason: "exact-document-rule",
        completedAt: 1_787_766_200_000,
        proof: {
          baseline: { auditId: "baseline-audit", score: 89, findingCount: 1, checks: { passed: 8 } },
          current: { auditId, score: 89, findingCount: 1, checks: { passed: 8 } },
          deltas: { score: 0, checksPassed: 0, findings: 0 },
        },
        lineage: { entries: [] },
      },
    },
  };
  const job = new FrontmendAuditJob(
    { storage: { get: async (key) => key === "state" ? state : undefined } },
    {},
  );
  const response = await job.fetch(new Request("https://frontmend.internal/receipt"));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/markdown/);
  assert.match(response.headers.get("content-disposition"), new RegExp(auditId));
  assert.match(await response.text(), /Evidence artifact only/);
});

test("audit jobs export completed audit evidence and reject incomplete jobs", async () => {
  const auditId = "b8b16bf0-913c-40ea-a741-bb4bf76d326b";
  const complete = {
    id: auditId,
    status: "complete",
    report: {
      auditId,
      url: "https://removemyexif.com/",
      finalUrl: "https://removemyexif.com/",
      completedAt: 1_787_766_200_000,
      score: 89,
      viewportCount: 0,
      viewports: [{ id: "document", label: "Document", detail: "Live HTML" }],
      findingCount: 1,
      checks: { passed: 8, warnings: 1, failed: 0 },
      findings: [{
        id: "document-content-security-policy",
        title: "No Content Security Policy header was observed",
        severity: "low",
        category: "Security",
        evidence: "The Content-Security-Policy response header was absent.",
        repair: "Introduce a tested Content Security Policy.",
        source: {
          provider: "Frontmend document audit",
          auditId: "content-security-policy",
          strategy: "document",
        },
      }],
      ruleOutcomes: [{
        source: {
          provider: "Frontmend document audit",
          auditId: "content-security-policy",
          strategy: "document",
        },
        status: "failed",
      }],
      engine: {
        mode: "live-document",
        provider: "Frontmend document audit",
        ruleSetVersion: 1,
        notice: "Live HTML and response-header evidence from the public page.",
      },
    },
  };
  const completeJob = new FrontmendAuditJob(
    { storage: { get: async (key) => key === "state" ? complete : undefined } },
    {},
  );
  const response = await completeJob.fetch(new Request("https://frontmend.internal/report"));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/markdown/);
  assert.match(response.headers.get("content-disposition"), new RegExp(auditId));
  assert.equal(response.headers.get("cache-control"), "no-store");
  const artifact = await response.text();
  assert.match(artifact, /Score \| Checks passed/);
  assert.match(artifact, /content-security-policy/);
  assert.match(artifact, /does not claim it deployed, changed/);

  const queuedJob = new FrontmendAuditJob(
    { storage: { get: async (key) => key === "state" ? { ...complete, status: "queued", report: null } : undefined } },
    {},
  );
  const queued = await queuedJob.fetch(new Request("https://frontmend.internal/report"));
  assert.equal(queued.status, 409);
  assert.equal((await queued.json()).error.code, "AUDIT_NOT_READY");
});

test("audit jobs persist one repair per finding and require human approval before export", async () => {
  const values = new Map([
    [
      "state",
      {
        id: "b8b16bf0-913c-40ea-a741-bb4bf76d326b",
        url: "https://removemyexif.com/",
        source: "agent",
        status: "complete",
        phase: "complete",
        progress: 100,
        report: {
          auditId: "b8b16bf0-913c-40ea-a741-bb4bf76d326b",
          url: "https://removemyexif.com/",
          finalUrl: "https://removemyexif.com/",
          engine: { mode: "live-document" },
          findings: [
            {
              id: "document-content-security-policy",
              title: "No Content Security Policy header was observed",
              severity: "low",
              repair: "Introduce a tested Content Security Policy.",
              source: {
                provider: "Frontmend document audit",
                auditId: "content-security-policy",
                strategy: "document",
              },
              repairContext: {
                type: "csp-resource-inventory",
                directives: [
                  { directive: "script-src", origins: ["https://scripts.example.net"], omitted: 0 },
                ],
                inline: { scripts: 1, styles: 0 },
              },
            },
          ],
        },
      },
    ],
  ]);
  const job = new FrontmendAuditJob(
    {
      storage: {
        get: async (key) => values.get(key),
        put: async (key, value) => values.set(key, structuredClone(value)),
      },
    },
    {},
  );
  const stage = () =>
    job.fetch(
      new Request("https://frontmend.internal/repairs", {
        method: "POST",
        body: JSON.stringify({
          findingId: "document-content-security-policy",
          source: "agent",
          repositoryFiles: ["worker/index.js", "tests/sites-worker.test.mjs"],
          repositoryChecks: ["bun test", "bun run build"],
        }),
      }),
    );

  const firstResponse = await stage();
  const first = (await firstResponse.json()).data;
  const replay = (await (await stage()).json()).data;
  assert.equal(firstResponse.status, 201);
  assert.equal(replay.id, first.id);
  assert.match(first.patch, /script-src 'self' https:\/\/scripts\.example\.net/);
  assert.equal(values.get("repairs").length, 1);
  assert.equal(first.mission.state, "awaiting-human-review");
  assert.deepEqual(first.repositoryPlan.files, ["worker/index.js", "tests/sites-worker.test.mjs"]);
  assert.deepEqual(first.repositoryPlan.checks, ["bun test", "bun run build"]);
  assert.deepEqual(first.mission.nextActions, [{ id: "review_in_ui", actor: "person" }]);

  const changesResponse = await job.fetch(
    new Request(`https://frontmend.internal/repairs/${first.id}/changes`, {
      method: "POST",
      body: JSON.stringify({ feedback: "Add a reporting endpoint before I approve this policy." }),
    }),
  );
  const changesRequested = (await changesResponse.json()).data;
  assert.equal(changesRequested.status, "changes-requested");
  assert.equal(changesRequested.mission.state, "changes-requested");
  assert.match(changesRequested.changeRequest.feedback, /reporting endpoint/);

  const blockedApproval = await job.fetch(
    new Request(`https://frontmend.internal/repairs/${first.id}/approve`, {
      method: "POST",
      body: "{}",
    }),
  );
  assert.equal(blockedApproval.status, 409);
  assert.equal((await blockedApproval.json()).error.code, "CHANGES_REQUESTED");

  const impersonatedRevision = await job.fetch(
    new Request(`https://frontmend.internal/repairs/${first.id}/revise`, {
      method: "POST",
      body: JSON.stringify({ source: "human", patch: `${first.patch}; report-uri /wrong` }),
    }),
  );
  assert.equal(impersonatedRevision.status, 400);
  assert.equal((await impersonatedRevision.json()).error.code, "INVALID_REPAIR");

  const revisionResponse = await job.fetch(
    new Request(`https://frontmend.internal/repairs/${first.id}/revise`, {
      method: "POST",
      body: JSON.stringify({
        source: "agent",
        patch: `${first.patch}; report-uri /csp-report`,
        verificationPlan: "Exercise critical journeys and confirm CSP reports arrive before enforcement.",
      }),
    }),
  );
  const revisedRepair = (await revisionResponse.json()).data;
  assert.equal(revisedRepair.status, "draft");
  assert.equal(revisedRepair.revision, 2);
  assert.equal(revisedRepair.revisionHistory.length, 1);
  assert.match(revisedRepair.patch, /report-uri \/csp-report/);
  assert.deepEqual(revisedRepair.repositoryPlan.files, first.repositoryPlan.files);

  const earlyExport = await job.fetch(
    new Request(`https://frontmend.internal/repairs/${first.id}/export`),
  );
  assert.equal(earlyExport.status, 409);

  const approved = await job.fetch(
    new Request(`https://frontmend.internal/repairs/${first.id}/approve`, {
      method: "POST",
      body: "{}",
    }),
  );
  const approvedRepair = (await approved.json()).data;
  assert.equal(approvedRepair.status, "approved");
  assert.equal(approvedRepair.mission.targetMutation, "external-only");
  assert.equal(approvedRepair.mission.state, "awaiting-external-deployment");
  assert.equal(
    approvedRepair.mission.steps.find((step) => step.id === "verify").status,
    "blocked",
  );

  const humanImplementation = await job.fetch(
    new Request(`https://frontmend.internal/repairs/${first.id}/implementation`, {
      method: "POST",
      body: JSON.stringify({
        summary: "Applied the approved policy.",
        files: ["worker/index.js"],
        checks: [{ name: "bun test", status: "passed" }],
      }),
    }),
  );
  assert.equal(humanImplementation.status, 400);
  assert.equal((await humanImplementation.json()).error.code, "INVALID_IMPLEMENTATION_RECEIPT");

  const implementationResponse = await job.fetch(
    new Request(`https://frontmend.internal/repairs/${first.id}/implementation`, {
      method: "POST",
      body: JSON.stringify({
        source: "agent",
        summary: "Applied the approved report-only policy in the Worker response path.",
        files: ["worker/index.js", "tests/sites-worker.test.mjs"],
        checks: [
          { name: "bun test", status: "passed" },
          { name: "bun run build", status: "failed" },
        ],
      }),
    }),
  );
  const implementedRepair = (await implementationResponse.json()).data;
  assert.equal(implementationResponse.status, 200);
  assert.equal(implementedRepair.implementationReceipt.source, "agent");
  assert.equal(implementedRepair.implementationReceipt.sourceChangedByFrontmend, false);
  assert.equal(
    implementedRepair.mission.steps.find((step) => step.id === "implement").status,
    "attention",
  );
  assert.equal(implementedRepair.mission.implementationEvidence, "checks-failed");
  assert.equal(implementedRepair.mission.state, "implementation-attention");
  assert.equal(implementedRepair.deploymentAttestedAt, null);

  const implementationRerunResponse = await job.fetch(
    new Request(`https://frontmend.internal/repairs/${first.id}/implementation`, {
      method: "POST",
      body: JSON.stringify({
        source: "agent",
        summary: "Corrected the fixture and re-ran the approved implementation checks.",
        files: ["worker/index.js", "tests/sites-worker.test.mjs"],
        checks: [
          { name: "bun test", status: "passed" },
          { name: "bun run build", status: "passed" },
        ],
      }),
    }),
  );
  const implementationRerun = (await implementationRerunResponse.json()).data;
  assert.equal(implementationRerun.implementationReceipt.revision, 2);
  assert.equal(implementationRerun.implementationHistory.length, 1);
  assert.equal(implementationRerun.implementationHistory[0].checks[1].status, "failed");
  assert.equal(implementationRerun.mission.implementationEvidence, "checks-passed");
  assert.equal(
    implementationRerun.mission.steps.find((step) => step.id === "implement").status,
    "complete",
  );

  const exportResponse = await job.fetch(
    new Request(`https://frontmend.internal/repairs/${first.id}/export`),
  );
  assert.equal(exportResponse.status, 200);
  assert.match(exportResponse.headers.get("content-type"), /text\/markdown/);
  const exportText = await exportResponse.text();
  assert.match(exportText, /does not claim the target site was changed/i);
  assert.match(exportText, /## Repository plan/);
  assert.match(exportText, /`worker\/index\.js`/);

  const earlyVerificationInput = await job.fetch(
    new Request(`https://frontmend.internal/repairs/${first.id}/verification-input`),
  );
  assert.equal(earlyVerificationInput.status, 409);
  assert.equal((await earlyVerificationInput.json()).error.code, "DEPLOYMENT_NOT_ATTESTED");

  const deploymentResponse = await job.fetch(
    new Request(`https://frontmend.internal/repairs/${first.id}/deployment`, {
      method: "POST",
      body: "{}",
    }),
  );
  const deployedRepair = (await deploymentResponse.json()).data;
  assert.equal(deployedRepair.mission.state, "ready-for-verification");
  assert.equal(deployedRepair.mission.deploymentEvidence, "site-owner-attestation");
  assert.equal(
    deployedRepair.mission.steps.find((step) => step.id === "deploy").status,
    "attested",
  );
  assert.equal(Number.isFinite(deployedRepair.deploymentAttestedAt), true);

  const verificationInput = await job.fetch(
    new Request(`https://frontmend.internal/repairs/${first.id}/verification-input`),
  );
  const verification = (await verificationInput.json()).data;
  assert.equal(verification.repairId, first.id);
  assert.equal(verification.deploymentAttestedAt, deployedRepair.deploymentAttestedAt);
  assert.equal(verification.implementationReceipt.revision, 2);
  assert.equal(verification.implementationReceipt.source, "agent");
  assert.equal(verification.implementationReceipt.checks[1].status, "passed");
  assert.notEqual(verification.implementationReceipt, implementationRerun.implementationReceipt);
  assert.equal(verification.baselineEngine.mode, "live-document");
  assert.equal(verification.findingScope.sources.length, 1);
  assert.equal(verification.findingScope.sources[0].strategy, "document");
  assert.equal(verification.baseline.auditId, "b8b16bf0-913c-40ea-a741-bb4bf76d326b");
  assert.equal(verification.baseline.exactRuleOutcome, "missing");
  assert.equal(verification.lineage.rootAuditId, "b8b16bf0-913c-40ea-a741-bb4bf76d326b");
  assert.equal(verification.lineage.entries.length, 1);
});

test("audit jobs persist a scoped auto policy and authorise only an eligible agent mission", async () => {
  const values = new Map([["state", {
    id: "b8b16bf0-913c-40ea-a741-bb4bf76d326b",
    url: "https://example.com/",
    source: "human",
    status: "complete",
    phase: "complete",
    progress: 100,
    report: {
      auditId: "b8b16bf0-913c-40ea-a741-bb4bf76d326b",
      url: "https://example.com/",
      finalUrl: "https://example.com/",
      engine: { mode: "live-lighthouse", provider: "PageSpeed Insights", ruleSetVersion: 1 },
      findings: [{
        id: "mobile-color-contrast-1",
        title: "A control has insufficient contrast",
        severity: "medium",
        repair: "Adjust the control colour tokens.",
        source: { provider: "Lighthouse", auditId: "color-contrast", strategy: "mobile" },
      }],
    },
  }]]);
  const job = new FrontmendAuditJob({
    storage: {
      get: async (key) => values.get(key),
      put: async (key, value) => values.set(key, structuredClone(value)),
    },
  }, {});

  const policyResponse = await job.fetch(new Request("https://frontmend.internal/repair-policy", {
    method: "POST",
    body: JSON.stringify({ mode: "auto-low-risk" }),
  }));
  const policy = (await policyResponse.json()).data;
  assert.equal(policy.mode, "auto-low-risk");
  assert.equal(policy.remainingAutoApprovals, 3);

  const stageResponse = await job.fetch(new Request("https://frontmend.internal/repairs", {
    method: "POST",
    body: JSON.stringify({
      findingId: "mobile-color-contrast-1",
      source: "agent",
      summary: "Adjust the measured control token without changing hierarchy.",
      patchType: "css",
      patch: "Update the foreground token used by the affected control.",
      verificationPlan: "Rerun color-contrast in every captured strategy and check focus states.",
      risk: "low",
      repositoryFiles: ["src/styles.css"],
      repositoryChecks: ["bun test", "bun run build"],
    }),
  }));
  const repair = (await stageResponse.json()).data;
  assert.equal(repair.status, "approved");
  assert.equal(repair.approval.mode, "delegated-auto");
  assert.equal(repair.mission.approvalEvidence, "prior-human-auto-policy");
  assert.equal(repair.mission.deploymentEvidence, "none");
  assert.equal(values.get("repairPolicy").remainingAutoApprovals, 2);

  const workspace = (await (await job.fetch(new Request("https://frontmend.internal/repairs"))).json()).data;
  assert.equal(workspace.policy.remainingAutoApprovals, 2);
  assert.equal(workspace.repairs[0].approval.mode, "delegated-auto");
});

test("builds and emits the files required by Sites packaging", { timeout: 30_000 }, async () => {
  await ensureSitesBuild();
  await access(new URL("../dist/client/index.html", import.meta.url));
  await access(new URL("../dist/server/index.js", import.meta.url));
  await access(new URL("../dist/.openai/hosting.json", import.meta.url));
  const server = await readFile(new URL("../dist/server/index.js", import.meta.url), "utf8");
  assert.match(server, /FrontmendAuditJob/);
  assert.doesNotMatch(server, /from ["'].+url-policy/);
});
