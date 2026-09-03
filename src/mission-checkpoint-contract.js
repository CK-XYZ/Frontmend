import { AuditError } from "./url-policy.js";
import { deriveAuditMissionState } from "./audit-mission-contract.js";
import {
  agentCapabilityMatch,
  agentCapabilitySnapshot,
  requiredAgentCapabilitiesForAction,
} from "./agent-capability-contract.js";

const CAPABILITY_BY_TOOL = Object.freeze({
  start_site_audit: "public-url",
  check_site_audit_progress: "progress",
  cancel_site_audit: "human-or-agent-cancellation",
  declare_agent_capabilities: "agent-capability-declaration",
  open_browser_review: "browser",
  record_browser_review_check: "browser",
  open_diagnostic_mission: "repository",
  submit_runtime_diagnosis: "repository",
  record_diagnostic_blocker: "repository",
  get_site_audit_results: "read-results",
  get_assessment_receipt: "read-results",
  start_site_exploration: "public-url",
  get_site_exploration: "progress",
  prepare_site_repair: "repair-intent",
  stage_site_repair: "repository",
  revise_site_repair: "repository",
  get_repair_workspace: "read-repair",
  record_repository_implementation: "repository",
  open_candidate_review: "browser",
  record_candidate_review_check: "browser",
  get_candidate_review: "read-repair",
  start_repair_verification: "verification",
  get_verification_receipt: "read-verification",
});

export const REVISION_BOUND_MISSION_TOOLS = Object.freeze([
  "cancel_site_audit",
  "declare_agent_capabilities",
  "open_browser_review",
  "record_browser_review_check",
  "start_related_page_audit",
  "open_diagnostic_mission",
  "submit_runtime_diagnosis",
  "record_diagnostic_blocker",
  "start_site_exploration",
  "prepare_site_repair",
  "stage_site_repair",
  "revise_site_repair",
  "record_repository_implementation",
  "open_candidate_review",
  "record_candidate_review_check",
  "start_repair_verification",
]);

const REVISION_BOUND_MISSION_TOOL_SET = new Set(REVISION_BOUND_MISSION_TOOLS);
const ASYNC_READ_TOOLS = new Set([
  "check_site_audit_progress",
  "get_site_exploration",
  "get_verification_receipt",
]);

function bounded(value, maximum = 400) {
  return String(value ?? "").replace(/\r\n/g, "\n").trim().slice(0, maximum);
}

export function auditMissionRevision(audit) {
  return Number.isInteger(audit?.missionRevision) && audit.missionRevision > 0
    ? audit.missionRevision
    : 1;
}

export function createExecutableMissionAction(nextAction, audit) {
  if (!nextAction?.tool || !audit?.id) return null;
  const tool = bounded(nextAction.tool, 80);
  const input = nextAction.input && typeof nextAction.input === "object" && !Array.isArray(nextAction.input)
    ? JSON.parse(JSON.stringify(nextAction.input))
    : {};
  input.auditId = bounded(audit.id, 160);
  if (REVISION_BOUND_MISSION_TOOL_SET.has(tool)) {
    input.expectedMissionRevision = auditMissionRevision(audit);
  }
  return {
    tool,
    input,
    reason: bounded(nextAction.reason, 500),
  };
}

function agentRunContract({ action, status, nextActor, missionIntent, assessmentComplete }) {
  const mode = status === "blocked"
    ? "blocked"
    : nextActor === "person"
      ? "human-required"
      : action
        ? ASYNC_READ_TOOLS.has(action.tool) ? "wait" : "continue"
        : "complete";
  return {
    schemaVersion: 1,
    mode,
    objective: missionIntent === "prepare-fix"
      ? "Advance the retained frontend mission through assessment and every authorised repair step."
      : "Complete the retained frontend assessment with provider, rendered-browser, route, and repository evidence where required.",
    assessmentComplete: assessmentComplete === true,
    continueAutomatically: mode === "continue" || mode === "wait",
    continuationRule: "After each successful action, follow the newest returned checkpoint and continue across consecutive agent-owned actions.",
    refreshRule: "A returned checkpoint supersedes every copied action. On a stale revision or missing action, call get_mission_summary and continue from its checkpoint.",
    stopWhen: [
      "The checkpoint names the person as nextActor.",
      "The checkpoint is blocked and no supported evidence path remains.",
      "The checkpoint is complete and exposes no next action.",
    ],
    retryAfterMs: mode === "wait" ? 1500 : null,
  };
}

function completionCriteria(nextAction, browserReview, candidateReview) {
  if (nextAction?.tool === "record_browser_review_check") {
    const task = browserReview?.state?.nextCheck;
    return [
      bounded(task?.assignment?.completionCriteria ?? "Return the current browser task outcome."),
      "Use passed, issue, or an honest blocker with bounded direct observations.",
    ];
  }
  if (nextAction?.tool === "record_candidate_review_check") {
    const task = candidateReview?.state?.nextCheck
      ?? candidateReview?.nextTask
      ?? candidateReview?.tasks?.find((item) => item.id === nextAction.input?.checkId);
    return [
      bounded(task?.assignment?.completionCriteria ?? "Return the current candidate-browser comparison."),
      "Use passed, issue, or an honest blocker with bounded direct observations. An issue stops this candidate iteration and returns the mission to repository implementation.",
    ];
  }
  const byTool = {
    declare_agent_capabilities: [
      "Explicitly declare true or false for visual browser access, responsive emulation, runtime diagnostics, repository access, and terminal execution.",
      "Treat the declaration as agent-reported capability, not verified access or human authorisation. Deployment stays human-owned and is never a declarable capability.",
    ],
    check_site_audit_progress: ["Return a completed report or an actionable terminal error."],
    open_browser_review: ["Return the versioned current browser assignment."],
    open_diagnostic_mission: ["Return the bounded diagnosis mission and required investigations."],
    submit_runtime_diagnosis: ["Return a reproduction, repository-relative ownership, and planned checks."],
    record_diagnostic_blocker: ["Return one supported blocker reason and a bounded factual summary."],
    stage_site_repair: ["Return a bounded repair draft without implementation or deployment claims."],
    revise_site_repair: ["Return a new revision that answers the recorded change request."],
    get_repair_workspace: ["Return the authoritative repair state and next allowed action."],
    record_repository_implementation: ["Implement the approved repository plan, run the named checks, and return a bounded repository receipt."],
    open_candidate_review: ["Return the first exact candidate-browser task without navigating, fetching, auditing, or deploying."],
    record_candidate_review_check: ["Record only the current candidate task with attributed bounded observations."],
    get_candidate_review: ["Return the current candidate preflight state without changing it."],
    start_repair_verification: ["Return a stable verification audit assignment for the reviewed scope."],
    get_verification_receipt: ["Return current reviewed-matrix progress or completed fresh proof with its source boundaries."],
    start_site_exploration: ["Return one durable exploration assignment for the server-issued retained routes."],
    get_site_exploration: ["Return terminal bounded-site coverage or its explicit partial-source blocker."],
  };
  return byTool[nextAction?.tool] ?? [];
}

function retainedEvidenceSummary({ audit, missionState, browserReview, diagnosticMissions, repairs, explorations }) {
  const summary = [];
  if (audit?.status === "complete" && audit.report) {
    summary.push(`Measurement complete with ${Math.max(0, audit.report.findingCount ?? audit.report.findings?.length ?? 0)} retained findings.`);
  } else {
    summary.push(`Measurement ${bounded(audit?.status ?? "not-started", 40)} at ${Math.max(0, Math.min(100, audit?.progress ?? 0))}%.`);
  }
  if (missionState) {
    summary.push(`${missionState.priorityCount ?? 0} ranked priorities; assessment ${missionState.assessmentComplete ? "complete" : "incomplete"}.`);
    if (missionState.siteScope?.requested) {
      summary.push(`Bounded-site coverage ${bounded(missionState.siteScope.status, 40)}: ${missionState.siteScope.pagesComplete ?? 0}/${missionState.siteScope.pagesRequested ?? 0} retained routes complete.`);
    }
    const relationship = missionState.priorities?.[0]?.relationship;
    if (relationship) summary.push(`Highest retained relationship: ${bounded(relationship, 60)}.`);
  }
  if (browserReview?.id) {
    summary.push(`Browser review ${bounded(browserReview.state?.status ?? "in-progress", 40)}: ${browserReview.state?.completedCheckCount ?? 0}/${browserReview.state?.requestedCheckCount ?? 0} tasks complete.`);
  }
  if (diagnosticMissions?.length) summary.push(`${Math.min(10, diagnosticMissions.length)} bounded diagnostic missions retained.`);
  if (repairs?.length) summary.push(`${Math.min(10, repairs.length)} reviewed repair workspaces retained.`);
  if (explorations?.length) summary.push(`${Math.min(10, explorations.length)} bounded site explorations retained.`);
  return summary.slice(0, 6);
}

export function createMissionCheckpoint({
  audit,
  missionState: suppliedMissionState = null,
  browserReview = null,
  diagnosticMissions = [],
  repairs = [],
  explorations = [],
  agentCapabilities: suppliedAgentCapabilities = audit?.agentCapabilities ?? null,
} = {}) {
  if (!audit?.id) {
    throw new AuditError("AUDIT_NOT_FOUND", "A retained audit is required to create its checkpoint.");
  }
  const missionState = suppliedMissionState ?? ([1, 2].includes(audit.mission?.schemaVersion)
    ? deriveAuditMissionState({
        report: audit.report,
        mission: audit.mission,
        browserReview,
        diagnosticMissions,
        repairs,
        explorations,
      })
    : null);
  const missionNextAction = missionState
    ? missionState.nextAction ?? null
    : audit.status === "complete"
      ? { tool: "get_site_audit_results", input: {}, reason: "Read the completed retained evidence." }
      : ["failed", "cancelled"].includes(audit.status)
        ? null
        : { tool: "check_site_audit_progress", input: {}, reason: "Measurement is still running." };
  const status = missionState?.status ?? (audit.status === "complete" ? "complete" : audit.status === "failed" || audit.status === "cancelled" ? "blocked" : "in-progress");
  const missionNextActor = missionState?.nextActor ?? (missionNextAction ? "agent" : null);
  const candidateReview = repairs.find((repair) =>
    repair?.id === missionNextAction?.input?.repairId
    && repair?.candidateReview?.id)?.candidateReview ?? null;
  const agentCapabilities = suppliedAgentCapabilities == null
    ? null
    : agentCapabilitySnapshot(suppliedAgentCapabilities);
  const requiredCapabilities = missionNextActor === "agent"
    ? requiredAgentCapabilitiesForAction(missionNextAction, {
        browserReview,
        candidateReview,
        diagnosticMissions,
      })
    : [];
  const capabilityMatch = agentCapabilityMatch(agentCapabilities, requiredCapabilities);
  let nextAction = missionNextAction;
  let nextActor = missionNextActor;
  if (missionNextActor === "agent" && requiredCapabilities.length && !agentCapabilities) {
    nextAction = {
      tool: "declare_agent_capabilities",
      input: {},
      reason: "Frontmend needs an explicit agent capability declaration before it can compile the next mission task.",
    };
  } else if (missionNextActor === "agent" && requiredCapabilities.length && !capabilityMatch.eligible) {
    nextAction = null;
    nextActor = "person";
  }
  const action = createExecutableMissionAction(nextAction, audit);
  const assessmentComplete = missionState?.assessmentComplete ?? audit.status === "complete";
  return {
    schemaVersion: 1,
    auditId: bounded(audit.id, 160),
    workspacePath: `/audits/${encodeURIComponent(audit.id)}`,
    missionRevision: auditMissionRevision(audit),
    measurementComplete: missionState?.measurementComplete ?? audit.status === "complete",
    requestedScope: audit.mission?.scope === "bounded-site" ? "bounded-site" : "page",
    scopeStatus: missionState?.siteScope?.status ?? (audit.status === "complete" ? "complete" : "in-progress"),
    assessmentStatus: missionState?.assessmentStatus
      ?? (missionState
        ? missionState.assessmentComplete
          ? "complete"
          : missionState.status === "blocked"
            ? "blocked"
            : "incomplete"
        : audit.status === "complete" ? "complete" : "incomplete"),
    evidenceSnapshotAvailable: missionState?.evidenceSnapshotAvailable ?? audit.status === "complete",
    assessmentReceiptAvailable: missionState?.assessmentReceiptAvailable ?? false,
    status,
    nextActor,
    requiredCapability: missionNextAction?.tool
      ? CAPABILITY_BY_TOOL[missionNextAction.tool] ?? "contextual-tool"
      : null,
    requiredCapabilities,
    agentCapabilities,
    capabilityNegotiation: {
      status: !requiredCapabilities.length
        ? "not-required"
        : !agentCapabilities
          ? "declaration-required"
          : capabilityMatch.eligible
            ? "matched"
            : "human-handoff-required",
      provenance: agentCapabilities?.provenance ?? null,
      verificationStatus: agentCapabilities?.verificationStatus ?? null,
      requiredCapabilities,
      matchedCapabilities: capabilityMatch.matchedCapabilities,
      missingCapabilities: capabilityMatch.missingCapabilities,
      agentTaskCompiled: !requiredCapabilities.length || capabilityMatch.eligible,
      fallbackActor: requiredCapabilities.length && agentCapabilities && !capabilityMatch.eligible
        ? "person"
        : null,
      claim: "Capability values are declared by the agent and are not verified access, deployment authority, or proof of task completion.",
    },
    action,
    completionCriteria: completionCriteria(nextAction, browserReview, candidateReview),
    retainedEvidenceSummary: retainedEvidenceSummary({
      audit,
      missionState,
      browserReview,
      diagnosticMissions,
      repairs,
      explorations,
    }),
    authorityBoundary: {
      humanOnly: [
        "Approve or reject a repair, define delegated policy, and authorise deployment.",
        "Attest that the reviewed version was deployed to the retained public target.",
        "Accept unresolved business risk or change the public target.",
      ],
      agentMay: "Continue across consecutive agent-owned checkpoint actions, including diagnosis and authorised repository work, until a named human boundary, supported blocker, or completion.",
      claim: "A checkpoint resumes authority and evidence state; it does not prove implementation, deployment, or resolution.",
    },
    agentRun: agentRunContract({
      action,
      status,
      nextActor,
      missionIntent: audit.mission?.intent,
      assessmentComplete,
    }),
  };
}

export function assertExpectedMissionRevision(audit, expectedMissionRevision, checkpoint) {
  if (!Number.isInteger(expectedMissionRevision) || expectedMissionRevision < 1) {
    throw new AuditError(
      "INVALID_INPUT",
      "expectedMissionRevision must be a positive integer.",
    );
  }
  const current = auditMissionRevision(audit);
  if (expectedMissionRevision !== current) {
    throw new AuditError(
      "MISSION_REVISION_STALE",
      `This mission changed from revision ${expectedMissionRevision} to ${current}. Re-read the checkpoint before retrying the write.`,
      true,
      { missionCheckpoint: checkpoint },
    );
  }
  return current;
}

export function advanceMissionRevision(audit) {
  return { ...audit, missionRevision: auditMissionRevision(audit) + 1 };
}
