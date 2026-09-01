import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceMissionRevision,
  assertExpectedMissionRevision,
  auditMissionRevision,
  createMissionCheckpoint,
} from "../src/mission-checkpoint-contract.js";

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
  assert.equal(checkpoint.action.tool, "open_browser_review");
  assert.match(checkpoint.retainedEvidenceSummary.join(" "), /provider-only/);
  assert.match(checkpoint.authorityBoundary.humanOnly.join(" "), /Deploy/);
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
  });
  assert.equal(checkpoint.missionRevision, 7);
  assert.deepEqual(checkpoint.action.input, { reviewId: "review-1", checkId: "task-1" });
  assert.match(checkpoint.completionCriteria[0], /both viewports/);
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
