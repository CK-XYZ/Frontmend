import assert from "node:assert/strict";
import test from "node:test";
import { createFreshAgentHandoff } from "../src/mission-handoff-contract.js";
import { createMissionCheckpoint } from "../src/mission-checkpoint-contract.js";

const audit = {
  id: "audit-1",
  url: "https://example.com/",
  source: "agent",
  status: "complete",
  progress: 100,
  report: { auditId: "audit-1", findings: [{ id: "finding-1" }] },
};

test("creates a fresh-agent handoff that requires a live checkpoint read", () => {
  const checkpoint = createMissionCheckpoint({
    audit: { ...audit, missionRevision: 7 },
    missionState: {
      status: "action-available",
      nextActor: "agent",
      nextAction: {
        tool: "record_browser_review_check",
        input: { reviewId: "review-secret-to-live-state", checkId: "task-secret-to-live-state" },
        reason: "Complete the retained task.",
      },
      priorityCount: 1,
      assessmentComplete: false,
      priorities: [],
    },
  });
  const handoff = createFreshAgentHandoff(checkpoint, "https://frontmend.example");

  assert.equal(handoff.schemaVersion, 1);
  assert.equal(handoff.kind, "fresh-agent-handoff");
  assert.equal(handoff.workspaceUrl, "https://frontmend.example/audits/audit-1");
  assert.equal(handoff.copiedMissionRevision, 7);
  assert.equal(handoff.requiredCapabilityAtCopy, "browser");
  assert.match(handoff.prompt, /read the latest mission checkpoint/i);
  assert.match(handoff.prompt, /Do not reuse or replay/i);
  assert.match(handoff.prompt, /grants no additional authority/i);
  assert.doesNotMatch(handoff.prompt, /review-secret-to-live-state|task-secret-to-live-state/);
  assert.match(handoff.authorityBoundary.humanOnly.join(" "), /deployment/i);
});

test("rejects an unsafe or incomplete fresh-agent handoff", () => {
  const checkpoint = createMissionCheckpoint({ audit });
  assert.throws(
    () => createFreshAgentHandoff(checkpoint, "file:///tmp/frontmend"),
    (error) => error.code === "INVALID_INPUT" && /HTTP\(S\)/.test(error.message),
  );
  assert.throws(
    () => createFreshAgentHandoff({ auditId: "audit-1", missionRevision: 0 }, "https://frontmend.example"),
    (error) => error.code === "INVALID_INPUT" && /positive revision/.test(error.message),
  );
  assert.throws(
    () => createFreshAgentHandoff({ auditId: { injected: true }, missionRevision: 1 }, "https://frontmend.example"),
    (error) => error.code === "INVALID_INPUT" && /audit ID/.test(error.message),
  );
});

test("bounds copied authority text instead of forwarding an arbitrary checkpoint object", () => {
  const checkpoint = {
    ...createMissionCheckpoint({ audit }),
    authorityBoundary: {
      humanOnly: [
        { injected: true },
        ...Array.from({ length: 8 }, (_, index) => `Person boundary ${index} ${"x".repeat(220)}`),
      ],
      agentMay: `Bounded agent action ${"y".repeat(400)}`,
      claim: `Bounded claim ${"z".repeat(400)}`,
      injected: { source: "must not survive" },
    },
  };
  const handoff = createFreshAgentHandoff(checkpoint, "https://frontmend.example");

  assert.equal(handoff.authorityBoundary.humanOnly.length, 5);
  assert.equal(handoff.authorityBoundary.humanOnly.every((item) => item.length <= 180), true);
  assert.equal(handoff.authorityBoundary.agentMay.length <= 280, true);
  assert.equal(handoff.authorityBoundary.claim.length <= 280, true);
  assert.equal("injected" in handoff.authorityBoundary, false);
});
