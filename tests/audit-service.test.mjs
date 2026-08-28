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
  const report = { auditId: AUDIT_ID, schemaVersion: 2, findings: [] };
  const service = createAuditService({
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
  assert.deepEqual(calls[0], [
    "start",
    { url: "https://removemyexif.com/", source: "human" },
  ]);
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

  await transport.cancel(AUDIT_ID);
  assert.equal(calls[0].url, `https://frontmend.test/api/audits/${AUDIT_ID}`);
  assert.equal(calls[0].init.method, "DELETE");
  assert.equal(calls[0].init.body, undefined);
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

  await transport.startRelated(AUDIT_ID, "/privacy", "agent");
  assert.equal(calls[0].url, `https://frontmend.test/api/audits/${AUDIT_ID}/routes`);
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), { path: "/privacy", source: "agent" });
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

  await transport.startExploration(AUDIT_ID, ["/privacy"], "human");
  await transport.listExplorations(AUDIT_ID);
  await transport.getExploration(AUDIT_ID, missionId);
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), { paths: ["/privacy"], source: "human" });
  assert.equal(calls[1].url, `https://frontmend.test/api/audits/${AUDIT_ID}/explorations`);
  assert.equal(calls[2].url, `https://frontmend.test/api/audits/${AUDIT_ID}/explorations/${missionId}`);
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
  const service = createAuditService({
    transport: {
      listRepairs: async () => ({ auditId: AUDIT_ID, repairs: [draft] }),
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
    },
  });

  await service.listRepairs(AUDIT_ID);
  assert.equal(service.getRepairs(AUDIT_ID)[0].status, "draft");
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
            code: "PROVIDER_RATE_LIMITED",
            message: "The live audit provider is busy.",
            recoverable: true,
          },
        },
        { status: 429 },
      ),
  });

  await assert.rejects(
    () => transport.start({ url: "https://removemyexif.com/", source: "human" }),
    (error) =>
      error instanceof AuditError &&
      error.code === "PROVIDER_RATE_LIMITED" &&
      error.recoverable === true,
  );
});
