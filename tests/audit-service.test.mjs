import assert from "node:assert/strict";
import test from "node:test";
import {
  AuditError,
  createAuditService,
  createHttpAuditTransport,
  normalizePublicUrl,
} from "../src/audit-service.js";

const AUDIT_ID = "b8b16bf0-913c-40ea-a741-bb4bf76d326b";

test("normalizes public hostnames and removes fragments", () => {
  assert.equal(normalizePublicUrl("example.com/docs#intro"), "https://example.com/docs");
  assert.equal(normalizePublicUrl("http://example.com"), "http://example.com/");
});

test("rejects local, private, credentialed, and non-web targets", () => {
  for (const value of [
    "localhost:5173",
    "http://127.0.0.1",
    "http://192.168.1.2",
    "http://[::1]",
    "https://metadata.google.internal/latest",
    "https://user:pass@example.com",
    "file:///tmp/page.html",
  ]) {
    assert.throws(() => normalizePublicUrl(value), AuditError, value);
  }
});

test("uses the remote job transport and synchronizes active state", async () => {
  const calls = [];
  const states = [
    {
      id: AUDIT_ID,
      url: "https://removemyexif.com/",
      source: "human",
      status: "queued",
      phase: "queued",
      progress: 4,
      report: null,
    },
    {
      id: AUDIT_ID,
      url: "https://removemyexif.com/",
      source: "human",
      status: "running",
      phase: "capture",
      progress: 48,
      report: null,
    },
  ];
  const report = {
    auditId: AUDIT_ID,
    schemaVersion: 2,
    url: "https://removemyexif.com/",
    finalUrl: "https://removemyexif.com/",
    engine: { mode: "live-document", provider: "Frontmend document audit" },
    findings: [],
  };
  const service = createAuditService({
    now: () => 10,
    transport: {
      async start(input) {
        calls.push(["start", input]);
        return states[0];
      },
      async get(id) {
        calls.push(["get", id]);
        return states[1];
      },
      async results(id) {
        calls.push(["results", id]);
        return report;
      },
    },
  });

  const started = await service.startAudit({ url: "removemyexif.com", source: "human" });
  assert.equal(started.status, "queued");
  assert.equal(service.getActiveAudit().id, AUDIT_ID);
  const running = await service.getAudit(AUDIT_ID);
  assert.equal(running.progress, 48);
  assert.equal(service.getActiveAudit().phase, "capture");
  assert.equal(await service.getResults(AUDIT_ID), report);
  assert.equal(service.getActiveAudit().status, "complete");
  assert.equal(service.getAssessmentReceipt(AUDIT_ID).assessment.complete, true);
  assert.deepEqual(calls[0], [
    "start",
    {
      url: "https://removemyexif.com/",
      source: "human",
      mission: {
        schemaVersion: 1,
        intent: "assess",
        focusAreas: [],
        maxPriorities: 3,
        requestedBy: "human",
        requestedAt: 10,
        repairPreparation: null,
      },
    },
  ]);
});

test("rejects a mismatched restoration response before changing active audit state", async () => {
  const service = createAuditService({
    transport: {
      get: async () => ({
        id: "95b52d88-0ed2-49df-a740-0f548065dadd",
        url: "https://wrong.example/",
        status: "complete",
      }),
    },
  });

  await assert.rejects(
    () => service.getAudit(AUDIT_ID),
    (error) => error.code === "AUDIT_RESPONSE_MISMATCH" && /different workspace/i.test(error.message),
  );
  assert.equal(service.getActiveAudit(), null);
});

test("restores a completed audit only after every mission snapshot shares one revision", async () => {
  let auditReads = 0;
  const service = createAuditService({
    transport: {
      get: async () => {
        auditReads += 1;
        return {
          id: AUDIT_ID,
          url: "https://example.com/",
          status: "complete",
          missionRevision: 5,
          report: { auditId: AUDIT_ID, findings: [] },
        };
      },
      checkpoint: async () => ({ auditId: AUDIT_ID, missionRevision: 5 }),
      listRepairs: async () => ({
        repairs: [{ id: "repair-1", auditId: AUDIT_ID }],
        policy: { version: 1, mode: "review" },
      }),
      listDiagnosticMissions: async () => ({
        missions: [{ id: "diagnostic-1", auditId: AUDIT_ID }],
      }),
      getBrowserReview: async () => ({
        review: { id: "review-1", auditId: AUDIT_ID },
      }),
      listExplorations: async () => ({
        explorations: [{ id: "exploration-1", rootAuditId: AUDIT_ID, createdAt: 10 }],
      }),
    },
  });

  const restored = await service.restoreAuditWorkspace(AUDIT_ID);

  assert.equal(auditReads, 2);
  assert.equal(restored.audit.id, AUDIT_ID);
  assert.equal(restored.missionCheckpoint.missionRevision, 5);
  assert.deepEqual(restored.unavailable, []);
  assert.equal(service.getRepairs(AUDIT_ID)[0].id, "repair-1");
  assert.equal(service.getDiagnosticMissions(AUDIT_ID)[0].id, "diagnostic-1");
  assert.equal(service.getBrowserReview(AUDIT_ID).id, "review-1");
  assert.equal(service.getSiteExplorations(AUDIT_ID)[0].id, "exploration-1");
});

test("keeps a completed fresh-session workspace gated when one mission read is unavailable", async () => {
  const service = createAuditService({
    transport: {
      get: async () => ({
        id: AUDIT_ID,
        url: "https://example.com/",
        status: "complete",
        missionRevision: 5,
        report: { auditId: AUDIT_ID, findings: [] },
      }),
      checkpoint: async () => ({ auditId: AUDIT_ID, missionRevision: 5 }),
      listRepairs: async () => ({ repairs: [] }),
      listDiagnosticMissions: async () => ({ missions: [] }),
      getBrowserReview: async () => {
        throw new AuditError("BROWSER_REVIEW_UNAVAILABLE", "Review unavailable.");
      },
      listExplorations: async () => ({ explorations: [] }),
    },
  });

  await assert.rejects(
    () => service.restoreAuditWorkspace(AUDIT_ID),
    (error) => error.code === "MISSION_WORKSPACE_INCOMPLETE"
      && error.details?.unavailable?.[0] === "browserReview",
  );
});

test("rejects an audit identity change during coherent workspace restoration", async () => {
  let auditReads = 0;
  const service = createAuditService({
    transport: {
      get: async () => ({
        id: auditReads++ === 0 ? AUDIT_ID : "95b52d88-0ed2-49df-a740-0f548065dadd",
        url: "https://example.com/",
        status: "complete",
        missionRevision: 5,
        report: { auditId: AUDIT_ID, findings: [] },
      }),
      checkpoint: async () => ({ auditId: AUDIT_ID, missionRevision: 5 }),
      listRepairs: async () => ({ repairs: [] }),
      listDiagnosticMissions: async () => ({ missions: [] }),
      getBrowserReview: async () => ({ review: null }),
      listExplorations: async () => ({ explorations: [] }),
    },
  });

  await assert.rejects(
    () => service.restoreAuditWorkspace(AUDIT_ID),
    (error) => error.code === "AUDIT_RESPONSE_MISMATCH",
  );
  assert.equal(service.getActiveAudit().id, AUDIT_ID);
  assert.deepEqual(service.getRepairs(AUDIT_ID), []);
});

test("rejects a cross-audit mission record before publishing a restored workspace", async () => {
  const service = createAuditService({
    transport: {
      get: async () => ({
        id: AUDIT_ID,
        url: "https://example.com/",
        status: "complete",
        missionRevision: 5,
        report: { auditId: AUDIT_ID, findings: [] },
      }),
      checkpoint: async () => ({ auditId: AUDIT_ID, missionRevision: 5 }),
      listRepairs: async () => ({
        repairs: [{ id: "repair-foreign", auditId: "95b52d88-0ed2-49df-a740-0f548065dadd" }],
      }),
      listDiagnosticMissions: async () => ({ missions: [] }),
      getBrowserReview: async () => ({ review: null }),
      listExplorations: async () => ({ explorations: [] }),
    },
  });

  await assert.rejects(
    () => service.restoreAuditWorkspace(AUDIT_ID),
    (error) => error.code === "AUDIT_RESPONSE_MISMATCH",
  );
  assert.deepEqual(service.getRepairs(AUDIT_ID), []);
});

test("validates mission goals before transport and sends only bounded semantic fields", async () => {
  const calls = [];
  const transport = createHttpAuditTransport({
    baseUrl: "https://frontmend.test",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return Response.json({ ok: true, data: { id: AUDIT_ID, status: "queued" } });
    },
  });
  const service = createAuditService({ transport, now: () => 10 });

  await assert.rejects(
    () => service.startAudit({ url: "example.com", mission: { prompt: "audit everything" } }),
    (error) => error.code === "INVALID_INPUT",
  );
  await service.startAudit({
    url: "example.com",
    source: "agent",
    mission: { intent: "assess", focusAreas: ["accessibility", "seo"], maxPriorities: 2 },
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    url: "https://example.com/",
    source: "agent",
    mission: { intent: "assess", focusAreas: ["accessibility", "seo"], maxPriorities: 2 },
  });
  assert.equal(calls[0].init.body.includes("requestedAt"), false);
  assert.equal(calls[0].init.body.includes("prompt"), false);
});

test("starts a focused human assessment through the same bounded mission transport", async () => {
  const calls = [];
  const service = createAuditService({
    now: () => 25,
    transport: {
      async start(input) {
        calls.push(input);
        return { id: AUDIT_ID, url: input.url, source: input.source, status: "queued" };
      },
    },
  });

  const started = await service.startAudit({
    url: "example.com",
    source: "human",
    mission: {
      intent: "assess",
      focusAreas: ["accessibility", "seo", "performance"],
      maxPriorities: 5,
    },
  });

  assert.deepEqual(calls, [{
    url: "https://example.com/",
    source: "human",
    mission: {
      schemaVersion: 1,
      intent: "assess",
      focusAreas: ["accessibility", "seo", "performance"],
      maxPriorities: 5,
      requestedBy: "human",
      requestedAt: 25,
      repairPreparation: null,
    },
  }]);
  assert.deepEqual(started.mission, calls[0].mission);
});

test("retains mission goals through partial polling and fresh restoration", async () => {
  const report = { auditId: AUDIT_ID, schemaVersion: 2, findings: [], viewports: [] };
  const service = createAuditService({
    now: () => 10,
    transport: {
      start: async ({ url, source }) => ({
        id: AUDIT_ID,
        url,
        source,
        status: "queued",
        phase: "queued",
        progress: 4,
      }),
      get: async () => ({
        id: AUDIT_ID,
        url: "https://example.com/",
        source: "agent",
        status: "running",
        phase: "capture",
        progress: 48,
      }),
      results: async () => report,
    },
  });

  const started = await service.startAudit({
    url: "example.com",
    source: "agent",
    mission: { focusAreas: ["accessibility", "seo"], maxPriorities: 2 },
  });
  const polled = await service.getAudit(AUDIT_ID);
  assert.deepEqual(polled.mission, started.mission);
  await service.getResults(AUDIT_ID);
  assert.deepEqual(service.getActiveAudit().mission, started.mission);
  assert.equal(service.getActiveAuditMissionState().assessmentComplete, false);
  assert.equal(service.getActiveAuditMissionState().nextAction.tool, "open_browser_review");

  const restored = createAuditService({
    transport: {
      get: async () => ({
        id: AUDIT_ID,
        url: "https://example.com/",
        source: "agent",
        status: "complete",
        phase: "complete",
        progress: 100,
        report,
        mission: started.mission,
      }),
    },
  });
  await restored.getAudit(AUDIT_ID);
  assert.deepEqual(restored.getActiveAudit().mission.focusAreas, ["accessibility", "seo"]);
  assert.equal(restored.getActiveAuditMissionState().assessmentComplete, false);
  assert.equal(restored.getActiveAuditMissionState().nextAction.tool, "open_browser_review");
});

test("synchronizes a browser review and records only bounded agent evidence", async () => {
  const calls = [];
  const openCalls = [];
  const withdrawalCalls = [];
  const opened = {
    schemaVersion: 1,
    id: "browser-review-1",
    auditId: AUDIT_ID,
    state: { status: "in-progress", nextCheck: { id: "rendered-structure" } },
  };
  const completed = {
    ...opened,
    state: { status: "complete", nextCheck: null },
  };
  const service = createAuditService({
    transport: {
      start: async ({ url, source, mission }) => ({
        id: AUDIT_ID,
        url,
        source,
        mission,
        missionRevision: 5,
        status: "complete",
        progress: 100,
        report: {
          auditId: AUDIT_ID,
          url,
          finalUrl: url,
          engine: { mode: "live-document", provider: "Frontmend live document" },
          findings: [],
          viewports: [],
        },
      }),
      getBrowserReview: async () => ({ auditId: AUDIT_ID, review: opened }),
      openBrowserReview: async (auditId, input, revision) => {
        openCalls.push({ auditId, input, revision });
        return opened;
      },
      recordBrowserReviewCheck: async (auditId, reviewId, input, source) => {
        calls.push({ auditId, reviewId, input, source });
        return completed;
      },
      withdrawBrowserReview: async (auditId, reviewId, revision) => {
        withdrawalCalls.push({ auditId, reviewId, revision });
        return { ...opened, state: { status: "withdrawn" }, missionCheckpoint: { missionRevision: 7 } };
      },
    },
  });
  await service.startAudit({ url: "example.com", source: "human" });
  await service.loadBrowserReview(AUDIT_ID);
  assert.equal(service.getBrowserReview(AUDIT_ID).id, opened.id);
  await service.openBrowserReview(AUDIT_ID, {
    source: "person",
    focusAreas: ["accessibility", "seo"],
  }, 5);
  assert.deepEqual(openCalls, [{
    auditId: AUDIT_ID,
    input: { source: "person", focusAreas: ["accessibility", "seo"] },
    revision: 5,
  }]);
  await service.recordBrowserReviewCheck(AUDIT_ID, opened.id, {
    checkId: "rendered-structure",
    outcome: "passed",
    summary: "Rendered structure checked.",
    observations: ["One primary heading is rendered."],
  }, "agent");
  assert.equal(service.getBrowserReview(AUDIT_ID).state.status, "complete");
  assert.deepEqual(calls[0], {
    auditId: AUDIT_ID,
    reviewId: opened.id,
    input: {
      checkId: "rendered-structure",
      outcome: "passed",
      summary: "Rendered structure checked.",
      observations: ["One primary heading is rendered."],
    },
    source: "agent",
  });
  await service.withdrawBrowserReview(AUDIT_ID, opened.id, 6);
  assert.deepEqual(withdrawalCalls, [{ auditId: AUDIT_ID, reviewId: opened.id, revision: 6 }]);
  assert.equal(service.getBrowserReview(AUDIT_ID).state.status, "withdrawn");
  assert.equal(service.getMissionCheckpoint(AUDIT_ID).missionRevision, 7);
});

test("refreshes the active verification report after a browser replay contribution", async () => {
  const waitingReport = {
    auditId: AUDIT_ID,
    verification: {
      status: "inconclusive",
      browserReplay: { required: true, status: "not-opened" },
    },
  };
  const completedReport = {
    ...waitingReport,
    verification: {
      status: "resolved",
      browserReplay: { required: true, status: "complete", outcome: "passed" },
    },
  };
  const review = {
    schemaVersion: 1,
    id: "verification-review-1",
    auditId: AUDIT_ID,
    purpose: "verification",
    state: { status: "complete", complete: true, nextCheck: null },
  };
  let resultReads = 0;
  const service = createAuditService({
    transport: {
      start: async ({ url, source, mission }) => ({
        id: AUDIT_ID,
        url,
        source,
        mission,
        status: "complete",
        progress: 100,
        report: waitingReport,
      }),
      recordBrowserReviewCheck: async () => review,
      results: async () => {
        resultReads += 1;
        return completedReport;
      },
    },
  });
  await service.startAudit({ url: "example.com" });
  await service.recordBrowserReviewCheck(AUDIT_ID, review.id, {
    checkId: "fresh-browser-replay",
    outcome: "passed",
    summary: "The exact issue is no longer visible.",
    observations: ["The retained control is fully visible."],
  });
  assert.equal(resultReads, 1);
  assert.equal(service.getActiveAudit().report.verification.status, "resolved");
  assert.equal(service.getBrowserReview(AUDIT_ID).purpose, "verification");
});

test("HTTP transport uses the browser-review singleton and sequenced check routes", async () => {
  const calls = [];
  const transport = createHttpAuditTransport({
    baseUrl: "https://frontmend.test",
    fetchImpl: async (url, init = {}) => {
      calls.push({ url, init });
      return Response.json({ ok: true, data: url.endsWith("/browser-review")
        ? init.method === "POST"
          ? { id: "browser-review-1", auditId: AUDIT_ID }
          : { auditId: AUDIT_ID, review: null }
        : { id: "browser-review-1", auditId: AUDIT_ID } });
    },
  });
  await transport.getBrowserReview(AUDIT_ID);
  await transport.openBrowserReview(AUDIT_ID, {
    source: "person",
    focusAreas: ["accessibility", "seo"],
  }, 7);
  await transport.recordBrowserReviewCheck(AUDIT_ID, "browser-review-1", {
    checkId: "rendered-structure",
    outcome: "passed",
    summary: "Rendered structure checked.",
    observations: ["One primary heading is rendered."],
  }, "agent");
  await transport.withdrawBrowserReview(AUDIT_ID, "browser-review-1", 8);
  assert.equal(calls[0].url, `https://frontmend.test/api/audits/${AUDIT_ID}/browser-review`);
  assert.equal(calls[1].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    source: "person",
    focusAreas: ["accessibility", "seo"],
    expectedMissionRevision: 7,
  });
  assert.equal(calls[2].url, `https://frontmend.test/api/audits/${AUDIT_ID}/browser-review/browser-review-1/checks`);
  assert.equal(JSON.parse(calls[2].init.body).source, "agent");
  assert.equal(calls[3].url, `https://frontmend.test/api/audits/${AUDIT_ID}/browser-review/browser-review-1/withdrawal`);
  assert.deepEqual(JSON.parse(calls[3].init.body), {
    source: "person",
    expectedMissionRevision: 8,
  });
});

test("HTTP transport exposes verification candidates and aggregate repair proof without changing tool names", async () => {
  const calls = [];
  const transport = createHttpAuditTransport({
    baseUrl: "https://frontmend.test",
    fetchImpl: async (url, init = {}) => {
      calls.push({ url, init });
      return Response.json({ ok: true, data: { candidates: [], status: "resolved" } });
    },
  });
  await transport.verificationCandidates(AUDIT_ID, "color-contrast");
  await transport.repairVerification(AUDIT_ID, "repair-1");
  assert.equal(
    calls[0].url,
    `https://frontmend.test/api/audits/${AUDIT_ID}/verification-candidates?findingId=color-contrast`,
  );
  assert.equal(
    calls[1].url,
    `https://frontmend.test/api/audits/${AUDIT_ID}/repairs/repair-1/verification`,
  );
  assert.equal(
    transport.repairVerificationReceiptUrl(AUDIT_ID, "repair-1"),
    `https://frontmend.test/api/audits/${AUDIT_ID}/repairs/repair-1/verification/receipt`,
  );
});

test("HTTP transport carries human-selected server-issued verification targets into repair staging", async () => {
  const calls = [];
  const transport = createHttpAuditTransport({
    baseUrl: "https://frontmend.test",
    fetchImpl: async (url, init = {}) => {
      calls.push({ url, init });
      return Response.json({ ok: true, data: { id: "repair-1", status: "draft" } });
    },
  });
  const candidateId = "route-d8d88f15";

  await transport.stageRepair(AUDIT_ID, {
    findingId: "color-contrast",
    source: "human",
    verificationTargetIds: [candidateId],
  }, 7);

  assert.equal(calls[0].url, `https://frontmend.test/api/audits/${AUDIT_ID}/repairs`);
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    findingId: "color-contrast",
    source: "human",
    verificationTargetIds: [candidateId],
    expectedMissionRevision: 7,
  });
});

test("prepares one retained finding through the service and derives the remembered mission", async () => {
  const calls = [];
  let audit;
  const service = createAuditService({
    now: () => 10,
    transport: {
      start: async ({ url, source, mission }) => {
        audit = {
          id: AUDIT_ID,
          url,
          source,
          mission,
          status: "complete",
          progress: 100,
          report: {
            auditId: AUDIT_ID,
            findings: [{
              id: "document-description",
              title: "The document has no description",
              severity: "medium",
              focusAreas: ["seo"],
              source: { provider: "Frontmend document audit", auditId: "description" },
            }],
          },
        };
        return audit;
      },
      prepareRepair: async (auditId, findingId, source) => {
        calls.push({ auditId, findingId, source });
        const mission = {
          ...audit.mission,
          intent: "prepare-fix",
          repairPreparation: { findingId, requestedBy: source, requestedAt: 20 },
        };
        audit = { ...audit, mission };
        return {
          audit,
          mission,
          missionState: { status: "action-available", nextAction: { tool: "stage_site_repair" } },
        };
      },
    },
  });

  await service.startAudit({ url: "example.com", mission: { focusAreas: ["seo"] } });
  assert.equal(service.getAuditMissionState(AUDIT_ID).assessmentComplete, true);
  const prepared = await service.prepareRepair(AUDIT_ID, "document-description", "agent");
  assert.equal(prepared.mission.intent, "prepare-fix");
  assert.equal(service.getActiveAudit().mission.repairPreparation.findingId, "document-description");
  assert.equal(service.getActiveAuditMissionState().nextAction.tool, "stage_site_repair");
  assert.deepEqual(calls, [{
    auditId: AUDIT_ID,
    findingId: "document-description",
    source: "agent",
  }]);
  await assert.rejects(
    () => service.prepareRepair("", "document-description"),
    (error) => error.code === "INVALID_INPUT",
  );
});

test("HTTP transport posts only finding and source to the repair-intent route", async () => {
  const calls = [];
  const transport = createHttpAuditTransport({
    baseUrl: "https://frontmend.test",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return Response.json({ ok: true, data: { mission: { intent: "prepare-fix" } } });
    },
  });
  await transport.prepareRepair(AUDIT_ID, "document-description", "agent");
  assert.equal(
    calls[0].url,
    `https://frontmend.test/api/audits/${AUDIT_ID}/mission/prepare-repair`,
  );
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    findingId: "document-description",
    source: "agent",
  });
});

test("reset prevents a late remote response from reviving the audit", async () => {
  let resolveStart;
  const service = createAuditService({
    transport: {
      start: () => new Promise((resolve) => (resolveStart = resolve)),
      get: async () => null,
      results: async () => null,
    },
  });
  const pending = service.startAudit({ url: "removemyexif.com" });
  service.reset();
  resolveStart({ id: AUDIT_ID, url: "https://removemyexif.com/", status: "queued" });
  await pending;
  assert.equal(service.getActiveAudit(), null);
});

test("cancels through the shared transport and synchronizes terminal state", async () => {
  const calls = [];
  const service = createAuditService({
    transport: {
      start: async () => ({
        id: AUDIT_ID,
        url: "https://removemyexif.com/",
        status: "running",
        phase: "capture",
        progress: 18,
      }),
      cancel: async (id) => {
        calls.push(id);
        return {
          id,
          attempt: 1,
          url: "https://removemyexif.com/",
          status: "cancelled",
          phase: "cancelled",
          phaseLabel: "Audit cancelled",
          progress: 18,
          report: null,
          error: null,
        };
      },
    },
  });

  await service.startAudit({ url: "removemyexif.com" });
  const cancelled = await service.cancelAudit(AUDIT_ID);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(service.getActiveAudit().status, "cancelled");
  assert.deepEqual(calls, [AUDIT_ID]);
});

test("HTTP transport cancels with a bounded DELETE request", async () => {
  const calls = [];
  const transport = createHttpAuditTransport({
    baseUrl: "https://frontmend.test",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return Response.json({
        ok: true,
        data: { id: AUDIT_ID, status: "cancelled" },
      });
    },
  });

  await transport.cancel(AUDIT_ID, 4);
  assert.equal(calls[0].url, `https://frontmend.test/api/audits/${AUDIT_ID}`);
  assert.equal(calls[0].init.method, "DELETE");
  assert.deepEqual(JSON.parse(calls[0].init.body), { expectedMissionRevision: 4 });
});

test("restores checkpoints and automatically attaches the loaded revision to human mutations", async () => {
  const calls = [];
  const checkpoint = {
    schemaVersion: 1,
    auditId: AUDIT_ID,
    workspacePath: `/audits/${AUDIT_ID}`,
    missionRevision: 6,
    status: "action-available",
    nextActor: "agent",
    requiredCapability: "repository",
    action: { tool: "stage_site_repair", input: { findingId: "finding-1" }, reason: "Continue." },
    completionCriteria: ["Return a bounded repair."],
    retainedEvidenceSummary: ["Measurement complete."],
    authorityBoundary: { humanOnly: ["Approve", "Deploy"] },
  };
  const service = createAuditService({
    transport: {
      start: async ({ url, source, mission }) => ({
        id: AUDIT_ID,
        url,
        source,
        mission,
        missionRevision: 5,
        status: "complete",
        progress: 100,
        report: { auditId: AUDIT_ID, findings: [] },
      }),
      checkpoint: async (auditId) => ({ ...checkpoint, auditId }),
      setRepairPolicy: async (auditId, mode, expectedMissionRevision) => {
        calls.push({ auditId, mode, expectedMissionRevision });
        return {
          version: 1,
          mode,
          remainingAutoApprovals: 0,
          deploymentAttestation: "person-only",
          missionCheckpoint: checkpoint,
        };
      },
    },
  });
  await service.startAudit({ url: "https://example.com/", source: "human" });
  assert.equal((await service.loadMissionCheckpoint(AUDIT_ID)).missionRevision, 6);
  await service.setRepairPolicy(AUDIT_ID, "review");
  assert.deepEqual(calls, [{ auditId: AUDIT_ID, mode: "review", expectedMissionRevision: 6 }]);
  assert.equal(service.getMissionCheckpoint(AUDIT_ID).missionRevision, 6);
});

test("HTTP transport reads the dedicated checkpoint endpoint", async () => {
  const calls = [];
  const transport = createHttpAuditTransport({
    baseUrl: "https://frontmend.test",
    fetchImpl: async (url, init = {}) => {
      calls.push({ url, init });
      return Response.json({ ok: true, data: { auditId: AUDIT_ID, missionRevision: 3 } });
    },
  });
  const checkpoint = await transport.checkpoint(AUDIT_ID);
  assert.equal(checkpoint.missionRevision, 3);
  assert.equal(calls[0].url, `https://frontmend.test/api/audits/${AUDIT_ID}/checkpoint`);
  assert.equal(calls[0].init.method, undefined);
});

test("refreshes every authoritative mission snapshot after a stale Human write", async () => {
  const initialReview = {
    id: "355df6bb-06e7-432e-870a-ad9db11dfd72",
    auditId: AUDIT_ID,
    purpose: "assessment",
    state: { status: "active" },
  };
  let browserReadFails = false;
  const transport = {
    start: async ({ url, mission }) => ({
      id: AUDIT_ID,
      url,
      status: "complete",
      mission,
      missionRevision: 2,
      report: { auditId: AUDIT_ID, findings: [] },
    }),
    checkpoint: async () => ({
      schemaVersion: 1,
      auditId: AUDIT_ID,
      workspacePath: `/audits/${AUDIT_ID}`,
      missionRevision: 9,
      status: "action-available",
      nextActor: "person",
      requiredCapability: "human-review",
      action: null,
      completionCriteria: [],
      retainedEvidenceSummary: [],
      authorityBoundary: { humanOnly: ["approval"], agentMay: "prepare", claim: "No deployment proof." },
    }),
    get: async () => ({
      id: AUDIT_ID,
      url: "https://removemyexif.com/",
      status: "complete",
      missionRevision: 9,
      report: { auditId: AUDIT_ID, findings: [] },
    }),
    listRepairs: async () => ({
      repairs: [{ id: "repair-1", auditId: AUDIT_ID, status: "draft" }],
      policy: { version: 1, mode: "auto-low-risk", remainingAutoApprovals: 2 },
    }),
    listDiagnosticMissions: async () => ({
      missions: [{ id: "diagnostic-1", auditId: AUDIT_ID, state: { state: "awaiting-diagnosis" } }],
    }),
    getBrowserReview: async () => {
      if (browserReadFails) throw new AuditError("BROWSER_REVIEW_UNAVAILABLE", "Review unavailable.");
      return { review: initialReview };
    },
    listExplorations: async () => ({
      explorations: [{ id: "explore-1", rootAuditId: AUDIT_ID, createdAt: 20 }],
    }),
  };
  const service = createAuditService({ transport });
  await service.startAudit({ url: "removemyexif.com" });
  await service.loadBrowserReview(AUDIT_ID);
  browserReadFails = true;

  const refreshed = await service.refreshMissionWorkspace(AUDIT_ID);

  assert.equal(refreshed.missionCheckpoint.missionRevision, 9);
  assert.deepEqual(refreshed.unavailable, ["browserReview"]);
  assert.equal(service.getActiveAudit().missionRevision, 9);
  assert.equal(service.getActiveAudit().mission.requestedBy, "human");
  assert.equal(service.getRepairs(AUDIT_ID)[0].id, "repair-1");
  assert.equal(service.getRepairPolicy(AUDIT_ID).remainingAutoApprovals, 2);
  assert.equal(service.getDiagnosticMissions(AUDIT_ID)[0].id, "diagnostic-1");
  assert.equal(service.getBrowserReview(AUDIT_ID).id, initialReview.id);
  assert.equal(service.getSiteExplorations(AUDIT_ID)[0].id, "explore-1");
});

test("retries a stale workspace read until its checkpoint and snapshots share one revision", async () => {
  let checkpointCalls = 0;
  let auditReads = 0;
  const checkpointRevisions = [8, 9, 9, 9];
  const transport = {
    start: async ({ url, mission }) => ({
      id: AUDIT_ID,
      url,
      status: "complete",
      mission,
      missionRevision: 7,
      report: { auditId: AUDIT_ID, findings: [] },
    }),
    checkpoint: async () => ({
      schemaVersion: 1,
      auditId: AUDIT_ID,
      workspacePath: `/audits/${AUDIT_ID}`,
      missionRevision: checkpointRevisions[checkpointCalls++],
      status: "action-available",
      nextActor: "person",
      requiredCapability: "human-review",
      action: null,
      completionCriteria: [],
      retainedEvidenceSummary: [],
      authorityBoundary: { humanOnly: ["approval"], agentMay: "prepare", claim: "No deployment proof." },
    }),
    get: async () => {
      auditReads += 1;
      return {
        id: AUDIT_ID,
        url: "https://removemyexif.com/",
        status: "complete",
        missionRevision: auditReads === 1 ? 8 : 9,
        report: { auditId: AUDIT_ID, findings: [], title: auditReads === 1 ? "old" : "current" },
      };
    },
    listRepairs: async () => ({ repairs: [], policy: { version: 1, mode: "review" } }),
    listDiagnosticMissions: async () => ({ missions: [] }),
    getBrowserReview: async () => ({ review: null }),
    listExplorations: async () => ({ explorations: [] }),
  };
  const service = createAuditService({ transport });
  await service.startAudit({ url: "removemyexif.com" });

  const refreshed = await service.refreshMissionWorkspace(AUDIT_ID);

  assert.equal(refreshed.missionCheckpoint.missionRevision, 9);
  assert.equal(checkpointCalls, 4);
  assert.equal(auditReads, 2);
  assert.equal(service.getActiveAudit().report.title, "current");
});

test("starts related audits through the authoritative route transport", async () => {
  const calls = [];
  const service = createAuditService({
    transport: {
      startRelated: async (auditId, path, source) => {
        calls.push({ auditId, path, source });
        return {
          id: "c45d54ea-6884-4c86-b82d-b9048cff697f",
          url: "https://removemyexif.com/privacy",
          source,
          status: "queued",
          phase: "queued",
          progress: 4,
        };
      },
    },
  });

  await assert.rejects(
    () => service.startRelatedAudit("", "/privacy", "agent"),
    (error) => error.code === "INVALID_INPUT",
  );
  await assert.rejects(
    () => service.startRelatedAudit(AUDIT_ID, "", "agent"),
    (error) => error.code === "INVALID_INPUT",
  );
  const related = await service.startRelatedAudit(AUDIT_ID, "/privacy", "agent");
  assert.equal(related.url, "https://removemyexif.com/privacy");
  assert.equal(related.source, "agent");
  assert.deepEqual(calls, [{ auditId: AUDIT_ID, path: "/privacy", source: "agent" }]);
});

test("HTTP transport sends a bounded related-route request to its parent audit", async () => {
  const calls = [];
  const transport = createHttpAuditTransport({
    baseUrl: "https://frontmend.test",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return Response.json({
        ok: true,
        data: { id: "c45d54ea-6884-4c86-b82d-b9048cff697f", status: "queued" },
      });
    },
  });

  await transport.startRelated(AUDIT_ID, "/privacy", "agent", 5);
  assert.equal(calls[0].url, `https://frontmend.test/api/audits/${AUDIT_ID}/routes`);
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    path: "/privacy",
    source: "agent",
    expectedMissionRevision: 5,
  });
});

test("synchronizes durable site explorations through the shared service", async () => {
  const mission = {
    id: "232d593c-6c81-48c3-b137-a3df269454ff",
    rootAuditId: AUDIT_ID,
    status: "running",
    progress: 40,
  };
  const service = createAuditService({
    transport: {
      startExploration: async (auditId, paths, source) => ({
        ...mission,
        auditId,
        paths,
        source,
      }),
      listExplorations: async () => ({
        rootAuditId: AUDIT_ID,
        explorations: [{ ...mission, createdAt: 10 }],
      }),
      getExploration: async () => ({ ...mission, status: "complete", progress: 100 }),
      explorationReportUrl: (auditId, missionId) =>
        `/api/audits/${auditId}/explorations/${missionId}/report`,
    },
  });

  const started = await service.startSiteExploration(AUDIT_ID, ["/privacy", "/terms"], "agent");
  assert.equal(started.source, "agent");
  assert.equal(service.getSiteExplorations(AUDIT_ID)[0].id, mission.id);
  await service.listSiteExplorations(AUDIT_ID);
  const completed = await service.getSiteExploration(AUDIT_ID, mission.id);
  assert.equal(completed.status, "complete");
  assert.equal(service.getSiteExplorations(AUDIT_ID)[0].progress, 100);
  assert.match(service.getSiteExplorationReportUrl(AUDIT_ID, mission.id), /\/report$/);
});

test("HTTP transport uses bounded site-exploration collection and detail routes", async () => {
  const calls = [];
  const missionId = "232d593c-6c81-48c3-b137-a3df269454ff";
  const transport = createHttpAuditTransport({
    baseUrl: "https://frontmend.test",
    fetchImpl: async (url, init = {}) => {
      calls.push({ url, init });
      return Response.json({
        ok: true,
        data: url.endsWith("/explorations")
          ? init.method === "POST"
            ? { id: missionId, rootAuditId: AUDIT_ID }
            : { rootAuditId: AUDIT_ID, explorations: [] }
          : { id: missionId, rootAuditId: AUDIT_ID },
      });
    },
  });

  await transport.startExploration(AUDIT_ID, ["/privacy"], "human", 6);
  await transport.listExplorations(AUDIT_ID);
  await transport.getExploration(AUDIT_ID, missionId);
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    paths: ["/privacy"],
    source: "human",
    expectedMissionRevision: 6,
  });
  assert.equal(calls[1].url, `https://frontmend.test/api/audits/${AUDIT_ID}/explorations`);
  assert.equal(calls[2].url, `https://frontmend.test/api/audits/${AUDIT_ID}/explorations/${missionId}`);
});

test("records and remembers a diagnostic blocker through the bounded transport route", async () => {
  const calls = [];
  const missionId = "8cb30d34-76ce-4c47-a67e-d568b1db4d0a";
  const blockedMission = {
    id: missionId,
    auditId: AUDIT_ID,
    findingId: "mobile-errors-in-console",
    blocker: {
      reason: "conflicting-runtime",
      summary: "The current route no longer emits the measured console failure.",
      agentReported: true,
    },
    state: { state: "blocked" },
  };
  const transport = createHttpAuditTransport({
    baseUrl: "https://frontmend.test",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return Response.json({ ok: true, data: blockedMission });
    },
  });
  const service = createAuditService({ transport });

  const result = await service.recordDiagnosticBlocker(AUDIT_ID, missionId, {
    reason: "conflicting-runtime",
    summary: "The current route no longer emits the measured console failure.",
  }, "agent");

  assert.equal(result.state.state, "blocked");
  assert.equal(service.getDiagnosticMissions(AUDIT_ID)[0].blocker.reason, "conflicting-runtime");
  assert.equal(
    calls[0].url,
    `https://frontmend.test/api/audits/${AUDIT_ID}/diagnostics/${missionId}/blocker`,
  );
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    reason: "conflicting-runtime",
    summary: "The current route no longer emits the measured console failure.",
    source: "agent",
    expectedMissionRevision: 1,
  });
});

test("submits person-attributed diagnostic evidence with the loaded mission revision", async () => {
  const calls = [];
  const missionId = "5ae85552-5412-468b-9e8c-54d162b55a11";
  const checkpoint = {
    schemaVersion: 1,
    auditId: AUDIT_ID,
    workspacePath: `/audits/${AUDIT_ID}`,
    missionRevision: 7,
    status: "action-available",
    nextActor: "person",
    requiredCapability: "repository",
    action: null,
    completionCriteria: [],
    retainedEvidenceSummary: [],
    authorityBoundary: { humanOnly: [], agentMay: "", claim: "" },
  };
  const diagnosisInput = {
    summary: "The page initialiser reads a missing runtime global.",
    reproduction: "Reload the public route and observe the first console failure.",
    observations: [{ kind: "console", detail: "The first-party ReferenceError reproduces." }],
    sourceLocations: [{ file: "src/runtime.js", reason: "Owns the failing initialiser." }],
    verificationChecks: ["bun test"],
    confidence: "medium",
  };
  const transport = createHttpAuditTransport({
    baseUrl: "https://frontmend.test",
    fetchImpl: async (url, init = {}) => {
      calls.push({ url, init });
      if (url.endsWith(`/api/audits/${AUDIT_ID}`) && !init.method) {
        return Response.json({
          ok: true,
          data: { id: AUDIT_ID, status: "complete", missionRevision: checkpoint.missionRevision },
        });
      }
      return Response.json({
        ok: true,
        data: {
          id: missionId,
          auditId: AUDIT_ID,
          findingId: "mobile-errors-in-console",
          diagnosis: { ...diagnosisInput, source: "person", agentReported: false },
          state: { state: "ready-for-repair" },
          missionCheckpoint: { ...checkpoint, missionRevision: 8, status: "complete" },
        },
      });
    },
  });
  const service = createAuditService({ transport });
  await service.getAudit(AUDIT_ID);
  calls.length = 0;

  const result = await service.submitDiagnosticEvidence(
    AUDIT_ID,
    missionId,
    diagnosisInput,
    "person",
  );

  assert.equal(result.diagnosis.agentReported, false);
  assert.equal(service.getDiagnosticMissions(AUDIT_ID)[0].diagnosis.source, "person");
  assert.equal(service.getMissionCheckpoint(AUDIT_ID).missionRevision, 8);
  assert.equal(calls[0].url, `https://frontmend.test/api/audits/${AUDIT_ID}/diagnostics/${missionId}/evidence`);
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    ...diagnosisInput,
    source: "person",
    expectedMissionRevision: 7,
  });
});

test("keeps a bounded metadata-only browser-agent activity ledger", () => {
  let timestamp = 100;
  const service = createAuditService({ now: () => timestamp++ });
  const firstId = service.beginAgentActivity({
    tool: "start_site_audit",
    title: "Start site audit",
    url: "https://should-not-be-recorded.test/",
  });
  assert.equal(service.getAgentActivities()[0].status, "running");
  service.finishAgentActivity(firstId, {
    status: "succeeded",
    auditId: AUDIT_ID,
    rawInput: "must not persist",
  });
  const first = service.getAgentActivities()[0];
  assert.equal(first.status, "succeeded");
  assert.equal(first.auditId, AUDIT_ID);
  assert.equal("url" in first, false);
  assert.equal("rawInput" in first, false);

  for (let index = 0; index < 24; index += 1) {
    const id = service.beginAgentActivity({ tool: `tool-${index}`, title: `Tool ${index}` });
    service.finishAgentActivity(id, { status: index === 23 ? "failed" : "succeeded" });
  }
  assert.equal(service.getAgentActivities().length, 20);
  assert.equal(service.getAgentActivities()[0].status, "failed");
  service.clearAgentActivities();
  assert.deepEqual(service.getAgentActivities(), []);
});

test("synchronizes staged repairs, human approval, export, and verification jobs", async () => {
  const repairId = "3e8fe191-1f46-4f1b-92ac-492a5d73bb24";
  const draft = {
    id: repairId,
    auditId: AUDIT_ID,
    findingId: "document-content-security-policy",
    status: "draft",
  };
  const verification = {
    id: "c45d54ea-6884-4c86-b82d-b9048cff697f",
    url: "https://removemyexif.com/",
    source: "verification",
    status: "queued",
  };
  const reviewPolicy = {
    version: 1,
    mode: "review",
    remainingAutoApprovals: 0,
    deploymentAttestation: "person-only",
  };
  const autoPolicy = {
    version: 1,
    mode: "auto-low-risk",
    remainingAutoApprovals: 3,
    deploymentAttestation: "person-only",
  };
  const service = createAuditService({
    transport: {
      listRepairs: async () => ({ auditId: AUDIT_ID, repairs: [draft], policy: reviewPolicy }),
      getRepairPolicy: async () => reviewPolicy,
      setRepairPolicy: async (_auditId, mode) => mode === "auto-low-risk" ? autoPolicy : reviewPolicy,
      stageRepair: async () => draft,
      requestRepairChanges: async (_auditId, _repairId, feedback) => ({
        ...draft,
        status: "changes-requested",
        revision: 1,
        changeRequest: { feedback, requestedAt: 5 },
      }),
      reviseRepair: async (_auditId, _repairId, input) => ({
        ...draft,
        ...input,
        status: "draft",
        revision: 2,
        changeRequest: null,
      }),
      approveRepair: async () => ({ ...draft, status: "approved", reviewedAt: 10 }),
      recordImplementation: async (_auditId, _repairId, input) => ({
        ...draft,
        status: "approved",
        reviewedAt: 10,
        implementationReceipt: { ...input, source: "agent", reportedAt: 15 },
      }),
      attestDeployment: async () => ({
        ...draft,
        status: "approved",
        reviewedAt: 10,
        deploymentAttestedAt: 20,
      }),
      startVerification: async () => verification,
      repairExportUrl: (auditId, id) => `/api/audits/${auditId}/repairs/${id}/export`,
      verificationReceiptUrl: (auditId) => `/api/audits/${auditId}/receipt`,
      auditReportUrl: (auditId) => `/api/audits/${auditId}/report`,
      assessmentReceiptUrl: (auditId) => `/api/audits/${auditId}/assessment`,
    },
  });

  await service.listRepairs(AUDIT_ID);
  assert.equal(service.getRepairs(AUDIT_ID)[0].status, "draft");
  assert.equal(service.getRepairPolicy(AUDIT_ID).mode, "review");
  await service.setRepairPolicy(AUDIT_ID, "auto-low-risk");
  assert.equal(service.getRepairPolicy(AUDIT_ID).remainingAutoApprovals, 3);
  await service.stageRepair(AUDIT_ID, { findingId: draft.findingId });
  await service.requestRepairChanges(AUDIT_ID, repairId, "Add a report endpoint.");
  assert.equal(service.getRepairs(AUDIT_ID)[0].status, "changes-requested");
  await service.reviseRepair(AUDIT_ID, repairId, { patch: "revised" });
  assert.equal(service.getRepairs(AUDIT_ID)[0].revision, 2);
  await service.approveRepair(AUDIT_ID, repairId);
  assert.equal(service.getRepairs(AUDIT_ID)[0].status, "approved");
  await service.recordImplementation(AUDIT_ID, repairId, {
    summary: "Applied the approved plan.",
    files: ["worker/index.js"],
    checks: [{ name: "bun test", status: "passed" }],
  });
  assert.equal(service.getRepairs(AUDIT_ID)[0].implementationReceipt.source, "agent");
  await service.attestDeployment(AUDIT_ID, repairId);
  assert.equal(service.getRepairs(AUDIT_ID)[0].deploymentAttestedAt, 20);
  assert.match(service.getRepairExportUrl(AUDIT_ID, repairId), /\/export$/);
  assert.match(service.getVerificationReceiptUrl(AUDIT_ID), /\/receipt$/);
  assert.match(service.getAuditReportUrl(AUDIT_ID), /\/report$/);
  assert.match(service.getAssessmentReceiptUrl(AUDIT_ID), /\/assessment$/);
  assert.equal((await service.startVerification(AUDIT_ID, repairId)).source, "verification");
  assert.equal(service.getActiveAudit().id, verification.id);
});

test("HTTP transport preserves structured actionable errors", async () => {
  const transport = createHttpAuditTransport({
    fetchImpl: async () =>
      Response.json(
        {
          ok: false,
          error: {
            code: "MISSION_REVISION_STALE",
            message: "The mission changed.",
            recoverable: true,
            details: { missionCheckpoint: { auditId: AUDIT_ID, missionRevision: 8 } },
          },
        },
        { status: 429 },
      ),
  });

  await assert.rejects(
    () => transport.start({ url: "https://removemyexif.com/", source: "human" }),
    (error) =>
      error instanceof AuditError &&
      error.code === "MISSION_REVISION_STALE" &&
      error.recoverable === true &&
      error.details.missionCheckpoint.missionRevision === 8,
  );
});
