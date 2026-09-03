import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import worker, { FrontmendAuditGate, FrontmendAuditJob } from "../worker/index.js";
import { createLocalAuditRuntime } from "../worker/local-runtime.js";
import { hashAuditSessionToken } from "../src/audit-session-contract.js";
import { compareVerification } from "../src/repair-contract.js";
import { FRONTMEND_TOOL_COUNT } from "../src/protocol-contract.js";

const execFileAsync = promisify(execFile);
const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const localRuntimeCookies = new WeakMap();
const TEST_AUDIT_COOKIE = "__Host-frontmend_session=11111111-1111-4111-8111-111111111111";
const TEST_OTHER_AUDIT_COOKIE = "__Host-frontmend_session=22222222-2222-4222-8222-222222222222";
const TEST_AGENT_CAPABILITIES = {
  visualBrowserAccess: true,
  responsiveEmulation: true,
  runtimeDiagnostics: true,
  repositoryAccess: true,
  terminalExecution: true,
};

function preparedAuditMission(findingId, focusAreas = []) {
  return {
    schemaVersion: 1,
    intent: "prepare-fix",
    focusAreas,
    maxPriorities: 3,
    requestedBy: "human",
    requestedAt: 10,
    repairPreparation: { findingId, requestedBy: "human", requestedAt: 20 },
  };
}

async function ensureSitesBuild() {
  await execFileAsync("bun", ["run", "build"], {
    cwd: projectRoot,
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
  });
}

function callLocalRuntime(middleware, { method = "GET", url, body = "", headers = {} }) {
  return new Promise((resolve, reject) => {
    const requestHeaders = { ...headers };
    if (!("cookie" in requestHeaders) && localRuntimeCookies.has(middleware)) {
      requestHeaders.cookie = localRuntimeCookies.get(middleware);
    }
    const request = Readable.from(body ? [Buffer.from(body)] : []);
    Object.assign(request, {
      method,
      url,
      headers: requestHeaders,
      socket: { remoteAddress: "127.0.0.1" },
    });
    const responseHeaders = new Map();
    const response = {
      statusCode: 200,
      setHeader(name, value) {
        responseHeaders.set(name.toLowerCase(), String(value));
      },
      end(value = "") {
        const setCookie = responseHeaders.get("set-cookie");
        if (setCookie) localRuntimeCookies.set(middleware, setCookie.split(";", 1)[0]);
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

function withAuditAuthorization(fetchImpl) {
  return async (url, init = {}) => {
    if (new URL(url).pathname === "/authorize") {
      return Response.json({ ok: true, data: { writeAccess: "read-write" } });
    }
    return fetchImpl(url, init);
  };
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

test("exposes a cache-safe public build descriptor without allocating an audit", async () => {
  const response = await worker.fetch(new Request("https://example.test/api/version"), {
    FRONTMEND_BUILD_COMMIT: "c".repeat(40),
    FRONTMEND_BUILT_AT: "2026-09-01T04:00:00.000Z",
    FRONTMEND_SOURCE_DIRTY: "false",
    FRONTMEND_VERSION: { id: "worker-version-1", tag: "c".repeat(40) },
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(payload.data.app, "frontmend");
  assert.equal(payload.data.commit, "c".repeat(40));
  assert.equal(payload.data.buildIdentified, true);
  assert.equal(payload.data.toolCount, FRONTMEND_TOOL_COUNT);
  assert.equal(payload.data.deploymentVersion, "worker-version-1");
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
      body: JSON.stringify({
        url: "removemyexif.com",
        source: "agent",
        mission: { intent: "assess", focusAreas: ["accessibility", "seo"], maxPriorities: 2 },
      }),
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
  assert.match(response.headers.get("set-cookie"), /^__Host-frontmend_session=.*; Path=\/; HttpOnly; SameSite=Strict; Max-Age=86400; Secure$/);
  assert.equal(response.headers.get("location"), `/api/audits/${jobId}`);
  assert.equal(calls[0].input.url, "https://removemyexif.com/");
  assert.equal(calls[0].input.source, "agent");
  assert.equal(calls[0].input.mission.intent, "assess");
  assert.deepEqual(calls[0].input.mission.focusAreas, ["accessibility", "seo"]);
  assert.equal(calls[0].input.mission.maxPriorities, 2);
  assert.equal(calls[0].input.mission.requestedBy, "agent");
  assert.equal(calls[0].input.mission.repairPreparation, null);
  assert.match(calls[0].input.ownerSessionHash, /^[a-f0-9]{64}$/);
});

test("uses semantic audit missions in production admission identity", async () => {
  const admissions = [];
  let sequence = 0;
  const env = {
    AUDIT_GATE: {
      idFromName: (name) => name,
      get: () => ({
        fetch: async (_url, init) => {
          admissions.push(JSON.parse(init.body));
          sequence += 1;
          return Response.json({
            allowed: true,
            jobId: `b8b16bf0-913c-4${String(sequence).padStart(3, "0")}-8aaa-bb4bf76d326b`,
            reused: false,
          });
        },
      }),
    },
    AUDIT_JOBS: {
      idFromName: (name) => name,
      get: (id) => ({
        fetch: async (_url, init) => Response.json({
          ok: true,
          data: { id, ...JSON.parse(init.body), status: "queued" },
        }, { status: 202 }),
      }),
    },
  };
  const start = (focusAreas, cookie = TEST_AUDIT_COOKIE) => worker.fetch(new Request("https://frontmend.test/api/audits", {
    method: "POST",
    headers: { origin: "https://frontmend.test", "content-type": "application/json", cookie },
    body: JSON.stringify({ url: "example.com", source: "agent", mission: { focusAreas } }),
  }), env);

  assert.equal((await start(["accessibility", "seo"])).status, 202);
  assert.equal((await start(["seo", "accessibility"])).status, 202);
  assert.equal((await start(["seo"])).status, 202);
  assert.equal((await start(["accessibility", "seo"], TEST_OTHER_AUDIT_COOKIE)).status, 202);
  assert.equal(admissions[0].urlHash, admissions[1].urlHash);
  assert.notEqual(admissions[1].urlHash, admissions[2].urlHash);
  assert.notEqual(admissions[0].urlHash, admissions[3].urlHash);
  assert.equal(JSON.stringify(admissions).includes("accessibility"), false);
});

test("keeps shared audit reads public while owner-gating every mutation", async () => {
  const auditId = "b8b16bf0-913c-40ea-a741-bb4bf76d326b";
  const expectedOwnerHash = await hashAuditSessionToken(TEST_AUDIT_COOKIE.split("=", 2)[1]);
  let mutations = 0;
  const env = {
    AUDIT_JOBS: {
      idFromName: (name) => name,
      get: () => ({
        fetch: async (url, init = {}) => {
          const pathname = new URL(url).pathname;
          if (pathname === "/authorize") {
            const authorized = init.headers["x-frontmend-owner-session-hash"] === expectedOwnerHash;
            return authorized
              ? Response.json({ ok: true, data: { writeAccess: "read-write" } })
              : Response.json({ ok: false, error: { code: "AUDIT_WRITE_AUTHORITY_REQUIRED" } }, { status: 403 });
          }
          if (pathname === "/checkpoint" && (init.method ?? "GET") === "GET") {
            return Response.json({ ok: true, data: { auditId, missionRevision: 1 } });
          }
          mutations += 1;
          return Response.json({ ok: true, data: { id: auditId, status: "cancelled" } });
        },
      }),
    },
  };

  const sharedRead = await worker.fetch(
    new Request(`https://frontmend.test/api/audits/${auditId}/checkpoint`),
    env,
  );
  assert.equal(sharedRead.status, 200);

  for (const cookie of [null, TEST_OTHER_AUDIT_COOKIE]) {
    const headers = { origin: "https://frontmend.test" };
    if (cookie) headers.cookie = cookie;
    const denied = await worker.fetch(new Request(`https://frontmend.test/api/audits/${auditId}`, {
      method: "DELETE",
      headers,
    }), env);
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).error.code, "AUDIT_WRITE_AUTHORITY_REQUIRED");
  }

  const allowed = await worker.fetch(new Request(`https://frontmend.test/api/audits/${auditId}`, {
    method: "DELETE",
    headers: { origin: "https://frontmend.test", cookie: TEST_AUDIT_COOKIE },
  }), env);
  assert.equal(allowed.status, 200);
  assert.equal(mutations, 1);
});

test("keeps the anonymous owner hash private in Durable Object snapshots", async () => {
  const ownerSessionHash = await hashAuditSessionToken(TEST_AUDIT_COOKIE.split("=", 2)[1]);
  const state = {
    id: "private-owner-snapshot",
    url: "https://example.com/",
    source: "human",
    ownerSessionHash,
    missionRevision: 1,
    status: "queued",
    phase: "queued",
    phaseLabel: "Queued",
    progress: 4,
    report: null,
    error: null,
  };
  const job = new FrontmendAuditJob({
    storage: {
      get: async (key) => key === "state" ? state : undefined,
    },
  }, {});

  const snapshot = await job.fetch(new Request("https://frontmend.internal/"));
  const authorized = await job.fetch(new Request("https://frontmend.internal/authorize", {
    headers: { "x-frontmend-owner-session-hash": ownerSessionHash },
  }));
  const denied = await job.fetch(new Request("https://frontmend.internal/authorize", {
    headers: { "x-frontmend-owner-session-hash": "f".repeat(64) },
  }));

  assert.equal(snapshot.status, 200);
  assert.equal((await snapshot.text()).includes(ownerSessionHash), false);
  assert.equal(authorized.status, 200);
  assert.equal(denied.status, 403);
});

test("proxies the bounded repair-intent transition to the authoritative audit job", async () => {
  const auditId = "b8b16bf0-913c-40ea-a741-bb4bf76d326b";
  const calls = [];
  const response = await worker.fetch(new Request(
    `https://frontmend.test/api/audits/${auditId}/mission/prepare-repair`,
    {
      method: "POST",
      headers: { origin: "https://frontmend.test", "content-type": "application/json", cookie: TEST_AUDIT_COOKIE },
      body: JSON.stringify({ findingId: "document-description", source: "human" }),
    },
  ), {
    AUDIT_JOBS: {
      idFromName: (name) => name,
      get: () => ({
        fetch: withAuditAuthorization(async (url, init) => {
          calls.push({ url: new URL(url), input: JSON.parse(init.body) });
          return Response.json({ ok: true, data: { mission: { intent: "prepare-fix" } } });
        }),
      }),
    },
  });

  assert.equal(response.status, 200);
  assert.equal(calls[0].url.pathname, "/mission/prepare-repair");
  assert.deepEqual(calls[0].input, {
    findingId: "document-description",
    source: "human",
  });
});

test("proxies a bounded diagnostic blocker to the authoritative audit job", async () => {
  const auditId = "b8b16bf0-913c-40ea-a741-bb4bf76d326b";
  const missionId = "8cb30d34-76ce-4c47-a67e-d568b1db4d0a";
  const calls = [];
  const response = await worker.fetch(new Request(
    `https://frontmend.test/api/audits/${auditId}/diagnostics/${missionId}/blocker`,
    {
      method: "POST",
      headers: { origin: "https://frontmend.test", "content-type": "application/json", cookie: TEST_AUDIT_COOKIE },
      body: JSON.stringify({
        reason: "repository-unavailable",
        summary: "The deployment repository is unavailable in this session.",
        source: "agent",
      }),
    },
  ), {
    AUDIT_JOBS: {
      idFromName: (name) => name,
      get: () => ({
        fetch: withAuditAuthorization(async (url, init) => {
          calls.push({ url: new URL(url), input: JSON.parse(init.body) });
          return Response.json({ ok: true, data: { id: missionId, state: { state: "blocked" } } });
        }),
      }),
    },
  });

  assert.equal(response.status, 200);
  assert.equal(calls[0].url.pathname, `/diagnostics/${missionId}/blocker`);
  assert.deepEqual(calls[0].input, {
    reason: "repository-unavailable",
    summary: "The deployment repository is unavailable in this session.",
    source: "agent",
  });
});

test("proxies a sequenced browser-review contribution to the authoritative audit job", async () => {
  const auditId = "b8b16bf0-913c-40ea-a741-bb4bf76d326b";
  const reviewId = "8cb30d34-76ce-4c47-a67e-d568b1db4d0a";
  const calls = [];
  const body = {
    checkId: "rendered-structure",
    outcome: "passed",
    summary: "The rendered structure was inspected.",
    observations: ["One primary heading is rendered."],
    source: "agent",
  };
  const response = await worker.fetch(new Request(
    `https://frontmend.test/api/audits/${auditId}/browser-review/${reviewId}/checks`,
    {
      method: "POST",
      headers: { origin: "https://frontmend.test", "content-type": "application/json", cookie: TEST_AUDIT_COOKIE },
      body: JSON.stringify(body),
    },
  ), {
    AUDIT_JOBS: {
      idFromName: (name) => name,
      get: () => ({
        fetch: withAuditAuthorization(async (url, init) => {
          calls.push({ url: new URL(url), input: JSON.parse(init.body) });
          return Response.json({ ok: true, data: { id: reviewId, state: { status: "in-progress" } } });
        }),
      }),
    },
  });

  assert.equal(response.status, 200);
  assert.equal(calls[0].url.pathname, `/browser-review/${reviewId}/checks`);
  assert.deepEqual(calls[0].input, body);
});

test("proxies a same-origin human browser-review withdrawal to the authoritative audit job", async () => {
  const auditId = "b8b16bf0-913c-40ea-a741-bb4bf76d326b";
  const reviewId = "8cb30d34-76ce-4c47-a67e-d568b1db4d0a";
  const calls = [];
  const body = { source: "person", expectedMissionRevision: 4 };
  const response = await worker.fetch(new Request(
    `https://frontmend.test/api/audits/${auditId}/browser-review/${reviewId}/withdrawal`,
    {
      method: "POST",
      headers: { origin: "https://frontmend.test", "content-type": "application/json", cookie: TEST_AUDIT_COOKIE },
      body: JSON.stringify(body),
    },
  ), {
    AUDIT_JOBS: {
      idFromName: (name) => name,
      get: () => ({
        fetch: withAuditAuthorization(async (url, init) => {
          calls.push({ url: new URL(url), input: JSON.parse(init.body) });
          return Response.json({ ok: true, data: { id: reviewId, state: { status: "withdrawn" } } });
        }),
      }),
    },
  });

  assert.equal(response.status, 200);
  assert.equal(calls[0].url.pathname, `/browser-review/${reviewId}/withdrawal`);
  assert.deepEqual(calls[0].input, body);
});

test("proxies audit-scoped activity reads and privacy-safe appends", async () => {
  const auditId = "b8b16bf0-913c-40ea-a741-bb4bf76d326b";
  const activity = {
    id: "activity-1",
    tool: "get_mission_summary",
    title: "Read mission summary",
    status: "succeeded",
    actorClass: "webmcp-agent",
    auditId,
    repairId: null,
    diagnosticMissionId: null,
    browserReviewId: null,
    explorationId: null,
    errorCode: null,
    missionRevisionBefore: 4,
    missionRevisionAfter: 4,
    startedAt: 100,
    completedAt: 110,
  };
  const calls = [];
  const env = {
    AUDIT_JOBS: {
      idFromName: (name) => name,
      get: () => ({
        fetch: withAuditAuthorization(async (url, init = {}) => {
          calls.push({ pathname: new URL(url).pathname, method: init.method, body: init.body });
          return Response.json({ ok: true, data: { auditId, activities: [activity] } });
        }),
      }),
    },
  };

  const read = await worker.fetch(
    new Request(`https://frontmend.test/api/audits/${auditId}/activities`),
    env,
  );
  const append = await worker.fetch(new Request(
    `https://frontmend.test/api/audits/${auditId}/activities`,
    {
      method: "POST",
      headers: { origin: "https://frontmend.test", "content-type": "application/json", cookie: TEST_AUDIT_COOKIE },
      body: JSON.stringify(activity),
    },
  ), env);

  assert.equal(read.status, 200);
  assert.equal(append.status, 200);
  assert.deepEqual(calls.map((call) => [call.pathname, call.method]), [
    ["/activities", "GET"],
    ["/activities", "POST"],
  ]);
  assert.deepEqual(JSON.parse(calls[1].body), activity);
});

test("proxies server-issued verification candidates and aggregate repair receipts", async () => {
  const auditId = "b8b16bf0-913c-40ea-a741-bb4bf76d326b";
  const repairId = "3e8fe191-1f46-4f1b-92ac-492a5d73bb24";
  const calls = [];
  const env = {
    AUDIT_JOBS: {
      idFromName: (name) => name,
      get: () => ({
        fetch: async (url) => {
          const path = new URL(url).pathname;
          calls.push(path);
          if (path.endsWith("verification-receipt")) {
            return new Response("# Aggregate receipt", { headers: { "content-type": "text/markdown" } });
          }
          return Response.json({ ok: true, data: path === "/verification-candidates"
            ? { candidates: [{ id: "audit:pricing", path: "/pricing" }] }
            : { repairId, status: "resolved", rows: [] } });
        },
      }),
    },
  };
  const candidates = await worker.fetch(new Request(
    `https://frontmend.test/api/audits/${auditId}/verification-candidates?findingId=color-contrast`,
  ), env);
  const aggregate = await worker.fetch(new Request(
    `https://frontmend.test/api/audits/${auditId}/repairs/${repairId}/verification`,
  ), env);
  const receipt = await worker.fetch(new Request(
    `https://frontmend.test/api/audits/${auditId}/repairs/${repairId}/verification/receipt`,
  ), env);
  assert.equal((await candidates.json()).data.candidates[0].path, "/pricing");
  assert.equal((await aggregate.json()).data.status, "resolved");
  assert.match(await receipt.text(), /Aggregate receipt/);
  assert.deepEqual(calls, [
    "/verification-candidates",
    `/repairs/${repairId}/verification`,
    `/repairs/${repairId}/verification-receipt`,
  ]);
});

test("keeps candidate review reads public while owner-gating exact revision-bound writes", async () => {
  const auditId = "b8b16bf0-913c-40ea-a741-bb4bf76d326b";
  const repairId = "3e8fe191-1f46-4f1b-92ac-492a5d73bb24";
  const calls = [];
  const env = {
    AUDIT_JOBS: {
      idFromName: (name) => name,
      get: () => ({
        fetch: withAuditAuthorization(async (url, init = {}) => {
          calls.push({ pathname: new URL(url).pathname, method: init.method, body: init.body });
          return Response.json({ ok: true, data: { auditId, id: repairId } });
        }),
      }),
    },
  };
  const candidateUrl = `https://frontmend.test/api/audits/${auditId}/repairs/${repairId}/candidate-review`;

  const read = await worker.fetch(new Request(candidateUrl), env);
  const denied = await worker.fetch(new Request(candidateUrl, {
    method: "POST",
    headers: { origin: "https://frontmend.test", "content-type": "application/json" },
    body: JSON.stringify({
      candidateOrigin: "http://localhost:5173",
      source: "agent",
      expectedMissionRevision: 7,
    }),
  }), env);
  const opened = await worker.fetch(new Request(candidateUrl, {
    method: "POST",
    headers: {
      origin: "https://frontmend.test",
      "content-type": "application/json",
      cookie: TEST_AUDIT_COOKIE,
    },
    body: JSON.stringify({
      candidateOrigin: "http://localhost:5173",
      source: "agent",
      expectedMissionRevision: 7,
    }),
  }), env);
  const recorded = await worker.fetch(new Request(`${candidateUrl}/checks`, {
    method: "POST",
    headers: {
      origin: "https://frontmend.test",
      "content-type": "application/json",
      cookie: TEST_AUDIT_COOKIE,
    },
    body: JSON.stringify({
      reviewId: "candidate-review-1",
      checkId: "candidate-replay-1",
      outcome: "passed",
      summary: "The retained symptom is absent.",
      observations: ["The candidate meets the retained acceptance criteria."],
      source: "agent",
      expectedMissionRevision: 8,
    }),
  }), env);

  assert.equal(read.status, 200);
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).error.code, "AUDIT_WRITE_AUTHORITY_REQUIRED");
  assert.equal(opened.status, 200);
  assert.equal(recorded.status, 200);
  assert.deepEqual(calls.map((call) => [call.pathname, call.method]), [
    [`/repairs/${repairId}/candidate-review`, "GET"],
    [`/repairs/${repairId}/candidate-review`, "POST"],
    [`/repairs/${repairId}/candidate-review-checks`, "POST"],
  ]);
  assert.equal(JSON.parse(calls[1].body).candidateOrigin, "http://localhost:5173");
  assert.equal(JSON.parse(calls[2].body).reviewId, "candidate-review-1");
});

test("starts one existing audit job per reviewed verification target", async () => {
  const auditId = "b8b16bf0-913c-40ea-a741-bb4bf76d326b";
  const repairId = "3e8fe191-1f46-4f1b-92ac-492a5d73bb24";
  const runId = "8cb30d34-76ce-4c47-a67e-d568b1db4d0a";
  const childIds = [
    "232d593c-6c81-48c3-b137-a3df269454ff",
    "19474d5a-a536-4cb3-84bf-99f00ba585c0",
  ];
  const source = { provider: "Frontmend document audit", auditId: "description", strategy: "document" };
  const browserRow = (index) => ({
    id: `browser-row-${index}`,
    proofKind: "browser-replay",
    findingId: `browser-finding-${index}`,
    source: { provider: "Frontmend browser review", auditId: `browser-check-${index}`, strategy: index === 1 ? "mobile" : "desktop" },
    baseline: {
      findingId: `browser-finding-${index}`,
      title: `Retained browser issue ${index}`,
      category: "Accessibility",
      focusArea: "accessibility",
      selector: `.target-${index}`,
      evidence: `Retained browser symptom ${index}.`,
      repair: `Repair browser symptom ${index}.`,
      source: { provider: "Frontmend browser review", auditId: `browser-check-${index}`, strategy: index === 1 ? "mobile" : "desktop" },
      browserReviewEvidence: {
        reviewId: "baseline-review",
        checkId: `browser-check-${index}`,
        checkLabel: `Browser check ${index}`,
        provenance: "agent-reported-browser",
        reportedAt: 5,
      },
    },
  });
  const started = [];
  const baselineJob = {
    fetch: withAuditAuthorization(async (url, init = {}) => {
      const path = new URL(url).pathname;
      if (path.endsWith("verification-start-input")) {
        return Response.json({ ok: true, data: {
          repair: {
            id: repairId,
            revision: 1,
            findingId: "description",
            findingTitle: "Description missing",
            findingSource: source,
            findingScope: { sources: [source], occurrenceCount: 1, occurrencesOmitted: 0 },
            status: "approved",
            deploymentAttestedAt: 20,
            approval: { mode: "explicit-review", approvedAt: 10 },
          },
          run: { id: runId },
          targets: ["/", "/docs"].map((pathName, index) => ({
            id: `audit:baseline-${index}`,
            path: pathName,
            url: `https://example.com${pathName}`,
            baselineReport: {
              auditId: `baseline-${index}`,
              url: `https://example.com${pathName}`,
              finalUrl: `https://example.com${pathName}`,
              engine: { mode: "live-document", provider: "Frontmend document audit", ruleSetVersion: 1 },
              ruleOutcomes: [{ source, status: "failed" }],
            },
            rows: [
              { id: `row-${index}`, proofKind: "provider-rule", source },
              ...(index === 0 ? [browserRow(1), browserRow(2)] : []),
            ],
          })),
          missionCheckpoint: { auditId, missionRevision: 8 },
        } });
      }
      if (path.endsWith("verification-assignments")) {
        const input = JSON.parse(init.body);
        assert.deepEqual(input.assignments.map((item) => item.auditId), childIds);
        return Response.json({ ok: true, data: { aggregateVerification: { status: "waiting" } } });
      }
      if (path.endsWith("verification")) {
        return Response.json({ ok: true, data: { repairId, status: "waiting", rows: [] } });
      }
      throw new Error(`Unexpected baseline path ${path}`);
    }),
  };
  const env = {
    AUDIT_GATE: {
      idFromName: (name) => name,
      get: () => ({ fetch: async () => Response.json({
        allowed: true,
        admissions: childIds.map((jobId) => ({ jobId, reused: false })),
      }) }),
    },
    AUDIT_JOBS: {
      idFromName: (name) => name,
      get: (id) => id === auditId ? baselineJob : ({
        fetch: async (_url, init) => {
          const input = JSON.parse(init.body);
          started.push(input);
          return Response.json({ ok: true, data: { id, url: input.url, status: "queued" } }, { status: 202 });
        },
      }),
    },
  };
  const response = await worker.fetch(new Request(
    `https://frontmend.test/api/audits/${auditId}/repairs/${repairId}/verify`,
    {
      method: "POST",
      headers: { origin: "https://frontmend.test", "content-type": "application/json", cookie: TEST_AUDIT_COOKIE },
      body: JSON.stringify({ expectedMissionRevision: 7 }),
    },
  ), env);
  const payload = await response.json();
  assert.equal(response.status, 202);
  assert.deepEqual(payload.data.verificationAuditIds, childIds);
  assert.equal(started.length, 2);
  assert.deepEqual(started.map((item) => item.verification.aggregateMatrix.targetId), [
    "audit:baseline-0",
    "audit:baseline-1",
  ]);
  assert.deepEqual(
    started[0].verification.browserReplays.map((replay) => replay.baseline.findingId),
    ["browser-finding-1", "browser-finding-2"],
  );
  assert.equal(started[0].verification.browserReplay.baseline.findingId, "browser-finding-1");
  assert.deepEqual(started[1].verification.browserReplays, []);
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
        cookie: TEST_AUDIT_COOKIE,
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
          fetch: withAuditAuthorization(async (url, init = {}) => {
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
                  missionCheckpoint: { auditId: parentId, missionRevision: 2 },
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
                missionCheckpoint: { auditId: childId, missionRevision: 1 },
              },
            }, { status: 202 });
          }),
        }),
      },
    },
  );

  assert.equal(response.status, 202);
  assert.equal(response.headers.get("location"), `/api/audits/${childId}`);
  const payload = await response.json();
  assert.equal(payload.data.id, childId);
  assert.equal(payload.data.missionCheckpoint.auditId, parentId);
  assert.equal(payload.data.missionCheckpoint.missionRevision, 2);
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
      put: async (key, value) => values.set(key, structuredClone(value)),
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

test("Durable Object mission workspace reads carry the current authoritative checkpoint", async () => {
  const auditId = "19474d5a-a536-4cb3-84bf-99f00ba585c0";
  const state = {
    id: auditId,
    url: "https://removemyexif.com/",
    source: "human",
    mission: {
      schemaVersion: 1,
      intent: "assess",
      focusAreas: ["accessibility"],
      maxPriorities: 3,
      requestedBy: "human",
      requestedAt: 1,
      repairPreparation: null,
    },
    missionRevision: 7,
    status: "complete",
    phase: "complete",
    phaseLabel: "Audit complete",
    progress: 100,
    report: {
      auditId,
      url: "https://removemyexif.com/",
      finalUrl: "https://removemyexif.com/",
      findings: [],
      viewports: [],
    },
  };
  const values = new Map([
    ["state", state],
    ["repairs", []],
    ["diagnosticMissions", []],
    ["browserReview", null],
    ["explorations", []],
  ]);
  const job = new FrontmendAuditJob({
    storage: {
      get: async (key) => values.get(key),
      put: async (key, value) => values.set(key, structuredClone(value)),
    },
  }, {});

  for (const pathname of ["/repairs", "/diagnostics", "/browser-review", "/explorations"]) {
    const response = await job.fetch(new Request(`https://frontmend.internal${pathname}`));
    const payload = await response.json();
    assert.equal(response.status, 200, pathname);
    assert.equal(payload.data.missionCheckpoint.auditId, auditId, pathname);
    assert.equal(payload.data.missionCheckpoint.missionRevision, 7, pathname);
  }
});

test("completed Durable Object route children expose an empty browser-review workspace without inventing a child mission", async () => {
  const auditId = "route-child-audit";
  const state = {
    id: auditId,
    missionRevision: 4,
    url: "https://example.com/remove",
    source: "exploration",
    mission: null,
    exploration: {
      rootAuditId: "root-audit",
      parentAuditId: "root-audit",
      observedPath: "/remove",
      depth: 1,
      trail: [{ auditId: "root-audit", path: "/" }],
    },
    status: "complete",
    phase: "complete",
    progress: 100,
    report: {
      auditId,
      url: "https://example.com/remove",
      finalUrl: "https://example.com/remove",
      findings: [],
    },
  };
  const job = new FrontmendAuditJob({
    storage: {
      get: async (key) => key === "state" ? state : undefined,
      put: async () => {},
    },
  }, {});

  const read = await job.fetch(new Request("https://frontmend.internal/browser-review"));
  const readPayload = await read.json();
  assert.equal(read.status, 200);
  assert.equal(readPayload.data.auditId, auditId);
  assert.equal(readPayload.data.review, null);
  assert.equal(readPayload.data.missionCheckpoint.missionRevision, 4);

  const open = await job.fetch(new Request("https://frontmend.internal/browser-review", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source: "agent", expectedMissionRevision: 4 }),
  }));
  assert.equal(open.status, 400);
  assert.equal((await open.json()).error.code, "BROWSER_REVIEW_NOT_REQUIRED");
});

test("Durable Object keeps an idempotent activity ledger outside mission authority", async () => {
  const auditId = "activity-ledger-audit";
  const state = {
    id: auditId,
    missionRevision: 7,
    url: "https://example.com/",
    source: "agent",
    mission: null,
    status: "running",
    phase: "capture",
    progress: 40,
    report: null,
  };
  const values = new Map([["state", state]]);
  const job = new FrontmendAuditJob({
    storage: {
      get: async (key) => values.get(key),
      put: async (key, value) => values.set(key, structuredClone(value)),
    },
  }, {});
  const activity = {
    id: "activity-1",
    tool: "check_site_audit_progress",
    title: "Check audit progress",
    status: "succeeded",
    actorClass: "webmcp-agent",
    auditId,
    repairId: null,
    diagnosticMissionId: null,
    browserReviewId: null,
    explorationId: null,
    errorCode: null,
    missionRevisionBefore: 7,
    missionRevisionAfter: 7,
    startedAt: 100,
    completedAt: 110,
  };
  const append = () => job.fetch(new Request("https://frontmend.internal/activities", {
    method: "POST",
    body: JSON.stringify(activity),
  }));

  assert.equal((await append()).status, 200);
  assert.equal((await append()).status, 200);
  const read = await job.fetch(new Request("https://frontmend.internal/activities"));
  const payload = await read.json();
  assert.equal(payload.data.activities.length, 1);
  assert.equal(payload.data.boundary.retention, "last-20-per-audit");
  assert.equal(payload.data.missionCheckpoint.missionRevision, 7);
  assert.equal(values.get("state").missionRevision, 7);

  const rejected = await job.fetch(new Request("https://frontmend.internal/activities", {
    method: "POST",
    body: JSON.stringify({ ...activity, id: "activity-2", url: "https://secret.example/" }),
  }));
  assert.equal(rejected.status, 400);
  assert.equal((await rejected.json()).error.code, "INVALID_ACTIVITY_LEDGER");
  assert.equal(values.get("activityLedger").length, 1);
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
      headers: { "content-type": "application/json", origin: "https://frontmend.test", cookie: TEST_AUDIT_COOKIE },
      body: JSON.stringify({
        routeCandidateIds: ["route-11111111", "route-22222222"],
        source: "agent",
        expectedMissionRevision: 4,
      }),
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
          fetch: withAuditAuthorization(async (url, init = {}) => {
            const pathname = new URL(url).pathname;
            const input = init.body ? JSON.parse(init.body) : null;
            calls.push({ boundary: id, pathname, input });
            if (id === rootId && pathname === "/exploration-inputs") {
              return Response.json({
                ok: true,
                data: {
                  rootAuditId: rootId,
                  missionCheckpoint: { auditId: rootId, missionRevision: 5 },
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
          }),
        }),
      },
    },
  );

  const payload = await response.json();
  assert.equal(response.status, 202);
  assert.equal(payload.data.summary.pagesRequested, 2);
  assert.equal(payload.data.missionCheckpoint.missionRevision, 5);
  assert.deepEqual(
    calls.find((call) => call.boundary === rootId && call.pathname === "/exploration-inputs").input.routeCandidateIds,
    ["route-11111111", "route-22222222"],
  );
  assert.equal(calls.find((call) => call.boundary === "gate").input.items.length, 2);
  assert.equal(retainedMission.children.length, 2);
  assert.equal(retainedMission.source, "agent");
  const childStart = calls.find((call) => call.boundary === childIds[0]);
  assert.equal(childStart.input.siteExploration.rootAuditId, rootId);
  assert.equal(childStart.input.siteExploration.total, 2);
});

test("derived exploration refreshes do not advance mutation authority", async () => {
  const auditId = "19474d5a-a536-4cb3-84bf-99f00ba585c0";
  const missionId = "8cb30d34-76ce-4c47-a67e-d568b1db4d0a";
  const mission = {
    id: missionId,
    rootAuditId: auditId,
    currentSnapshot: { id: missionId, rootAuditId: auditId, status: "running" },
  };
  const values = new Map([
    ["state", {
      id: auditId,
      url: "https://example.com/",
      source: "human",
      mission: null,
      missionRevision: 7,
      status: "complete",
      phase: "complete",
      phaseLabel: "Audit complete",
      progress: 100,
      report: { auditId, findings: [], viewports: [] },
    }],
    ["explorations", [mission]],
  ]);
  const job = new FrontmendAuditJob({
    storage: {
      get: async (key) => values.get(key),
      put: async (key, value) => values.set(key, structuredClone(value)),
    },
  }, {});
  const refreshed = {
    ...mission,
    currentSnapshot: { id: missionId, rootAuditId: auditId, status: "complete" },
  };

  const response = await job.fetch(new Request(
    `https://frontmend.internal/explorations/${missionId}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(refreshed),
    },
  ));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.data.currentSnapshot.status, "complete");
  assert.equal(payload.data.missionCheckpoint.missionRevision, 7);
  assert.equal(values.get("state").missionRevision, 7);
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
      mission: {
        schemaVersion: 1,
        intent: "assess",
        focusAreas: ["accessibility"],
        maxPriorities: 3,
        requestedBy: "human",
        requestedAt: 100,
        repairPreparation: null,
      },
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
      mission: { intent: "assess", focusAreas: ["accessibility"], maxPriorities: 3 },
    }),
  }));
  await scheduled;

  const payload = await response.json();
  assert.equal(response.status, 202);
  assert.equal(payload.data.id, auditId);
  assert.equal(payload.data.attempt, 2);
  assert.equal(payload.data.status, "queued");
  assert.equal(values.get("state").error, null);
  assert.equal(values.get("state").mission.requestedAt, 100);
  assert.equal(restartedState.attempt, 2);
});

test("Durable Object freezes repair intent without creating or approving a repair", async () => {
  const auditId = "b8b16bf0-913c-40ea-a741-bb4bf76d326b";
  const mission = {
    schemaVersion: 1,
    intent: "assess",
    focusAreas: ["seo"],
    maxPriorities: 3,
    requestedBy: "human",
    requestedAt: 10,
    repairPreparation: null,
  };
  const policy = { mode: "delegated-auto", remainingAllowance: 1, updatedAt: 5 };
  const values = new Map([
    ["state", {
      id: auditId,
      attempt: 1,
      url: "https://example.com/",
      source: "human",
      mission,
      status: "complete",
      phase: "complete",
      progress: 100,
      report: {
        auditId,
        findings: [{
          id: "document-description",
          title: "The document has no description",
          severity: "medium",
          focusAreas: ["seo"],
          source: { provider: "Frontmend document audit", auditId: "description" },
        }, {
          id: "document-title",
          title: "The document title is missing",
          severity: "high",
          focusAreas: ["seo"],
          source: { provider: "Frontmend document audit", auditId: "title" },
        }],
      },
    }],
    ["repairPolicy", policy],
  ]);
  const job = new FrontmendAuditJob({
    storage: {
      get: async (key) => values.get(key),
      put: async (key, value) => values.set(key, structuredClone(value)),
    },
  }, {});
  const prepare = (findingId, source = "human", expectedMissionRevision) => job.fetch(new Request(
    "https://frontmend.internal/mission/prepare-repair",
    {
      method: "POST",
      body: JSON.stringify({ findingId, source, expectedMissionRevision }),
    },
  ));

  const completedState = values.get("state");
  values.set("state", { ...completedState, status: "running", report: null });
  const premature = await prepare("document-description");
  assert.equal((await premature.json()).error.code, "AUDIT_NOT_READY");
  values.set("state", completedState);

  const unknown = await prepare("not-retained");
  assert.equal((await unknown.json()).error.code, "FINDING_NOT_FOUND");

  const first = await prepare("document-description");
  const firstPayload = await first.json();
  assert.equal(first.status, 200);
  assert.equal(firstPayload.data.mission.intent, "prepare-fix");
  assert.equal(firstPayload.data.audit.missionRevision, 2);
  assert.equal(firstPayload.data.missionCheckpoint.missionRevision, 2);
  assert.equal(firstPayload.data.missionState.nextAction.tool, "stage_site_repair");
  assert.equal(values.has("repairs"), false);
  assert.deepEqual(values.get("repairPolicy"), policy);

  const repeated = await prepare("document-description", "agent", 1);
  assert.equal(repeated.status, 200);
  const repeatedPayload = await repeated.json();
  assert.deepEqual(repeatedPayload.data.mission, firstPayload.data.mission);
  assert.equal(repeatedPayload.data.missionCheckpoint.missionRevision, 2);

  const stale = await prepare("document-title", "agent", 1);
  const stalePayload = await stale.json();
  assert.equal(stale.status, 409);
  assert.equal(stalePayload.error.code, "MISSION_REVISION_STALE");
  assert.equal(stalePayload.error.details.missionCheckpoint.missionRevision, 2);

  const conflict = await prepare("document-title", "agent");
  const conflictPayload = await conflict.json();
  assert.equal(conflictPayload.error.code, "REPAIR_INTENT_CONFLICT");
  assert.equal(values.has("repairs"), false);
});

test("Durable Object rejects repair selection while agent browser evidence is still provisional", async () => {
  const auditId = "provisional-agent-audit";
  const state = {
    id: auditId,
    missionRevision: 1,
    url: "https://example.com/",
    source: "agent",
    mission: {
      schemaVersion: 2,
      intent: "assess",
      focusAreas: ["accessibility", "seo"],
      maxPriorities: 3,
      scope: "page",
      routeLimit: 3,
      requestedBy: "agent",
      requestedAt: 10,
      repairPreparation: null,
    },
    status: "complete",
    phase: "complete",
    progress: 100,
    report: {
      auditId,
      url: "https://example.com/",
      finalUrl: "https://example.com/",
      findings: [{
        id: "document-description",
        title: "The document has no description",
        severity: "medium",
        focusAreas: ["seo"],
        source: { provider: "Frontmend document audit", auditId: "description", strategy: "document" },
      }],
    },
  };
  const values = new Map([["state", state]]);
  const job = new FrontmendAuditJob({
    storage: {
      get: async (key) => values.get(key),
      put: async (key, value) => values.set(key, structuredClone(value)),
    },
  }, {});

  const response = await job.fetch(new Request("https://frontmend.internal/mission/prepare-repair", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      findingId: "document-description",
      source: "agent",
      expectedMissionRevision: 1,
    }),
  }));
  const payload = await response.json();

  assert.equal(response.status, 409);
  assert.equal(payload.error.code, "ASSESSMENT_INCOMPLETE");
  assert.equal(payload.error.details.rankingStatus, "provisional");
  assert.equal(payload.error.details.nextAction.tool, "open_browser_review");
  assert.equal(values.get("state").missionRevision, 1);
  assert.equal(values.get("state").mission.repairPreparation, null);
});

test("Durable Object adopts a person-started audit without restarting or duplicating it", async () => {
  const auditId = "b8b16bf0-913c-40ea-a741-bb4bf76d326b";
  const mission = {
    schemaVersion: 1,
    intent: "assess",
    focusAreas: [],
    maxPriorities: 3,
    requestedBy: "human",
    requestedAt: 10,
    repairPreparation: null,
  };
  const originalState = {
    id: auditId,
    attempt: 1,
    missionRevision: 1,
    url: "https://example.com/",
    source: "human",
    mission,
    status: "complete",
    phase: "complete",
    progress: 100,
    report: {
      auditId,
      url: "https://example.com/",
      finalUrl: "https://example.com/",
      completedAt: 100,
      engine: { mode: "live-document", provider: "Frontmend live document" },
      findings: [],
      viewports: [],
      documentProfile: { routes: [] },
    },
  };
  const values = new Map([["state", structuredClone(originalState)]]);
  const job = new FrontmendAuditJob({
    storage: {
      get: async (key) => values.get(key),
      put: async (key, value) => values.set(key, structuredClone(value)),
    },
  }, {});
  const open = (expectedMissionRevision) => job.fetch(new Request(
    "https://frontmend.internal/browser-review",
    {
      method: "POST",
      body: JSON.stringify({
        source: "agent",
        focusAreas: ["accessibility", "seo"],
        expectedMissionRevision,
      }),
    },
  ));

  const unboundDeclaration = await job.fetch(new Request(
    "https://frontmend.internal/agent-capabilities",
    { method: "POST", body: JSON.stringify({ capabilities: TEST_AGENT_CAPABILITIES }) },
  ));
  assert.equal(unboundDeclaration.status, 400);
  assert.equal((await unboundDeclaration.json()).error.code, "INVALID_AGENT_CAPABILITIES");

  const declarationResponse = await job.fetch(new Request(
    "https://frontmend.internal/agent-capabilities",
    {
      method: "POST",
      body: JSON.stringify({
        capabilities: TEST_AGENT_CAPABILITIES,
        expectedMissionRevision: 1,
      }),
    },
  ));
  const declaration = (await declarationResponse.json()).data;
  assert.equal(declarationResponse.status, 200);
  assert.equal(declaration.agentCapabilities.provenance, "agent-declared");
  assert.equal(declaration.agentCapabilities.verificationStatus, "not-verified");
  assert.equal(declaration.missionCheckpoint.missionRevision, 2);

  const declarationReplay = await job.fetch(new Request(
    "https://frontmend.internal/agent-capabilities",
    {
      method: "POST",
      body: JSON.stringify({
        capabilities: TEST_AGENT_CAPABILITIES,
        expectedMissionRevision: 1,
      }),
    },
  ));
  assert.equal(declarationReplay.status, 200);
  assert.equal((await declarationReplay.json()).data.missionCheckpoint.missionRevision, 2);

  const response = await open(2);
  const opened = (await response.json()).data;
  assert.equal(response.status, 201);
  assert.equal(opened.auditId, auditId);
  assert.equal(opened.adoption.mode, "human-to-agent");
  assert.equal(opened.adoption.originalMissionActor, "human");
  assert.equal(opened.adoption.openedBy, "agent");
  assert.equal(opened.adoption.restarted, false);
  assert.equal(opened.missionCheckpoint.auditId, auditId);
  assert.equal(opened.missionCheckpoint.missionRevision, 3);
  assert.equal(opened.missionCheckpoint.action.tool, "record_browser_review_check");
  assert.equal(values.get("state").id, auditId);
  assert.equal(values.get("state").attempt, 1);
  assert.deepEqual(values.get("state").mission, mission);

  const repeated = await open(2);
  const repeatedPayload = (await repeated.json()).data;
  assert.equal(repeated.status, 200);
  assert.equal(repeatedPayload.id, opened.id);
  assert.equal(repeatedPayload.missionCheckpoint.missionRevision, 3);
  assert.equal(values.get("browserReview").id, opened.id);
});

test("Durable Object withdraws an untouched human handoff with stale recovery and idempotent replay", async () => {
  const auditId = "withdrawal-audit";
  const values = new Map([["state", {
    id: auditId,
    attempt: 1,
    missionRevision: 1,
    url: "https://example.com/",
    source: "human",
    mission: {
      schemaVersion: 1,
      intent: "assess",
      focusAreas: ["seo"],
      maxPriorities: 3,
      requestedBy: "human",
      requestedAt: 10,
      repairPreparation: null,
    },
    status: "complete",
    phase: "complete",
    progress: 100,
    report: {
      auditId,
      url: "https://example.com/",
      finalUrl: "https://example.com/",
      completedAt: 100,
      engine: { mode: "live-document", provider: "Frontmend live document" },
      findings: [],
      viewports: [],
      documentProfile: { routes: [] },
    },
  }]]);
  const job = new FrontmendAuditJob({
    storage: {
      get: async (key) => values.get(key),
      put: async (key, value) => values.set(key, structuredClone(value)),
    },
  }, {});
  const post = (path, body) => job.fetch(new Request(`https://frontmend.internal${path}`, {
    method: "POST",
    body: JSON.stringify(body),
  }));
  const opened = (await (await post("/browser-review", {
    source: "person",
    focusAreas: ["seo"],
    expectedMissionRevision: 1,
  })).json()).data;
  assert.equal(opened.missionCheckpoint.missionRevision, 2);
  assert.equal(opened.state.withdrawalAvailable, true);

  const stale = await post(`/browser-review/${opened.id}/withdrawal`, {
    source: "person",
    expectedMissionRevision: 1,
  });
  const stalePayload = await stale.json();
  assert.equal(stale.status, 409);
  assert.equal(stalePayload.error.code, "MISSION_REVISION_STALE");
  assert.equal(stalePayload.error.details.missionCheckpoint.missionRevision, 2);

  const withdrawnResponse = await post(`/browser-review/${opened.id}/withdrawal`, {
    source: "person",
    expectedMissionRevision: 2,
  });
  const withdrawn = (await withdrawnResponse.json()).data;
  assert.equal(withdrawn.state.status, "withdrawn");
  assert.equal(withdrawn.withdrawal.withdrawnBy, "person");
  assert.equal(withdrawn.missionCheckpoint.missionRevision, 3);
  assert.equal(withdrawn.missionCheckpoint.status, "complete");

  const replay = await post(`/browser-review/${opened.id}/withdrawal`, {
    source: "person",
    expectedMissionRevision: 2,
  });
  const replayPayload = (await replay.json()).data;
  assert.equal(replay.status, 200);
  assert.equal(replayPayload.updatedAt, withdrawn.updatedAt);
  assert.equal(replayPayload.missionCheckpoint.missionRevision, 3);

  const agentAttempt = await post(`/browser-review/${opened.id}/withdrawal`, {
    source: "agent",
    expectedMissionRevision: 3,
  });
  assert.equal(agentAttempt.status, 400);
  assert.equal((await agentAttempt.json()).error.code, "BROWSER_REVIEW_WITHDRAWAL_HUMAN_ONLY");

  const assessment = await job.fetch(new Request("https://frontmend.internal/assessment"));
  assert.equal(assessment.status, 200);
  assert.match(await assessment.text(), /withdrawn by the person before any browser evidence/i);
});

test("Durable Object rejects withdrawal after a person records browser evidence", async () => {
  const auditId = "withdrawal-locked-audit";
  const values = new Map([["state", {
    id: auditId,
    missionRevision: 1,
    url: "https://example.com/",
    source: "human",
    mission: {
      schemaVersion: 1,
      intent: "assess",
      focusAreas: ["seo"],
      maxPriorities: 3,
      requestedBy: "human",
      requestedAt: 10,
      repairPreparation: null,
    },
    status: "complete",
    phase: "complete",
    progress: 100,
    report: {
      auditId,
      url: "https://example.com/",
      finalUrl: "https://example.com/",
      completedAt: 100,
      engine: { mode: "live-document", provider: "Frontmend live document" },
      findings: [],
      viewports: [],
      documentProfile: { routes: [] },
    },
  }]]);
  const job = new FrontmendAuditJob({
    storage: {
      get: async (key) => values.get(key),
      put: async (key, value) => values.set(key, structuredClone(value)),
    },
  }, {});
  const post = (path, body) => job.fetch(new Request(`https://frontmend.internal${path}`, {
    method: "POST",
    body: JSON.stringify(body),
  }));
  const opened = (await (await post("/browser-review", {
    source: "person",
    focusAreas: ["seo"],
    expectedMissionRevision: 1,
  })).json()).data;
  const recorded = await post(`/browser-review/${opened.id}/checks`, {
    source: "person",
    expectedMissionRevision: 2,
    checkId: opened.state.nextCheck.id,
    outcome: "passed",
    summary: "The rendered structure was checked directly by the person.",
    observations: ["The primary heading names the page topic."],
  });
  const recordedPayload = await recorded.json();
  assert.equal(recorded.status, 200);
  assert.equal(recordedPayload.data.results[0].source, "person");

  const withdrawal = await post(`/browser-review/${opened.id}/withdrawal`, {
    source: "person",
    expectedMissionRevision: 3,
  });
  assert.equal(withdrawal.status, 409);
  assert.equal((await withdrawal.json()).error.code, "BROWSER_REVIEW_WITHDRAWAL_LOCKED");
});

test("Durable Object persists sequential browser review evidence before completing assessment", async () => {
  const auditId = "b8b16bf0-913c-40ea-a741-bb4bf76d326b";
  const mission = {
    schemaVersion: 1,
    intent: "assess",
    focusAreas: ["seo"],
    maxPriorities: 3,
    requestedBy: "agent",
    requestedAt: 10,
    repairPreparation: null,
  };
  const values = new Map([["state", {
    id: auditId,
    url: "https://example.com/",
    source: "agent",
    mission,
    status: "complete",
    phase: "complete",
    progress: 100,
    report: {
      auditId,
      url: "https://example.com/",
      finalUrl: "https://example.com/",
      completedAt: 100,
      engine: { mode: "live-lighthouse", provider: "PageSpeed Insights / Lighthouse" },
      findings: [],
      viewports: [],
    },
  }]]);
  const job = new FrontmendAuditJob({
    storage: {
      get: async (key) => values.get(key),
      put: async (key, value) => values.set(key, structuredClone(value)),
    },
  }, {});
  const post = (path, body = {}) => job.fetch(new Request(`https://frontmend.internal${path}`, {
    method: "POST",
    body: JSON.stringify(body),
  }));

  const earlyAssessment = await job.fetch(new Request("https://frontmend.internal/assessment"));
  assert.equal(earlyAssessment.status, 409);

  const openedResponse = await post("/browser-review");
  assert.equal(openedResponse.status, 201);
  const opened = (await openedResponse.json()).data;
  assert.equal(opened.state.nextCheck.id, "rendered-structure");
  assert.equal(opened.missionCheckpoint.missionRevision, 2);

  const skipped = await post(`/browser-review/${opened.id}/checks`, {
    source: "agent",
    checkId: "search-discovery",
    outcome: "passed",
    summary: "Skipped ahead.",
    observations: ["A fact."],
  });
  assert.equal(skipped.status, 409);
  assert.equal((await skipped.json()).error.code, "BROWSER_REVIEW_SEQUENCE");

  const structure = await post(`/browser-review/${opened.id}/checks`, {
    source: "agent",
    checkId: "rendered-structure",
    outcome: "passed",
    summary: "The rendered structure exposes the page topic.",
    observations: ["One primary heading and a named main landmark are rendered."],
  });
  assert.equal(structure.status, 200);
  const structurePayload = (await structure.json()).data;
  assert.equal(structurePayload.state.nextCheck.id, "search-discovery");
  assert.equal(structurePayload.missionCheckpoint.missionRevision, 3);

  const identicalRetry = await post(`/browser-review/${opened.id}/checks`, {
    source: "agent",
    expectedMissionRevision: 2,
    checkId: "rendered-structure",
    outcome: "passed",
    summary: "The rendered structure exposes the page topic.",
    observations: ["One primary heading and a named main landmark are rendered."],
  });
  const identicalPayload = (await identicalRetry.json()).data;
  assert.equal(identicalRetry.status, 200);
  assert.equal(identicalPayload.missionCheckpoint.missionRevision, 3);
  assert.equal(identicalPayload.results.length, 1);

  const discovery = await post(`/browser-review/${opened.id}/checks`, {
    source: "agent",
    checkId: "search-discovery",
    outcome: "passed",
    summary: "The rendered navigation exposes important same-site destinations.",
    observations: ["Descriptive links connect the primary content to supporting guidance."],
  });
  const completed = (await discovery.json()).data;
  assert.equal(completed.state.status, "complete");
  assert.equal(completed.state.completedCheckCount, 2);

  const assessment = await job.fetch(new Request("https://frontmend.internal/assessment"));
  assert.equal(assessment.status, 200);
  const markdown = await assessment.text();
  assert.match(markdown, /Contributed rendered-browser review/);
  assert.match(markdown, /Coverage: 2 of 2 requested checks/);
});

test("Durable Object mints route candidates only after rendered routes are revalidated", async () => {
  const auditId = "c7baec90-647a-4f34-9e04-f12d35444389";
  const values = new Map([["state", {
    id: auditId,
    missionRevision: 1,
    url: "https://example.com/",
    source: "agent",
    mission: {
      schemaVersion: 2,
      intent: "assess",
      focusAreas: ["seo"],
      maxPriorities: 3,
      scope: "bounded-site",
      routeLimit: 3,
      requestedBy: "agent",
      requestedAt: 10,
      repairPreparation: null,
    },
    status: "complete",
    phase: "complete",
    progress: 100,
    report: {
      auditId,
      url: "https://example.com/",
      finalUrl: "https://example.com/",
      completedAt: 100,
      engine: { mode: "live-document", provider: "Frontmend document audit" },
      findings: [],
      viewports: [],
      documentProfile: { routes: [] },
    },
  }]]);
  const fetches = [];
  const job = new FrontmendAuditJob({
    storage: {
      get: async (key) => values.get(key),
      put: async (key, value) => values.set(key, structuredClone(value)),
    },
  }, {
    PUBLIC_FETCH: async (url, init) => {
      fetches.push([url, init.method, init.redirect]);
      return new Response(null, { status: 200, headers: { "content-type": "text/html" } });
    },
  });
  const post = (path, body = {}) => job.fetch(new Request(`https://frontmend.internal${path}`, {
    method: "POST",
    body: JSON.stringify(body),
  }));
  const opened = (await (await post("/browser-review", {
    source: "agent",
    expectedMissionRevision: 1,
  })).json()).data;
  const structure = (await (await post(`/browser-review/${opened.id}/checks`, {
    source: "agent",
    expectedMissionRevision: 2,
    checkId: "rendered-structure",
    outcome: "passed",
    summary: "The rendered page has a clear primary structure.",
    observations: ["One primary heading and one named main landmark are rendered."],
  })).json()).data;
  const discoveryResponse = await post(`/browser-review/${opened.id}/checks`, {
    source: "agent",
    expectedMissionRevision: structure.missionCheckpoint.missionRevision,
    checkId: "search-discovery",
    outcome: "passed",
    summary: "Rendered navigation exposes projects and services.",
    observations: ["Named same-site Projects and Services links are rendered."],
    observedRoutes: ["/projects", "/services"],
  });
  const completed = (await discoveryResponse.json()).data;

  assert.equal(discoveryResponse.status, 200);
  assert.deepEqual(fetches, [
    ["https://example.com/projects", "HEAD", "manual"],
    ["https://example.com/services", "HEAD", "manual"],
  ]);
  assert.deepEqual(values.get("state").report.renderedRouteObservations.map((item) => item.path), [
    "/projects",
    "/services",
  ]);
  assert.equal(completed.missionCheckpoint.scopeStatus, "not-started");
  assert.equal(completed.missionCheckpoint.action.tool, "start_site_exploration");
  assert.equal(completed.missionCheckpoint.assessmentReceiptAvailable, false);
  const stale = await post(`/browser-review/${opened.id}/checks`, {
    source: "agent",
    expectedMissionRevision: 3,
    checkId: "search-discovery",
    outcome: "passed",
    summary: "A stale actor observed a different route.",
    observations: ["A different same-site link appeared in stale browser state."],
    observedRoutes: ["/stale-route"],
  });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).error.code, "MISSION_REVISION_STALE");
  assert.equal(fetches.length, 2);
  assert.deepEqual(values.get("state").report.renderedRouteObservations.map((item) => item.path), [
    "/projects",
    "/services",
  ]);
  const assessment = await job.fetch(new Request("https://frontmend.internal/assessment"));
  assert.equal(assessment.status, 409);
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

test("proxies a fresh-session checkpoint through the stable public route", async () => {
  const auditId = "b8b16bf0-913c-40ea-a741-bb4bf76d326b";
  const calls = [];
  const response = await worker.fetch(
    new Request(`https://frontmend.test/api/audits/${auditId}/checkpoint`),
    {
      AUDIT_JOBS: {
        idFromName: (name) => name,
        get: (id) => ({
          fetch: async (url) => {
            calls.push({ id, pathname: new URL(url).pathname });
            return Response.json({
              ok: true,
              data: { schemaVersion: 1, auditId: id, missionRevision: 4 },
            });
          },
        }),
      },
    },
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.missionRevision, 4);
  assert.deepEqual(calls, [{ id: auditId, pathname: "/checkpoint" }]);
});

test("proxies a completed assessment receipt through the stable public route", async () => {
  const auditId = "b8b16bf0-913c-40ea-a741-bb4bf76d326b";
  const calls = [];
  const response = await worker.fetch(
    new Request(`https://frontmend.test/api/audits/${auditId}/assessment`),
    {
      AUDIT_JOBS: {
        idFromName: (name) => name,
        get: (id) => ({
          fetch: async (url) => {
            calls.push({ id, pathname: new URL(url).pathname });
            return new Response("# Frontmend assessment receipt", {
              headers: { "content-type": "text/markdown; charset=utf-8" },
            });
          },
        }),
      },
    },
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/markdown/);
  assert.deepEqual(calls, [{ id: auditId, pathname: "/assessment" }]);
});

test("proxies same-origin audit cancellation through the stable public route", async () => {
  const auditId = "b8b16bf0-913c-40ea-a741-bb4bf76d326b";
  const calls = [];
  const response = await worker.fetch(
    new Request(`https://frontmend.test/api/audits/${auditId}`, {
      method: "DELETE",
      headers: { origin: "https://frontmend.test", cookie: TEST_AUDIT_COOKIE },
    }),
    {
      AUDIT_JOBS: {
        idFromName: (name) => name,
        get: (id) => ({
          fetch: withAuditAuthorization(async (url, init) => {
            calls.push({ id, pathname: new URL(url).pathname, method: init.method });
            return Response.json({
              ok: true,
              data: { id, status: "cancelled", phase: "cancelled" },
            });
          }),
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

test("local development exports completed evidence and adopts it without a second audit", async () => {
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

  const activity = {
    id: "activity-local-1",
    tool: "get_site_audit_results",
    title: "Get site audit results",
    status: "succeeded",
    actorClass: "webmcp-agent",
    auditId,
    repairId: null,
    diagnosticMissionId: null,
    browserReviewId: null,
    explorationId: null,
    errorCode: null,
    missionRevisionBefore: 2,
    missionRevisionAfter: 2,
    startedAt: 100,
    completedAt: 110,
  };
  const appendActivity = await callLocalRuntime(middleware, {
    method: "POST",
    url: `/api/audits/${auditId}/activities`,
    headers: {
      host: "localhost:3434",
      origin: "http://localhost:3434",
    },
    body: JSON.stringify(activity),
  });
  assert.equal(appendActivity.status, 200);
  assert.equal(JSON.parse(appendActivity.body).data.missionCheckpoint.missionRevision, 2);
  const restoredActivities = await callLocalRuntime(middleware, {
    url: `/api/audits/${auditId}/activities`,
  });
  assert.deepEqual(JSON.parse(restoredActivities.body).data.activities, [activity]);

  const assessment = await callLocalRuntime(middleware, {
    url: `/api/audits/${auditId}/assessment`,
  });
  assert.equal(assessment.status, 200);
  assert.match(assessment.headers.get("content-type"), /text\/markdown/);
  assert.match(assessment.headers.get("content-disposition"), new RegExp(auditId));
  assert.equal(assessment.headers.get("cache-control"), "no-store");
  assert.match(assessment.body, /^# Frontmend assessment receipt/m);
  assert.match(assessment.body, /does not prove a repair, deployment, or resolution/);
  assert.match(assessment.body, /## Semantic activity ledger/);
  assert.match(assessment.body, /get_site_audit_results/);

  const checkpoint = await callLocalRuntime(middleware, {
    url: `/api/audits/${auditId}/checkpoint`,
  });
  const checkpointPayload = JSON.parse(checkpoint.body).data;
  assert.equal(checkpoint.status, 200);
  assert.equal(checkpointPayload.auditId, auditId);
  assert.equal(checkpointPayload.missionRevision, 2);

  const results = await callLocalRuntime(middleware, {
    url: `/api/audits/${auditId}/results`,
  });
  assert.equal(JSON.parse(results.body).data.missionCheckpoint.missionRevision, 2);

  for (const pathname of ["repairs", "diagnostics", "browser-review", "explorations"]) {
    const workspace = await callLocalRuntime(middleware, {
      url: `/api/audits/${auditId}/${pathname}`,
    });
    const workspacePayload = JSON.parse(workspace.body).data;
    assert.equal(workspace.status, 200, pathname);
    assert.equal(workspacePayload.missionCheckpoint.auditId, auditId, pathname);
    assert.equal(workspacePayload.missionCheckpoint.missionRevision, 2, pathname);
  }

  const declareCapabilities = await callLocalRuntime(middleware, {
    method: "POST",
    url: `/api/audits/${auditId}/agent-capabilities`,
    headers: {
      host: "localhost:3434",
      origin: "http://localhost:3434",
    },
    body: JSON.stringify({
      capabilities: TEST_AGENT_CAPABILITIES,
      expectedMissionRevision: 2,
    }),
  });
  const declared = JSON.parse(declareCapabilities.body).data;
  assert.equal(declareCapabilities.status, 200);
  assert.equal(declared.agentCapabilities.provenance, "agent-declared");
  assert.equal(declared.agentCapabilities.verificationStatus, "not-verified");
  assert.equal(declared.missionCheckpoint.missionRevision, 3);

  const adopt = await callLocalRuntime(middleware, {
    method: "POST",
    url: `/api/audits/${auditId}/browser-review`,
    headers: {
      host: "localhost:3434",
      origin: "http://localhost:3434",
    },
    body: JSON.stringify({
      source: "agent",
      focusAreas: ["accessibility", "seo"],
      expectedMissionRevision: 3,
    }),
  });
  const adopted = JSON.parse(adopt.body).data;
  assert.equal(adopt.status, 201);
  assert.equal(adopted.auditId, auditId);
  assert.equal(adopted.adoption.mode, "human-to-agent");
  assert.equal(adopted.adoption.originalMissionActor, "human");
  assert.equal(adopted.adoption.openedBy, "agent");
  assert.equal(adopted.adoption.sameAudit, true);
  assert.equal(adopted.adoption.restarted, false);
  assert.equal(adopted.missionCheckpoint.missionRevision, 4);
  assert.equal(adopted.missionCheckpoint.action.tool, "record_browser_review_check");

  const repeatedAdopt = await callLocalRuntime(middleware, {
    method: "POST",
    url: `/api/audits/${auditId}/browser-review`,
    headers: {
      host: "localhost:3434",
      origin: "http://localhost:3434",
    },
    body: JSON.stringify({
      source: "agent",
      focusAreas: ["accessibility", "seo"],
      expectedMissionRevision: 3,
    }),
  });
  const repeated = JSON.parse(repeatedAdopt.body).data;
  assert.equal(repeatedAdopt.status, 200);
  assert.equal(repeated.id, adopted.id);
  assert.equal(repeated.missionCheckpoint.missionRevision, 4);

  const withheldAssessment = await callLocalRuntime(middleware, {
    url: `/api/audits/${auditId}/assessment`,
  });
  assert.equal(withheldAssessment.status, 409);
  assert.equal(JSON.parse(withheldAssessment.body).error.code, "ASSESSMENT_INCOMPLETE");

  const withdrawal = await callLocalRuntime(middleware, {
    method: "POST",
    url: `/api/audits/${auditId}/browser-review/${adopted.id}/withdrawal`,
    headers: {
      host: "localhost:3434",
      origin: "http://localhost:3434",
    },
    body: JSON.stringify({ source: "person", expectedMissionRevision: 4 }),
  });
  const withdrawn = JSON.parse(withdrawal.body).data;
  assert.equal(withdrawal.status, 200);
  assert.equal(withdrawn.state.status, "withdrawn");
  assert.equal(withdrawn.missionCheckpoint.missionRevision, 5);

  const restoredAssessment = await callLocalRuntime(middleware, {
    url: `/api/audits/${auditId}/assessment`,
  });
  assert.equal(restoredAssessment.status, 200);
  assert.match(restoredAssessment.body, /withdrawn by the person before any browser evidence/i);
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
  assert.equal(queued.missionCheckpoint.auditId, parentId);

  let complete;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    complete = await callLocalRuntime(middleware, { url: `/api/audits/${queued.id}` });
    if (JSON.parse(complete.body).data.status === "complete") break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const completed = JSON.parse(complete.body).data;
  assert.equal(completed.report.exploration.rootAuditId, parentId);
  assert.deepEqual(completed.report.exploration.trail, [{ auditId: parentId, path: "/" }]);

  const browserWorkspace = await callLocalRuntime(middleware, {
    url: `/api/audits/${queued.id}/browser-review`,
  });
  const browserPayload = JSON.parse(browserWorkspace.body).data;
  assert.equal(browserWorkspace.status, 200);
  assert.equal(browserPayload.auditId, queued.id);
  assert.equal(browserPayload.review, null);

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
    body: JSON.stringify({
      url: "https://removemyexif.com/",
      source: "human",
      mission: { scope: "bounded-site", focusAreas: ["seo"], routeLimit: 2 },
    }),
  });
  const rootId = JSON.parse(start.body).data.id;
  let completedRoot;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const current = await callLocalRuntime(middleware, { url: `/api/audits/${rootId}` });
    completedRoot = JSON.parse(current.body).data;
    if (completedRoot.status === "complete") break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(completedRoot.mission.scope, "bounded-site");
  assert.equal(completedRoot.missionCheckpoint.action.tool, "start_site_exploration");
  const routeCandidateIds = completedRoot.missionCheckpoint.action.input.routeCandidateIds;

  const started = await callLocalRuntime(middleware, {
    method: "POST",
    url: `/api/audits/${rootId}/explorations`,
    headers: { origin: "http://frontmend.local", host: "frontmend.local" },
    body: JSON.stringify({
      routeCandidateIds,
      source: "agent",
      expectedMissionRevision: completedRoot.missionCheckpoint.missionRevision,
    }),
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
  assert.equal(
    aggregate.missionCheckpoint.missionRevision,
    mission.missionCheckpoint.missionRevision,
  );

  const report = await callLocalRuntime(middleware, {
    url: `/api/audits/${rootId}/explorations/${mission.id}/report`,
  });
  assert.equal(report.status, 200);
  assert.match(report.body, /# Frontmend site exploration/);
  assert.match(report.body, /Observed: 2 occurrences across 2 selected pages/);

  const assessment = await callLocalRuntime(middleware, {
    url: `/api/audits/${rootId}/assessment`,
  });
  assert.equal(assessment.status, 200);
  assert.match(assessment.body, /Scope: bounded-site/);
  assert.match(assessment.body, /Pages complete: 2 of 2/);
});

test("local development shares the bounded repair-intent transition without consuming policy", async () => {
  const middleware = createLocalAuditRuntime({
    fetchImpl: async (input) => {
      const url = new URL(input);
      if (url.hostname === "pagespeedonline.googleapis.com") {
        return Response.json({ error: { message: "rate limited" } }, { status: 429 });
      }
      return new Response(
        '<!doctype html><html lang="en"><head><title>Intent</title><meta name="viewport" content="width=device-width"></head><body><main><h1>Intent</h1><button style="color:#aaa;background:#fff">Continue</button></main></body></html>',
        { headers: { "content-type": "text/html; charset=utf-8" } },
      );
    },
  });
  const writeHeaders = { host: "localhost:3434", origin: "http://localhost:3434" };
  const started = await callLocalRuntime(middleware, {
    method: "POST",
    url: "/api/audits",
    headers: writeHeaders,
    body: JSON.stringify({
      url: "https://example.com/",
      source: "human",
      mission: { focusAreas: ["seo", "accessibility"] },
    }),
  });
  const auditId = JSON.parse(started.body).data.id;
  let completed;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    completed = JSON.parse((await callLocalRuntime(middleware, { url: `/api/audits/${auditId}` })).body).data;
    if (completed.status === "complete") break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(completed.status, "complete");
  assert.ok(completed.report.findings.length >= 1);
  const findingId = completed.report.findings[0].id;
  const policyBefore = JSON.parse((await callLocalRuntime(
    middleware,
    { url: `/api/audits/${auditId}/repair-policy` },
  )).body).data;

  const diagnosisBeforeIntent = await callLocalRuntime(middleware, {
    method: "POST",
    url: `/api/audits/${auditId}/diagnostics`,
    headers: writeHeaders,
    body: JSON.stringify({ findingId }),
  });
  assert.equal(diagnosisBeforeIntent.status, 409);
  assert.equal(JSON.parse(diagnosisBeforeIntent.body).error.code, "REPAIR_INTENT_REQUIRED");

  const prepare = () => callLocalRuntime(middleware, {
    method: "POST",
    url: `/api/audits/${auditId}/mission/prepare-repair`,
    headers: writeHeaders,
    body: JSON.stringify({ findingId, source: "human" }),
  });
  const stage = () => callLocalRuntime(middleware, {
    method: "POST",
    url: `/api/audits/${auditId}/repairs`,
    headers: writeHeaders,
    body: JSON.stringify({ findingId, source: "human" }),
  });
  const blocked = await stage();
  assert.equal(blocked.status, 409);
  assert.equal(JSON.parse(blocked.body).error.code, "REPAIR_INTENT_REQUIRED");
  const rejectedPrompt = await callLocalRuntime(middleware, {
    method: "POST",
    url: `/api/audits/${auditId}/mission/prepare-repair`,
    headers: writeHeaders,
    body: JSON.stringify({ findingId, source: "human", prompt: "private repository context" }),
  });
  assert.equal(rejectedPrompt.status, 400);
  assert.equal(JSON.parse(rejectedPrompt.body).error.code, "INVALID_INPUT");
  const first = await prepare();
  const firstPayload = JSON.parse(first.body).data;
  assert.equal(first.status, 200);
  assert.equal(firstPayload.mission.repairPreparation.findingId, findingId);
  assert.equal(firstPayload.audit.mission.intent, "prepare-fix");
  assert.equal((await prepare()).status, 200);

  const staged = await stage();
  assert.equal(staged.status, 201);
  const stagedRepair = JSON.parse(staged.body).data;
  assert.equal(stagedRepair.findingId, findingId);
  assert.equal(stagedRepair.verificationImpact.status, "unreviewed");
  assert.equal(stagedRepair.verificationImpact.previewRows.length >= 1, true);
  assert.equal(stagedRepair.missionCheckpoint.auditId, auditId);

  const candidates = JSON.parse((await callLocalRuntime(middleware, {
    url: `/api/audits/${auditId}/verification-candidates?findingId=${encodeURIComponent(findingId)}`,
  })).body).data;
  assert.equal(candidates.auditId, auditId);
  assert.equal(candidates.findingId, findingId);
  assert.equal(candidates.limit, 3);
  assert.equal(candidates.missionCheckpoint.auditId, auditId);

  const approved = JSON.parse((await callLocalRuntime(middleware, {
    method: "POST",
    url: `/api/audits/${auditId}/repairs/${stagedRepair.id}/approve`,
    headers: writeHeaders,
    body: "{}",
  })).body).data;
  assert.equal(approved.verificationImpact.status, "reviewed");
  assert.equal(approved.verificationImpact.matrix.reviewedBy, "person");
  assert.equal(approved.missionCheckpoint.auditId, auditId);

  const implementation = JSON.parse((await callLocalRuntime(middleware, {
    method: "POST",
    url: `/api/audits/${auditId}/repairs/${stagedRepair.id}/implementation`,
    headers: writeHeaders,
    body: JSON.stringify({
      source: "agent",
      summary: "Implemented the approved candidate repair.",
      files: ["src/page.css"],
      checks: [{ name: "bun test", status: "passed" }],
      expectedMissionRevision: approved.missionCheckpoint.missionRevision,
    }),
  })).body).data;
  assert.equal(implementation.implementationReceipt.checks[0].status, "passed");

  const candidateOpenResponse = await callLocalRuntime(middleware, {
    method: "POST",
    url: `/api/audits/${auditId}/repairs/${stagedRepair.id}/candidate-review`,
    headers: writeHeaders,
    body: JSON.stringify({
      source: "person",
      candidateOrigin: "http://localhost:5173",
      expectedMissionRevision: implementation.missionCheckpoint.missionRevision,
    }),
  });
  const candidate = JSON.parse(candidateOpenResponse.body).data;
  assert.equal(candidateOpenResponse.status, 201);
  assert.equal(candidate.candidateReview.openedBy, "person");
  assert.match(candidate.candidateReview.state.nextCheck.assignment.boundary, /Candidate browser evidence only/);

  const candidateRecordResponse = await callLocalRuntime(middleware, {
    method: "POST",
    url: `/api/audits/${auditId}/repairs/${stagedRepair.id}/candidate-review/checks`,
    headers: writeHeaders,
    body: JSON.stringify({
      source: "person",
      reviewId: candidate.candidateReview.id,
      checkId: candidate.candidateReview.state.nextCheck.id,
      outcome: "passed",
      summary: "The candidate no longer reproduces the retained symptom.",
      observations: ["The retained symptom is absent at the requested viewport."],
      expectedMissionRevision: candidate.missionCheckpoint.missionRevision,
    }),
  });
  const candidateRecorded = JSON.parse(candidateRecordResponse.body).data;
  assert.equal(candidateRecordResponse.status, 200);
  assert.equal(candidateRecorded.candidateReview.results[0].source, "person");
  assert.equal(candidateRecorded.candidateReview.state.complete, true);
  assert.equal(candidateRecorded.deploymentAttestedAt, null);

  const candidateRead = JSON.parse((await callLocalRuntime(middleware, {
    url: `/api/audits/${auditId}/repairs/${stagedRepair.id}/candidate-review`,
  })).body).data;
  assert.equal(candidateRead.candidateReview.id, candidate.candidateReview.id);
  assert.equal(candidateRead.missionCheckpoint.missionRevision, candidateRecorded.missionCheckpoint.missionRevision);

  const repairs = JSON.parse((await callLocalRuntime(
    middleware,
    { url: `/api/audits/${auditId}/repairs` },
  )).body).data;
  const policyAfter = JSON.parse((await callLocalRuntime(
    middleware,
    { url: `/api/audits/${auditId}/repair-policy` },
  )).body).data;
  assert.equal(repairs.repairs.length, 1);
  assert.equal(repairs.missionCheckpoint.auditId, auditId);
  assert.deepEqual(policyAfter, policyBefore);
});

test("local runtime rejects repair selection while agent browser evidence is still provisional", async () => {
  const middleware = createLocalAuditRuntime({
    fetchImpl: async (input) => {
      const url = new URL(input);
      if (url.hostname === "pagespeedonline.googleapis.com") {
        return Response.json({ error: { message: "rate limited" } }, { status: 429 });
      }
      return new Response(
        '<!doctype html><html lang="en"><head><title>Provisional</title><meta name="viewport" content="width=device-width"></head><body><main><h1>Provisional</h1></main></body></html>',
        { headers: { "content-type": "text/html; charset=utf-8" } },
      );
    },
  });
  const writeHeaders = { host: "localhost:3434", origin: "http://localhost:3434" };
  const started = await callLocalRuntime(middleware, {
    method: "POST",
    url: "/api/audits",
    headers: writeHeaders,
    body: JSON.stringify({
      url: "https://example.com/",
      source: "agent",
      mission: { focusAreas: ["accessibility", "seo"] },
    }),
  });
  const auditId = JSON.parse(started.body).data.id;
  let completed;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    completed = JSON.parse((await callLocalRuntime(middleware, {
      url: `/api/audits/${auditId}`,
    })).body).data;
    if (completed.status === "complete") break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const findingId = completed.report.findings[0].id;
  const response = await callLocalRuntime(middleware, {
    method: "POST",
    url: `/api/audits/${auditId}/mission/prepare-repair`,
    headers: writeHeaders,
    body: JSON.stringify({
      findingId,
      source: "agent",
      expectedMissionRevision: completed.missionCheckpoint.missionRevision,
    }),
  });
  const payload = JSON.parse(response.body);

  assert.equal(response.status, 409);
  assert.equal(payload.error.code, "ASSESSMENT_INCOMPLETE");
  assert.equal(payload.error.details.rankingStatus, "provisional");
  assert.equal(payload.error.details.nextAction.tool, "open_browser_review");
  const retained = JSON.parse((await callLocalRuntime(middleware, {
    url: `/api/audits/${auditId}`,
  })).body).data;
  assert.equal(retained.mission.repairPreparation, null);
  assert.equal(retained.missionCheckpoint.missionRevision, completed.missionCheckpoint.missionRevision);
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
    body: JSON.stringify({
      url: "https://removemyexif.com/",
      source: "human",
      mission: { focusAreas: ["accessibility", "seo"], maxPriorities: 2 },
    }),
  });
  const first = await startRequest();
  const firstPayload = JSON.parse(first.body).data;
  assert.deepEqual(firstPayload.mission.focusAreas, ["accessibility", "seo"]);
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
  assert.equal(retryPayload.mission.requestedAt, firstPayload.mission.requestedAt);
  let complete;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    complete = await callLocalRuntime(middleware, { url: `/api/audits/${retryPayload.id}` });
    if (JSON.parse(complete.body).data.status === "complete") break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(JSON.parse(complete.body).data.status, "complete");
  assert.equal(JSON.parse(complete.body).data.attempt, 2);
});

test("local admission reuses the same mission and separates materially different goals", async () => {
  const providerUrls = [];
  const middleware = createLocalAuditRuntime({
    fetchImpl: async (input) => {
      const url = new URL(input);
      if (url.hostname === "pagespeedonline.googleapis.com") {
        providerUrls.push(url);
        return Response.json({ error: { message: "rate limited" } }, { status: 429 });
      }
      return new Response(
        '<!doctype html><html lang="en"><head><title>Mission</title><meta name="viewport" content="width=device-width"></head><body><main><h1>Mission</h1></main></body></html>',
        { headers: { "content-type": "text/html; charset=utf-8" } },
      );
    },
  });
  const start = (focusAreas) => callLocalRuntime(middleware, {
    method: "POST",
    url: "/api/audits",
    headers: { host: "localhost:3434", origin: "http://localhost:3434" },
    body: JSON.stringify({ url: "https://example.com/", source: "agent", mission: { focusAreas } }),
  });

  const first = JSON.parse((await start(["accessibility", "seo"])).body).data;
  const reordered = JSON.parse((await start(["seo", "accessibility"])).body).data;
  const different = JSON.parse((await start(["seo"])).body).data;
  assert.equal(reordered.id, first.id);
  assert.notEqual(different.id, first.id);
  assert.deepEqual(first.mission.focusAreas, ["accessibility", "seo"]);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(providerUrls.length >= 2);
  assert.equal(providerUrls.some((url) => url.searchParams.has("mission")), false);
  assert.equal(providerUrls.some((url) => url.searchParams.has("focusAreas")), false);
  assert.equal(providerUrls.some((url) => url.searchParams.has("maxPriorities")), false);
  assert.equal(providerUrls.some((url) => url.searchParams.has("intent")), false);
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

test("local development rejects a hostname whose DNS answer is private before fetch", async () => {
  let fetches = 0;
  const middleware = createLocalAuditRuntime({
    resolveHostname: async () => [{ address: "127.0.0.1", family: 4 }],
    fetchImpl: async () => {
      fetches += 1;
      return new Response("unreachable");
    },
  });
  const start = await callLocalRuntime(middleware, {
    method: "POST",
    url: "/api/audits",
    headers: { host: "localhost:3434", origin: "http://localhost:3434" },
    body: JSON.stringify({ url: "https://public-name.example/", source: "human" }),
  });
  const auditId = JSON.parse(start.body).data.id;
  let state;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await callLocalRuntime(middleware, { url: `/api/audits/${auditId}` });
    state = JSON.parse(response.body).data;
    if (state.status === "failed") break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  assert.equal(state.status, "failed");
  assert.equal(state.error.code, "RESOLVED_DESTINATION_BLOCKED");
  assert.equal(fetches, 0);
});

test("gate deduplicates a URL and enforces a bounded per-client window", async () => {
  const values = new Map();
  const operationalEvents = [];
  const gate = new FrontmendAuditGate({
    storage: {
      get: async (key) => values.get(key),
      put: async (key, value) => values.set(key, structuredClone(value)),
    },
  }, { OPERATIONAL_LOGGER: (event) => operationalEvents.push(event) });
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
  assert.equal(operationalEvents[0].event, "frontmend.admission");
  assert.equal(operationalEvents[0].newStarts, 1);
  assert.equal(operationalEvents[1].reusedStarts, 1);
  assert.equal(operationalEvents.at(-1).outcome, "rejected");
  assert.equal(operationalEvents.at(-1).reason, "client-capacity");
  assert.equal(operationalEvents.every((event) => event.queueDepth === 0), true);
  assert.equal(JSON.stringify(operationalEvents).includes("client-a"), false);
  assert.equal(JSON.stringify(operationalEvents).includes("url-a"), false);
});

test("audit jobs emit aggregate provider and child outcome events without IDs or URLs", async () => {
  const values = new Map();
  const operationalEvents = [];
  let completion;
  const auditId = "b8b16bf0-913c-40ea-a741-bb4bf76d326b";
  const ctx = {
    storage: {
      get: async (key) => values.get(key),
      put: async (key, value) => values.set(key, structuredClone(value)),
      delete: async (key) => values.delete(key),
      setAlarm: async () => {},
    },
    waitUntil(promise) {
      completion = promise;
    },
  };
  const job = new FrontmendAuditJob(ctx, {
    OPERATIONAL_LOGGER: (event) => operationalEvents.push(event),
    AUDIT_RUNNER: async ({ auditId: id, url }) => ({
      screenshots: {},
      operational: {
        schemaVersion: 1,
        fallbackUsed: true,
        availableSourceCount: 1,
        providerRuns: [{
          adapterId: "frontmend-live-document",
          kind: "document",
          outcome: "complete",
          latencyMs: 42,
          measuredConditionCount: 1,
          failureCode: null,
          quotaLimited: false,
        }],
      },
      report: {
        auditId: id,
        url,
        finalUrl: url,
        hostname: "example.com",
        completedAt: 100,
        findings: [],
        viewports: [{ id: "document" }],
        engine: { mode: "live-document", provider: "Frontmend document audit" },
      },
    }),
  });
  const response = await job.fetch(new Request("https://frontmend.internal/start", {
    method: "POST",
    body: JSON.stringify({
      id: auditId,
      url: "https://example.com/private-path",
      source: "agent",
      exploration: { parentAuditId: crypto.randomUUID(), path: "/private-path", depth: 1 },
    }),
  }));
  assert.equal(response.status, 202);
  await completion;

  assert.deepEqual(operationalEvents.map((event) => event.event), [
    "frontmend.provider",
    "frontmend.audit",
  ]);
  assert.equal(operationalEvents[0].latencyMs, 42);
  assert.equal(operationalEvents[1].workload, "exploration-child");
  assert.equal(operationalEvents[1].fallbackUsed, true);
  const serialized = JSON.stringify(operationalEvents);
  assert.equal(serialized.includes(auditId), false);
  assert.equal(serialized.includes("example.com"), false);
  assert.equal(serialized.includes("private-path"), false);
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

test("browser-finding verification withholds its receipt until the Durable Object records an exact replay", async () => {
  const auditId = "c1de4f26-c222-4e44-a7e5-884ba6d9fe9a";
  const source = {
    provider: "Frontmend browser review",
    auditId: "responsive-reflow:01",
    strategy: "mobile",
  };
  const browserBaseline = {
    findingId: "browser:responsive-reflow:01",
    title: "Primary action clips at narrow widths",
    category: "Accessibility",
    focusArea: "accessibility",
    selector: "button.primary-action",
    evidence: "The right edge of the primary action is clipped at the mobile viewport.",
    repair: "Allow the action row to wrap within the viewport.",
    source,
    browserReviewEvidence: {
      reviewId: "baseline-review",
      checkId: "responsive-reflow",
      checkLabel: "Responsive reflow",
      provenance: "agent-reported-browser",
      reportedAt: 90,
    },
  };
  const verification = {
    url: "https://example.com/",
    baselineAuditId: "b8b16bf0-913c-40ea-a741-bb4bf76d326b",
    repairId: "3e8fe191-1f46-4f1b-92ac-492a5d73bb24",
    repairRevision: 1,
    findingId: browserBaseline.findingId,
    findingTitle: browserBaseline.title,
    findingSource: source,
    findingScope: { occurrenceCount: 1, occurrencesOmitted: 0, sources: [source] },
    baselineEngine: {
      mode: "live-lighthouse",
      provider: "PageSpeed Insights",
      ruleSetVersion: 1,
      lighthouseVersion: "13.4.1",
    },
    baselineEvidence: {
      mode: "live-lighthouse",
      provider: "PageSpeed Insights",
      ruleSetVersion: 1,
      lighthouseVersion: "13.4.1",
      measuredStrategies: ["mobile"],
      scoreBasis: "measured-lighthouse-viewports",
      documentSupplement: null,
    },
    baseline: {
      auditId: "b8b16bf0-913c-40ea-a741-bb4bf76d326b",
      completedAt: 100,
      score: 90,
      findingCount: 1,
      checks: { passed: 9, warnings: 0, failed: 1 },
      exactRuleOutcome: "failed",
      scopeRuleOutcomes: [{ source, status: "failed" }],
    },
    lineage: {
      rootAuditId: "b8b16bf0-913c-40ea-a741-bb4bf76d326b",
      findingSource: source,
      findingScope: { occurrenceCount: 1, occurrencesOmitted: 0, sources: [source] },
      attemptCount: 0,
      omitted: 0,
      entries: [{
        auditId: "b8b16bf0-913c-40ea-a741-bb4bf76d326b",
        completedAt: 100,
        score: 90,
        findingCount: 1,
        checksPassed: 9,
        exactRuleOutcome: "failed",
        attempt: 0,
        status: "baseline",
      }],
    },
    browserReplay: { required: true, status: "not-opened", baseline: browserBaseline },
    browserGuardrails: [{
      checkId: "primary-journey",
      label: "Primary journey",
      focusArea: "accessibility",
      viewport: "desktop",
      summary: "The retained primary journey completed before repair.",
    }],
    deploymentAttestedAt: 110,
  };
  const freshReport = {
    auditId,
    url: "https://example.com/",
    finalUrl: "https://example.com/",
    completedAt: 120,
    score: 94,
    scoreBasis: "measured-lighthouse-viewports",
    findingCount: 0,
    checks: { passed: 10, warnings: 0, failed: 0 },
    viewports: [{ id: "mobile" }],
    engine: verification.baselineEngine,
    findings: [],
    ruleOutcomes: [],
  };
  freshReport.verification = compareVerification(freshReport, verification, 125);
  const values = new Map([["state", {
    id: auditId,
    url: freshReport.url,
    source: "verification",
    mission: null,
    verification,
    status: "complete",
    phase: "complete",
    progress: 100,
    report: freshReport,
  }]]);
  const job = new FrontmendAuditJob({
    storage: {
      get: async (key) => values.get(key),
      put: async (key, value) => values.set(key, structuredClone(value)),
    },
  }, {});
  const early = await job.fetch(new Request("https://frontmend.internal/receipt"));
  assert.equal(early.status, 409);
  assert.equal((await early.json()).error.code, "VERIFICATION_RECEIPT_UNAVAILABLE");

  const openedResponse = await job.fetch(new Request("https://frontmend.internal/browser-review", {
    method: "POST",
    body: "{}",
  }));
  assert.equal(openedResponse.status, 201);
  const opened = (await openedResponse.json()).data;
  assert.equal(opened.purpose, "verification");
  assert.equal(opened.state.nextCheck.id, "fresh-browser-replay");

  const recorded = await job.fetch(new Request(
    `https://frontmend.internal/browser-review/${opened.id}/checks`,
    {
      method: "POST",
      body: JSON.stringify({
        source: "agent",
        checkId: "fresh-browser-replay",
        outcome: "passed",
        summary: "The entire primary action is now visible at the retained mobile viewport.",
        observations: ["No horizontal clipping is visible around the primary action."],
      }),
    },
  ));
  assert.equal(recorded.status, 200);
  assert.equal(values.get("state").report.verification.status, "inconclusive");
  assert.equal(values.get("state").report.verification.browserReplay.outcome, "passed");

  const lockedAfterExactReplay = await job.fetch(new Request("https://frontmend.internal/receipt"));
  assert.equal(lockedAfterExactReplay.status, 409);

  const guardrailRecorded = await job.fetch(new Request(
    `https://frontmend.internal/browser-review/${opened.id}/checks`,
    {
      method: "POST",
      body: JSON.stringify({
        source: "agent",
        checkId: "fresh-browser-guardrail-1",
        outcome: "passed",
        summary: "The retained primary journey still reaches completion.",
        observations: ["The original primary action reaches the same completion state."],
      }),
    },
  ));
  assert.equal(guardrailRecorded.status, 200);
  assert.equal(values.get("state").report.verification.status, "resolved");
  assert.equal(values.get("state").report.verification.browserGuardrails[0].outcome, "passed");

  const receipt = await job.fetch(new Request("https://frontmend.internal/receipt"));
  assert.equal(receipt.status, 200);
  assert.match(await receipt.text(), /Fresh browser replay[\s\S]*No horizontal clipping[\s\S]*Browser regression guardrails/i);
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
        mission: preparedAuditMission("document-content-security-policy", ["security"]),
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

  const preparedState = values.get("state");
  values.set("state", {
    ...preparedState,
    mission: { ...preparedState.mission, intent: "assess", repairPreparation: null },
  });
  const diagnosisBeforeIntent = await job.fetch(new Request("https://frontmend.internal/diagnostics", {
    method: "POST",
    body: JSON.stringify({ findingId: "document-content-security-policy" }),
  }));
  assert.equal(diagnosisBeforeIntent.status, 409);
  assert.equal((await diagnosisBeforeIntent.json()).error.code, "REPAIR_INTENT_REQUIRED");
  const blockedByIntent = await stage();
  assert.equal((await blockedByIntent.json()).error.code, "REPAIR_INTENT_REQUIRED");
  values.set("state", preparedState);

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
  assert.equal(first.verificationImpact.status, "unreviewed");
  assert.deepEqual(
    first.verificationImpact.previewRows.map((row) => row.proofKind),
    ["provider-rule", "new-findings-guardrail"],
  );
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
  assert.equal(approvedRepair.verificationImpact.status, "reviewed");
  assert.equal(approvedRepair.verificationImpact.matrix.reviewedBy, "person");
  assert.equal(approvedRepair.verificationImpact.matrix.rows.length, 2);
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

  const candidateOpen = await job.fetch(
    new Request(`https://frontmend.internal/repairs/${first.id}/candidate-review`, {
      method: "POST",
      body: JSON.stringify({ source: "agent", candidateOrigin: "http://localhost:5173" }),
    }),
  );
  const candidateRepair = (await candidateOpen.json()).data;
  assert.equal(candidateOpen.status, 201);
  assert.equal(candidateRepair.candidateReview.purpose, "candidate");
  assert.equal(candidateRepair.candidateReview.candidateOrigin, "http://localhost:5173");
  assert.equal(candidateRepair.candidateReview.state.requestedCheckCount, 1);
  assert.equal(
    candidateRepair.mission.steps.find((step) => step.id === "candidate").status,
    "current",
  );
  const candidateRevision = candidateRepair.missionCheckpoint.missionRevision;

  const candidateReplay = await job.fetch(
    new Request(`https://frontmend.internal/repairs/${first.id}/candidate-review`, {
      method: "POST",
      body: JSON.stringify({
        source: "agent",
        candidateOrigin: "http://localhost:5173",
        expectedMissionRevision: candidateRevision,
      }),
    }),
  );
  const replayedCandidate = (await candidateReplay.json()).data;
  assert.equal(candidateReplay.status, 200);
  assert.equal(replayedCandidate.candidateReview.id, candidateRepair.candidateReview.id);
  assert.equal(replayedCandidate.missionCheckpoint.missionRevision, candidateRevision);

  const staleCandidateResult = await job.fetch(
    new Request(`https://frontmend.internal/repairs/${first.id}/candidate-review-checks`, {
      method: "POST",
      body: JSON.stringify({
        source: "agent",
        reviewId: candidateRepair.candidateReview.id,
        checkId: candidateRepair.candidateReview.state.nextCheck.id,
        outcome: "issue",
        summary: "The retained symptom remains in the candidate.",
        observations: ["The retained browser comparison still fails."],
        expectedMissionRevision: candidateRevision - 1,
      }),
    }),
  );
  assert.equal(staleCandidateResult.status, 409);
  assert.equal((await staleCandidateResult.json()).error.code, "MISSION_REVISION_STALE");

  const candidateResult = await job.fetch(
    new Request(`https://frontmend.internal/repairs/${first.id}/candidate-review-checks`, {
      method: "POST",
      body: JSON.stringify({
        source: "agent",
        reviewId: candidateRepair.candidateReview.id,
        checkId: candidateRepair.candidateReview.state.nextCheck.id,
        outcome: "issue",
        summary: "The retained symptom remains in the candidate.",
        observations: ["The retained browser comparison still fails."],
        expectedMissionRevision: candidateRevision,
      }),
    }),
  );
  const candidateIssue = (await candidateResult.json()).data;
  assert.equal(candidateResult.status, 200);
  assert.equal(candidateIssue.candidateReview.state.issueCount, 1);
  assert.equal(candidateIssue.candidateReview.results[0].source, "agent");
  assert.equal(candidateIssue.deploymentAttestedAt, null);
  assert.equal(candidateIssue.verificationRun, null);
  assert.equal(
    candidateIssue.mission.steps.find((step) => step.id === "candidate").status,
    "attention",
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
  assert.match(exportText, /## Candidate browser review/);
  assert.match(exportText, /### Candidate correction packet/);
  assert.match(exportText, /narrows the next coding iteration/i);
  assert.match(exportText, /production evidence only|pre-production evidence only/i);

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

test("diagnostic missions gate agent repairs until runtime and repository evidence is ready", async () => {
  const auditId = "b8b16bf0-913c-40ea-a741-bb4bf76d326b";
  const finding = {
    id: "lighthouse-errors-in-console-mobile",
    title: "Browser errors were logged",
    severity: "medium",
    category: "Best practices",
    focusAreas: ["reliability"],
    evidence: "One console error was measured.",
    repair: "Resolve the first-party runtime error.",
    source: { provider: "Lighthouse", auditId: "errors-in-console", strategy: "mobile" },
    diagnosticEvidence: {
      kind: "console-errors",
      completeness: "actionable",
      entries: [{ description: "Failed to load resource", source: "network" }],
      missing: [],
      caveat: "Lighthouse measured the symptom; an agent must reproduce and map its cause.",
    },
  };
  const values = new Map([["state", {
    id: auditId,
    url: "https://example.com/",
    source: "agent",
    mission: preparedAuditMission(finding.id, ["reliability"]),
    status: "complete",
    phase: "complete",
    progress: 100,
    report: {
      auditId,
      url: "https://example.com/",
      finalUrl: "https://example.com/",
      engine: { mode: "live-pagespeed", provider: "PageSpeed Insights / Lighthouse" },
      findings: [finding],
      ruleOutcomes: [{ source: finding.source, status: "failed" }],
    },
  }]]);
  const job = new FrontmendAuditJob({
    storage: {
      get: async (key) => values.get(key),
      put: async (key, value) => values.set(key, value),
    },
  }, {});
  const post = (path, body) => job.fetch(new Request(`https://frontmend.internal${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));

  const openedResponse = await post("/diagnostics", { findingId: finding.id });
  assert.equal(openedResponse.status, 201);
  const opened = (await openedResponse.json()).data;
  assert.equal(opened.state.state, "awaiting-diagnosis");
  assert.equal(opened.measuredEvidence.provenance, "measured-lighthouse");

  const earlyAssessment = await job.fetch(new Request("https://frontmend.internal/assessment"));
  assert.equal(earlyAssessment.status, 200);
  assert.match(await earlyAssessment.text(), /Repair diagnosis: diagnosis-in-progress/);

  const earlyRepair = await post("/repairs", { findingId: finding.id, source: "agent" });
  assert.equal(earlyRepair.status, 409);
  assert.equal((await earlyRepair.json()).error.code, "DIAGNOSTIC_MISSION_REQUIRED");

  const blockedResponse = await post(`/diagnostics/${opened.id}/blocker`, {
    source: "agent",
    reason: "repository-unavailable",
    summary: "The browser symptom reproduced, but the repository owning this deployment is unavailable in the current session.",
  });
  assert.equal(blockedResponse.status, 200);
  const blocked = (await blockedResponse.json()).data;
  assert.equal(blocked.state.state, "blocked");
  assert.equal(blocked.evidenceChain.status, "blocked");
  assert.equal(blocked.measuredEvidence.provenance, "measured-lighthouse");

  const blockedAssessment = await job.fetch(new Request("https://frontmend.internal/assessment"));
  assert.equal(blockedAssessment.status, 200);
  assert.match(await blockedAssessment.text(), /Repair diagnosis: blocked/);

  const blockedRepair = await post("/repairs", { findingId: finding.id, source: "agent" });
  assert.equal(blockedRepair.status, 409);
  assert.equal((await blockedRepair.json()).error.code, "DIAGNOSTIC_MISSION_REQUIRED");

  const diagnosedResponse = await post(`/diagnostics/${opened.id}/evidence`, {
    source: "agent",
    summary: "A first-party fetch rejects without handling its expected response.",
    reproduction: "Reload the page and inspect the console and failed request before interacting.",
    observations: [{ kind: "console", detail: "The rejection occurs once during initial load." }],
    sourceLocations: [{ file: "src/load.js", line: 12, symbol: "loadData", reason: "Owns the failing request." }],
    verificationChecks: ["bun test", "Reload with an empty console"],
    confidence: "high",
  });
  assert.equal(diagnosedResponse.status, 200);
  const diagnosed = (await diagnosedResponse.json()).data;
  assert.equal(diagnosed.state.state, "ready-for-repair");
  assert.equal(diagnosed.blocker, null);
  assert.equal(diagnosed.blockerHistory[0].reason, "repository-unavailable");

  const assessmentResponse = await job.fetch(new Request("https://frontmend.internal/assessment"));
  assert.equal(assessmentResponse.status, 200);
  assert.match(assessmentResponse.headers.get("content-type"), /text\/markdown/);
  assert.match(assessmentResponse.headers.get("content-disposition"), new RegExp(auditId));
  const assessment = await assessmentResponse.text();
  assert.match(assessment, /^# Frontmend assessment receipt/m);
  assert.match(assessment, /Measured symptom \| retained \| measured-lighthouse/);
  assert.match(assessment, /Browser reproduction \| contributed \| agent-reported/);

  const repairResponse = await post("/repairs", { findingId: finding.id, source: "agent" });
  assert.equal(repairResponse.status, 201);
  const repair = (await repairResponse.json()).data;
  assert.equal(repair.diagnosticMission.id, opened.id);
  assert.equal(repair.diagnosticMission.diagnosis.source, "agent");
  assert.equal(repair.diagnosticMission.measuredEvidence.provenance, "measured-lighthouse");
});

test("Durable Object stages one immutable diagnosed repair package and reviews every exact row", async () => {
  const auditId = "d42c0d7f-3b3c-4ac0-a5ac-15b607512615";
  const findings = [
    {
      id: "mobile-errors-in-console",
      title: "The page reports a runtime error",
      severity: "medium",
      category: "Reliability",
      focusAreas: ["reliability"],
      evidence: "A first-party runtime error was measured.",
      repair: "Repair the owned runtime failure.",
      source: { provider: "Lighthouse", auditId: "errors-in-console", strategy: "mobile" },
      diagnosticEvidence: {
        kind: "console-errors",
        completeness: "actionable",
        entries: [{ description: "ReferenceError", source: "javascript" }],
        missing: [],
      },
    },
    {
      id: "mobile-color-contrast",
      title: "Primary text has insufficient contrast",
      severity: "medium",
      category: "Accessibility",
      focusAreas: ["accessibility"],
      evidence: "The measured text contrast was below the retained threshold.",
      repair: "Adjust the shared foreground token.",
      source: { provider: "Lighthouse", auditId: "color-contrast", strategy: "mobile" },
      diagnosticEvidence: {
        kind: "contrast-nodes",
        completeness: "actionable",
        nodes: [{ selector: ".primary-copy", observedRatio: 2.8, expectedRatio: 4.5 }],
        missing: [],
      },
    },
  ];
  const values = new Map([["state", {
    id: auditId,
    url: "https://example.com/",
    source: "agent",
    mission: {
      schemaVersion: 2,
      intent: "prepare-fix",
      focusAreas: ["reliability", "accessibility"],
      maxPriorities: 3,
      scope: "page",
      routeLimit: 3,
      requestedBy: "human",
      requestedAt: 10,
      repairPreparation: {
        findingId: findings[0].id,
        findingIds: findings.map((finding) => finding.id),
        requestedBy: "human",
        requestedAt: 20,
      },
    },
    status: "complete",
    phase: "complete",
    progress: 100,
    report: {
      auditId,
      url: "https://example.com/",
      finalUrl: "https://example.com/",
      engine: { mode: "live-pagespeed", provider: "PageSpeed Insights / Lighthouse", ruleSetVersion: 1, lighthouseVersion: "13.4.1" },
      findings,
      ruleOutcomes: findings.map((finding) => ({ source: finding.source, status: "failed" })),
    },
  }]]);
  const job = new FrontmendAuditJob({
    storage: {
      get: async (key) => values.get(key),
      put: async (key, value) => values.set(key, structuredClone(value)),
    },
  }, {});
  const post = (path, body) => job.fetch(new Request(`https://frontmend.internal${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
  for (const [index, finding] of findings.entries()) {
    const openedResponse = await post("/diagnostics", { findingId: finding.id });
    const openedPayload = await openedResponse.json();
    assert.equal(openedResponse.status, 201, JSON.stringify(openedPayload));
    const opened = openedPayload.data;
    const diagnosed = await post(`/diagnostics/${opened.id}/evidence`, {
      source: "agent",
      summary: `The shared application path owns ${finding.title.toLowerCase()}.`,
      reproduction: "Inspect the audited document and the route metadata template.",
      observations: [{ kind: "console", detail: finding.evidence }],
      sourceLocations: [{ file: index === 0 ? "src/runtime.js" : "src/styles.css", line: 10 + index, reason: "Owns the retained public symptom." }],
      verificationChecks: ["bun test", "bun run build"],
      confidence: "high",
    });
    const diagnosedPayload = await diagnosed.json();
    assert.equal(diagnosed.status, 200, JSON.stringify(diagnosedPayload));
  }

  const unknown = await post("/repairs", {
    findingId: findings[0].id,
    findingIds: [findings[0].id, "not-retained"],
    source: "agent",
  });
  assert.equal((await unknown.json()).error.code, "FINDING_NOT_FOUND");

  const stagedResponse = await post("/repairs", {
    findingId: findings[0].id,
    findingIds: findings.map((finding) => finding.id),
    source: "agent",
    summary: "Repair the retained runtime and contrast symptoms in one reviewed application change.",
    patchType: "html",
    patch: "Correct the owned initialisation path and update the shared foreground token.",
    verificationPlan: "Rerun both exact document rules and retained guardrails.",
    risk: "low",
    repositoryFiles: ["src/runtime.js", "src/styles.css"],
    repositoryChecks: ["bun test", "bun run build"],
  });
  assert.equal(stagedResponse.status, 201);
  const repair = (await stagedResponse.json()).data;
  assert.deepEqual(repair.findingIds, findings.map((finding) => finding.id));
  assert.equal(repair.findingPackage.items.length, 2);
  assert.equal(repair.diagnosticMissions.length, 2);
  assert.equal(repair.status, "draft");
  assert.match(repair.automation.reasons.join(" "), /multi-finding packages require explicit review/i);
  assert.equal(repair.verificationImpact.previewRows.filter((row) => row.proofKind === "provider-rule").length, 2);

  const replay = (await (await post("/repairs", {
    findingId: findings[0].id,
    findingIds: findings.map((finding) => finding.id),
    source: "agent",
  })).json()).data;
  assert.equal(replay.id, repair.id);
  const overlap = await post("/repairs", {
    findingId: findings[1].id,
    findingIds: [findings[1].id],
    source: "agent",
  });
  assert.equal((await overlap.json()).error.code, "REPAIR_PACKAGE_CONFLICT");

  const approved = (await (await post(`/repairs/${repair.id}/approve`, {})).json()).data;
  assert.equal(approved.status, "approved");
  assert.equal(approved.verificationImpact.matrix.rows.filter((row) => row.proofKind === "provider-rule").length, 2);
  assert.deepEqual(
    approved.verificationImpact.matrix.rows.filter((row) => row.proofKind === "provider-rule").map((row) => row.findingId),
    findings.map((finding) => finding.id),
  );
  const artifact = await (await job.fetch(new Request(`https://frontmend.internal/repairs/${repair.id}/export`))).text();
  assert.match(artifact, /Frozen repair package[\s\S]*mobile-color-contrast/i);
});

test("audit jobs persist a scoped auto policy and authorise only an eligible agent mission", async () => {
  const values = new Map([["state", {
    id: "b8b16bf0-913c-40ea-a741-bb4bf76d326b",
    url: "https://example.com/",
    source: "human",
    mission: preparedAuditMission("mobile-color-contrast-1", ["accessibility"]),
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
  assert.equal(repair.verificationImpact.status, "reviewed");
  assert.equal(repair.verificationImpact.matrix.reviewedBy, "delegated-auto-policy");
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
  await access(new URL("../dist/client/robots.txt", import.meta.url));
  await access(new URL("../dist/server/index.js", import.meta.url));
  await access(new URL("../dist/.openai/hosting.json", import.meta.url));
  const robots = await readFile(new URL("../dist/client/robots.txt", import.meta.url), "utf8");
  const server = await readFile(new URL("../dist/server/index.js", import.meta.url), "utf8");
  const { stdout: expectedCommit } = await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd: projectRoot,
    windowsHide: true,
  });
  assert.equal(robots, "User-agent: *\nAllow: /\n");
  assert.match(server, new RegExp(expectedCommit.trim()));
  assert.doesNotMatch(server, /__FRONTMEND_BUILD_COMMIT__/);
  assert.match(server, /FrontmendAuditJob/);
  assert.doesNotMatch(server, /from ["'].+url-policy/);
});
