import { AuditError } from "./url-policy.js";
import { deriveAuditMissionState } from "./audit-mission-contract.js";

const CAPABILITY_BY_TOOL = Object.freeze({
  start_site_audit: "public-url",
  check_site_audit_progress: "progress",
  cancel_site_audit: "human-or-agent-cancellation",
  open_browser_review: "browser",
  record_browser_review_check: "browser",
  open_diagnostic_mission: "repository",
  submit_runtime_diagnosis: "repository",
  record_diagnostic_blocker: "repository",
  get_site_audit_results: "read-results",
  get_assessment_receipt: "read-results",
  prepare_site_repair: "repair-intent",
  stage_site_repair: "repository",
  revise_site_repair: "repository",
  get_repair_workspace: "read-repair",
  record_repository_implementation: "repository",
  start_repair_verification: "verification",
  get_verification_receipt: "read-verification",
});

function bounded(value, maximum = 400) {
  return String(value ?? "").replace(/\r\n/g, "\n").trim().slice(0, maximum);
}

export function auditMissionRevision(audit) {
  return Number.isInteger(audit?.missionRevision) && audit.missionRevision > 0
    ? audit.missionRevision
    : 1;
}

function completionCriteria(nextAction, browserReview) {
  if (nextAction?.tool === "record_browser_review_check") {
    const task = browserReview?.state?.nextCheck;
    return [
      bounded(task?.assignment?.completionCriteria ?? "Return the current browser task outcome."),
      "Use passed, issue, or an honest blocker with bounded direct observations.",
    ];
  }
  const byTool = {
    check_site_audit_progress: ["Return a completed report or an actionable terminal error."],
    open_browser_review: ["Return the versioned current browser assignment."],
    open_diagnostic_mission: ["Return the bounded diagnosis mission and required investigations."],
    submit_runtime_diagnosis: ["Return a reproduction, repository-relative ownership, and planned checks."],
    record_diagnostic_blocker: ["Return one supported blocker reason and a bounded factual summary."],
    stage_site_repair: ["Return a bounded repair draft without implementation or deployment claims."],
    revise_site_repair: ["Return a new revision that answers the recorded change request."],
    get_repair_workspace: ["Return the authoritative repair state and next allowed action."],
    start_repair_verification: ["Return a stable verification audit assignment for the reviewed scope."],
    get_verification_receipt: ["Return completed fresh proof with its source boundaries."],
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
} = {}) {
  if (!audit?.id) {
    throw new AuditError("AUDIT_NOT_FOUND", "A retained audit is required to create its checkpoint.");
  }
  const missionState = suppliedMissionState ?? (audit.mission?.schemaVersion === 1
    ? deriveAuditMissionState({
        report: audit.report,
        mission: audit.mission,
        browserReview,
        diagnosticMissions,
        repairs,
      })
    : null);
  const nextAction = missionState?.nextAction ?? (audit.status === "complete"
    ? { tool: "get_site_audit_results", input: {}, reason: "Read the completed retained evidence." }
    : ["failed", "cancelled"].includes(audit.status)
      ? null
      : { tool: "check_site_audit_progress", input: {}, reason: "Measurement is still running." });
  const status = missionState?.status ?? (audit.status === "complete" ? "complete" : audit.status === "failed" || audit.status === "cancelled" ? "blocked" : "in-progress");
  const nextActor = missionState?.nextActor ?? (nextAction ? "agent" : null);
  return {
    schemaVersion: 1,
    auditId: bounded(audit.id, 160),
    workspacePath: `/audits/${encodeURIComponent(audit.id)}`,
    missionRevision: auditMissionRevision(audit),
    status,
    nextActor,
    requiredCapability: nextAction?.tool ? CAPABILITY_BY_TOOL[nextAction.tool] ?? "contextual-tool" : null,
    action: nextAction
      ? {
          tool: bounded(nextAction.tool, 80),
          input: nextAction.input && typeof nextAction.input === "object"
            ? JSON.parse(JSON.stringify(nextAction.input))
            : {},
          reason: bounded(nextAction.reason, 500),
        }
      : null,
    completionCriteria: completionCriteria(nextAction, browserReview),
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
        "Approve or reject a repair and define any delegated policy.",
        "Deploy the reviewed change and attest that deployment.",
        "Accept unresolved business risk or change the public target.",
      ],
      agentMay: "Perform only the exact contextual action and return bounded evidence.",
      claim: "A checkpoint resumes authority and evidence state; it does not prove implementation, deployment, or resolution.",
    },
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
