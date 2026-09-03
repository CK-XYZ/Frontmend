import test from "node:test";
import assert from "node:assert/strict";
import {
  MISSION_INSPECTOR_STAGES,
  createMissionInspector,
} from "../src/mission-inspector-contract.js";
import { FRONTMEND_TOOL_COUNT } from "../src/protocol-contract.js";

const completeAudit = {
  id: "audit-1",
  status: "complete",
  report: { auditId: "audit-1", findings: [] },
};

function inspector(overrides = {}) {
  return createMissionInspector({
    audit: completeAudit,
    contextualToolNames: ["get_site_audit_results"],
    toolDetails: [{
      name: "get_site_audit_results",
      title: "Get site audit results",
      description: "Read the current bounded assessment.",
      inputSchema: {
        type: "object",
        properties: { auditId: { type: "string" } },
        additionalProperties: false,
      },
    }],
    webMcp: { supported: true, status: "ready", totalTools: FRONTMEND_TOOL_COUNT },
    ...overrides,
  });
}

test("answers all five mission questions for landing and complete Human mode", () => {
  const value = inspector({
    audit: null,
    contextualToolNames: [],
    webMcp: { supported: false, status: "unsupported", totalTools: FRONTMEND_TOOL_COUNT },
  });
  assert.equal(value.stage, "landing");
  assert.equal(value.mode, "human");
  assert.match(value.questions.whatHappensNow.title, /public website/i);
  assert.match(value.questions.whyNow, /no audit is running/i);
  assert.equal(value.questions.whatMustReturn.length, 2);
  assert.equal(value.questions.whatItUnlocks.length, 1);
  assert.equal(value.questions.whatRemainsHumanOnly.length, 3);
  assert.equal(value.humanFallback.complete, true);
  assert.match(value.humanFallback.message, /every Frontmend workflow/i);
  assert.equal(value.protocol.protocolVersion, 1);
  assert.equal(value.protocol.toolCount, FRONTMEND_TOOL_COUNT);
  assert.equal(value.protocol.displayCommit, "unidentified build");
});

test("uses concise human-facing descriptions for the active agent actions", () => {
  const value = inspector({
    contextualToolNames: ["get_mission_summary"],
    toolDetails: [{
      name: "get_mission_summary",
      title: "Get mission summary",
      description: "Return the small stable Frontmend control-plane view with retained intent and protocol revisions.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    }],
  });

  assert.equal(
    value.activeTools[0].description,
    "Reads the audit state, top priorities, blockers, and next available action.",
  );
  assert.doesNotMatch(value.activeTools[0].description, /control-plane|protocol/i);
});

test("projects the measurement state from the authoritative audit job", () => {
  const value = inspector({
    audit: { id: "audit-1", status: "running", phaseLabel: "Measuring mobile performance" },
    contextualToolNames: ["check_site_audit_progress", "cancel_site_audit"],
  });
  assert.equal(value.stage, "measurement");
  assert.equal(value.questions.whatHappensNow.action.tool, "check_site_audit_progress");
  assert.match(value.questions.whyNow, /mobile performance/i);
});

test("projects investigation and diagnosis from the exact mission continuation", () => {
  const investigation = inspector({
    browserReview: { id: "review-1", state: { nextCheck: { id: "task-1" } } },
    missionState: {
      browserReview: { required: true, status: "in-progress" },
      nextAction: {
        tool: "record_browser_review_check",
        input: { reviewId: "review-1", checkId: "task-1" },
        reason: "The evidence-led rendered task is still outstanding.",
      },
    },
  });
  assert.equal(investigation.stage, "investigation");
  assert.equal(investigation.questions.whatHappensNow.requiredCapability, "Rendered-browser inspection");
  assert.equal(investigation.questions.whatHappensNow.action.input.checkId, "task-1");

  const diagnosis = inspector({
    missionState: {
      browserReview: { required: true, status: "complete" },
      nextAction: {
        tool: "open_diagnostic_mission",
        input: { findingId: "finding-1" },
        reason: "The provider/browser conflict needs repository diagnosis.",
      },
    },
  });
  assert.equal(diagnosis.stage, "diagnosis");
  assert.equal(diagnosis.questions.whatHappensNow.actor, "Repository-capable agent");
  assert.match(diagnosis.questions.whyNow, /conflict/i);
});

test("projects optional same-audit takeover ahead of a completed human checkpoint", () => {
  const value = inspector({
    missionState: {
      assessmentComplete: true,
      browserReview: {
        required: false,
        status: "not-required",
        adoptionAvailable: true,
      },
      nextAction: null,
    },
    checkpoint: {
      requiredCapability: "Human result review",
      action: { tool: "get_site_audit_results", input: { auditId: "audit-1" } },
      completionCriteria: ["Review the completed priorities"],
    },
    contextualToolNames: ["get_site_audit_results", "open_browser_review"],
  });

  assert.equal(value.stage, "investigation");
  assert.equal(value.questions.whatHappensNow.action.tool, "open_browser_review");
  assert.equal(value.questions.whatHappensNow.actor, "Person or browser-capable agent");
  assert.match(value.questions.whatHappensNow.summary, /without starting another audit/i);
  assert.match(value.questions.whatMustReturn.join(" "), /same audit ID/i);
});

test("projects an untouched withdrawn handoff as provider-only human review", () => {
  const value = inspector({
    browserReview: { id: "review-1", state: { status: "withdrawn" } },
    missionState: {
      assessmentComplete: true,
      browserReview: {
        required: false,
        status: "withdrawn",
        adoptionAvailable: false,
        provenance: "no-browser-evidence",
      },
      nextAction: null,
    },
  });

  assert.equal(value.stage, "human-review");
  assert.equal(value.questions.whatHappensNow.actor, "Person");
  assert.match(value.questions.whatHappensNow.summary, /provider-only again/i);
  assert.match(value.questions.whyNow, /no browser result/i);
});

test("keeps human review, deployment, and replay authority explicit", () => {
  const review = inspector({
    missionState: {
      assessmentComplete: true,
      browserReview: { required: false, status: "not-required" },
      nextAction: null,
    },
  });
  assert.equal(review.stage, "human-review");
  assert.equal(review.questions.whatHappensNow.actor, "Person");

  const deployment = inspector({
    repairs: [{ id: "repair-1", status: "approved", updatedAt: 10 }],
    missionState: { browserReview: { required: false, status: "not-required" } },
  });
  assert.equal(deployment.stage, "deployment");
  assert.equal(deployment.questions.whatHappensNow.actor, "Site owner");
  assert.equal(deployment.questions.whatHappensNow.action, null);

  const replay = inspector({
    repairs: [{ id: "repair-1", status: "approved", deploymentAttestedAt: 20, updatedAt: 20 }],
    missionState: { browserReview: { required: false, status: "not-required" } },
  });
  assert.equal(replay.stage, "replay");
  assert.equal(replay.questions.whatHappensNow.action.tool, "start_repair_verification");
});

test("projects exact browser replay ahead of ordinary mission state", () => {
  const value = inspector({
    audit: {
      ...completeAudit,
      report: {
        ...completeAudit.report,
        verification: { browserReplay: { required: true, status: "in-progress" } },
      },
    },
    browserReview: { id: "replay-1", state: { nextCheck: { id: "fresh-browser-replay" } } },
    missionState: { assessmentComplete: true, browserReview: { required: false, status: "not-required" } },
  });
  assert.equal(value.stage, "replay");
  assert.equal(value.questions.whatHappensNow.action.tool, "record_browser_review_check");
  assert.equal(value.questions.whatHappensNow.action.input.checkId, "fresh-browser-replay");
  assert.match(value.questions.whatMustReturn.join(" "), /honest blocker/i);
});

test("projects browser-only regression guardrails as required verification", () => {
  const value = inspector({
    audit: {
      ...completeAudit,
      report: {
        ...completeAudit.report,
        verification: {
          status: "inconclusive",
          browserGuardrails: [{
            checkId: "responsive-reflow",
            label: "Responsive reflow",
            status: "not-opened",
            focusArea: "accessibility",
            viewport: "mobile",
          }],
        },
      },
    },
    missionState: { assessmentComplete: true, browserReview: { required: false, status: "not-required" } },
  });
  assert.equal(value.stage, "replay");
  assert.equal(value.questions.whatHappensNow.action.tool, "open_browser_review");
  assert.equal(value.questions.whatHappensNow.requiredCapability, "Rendered-browser verification");
  assert.match(value.questions.whatHappensNow.summary, /journeys and reflow behaviours/i);
});

test("uses checkpoint action and criteria while retaining only the registered tool subset", () => {
  const value = inspector({
    checkpoint: {
      requiredCapability: "Fresh-session repository diagnosis",
      action: { tool: "submit_runtime_diagnosis", input: { missionId: "diagnosis-1" } },
      completionCriteria: ["Return repository-relative ownership", "Name fresh checks"],
      authorityBoundary: { humanOnly: ["Approve the repair", "Deploy the change"] },
    },
    contextualToolNames: ["get_site_audit_results"],
  });
  assert.equal(value.questions.whatHappensNow.action.tool, "submit_runtime_diagnosis");
  assert.equal(value.questions.whatHappensNow.requiredCapability, "Fresh-session repository diagnosis");
  assert.deepEqual(value.questions.whatMustReturn, [
    "Return repository-relative ownership",
    "Name fresh checks",
  ]);
  assert.deepEqual(value.questions.whatRemainsHumanOnly, ["Approve the repair", "Deploy the change"]);
  assert.deepEqual(value.activeTools.map((tool) => tool.name), ["get_site_audit_results"]);
  assert.equal(value.activeTools[0].inputSchema.additionalProperties, false);
});

test("exports every supported mission inspector stage", () => {
  assert.deepEqual(MISSION_INSPECTOR_STAGES, [
    "landing",
    "measurement",
    "investigation",
    "diagnosis",
    "human-review",
    "deployment",
    "replay",
    "complete",
  ]);
});
