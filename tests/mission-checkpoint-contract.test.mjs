import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceMissionRevision,
  assertExpectedMissionRevision,
  auditMissionRevision,
  createMissionCheckpoint,
} from "../src/mission-checkpoint-contract.js";
import { createAgentCapabilityDeclaration } from "../src/agent-capability-contract.js";

const allCapabilities = createAgentCapabilityDeclaration({
  visualBrowserAccess: true,
  responsiveEmulation: true,
  runtimeDiagnostics: true,
  repositoryAccess: true,
  terminalExecution: true,
}, null, 10);

const audit = {
  id: "audit-1",
  url: "https://example.com/",
  source: "agent",
  status: "complete",
  progress: 100,
  report: { auditId: "audit-1", findings: [{ id: "finding-1" }] },
};

test("projects legacy records at mission revision one without rewriting them", () => {
  assert.equal(auditMissionRevision(audit), 1);
  const checkpoint = createMissionCheckpoint({
    audit,
    missionState: {
      status: "action-available",
      nextActor: "agent",
      nextAction: {
        tool: "open_browser_review",
        input: {},
        reason: "Rendered evidence is still required.",
      },
      priorityCount: 1,
      assessmentComplete: false,
      priorities: [{ relationship: "provider-only" }],
    },
  });
  assert.equal(checkpoint.schemaVersion, 1);
  assert.equal(checkpoint.missionRevision, 1);
  assert.equal(checkpoint.measurementComplete, true);
  assert.equal(checkpoint.assessmentStatus, "incomplete");
  assert.equal(checkpoint.assessmentReceiptAvailable, false);
  assert.equal(checkpoint.auditId, "audit-1");
  assert.equal(checkpoint.workspacePath, "/audits/audit-1");
  assert.equal(checkpoint.requiredCapability, "browser");
  assert.equal(checkpoint.action.tool, "declare_agent_capabilities");
  assert.deepEqual(checkpoint.action.input, { auditId: "audit-1", expectedMissionRevision: 1 });
  assert.equal(checkpoint.capabilityNegotiation.status, "declaration-required");
  assert.deepEqual(checkpoint.requiredCapabilities, ["visual-browser-access"]);
  assert.equal(checkpoint.agentCapabilities, null);
  assert.equal(checkpoint.agentRun.mode, "continue");
  assert.equal(checkpoint.agentRun.continueAutomatically, true);
  assert.match(checkpoint.retainedEvidenceSummary.join(" "), /provider-only/);
  assert.match(checkpoint.authorityBoundary.humanOnly.join(" "), /deploy/i);
});

test("projects exact completion criteria for the current browser assignment", () => {
  const checkpoint = createMissionCheckpoint({
    audit: { ...audit, missionRevision: 7 },
    missionState: {
      status: "investigating",
      nextActor: "agent",
      nextAction: {
        tool: "record_browser_review_check",
        input: { reviewId: "review-1", checkId: "task-1" },
        reason: "Complete the current evidence-led assignment.",
      },
      priorityCount: 1,
      assessmentComplete: false,
      priorities: [],
    },
    browserReview: {
      id: "review-1",
      state: {
        requestedCheckCount: 2,
        completedCheckCount: 1,
        nextCheck: {
          id: "task-1",
          assignment: { completionCriteria: "Inspect the retained selector at both viewports." },
        },
      },
    },
    agentCapabilities: allCapabilities,
  });
  assert.equal(checkpoint.missionRevision, 7);
  assert.deepEqual(checkpoint.action.input, {
    reviewId: "review-1",
    checkId: "task-1",
    auditId: "audit-1",
    expectedMissionRevision: 7,
  });
  assert.match(checkpoint.completionCriteria[0], /both viewports/);
  assert.equal(checkpoint.capabilityNegotiation.status, "matched");
});

test("projects the exact candidate task and its dynamic browser capabilities", () => {
  const candidateReview = {
    id: "candidate-review-1",
    state: {
      nextCheck: {
        id: "candidate-replay-1",
        viewport: "mobile",
        target: { viewport: "mobile", affectedViewports: ["mobile"] },
        requiredCapabilities: ["visual-browser-access", "responsive-emulation"],
        assignment: { completionCriteria: "Confirm the retained mobile symptom is no longer observable." },
      },
    },
  };
  const checkpoint = createMissionCheckpoint({
    audit: { ...audit, missionRevision: 8 },
    missionState: {
      status: "in-progress",
      nextActor: "agent",
      nextAction: {
        tool: "record_candidate_review_check",
        input: {
          repairId: "repair-1",
          reviewId: "candidate-review-1",
          checkId: "candidate-replay-1",
        },
        reason: "Complete the current candidate comparison.",
      },
      priorityCount: 1,
      assessmentComplete: true,
      priorities: [],
    },
    repairs: [{ id: "repair-1", candidateReview }],
    agentCapabilities: allCapabilities,
  });

  assert.equal(checkpoint.action.tool, "record_candidate_review_check");
  assert.deepEqual(checkpoint.requiredCapabilities, ["visual-browser-access", "responsive-emulation"]);
  assert.match(checkpoint.completionCriteria[0], /mobile symptom/i);
  assert.match(checkpoint.completionCriteria[1], /returns the mission to repository implementation/i);
  assert.equal(checkpoint.agentRun.mode, "continue");
});

test("hands an unsupported agent task back to the person without overstating verification", () => {
  const limited = createAgentCapabilityDeclaration({
    visualBrowserAccess: false,
    responsiveEmulation: false,
    runtimeDiagnostics: false,
    repositoryAccess: true,
    terminalExecution: false,
  }, null, 20);
  const checkpoint = createMissionCheckpoint({
    audit,
    agentCapabilities: limited,
    missionState: {
      status: "action-available",
      nextActor: "agent",
      nextAction: { tool: "open_browser_review", input: {}, reason: "Rendered evidence is required." },
      priorityCount: 1,
      assessmentComplete: false,
      priorities: [],
    },
  });
  assert.equal(checkpoint.action, null);
  assert.equal(checkpoint.nextActor, "person");
  assert.equal(checkpoint.capabilityNegotiation.status, "human-handoff-required");
  assert.deepEqual(checkpoint.capabilityNegotiation.missingCapabilities, ["visual-browser-access"]);
  assert.equal(checkpoint.agentCapabilities.provenance, "agent-declared");
  assert.equal(checkpoint.agentCapabilities.verificationStatus, "not-verified");
});

test("projects bounded polling and human stop semantics for autonomous agents", () => {
  const waiting = createMissionCheckpoint({
    audit: { ...audit, status: "running", progress: 42, report: null, missionRevision: 3 },
  });
  assert.equal(waiting.action.tool, "check_site_audit_progress");
  assert.deepEqual(waiting.action.input, { auditId: "audit-1" });
  assert.equal(waiting.agentRun.mode, "wait");
  assert.equal(waiting.agentRun.retryAfterMs, 1500);

  const humanRequired = createMissionCheckpoint({
    audit: { ...audit, mission: { schemaVersion: 2, intent: "prepare-fix" } },
    missionState: {
      status: "awaiting-human-review",
      nextActor: "person",
      nextAction: null,
      assessmentComplete: true,
      priorityCount: 1,
      priorities: [],
    },
  });
  assert.equal(humanRequired.agentRun.mode, "human-required");
  assert.equal(humanRequired.agentRun.continueAutomatically, false);
  assert.equal(humanRequired.action, null);
  assert.match(humanRequired.authorityBoundary.agentMay, /only after explicit repair selection/i);
});

test("rejects stale writes with the current bounded checkpoint", () => {
  const current = { ...audit, missionRevision: 4 };
  const checkpoint = createMissionCheckpoint({ current, audit: current });
  assert.throws(
    () => assertExpectedMissionRevision(current, 3, checkpoint),
    (error) => {
      assert.equal(error.code, "MISSION_REVISION_STALE");
      assert.equal(error.recoverable, true);
      assert.deepEqual(error.details, { missionCheckpoint: checkpoint });
      return true;
    },
  );
});

test("advances monotonically from legacy and retained revisions", () => {
  assert.equal(advanceMissionRevision(audit).missionRevision, 2);
  assert.equal(advanceMissionRevision({ ...audit, missionRevision: 9 }).missionRevision, 10);
});
