import assert from "node:assert/strict";
import test from "node:test";
import {
  AuditError,
  createAuditService,
  createHttpAuditTransport,
  normalizePublicUrl,
} from "../src/audit-service.js";

const AUDIT_ID = "b8b16bf0-913c-40ea-a741-bb4bf76d326b";
const missionCheckpoint = (missionRevision = 1) => ({ auditId: AUDIT_ID, missionRevision });

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

test("keeps the human-selected finding as the active no-ID evidence capsule", async () => {
  const findings = [
    {
      id: "finding-mobile",
      title: "Mobile action has insufficient contrast",
      severity: "high",
      category: "Accessibility",
      focusAreas: ["accessibility"],
      viewport: "Mobile",
      selector: ".primary-action",
      evidence: "The retained mobile measurement failed the contrast threshold.",
      source: { provider: "Lighthouse", auditId: "color-contrast", strategy: "mobile" },
    },
    {
      id: "finding-desktop",
      title: "Desktop control has no accessible name",
      severity: "medium",
      category: "Accessibility",
      focusAreas: ["accessibility"],
      viewport: "Desktop",
      selector: "#menu-control",
      evidence: "The retained desktop measurement found no accessible name.",
      source: { provider: "Lighthouse", auditId: "button-name", strategy: "desktop" },
    },
  ];
  const report = {
    auditId: AUDIT_ID,
    url: "https://example.com/",
    finalUrl: "https://example.com/",
    completedAt: 1_777_000_000_000,
    findings,
    viewports: [
      { id: "mobile", label: "Mobile", evidenceUrl: `/api/audits/${AUDIT_ID}/evidence/mobile` },
      { id: "desktop", label: "Desktop", evidenceUrl: `/api/audits/${AUDIT_ID}/evidence/desktop` },
    ],
  };
  const service = createAuditService({
    now: () => 10,
    transport: {
      start: async ({ url, source, mission }) => ({
        id: AUDIT_ID,
        url,
        source,
        mission,
        status: "complete",
        phase: "complete",
        progress: 100,
        report,
        missionRevision: 3,
      }),
    },
  });
  await service.startAudit({
    url: "example.com",
    source: "human",
    mission: { focusAreas: ["accessibility"], maxPriorities: 3 },
  });

  service.setActiveEvidenceFinding(AUDIT_ID, "finding-desktop");
  const capsule = service.getActiveEvidenceCapsule();
  assert.equal(capsule.findingId, "finding-desktop");
  assert.equal(capsule.target.selector, "#menu-control");
  assert.equal(capsule.screenshot.url, `/api/audits/${AUDIT_ID}/evidence/desktop`);
  assert.equal(capsule.auditRevision, 3);
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
    missionCheckpoint: missionCheckpoint(),
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
        schemaVersion: 2,
        intent: "assess",
        focusAreas: [],
        maxPriorities: 3,
        scope: "page",
        routeLimit: 3,
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
        auditId: AUDIT_ID,
        repairs: [{ id: "repair-1", auditId: AUDIT_ID }],
        policy: { version: 1, mode: "review" },
      }),
      listDiagnosticMissions: async () => ({
        auditId: AUDIT_ID,
        missions: [{ id: "diagnostic-1", auditId: AUDIT_ID }],
      }),
      getBrowserReview: async () => ({
        auditId: AUDIT_ID,
        review: { id: "review-1", auditId: AUDIT_ID },
      }),
      listExplorations: async () => ({
        rootAuditId: AUDIT_ID,
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
      listRepairs: async () => ({ auditId: AUDIT_ID, repairs: [] }),
      listDiagnosticMissions: async () => ({ auditId: AUDIT_ID, missions: [] }),
      getBrowserReview: async () => {
        throw new AuditError("BROWSER_REVIEW_UNAVAILABLE", "Review unavailable.");
      },
      listExplorations: async () => ({ rootAuditId: AUDIT_ID, explorations: [] }),
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
      listRepairs: async () => ({ auditId: AUDIT_ID, repairs: [] }),
      listDiagnosticMissions: async () => ({ auditId: AUDIT_ID, missions: [] }),
      getBrowserReview: async () => ({ auditId: AUDIT_ID, review: null }),
      listExplorations: async () => ({ rootAuditId: AUDIT_ID, explorations: [] }),
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
        auditId: AUDIT_ID,
        repairs: [{ id: "repair-foreign", auditId: "95b52d88-0ed2-49df-a740-0f548065dadd" }],
      }),
      listDiagnosticMissions: async () => ({ auditId: AUDIT_ID, missions: [] }),
      getBrowserReview: async () => ({ auditId: AUDIT_ID, review: null }),
      listExplorations: async () => ({ rootAuditId: AUDIT_ID, explorations: [] }),
    },
  });

  await assert.rejects(
    () => service.restoreAuditWorkspace(AUDIT_ID),
    (error) => error.code === "AUDIT_RESPONSE_MISMATCH",
  );
  assert.deepEqual(service.getRepairs(AUDIT_ID), []);
});

test("rejects mismatched top-level mission workspaces before direct cache publication", async () => {
  const foreignAuditId = "95b52d88-0ed2-49df-a740-0f548065dadd";
  const service = createAuditService({
    transport: {
      listRepairs: async () => ({ auditId: foreignAuditId, repairs: [] }),
      listDiagnosticMissions: async () => ({ auditId: foreignAuditId, missions: [] }),
      getBrowserReview: async () => ({ auditId: foreignAuditId, review: null }),
    },
  });

  for (const read of [
    () => service.listRepairs(AUDIT_ID),
    () => service.listDiagnosticMissions(AUDIT_ID),
    () => service.loadBrowserReview(AUDIT_ID),
  ]) {
    await assert.rejects(read, (error) => error.code === "AUDIT_RESPONSE_MISMATCH");
  }
  assert.deepEqual(service.getRepairs(AUDIT_ID), []);
  assert.deepEqual(service.getDiagnosticMissions(AUDIT_ID), []);
  assert.equal(service.getBrowserReview(AUDIT_ID), null);
});

test("rejects mismatched result, checkpoint, and aggregate identities before publication", async () => {
  const foreignAuditId = "95b52d88-0ed2-49df-a740-0f548065dadd";
  const repairId = "repair-1";
  const service = createAuditService({
    transport: {
      start: async ({ url, source, mission }) => ({
        id: AUDIT_ID,
        url,
        source,
        mission,
        status: "queued",
        progress: 4,
      }),
      results: async () => ({
        auditId: foreignAuditId,
        findings: [],
        missionCheckpoint: { auditId: foreignAuditId, missionRevision: 2 },
      }),
      checkpoint: async () => ({ auditId: foreignAuditId, missionRevision: 2 }),
      repairVerification: async () => ({
        id: "run-1",
        auditId: foreignAuditId,
        repairId,
        status: "resolved",
        rows: [],
      }),
    },
  });

  await service.startAudit({ url: "https://example.com/" });
  await assert.rejects(
    () => service.getResults(AUDIT_ID),
    (error) => error.code === "AUDIT_RESPONSE_MISMATCH",
  );
  await assert.rejects(
    () => service.loadMissionCheckpoint(AUDIT_ID),
    (error) => error.code === "AUDIT_RESPONSE_MISMATCH",
  );
  await assert.rejects(
    () => service.getRepairVerification(AUDIT_ID, repairId),
    (error) => error.code === "AUDIT_RESPONSE_MISMATCH",
  );
  assert.equal(service.getActiveAudit().id, AUDIT_ID);
  assert.equal(service.getActiveAudit().status, "queued");
  assert.equal(service.getMissionCheckpoint(AUDIT_ID).missionRevision, 1);
  assert.deepEqual(service.getRepairs(AUDIT_ID), []);
  assert.deepEqual(service.getRepairs(foreignAuditId), []);
});

test("rejects foreign mutation records before changing shared mission caches", async () => {
  const foreignAuditId = "95b52d88-0ed2-49df-a740-0f548065dadd";
  const reviewId = "review-1";
  const missionId = "mission-1";
  const repairId = "repair-1";
  const service = createAuditService({
    transport: {
      openBrowserReview: async () => ({ id: reviewId, auditId: foreignAuditId }),
      submitDiagnosticEvidence: async () => ({ id: missionId, auditId: foreignAuditId }),
      stageRepair: async () => ({ id: repairId, auditId: foreignAuditId }),
    },
  });

  await assert.rejects(
    () => service.openBrowserReview(AUDIT_ID),
    (error) => error.code === "AUDIT_RESPONSE_MISMATCH",
  );
  await assert.rejects(
    () => service.submitDiagnosticEvidence(AUDIT_ID, missionId, {
      summary: "Bounded diagnosis.",
      reproduction: "Reload the public route.",
      observations: [{ kind: "console", detail: "The retained failure reproduces." }],
      sourceLocations: [{ file: "src/runtime.js", reason: "Owns the initialiser." }],
      verificationChecks: ["bun test"],
      confidence: "medium",
    }),
    (error) => error.code === "AUDIT_RESPONSE_MISMATCH",
  );
  await assert.rejects(
    () => service.stageRepair(AUDIT_ID, { findingId: "finding-1", source: "agent" }),
    (error) => error.code === "AUDIT_RESPONSE_MISMATCH",
  );
  assert.equal(service.getBrowserReview(AUDIT_ID), null);
  assert.equal(service.getBrowserReview(foreignAuditId), null);
  assert.deepEqual(service.getDiagnosticMissions(AUDIT_ID), []);
  assert.deepEqual(service.getDiagnosticMissions(foreignAuditId), []);
  assert.deepEqual(service.getRepairs(AUDIT_ID), []);
  assert.deepEqual(service.getRepairs(foreignAuditId), []);
});

test("rejects wrong retained IDs and continuation lineage before changing workspaces", async () => {
  const reviewId = "review-1";
  const missionId = "mission-1";
  const repairId = "repair-1";
  const childId = "c45d54ea-6884-4c86-b82d-b9048cff697f";
  const foreignAuditId = "95b52d88-0ed2-49df-a740-0f548065dadd";
  const service = createAuditService({
    transport: {
      recordBrowserReviewCheck: async () => ({ id: "review-2", auditId: AUDIT_ID }),
      recordDiagnosticBlocker: async () => ({ id: "mission-2", auditId: AUDIT_ID }),
      approveRepair: async () => ({ id: "repair-2", auditId: AUDIT_ID }),
      startRelated: async () => ({
        id: childId,
        status: "queued",
        exploration: {
          rootAuditId: foreignAuditId,
          parentAuditId: foreignAuditId,
          observedPath: "/privacy",
        },
        missionCheckpoint: { auditId: AUDIT_ID, missionRevision: 2 },
      }),
      startVerification: async () => ({
        id: childId,
        baselineAuditId: foreignAuditId,
        repairId,
        verificationAuditIds: [childId],
        status: "queued",
        missionCheckpoint: { auditId: AUDIT_ID, missionRevision: 2 },
      }),
    },
  });

  await assert.rejects(
    () => service.recordBrowserReviewCheck(AUDIT_ID, reviewId, {
      checkId: "rendered-structure",
      outcome: "passed",
      summary: "Checked the retained structure.",
      observations: ["The page has one primary heading."],
    }),
    (error) => error.code === "AUDIT_RESPONSE_MISMATCH",
  );
  await assert.rejects(
    () => service.recordDiagnosticBlocker(AUDIT_ID, missionId, {
      reason: "repository-unavailable",
      summary: "The authorised repository is not available in this session.",
    }),
    (error) => error.code === "AUDIT_RESPONSE_MISMATCH",
  );
  await assert.rejects(
    () => service.approveRepair(AUDIT_ID, repairId),
    (error) => error.code === "AUDIT_RESPONSE_MISMATCH",
  );
  await assert.rejects(
    () => service.startRelatedAudit(AUDIT_ID, "/privacy"),
    (error) => error.code === "AUDIT_RESPONSE_MISMATCH",
  );
  await assert.rejects(
    () => service.startVerification(AUDIT_ID, repairId),
    (error) => error.code === "AUDIT_RESPONSE_MISMATCH",
  );
  assert.equal(service.getActiveAudit(), null);
  assert.equal(service.getBrowserReview(AUDIT_ID), null);
  assert.deepEqual(service.getDiagnosticMissions(AUDIT_ID), []);
  assert.deepEqual(service.getRepairs(AUDIT_ID), []);
});

test("rejects a foreign mutation checkpoint even when the returned record is otherwise current", async () => {
  const foreignAuditId = "95b52d88-0ed2-49df-a740-0f548065dadd";
  const childId = "c45d54ea-6884-4c86-b82d-b9048cff697f";
  const service = createAuditService({
    transport: {
      setRepairPolicy: async () => ({
        version: 1,
        mode: "auto-low-risk",
        remainingAutoApprovals: 3,
        deploymentAttestation: "person-only",
        missionCheckpoint: { auditId: foreignAuditId, missionRevision: 2 },
      }),
      startRelated: async () => ({
        id: childId,
        status: "queued",
        exploration: {
          rootAuditId: AUDIT_ID,
          parentAuditId: AUDIT_ID,
          observedPath: "/privacy",
        },
        missionCheckpoint: { auditId: foreignAuditId, missionRevision: 2 },
      }),
    },
  });

  await assert.rejects(
    () => service.setRepairPolicy(AUDIT_ID, "auto-low-risk"),
    (error) => error.code === "AUDIT_RESPONSE_MISMATCH",
  );
  await assert.rejects(
    () => service.startRelatedAudit(AUDIT_ID, "/privacy"),
    (error) => error.code === "AUDIT_RESPONSE_MISMATCH",
  );
  assert.equal(service.getRepairPolicy(AUDIT_ID).mode, "review");
  assert.equal(service.getActiveAudit(), null);
});

test("rejects a regressive same-audit mission response before cache publication", async () => {
  const currentCheckpoint = {
    auditId: AUDIT_ID,
    missionRevision: 7,
    status: "action-available",
  };
  const service = createAuditService({
    transport: {
      start: async ({ url, source, mission }) => ({
        id: AUDIT_ID,
        url,
        source,
        mission,
        missionRevision: 7,
        missionCheckpoint: currentCheckpoint,
        status: "complete",
        progress: 100,
        report: { auditId: AUDIT_ID, findings: [] },
      }),
      setRepairPolicy: async () => ({
        version: 1,
        mode: "auto-low-risk",
        remainingAutoApprovals: 3,
        deploymentAttestation: "person-only",
        missionCheckpoint: {
          ...currentCheckpoint,
          missionRevision: 6,
        },
      }),
    },
  });

  await service.startAudit({ url: "https://example.com/" });
  await assert.rejects(
    () => service.setRepairPolicy(AUDIT_ID, "auto-low-risk"),
    (error) => error.code === "MISSION_REVISION_STALE"
      && error.details?.missionCheckpoint?.missionRevision === 7,
  );

  assert.equal(service.getActiveAudit().missionRevision, 7);
  assert.equal(service.getRepairPolicy(AUDIT_ID).mode, "review");
});

test("rejects mission mutations that omit their authoritative checkpoint", async () => {
  const service = createAuditService({
    transport: {
      start: async ({ url, source, mission }) => ({
        id: AUDIT_ID,
        url,
        source,
        mission,
        missionRevision: 3,
        missionCheckpoint: missionCheckpoint(3),
        status: "complete",
        progress: 100,
        report: { auditId: AUDIT_ID, findings: [] },
      }),
      setRepairPolicy: async () => ({
        version: 1,
        mode: "auto-low-risk",
        remainingAutoApprovals: 3,
        deploymentAttestation: "person-only",
      }),
    },
  });

  await service.startAudit({ url: "https://example.com/" });
  await assert.rejects(
    () => service.setRepairPolicy(AUDIT_ID, "auto-low-risk"),
    (error) => error.code === "INVALID_RESPONSE"
      && /authoritative checkpoint/i.test(error.message),
  );

  assert.equal(service.getActiveAudit().missionRevision, 3);
  assert.equal(service.getRepairPolicy(AUDIT_ID).mode, "review");
});

test("requires an authoritative checkpoint from every continuation response family", async () => {
  const reviewId = "review-1";
  const missionId = "mission-1";
  const repairId = "repair-1";
  const findingId = "finding-1";
  const verificationId = "verification-1";
  const service = createAuditService({
    transport: {
      startRelated: async (_auditId, path) => ({
        id: "related-1",
        exploration: { parentAuditId: AUDIT_ID, observedPath: path },
      }),
      prepareRepair: async () => ({
        mission: { repairPreparation: { findingId } },
      }),
      startExploration: async () => ({ id: "exploration-1", rootAuditId: AUDIT_ID }),
      cancel: async () => ({ id: AUDIT_ID, status: "cancelled" }),
      openBrowserReview: async () => ({ id: reviewId, auditId: AUDIT_ID }),
      recordBrowserReviewCheck: async () => ({
        id: reviewId,
        auditId: AUDIT_ID,
        results: [{ checkId: "rendered-structure", outcome: "passed" }],
      }),
      withdrawBrowserReview: async () => ({ id: reviewId, auditId: AUDIT_ID }),
      openDiagnosticMission: async () => ({ id: missionId, auditId: AUDIT_ID, findingId }),
      submitDiagnosticEvidence: async () => ({ id: missionId, auditId: AUDIT_ID }),
      recordDiagnosticBlocker: async () => ({ id: missionId, auditId: AUDIT_ID }),
      setRepairPolicy: async () => ({ mode: "review" }),
      stageRepair: async () => ({ id: repairId, auditId: AUDIT_ID, findingId }),
      approveRepair: async () => ({ id: repairId, auditId: AUDIT_ID }),
      requestRepairChanges: async () => ({ id: repairId, auditId: AUDIT_ID }),
      reviseRepair: async () => ({ id: repairId, auditId: AUDIT_ID }),
      recordImplementation: async () => ({ id: repairId, auditId: AUDIT_ID }),
      attestDeployment: async () => ({ id: repairId, auditId: AUDIT_ID }),
      startVerification: async () => ({
        id: verificationId,
        baselineAuditId: AUDIT_ID,
        repairId,
        verificationAuditIds: [verificationId],
      }),
    },
  });
  const cases = [
    ["related route", () => service.startRelatedAudit(AUDIT_ID, "/privacy")],
    ["repair intent", () => service.prepareRepair(AUDIT_ID, findingId)],
    ["site exploration", () => service.startSiteExploration(AUDIT_ID, ["/privacy"])],
    ["cancellation", () => service.cancelAudit(AUDIT_ID)],
    ["browser review open", () => service.openBrowserReview(AUDIT_ID)],
    ["browser review result", () => service.recordBrowserReviewCheck(AUDIT_ID, reviewId, {
      checkId: "rendered-structure",
      outcome: "passed",
    })],
    ["browser review withdrawal", () => service.withdrawBrowserReview(AUDIT_ID, reviewId)],
    ["diagnostic open", () => service.openDiagnosticMission(AUDIT_ID, findingId)],
    ["diagnostic evidence", () => service.submitDiagnosticEvidence(AUDIT_ID, missionId, {})],
    ["diagnostic blocker", () => service.recordDiagnosticBlocker(AUDIT_ID, missionId, {})],
    ["repair policy", () => service.setRepairPolicy(AUDIT_ID, "review")],
    ["repair staging", () => service.stageRepair(AUDIT_ID, { findingId })],
    ["repair approval", () => service.approveRepair(AUDIT_ID, repairId)],
    ["repair change request", () => service.requestRepairChanges(AUDIT_ID, repairId, "Recheck scope.")],
    ["repair revision", () => service.reviseRepair(AUDIT_ID, repairId, {})],
    ["implementation", () => service.recordImplementation(AUDIT_ID, repairId, {})],
    ["deployment attestation", () => service.attestDeployment(AUDIT_ID, repairId)],
    ["verification start", () => service.startVerification(AUDIT_ID, repairId)],
  ];

  for (const [label, continuation] of cases) {
    await assert.rejects(
      continuation,
      (error) => error.code === "INVALID_RESPONSE"
        && /authoritative checkpoint/i.test(error.message),
      label,
    );
  }

  assert.deepEqual(service.getRepairs(AUDIT_ID), []);
  assert.deepEqual(service.getDiagnosticMissions(AUDIT_ID), []);
  assert.equal(service.getBrowserReview(AUDIT_ID), null);
  assert.deepEqual(service.getSiteExplorations(AUDIT_ID), []);
});

test("rejects a direct results read without its authoritative checkpoint", async () => {
  const retainedReport = { auditId: AUDIT_ID, findings: [{ id: "retained-finding" }] };
  const service = createAuditService({
    transport: {
      start: async ({ url, source, mission }) => ({
        id: AUDIT_ID,
        url,
        source,
        mission,
        missionRevision: 3,
        missionCheckpoint: missionCheckpoint(3),
        status: "complete",
        progress: 100,
        report: retainedReport,
      }),
      results: async () => ({ auditId: AUDIT_ID, findings: [{ id: "unstamped-finding" }] }),
    },
  });

  await service.startAudit({ url: "https://example.com/" });
  await assert.rejects(
    () => service.getResults(AUDIT_ID),
    (error) => error.code === "INVALID_RESPONSE"
      && /authoritative checkpoint/i.test(error.message),
  );

  assert.deepEqual(service.getActiveAudit().report, retainedReport);
});

test("rejects regressive same-audit read workspaces before replacing newer mission state", async () => {
  const staleCheckpoint = missionCheckpoint(4);
  const missionId = "232d593c-6c81-48c3-b137-a3df269454ff";
  const repairId = "repair-1";
  const findingId = "color-contrast";
  const service = createAuditService({
    transport: {
      start: async ({ url, source, mission }) => ({
        id: AUDIT_ID,
        url,
        source,
        mission,
        missionRevision: 5,
        missionCheckpoint: missionCheckpoint(5),
        status: "complete",
        progress: 100,
        report: { auditId: AUDIT_ID, findings: [] },
      }),
      listRepairs: async () => ({
        auditId: AUDIT_ID,
        repairs: [{ id: repairId, auditId: AUDIT_ID }],
        missionCheckpoint: staleCheckpoint,
      }),
      listDiagnosticMissions: async () => ({
        auditId: AUDIT_ID,
        missions: [{ id: "mission-1", auditId: AUDIT_ID }],
        missionCheckpoint: staleCheckpoint,
      }),
      getBrowserReview: async () => ({
        auditId: AUDIT_ID,
        review: { id: "review-1", auditId: AUDIT_ID },
        missionCheckpoint: staleCheckpoint,
      }),
      listExplorations: async () => ({
        rootAuditId: AUDIT_ID,
        explorations: [{ id: missionId, rootAuditId: AUDIT_ID }],
        missionCheckpoint: staleCheckpoint,
      }),
      getExploration: async () => ({
        id: missionId,
        rootAuditId: AUDIT_ID,
        missionCheckpoint: staleCheckpoint,
      }),
      verificationCandidates: async () => ({
        auditId: AUDIT_ID,
        findingId,
        candidates: [],
        missionCheckpoint: staleCheckpoint,
      }),
      repairVerification: async () => ({
        id: "run-1",
        auditId: AUDIT_ID,
        repairId,
        rows: [],
        missionCheckpoint: staleCheckpoint,
      }),
    },
  });

  await service.startAudit({ url: "https://example.com/" });
  for (const read of [
    () => service.listRepairs(AUDIT_ID),
    () => service.listDiagnosticMissions(AUDIT_ID),
    () => service.loadBrowserReview(AUDIT_ID),
    () => service.listSiteExplorations(AUDIT_ID),
    () => service.getSiteExploration(AUDIT_ID, missionId),
    () => service.getVerificationCandidates(AUDIT_ID, findingId),
    () => service.getRepairVerification(AUDIT_ID, repairId),
  ]) {
    await assert.rejects(
      read,
      (error) => error.code === "MISSION_REVISION_STALE"
        && error.details?.missionCheckpoint?.missionRevision === 5,
    );
  }

  assert.equal(service.getActiveAudit().missionRevision, 5);
  assert.deepEqual(service.getRepairs(AUDIT_ID), []);
  assert.deepEqual(service.getDiagnosticMissions(AUDIT_ID), []);
  assert.equal(service.getBrowserReview(AUDIT_ID), null);
  assert.deepEqual(service.getSiteExplorations(AUDIT_ID), []);
});

test("publishes same-revision direct reads atomically with their mission workspace state", async () => {
  const repairId = "repair-1";
  const findingId = "color-contrast";
  const missionId = "mission-1";
  const reviewId = "review-1";
  const explorationId = "exploration-1";
  const service = createAuditService({
    transport: {
      start: async ({ url, source, mission }) => ({
        id: AUDIT_ID,
        url,
        source,
        mission,
        missionRevision: 2,
        missionCheckpoint: missionCheckpoint(2),
        status: "complete",
        progress: 100,
        report: { auditId: AUDIT_ID, findings: [{ id: findingId }] },
      }),
      listRepairs: async () => ({
        auditId: AUDIT_ID,
        repairs: [{ id: repairId, auditId: AUDIT_ID, findingId }],
        missionCheckpoint: missionCheckpoint(2),
      }),
      listDiagnosticMissions: async () => ({
        auditId: AUDIT_ID,
        missions: [{ id: missionId, auditId: AUDIT_ID, findingId }],
        missionCheckpoint: missionCheckpoint(2),
      }),
      getBrowserReview: async () => ({
        auditId: AUDIT_ID,
        review: { id: reviewId, auditId: AUDIT_ID, results: [] },
        missionCheckpoint: missionCheckpoint(2),
      }),
      listExplorations: async () => ({
        rootAuditId: AUDIT_ID,
        explorations: [{ id: explorationId, rootAuditId: AUDIT_ID }],
        missionCheckpoint: missionCheckpoint(2),
      }),
      verificationCandidates: async () => ({
        auditId: AUDIT_ID,
        findingId,
        candidates: [],
        missionCheckpoint: missionCheckpoint(2),
      }),
      repairVerification: async () => ({
        id: "verification-run-1",
        auditId: AUDIT_ID,
        repairId,
        rows: [],
        missionCheckpoint: missionCheckpoint(2),
      }),
    },
  });

  await service.startAudit({ url: "https://example.com/" });
  const publications = [];
  const unsubscribe = service.subscribe(() => {
    publications.push({
      revision: service.getMissionCheckpoint(AUDIT_ID)?.missionRevision,
      repairs: service.getRepairs(AUDIT_ID).length,
      diagnostics: service.getDiagnosticMissions(AUDIT_ID).length,
      reviewId: service.getBrowserReview(AUDIT_ID)?.id ?? null,
      explorations: service.getSiteExplorations(AUDIT_ID).length,
    });
  });

  const reads = [
    [() => service.listRepairs(AUDIT_ID), { repairs: 1 }],
    [() => service.listDiagnosticMissions(AUDIT_ID), { repairs: 1, diagnostics: 1 }],
    [() => service.loadBrowserReview(AUDIT_ID), { repairs: 1, diagnostics: 1, reviewId }],
    [() => service.listSiteExplorations(AUDIT_ID), {
      repairs: 1,
      diagnostics: 1,
      reviewId,
      explorations: 1,
    }],
    [() => service.getVerificationCandidates(AUDIT_ID, findingId), {
      repairs: 1,
      diagnostics: 1,
      reviewId,
      explorations: 1,
    }],
    [() => service.getRepairVerification(AUDIT_ID, repairId), {
      repairs: 1,
      diagnostics: 1,
      reviewId,
      explorations: 1,
    }],
  ];

  for (const [read, expectedState] of reads) {
    const publicationCount = publications.length;
    await read();
    assert.equal(service.getMissionCheckpoint(AUDIT_ID).missionRevision, 2);
    assert.equal(publications.length, publicationCount + 1);
    assert.deepEqual(publications.at(-1), {
      revision: 2,
      repairs: 0,
      diagnostics: 0,
      reviewId: null,
      explorations: 0,
      ...expectedState,
    });
  }
  unsubscribe();
});

test("reconciles every mission cache before publishing a direct read from a newer revision", async () => {
  const repair = { id: "repair-1", auditId: AUDIT_ID, findingId: "color-contrast" };
  const diagnosis = { id: "diagnostic-1", auditId: AUDIT_ID, findingId: "color-contrast" };
  const review = { id: "review-1", auditId: AUDIT_ID, results: [] };
  const exploration = { id: "exploration-1", rootAuditId: AUDIT_ID, status: "running" };
  const checkpoint = missionCheckpoint(3);
  const currentAudit = {
    id: AUDIT_ID,
    url: "https://example.com/",
    source: "agent",
    missionRevision: 3,
    missionCheckpoint: checkpoint,
    status: "complete",
    progress: 100,
    report: { auditId: AUDIT_ID, findings: [] },
  };
  const service = createAuditService({
    transport: {
      start: async ({ url, source, mission }) => ({
        ...currentAudit,
        url,
        source,
        mission,
        missionRevision: 2,
        missionCheckpoint: missionCheckpoint(2),
      }),
      get: async () => currentAudit,
      checkpoint: async () => checkpoint,
      listRepairs: async () => ({
        auditId: AUDIT_ID,
        repairs: [repair],
        policy: { mode: "review" },
        missionCheckpoint: checkpoint,
      }),
      listDiagnosticMissions: async () => ({
        auditId: AUDIT_ID,
        missions: [diagnosis],
        missionCheckpoint: checkpoint,
      }),
      getBrowserReview: async () => ({
        auditId: AUDIT_ID,
        review,
        missionCheckpoint: checkpoint,
      }),
      listExplorations: async () => ({
        rootAuditId: AUDIT_ID,
        explorations: [exploration],
        missionCheckpoint: checkpoint,
      }),
    },
  });

  await service.startAudit({ url: "https://example.com/" });
  const publications = [];
  const unsubscribe = service.subscribe(() => {
    publications.push({
      revision: service.getMissionCheckpoint(AUDIT_ID).missionRevision,
      repairs: service.getRepairs(AUDIT_ID).length,
      diagnostics: service.getDiagnosticMissions(AUDIT_ID).length,
      review: service.getBrowserReview(AUDIT_ID)?.id ?? null,
      explorations: service.getSiteExplorations(AUDIT_ID).length,
    });
  });

  const workspace = await service.listRepairs(AUDIT_ID);
  assert.equal(workspace.missionCheckpoint.missionRevision, 3);
  assert.deepEqual(publications, [{
    revision: 3,
    repairs: 1,
    diagnostics: 1,
    review: "review-1",
    explorations: 1,
  }]);
  unsubscribe();
});

test("applies cross-revision reconciliation to every direct mission read family", async () => {
  const repairId = "repair-1";
  const findingId = "color-contrast";
  const missionId = "diagnostic-1";
  const explorationId = "exploration-1";
  const checkpoint = missionCheckpoint(3);
  const repair = {
    id: repairId,
    auditId: AUDIT_ID,
    findingId,
    aggregateVerification: { receiptAvailable: true },
  };
  const diagnosis = { id: missionId, auditId: AUDIT_ID, findingId };
  const review = { id: "review-1", auditId: AUDIT_ID, results: [] };
  const exploration = { id: explorationId, rootAuditId: AUDIT_ID, status: "running" };
  const currentAudit = {
    id: AUDIT_ID,
    url: "https://example.com/",
    source: "agent",
    missionRevision: 3,
    missionCheckpoint: checkpoint,
    status: "complete",
    progress: 100,
    report: { auditId: AUDIT_ID, findings: [{ id: findingId }] },
  };
  const transport = {
    start: async ({ url, source, mission }) => ({
      ...currentAudit,
      url,
      source,
      mission,
      missionRevision: 2,
      missionCheckpoint: missionCheckpoint(2),
    }),
    get: async () => currentAudit,
    checkpoint: async () => checkpoint,
    results: async () => ({ ...currentAudit.report, missionCheckpoint: checkpoint }),
    listRepairs: async () => ({
      auditId: AUDIT_ID,
      repairs: [repair],
      policy: { mode: "review" },
      missionCheckpoint: checkpoint,
    }),
    listDiagnosticMissions: async () => ({
      auditId: AUDIT_ID,
      missions: [diagnosis],
      missionCheckpoint: checkpoint,
    }),
    getBrowserReview: async () => ({
      auditId: AUDIT_ID,
      review,
      missionCheckpoint: checkpoint,
    }),
    listExplorations: async () => ({
      rootAuditId: AUDIT_ID,
      explorations: [exploration],
      missionCheckpoint: checkpoint,
    }),
    getExploration: async () => ({ ...exploration, missionCheckpoint: checkpoint }),
    verificationCandidates: async () => ({
      auditId: AUDIT_ID,
      findingId,
      candidates: [],
      missionCheckpoint: checkpoint,
    }),
    repairVerification: async () => ({
      id: "verification-run-1",
      auditId: AUDIT_ID,
      repairId,
      rows: [],
      missionCheckpoint: checkpoint,
    }),
  };
  const reads = [
    ["results", (service) => service.getResults(AUDIT_ID)],
    ["repair collection", (service) => service.listRepairs(AUDIT_ID)],
    ["diagnosis collection", (service) => service.listDiagnosticMissions(AUDIT_ID)],
    ["browser review", (service) => service.loadBrowserReview(AUDIT_ID)],
    ["exploration collection", (service) => service.listSiteExplorations(AUDIT_ID)],
    ["exploration detail", (service) => service.getSiteExploration(AUDIT_ID, explorationId)],
    ["verification candidates", (service) => service.getVerificationCandidates(AUDIT_ID, findingId)],
    ["repair verification", (service) => service.getRepairVerification(AUDIT_ID, repairId)],
  ];

  for (const [label, read] of reads) {
    const service = createAuditService({ transport });
    await service.startAudit({ url: "https://example.com/" });
    const publications = [];
    const unsubscribe = service.subscribe(() => {
      publications.push({
        revision: service.getMissionCheckpoint(AUDIT_ID)?.missionRevision,
        repairs: service.getRepairs(AUDIT_ID).length,
        diagnostics: service.getDiagnosticMissions(AUDIT_ID).length,
        review: service.getBrowserReview(AUDIT_ID)?.id ?? null,
        explorations: service.getSiteExplorations(AUDIT_ID).length,
      });
    });

    const value = await read(service);
    assert.equal(value.missionCheckpoint.missionRevision, 3, label);
    assert.deepEqual(publications, [{
      revision: 3,
      repairs: 1,
      diagnostics: 1,
      review: "review-1",
      explorations: 1,
    }], label);
    unsubscribe();
  }
});

test("keeps the retained mission unpublished when a newer direct read cannot fully reconcile", async () => {
  const checkpoint = missionCheckpoint(3);
  const currentAudit = {
    id: AUDIT_ID,
    url: "https://example.com/",
    source: "agent",
    missionRevision: 3,
    missionCheckpoint: checkpoint,
    status: "complete",
    progress: 100,
    report: { auditId: AUDIT_ID, findings: [] },
  };
  const service = createAuditService({
    transport: {
      start: async ({ url, source, mission }) => ({
        ...currentAudit,
        url,
        source,
        mission,
        missionRevision: 2,
        missionCheckpoint: missionCheckpoint(2),
      }),
      get: async () => currentAudit,
      checkpoint: async () => checkpoint,
      listRepairs: async () => ({
        auditId: AUDIT_ID,
        repairs: [{ id: "repair-1", auditId: AUDIT_ID, findingId: "color-contrast" }],
        missionCheckpoint: checkpoint,
      }),
      listDiagnosticMissions: async () => {
        throw new AuditError("DIAGNOSTIC_READ_FAILED", "Diagnosis state is temporarily unavailable.");
      },
      getBrowserReview: async () => ({
        auditId: AUDIT_ID,
        review: null,
        missionCheckpoint: checkpoint,
      }),
      listExplorations: async () => ({
        rootAuditId: AUDIT_ID,
        explorations: [],
        missionCheckpoint: checkpoint,
      }),
    },
  });

  await service.startAudit({ url: "https://example.com/" });
  let publications = 0;
  const unsubscribe = service.subscribe(() => {
    publications += 1;
  });

  await assert.rejects(
    () => service.listRepairs(AUDIT_ID),
    (error) => error.code === "MISSION_WORKSPACE_INCOMPLETE"
      && error.details?.missionCheckpoint?.missionRevision === 3
      && error.details?.unavailable?.includes("diagnostics"),
  );
  assert.equal(publications, 0);
  assert.equal(service.getMissionCheckpoint(AUDIT_ID).missionRevision, 2);
  assert.deepEqual(service.getRepairs(AUDIT_ID), []);
  unsubscribe();
});

test("publishes repair preparation as one checkpoint-complete state", async () => {
  const findingId = "color-contrast";
  let audit = null;
  const checkpoint = missionCheckpoint(2);
  const service = createAuditService({
    transport: {
      start: async ({ url, source, mission }) => {
        audit = {
          id: AUDIT_ID,
          url,
          source,
          mission,
          status: "complete",
          progress: 100,
          report: { auditId: AUDIT_ID, findings: [{ id: findingId }] },
          missionRevision: 1,
          missionCheckpoint: missionCheckpoint(1),
        };
        return audit;
      },
      prepareRepair: async () => {
        const mission = {
          ...audit.mission,
          intent: "prepare-fix",
          repairPreparation: { findingId, requestedBy: "agent", requestedAt: 20 },
        };
        return {
          audit: { ...audit, mission, missionRevision: 2, missionCheckpoint: checkpoint },
          mission,
          missionState: { status: "action-available" },
          missionCheckpoint: checkpoint,
        };
      },
    },
  });

  await service.startAudit({ url: "https://example.com/" });
  const publications = [];
  const unsubscribe = service.subscribe(() => publications.push({
    revision: service.getMissionCheckpoint(AUDIT_ID)?.missionRevision,
    findingId: service.getActiveAudit()?.mission?.repairPreparation?.findingId ?? null,
  }));

  await service.prepareRepair(AUDIT_ID, findingId, "agent");
  assert.deepEqual(publications, [{ revision: 2, findingId }]);
  unsubscribe();
});

test("rejects contradictory repair-preparation checkpoints before publication", async () => {
  const findingId = "color-contrast";
  let audit = null;
  const service = createAuditService({
    transport: {
      start: async ({ url, source, mission }) => {
        audit = {
          id: AUDIT_ID,
          url,
          source,
          mission,
          status: "complete",
          progress: 100,
          report: { auditId: AUDIT_ID, findings: [{ id: findingId }] },
          missionRevision: 1,
          missionCheckpoint: missionCheckpoint(1),
        };
        return audit;
      },
      prepareRepair: async () => {
        const mission = {
          ...audit.mission,
          intent: "prepare-fix",
          repairPreparation: { findingId, requestedBy: "agent", requestedAt: 20 },
        };
        return {
          audit: {
            ...audit,
            mission,
            missionRevision: 2,
            missionCheckpoint: missionCheckpoint(2),
          },
          mission,
          missionState: { status: "action-available" },
          missionCheckpoint: missionCheckpoint(3),
        };
      },
    },
  });

  await service.startAudit({ url: "https://example.com/" });
  let publications = 0;
  const unsubscribe = service.subscribe(() => {
    publications += 1;
  });

  await assert.rejects(
    () => service.prepareRepair(AUDIT_ID, findingId, "agent"),
    (error) => error.code === "MISSION_REFRESH_UNSTABLE"
      && error.details?.missionCheckpoint?.missionRevision === 3,
  );
  assert.equal(publications, 0);
  assert.equal(service.getMissionCheckpoint(AUDIT_ID).missionRevision, 1);
  assert.equal(service.getActiveAudit().mission.repairPreparation, null);
  unsubscribe();
});

test("rejects contradictory repair-preparation missions before publication", async () => {
  const findingId = "color-contrast";
  let audit = null;
  const service = createAuditService({
    transport: {
      start: async ({ url, source, mission }) => {
        audit = {
          id: AUDIT_ID,
          url,
          source,
          mission,
          status: "complete",
          progress: 100,
          report: { auditId: AUDIT_ID, findings: [{ id: findingId }] },
          missionRevision: 1,
          missionCheckpoint: missionCheckpoint(1),
        };
        return audit;
      },
      prepareRepair: async () => {
        const mission = {
          ...audit.mission,
          intent: "prepare-fix",
          repairPreparation: { findingId, requestedBy: "agent", requestedAt: 20 },
        };
        return {
          audit: {
            ...audit,
            mission: {
              ...mission,
              focusAreas: ["seo"],
            },
            missionRevision: 2,
            missionCheckpoint: missionCheckpoint(2),
          },
          mission,
          missionState: { status: "action-available" },
          missionCheckpoint: missionCheckpoint(2),
        };
      },
    },
  });

  await service.startAudit({ url: "https://example.com/" });
  let publications = 0;
  const unsubscribe = service.subscribe(() => {
    publications += 1;
  });

  await assert.rejects(
    () => service.prepareRepair(AUDIT_ID, findingId, "agent"),
    (error) => error.code === "AUDIT_RESPONSE_MISMATCH",
  );
  assert.equal(publications, 0);
  assert.equal(service.getMissionCheckpoint(AUDIT_ID).missionRevision, 1);
  assert.equal(service.getActiveAudit().mission.repairPreparation, null);
  unsubscribe();
});

test("publishes related and verification audit starts without an intermediate parent state", async () => {
  const childAuditId = "related-audit-1";
  const verificationAuditId = "verification-audit-1";
  const repairId = "repair-1";
  const createService = (transport) => createAuditService({
    transport: {
      start: async ({ url, source, mission }) => ({
        id: AUDIT_ID,
        url,
        source,
        mission,
        status: "complete",
        progress: 100,
        report: { auditId: AUDIT_ID, findings: [] },
        missionRevision: 1,
        missionCheckpoint: missionCheckpoint(1),
      }),
      ...transport,
    },
  });
  const cases = [
    {
      label: "related audit",
      service: createService({
        startRelated: async () => ({
          id: childAuditId,
          status: "queued",
          missionRevision: 1,
          exploration: {
            rootAuditId: AUDIT_ID,
            parentAuditId: AUDIT_ID,
            observedPath: "/privacy",
          },
          missionCheckpoint: missionCheckpoint(2),
        }),
      }),
      run: (service) => service.startRelatedAudit(AUDIT_ID, "/privacy"),
      activeAuditId: childAuditId,
    },
    {
      label: "verification audit",
      service: createService({
        startVerification: async () => ({
          id: verificationAuditId,
          status: "queued",
          missionRevision: 1,
          baselineAuditId: AUDIT_ID,
          repairId,
          verificationAuditIds: [verificationAuditId],
          missionCheckpoint: missionCheckpoint(2),
        }),
      }),
      run: (service) => service.startVerification(AUDIT_ID, repairId),
      activeAuditId: verificationAuditId,
    },
  ];

  for (const item of cases) {
    await item.service.startAudit({ url: "https://example.com/" });
    const publications = [];
    const unsubscribe = item.service.subscribe(() => publications.push({
      activeAuditId: item.service.getActiveAudit()?.id ?? null,
      parentRevision: item.service.getMissionCheckpoint(AUDIT_ID)?.missionRevision,
    }));

    await item.run(item.service);
    assert.deepEqual(publications, [{
      activeAuditId: item.activeAuditId,
      parentRevision: 2,
    }], item.label);
    unsubscribe();
  }
});

test("binds same-audit diagnosis and repair continuations to the exact requested finding", async () => {
  const requestedFindingId = "finding-1";
  const otherFindingId = "finding-2";
  const missionId = "mission-1";
  const repairId = "repair-1";
  let retainedAudit;
  let returnedFindingId = otherFindingId;
  const preparedMission = () => ({
    ...retainedAudit.mission,
    intent: "prepare-fix",
    repairPreparation: {
      findingId: returnedFindingId,
      requestedBy: "agent",
      requestedAt: 20,
    },
  });
  const service = createAuditService({
    transport: {
      start: async ({ url, source, mission }) => {
        retainedAudit = {
          id: AUDIT_ID,
          url,
          source,
          mission,
          status: "complete",
          progress: 100,
          report: { auditId: AUDIT_ID, findings: [] },
        };
        return retainedAudit;
      },
      prepareRepair: async () => ({
        audit: { ...retainedAudit, mission: preparedMission() },
        mission: preparedMission(),
        missionState: { status: "action-available" },
        missionCheckpoint: missionCheckpoint(),
      }),
      openDiagnosticMission: async () => ({
        id: missionId,
        auditId: AUDIT_ID,
        findingId: returnedFindingId,
        missionCheckpoint: missionCheckpoint(),
      }),
      stageRepair: async () => ({
        id: repairId,
        auditId: AUDIT_ID,
        findingId: returnedFindingId,
        status: "draft",
        missionCheckpoint: missionCheckpoint(),
      }),
    },
  });

  await service.startAudit({ url: "https://example.com/" });
  await assert.rejects(
    () => service.prepareRepair(AUDIT_ID, requestedFindingId, "human"),
    (error) => error.code === "AUDIT_RESPONSE_MISMATCH",
  );
  await assert.rejects(
    () => service.openDiagnosticMission(AUDIT_ID, requestedFindingId),
    (error) => error.code === "AUDIT_RESPONSE_MISMATCH",
  );
  await assert.rejects(
    () => service.stageRepair(AUDIT_ID, { findingId: requestedFindingId, source: "agent" }),
    (error) => error.code === "AUDIT_RESPONSE_MISMATCH",
  );
  assert.equal(service.getActiveAudit().mission.repairPreparation, null);
  assert.deepEqual(service.getDiagnosticMissions(AUDIT_ID), []);
  assert.deepEqual(service.getRepairs(AUDIT_ID), []);

  returnedFindingId = requestedFindingId;
  await service.prepareRepair(AUDIT_ID, requestedFindingId, "human");
  await service.openDiagnosticMission(AUDIT_ID, requestedFindingId);
  await service.stageRepair(AUDIT_ID, { findingId: requestedFindingId, source: "agent" });
  assert.equal(service.getActiveAudit().mission.repairPreparation.findingId, requestedFindingId);
  assert.equal(service.getActiveAudit().mission.repairPreparation.requestedBy, "agent");
  assert.equal(service.getDiagnosticMissions(AUDIT_ID)[0].findingId, requestedFindingId);
  assert.equal(service.getRepairs(AUDIT_ID)[0].findingId, requestedFindingId);

  await service.prepareRepair(AUDIT_ID, requestedFindingId, "human");
  assert.equal(service.getActiveAudit().mission.repairPreparation.requestedBy, "agent");
});

test("binds browser-review and policy acknowledgements to the exact requested action", async () => {
  const reviewId = "review-1";
  let returnedFocusAreas = ["seo"];
  let returnedCheckId = "responsive-reflow";
  let returnedPolicyMode = "review";
  const service = createAuditService({
    transport: {
      openBrowserReview: async () => ({
        id: reviewId,
        auditId: AUDIT_ID,
        requestedFocusAreas: returnedFocusAreas,
        results: [],
        missionCheckpoint: missionCheckpoint(),
      }),
      recordBrowserReviewCheck: async () => ({
        id: reviewId,
        auditId: AUDIT_ID,
        requestedFocusAreas: ["accessibility"],
        results: [{ checkId: returnedCheckId, outcome: "passed" }],
        missionCheckpoint: missionCheckpoint(),
      }),
      setRepairPolicy: async () => ({
        version: 1,
        mode: returnedPolicyMode,
        remainingAutoApprovals: returnedPolicyMode === "auto-low-risk" ? 3 : 0,
        deploymentAttestation: "person-only",
        missionCheckpoint: missionCheckpoint(),
      }),
    },
  });

  await assert.rejects(
    () => service.openBrowserReview(AUDIT_ID, {
      source: "person",
      focusAreas: ["accessibility"],
    }),
    (error) => error.code === "AUDIT_RESPONSE_MISMATCH",
  );
  assert.equal(service.getBrowserReview(AUDIT_ID), null);

  returnedFocusAreas = ["accessibility"];
  await service.openBrowserReview(AUDIT_ID, {
    source: "person",
    focusAreas: ["accessibility"],
  });
  await assert.rejects(
    () => service.recordBrowserReviewCheck(AUDIT_ID, reviewId, {
      checkId: "rendered-structure",
      outcome: "passed",
      summary: "Checked the retained structure.",
      observations: ["The page has one primary heading."],
    }),
    (error) => error.code === "AUDIT_RESPONSE_MISMATCH",
  );
  assert.deepEqual(service.getBrowserReview(AUDIT_ID).results, []);

  returnedCheckId = "rendered-structure";
  await service.recordBrowserReviewCheck(AUDIT_ID, reviewId, {
    checkId: "rendered-structure",
    outcome: "passed",
    summary: "Checked the retained structure.",
    observations: ["The page has one primary heading."],
  });
  assert.equal(service.getBrowserReview(AUDIT_ID).results[0].checkId, "rendered-structure");

  await assert.rejects(
    () => service.setRepairPolicy(AUDIT_ID, "auto-low-risk"),
    (error) => error.code === "AUDIT_RESPONSE_MISMATCH",
  );
  assert.equal(service.getRepairPolicy(AUDIT_ID).mode, "review");
  returnedPolicyMode = "auto-low-risk";
  await service.setRepairPolicy(AUDIT_ID, "auto-low-risk");
  assert.equal(service.getRepairPolicy(AUDIT_ID).mode, "auto-low-risk");
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
    mission: {
      intent: "assess",
      focusAreas: ["accessibility", "seo"],
      maxPriorities: 2,
      scope: "page",
      routeLimit: 3,
    },
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    url: "https://example.com/",
    source: "agent",
    mission: {
      intent: "assess",
      focusAreas: ["accessibility", "seo"],
      maxPriorities: 2,
      scope: "page",
      routeLimit: 3,
    },
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
      schemaVersion: 2,
      intent: "assess",
      focusAreas: ["accessibility", "seo", "performance"],
      maxPriorities: 5,
      scope: "page",
      routeLimit: 3,
      requestedBy: "human",
      requestedAt: 25,
      repairPreparation: null,
    },
  }]);
  assert.deepEqual(started.mission, calls[0].mission);
});

test("retains mission goals through partial polling and fresh restoration", async () => {
  const report = {
    auditId: AUDIT_ID,
    schemaVersion: 2,
    findings: [],
    viewports: [],
    missionCheckpoint: missionCheckpoint(),
  };
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
    requestedFocusAreas: ["accessibility", "seo"],
    state: { status: "in-progress", nextCheck: { id: "rendered-structure" } },
  };
  const completed = {
    ...opened,
    results: [{ checkId: "rendered-structure", outcome: "passed" }],
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
      getBrowserReview: async () => ({
        auditId: AUDIT_ID,
        review: opened,
        missionCheckpoint: missionCheckpoint(5),
      }),
      openBrowserReview: async (auditId, input, revision) => {
        openCalls.push({ auditId, input, revision });
        return { ...opened, missionCheckpoint: missionCheckpoint(5) };
      },
      recordBrowserReviewCheck: async (auditId, reviewId, input, source) => {
        calls.push({ auditId, reviewId, input, source });
        return { ...completed, missionCheckpoint: missionCheckpoint(6) };
      },
      withdrawBrowserReview: async (auditId, reviewId, revision) => {
        withdrawalCalls.push({ auditId, reviewId, revision });
        return {
          ...opened,
          state: { status: "withdrawn" },
          missionCheckpoint: { auditId: AUDIT_ID, missionRevision: 7 },
        };
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

test("refreshes authoritative results after a rendered route contribution", async () => {
  const url = "https://example.com/";
  const mission = {
    schemaVersion: 2,
    intent: "assess",
    focusAreas: ["seo"],
    maxPriorities: 3,
    scope: "bounded-site",
    routeLimit: 3,
    requestedBy: "agent",
    requestedAt: 10,
    repairPreparation: null,
  };
  let resultReads = 0;
  const service = createAuditService({
    transport: {
      start: async () => ({
        id: AUDIT_ID,
        url,
        source: "agent",
        mission,
        missionRevision: 5,
        status: "complete",
        progress: 100,
        report: {
          auditId: AUDIT_ID,
          url,
          finalUrl: url,
          engine: { mode: "live-document", provider: "Frontmend document audit" },
          findings: [],
          viewports: [],
          documentProfile: { routes: [] },
        },
      }),
      recordBrowserReviewCheck: async () => ({
        id: "browser-review-1",
        auditId: AUDIT_ID,
        purpose: "assessment",
        requestedChecks: [{ id: "search-discovery" }],
        results: [{ checkId: "search-discovery", outcome: "passed", observedRoutes: ["/projects"] }],
        state: { status: "complete", nextCheck: null },
        missionCheckpoint: missionCheckpoint(6),
      }),
      results: async () => {
        resultReads += 1;
        return {
          auditId: AUDIT_ID,
          url,
          finalUrl: url,
          engine: { mode: "live-document", provider: "Frontmend document audit" },
          findings: [],
          viewports: [],
          documentProfile: { routes: [] },
          renderedRouteObservations: [{
            path: "/projects",
            source: "agent-reported-browser-route",
            method: "HEAD",
            validatedAt: 500,
          }],
          missionCheckpoint: missionCheckpoint(6),
        };
      },
    },
  });
  await service.startAudit({
    url,
    source: "agent",
    mission: { intent: "assess", focusAreas: ["seo"], scope: "bounded-site", routeLimit: 3 },
  });
  await service.recordBrowserReviewCheck(AUDIT_ID, "browser-review-1", {
    checkId: "search-discovery",
    outcome: "passed",
    summary: "Rendered navigation exposes the projects route.",
    observations: ["A named same-site Projects link is rendered."],
    observedRoutes: ["/projects"],
  }, "agent", 5);

  assert.equal(resultReads, 1);
  assert.equal(service.getActiveAudit().report.renderedRouteObservations[0].path, "/projects");
  assert.equal(service.getActiveAuditMissionState().siteScope.status, "not-started");
  assert.equal(service.getActiveAuditMissionState().nextAction.tool, "start_site_exploration");
});

test("clears a cached browser review when the authoritative direct read returns none", async () => {
  let retained = true;
  const review = {
    id: "browser-review-1",
    auditId: AUDIT_ID,
    state: { status: "in-progress" },
  };
  const service = createAuditService({
    transport: {
      getBrowserReview: async () => ({
        auditId: AUDIT_ID,
        review: retained ? review : null,
        missionCheckpoint: missionCheckpoint(),
      }),
    },
  });

  await service.loadBrowserReview(AUDIT_ID);
  assert.equal(service.getBrowserReview(AUDIT_ID).id, review.id);
  retained = false;
  await service.loadBrowserReview(AUDIT_ID);
  assert.equal(service.getBrowserReview(AUDIT_ID), null);
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
    results: [{ checkId: "fresh-browser-replay", outcome: "passed" }],
    state: { status: "complete", complete: true, nextCheck: null },
    missionCheckpoint: missionCheckpoint(2),
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
        return { ...completedReport, missionCheckpoint: missionCheckpoint(2) };
      },
    },
  });
  await service.startAudit({ url: "example.com" });
  const publications = [];
  const unsubscribe = service.subscribe(() => publications.push({
    revision: service.getMissionCheckpoint(AUDIT_ID)?.missionRevision,
    reviewStatus: service.getBrowserReview(AUDIT_ID)?.state?.status ?? null,
    verificationStatus: service.getActiveAudit()?.report?.verification?.status ?? null,
  }));
  await service.recordBrowserReviewCheck(AUDIT_ID, review.id, {
    checkId: "fresh-browser-replay",
    outcome: "passed",
    summary: "The exact issue is no longer visible.",
    observations: ["The retained control is fully visible."],
  });
  assert.equal(resultReads, 1);
  assert.equal(service.getActiveAudit().report.verification.status, "resolved");
  assert.equal(service.getBrowserReview(AUDIT_ID).purpose, "verification");
  assert.deepEqual(publications, [{
    revision: 2,
    reviewStatus: "complete",
    verificationStatus: "resolved",
  }]);
  unsubscribe();
});

test("does not publish a verification replay whose review and result cross revisions", async () => {
  const waitingReport = {
    auditId: AUDIT_ID,
    verification: {
      status: "inconclusive",
      browserReplay: { required: true, status: "not-opened" },
    },
  };
  const review = {
    id: "verification-review-1",
    auditId: AUDIT_ID,
    purpose: "verification",
    results: [{ checkId: "fresh-browser-replay", outcome: "passed" }],
    state: { status: "complete", complete: true, nextCheck: null },
    missionCheckpoint: missionCheckpoint(2),
  };
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
        missionRevision: 1,
        missionCheckpoint: missionCheckpoint(1),
      }),
      recordBrowserReviewCheck: async () => review,
      results: async () => ({
        ...waitingReport,
        missionCheckpoint: missionCheckpoint(3),
      }),
    },
  });

  await service.startAudit({ url: "example.com" });
  let publications = 0;
  const unsubscribe = service.subscribe(() => {
    publications += 1;
  });
  await assert.rejects(
    () => service.recordBrowserReviewCheck(AUDIT_ID, review.id, {
      checkId: "fresh-browser-replay",
      outcome: "passed",
      summary: "The exact issue is no longer visible.",
      observations: ["The retained control is fully visible."],
    }),
    (error) => error.code === "MISSION_REFRESH_UNSTABLE"
      && error.details?.missionCheckpoint?.missionRevision === 3,
  );

  assert.equal(publications, 0);
  assert.equal(service.getMissionCheckpoint(AUDIT_ID).missionRevision, 1);
  assert.equal(service.getActiveAudit().report.verification.status, "inconclusive");
  assert.equal(service.getBrowserReview(AUDIT_ID), null);
  unsubscribe();
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
    checkId: "search-discovery",
    outcome: "passed",
    summary: "Rendered routes checked.",
    observations: ["Named Projects and Services links are rendered."],
    observedRoutes: ["/projects", "/services"],
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
  assert.deepEqual(JSON.parse(calls[2].init.body).observedRoutes, ["/projects", "/services"]);
  assert.equal(calls[3].url, `https://frontmend.test/api/audits/${AUDIT_ID}/browser-review/browser-review-1/withdrawal`);
  assert.deepEqual(JSON.parse(calls[3].init.body), {
    source: "person",
    expectedMissionRevision: 8,
  });
});

test("HTTP transport uses revision-bound candidate review routes without a browser side effect", async () => {
  const calls = [];
  const repairId = "3e8fe191-1f46-4f1b-92ac-492a5d73bb24";
  const reviewId = "candidate-review-1";
  const transport = createHttpAuditTransport({
    baseUrl: "https://frontmend.test",
    fetchImpl: async (url, init = {}) => {
      calls.push({ url, init });
      return Response.json({ ok: true, data: { auditId: AUDIT_ID, id: repairId } });
    },
  });

  await transport.getCandidateReview(AUDIT_ID, repairId);
  await transport.openCandidateReview(AUDIT_ID, repairId, "http://localhost:5173", "agent", 7);
  await transport.recordCandidateReviewCheck(AUDIT_ID, repairId, reviewId, {
    checkId: "candidate-replay-1",
    outcome: "passed",
    summary: "The retained symptom is absent.",
    observations: ["The control meets the retained acceptance criteria."],
  }, "person", 8);

  const candidateUrl = `https://frontmend.test/api/audits/${AUDIT_ID}/repairs/${repairId}/candidate-review`;
  assert.equal(calls[0].url, candidateUrl);
  assert.equal(calls[0].init.method, undefined);
  assert.equal(calls[1].url, candidateUrl);
  assert.equal(calls[1].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    candidateOrigin: "http://localhost:5173",
    source: "agent",
    expectedMissionRevision: 7,
  });
  assert.equal(calls[2].url, `${candidateUrl}/checks`);
  assert.deepEqual(JSON.parse(calls[2].init.body), {
    checkId: "candidate-replay-1",
    outcome: "passed",
    summary: "The retained symptom is absent.",
    observations: ["The control meets the retained acceptance criteria."],
    reviewId,
    source: "person",
    expectedMissionRevision: 8,
  });
});

test("shared service persists candidate review reads and sequential mutations in the repair workspace", async () => {
  const repairId = "3e8fe191-1f46-4f1b-92ac-492a5d73bb24";
  const reviewId = "candidate-review-1";
  let missionRevision = 7;
  let repair = {
    id: repairId,
    auditId: AUDIT_ID,
    candidateReview: null,
    candidateReviewHistory: [],
    missionCheckpoint: missionCheckpoint(missionRevision),
  };
  const calls = [];
  const transport = {
    openCandidateReview: async (...args) => {
      calls.push(["open", ...args]);
      missionRevision += 1;
      repair = {
        ...repair,
        candidateReview: { id: reviewId, results: [] },
        missionCheckpoint: missionCheckpoint(missionRevision),
      };
      return repair;
    },
    recordCandidateReviewCheck: async (...args) => {
      calls.push(["record", ...args]);
      missionRevision += 1;
      repair = {
        ...repair,
        candidateReview: {
          ...repair.candidateReview,
          results: [{ checkId: args[3].checkId, outcome: args[3].outcome }],
        },
        missionCheckpoint: missionCheckpoint(missionRevision),
      };
      return repair;
    },
    getCandidateReview: async (...args) => {
      calls.push(["get", ...args]);
      return repair;
    },
  };
  const service = createAuditService({ transport });

  const opened = await service.openCandidateReview(
    AUDIT_ID,
    repairId,
    "http://localhost:5173",
    "agent",
    7,
  );
  assert.equal(opened.missionCheckpoint.missionRevision, 8);
  assert.equal(service.getRepairs(AUDIT_ID)[0].candidateReview.id, reviewId);

  const recorded = await service.recordCandidateReviewCheck(
    AUDIT_ID,
    repairId,
    reviewId,
    {
      checkId: "candidate-replay-1",
      outcome: "issue",
      summary: "The retained symptom remains.",
      observations: ["The candidate still reproduces the retained failure."],
    },
    "agent",
    8,
  );
  assert.equal(recorded.missionCheckpoint.missionRevision, 9);
  assert.equal(service.getRepairs(AUDIT_ID)[0].candidateReview.results[0].outcome, "issue");

  const read = await service.loadCandidateReview(AUDIT_ID, repairId);
  assert.equal(read.candidateReview.id, reviewId);
  assert.deepEqual(calls.map((call) => call[0]), ["open", "record", "get"]);
  assert.equal(calls[0].at(-1), 7);
  assert.equal(calls[1].at(-1), 8);
});

test("HTTP transport reads and appends the audit-scoped activity ledger", async () => {
  const calls = [];
  const activity = {
    id: "activity-1",
    tool: "get_mission_summary",
    title: "Read mission summary",
    status: "succeeded",
    actorClass: "webmcp-agent",
    auditId: AUDIT_ID,
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
  const transport = createHttpAuditTransport({
    baseUrl: "https://frontmend.test",
    fetchImpl: async (url, init = {}) => {
      calls.push({ url, init });
      return Response.json({ ok: true, data: { auditId: AUDIT_ID, activities: [activity] } });
    },
  });

  await transport.listActivities(AUDIT_ID);
  await transport.recordActivity(AUDIT_ID, activity);

  const expectedUrl = `https://frontmend.test/api/audits/${AUDIT_ID}/activities`;
  assert.equal(calls[0].url, expectedUrl);
  assert.equal(calls[0].init.method, undefined);
  assert.equal(calls[1].url, expectedUrl);
  assert.equal(calls[1].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[1].init.body), activity);
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

test("accepts verification candidates only for the requested audit and finding", async () => {
  let scope = {
    auditId: AUDIT_ID,
    findingId: "color-contrast",
    selectedTargetIds: [],
    candidates: [],
    limit: 3,
    rule: { provider: "Lighthouse", auditId: "color-contrast" },
    missionCheckpoint: missionCheckpoint(),
  };
  const service = createAuditService({
    transport: {
      verificationCandidates: async () => scope,
    },
  });

  assert.equal(
    (await service.getVerificationCandidates(AUDIT_ID, "color-contrast")).findingId,
    "color-contrast",
  );
  scope = { ...scope, auditId: "95b52d88-0ed2-49df-a740-0f548065dadd" };
  await assert.rejects(
    () => service.getVerificationCandidates(AUDIT_ID, "color-contrast"),
    (error) => error.code === "AUDIT_RESPONSE_MISMATCH",
  );
  scope = { ...scope, auditId: AUDIT_ID, findingId: "document-title" };
  await assert.rejects(
    () => service.getVerificationCandidates(AUDIT_ID, "color-contrast"),
    (error) => error.code === "AUDIT_RESPONSE_MISMATCH",
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
          missionCheckpoint: missionCheckpoint(2),
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

test("HTTP transport carries an exact repair package through preparation, candidates, and staging", async () => {
  const calls = [];
  const findingIds = ["mobile-errors-in-console", "mobile-color-contrast"];
  const transport = createHttpAuditTransport({
    baseUrl: "https://frontmend.test",
    fetchImpl: async (url, init = {}) => {
      calls.push({ url, init });
      return Response.json({ ok: true, data: {} });
    },
  });
  await transport.prepareRepair(AUDIT_ID, findingIds[0], "agent", 7, findingIds);
  await transport.verificationCandidates(AUDIT_ID, findingIds[0], findingIds);
  await transport.stageRepair(AUDIT_ID, {
    findingId: findingIds[0],
    findingIds,
    source: "agent",
  }, 8);
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    findingId: findingIds[0],
    findingIds,
    source: "agent",
    expectedMissionRevision: 7,
  });
  assert.equal(
    calls[1].url,
    `https://frontmend.test/api/audits/${AUDIT_ID}/verification-candidates?findingId=mobile-errors-in-console&findingIds=mobile-errors-in-console&findingIds=mobile-color-contrast`,
  );
  assert.deepEqual(JSON.parse(calls[2].init.body), {
    findingId: findingIds[0],
    findingIds,
    source: "agent",
    expectedMissionRevision: 8,
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

test("reset prevents a late direct-read checkpoint from advancing a replacement workspace", async () => {
  let startCount = 0;
  let resolveCandidates;
  const service = createAuditService({
    transport: {
      start: async ({ url, source, mission }) => {
        startCount += 1;
        const revision = startCount === 1 ? 2 : 10;
        return {
          id: AUDIT_ID,
          url,
          source,
          mission,
          status: "complete",
          progress: 100,
          report: { auditId: AUDIT_ID, findings: [{ id: "color-contrast" }] },
          missionRevision: revision,
          missionCheckpoint: missionCheckpoint(revision),
        };
      },
      verificationCandidates: () => new Promise((resolve) => {
        resolveCandidates = resolve;
      }),
    },
  });

  await service.startAudit({ url: "https://example.com/" });
  const pending = service.getVerificationCandidates(AUDIT_ID, "color-contrast");
  service.reset();
  await service.startAudit({ url: "https://example.com/" });
  resolveCandidates({
    auditId: AUDIT_ID,
    findingId: "color-contrast",
    candidates: [],
    missionCheckpoint: missionCheckpoint(11),
  });

  await pending;
  assert.equal(service.getMissionCheckpoint(AUDIT_ID).missionRevision, 10);
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
          missionCheckpoint: missionCheckpoint(2),
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
      auditId: AUDIT_ID,
      repairs: [{ id: "repair-1", auditId: AUDIT_ID, status: "draft" }],
      policy: { version: 1, mode: "auto-low-risk", remainingAutoApprovals: 2 },
    }),
    listDiagnosticMissions: async () => ({
      auditId: AUDIT_ID,
      missions: [{ id: "diagnostic-1", auditId: AUDIT_ID, state: { state: "awaiting-diagnosis" } }],
    }),
    getBrowserReview: async () => {
      if (browserReadFails) throw new AuditError("BROWSER_REVIEW_UNAVAILABLE", "Review unavailable.");
      return { auditId: AUDIT_ID, review: initialReview, missionCheckpoint: missionCheckpoint(2) };
    },
    listExplorations: async () => ({
      rootAuditId: AUDIT_ID,
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

test("keeps the previously coherent mission snapshot when a complete-only refresh is partial", async () => {
  let missionRevision = 4;
  let repairStatus = "draft";
  let browserReadFails = false;
  const retainedReview = {
    id: "355df6bb-06e7-432e-870a-ad9db11dfd72",
    auditId: AUDIT_ID,
    state: { status: "active" },
  };
  const transport = {
    start: async ({ url, mission }) => ({
      id: AUDIT_ID,
      url,
      status: "complete",
      mission,
      missionRevision,
      report: { auditId: AUDIT_ID, findings: [] },
    }),
    checkpoint: async () => ({ auditId: AUDIT_ID, missionRevision }),
    get: async () => ({
      id: AUDIT_ID,
      url: "https://removemyexif.com/",
      status: "complete",
      missionRevision,
      report: { auditId: AUDIT_ID, findings: [] },
    }),
    listRepairs: async () => ({
      auditId: AUDIT_ID,
      repairs: [{ id: "repair-1", auditId: AUDIT_ID, status: repairStatus }],
      policy: { version: 1, mode: "review" },
    }),
    listDiagnosticMissions: async () => ({
      auditId: AUDIT_ID,
      missions: [{ id: "diagnostic-1", auditId: AUDIT_ID, revision: missionRevision }],
    }),
    getBrowserReview: async () => {
      if (browserReadFails) throw new AuditError("BROWSER_REVIEW_UNAVAILABLE", "Review unavailable.");
      return { auditId: AUDIT_ID, review: retainedReview };
    },
    listExplorations: async () => ({ rootAuditId: AUDIT_ID, explorations: [] }),
  };
  const service = createAuditService({ transport });
  await service.startAudit({ url: "removemyexif.com" });
  const initial = await service.refreshMissionWorkspace(AUDIT_ID, { publishOnlyWhenComplete: true });
  assert.equal(initial.published, true);
  assert.equal(service.getRepairs(AUDIT_ID)[0].status, "draft");
  assert.equal(service.getDiagnosticMissions(AUDIT_ID)[0].revision, 4);

  missionRevision = 5;
  repairStatus = "approved";
  browserReadFails = true;
  const partial = await service.refreshMissionWorkspace(AUDIT_ID, { publishOnlyWhenComplete: true });

  assert.equal(partial.published, false);
  assert.deepEqual(partial.unavailable, ["browserReview"]);
  assert.equal(partial.missionCheckpoint.missionRevision, 5);
  assert.equal(service.getActiveAudit().missionRevision, 4);
  assert.equal(service.getRepairs(AUDIT_ID)[0].status, "draft");
  assert.equal(service.getDiagnosticMissions(AUDIT_ID)[0].revision, 4);
  assert.equal(service.getBrowserReview(AUDIT_ID).id, retainedReview.id);
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
    listRepairs: async () => ({ auditId: AUDIT_ID, repairs: [], policy: { version: 1, mode: "review" } }),
    listDiagnosticMissions: async () => ({ auditId: AUDIT_ID, missions: [] }),
    getBrowserReview: async () => ({ auditId: AUDIT_ID, review: null }),
    listExplorations: async () => ({ rootAuditId: AUDIT_ID, explorations: [] }),
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
      start: async ({ url, source, mission }) => ({
        id: AUDIT_ID,
        url,
        source,
        mission,
        missionRevision: 1,
        status: "complete",
        progress: 100,
        report: { auditId: AUDIT_ID, findings: [] },
      }),
      startRelated: async (auditId, path, source) => {
        calls.push({ auditId, path, source });
        return {
          id: "c45d54ea-6884-4c86-b82d-b9048cff697f",
          url: "https://removemyexif.com/privacy",
          source,
          status: "queued",
          phase: "queued",
          progress: 4,
          exploration: {
            rootAuditId: auditId,
            parentAuditId: auditId,
            observedPath: path,
            depth: 1,
            trail: [{ auditId, path: "/" }],
          },
          missionCheckpoint: { auditId, missionRevision: 2 },
        };
      },
    },
  });

  await service.startAudit({ url: "https://removemyexif.com/" });

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
  assert.equal(related.missionCheckpoint.auditId, AUDIT_ID);
  assert.equal(service.getMissionCheckpoint(AUDIT_ID).missionRevision, 2);
  assert.equal(service.getActiveAudit().id, related.id);
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
        missionCheckpoint: missionCheckpoint(),
      }),
      listExplorations: async () => ({
        rootAuditId: AUDIT_ID,
        explorations: [{ ...mission, createdAt: 10 }],
        missionCheckpoint: missionCheckpoint(),
      }),
      getExploration: async () => ({
        ...mission,
        status: "complete",
        progress: 100,
        missionCheckpoint: missionCheckpoint(),
      }),
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

test("rejects mismatched exploration start, collection, and detail payloads before caching them", async () => {
  const foreignAuditId = "95b52d88-0ed2-49df-a740-0f548065dadd";
  const missionId = "232d593c-6c81-48c3-b137-a3df269454ff";
  let startRootAuditId = foreignAuditId;
  let listRootAuditId = foreignAuditId;
  let detailRootAuditId = foreignAuditId;
  let detailMissionId = missionId;
  const service = createAuditService({
    transport: {
      startExploration: async () => ({
        id: missionId,
        rootAuditId: startRootAuditId,
        status: "running",
        progress: 10,
        missionCheckpoint: missionCheckpoint(),
      }),
      listExplorations: async () => ({
        rootAuditId: listRootAuditId,
        explorations: [{
          id: missionId,
          rootAuditId: listRootAuditId,
          status: "running",
          progress: 20,
        }],
      }),
      getExploration: async () => ({
        id: detailMissionId,
        rootAuditId: detailRootAuditId,
        status: "complete",
        progress: 100,
      }),
    },
  });

  await assert.rejects(
    () => service.startSiteExploration(AUDIT_ID, ["/privacy"]),
    (error) => error.code === "AUDIT_RESPONSE_MISMATCH",
  );
  assert.deepEqual(service.getSiteExplorations(AUDIT_ID), []);
  assert.deepEqual(service.getSiteExplorations(foreignAuditId), []);

  startRootAuditId = AUDIT_ID;
  await service.startSiteExploration(AUDIT_ID, ["/privacy"]);
  assert.equal(service.getSiteExplorations(AUDIT_ID)[0].progress, 10);

  await assert.rejects(
    () => service.listSiteExplorations(AUDIT_ID),
    (error) => error.code === "AUDIT_RESPONSE_MISMATCH",
  );
  assert.equal(service.getSiteExplorations(AUDIT_ID)[0].progress, 10);

  await assert.rejects(
    () => service.getSiteExploration(AUDIT_ID, missionId),
    (error) => error.code === "AUDIT_RESPONSE_MISMATCH",
  );
  assert.equal(service.getSiteExplorations(AUDIT_ID)[0].progress, 10);

  detailRootAuditId = AUDIT_ID;
  detailMissionId = "4f499d30-f1f1-4b7c-8eb2-acdebb07e457";
  await assert.rejects(
    () => service.getSiteExploration(AUDIT_ID, missionId),
    (error) => error.code === "AUDIT_RESPONSE_MISMATCH",
  );
  assert.equal(service.getSiteExplorations(AUDIT_ID)[0].id, missionId);
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
    missionCheckpoint: missionCheckpoint(),
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

test("keeps a bounded metadata-only browser-agent activity ledger", async () => {
  let timestamp = 100;
  const service = createAuditService({ now: () => timestamp++ });
  const firstId = service.beginAgentActivity({
    tool: "start_site_audit",
    title: "Start site audit",
    url: "https://should-not-be-recorded.test/",
  });
  assert.equal(service.getAgentActivities()[0].status, "running");
  await service.finishAgentActivity(firstId, {
    status: "succeeded",
    auditId: AUDIT_ID,
    rawInput: "must not persist",
  });
  const first = service.getAgentActivities(AUDIT_ID)[0];
  assert.equal(first.status, "succeeded");
  assert.equal(first.auditId, AUDIT_ID);
  assert.equal("url" in first, false);
  assert.equal("rawInput" in first, false);

  for (let index = 0; index < 24; index += 1) {
    const id = service.beginAgentActivity({
      tool: index % 2 ? "get_mission_summary" : "get_evidence_chain",
      title: `Tool ${index}`,
    });
    await service.finishAgentActivity(id, { status: index === 23 ? "failed" : "succeeded" });
  }
  assert.equal(service.getAgentActivities().length, 20);
  assert.equal(service.getAgentActivities()[0].status, "failed");
});

test("persists and restores audit-scoped activity without making telemetry authoritative", async () => {
  const retained = [];
  const transport = {
    async start(input) {
      return { id: AUDIT_ID, url: input.url, source: input.source, status: "running", missionRevision: 3 };
    },
    async get() {
      return { id: AUDIT_ID, url: "https://example.com/", source: "agent", status: "running", missionRevision: 3 };
    },
    async recordActivity(auditId, activity) {
      retained.splice(0, retained.length, activity);
      return { auditId, activities: retained };
    },
    async listActivities(auditId) {
      return { auditId, activities: retained };
    },
  };
  const first = createAuditService({ transport, now: (() => { let value = 100; return () => value++; })() });
  await first.startAudit({ url: "example.com", source: "agent" });
  const activityId = first.beginAgentActivity({
    tool: "get_mission_summary",
    title: "Read mission summary",
    auditId: AUDIT_ID,
    missionRevisionBefore: 3,
  });
  await first.finishAgentActivity(activityId, {
    status: "succeeded",
    auditId: AUDIT_ID,
    missionRevisionAfter: 3,
  });
  assert.equal(retained.length, 1);

  const restored = createAuditService({ transport });
  await restored.restoreAuditWorkspace(AUDIT_ID);
  assert.equal(restored.getAgentActivities(AUDIT_ID)[0].id, activityId);
  assert.equal(restored.getMissionCheckpoint(AUDIT_ID).missionRevision, 3);

  const unavailable = createAuditService({
    transport: { ...transport, listActivities: async () => { throw new Error("telemetry unavailable"); } },
  });
  const { audit } = await unavailable.restoreAuditWorkspace(AUDIT_ID);
  assert.equal(audit.id, AUDIT_ID);
  assert.deepEqual(unavailable.getAgentActivities(AUDIT_ID), []);
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
    baselineAuditId: AUDIT_ID,
    repairId,
    verificationAuditIds: ["c45d54ea-6884-4c86-b82d-b9048cff697f"],
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
      listRepairs: async () => ({
        auditId: AUDIT_ID,
        repairs: [draft],
        policy: reviewPolicy,
        missionCheckpoint: missionCheckpoint(),
      }),
      getRepairPolicy: async () => reviewPolicy,
      setRepairPolicy: async (_auditId, mode) => ({
        ...(mode === "auto-low-risk" ? autoPolicy : reviewPolicy),
        missionCheckpoint: missionCheckpoint(),
      }),
      stageRepair: async () => ({ ...draft, missionCheckpoint: missionCheckpoint() }),
      requestRepairChanges: async (_auditId, _repairId, feedback) => ({
        ...draft,
        status: "changes-requested",
        revision: 1,
        changeRequest: { feedback, requestedAt: 5 },
        missionCheckpoint: missionCheckpoint(),
      }),
      reviseRepair: async (_auditId, _repairId, input) => ({
        ...draft,
        ...input,
        status: "draft",
        revision: 2,
        changeRequest: null,
        missionCheckpoint: missionCheckpoint(),
      }),
      approveRepair: async () => ({
        ...draft,
        status: "approved",
        reviewedAt: 10,
        missionCheckpoint: missionCheckpoint(),
      }),
      recordImplementation: async (_auditId, _repairId, input) => ({
        ...draft,
        status: "approved",
        reviewedAt: 10,
        implementationReceipt: { ...input, source: "agent", reportedAt: 15 },
        missionCheckpoint: missionCheckpoint(),
      }),
      attestDeployment: async () => ({
        ...draft,
        status: "approved",
        reviewedAt: 10,
        deploymentAttestedAt: 20,
        missionCheckpoint: missionCheckpoint(),
      }),
      startVerification: async () => ({ ...verification, missionCheckpoint: missionCheckpoint() }),
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
