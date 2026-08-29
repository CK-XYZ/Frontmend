import assert from "node:assert/strict";
import test from "node:test";
import {
  auditMissionSignature,
  createAuditMission,
  deriveAuditMissionState,
  focusedAuditPriorities,
  prepareRepairIntent,
} from "../src/audit-mission-contract.js";
import {
  createDiagnosticMission,
  recordDiagnosticBlocker,
  submitDiagnosticEvidence,
} from "../src/diagnostic-contract.js";

const consoleFinding = (strategy, severity = "medium") => ({
  id: `${strategy}-errors-in-console`,
  title: "The page reports browser errors",
  severity,
  category: "Reliability",
  focusAreas: ["reliability", "performance"],
  evidence: `${strategy} emitted a first-party console error.`,
  repair: "Reproduce and repair the owned runtime failure.",
  source: { provider: "Lighthouse", auditId: "errors-in-console", strategy },
  diagnosticEvidence: {
    kind: "console-errors",
    completeness: "actionable",
    entries: [{ description: "ReferenceError" }],
  },
});

const report = {
  auditId: "audit-1",
  viewports: [
    { strategy: "mobile", scores: { accessibility: 97, performance: 91, reliability: 90 } },
    { strategy: "desktop", scores: { accessibility: 98, performance: 93, reliability: 92 } },
  ],
  findings: [
    consoleFinding("mobile"),
    consoleFinding("desktop"),
    {
      id: "mobile-color-contrast",
      title: "Controls have insufficient contrast",
      severity: "low",
      category: "Accessibility",
      focusAreas: ["accessibility"],
      evidence: "One control failed the automated contrast check.",
      repair: "Correct the foreground and background tokens.",
      source: { provider: "Lighthouse", auditId: "color-contrast", strategy: "mobile" },
    },
  ],
};

test("creates a bounded Assess mission without retaining prompt text", () => {
  assert.deepEqual(createAuditMission({}, "human", 10), {
    schemaVersion: 1,
    intent: "assess",
    focusAreas: [],
    maxPriorities: 3,
    requestedBy: "human",
    requestedAt: 10,
    repairPreparation: null,
  });
  assert.throws(
    () => createAuditMission({ prompt: "Audit my private repository" }, "agent", 10),
    /Unknown mission field: prompt/,
  );
  assert.throws(() => createAuditMission({ focusAreas: ["seo", "seo"] }), /unique supported/);
  assert.throws(() => createAuditMission({ maxPriorities: 6 }), /one to five/);
});

test("uses semantic mission values for stable admission signatures", () => {
  const first = createAuditMission({ focusAreas: ["accessibility", "seo"] }, "agent", 10);
  const reordered = createAuditMission({ focusAreas: ["seo", "accessibility"] }, "agent", 20);
  const narrower = createAuditMission({ focusAreas: ["seo"], maxPriorities: 1 }, "agent", 20);
  assert.equal(auditMissionSignature(first), auditMissionSignature(reordered));
  assert.notEqual(auditMissionSignature(first), auditMissionSignature(narrower));
});

test("deduplicates measured rules, retains strategies, and orders by severity", () => {
  const mission = createAuditMission({ focusAreas: ["reliability", "performance"] }, "agent", 10);
  const projection = focusedAuditPriorities(report, mission, []);
  assert.equal(projection.matchingFindingCount, 2);
  assert.equal(projection.priorities.length, 1);
  assert.equal(projection.priorities[0].occurrenceCount, 2);
  assert.deepEqual(projection.priorities[0].affectedStrategies, ["mobile", "desktop"]);
  assert.equal(projection.priorities[0].evidenceState, "diagnosis-recommended");
  assert.equal(projection.categoryScores.performance, 92);
});

test("keeps assessment incomplete until supported diagnosis is contributed", () => {
  const mission = createAuditMission({ focusAreas: ["reliability"] }, "agent", 10);
  const pending = deriveAuditMissionState({ report, mission });
  assert.equal(pending.auditComplete, true);
  assert.equal(pending.assessmentComplete, false);
  assert.equal(pending.status, "action-available");
  assert.deepEqual(pending.nextAction.input, { findingId: "mobile-errors-in-console" });
  assert.equal(pending.nextAction.tool, "open_diagnostic_mission");

  const diagnostic = createDiagnosticMission({ auditId: "audit-1", finding: report.findings[0], now: 20 });
  const inProgress = deriveAuditMissionState({ report, mission, diagnosticMissions: [diagnostic] });
  assert.equal(inProgress.status, "in-progress");
  assert.equal(inProgress.nextAction.tool, "submit_runtime_diagnosis");
  assert.deepEqual(inProgress.nextAction.input, { missionId: diagnostic.id });

  const diagnosed = submitDiagnosticEvidence(diagnostic, {
    summary: "The route reads a vendor global before its script finishes loading.",
    reproduction: "Open the audited route in a fresh tab and inspect the first console error.",
    observations: [{ kind: "console", detail: "ReferenceError occurs during route startup." }],
    sourceLocations: [{ file: "src/runtime.js", line: 42, reason: "Owns the early global read." }],
    verificationChecks: ["bun test", "bun run build"],
    confidence: "high",
  }, "agent", 30);
  const complete = deriveAuditMissionState({ report, mission, diagnosticMissions: [diagnosed] });
  assert.equal(complete.assessmentComplete, true);
  assert.equal(complete.status, "complete");
  assert.equal(complete.priorities[0].evidenceState, "diagnosis-contributed");
  assert.equal(complete.nextAction, null);
});

test("projects a diagnostic blocker as an incomplete terminal assessment state", () => {
  const mission = createAuditMission({ focusAreas: ["reliability"] }, "agent", 10);
  const diagnostic = createDiagnosticMission({ auditId: "audit-1", finding: report.findings[0], now: 20 });
  const blockedDiagnostic = recordDiagnosticBlocker(diagnostic, {
    reason: "wrong-repository",
    summary: "The available checkout does not produce the deployed asset that emitted the measured error.",
  }, "agent", 30);
  const state = deriveAuditMissionState({
    report,
    mission,
    diagnosticMissions: [blockedDiagnostic],
  });

  assert.equal(state.status, "blocked");
  assert.equal(state.auditComplete, true);
  assert.equal(state.assessmentComplete, false);
  assert.equal(state.nextActor, null);
  assert.equal(state.nextAction, null);
  assert.equal(state.priorities[0].evidenceState, "diagnosis-blocked");
  assert.equal(state.priorities[0].diagnosticBlocker.reason, "wrong-repository");
});

test("completes an honest zero-match assessment without inventing work", () => {
  const mission = createAuditMission({ focusAreas: ["seo"] }, "agent", 10);
  const state = deriveAuditMissionState({ report, mission });
  assert.equal(state.matchingFindingCount, 0);
  assert.equal(state.priorityCount, 0);
  assert.equal(state.assessmentComplete, true);
  assert.equal(state.nextAction, null);
  assert.deepEqual(state.categoryScores, { seo: null });
});

test("freezes explicit repair intent idempotently and rejects replacement", () => {
  const mission = createAuditMission({ intent: "assess", focusAreas: ["accessibility"] }, "agent", 10);
  const prepared = prepareRepairIntent(mission, "mobile-color-contrast", "human", 20);
  assert.equal(mission.intent, "assess");
  assert.equal(mission.repairPreparation, null);
  assert.equal(prepared.intent, "prepare-fix");
  assert.deepEqual(prepared.repairPreparation, {
    findingId: "mobile-color-contrast",
    requestedBy: "human",
    requestedAt: 20,
  });
  assert.deepEqual(prepareRepairIntent(prepared, "mobile-color-contrast", "agent", 30), prepared);
  assert.throws(
    () => prepareRepairIntent(prepared, "mobile-errors-in-console", "agent", 30),
    (error) => error.code === "REPAIR_INTENT_CONFLICT",
  );
});

test("names repair staging only after an explicit selected finding transition", () => {
  const assess = createAuditMission({ focusAreas: ["accessibility"] }, "human", 10);
  const prepared = prepareRepairIntent(assess, "mobile-color-contrast", "human", 20);
  const state = deriveAuditMissionState({ report, mission: prepared });
  assert.equal(state.assessmentComplete, true);
  assert.equal(state.status, "action-available");
  assert.equal(state.authority.mayPrepareRepair, true);
  assert.deepEqual(state.nextAction, {
    tool: "stage_site_repair",
    input: { findingId: "mobile-color-contrast" },
    reason: "Prepare a bounded repair draft for the explicitly selected finding.",
  });
  assert.equal(state.authority.mayDeploy, false);
  assert.equal(state.authority.mayAttestDeployment, false);
});
