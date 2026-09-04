import { AuditError } from "./audit-service.js";
import { assessmentReceiptMarkdown } from "./assessment-receipt.js";
import {
  createRepositoryFixBrief,
  repairMissionState,
  verificationReceiptMarkdown,
} from "./repair-contract.js";
import {
  DIAGNOSTIC_BLOCKER_REASONS,
  diagnosticEvidenceChain,
  diagnosticMissionSnapshot,
} from "./diagnostic-contract.js";
import {
  AUDIT_FOCUS_AREAS,
  assessmentFindings,
  auditMissionSnapshot,
  createAuditMission,
  deriveAuditMissionState,
  normalizeRepairFindingIds,
} from "./audit-mission-contract.js";
import {
  BROWSER_REVIEW_BLOCKER_REASONS,
  BROWSER_REVIEW_OUTCOMES,
  browserReviewAdoptionAvailable,
} from "./browser-review-contract.js";
import { repairVerificationReceiptMarkdown } from "./verification-impact-contract.js";
import { observedRouteRecords } from "./route-contract.js";
import {
  candidateCorrectionPacket,
  candidateReviewSnapshot,
} from "./candidate-review-contract.js";
import {
  REVISION_BOUND_MISSION_TOOLS,
  createExecutableMissionAction,
} from "./mission-checkpoint-contract.js";
import {
  AGENT_CAPABILITY_FIELDS,
  toolAllowedByAgentCapabilities,
} from "./agent-capability-contract.js";
import {
  FRONTMEND_PROTOCOL_VERSION,
  FRONTMEND_TOOL_COUNT,
  FRONTMEND_TOOL_LIBRARY_VERSION,
} from "./protocol-contract.js";
import { serializedCharacterCount } from "./webmcp-budget-contract.js";
import { createCodingAgentBrief } from "./coding-agent-brief-contract.js";

const emptySchema = { type: "object", properties: {}, additionalProperties: false };
const expectedMissionRevisionProperty = {
  type: "integer",
  minimum: 1,
  description: "Exact mission revision from the latest checkpoint. Stale writes are rejected with the current checkpoint.",
};
const checkpointedMutationTools = new Set(REVISION_BOUND_MISSION_TOOLS);

function objectInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new AuditError("INVALID_INPUT", "Tool input must be an object.");
  }
  return input;
}

function noExtra(input, allowed) {
  const extra = Object.keys(input).find((key) => !allowed.includes(key));
  if (extra) throw new AuditError("INVALID_INPUT", `Unknown field: ${extra}.`);
}

function requiredString(value, field, maximum = 2048) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new AuditError("INVALID_INPUT", `${field} must contain 1 to ${maximum} characters.`);
  }
  return value;
}

function optionalString(value, field, maximum) {
  if (value === undefined) return undefined;
  return requiredString(value, field, maximum);
}

function observedPaths(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) {
    throw new AuditError("INVALID_INPUT", "paths must contain between 1 and 3 observed routes.");
  }
  return value.map((path) => requiredString(path, "path", 256));
}

function optionalVerificationTargetIds(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 3) {
    throw new AuditError("INVALID_INPUT", "verificationTargetIds must contain at most three server-issued IDs.");
  }
  const ids = value.map((id) => requiredString(id, "verificationTargetIds", 180));
  if (new Set(ids).size !== ids.length) {
    throw new AuditError("INVALID_INPUT", "verificationTargetIds must be unique.");
  }
  return ids;
}

function auditIdForTool(service, value) {
  if (value !== undefined) return requiredString(value, "auditId", 80);
  const activeAuditId = service?.getActiveAudit?.()?.id;
  if (typeof activeAuditId === "string" && activeAuditId) return activeAuditId;
  throw new AuditError(
    "AUDIT_CONTEXT_REQUIRED",
    "Provide auditId or open the audit workspace that this action should use.",
  );
}

function expectedMissionRevisionForTool(service, auditId, value) {
  if (Number.isInteger(value) && value > 0) return value;
  const checkpoint = service?.getMissionCheckpoint?.(auditId);
  if (Number.isInteger(checkpoint?.missionRevision) && checkpoint.missionRevision > 0) {
    return checkpoint.missionRevision;
  }
  const activeAudit = service?.getActiveAudit?.();
  if (activeAudit?.id === auditId) {
    return Number.isInteger(activeAudit.missionRevision) && activeAudit.missionRevision > 0
      ? activeAudit.missionRevision
      : 1;
  }
  throw new AuditError("MISSION_REVISION_REQUIRED", "Read the latest mission checkpoint before changing this audit.");
}

function coherentResultsForTool(service, auditId) {
  return typeof service?.getCoherentResults === "function"
    ? service.getCoherentResults(auditId)
    : service.getResults(auditId);
}

function assertPreparedRepairPackage(service, auditId, findingIds) {
  const activeAudit = service?.getActiveAudit?.();
  const preparation = activeAudit?.id === auditId
    ? activeAudit.mission?.repairPreparation ?? null
    : null;
  const preparedFindingIds = preparation?.findingIds
    ?? (preparation?.findingId ? [preparation.findingId] : []);
  if (JSON.stringify(preparedFindingIds) !== JSON.stringify(findingIds)) {
    throw new AuditError(
      "REPAIR_INTENT_REQUIRED",
      "Call prepare_site_repair for this exact finding package before requesting its repository fix brief.",
    );
  }
}

const TOOL_CAPABILITIES = Object.freeze({
  start_site_audit: "public-url-selection",
  declare_agent_capabilities: "agent-capability-declaration",
  check_site_audit_progress: "progress-reading",
  get_mission_summary: "mission-reading",
  get_site_audit_results: "full-evidence-reading",
  get_evidence_chain: "evidence-reading",
  get_active_evidence_capsule: "active-evidence-reading",
  open_browser_review: "rendered-browser-inspection",
  record_browser_review_check: "rendered-browser-inspection",
  open_diagnostic_mission: "repository-diagnosis",
  submit_runtime_diagnosis: "repository-diagnosis",
  record_diagnostic_blocker: "repository-diagnosis",
  start_site_exploration: "bounded-site-measurement",
  stage_site_repair: "repository-repair-planning",
  revise_site_repair: "repository-repair-planning",
  record_repository_implementation: "repository-implementation",
  open_candidate_review: "candidate-browser-review",
  record_candidate_review_check: "candidate-browser-review",
  get_candidate_review: "candidate-review-reading",
  start_repair_verification: "fresh-public-verification",
});

function activeAuditId(service, result, input) {
  const data = result?.data;
  const candidate = data?.auditId
    ?? data?.rootAuditId
    ?? data?.baselineAuditId
    ?? input?.auditId
    ?? service?.getActiveAudit?.()?.id
    ?? data?.id;
  return typeof candidate === "string" && candidate ? candidate : null;
}

function activityAuditId(service, result, input, auditIdBefore) {
  const data = result?.data;
  const candidate = data?.auditId
    ?? data?.rootAuditId
    ?? data?.baselineAuditId
    ?? input?.auditId
    ?? auditIdBefore
    ?? data?.id
    ?? service?.getActiveAudit?.()?.id;
  return typeof candidate === "string" && candidate ? candidate : null;
}

function safeCheckpoint(service, auditId, result) {
  const supplied = result?.data?.missionCheckpoint ?? result?.error?.details?.missionCheckpoint;
  if (supplied && typeof supplied === "object") return supplied;
  if (!auditId) return null;
  try {
    return service?.getMissionCheckpoint?.(auditId) ?? null;
  } catch {
    return null;
  }
}

function compactAction(action, reasonMaximum = 180) {
  if (!action?.tool) return null;
  return {
    tool: action.tool,
    input: action.input && typeof action.input === "object" && !Array.isArray(action.input)
      ? JSON.parse(JSON.stringify(action.input))
      : {},
    ...(typeof action.reason === "string" && action.reason
      ? { reason: action.reason.slice(0, reasonMaximum) }
      : {}),
  };
}

function compactAgentRun(agentRun) {
  if (!agentRun || typeof agentRun !== "object") return null;
  return {
    schemaVersion: Number.isInteger(agentRun.schemaVersion) ? agentRun.schemaVersion : 1,
    mode: agentRun.mode ?? "complete",
    continueAutomatically: agentRun.continueAutomatically === true,
    ...(Number.isFinite(agentRun.retryAfterMs) ? { retryAfterMs: agentRun.retryAfterMs } : {}),
  };
}

function compactCheckpoint(checkpoint) {
  if (!checkpoint || typeof checkpoint !== "object") return null;
  return {
    missionRevision: Number.isInteger(checkpoint.missionRevision) ? checkpoint.missionRevision : 0,
    status: checkpoint.status ?? "unknown",
    nextActor: checkpoint.nextActor ?? null,
  };
}

function compactCompletionCriteria(criteria) {
  return (Array.isArray(criteria) ? criteria : [])
    .slice(0, 2)
    .map((item) => String(item).slice(0, 180));
}

function compactCapabilityNegotiation(value) {
  if (!value || typeof value !== "object") return null;
  return {
    status: value.status ?? "not-required",
    requiredCapabilities: [...(value.requiredCapabilities ?? [])],
    missingCapabilities: [...(value.missingCapabilities ?? [])],
  };
}

function activeToolNames(service) {
  try {
    return auditHandoffFrontmendToolNames(service);
  } catch {
    return [];
  }
}

function toolsetRevision(service) {
  const audit = service?.getActiveAudit?.();
  const checkpoint = safeCheckpoint(service, audit?.id ?? null, null);
  return Number.isInteger(checkpoint?.missionRevision)
    ? checkpoint.missionRevision
    : Number.isInteger(audit?.missionRevision) ? audit.missionRevision : 0;
}

function protocolEnvelope(service, result, input) {
  const auditId = activeAuditId(service, result, input);
  const checkpoint = safeCheckpoint(service, auditId, result);
  const activeAudit = service?.getActiveAudit?.();
  const missionRevision = Number.isInteger(checkpoint?.missionRevision)
    ? checkpoint.missionRevision
    : Number.isInteger(activeAudit?.missionRevision) ? activeAudit.missionRevision : 0;
  const resultData = result?.data;
  const hasNextAction = resultData && Object.hasOwn(resultData, "nextAction");
  const hasRecommendedNextAction = resultData && Object.hasOwn(resultData, "recommendedNextAction");
  const action = result?.error?.code === "TOOLSET_CHANGED"
    ? result.error.details?.recovery ?? null
    : hasNextAction
      ? resultData.nextAction
      : hasRecommendedNextAction
        ? resultData.recommendedNextAction
        : checkpoint?.action ?? null;
  const activeTools = activeToolNames(service);
  const next = compactAction(action);
  const admittedNext = next?.tool && activeTools.includes(next.tool) ? next : null;
  return {
    protocolVersion: FRONTMEND_PROTOCOL_VERSION,
    toolLibraryVersion: FRONTMEND_TOOL_LIBRARY_VERSION,
    toolCount: FRONTMEND_TOOL_COUNT,
    toolsetRevision: missionRevision,
    missionRevision,
    workspacePath: result?.data?.workspacePath
      ?? (auditId ? `/audits/${encodeURIComponent(auditId)}` : "/"),
    activeToolCount: activeTools.length,
    next: admittedNext?.tool
      ? {
          ...admittedNext,
          requiredCapability: result?.error?.code === "TOOLSET_CHANGED"
            ? TOOL_CAPABILITIES[admittedNext.tool] ?? null
            : checkpoint?.requiredCapability
              ?? TOOL_CAPABILITIES[admittedNext.tool]
              ?? null,
        }
      : null,
    agentRun: admittedNext
      ? compactAgentRun(resultData?.agentRun ?? checkpoint?.agentRun)
      : { schemaVersion: 1, mode: "complete", continueAutomatically: false },
  };
}

function compactPriority(priority) {
  return {
    rank: priority.rank,
    findingId: priority.findingId,
    title: priority.title,
    severity: priority.severity,
    category: priority.category,
    relationship: priority.relationship,
    whyPrioritized: priority.whyPrioritized,
    evidenceState: priority.evidenceState,
    occurrenceCount: priority.occurrenceCount,
    distinctPageCount: priority.distinctPageCount,
    affectedStrategies: [...(priority.affectedStrategies ?? [])],
    diagnosticMissionRequired: priority.diagnosticMissionRequired,
    diagnosticMissionId: priority.diagnosticMissionId,
    diagnosticBlocker: priority.diagnosticBlocker,
    unresolvedRequirement: priority.unresolvedRequirement,
    source: priority.source,
    nextAction: priority.nextAction ?? null,
  };
}

function compactSummaryPriority(priority) {
  return {
    rank: priority.rank,
    findingId: priority.findingId,
    title: typeof priority.title === "string" ? priority.title.slice(0, 140) : "Untitled finding",
    severity: priority.severity,
    category: priority.category,
    relationship: priority.relationship,
    evidenceState: priority.evidenceState,
    occurrenceCount: priority.occurrenceCount,
    affectedStrategies: [...(priority.affectedStrategies ?? [])],
    diagnosticMissionRequired: priority.diagnosticMissionRequired,
    diagnosticBlocker: priority.diagnosticBlocker ?? null,
    unresolvedRequirement: priority.unresolvedRequirement ?? null,
    source: priority.source,
    nextTool: priority.nextAction?.tool ?? null,
  };
}

function compactBrowserReview(review) {
  if (!review) return null;
  return {
    id: review.id,
    auditId: review.auditId,
    purpose: review.purpose,
    target: review.target,
    requestedFocusAreas: [...(review.requestedFocusAreas ?? [])],
    adoption: review.adoption ?? null,
    state: review.state,
    findings: [...(review.findings ?? [])],
    authority: review.authority,
  };
}

function compactMissionState(missionState) {
  return {
    status: missionState.status,
    auditComplete: missionState.auditComplete,
    measurementComplete: missionState.measurementComplete,
    assessmentComplete: missionState.assessmentComplete,
    assessmentStatus: missionState.assessmentStatus,
    rankingStatus: missionState.rankingStatus,
    checkpointStatus: missionState.checkpointStatus,
    explorationStatus: missionState.explorationStatus,
    matchingFindingCount: missionState.matchingFindingCount,
    priorityCount: missionState.priorityCount,
    siteScope: missionState.siteScope
      ? {
          requested: missionState.siteScope.requested === true,
          status: missionState.siteScope.status,
          pagesComplete: missionState.siteScope.pagesComplete ?? 0,
          pagesRequested: missionState.siteScope.pagesRequested ?? 0,
          routeCandidates: (missionState.siteScope.routeCandidates ?? []).map((candidate) => ({
            id: candidate.id,
            path: candidate.path,
          })),
        }
      : null,
    browserReview: missionState.browserReview
      ? {
          required: missionState.browserReview.required === true,
          status: missionState.browserReview.status,
        }
      : null,
    repairReadiness: missionState.repairReadiness
      ? {
          status: missionState.repairReadiness.status,
          blocker: missionState.repairReadiness.blocker ?? null,
        }
      : null,
    nextAction: compactAction(missionState.nextAction),
  };
}

function compactAuditReport(report) {
  return {
    auditId: report.auditId,
    completedAt: report.completedAt,
    score: report.score,
    findingCount: report.findingCount,
    engine: report.engine
      ? {
          mode: report.engine.mode,
          provider: report.engine.provider,
          fallback: report.engine.fallback === true,
        }
      : null,
    viewports: (report.viewports ?? []).map((viewport) => ({
      id: viewport.id,
      strategy: viewport.strategy,
      score: viewport.score,
      evidenceMode: viewport.evidenceMode,
    })),
  };
}

async function missionProjectionForTool(service, requestedAuditId) {
  const remembered = service?.getActiveAudit?.() ?? null;
  const auditId = requestedAuditId === undefined
    ? remembered?.id ?? null
    : requiredString(requestedAuditId, "auditId", 80);
  if (!auditId) return { audit: null, report: null, missionState: null, checkpoint: null };
  let audit = remembered?.id === auditId ? remembered : null;
  if (!audit || audit.status !== "complete") audit = await service.getAudit(auditId);
  if (audit.status !== "complete") {
    return {
      audit,
      report: null,
      missionState: null,
      checkpoint: audit.missionCheckpoint ?? service?.getMissionCheckpoint?.(auditId) ?? null,
    };
  }
  const report = await coherentResultsForTool(service, auditId);
  audit = service?.getActiveAudit?.()?.id === auditId ? service.getActiveAudit() : audit;
  const mission = auditMissionSnapshot(audit.mission);
  const diagnosticMissions = service?.getDiagnosticMissions?.(auditId) ?? [];
  const repairs = service?.getRepairs?.(auditId) ?? [];
  const browserReview = service?.getBrowserReview?.(auditId) ?? null;
  const explorations = service?.getSiteExplorations?.(auditId) ?? [];
  return {
    audit,
    report,
    mission,
    diagnosticMissions,
    repairs,
    browserReview,
    explorations,
    missionState: deriveAuditMissionState({
      report,
      mission,
      diagnosticMissions,
      repairs,
      browserReview,
      explorations,
    }),
    checkpoint: service?.getMissionCheckpoint?.(auditId) ?? report.missionCheckpoint ?? null,
  };
}

async function safely(operation) {
  try {
    return { ok: true, data: await operation() };
  } catch (error) {
    if (error instanceof AuditError) {
      return {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          recoverable: error.recoverable !== false,
          ...(error.details ? { details: error.details } : {}),
        },
      };
    }
    return {
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "Frontmend could not complete the operation.",
        recoverable: false,
      },
    };
  }
}

function cancelledExecutionError(phase) {
  return new AuditError(
    "TOOL_EXECUTION_CANCELLED",
    phase === "before-dispatch"
      ? "The host cancelled this tool before Frontmend dispatched it. No operation was started."
      : "The host cancelled this read before Frontmend returned evidence. No mission state was changed by the read.",
    true,
    { phase },
  );
}

function assertNotAborted(signal) {
  if (signal?.aborted) throw cancelledExecutionError("before-dispatch");
}

function awaitAbortableRead(operation, signal) {
  if (!signal || typeof signal.addEventListener !== "function") return operation;
  if (signal.aborted) return Promise.reject(cancelledExecutionError("before-dispatch"));
  return new Promise((resolve, reject) => {
    let settled = false;
    const complete = (callback, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback(value);
    };
    const onAbort = () => complete(reject, cancelledExecutionError("read-in-flight"));
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(operation).then(
      (value) => complete(resolve, value),
      (error) => complete(reject, error),
    );
  });
}

function assertCurrentContextualTool(service, toolName, registration) {
  if (registration?.enforceContextualAvailability !== true) return;
  const currentNames = activeToolNames(service);
  if (currentNames.includes(toolName)) return;
  const audit = service?.getActiveAudit?.() ?? null;
  const currentRevision = toolsetRevision(service);
  throw new AuditError(
    "TOOLSET_CHANGED",
    "This contextual tool is no longer active. Read the current mission summary and continue from its returned toolset.",
    true,
    {
      registeredToolsetRevision: Number.isInteger(registration.toolsetRevision)
        ? registration.toolsetRevision
        : 0,
      currentToolsetRevision: currentRevision,
      recovery: {
        tool: "get_mission_summary",
        input: audit?.id ? { auditId: audit.id } : {},
        reason: "Refresh the contextual toolset before retrying an action.",
      },
    },
  );
}

function tool(definition) {
  return {
    name: definition.name,
    title: definition.title,
    description: definition.description,
    inputSchema: definition.inputSchema,
    annotations: definition.annotations,
    execute: (input, options = {}) => safely(async () => {
      assertNotAborted(options?.signal);
      const operation = definition.run(input, { signal: options?.signal });
      return definition.annotations?.readOnlyHint === true
        ? await awaitAbortableRead(operation, options?.signal)
        : await operation;
    }),
  };
}

function registrationErrorMessage(error) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    if (typeof error.message === "string") return error.message;
    try {
      return JSON.stringify(error);
    } catch {
      return "Unknown registration error.";
    }
  }
  return String(error);
}

/**
 * The public product path is intentionally smaller than the retained legacy
 * repair protocol. Frontmend measures and explains the public site; the coding
 * agent then works in its repository with its ordinary tools. These are the
 * only contracts advertised by the live page for that handoff.
 */
export function auditHandoffFrontmendToolNames(service) {
  const audit = service?.getActiveAudit?.();
  if (!audit || ["failed", "cancelled"].includes(audit.status)) {
    return ["start_site_audit", "get_mission_summary"];
  }
  if (audit.status !== "complete") {
    return ["check_site_audit_progress", "cancel_site_audit", "get_mission_summary"];
  }
  if (audit.missionWorkspace?.status === "partial") {
    return ["get_mission_summary", "get_site_audit_results"];
  }

  const available = new Set(["get_mission_summary", "get_site_audit_results"]);
  const browserReview = service?.getBrowserReview?.(audit.id) ?? null;
  const explorations = service?.getSiteExplorations?.(audit.id) ?? [];
  const findings = assessmentFindings(audit.report, browserReview, explorations);
  const routes = observedRouteRecords(audit.report);

  if (findings.length) available.add("get_evidence_chain");
  if (routes.length) {
    available.add("start_related_page_audit");
    available.add("start_site_exploration");
  }
  if (explorations.length) available.add("get_site_exploration");

  return createFrontmendTools(service)
    .map((toolDefinition) => toolDefinition.name)
    .filter((name) => available.has(name));
}

export function contextualFrontmendToolNames(service) {
  const audit = service?.getActiveAudit?.();
  if (!audit || ["failed", "cancelled"].includes(audit.status)) {
    return ["start_site_audit", "get_mission_summary"];
  }
  if (audit.status !== "complete") {
    return ["check_site_audit_progress", "cancel_site_audit", "get_mission_summary"];
  }
  if (audit.missionWorkspace?.status === "partial") {
    return ["get_mission_summary", "get_site_audit_results"];
  }

  const available = new Set(["get_mission_summary", "get_site_audit_results"]);
  const browserReview = service?.getBrowserReview?.(audit.id) ?? null;
  const repairs = service?.getRepairs?.(audit.id) ?? [];
  const diagnosticMissions = service?.getDiagnosticMissions?.(audit.id) ?? [];
  const explorations = service?.getSiteExplorations?.(audit.id) ?? [];
  const findings = assessmentFindings(audit.report, browserReview, explorations);
  const missionState = [1, 2].includes(audit.mission?.schemaVersion)
    ? deriveAuditMissionState({
        report: audit.report,
        mission: audit.mission,
        diagnosticMissions,
        repairs,
        browserReview,
        explorations,
      })
    : null;
  const routes = missionState?.siteScope?.routeCandidates ?? observedRouteRecords(audit.report);
  const verificationReplay = audit.report?.verification?.browserReplay ?? null;
  const verificationReplays = audit.report?.verification?.browserReplays?.length
    ? audit.report.verification.browserReplays
    : verificationReplay?.required
      ? [verificationReplay]
      : [];
  const verificationGuardrails = audit.report?.verification?.browserGuardrails ?? [];
  const verificationReplayRequired = verificationReplays.length > 0 || verificationGuardrails.length > 0;
  const verificationReplayComplete = verificationReplays.every((replay) => replay.status === "complete")
    && verificationGuardrails.every((guardrail) => guardrail.status === "complete");
  const browserReviewComplete = !missionState?.browserReview?.required || missionState.browserReview.status === "complete";

  if (missionState?.priorities?.length && typeof service?.getActiveEvidenceCapsule === "function") {
    available.add("get_active_evidence_capsule");
  }

  if (audit.report?.verification && verificationReplayComplete) available.add("get_verification_receipt");
  if (repairs.some((repair) => repair.aggregateVerification?.receiptAvailable)) {
    available.add("get_verification_receipt");
  }
  if (
    !audit.report?.verification &&
    audit.report?.engine?.provider &&
    missionState?.assessmentComplete
  ) {
    available.add("get_assessment_receipt");
  }
  if (routes.length) {
    available.add("start_related_page_audit");
    available.add("start_site_exploration");
  }
  if (explorations.length) available.add("get_site_exploration");
  const preparedFindingId = audit.mission?.repairPreparation?.findingId ?? null;
  const preparedFindingIds = audit.mission?.repairPreparation?.findingIds
    ?? (preparedFindingId ? [preparedFindingId] : []);
  const preparedFindingIdSet = new Set(preparedFindingIds);
  if (findings.length && browserReviewComplete && missionState?.assessmentComplete !== false) {
    available.add("prepare_site_repair");
    if (preparedFindingIds.length) available.add("get_repository_fix_brief");
  }
  if (findings.length) available.add("get_evidence_chain");
  if (repairs.length) available.add("get_repair_workspace");
  if (
    !browserReview
    && (
      missionState?.browserReview?.required
      || browserReviewAdoptionAvailable(audit.mission, browserReview)
    )
  ) {
    available.add("open_browser_review");
  }
  if (missionState?.browserReview?.extensionRequired) available.add("open_browser_review");
  if (verificationReplayRequired && !browserReview) {
    available.add("open_browser_review");
  }
  if (
    missionState?.browserReview?.required &&
    browserReview &&
    missionState.browserReview.status !== "complete"
  ) {
    available.add("record_browser_review_check");
  }
  if (
    verificationReplayRequired &&
    browserReview &&
    browserReview.state?.status !== "complete"
  ) {
    available.add("record_browser_review_check");
  }
  const preparedDiagnosticMissions = diagnosticMissions.filter(
    (mission) => preparedFindingIdSet.has(mission.findingId),
  );
  if (browserReviewComplete && missionState?.nextAction?.tool === "open_diagnostic_mission") {
    available.add("open_diagnostic_mission");
  }
  if (
    browserReviewComplete
    && preparedDiagnosticMissions.some((mission) => ["awaiting-diagnosis", "blocked"].includes(mission.state?.state))
  ) {
    available.add("submit_runtime_diagnosis");
  }
  if (
    browserReviewComplete
    && preparedDiagnosticMissions.some((mission) => mission.state?.state === "awaiting-diagnosis")
  ) {
    available.add("record_diagnostic_blocker");
  }
  if (
    missionState?.nextAction?.tool === "stage_site_repair"
    || (!missionState && preparedFindingIds.length > 0)
  ) {
    available.add("stage_site_repair");
  }
  if (repairs.some((repair) => repair.status === "changes-requested")) {
    available.add("revise_site_repair");
  }
  if (
    repairs.some(
      (repair) => repair.status === "approved" && !Number.isFinite(repair.deploymentAttestedAt),
    )
  ) {
    available.add("record_repository_implementation");
  }
  const candidateReadyRepairs = repairs.filter((repair) =>
    repair.status === "approved"
    && !Number.isFinite(repair.deploymentAttestedAt)
    && repair.implementationReceipt?.agentReported === true
    && (repair.implementationReceipt.checks?.length ?? 0) > 0
    && repair.implementationReceipt.checks.every((check) => check?.status === "passed"));
  const candidateRepairsWithNextTask = candidateReadyRepairs.filter((repair) =>
    repair.candidateReview?.id
    && !repair.candidateReview.results?.some((result) => result?.outcome === "issue")
    && repair.candidateReview.state?.nextCheck);
  if (candidateReadyRepairs.some((repair) => !repair.candidateReview?.id)) {
    available.add("open_candidate_review");
  }
  if (repairs.some((repair) => repair.candidateReview?.id)) {
    available.add("get_candidate_review");
  }
  if (candidateRepairsWithNextTask.length) {
    available.add("record_candidate_review_check");
  }
  if (
    repairs.some(
      (repair) =>
        repair.status === "approved" && Number.isFinite(repair.deploymentAttestedAt),
    )
  ) {
    available.add("start_repair_verification");
  }

  // The shared mission projection owns the exact next action. Keep that action
  // discoverable even if a secondary raw-state guard has not learned a new
  // terminal or recovery state yet; the tool's application validation remains
  // authoritative when it executes.
  if (missionState?.nextAction?.tool) {
    available.add(missionState.nextAction.tool);
  }

  if (typeof service?.getAgentCapabilities === "function") {
    const declaration = service.getAgentCapabilities(audit.id);
    available.add("declare_agent_capabilities");
    for (const name of [...available]) {
      const candidateRepair = name === "record_candidate_review_check"
        ? candidateRepairsWithNextTask[0]
        : null;
      if (
        name !== "declare_agent_capabilities"
        && !toolAllowedByAgentCapabilities(name, declaration, {
          browserReview,
          candidateReview: candidateRepair?.candidateReview ?? null,
          diagnosticMissions,
          input: missionState?.nextAction?.tool === name ? missionState.nextAction.input : {},
        })
      ) {
        available.delete(name);
      }
    }
  }

  return createFrontmendTools(service)
    .map((toolDefinition) => toolDefinition.name)
    .filter((name) => available.has(name));
}

export function createFrontmendTools(service) {
  const tools = [
    tool({
      name: "start_site_audit",
      title: "Start site audit",
      description:
        "Start a durable audit of a public HTTP(S) site. Preserve the person's requested focus, priority limit, and page or bounded-site scope. Default to assess; use prepare-fix only after an explicit repair request. Poll the returned audit, then follow its contextual next action until assessmentComplete or a named blocker. Repository diagnosis belongs only to a later selected-repair phase.",
      inputSchema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            minLength: 1,
            maxLength: 2048,
            description: "Public website URL to audit, with or without an HTTPS scheme.",
          },
          intent: {
            type: "string",
            enum: ["assess", "prepare-fix"],
            description: "Mission intent. Defaults to assess; prepare-fix requires an explicit person request.",
          },
          focusAreas: {
            type: "array",
            minItems: 1,
            maxItems: 3,
            uniqueItems: true,
            items: { type: "string", enum: AUDIT_FOCUS_AREAS },
            description: "One to three focus areas explicitly requested by the person.",
          },
          maxPriorities: {
            type: "integer",
            minimum: 1,
            maximum: 5,
            description: "Maximum deduplicated mission priorities. Defaults to 3.",
          },
          scope: {
            type: "string",
            enum: ["page", "bounded-site"],
            description: "Page audits retain the target only. Bounded-site audits also retain up to three server-issued same-site route candidates before completion.",
          },
          routeLimit: {
            type: "integer",
            minimum: 1,
            maximum: 3,
            description: "Maximum retained routes for bounded-site scope. Defaults to 3.",
          },
        },
        required: ["url"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      async run(input) {
        const value = objectInput(input);
        noExtra(value, ["url", "intent", "focusAreas", "maxPriorities", "scope", "routeLimit"]);
        if (typeof value.url !== "string") {
          throw new AuditError("INVALID_INPUT", "url must be a string.");
        }
        const audit = await service.startAudit({
          url: value.url,
          source: "agent",
          mission: {
            intent: value.intent,
            focusAreas: value.focusAreas,
            maxPriorities: value.maxPriorities,
            scope: value.scope,
            routeLimit: value.routeLimit,
          },
        });
        return {
          ...audit,
          workspacePath: `/audits/${encodeURIComponent(audit.id)}`,
          nextAction: {
            tool: "check_site_audit_progress",
            input: { auditId: audit.id },
            reason: "Wait for the live measurement job, then continue the persisted assessment mission.",
          },
        };
      },
    }),
    tool({
      name: "check_site_audit_progress",
      title: "Check site audit progress",
      description:
        "Read the authoritative status, phase, and percentage for a Frontmend audit. Omit auditId to use the visible audit. This does not start or mutate an audit.",
      inputSchema: {
        type: "object",
        properties: {
          auditId: { type: "string", minLength: 1, description: "Optional audit ID; defaults to the visible audit." },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      async run(input, { signal } = {}) {
        const value = objectInput(input);
        noExtra(value, ["auditId"]);
        const audit = await service.getAudit(
          auditIdForTool(service, value.auditId),
          { signal },
        );
        return {
          auditId: audit.id,
          attempt: Number.isFinite(audit.attempt) ? audit.attempt : 1,
          workspacePath: `/audits/${encodeURIComponent(audit.id)}`,
          url: audit.url,
          status: audit.status,
          phase: audit.phase,
          phaseLabel: audit.phaseLabel,
          progress: audit.progress,
          mission: audit.mission ?? null,
        };
      },
    }),
    tool({
      name: "cancel_site_audit",
      title: "Cancel site audit",
      description:
        "Cancel the visible queued or running Frontmend audit and persist that terminal state. Omit auditId to use the visible audit. Repeating this operation is safe, and it never changes the target site.",
      inputSchema: {
        type: "object",
        properties: {
          auditId: { type: "string", minLength: 1, description: "Optional audit ID; defaults to the visible audit." },
          expectedMissionRevision: expectedMissionRevisionProperty,
        },
        required: ["expectedMissionRevision"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async run(input) {
        const value = objectInput(input);
        noExtra(value, ["auditId", "expectedMissionRevision"]);
        const auditId = auditIdForTool(service, value.auditId);
        const audit = await service.cancelAudit(
          auditId,
          expectedMissionRevisionForTool(service, auditId, value.expectedMissionRevision),
        );
        return {
          auditId: audit.id,
          attempt: Number.isFinite(audit.attempt) ? audit.attempt : 1,
          status: audit.status,
          workspacePath: `/audits/${encodeURIComponent(audit.id)}`,
          missionCheckpoint: audit.missionCheckpoint ?? service?.getMissionCheckpoint?.(auditId),
          message:
            audit.status === "cancelled"
              ? "The audit is cancelled. No result was produced."
              : `The audit was already ${audit.status}.`,
        };
      },
    }),
    tool({
      name: "get_mission_summary",
      title: "Get mission summary",
      description:
        "Return the compact audit status and up to three retained recommendations. While measurement is running, follow the polling action. When it is complete, read the results once for the coding-agent brief; repository inspection, editing, testing, and deployment happen in the agent's normal workflow outside Frontmend.",
      inputSchema: {
        ...emptySchema,
        properties: {
          auditId: { type: "string", minLength: 1, maxLength: 80, description: "Optional audit ID; defaults to the visible audit." },
        },
      },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      async run(input) {
        const value = objectInput(input);
        noExtra(value, ["auditId"]);
        const projection = await missionProjectionForTool(service, value.auditId);
        if (!projection.audit) {
          return {
            auditId: null,
            status: "idle",
            measurementStatus: "not-started",
            assessmentStatus: "not-started",
            checkpointStatus: "idle",
            explorationStatus: "not-requested",
            workspacePath: "/",
            missionCheckpoint: null,
            mission: null,
            assessment: {
              measurementComplete: false,
              assessmentComplete: false,
              status: "not-started",
              blocker: null,
            },
            topPriorities: [],
            completionCriteria: ["Choose one public HTTP or HTTPS target."],
            requiredCapability: "public-url-selection",
            nextAction: {
              tool: "start_site_audit",
              input: {},
              reason: "No retained audit mission is active.",
            },
          };
        }
        const { audit, missionState, checkpoint } = projection;
        if (audit.status !== "complete") {
          return {
            auditId: audit.id,
            status: audit.status,
            measurementStatus: audit.status,
            assessmentStatus: "measuring",
            checkpointStatus: "in-progress",
            explorationStatus: "not-started",
            phase: audit.phase,
            phaseLabel: audit.phaseLabel,
            progress: audit.progress,
            workspacePath: `/audits/${encodeURIComponent(audit.id)}`,
            missionCheckpoint: compactCheckpoint(checkpoint),
            mission: audit.mission
              ? {
                  intent: audit.mission.intent,
                  focusAreas: [...(audit.mission.focusAreas ?? [])],
                  scope: audit.mission.scope,
                }
              : null,
            assessment: {
              measurementComplete: false,
              assessmentComplete: false,
              status: "measuring",
              blocker: null,
            },
            topPriorities: [],
            completionCriteria: compactCompletionCriteria(
              checkpoint?.completionCriteria ?? ["Retain a completed public evidence report."],
            ),
            requiredCapability: checkpoint?.requiredCapability ?? "progress-reading",
            nextAction: compactAction(checkpoint?.action ?? {
              tool: "check_site_audit_progress",
              input: { auditId: audit.id },
              reason: "The bounded measurement job is still active.",
            }),
            agentRun: compactAgentRun(checkpoint?.agentRun),
          };
        }
        const codingAgentBrief = createCodingAgentBrief({
          report: projection.report,
          priorities: missionState.priorities,
          mission: projection.mission,
        });
        return {
          auditId: audit.id,
          status: audit.status,
          measurementStatus: "complete",
          assessmentStatus: "complete",
          checkpointStatus: "complete",
          explorationStatus: missionState.explorationStatus,
          workspacePath: `/audits/${encodeURIComponent(audit.id)}`,
          missionCheckpoint: compactCheckpoint(checkpoint),
          mission: {
            intent: projection.mission.intent,
            requestedBy: projection.mission.requestedBy,
            focusAreas: [...projection.mission.focusAreas],
            scope: projection.mission.scope,
            routeLimit: projection.mission.routeLimit,
          },
          assessment: {
            measurementComplete: true,
            assessmentComplete: true,
            status: "complete",
            blocker: null,
            siteScope: {
              requested: missionState.siteScope?.requested === true,
              status: missionState.siteScope?.status ?? "not-requested",
              pagesComplete: missionState.siteScope?.pagesComplete ?? 0,
              pagesRequested: missionState.siteScope?.pagesRequested ?? 0,
            },
          },
          topPriorities: missionState.priorities.slice(0, 3).map(compactSummaryPriority),
          recommendationCount: codingAgentBrief.recommendations.length,
          completionCriteria: ["Read the coding-agent brief, then continue in the repository with normal coding tools."],
          requiredCapability: "full-evidence-reading",
          requiredCapabilities: [],
          capabilityNegotiation: null,
          nextAction: {
            tool: "get_site_audit_results",
            input: { auditId: audit.id },
            reason: "Read the recommendations and exact evidence prepared for the coding agent.",
          },
          agentRun: { schemaVersion: 1, mode: "continue", continueAutomatically: true },
          workflowBoundary: "Frontmend audits and explains the public site. The coding agent owns repository investigation and implementation.",
        };
      },
    }),
    tool({
      name: "declare_agent_capabilities",
      title: "Declare agent capabilities",
      description:
        "Declare whether this agent currently has visual browser access, responsive emulation, runtime diagnostics, repository access, and terminal execution. Every value is agent-declared and explicitly not verified. Deployment is deliberately not a declarable capability: it stays human-owned. Frontmend uses the declaration only to compile feasible mission tasks; it never grants repair approval, credentials, deployment authority, or proof that a task ran.",
      inputSchema: {
        type: "object",
        properties: {
          auditId: { type: "string", minLength: 1, maxLength: 80, description: "Optional audit ID; defaults to the visible audit." },
          capabilities: {
            type: "object",
            properties: Object.fromEntries(
              Object.values(AGENT_CAPABILITY_FIELDS).map((field) => [field, {
                type: "boolean",
                description: "Explicit agent self-report for this capability. This value is not independently verified.",
              }]),
            ),
            required: Object.values(AGENT_CAPABILITY_FIELDS),
            additionalProperties: false,
          },
        },
        required: ["capabilities"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async run(input) {
        const value = objectInput(input);
        noExtra(value, ["auditId", "capabilities", "expectedMissionRevision"]);
        const auditId = auditIdForTool(service, value.auditId);
        const result = await service.declareAgentCapabilities(
          auditId,
          value.capabilities,
          expectedMissionRevisionForTool(service, auditId, value.expectedMissionRevision),
        );
        const checkpoint = result.missionCheckpoint ?? service.getMissionCheckpoint(auditId);
        return {
          auditId,
          workspacePath: `/audits/${encodeURIComponent(auditId)}`,
          agentCapabilities: result.agentCapabilities,
          capabilityNegotiation: checkpoint?.capabilityNegotiation ?? null,
          missionCheckpoint: checkpoint,
          nextAction: checkpoint?.action ?? null,
          authorityBoundary: checkpoint?.authorityBoundary ?? null,
        };
      },
    }),
    tool({
      name: "get_site_audit_results",
      title: "Get site audit results",
      description:
        "Read a completed audit as a coding-agent handoff. The compact default returns ranked recommendations with evidence, routes, viewports, selectors, source rule IDs, repository search hints, and acceptance criteria. Use full only for forensic provider detail. Frontmend does not gate or perform repository work.",
      inputSchema: {
        ...emptySchema,
        properties: {
          auditId: { type: "string", minLength: 1, description: "Optional completed audit ID; defaults to the visible audit." },
          focusAreas: {
            type: "array", minItems: 1, maxItems: 3, uniqueItems: true,
            items: { type: "string", enum: AUDIT_FOCUS_AREAS },
            description: "Optional areas requested by the person, such as accessibility and seo.",
          },
          maxPriorities: { type: "integer", minimum: 1, maximum: 5, description: "Maximum deduplicated priorities; defaults to 3." },
          detailLevel: {
            type: "string",
            enum: ["summary", "full"],
            description: "summary is the compact default; full includes the complete bounded provider report and browser-review record.",
          },
        },
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      async run(input) {
        const value = objectInput(input);
        noExtra(value, ["auditId", "focusAreas", "maxPriorities", "detailLevel"]);
        if (value.focusAreas !== undefined && (!Array.isArray(value.focusAreas) || value.focusAreas.length < 1)) {
          throw new AuditError("INVALID_INPUT", "focusAreas must contain between 1 and 3 areas when supplied.");
        }
        const auditId = auditIdForTool(service, value.auditId);
        const report = await coherentResultsForTool(service, auditId);
        const remembered = service?.getActiveAudit?.();
        const persistedMission = remembered?.id === auditId && remembered.mission
          ? auditMissionSnapshot(remembered.mission)
          : createAuditMission({}, "agent", 0);
        const projectionMission = auditMissionSnapshot({
          ...persistedMission,
          focusAreas: value.focusAreas ?? persistedMission.focusAreas,
          maxPriorities: value.maxPriorities ?? persistedMission.maxPriorities,
        });
        const browserReview = service?.getBrowserReview?.(auditId) ?? null;
        const missionState = deriveAuditMissionState({
          report,
          mission: projectionMission,
          diagnosticMissions: service?.getDiagnosticMissions?.(auditId) ?? [],
          repairs: service?.getRepairs?.(auditId) ?? [],
          browserReview,
          explorations: service?.getSiteExplorations?.(auditId) ?? [],
        });
        const overridden = value.focusAreas !== undefined || value.maxPriorities !== undefined;
        const detailLevel = value.detailLevel === "full" ? "full" : "summary";
        const checkpoint = service?.getMissionCheckpoint?.(auditId) ?? report.missionCheckpoint ?? null;
        const projectedPriorities = detailLevel === "full"
          ? missionState.priorities
          : missionState.priorities.map(compactSummaryPriority);
        const codingAgentBrief = createCodingAgentBrief({
          report,
          priorities: missionState.priorities,
          mission: projectionMission,
        });
        return {
          ...(detailLevel === "full" ? report : compactAuditReport(report)),
          measurementStatus: "complete",
          assessmentStatus: "complete",
          checkpointStatus: "complete",
          explorationStatus: missionState.explorationStatus,
          mission: detailLevel === "full"
            ? persistedMission
            : {
                intent: persistedMission.intent,
                focusAreas: [...persistedMission.focusAreas],
                maxPriorities: persistedMission.maxPriorities,
                scope: persistedMission.scope,
              },
          requestedFocusAreas: missionState.requestedFocusAreas,
          focusSummary: {
            matchingFindingCount: missionState.matchingFindingCount,
            returnedPriorityCount: missionState.priorityCount,
            categoryScores: missionState.categoryScores,
            message: missionState.priorities.length
              ? "Ranked recommendations are deduplicated from retained public-site evidence. Automated evidence is not a complete manual audit."
              : "No supported failed rule matched this focus. Retained scores are automated evidence, not a complete manual audit.",
          },
          priorities: projectedPriorities,
          codingAgentBrief,
          ...(detailLevel === "full" ? {
            browserReview,
            missionState,
            missionCheckpoint: checkpoint,
          } : {}),
          resultProjection: {
            mode: overridden ? "read-only-override" : "persisted-mission",
            changedPersistedMission: false,
            focusAreas: missionState.requestedFocusAreas,
            maxPriorities: projectionMission.maxPriorities,
            detailLevel,
          },
          recommendedNextAction: null,
          workflow: {
            owner: "coding-agent",
            instruction: codingAgentBrief.workflow.nextStep,
            afterDeployment: codingAgentBrief.workflow.afterDeployment,
          },
        };
      },
    }),
    tool({
      name: "get_active_evidence_capsule",
      title: "Get active evidence capsule",
      description:
        "Return the compact revision-bound evidence capsule for the finding currently selected in the visible Frontmend workspace. No audit or finding ID is needed. The capsule includes the retained Lighthouse screenshot when available, viewport, route, selector or landmark, measured or attributed evidence with source, exact observation task, evidence timestamp, and audit revision. Re-read after any mission revision.",
      inputSchema: emptySchema,
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      async run(input) {
        const value = objectInput(input);
        noExtra(value, []);
        const capsule = service.getActiveEvidenceCapsule();
        const checkpoint = service.getMissionCheckpoint(capsule.auditId);
        return {
          auditId: capsule.auditId,
          workspacePath: `/audits/${encodeURIComponent(capsule.auditId)}`,
          activeSelection: true,
          capsule,
          missionCheckpoint: checkpoint,
          nextAction: checkpoint?.action ?? null,
        };
      },
    }),
    tool({
      name: "get_evidence_chain",
      title: "Get one evidence chain",
      description:
        "Return the exact retained evidence behind one recommendation, including provider or browser provenance and affected conditions. Use it when the full report is unnecessary. Historical repository contributions, if present, remain separately attributed; the response never returns source contents, patches, credentials, or deployment claims.",
      inputSchema: {
        type: "object",
        properties: {
          auditId: { type: "string", minLength: 1, maxLength: 80, description: "Optional completed audit ID; defaults to the visible audit." },
          findingId: { type: "string", minLength: 1, maxLength: 160, description: "Exact retained priority ID from get_mission_summary or full results." },
        },
        required: ["findingId"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      async run(input) {
        const value = objectInput(input);
        noExtra(value, ["auditId", "findingId"]);
        const findingId = requiredString(value.findingId, "findingId", 160);
        const projection = await missionProjectionForTool(service, value.auditId);
        if (!projection.audit || projection.audit.status !== "complete") {
          throw new AuditError("AUDIT_NOT_COMPLETE", "A completed retained assessment is required before reading an evidence chain.");
        }
        const priority = projection.missionState.priorities.find((item) => item.findingId === findingId);
        if (!priority) {
          throw new AuditError(
            "EVIDENCE_CHAIN_NOT_FOUND",
            "Choose an exact retained priority ID returned by the current mission summary.",
          );
        }
        const diagnostic = projection.diagnosticMissions
          .find((item) => item?.findingId === findingId);
        const retainedDiagnostic = diagnostic ? diagnosticMissionSnapshot(diagnostic) : null;
        const diagnosis = retainedDiagnostic?.diagnosis ?? null;
        const provider = priority.evidenceRecords?.provider ?? null;
        const browser = priority.evidenceRecords?.browser ?? null;
        const chain = retainedDiagnostic
          ? retainedDiagnostic.evidenceChain ?? diagnosticEvidenceChain(retainedDiagnostic)
          : {
              schemaVersion: 1,
              status: priority.diagnosticMissionRequired ? "awaiting-diagnosis" : "measured-evidence-retained",
              stages: [
                {
                  id: "measurement",
                  label: "Measured symptom",
                  state: provider ? "retained" : "not-observed",
                  provenance: provider ? "measured-provider" : null,
                  itemCount: provider?.findings?.length ?? 0,
                },
                {
                  id: "browser",
                  label: "Rendered observation",
                  state: browser ? "retained" : "not-observed",
                  provenance: browser?.provenance ?? null,
                  itemCount: browser?.findings?.length ?? 0,
                },
                {
                  id: "repository",
                  label: "Repository ownership",
                  state: priority.diagnosticMissionRequired ? "required" : "not-required",
                  provenance: null,
                  itemCount: 0,
                },
                {
                  id: "verification",
                  label: "Planned checks",
                  state: priority.diagnosticMissionRequired ? "required" : "available-after-review",
                  provenance: null,
                  itemCount: 0,
                },
              ],
            };
        return {
          auditId: projection.audit.id,
          finding: {
            ...compactPriority(priority),
            focusAreas: [...(priority.focusAreas ?? [])],
            evidence: priority.evidence,
            relationshipReason: priority.relationshipReason,
            unresolvedRequirement: priority.unresolvedRequirement ?? null,
          },
          evidenceChain: chain,
          evidenceSources: {
            provider: provider
              ? {
                  provider: provider.provider,
                  ruleId: provider.ruleId,
                  strategies: [...new Set((provider.findings ?? []).map((item) => item.strategy).filter(Boolean))],
                  itemCount: provider.findings?.length ?? 0,
                }
              : null,
            browser: browser
              ? {
                  provenance: browser.provenance,
                  reviewId: browser.reviewId ?? null,
                  summary: browser.summary ?? null,
                  itemCount: browser.findings?.length ?? 0,
                }
              : null,
            repository: retainedDiagnostic
              ? {
                  missionId: retainedDiagnostic.id,
                  status: chain.status,
                  sourceLocations: (diagnosis?.sourceLocations ?? []).map((location) => ({
                    file: location.file,
                    line: location.line ?? null,
                    symbol: location.symbol ?? null,
                    reason: location.reason,
                  })),
                  verificationChecks: [...(diagnosis?.verificationChecks ?? [])],
                  confidence: diagnosis?.confidence ?? null,
                }
              : null,
          },
          missionCheckpoint: projection.checkpoint,
          nextAction: priority.nextAction ?? projection.missionState.nextAction ?? null,
          authority: {
            sourceContentsReceived: false,
            repairApprovalProved: false,
            implementationProved: false,
            deploymentProved: false,
          },
        };
      },
    }),
    tool({
      name: "open_browser_review",
      title: "Open agent browser review",
      description:
        "Open the next exact rendered-browser check for assessment or fresh verification. An eligible person-started audit may be adopted without changing its attribution or ID. Frontmend returns one non-destructive task at a time; this call does not navigate, inspect source, accept findings, or claim the page passed.",
      inputSchema: {
        ...emptySchema,
        properties: {
          auditId: { type: "string", minLength: 1, description: "Optional completed audit ID; defaults to the visible audit." },
          focusAreas: {
            type: "array",
            minItems: 1,
            maxItems: 2,
            uniqueItems: true,
            items: { type: "string", enum: ["accessibility", "seo"] },
            description: "Optional accessibility or SEO scope when adopting a broad person-started assessment.",
          },
          expectedMissionRevision: expectedMissionRevisionProperty,
        },
        required: ["expectedMissionRevision"],
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async run(input) {
        const value = objectInput(input);
        noExtra(value, ["auditId", "focusAreas", "expectedMissionRevision"]);
        const auditId = auditIdForTool(service, value.auditId);
        const review = await service.openBrowserReview(
          auditId,
          { source: "agent", ...(value.focusAreas === undefined ? {} : { focusAreas: value.focusAreas }) },
          expectedMissionRevisionForTool(service, auditId, value.expectedMissionRevision),
        );
        return {
          auditId,
          browserReview: compactBrowserReview(review),
          adoption: review.adoption,
          missionCheckpoint: review.missionCheckpoint ?? service?.getMissionCheckpoint?.(auditId),
          nextAction: {
            tool: "record_browser_review_check",
            input: {
              reviewId: review.id,
              checkId: review.state.nextCheck?.id,
            },
            browserTask: review.state.nextCheck,
            reason: "Use the browser to perform this exact check, then contribute only directly observed facts.",
          },
          authority: review.authority,
        };
      },
    }),
    tool({
      name: "record_browser_review_check",
      title: "Record browser review check",
      description:
        "Record the current browser task using bounded direct observations. Search discovery may include up to eight observed same-origin paths for server revalidation. Assessment issues require structured findings; verification replay cannot create findings. Use an exact blocker when inspection cannot run honestly. Browser evidence remains separate from repository, deployment, and production proof.",
      inputSchema: {
        type: "object",
        properties: {
          auditId: { type: "string", minLength: 1, description: "Optional completed audit ID; defaults to the visible audit." },
          reviewId: { type: "string", minLength: 1, maxLength: 160, description: "Browser review ID returned by open_browser_review." },
          checkId: { type: "string", minLength: 1, maxLength: 80, description: "Exact current check ID returned by Frontmend." },
          outcome: { type: "string", enum: [...BROWSER_REVIEW_OUTCOMES], description: "passed for no issue observed, issue with structured findings, or blocked when the check cannot honestly run." },
          summary: { type: "string", minLength: 1, maxLength: 300, description: "Concise verdict grounded in the rendered browser check." },
          observations: {
            type: "array",
            minItems: 1,
            maxItems: 4,
            uniqueItems: true,
            items: { type: "string", minLength: 1, maxLength: 400 },
            description: "One to four concrete rendered-browser facts. May be omitted only for a blocked check.",
          },
          observedRoutes: {
            type: "array",
            minItems: 1,
            maxItems: 8,
            uniqueItems: true,
            items: { type: "string", pattern: "^/(?!/)[^?#]{0,255}$" },
            description: "Optional same-origin paths observed during search discovery; the server revalidates them.",
          },
          findings: {
            type: "array",
            maxItems: 3,
            items: {
              type: "object",
              properties: {
                title: { type: "string", minLength: 1, maxLength: 240 },
                severity: { type: "string", enum: ["high", "medium", "low"] },
                focusArea: { type: "string", enum: ["accessibility", "seo"] },
                evidence: { type: "string", minLength: 1, maxLength: 600 },
                suggestedRepair: { type: "string", minLength: 1, maxLength: 600 },
                element: { type: "string", minLength: 1, maxLength: 200 },
              },
              required: ["title", "severity", "focusArea", "evidence", "suggestedRepair"],
              additionalProperties: false,
            },
            description: "One to three browser-observed issues, required for an assessment issue and omitted for a verification replay of the retained finding.",
          },
          blockerReason: {
            type: "string",
            enum: [...BROWSER_REVIEW_BLOCKER_REASONS],
            description: "Exact limitation, required only when outcome is blocked.",
          },
          expectedMissionRevision: expectedMissionRevisionProperty,
        },
        required: ["reviewId", "checkId", "outcome", "summary", "expectedMissionRevision"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      async run(input) {
        const value = objectInput(input);
        noExtra(value, ["auditId", "reviewId", "checkId", "outcome", "summary", "observations", "observedRoutes", "findings", "blockerReason", "expectedMissionRevision"]);
        const auditId = auditIdForTool(service, value.auditId);
        const review = await service.recordBrowserReviewCheck(
          auditId,
          requiredString(value.reviewId, "reviewId", 160),
          {
            checkId: requiredString(value.checkId, "checkId", 80),
            outcome: value.outcome,
            summary: requiredString(value.summary, "summary", 300),
            observations: value.observations,
            observedRoutes: value.observedRoutes,
            findings: value.findings,
            blockerReason: value.blockerReason,
          },
          "agent",
          expectedMissionRevisionForTool(service, auditId, value.expectedMissionRevision),
        );
        const nextCheck = review.state.nextCheck;
        const missionCheckpoint = review.missionCheckpoint ?? service?.getMissionCheckpoint?.(auditId);
        const assessmentComplete = Boolean(service?.getAuditMissionState?.(auditId)?.assessmentComplete);
        return {
          auditId,
          browserReview: compactBrowserReview(review),
          missionCheckpoint,
          acceptedCheck: review.results.find((result) => result.checkId === value.checkId) ?? null,
          assessmentComplete,
          verificationComplete: review.purpose === "verification" && review.state.complete,
          nextAction: review.state.complete
            ? review.purpose === "verification"
              ? {
                  tool: "get_verification_receipt",
                  input: { auditId },
                  reason: "Every required exact replay and browser guardrail is complete, so Frontmend can now return the bounded verification receipt.",
                }
              : !assessmentComplete && missionCheckpoint?.action?.tool
                ? {
                    ...missionCheckpoint.action,
                    input: { auditId, ...(missionCheckpoint.action.input ?? {}) },
                  }
                : {
                    tool: "get_site_audit_results",
                    input: { auditId },
                    reason: "Re-read the combined provider and browser evidence to continue the persisted mission.",
                  }
            : {
                tool: "record_browser_review_check",
                input: { reviewId: review.id, checkId: nextCheck?.id },
                browserTask: nextCheck,
                reason: review.state.status === "blocked"
                  ? "Retry this exact check only when the named blocker is resolved; do not invent observations."
                  : "Use the browser to perform the next exact check.",
              },
          authority: review.authority,
        };
      },
    }),
    tool({
      name: "get_assessment_receipt",
      title: "Get assessment receipt",
      description:
        "Return the completed Frontmend assessment as both structured evidence and portable Markdown. The receipt freezes the final provider and browser evidence ranking, plus any later repository contribution as a separately attributed repair-preparation record. It becomes available when public audit evidence is complete; repository diagnosis is not required. It does not prove repair approval, implementation, deployment, or resolution.",
      inputSchema: {
        ...emptySchema,
        properties: {
          auditId: { type: "string", minLength: 1, description: "Optional completed assessment audit ID; defaults to the visible audit." },
        },
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      async run(input) {
        const value = objectInput(input);
        noExtra(value, ["auditId"]);
        const auditId = auditIdForTool(service, value.auditId);
        if (typeof service?.getCoherentResults === "function") {
          await service.getCoherentResults(auditId);
        }
        const receipt = service.getAssessmentReceipt(auditId);
        return {
          ...receipt,
          missionCheckpoint: service?.getMissionCheckpoint?.(auditId) ?? null,
          format: "text/markdown",
          downloadPath: `/api/audits/${encodeURIComponent(auditId)}/assessment`,
          markdown: assessmentReceiptMarkdown(receipt),
        };
      },
    }),
    tool({
      name: "get_repository_fix_brief",
      title: "Prepare repository fix brief",
      description:
        "After explicit prepare_site_repair intent, translate the selected finding or frozen package of up to three findings into a bounded source-safe implementation contract for a coding agent with repository access. It returns measured evidence, package scope, repository search hints, shared verification candidates, acceptance criteria, and authority boundaries. It does not inspect files, upload source, stage a repair, change the repository, or deploy the target.",
      inputSchema: {
        type: "object",
        properties: {
          auditId: { type: "string", minLength: 1, description: "Optional completed audit ID; defaults to the visible audit." },
          findingId: { type: "string", minLength: 1, maxLength: 160, description: "Exact finding ID from the completed report." },
          findingIds: {
            type: "array",
            minItems: 1,
            maxItems: 3,
            uniqueItems: true,
            items: { type: "string", minLength: 1, maxLength: 160 },
            description: "Optional exact prepared package; findingId must be first.",
          },
        },
        required: ["findingId"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      async run(input) {
        const value = objectInput(input);
        noExtra(value, ["auditId", "findingId", "findingIds"]);
        const auditId = auditIdForTool(service, value.auditId);
        const findingId = requiredString(value.findingId, "findingId", 160);
        const findingIds = normalizeRepairFindingIds(findingId, value.findingIds);
        const report = await coherentResultsForTool(service, auditId);
        assertPreparedRepairPackage(service, auditId, findingIds);
        const verificationCandidates = await (
          service?.getVerificationCandidates?.(auditId, findingId, findingIds) ?? null
        );
        const reportCheckpoint = report?.missionCheckpoint ?? null;
        const candidateCheckpoint = verificationCandidates?.missionCheckpoint ?? null;
        if (
          Number.isInteger(reportCheckpoint?.missionRevision)
          && Number.isInteger(candidateCheckpoint?.missionRevision)
          && reportCheckpoint.missionRevision !== candidateCheckpoint.missionRevision
        ) {
          throw new AuditError(
            "MISSION_REFRESH_UNSTABLE",
            "The mission changed while Frontmend prepared this repository brief. Read the latest brief again before acting.",
            true,
            { missionCheckpoint: service?.getMissionCheckpoint?.(auditId) ?? candidateCheckpoint },
          );
        }
        const brief = createRepositoryFixBrief(
          report,
          findingId,
          assessmentFindings(
            report,
            service?.getBrowserReview?.(auditId) ?? null,
            service?.getSiteExplorations?.(auditId) ?? [],
          ),
          verificationCandidates,
          service?.getDiagnosticMissions?.(auditId) ?? [],
        );
        return {
          ...brief,
          findingIds,
          repairPackage: {
            primaryFindingId: findingId,
            findingIds,
            findingCount: findingIds.length,
          },
          missionCheckpoint:
            candidateCheckpoint
            ?? reportCheckpoint
            ?? service?.getMissionCheckpoint?.(auditId)
            ?? null,
        };
      },
    }),
    tool({
      name: "start_related_page_audit",
      title: "Audit an observed route",
      description:
        "Start a new live audit for one same-site path observed in the visible completed report. Use an exact path from documentProfile.routes. This does not navigate during the tool call or claim that the route has already been inspected.",
      inputSchema: {
        type: "object",
        properties: {
          auditId: { type: "string", minLength: 1, description: "Optional completed audit ID; defaults to the visible audit." },
          path: { type: "string", minLength: 1, maxLength: 256, description: "Exact same-site path from documentProfile.routes." },
        },
        required: ["path"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      async run(input) {
        const value = objectInput(input);
        noExtra(value, ["auditId", "path", "expectedMissionRevision"]);
        const baselineAuditId = auditIdForTool(service, value.auditId);
        const audit = await service.startRelatedAudit(
          baselineAuditId,
          requiredString(value.path, "path", 256),
          "agent",
          expectedMissionRevisionForTool(service, baselineAuditId, value.expectedMissionRevision),
        );
        return {
          ...audit,
          baselineAuditId,
          observedPath: value.path,
          rootAuditId: audit.exploration?.rootAuditId ?? baselineAuditId,
          parentAuditId: audit.exploration?.parentAuditId ?? baselineAuditId,
          routeDepth: audit.exploration?.depth ?? 1,
          routeTrail: audit.exploration?.trail ?? [],
          workspacePath: `/audits/${encodeURIComponent(audit.id)}`,
        };
      },
    }),
    tool({
      name: "open_diagnostic_mission",
      title: "Open diagnostic mission",
      description:
        "Open an idempotent repository diagnosis for a finding selected through prepare_site_repair. Submit only observed reproduction, repository-relative ownership, and planned checks; otherwise record an exact blocker. Audit evidence stays final and separately attributed. This call does not inspect source, diagnose by itself, stage a repair, or change the target.",
      inputSchema: {
        type: "object",
        properties: {
          auditId: { type: "string", minLength: 1, description: "Optional completed audit ID; defaults to the visible audit." },
          findingId: { type: "string", minLength: 1, maxLength: 160, description: "Exact retained finding ID requested by the current mission action." },
        },
        required: ["findingId"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      async run(input) {
        const value = objectInput(input);
        noExtra(value, ["auditId", "findingId", "expectedMissionRevision"]);
        const auditId = auditIdForTool(service, value.auditId);
        const mission = await service.openDiagnosticMission(
          auditId,
          requiredString(value.findingId, "findingId", 160),
          expectedMissionRevisionForTool(service, auditId, value.expectedMissionRevision),
        );
        return {
          auditId,
          diagnosticMissionId: mission.id,
          findingId: mission.findingId,
          measuredEvidence: mission.measuredEvidence,
          evidenceChain: mission.evidenceChain ?? diagnosticEvidenceChain(mission),
          requiredInvestigations: mission.requiredInvestigations,
          state: mission.state,
          missionCheckpoint: mission.missionCheckpoint ?? service?.getMissionCheckpoint?.(auditId),
          nextAction: "Reproduce the issue in the browser, map it to repository-relative source locations, then submit the bounded diagnosis. If that evidence is genuinely unavailable or conflicts, record the exact diagnostic blocker instead. Do not include source contents or absolute paths.",
        };
      },
    }),
    tool({
      name: "submit_runtime_diagnosis",
      title: "Submit runtime diagnosis",
      description:
        "Contribute agent-reported diagnostic evidence after reproducing a retained issue in the browser and mapping it to repository ownership. Submit observations, repository-relative source locations, and exact planned checks; the returned evidenceChain makes every contributed stage and its provenance visible. Never submit source contents, credentials, private data, or absolute paths. This evidence is labelled agent-reported and does not itself approve, implement, deploy, or verify a repair.",
      inputSchema: {
        type: "object",
        properties: {
          auditId: { type: "string", minLength: 1, description: "Optional completed audit ID; defaults to the visible audit." },
          missionId: { type: "string", minLength: 1, maxLength: 80, description: "Diagnostic mission ID." },
          summary: { type: "string", minLength: 1, maxLength: 300, description: "Concise causal diagnosis." },
          reproduction: { type: "string", minLength: 1, maxLength: 600, description: "Exact browser steps and observed outcome." },
          observations: {
            type: "array", minItems: 1, maxItems: 5,
            items: {
              type: "object",
              properties: {
                kind: { type: "string", enum: ["console", "network", "interaction", "performance", "accessibility"] },
                detail: { type: "string", minLength: 1, maxLength: 400 },
              },
              required: ["kind", "detail"], additionalProperties: false,
            },
          },
          sourceLocations: {
            type: "array", minItems: 1, maxItems: 8,
            items: {
              type: "object",
              properties: {
                file: { type: "string", minLength: 1, maxLength: 200, description: "Repository-relative path only." },
                line: { type: "integer", minimum: 1, maximum: 10000000 },
                symbol: { type: "string", minLength: 1, maxLength: 120 },
                reason: { type: "string", minLength: 1, maxLength: 300 },
              },
              required: ["file", "reason"], additionalProperties: false,
            },
          },
          verificationChecks: {
            type: "array", minItems: 1, maxItems: 8, uniqueItems: true,
            items: { type: "string", minLength: 1, maxLength: 120 },
          },
          confidence: { type: "string", enum: ["low", "medium", "high"] },
        },
        required: ["missionId", "summary", "reproduction", "observations", "sourceLocations", "verificationChecks", "confidence"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      async run(input) {
        const value = objectInput(input);
        noExtra(value, ["auditId", "missionId", "summary", "reproduction", "observations", "sourceLocations", "verificationChecks", "confidence", "expectedMissionRevision"]);
        const auditId = auditIdForTool(service, value.auditId);
        const mission = await service.submitDiagnosticEvidence(
          auditId,
          requiredString(value.missionId, "missionId", 80),
          {
            summary: requiredString(value.summary, "summary", 300),
            reproduction: requiredString(value.reproduction, "reproduction", 600),
            observations: value.observations,
            sourceLocations: value.sourceLocations,
            verificationChecks: value.verificationChecks,
            confidence: value.confidence,
          },
          "agent",
          expectedMissionRevisionForTool(service, auditId, value.expectedMissionRevision),
        );
        return {
          auditId,
          diagnosticMissionId: mission.id,
          findingId: mission.findingId,
          measuredEvidence: mission.measuredEvidence,
          evidenceChain: mission.evidenceChain ?? diagnosticEvidenceChain(mission),
          diagnosis: mission.diagnosis,
          state: mission.state,
          missionCheckpoint: mission.missionCheckpoint ?? service?.getMissionCheckpoint?.(auditId),
          nextAction: "The diagnosis is ready for a separate repository repair proposal. Human review or a previously scoped auto-mode grant still controls approval.",
        };
      },
    }),
    tool({
      name: "record_diagnostic_blocker",
      title: "Record diagnostic blocker",
      description:
        "Record why a selected repair cannot currently be reproduced or mapped to repository ownership. Use this instead of inventing diagnosis when browser access, the correct repository, or matching runtime evidence is unavailable. Frontmend preserves the final audit and ranking, labels the repair blocker as agent-reported, and exposes runtime diagnosis again if access is later restored. This does not dismiss the finding, approve a repair, or claim resolution.",
      inputSchema: {
        type: "object",
        properties: {
          auditId: { type: "string", minLength: 1, description: "Optional completed audit ID; defaults to the visible audit." },
          missionId: { type: "string", minLength: 1, maxLength: 80, description: "Diagnostic mission ID." },
          reason: {
            type: "string",
            enum: [...DIAGNOSTIC_BLOCKER_REASONS],
            description: "The bounded capability or evidence conflict preventing an honest diagnosis.",
          },
          summary: {
            type: "string",
            minLength: 1,
            maxLength: 300,
            description: "A concise, non-sensitive explanation of what is unavailable or did not match.",
          },
        },
        required: ["missionId", "reason", "summary"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      async run(input) {
        const value = objectInput(input);
        noExtra(value, ["auditId", "missionId", "reason", "summary", "expectedMissionRevision"]);
        const auditId = auditIdForTool(service, value.auditId);
        const mission = await service.recordDiagnosticBlocker(
          auditId,
          requiredString(value.missionId, "missionId", 80),
          {
            reason: value.reason,
            summary: requiredString(value.summary, "summary", 300),
          },
          "agent",
          expectedMissionRevisionForTool(service, auditId, value.expectedMissionRevision),
        );
        return {
          auditId,
          diagnosticMissionId: mission.id,
          findingId: mission.findingId,
          measuredEvidence: mission.measuredEvidence,
          evidenceChain: mission.evidenceChain ?? diagnosticEvidenceChain(mission),
          blocker: mission.blocker,
          state: mission.state,
          assessmentComplete: service?.getAuditMissionState?.(auditId)?.assessmentComplete ?? true,
          repairReadiness: service?.getAuditMissionState?.(auditId)?.repairReadiness ?? null,
          missionCheckpoint: mission.missionCheckpoint ?? service?.getMissionCheckpoint?.(auditId),
          nextAction: "The finding remains unresolved and no repair can be staged from this blocker. When browser and repository access match the measured runtime, submit the bounded diagnosis to resume.",
        };
      },
    }),
    tool({
      name: "start_site_exploration",
      title: "Explore selected site routes",
      description:
        "Start a bounded multi-page exploration for one to three server-issued route candidates from the completed root audit. Each candidate becomes a separate live audit under one durable exploration ID; raw arbitrary paths are not accepted for bounded-site missions and this is not an exhaustive crawl.",
      inputSchema: {
        type: "object",
        properties: {
          auditId: { type: "string", minLength: 1, description: "Optional completed root audit ID; defaults to the visible audit." },
          routeCandidateIds: {
            type: "array",
            minItems: 1,
            maxItems: 3,
            uniqueItems: true,
            items: { type: "string", minLength: 1, maxLength: 80 },
            description: "One to three IDs from missionState.siteScope.routeCandidates.",
          },
          expectedMissionRevision: expectedMissionRevisionProperty,
        },
        required: ["routeCandidateIds", "expectedMissionRevision"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      async run(input) {
        const value = objectInput(input);
        noExtra(value, ["auditId", "routeCandidateIds", "expectedMissionRevision"]);
        const rootAuditId = auditIdForTool(service, value.auditId);
        const exploration = await service.startSiteExploration(
          rootAuditId,
          {
            routeCandidateIds: Array.isArray(value.routeCandidateIds)
              ? value.routeCandidateIds.map((id, index) => requiredString(id, `routeCandidateIds[${index}]`, 80))
              : value.routeCandidateIds,
          },
          "agent",
          expectedMissionRevisionForTool(service, rootAuditId, value.expectedMissionRevision),
        );
        return {
          ...exploration,
          explorationId: exploration.id,
          workspacePath: `/audits/${encodeURIComponent(rootAuditId)}`,
          statusPath: `/api/audits/${encodeURIComponent(rootAuditId)}/explorations/${encodeURIComponent(exploration.id)}`,
        };
      },
    }),
    tool({
      name: "get_site_exploration",
      title: "Read site exploration",
      description:
        "Read progress or aggregated cross-page evidence for a durable site exploration. Completed child pages with retained findings expose an exact renderedReview action so an agent can reconcile that selected route without implying it was already rendered. Omit missionId to use the most recent exploration attached to the visible root audit.",
      inputSchema: {
        type: "object",
        properties: {
          auditId: { type: "string", minLength: 1, description: "Optional root audit ID; defaults to the visible audit." },
          missionId: { type: "string", minLength: 1, description: "Optional exploration ID; defaults to the most recent visible exploration." },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      async run(input) {
        const value = objectInput(input);
        noExtra(value, ["auditId", "missionId"]);
        const rootAuditId = auditIdForTool(service, value.auditId);
        const missionId = value.missionId
          ? requiredString(value.missionId, "missionId", 80)
          : service.getSiteExplorations(rootAuditId)[0]?.id;
        if (!missionId) {
          throw new AuditError(
            "EXPLORATION_CONTEXT_REQUIRED",
            "Provide missionId or start a site exploration from this audit first.",
          );
        }
        const exploration = await service.getSiteExploration(rootAuditId, missionId);
        return {
          ...exploration,
          reportPath: `/api/audits/${encodeURIComponent(rootAuditId)}/explorations/${encodeURIComponent(missionId)}/report`,
        };
      },
    }),
    tool({
      name: "get_verification_receipt",
      title: "Get verification receipt",
      description:
        "Read the current reviewed verification matrix and, once every row is terminal, return its portable Markdown evidence receipt. While fresh audits or browser replays are active, the same call returns bounded progress and the exact polling action instead of pretending a receipt exists. Omit auditId to use the visible verification audit. This does not change or deploy the target site.",
      inputSchema: {
        ...emptySchema,
        properties: {
          auditId: { type: "string", minLength: 1, description: "Optional verification or baseline audit ID; defaults to the visible audit." },
          repairId: { type: "string", minLength: 1, maxLength: 80, description: "Optional repair ID for its aggregate reviewed-matrix receipt." },
        },
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      async run(input) {
        const value = objectInput(input);
        noExtra(value, ["auditId", "repairId"]);
        const auditId = auditIdForTool(service, value.auditId);
        const repairId = optionalString(value.repairId, "repairId", 80);
        if (repairId) {
          const aggregate = await service.getRepairVerification(auditId, repairId);
          if (!aggregate.receiptAvailable) {
            return {
              auditId,
              repairId,
              status: aggregate.status,
              receiptAvailable: false,
              matrix: aggregate,
              nextAction: createExecutableMissionAction(
                {
                  tool: "get_verification_receipt",
                  input: { repairId },
                  reason: "Fresh verification is still active; read this reviewed matrix again after the bounded polling delay.",
                },
                { id: auditId, missionRevision: aggregate.missionCheckpoint?.missionRevision },
              ),
              missionCheckpoint: aggregate.missionCheckpoint ?? service?.getMissionCheckpoint?.(auditId) ?? null,
            };
          }
          return {
            auditId,
            repairId,
            status: aggregate.status,
            receiptAvailable: true,
            matrix: aggregate,
            format: "text/markdown",
            downloadPath: `/api/audits/${encodeURIComponent(auditId)}/repairs/${encodeURIComponent(repairId)}/verification/receipt`,
            receipt: repairVerificationReceiptMarkdown(aggregate),
          };
        }
        const report = await coherentResultsForTool(service, auditId);
        return {
          auditId,
          status: report.verification?.status,
          findingScope: report.verification?.findingScope,
          scopeOutcomes: report.verification?.scopeOutcomes,
          repositoryPlan: report.verification?.repositoryPlan,
          format: "text/markdown",
          downloadPath: `/api/audits/${encodeURIComponent(auditId)}/receipt`,
          receipt: verificationReceiptMarkdown(report),
        };
      },
    }),
    tool({
      name: "prepare_site_repair",
      title: "Prepare site repair",
      description:
        "Record that the person explicitly asked to prepare one assessed finding or a cohesive package of up to three assessed findings. Call this only after that explicit request. It freezes the exact ordered finding IDs and enables one bounded repair proposal when required diagnoses are ready; it is not approval, does not consume auto-mode allowance, accepts no plan or code, and cannot implement, deploy, or attest anything.",
      inputSchema: {
        type: "object",
        properties: {
          auditId: { type: "string", minLength: 1, description: "Optional completed audit ID; defaults to the visible audit." },
          findingId: { type: "string", minLength: 1, maxLength: 160, description: "Exact retained finding the person asked to prepare for repair." },
          findingIds: {
            type: "array",
            minItems: 1,
            maxItems: 3,
            uniqueItems: true,
            items: { type: "string", minLength: 1, maxLength: 160 },
            description: "Optional exact ordered package; findingId must be first. Omit for a one-finding repair.",
          },
        },
        required: ["findingId"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      async run(input) {
        const value = objectInput(input);
        noExtra(value, ["auditId", "findingId", "findingIds", "expectedMissionRevision"]);
        const auditId = auditIdForTool(service, value.auditId);
        const findingId = requiredString(value.findingId, "findingId", 160);
        const findingIds = normalizeRepairFindingIds(findingId, value.findingIds);
        const expectedMissionRevision = expectedMissionRevisionForTool(service, auditId, value.expectedMissionRevision);
        const prepared = await (findingIds.length > 1
          ? service.prepareRepair(auditId, findingId, "agent", expectedMissionRevision, findingIds)
          : service.prepareRepair(auditId, findingId, "agent", expectedMissionRevision));
        return {
          auditId,
          findingId,
          findingIds,
          mission: prepared.mission,
          missionState: prepared.missionState,
          workspacePath: `/audits/${encodeURIComponent(auditId)}`,
          nextAction: prepared.missionState?.nextAction ?? null,
          missionCheckpoint: prepared.missionCheckpoint ?? service?.getMissionCheckpoint?.(auditId),
          authority: {
            recordedIntentOnly: true,
            approved: false,
            implemented: false,
            deployed: false,
          },
        };
      },
    }),
    tool({
      name: "stage_site_repair",
      title: "Stage site repair",
      description:
        "Submit one bounded repository repair mission for the exact frozen one-to-three-finding package, retaining every measured strategy, diagnosis, and reviewed verification row plus optional source-safe repository-relative files and checks. Multi-finding packages always wait for explicit review; a one-finding eligible low-risk HTML or CSS mission may consume an existing human auto grant. This never changes the target site, deploys, or bypasses person-only deployment attestation.",
      inputSchema: {
        type: "object",
        properties: {
          auditId: { type: "string", minLength: 1, description: "Optional completed audit ID; defaults to the visible audit." },
          findingId: { type: "string", minLength: 1, description: "Finding ID from the completed report." },
          findingIds: {
            type: "array",
            minItems: 1,
            maxItems: 3,
            uniqueItems: true,
            items: { type: "string", minLength: 1, maxLength: 160 },
            description: "Optional exact prepared package; findingId must be first. Omit for a one-finding repair.",
          },
          summary: { type: "string", minLength: 1, maxLength: 300, description: "Concise implementation rationale." },
          patchType: {
            type: "string",
            enum: ["html", "css", "javascript", "headers", "configuration", "guidance"],
            description: "Kind of source change being proposed.",
          },
          patch: { type: "string", minLength: 1, maxLength: 1200, description: "Reviewable code or implementation guidance." },
          verificationPlan: { type: "string", minLength: 1, maxLength: 500, description: "How to prove the finding changed after deployment." },
          risk: { type: "string", enum: ["low", "medium", "high"], description: "Implementation risk requiring review." },
          repositoryFiles: {
            type: "array",
            minItems: 1,
            maxItems: 8,
            uniqueItems: true,
            items: { type: "string", minLength: 1, maxLength: 200 },
            description: "Optional repository-relative files the coding agent plans to change; no absolute paths or source contents.",
          },
          repositoryChecks: {
            type: "array",
            minItems: 1,
            maxItems: 8,
            uniqueItems: true,
            items: { type: "string", minLength: 1, maxLength: 120 },
            description: "Optional checks the coding agent plans to run before reporting implementation.",
          },
          verificationTargetIds: {
            type: "array",
            maxItems: 3,
            uniqueItems: true,
            items: { type: "string", minLength: 1, maxLength: 180 },
            description: "Optional server-issued audited-route candidate IDs from get_repository_fix_brief.",
          },
        },
        required: ["findingId"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      async run(input) {
        const value = objectInput(input);
        noExtra(value, ["auditId", "findingId", "findingIds", "summary", "patchType", "patch", "verificationPlan", "risk", "repositoryFiles", "repositoryChecks", "verificationTargetIds", "expectedMissionRevision"]);
        const auditId = auditIdForTool(service, value.auditId);
        const findingId = requiredString(value.findingId, "findingId", 160);
        const findingIds = normalizeRepairFindingIds(findingId, value.findingIds);
        const patchTypes = ["html", "css", "javascript", "headers", "configuration", "guidance"];
        const risks = ["low", "medium", "high"];
        if (value.patchType !== undefined && !patchTypes.includes(value.patchType)) {
          throw new AuditError("INVALID_INPUT", "patchType is not supported.");
        }
        if (value.risk !== undefined && !risks.includes(value.risk)) {
          throw new AuditError("INVALID_INPUT", "risk is not supported.");
        }
        const repair = await service.stageRepair(
          auditId,
          {
            findingId,
            findingIds,
            source: "agent",
            summary: optionalString(value.summary, "summary", 300),
            patchType: value.patchType,
            patch: optionalString(value.patch, "patch", 1200),
            verificationPlan: optionalString(value.verificationPlan, "verificationPlan", 500),
            risk: value.risk,
            repositoryFiles: value.repositoryFiles,
            repositoryChecks: value.repositoryChecks,
            verificationTargetIds: optionalVerificationTargetIds(value.verificationTargetIds),
          },
          expectedMissionRevisionForTool(service, auditId, value.expectedMissionRevision),
        );
        return {
          auditId,
          repairId: repair.id,
          findingId: repair.findingId,
          findingIds: repair.findingIds ?? [repair.findingId],
          findingPackage: repair.findingPackage ?? null,
          status: repair.status,
          revision: repair.revision ?? 1,
          summary: repair.summary,
          patchType: repair.patchType,
          risk: repair.risk,
          findingScope: repair.findingScope,
          repositoryPlan: repair.repositoryPlan,
          diagnosticMission: repair.diagnosticMission ?? null,
          requiresHumanReview: repair.requiresHumanReview,
          approval: repair.approval,
          automation: repair.automation,
          verificationImpact: repair.verificationImpact,
          verificationCandidates: repair.verificationImpact?.candidates ?? [],
          mission: repair.mission ?? repairMissionState(repair),
          missionCheckpoint: repair.missionCheckpoint ?? service?.getMissionCheckpoint?.(auditId),
          nextAction: repair.status === "approved" && repair.approval?.mode === "delegated-auto"
            ? "This low-risk mission was auto-authorised by the person's prior scoped grant. Implement the reviewed repository plan, run its checks, and record the implementation receipt."
            : "Ask the person to review and approve the visible draft in Frontmend.",
        };
      },
    }),
    tool({
      name: "revise_site_repair",
      title: "Revise site repair",
      description:
        "Submit a complete revised repair proposal only after a person requested changes in the visible Frontmend review interface. The coding agent may attach or revise bounded repository-relative target files and planned checks, but never source contents or absolute paths. Omit auditId to use the visible audit. This cannot approve the revision, attest deployment, or change the target site.",
      inputSchema: {
        type: "object",
        properties: {
          auditId: { type: "string", minLength: 1, description: "Optional completed audit ID; defaults to the visible audit." },
          repairId: { type: "string", minLength: 1, description: "Repair ID with a pending human change request." },
          summary: { type: "string", minLength: 1, maxLength: 300, description: "Revised implementation rationale addressing the feedback." },
          patchType: {
            type: "string",
            enum: ["html", "css", "javascript", "headers", "configuration", "guidance"],
            description: "Kind of source change in the revised proposal.",
          },
          patch: { type: "string", minLength: 1, maxLength: 1200, description: "Complete revised code or implementation guidance." },
          verificationPlan: { type: "string", minLength: 1, maxLength: 500, description: "Revised plan for proving the exact finding changed." },
          risk: { type: "string", enum: ["low", "medium", "high"], description: "Reassessed implementation risk." },
          repositoryFiles: {
            type: "array",
            minItems: 1,
            maxItems: 8,
            uniqueItems: true,
            items: { type: "string", minLength: 1, maxLength: 200 },
            description: "Optional revised repository-relative files; no absolute paths or source contents.",
          },
          repositoryChecks: {
            type: "array",
            minItems: 1,
            maxItems: 8,
            uniqueItems: true,
            items: { type: "string", minLength: 1, maxLength: 120 },
            description: "Optional revised repository checks planned before implementation is reported.",
          },
          verificationTargetIds: {
            type: "array",
            maxItems: 3,
            uniqueItems: true,
            items: { type: "string", minLength: 1, maxLength: 180 },
            description: "Optional replacement set of server-issued audited-route candidate IDs.",
          },
        },
        required: ["repairId", "summary", "patchType", "patch", "verificationPlan", "risk"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      async run(input) {
        const value = objectInput(input);
        noExtra(value, ["auditId", "repairId", "summary", "patchType", "patch", "verificationPlan", "risk", "repositoryFiles", "repositoryChecks", "verificationTargetIds", "expectedMissionRevision"]);
        const patchTypes = ["html", "css", "javascript", "headers", "configuration", "guidance"];
        const risks = ["low", "medium", "high"];
        if (!patchTypes.includes(value.patchType)) {
          throw new AuditError("INVALID_INPUT", "patchType is not supported.");
        }
        if (!risks.includes(value.risk)) {
          throw new AuditError("INVALID_INPUT", "risk is not supported.");
        }
        const auditId = auditIdForTool(service, value.auditId);
        const repairId = requiredString(value.repairId, "repairId", 80);
        const repair = await service.reviseRepair(
          auditId,
          repairId,
          {
            summary: requiredString(value.summary, "summary", 300),
            patchType: value.patchType,
            patch: requiredString(value.patch, "patch", 1200),
            verificationPlan: requiredString(value.verificationPlan, "verificationPlan", 500),
            risk: value.risk,
            repositoryFiles: value.repositoryFiles,
            repositoryChecks: value.repositoryChecks,
            verificationTargetIds: optionalVerificationTargetIds(value.verificationTargetIds),
          },
          expectedMissionRevisionForTool(service, auditId, value.expectedMissionRevision),
        );
        return {
          auditId,
          repairId: repair.id,
          findingId: repair.findingId,
          status: repair.status,
          revision: repair.revision,
          summary: repair.summary,
          patchType: repair.patchType,
          risk: repair.risk,
          findingScope: repair.findingScope,
          repositoryPlan: repair.repositoryPlan,
          verificationImpact: repair.verificationImpact,
          verificationCandidates: repair.verificationImpact?.candidates ?? [],
          requiresHumanReview: true,
          mission: repair.mission ?? repairMissionState(repair),
          missionCheckpoint: repair.missionCheckpoint ?? service?.getMissionCheckpoint?.(auditId),
          nextAction: "Ask the person to review the revised proposal in Frontmend.",
        };
      },
    }),
    tool({
      name: "get_repair_workspace",
      title: "Get repair workspace",
      description:
        "Read repair drafts, their frozen measured-rule scope, human-review status, and the external deployment handoff for a completed audit. Omit auditId to use the visible audit. This does not stage, approve, attest deployment, export, or verify a repair.",
      inputSchema: {
        type: "object",
        properties: {
          auditId: { type: "string", minLength: 1, description: "Optional completed audit ID; defaults to the visible audit." },
          repairId: { type: "string", minLength: 1, description: "Optional repair ID to inspect in detail." },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      async run(input) {
        const value = objectInput(input);
        noExtra(value, ["auditId", "repairId"]);
        const auditId = auditIdForTool(service, value.auditId);
        const repairId = optionalString(value.repairId, "repairId", 80);
        const workspace = await service.listRepairs(auditId);
        const repairs = repairId
          ? workspace.repairs.filter((repair) => repair.id === repairId)
          : workspace.repairs;
        if (repairId && !repairs.length) {
          throw new AuditError("REPAIR_NOT_FOUND", "That repair draft does not exist.");
        }
        return {
          auditId,
          policy: workspace.policy ?? service.getRepairPolicy?.(auditId),
          missionCheckpoint: workspace.missionCheckpoint ?? service?.getMissionCheckpoint?.(auditId) ?? null,
          repairs: repairs.map((repair) => ({
            id: repair.id,
            findingId: repair.findingId,
            findingTitle: repair.findingTitle,
            findingScope: repair.findingScope,
            repositoryPlan: repair.repositoryPlan,
            diagnosticMission: repair.diagnosticMission ?? null,
            status: repair.status,
            revision: repair.revision ?? 1,
            source: repair.source,
            summary: repair.summary,
            patchType: repair.patchType,
            patch: repairId ? repair.patch.slice(0, 900) : undefined,
            patchTruncated: repairId ? repair.patch.length > 900 : undefined,
            verificationPlan: repairId ? repair.verificationPlan : undefined,
            risk: repair.risk,
            requiresHumanReview: repair.requiresHumanReview,
            approval: repair.approval,
            automation: repair.automation,
            verificationImpact: repair.verificationImpact ?? null,
            verificationCandidates: repair.verificationImpact?.candidates ?? [],
            verificationRun: repair.verificationRun ?? null,
            aggregateVerification: repair.aggregateVerification ?? null,
            reviewedAt: repair.reviewedAt,
            implementationReceipt: repair.implementationReceipt
              ? {
                  revision: repair.implementationReceipt.revision ?? 1,
                  summary: repair.implementationReceipt.summary,
                  files: repair.implementationReceipt.files,
                  checks: repair.implementationReceipt.checks,
                  commitSha: repair.implementationReceipt.commitSha,
                  source: repair.implementationReceipt.source,
                  reportedAt: repair.implementationReceipt.reportedAt,
                  sourceChangedByFrontmend: false,
                }
              : null,
            implementationHistory: (repair.implementationHistory ?? []).slice(-5).map((receipt) => ({
              revision: receipt.revision ?? 1,
              summary: receipt.summary,
              files: receipt.files,
              checks: receipt.checks,
              commitSha: receipt.commitSha,
              source: receipt.source,
              reportedAt: receipt.reportedAt,
              sourceChangedByFrontmend: false,
            })),
            candidateReview: repair.candidateReview
              ? candidateReviewSnapshot(repair.candidateReview, repair.candidateReviewHistory)
              : null,
            candidateCorrectionPacket: candidateCorrectionPacket(repair),
            candidateReviewHistory: (repair.candidateReviewHistory ?? []).slice(-3).map((review) => ({
              id: review.id,
              repairRevision: review.repairRevision,
              implementationReceiptRevision: review.implementationReceiptRevision,
              candidateOrigin: review.candidateOrigin,
              status: candidateReviewSnapshot(review).status,
              updatedAt: review.updatedAt,
            })),
            deploymentAttestedAt: repair.deploymentAttestedAt,
            changeRequest: repair.changeRequest
              ? {
                  feedback: repair.changeRequest.feedback,
                  requestedAt: repair.changeRequest.requestedAt,
                }
              : null,
            revisionHistory: (repair.revisionHistory ?? []).slice(-5).map((revision) => ({
              revision: revision.revision,
              summary: revision.summary,
              source: revision.source,
              createdAt: revision.createdAt,
              repositoryPlan: revision.repositoryPlan,
              changeRequest: revision.changeRequest
                ? {
                    feedback: revision.changeRequest.feedback,
                    requestedAt: revision.changeRequest.requestedAt,
                  }
                : null,
            })),
            mission: repair.mission ?? repairMissionState(repair),
          })),
        };
      },
    }),
    tool({
      name: "open_candidate_review",
      title: "Open candidate browser review",
      description:
        "Open an optional pre-deployment browser preflight after an approved repair has a latest repository implementation receipt whose checks all passed. Supply only a localhost or public HTTPS origin; Frontmend maps retained server-issued routes onto it and returns the first exact task. The tool never fetches, navigates, audits, inspects source, deploys, or claims production resolution. Use your own visual browser controls, then record each task sequentially.",
      inputSchema: {
        type: "object",
        properties: {
          auditId: { type: "string", minLength: 1, maxLength: 80, description: "Optional baseline audit ID; defaults to the visible audit." },
          repairId: { type: "string", minLength: 1, maxLength: 80, description: "Approved repair with a passing latest implementation receipt." },
          candidateOrigin: {
            type: "string",
            minLength: 1,
            maxLength: 2048,
            description: "Origin only, such as localhost or a public HTTPS preview. Paths, credentials, queries, fragments, private LAN hosts, and unsafe schemes are rejected.",
          },
        },
        required: ["repairId", "candidateOrigin"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      async run(input) {
        const value = objectInput(input);
        noExtra(value, ["auditId", "repairId", "candidateOrigin", "expectedMissionRevision"]);
        const auditId = auditIdForTool(service, value.auditId);
        const repair = await service.openCandidateReview(
          auditId,
          requiredString(value.repairId, "repairId", 80),
          requiredString(value.candidateOrigin, "candidateOrigin", 2_048),
          "agent",
          expectedMissionRevisionForTool(service, auditId, value.expectedMissionRevision),
        );
        const review = candidateReviewSnapshot(repair.candidateReview, repair.candidateReviewHistory);
        return {
          auditId,
          repairId: repair.id,
          reviewId: review.id,
          status: review.status,
          review,
          nextTask: review.nextTask,
          browserTargetUrl: review.browserTargetUrl,
          requiredCapabilities: review.requiredCapabilities,
          evidenceBoundary: review.evidenceBoundary,
          missionCheckpoint: repair.missionCheckpoint ?? service?.getMissionCheckpoint?.(auditId),
        };
      },
    }),
    tool({
      name: "record_candidate_review_check",
      title: "Record candidate browser check",
      description:
        "Record the current candidate-browser task from direct observations. Results are sequential and bounded. Use issue when the symptom remains or a guardrail regresses; the first issue ends this iteration and returns a revision-bound correction packet. Use an exact blocker when inspection cannot finish. Candidate checks cannot create findings or production evidence.",
      inputSchema: {
        type: "object",
        properties: {
          auditId: { type: "string", minLength: 1, maxLength: 80, description: "Optional baseline audit ID; defaults to the visible audit." },
          repairId: { type: "string", minLength: 1, maxLength: 80 },
          reviewId: { type: "string", minLength: 1, maxLength: 160 },
          checkId: { type: "string", minLength: 1, maxLength: 80, description: "Exact current check ID returned by Frontmend." },
          outcome: { type: "string", enum: BROWSER_REVIEW_OUTCOMES },
          summary: { type: "string", minLength: 1, maxLength: 300 },
          observations: {
            type: "array",
            minItems: 1,
            maxItems: 4,
            uniqueItems: true,
            items: { type: "string", minLength: 1, maxLength: 400 },
            description: "One to four direct candidate-browser observations. Omit only for a blocked result.",
          },
          blockerReason: { type: "string", enum: BROWSER_REVIEW_BLOCKER_REASONS },
        },
        required: ["repairId", "reviewId", "checkId", "outcome", "summary"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      async run(input) {
        const value = objectInput(input);
        noExtra(value, ["auditId", "repairId", "reviewId", "checkId", "outcome", "summary", "observations", "blockerReason", "expectedMissionRevision"]);
        if (!BROWSER_REVIEW_OUTCOMES.includes(value.outcome)) {
          throw new AuditError("INVALID_INPUT", "outcome must be passed, issue, or blocked.");
        }
        if (value.outcome !== "blocked" && (!Array.isArray(value.observations) || !value.observations.length)) {
          throw new AuditError("INVALID_INPUT", "observations must contain direct browser facts for passed or issue outcomes.");
        }
        const auditId = auditIdForTool(service, value.auditId);
        const checkId = requiredString(value.checkId, "checkId", 80);
        const repair = await service.recordCandidateReviewCheck(
          auditId,
          requiredString(value.repairId, "repairId", 80),
          requiredString(value.reviewId, "reviewId", 160),
          {
            checkId,
            outcome: value.outcome,
            summary: requiredString(value.summary, "summary", 300),
            observations: value.observations,
            blockerReason: value.blockerReason,
          },
          "agent",
          expectedMissionRevisionForTool(service, auditId, value.expectedMissionRevision),
        );
        const review = candidateReviewSnapshot(repair.candidateReview, repair.candidateReviewHistory);
        const correctionPacket = candidateCorrectionPacket(repair);
        return {
          auditId,
          repairId: repair.id,
          reviewId: review.id,
          acceptedResult: review.results.find((result) => result.checkId === checkId) ?? null,
          status: review.status,
          reviewSummary: review.state,
          nextTask: review.nextTask,
          browserTargetUrl: review.browserTargetUrl,
          requiredCapabilities: review.requiredCapabilities,
          evidenceBoundary: review.evidenceBoundary,
          correctionPacket,
          nextAction: review.nextAction,
          missionCheckpoint: repair.missionCheckpoint ?? service?.getMissionCheckpoint?.(auditId),
        };
      },
    }),
    tool({
      name: "get_candidate_review",
      title: "Get candidate browser review",
      description:
        "Read the current optional candidate-browser preflight for a repair, including attributed bounded results, up to three previous iterations, and the next exact action. This is a read-only candidate evidence view and never claims deployment or production resolution.",
      inputSchema: {
        type: "object",
        properties: {
          auditId: { type: "string", minLength: 1, maxLength: 80, description: "Optional baseline audit ID; defaults to the visible audit." },
          repairId: { type: "string", minLength: 1, maxLength: 80 },
        },
        required: ["repairId"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      async run(input) {
        const value = objectInput(input);
        noExtra(value, ["auditId", "repairId"]);
        const auditId = auditIdForTool(service, value.auditId);
        const repair = await service.loadCandidateReview(
          auditId,
          requiredString(value.repairId, "repairId", 80),
        );
        if (!repair.candidateReview?.id) {
          throw new AuditError("CANDIDATE_REVIEW_NOT_FOUND", "That repair does not have a candidate browser review.");
        }
        const review = candidateReviewSnapshot(repair.candidateReview, repair.candidateReviewHistory);
        const correctionPacket = candidateCorrectionPacket(repair);
        return {
          auditId,
          repairId: repair.id,
          reviewId: review.id,
          status: review.status,
          results: review.results,
          historySummary: review.historySummary,
          nextTask: review.nextTask,
          browserTargetUrl: review.browserTargetUrl,
          requiredCapabilities: review.requiredCapabilities,
          evidenceBoundary: review.evidenceBoundary,
          correctionPacket,
          nextAction: review.nextAction,
          missionCheckpoint: repair.missionCheckpoint ?? service?.getMissionCheckpoint?.(auditId),
        };
      },
    }),
    tool({
      name: "record_repository_implementation",
      title: "Record repository implementation",
      description:
        "Record a bounded receipt after a coding agent implements a human-approved repair in the repository. It accepts only repository-relative filenames, check outcomes, and an optional Git object ID. Failed or not-run checks remain visible and keep the implementation step from appearing complete. This does not inspect or upload source, change files, approve the repair, attest deployment, or claim the public result is fixed.",
      inputSchema: {
        type: "object",
        properties: {
          auditId: { type: "string", minLength: 1, description: "Optional completed audit ID; defaults to the visible audit." },
          repairId: { type: "string", minLength: 1, description: "Human-approved repair ID." },
          summary: { type: "string", minLength: 1, maxLength: 300, description: "What the coding agent changed." },
          files: {
            type: "array",
            minItems: 1,
            maxItems: 8,
            uniqueItems: true,
            items: { type: "string", minLength: 1, maxLength: 200 },
            description: "Repository-relative changed file paths only; no source contents or absolute paths.",
          },
          checks: {
            type: "array",
            minItems: 1,
            maxItems: 8,
            items: {
              type: "object",
              properties: {
                name: { type: "string", minLength: 1, maxLength: 120 },
                status: { type: "string", enum: ["passed", "failed", "not-run"] },
              },
              required: ["name", "status"],
              additionalProperties: false,
            },
          },
          commitSha: { type: "string", minLength: 7, maxLength: 64, pattern: "^[0-9a-fA-F]+$" },
        },
        required: ["repairId", "summary", "files", "checks"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async run(input) {
        const value = objectInput(input);
        noExtra(value, ["auditId", "repairId", "summary", "files", "checks", "commitSha", "expectedMissionRevision"]);
        const auditId = auditIdForTool(service, value.auditId);
        const repair = await service.recordImplementation(
          auditId,
          requiredString(value.repairId, "repairId", 80),
          {
            summary: requiredString(value.summary, "summary", 300),
            files: value.files,
            checks: value.checks,
            commitSha: optionalString(value.commitSha, "commitSha", 64),
          },
          expectedMissionRevisionForTool(service, auditId, value.expectedMissionRevision),
        );
        const mission = repair.mission ?? repairMissionState(repair);
        const nextAction = mission.implementationEvidence === "checks-passed"
          ? "The agent-reported checks passed. Candidate browser review is now available as a recommended preflight; the site owner may still deploy externally at any time and production remains unverified until the existing public verification flow completes."
          : mission.implementationEvidence === "checks-failed"
            ? "One or more agent-reported checks failed. Correct the implementation and record a new receipt, or leave the failure visible for the site owner to assess before deployment."
            : "One or more repository checks were not run. Run them and record a new receipt, or leave the incomplete evidence visible for the site owner to assess before deployment.";
        return {
          auditId,
          repairId: repair.id,
          status: repair.status,
          implementationReceipt: repair.implementationReceipt,
          mission,
          missionCheckpoint: repair.missionCheckpoint ?? service?.getMissionCheckpoint?.(auditId),
          nextAction,
        };
      },
    }),
    tool({
      name: "start_repair_verification",
      title: "Start repair verification",
      description:
        "Start a fresh live audit only after a person approved the repair and attested in the visible UI that it was deployed externally. Omit auditId to use the visible baseline audit. It never changes the target site or navigates during the tool call. Follow the returned workspace path, poll its audit ID, and inspect the comparison result when complete.",
      inputSchema: {
        type: "object",
        properties: {
          auditId: { type: "string", minLength: 1, description: "Optional baseline audit ID; defaults to the visible audit." },
          repairId: { type: "string", minLength: 1, description: "Human-approved repair draft ID." },
        },
        required: ["repairId"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      async run(input) {
        const value = objectInput(input);
        noExtra(value, ["auditId", "repairId", "expectedMissionRevision"]);
        const auditId = auditIdForTool(service, value.auditId);
        const audit = await service.startVerification(
          auditId,
          requiredString(value.repairId, "repairId", 80),
          expectedMissionRevisionForTool(service, auditId, value.expectedMissionRevision),
        );
        return {
          ...audit,
          missionCheckpoint: audit.missionCheckpoint ?? service?.getMissionCheckpoint?.(auditId),
          workspacePath: `/audits/${encodeURIComponent(audit.id)}`,
        };
      },
    }),
  ];
  return tools.map((definition) => {
    const execute = definition.execute;
    const requiresCheckpoint = checkpointedMutationTools.has(definition.name);
    const inputSchema = requiresCheckpoint
      ? {
          ...definition.inputSchema,
          properties: {
            ...(definition.inputSchema?.properties ?? {}),
            expectedMissionRevision: expectedMissionRevisionProperty,
          },
          required: [...new Set([...(definition.inputSchema?.required ?? []), "expectedMissionRevision"])],
        }
      : definition.inputSchema;
    return {
      ...definition,
      inputSchema,
      async execute(input, options = {}) {
        let activityId = null;
        const auditIdBefore = activeAuditId(service, null, input);
        const checkpointBefore = safeCheckpoint(service, auditIdBefore, null);
        const activeToolCountBefore = activeToolNames(service).length;
        try {
          activityId = service.beginAgentActivity?.({
            tool: definition.name,
            title: definition.title,
            auditId: auditIdBefore,
            missionRevisionBefore: checkpointBefore?.missionRevision ?? 0,
            operationKind: definition.annotations?.readOnlyHint === true ? "read" : "mutation",
            activeToolCountBefore,
          }) ?? null;
        } catch {
          activityId = null;
        }
        let result;
        try {
          assertCurrentContextualTool(service, definition.name, options?.frontmendRegistration);
          result = await execute(input, options);
        } catch (error) {
          result = await safely(() => { throw error; });
        }
        const protocol = protocolEnvelope(service, result, input);
        const response = { ...result, protocol };
        if (activityId) {
          const data = result?.data;
          try {
            const auditId = activityAuditId(service, result, input, auditIdBefore);
            const checkpointAfter = safeCheckpoint(service, auditId, result);
            await service.finishAgentActivity?.(activityId, {
              status: result?.ok ? "succeeded" : "failed",
              auditId,
              repairId: data?.repairId,
              diagnosticMissionId: data?.diagnosticMissionId
                ?? data?.diagnosticMission?.id
                ?? (["open_diagnostic_mission", "submit_runtime_diagnosis", "record_diagnostic_blocker"].includes(definition.name)
                  ? data?.mission?.id ?? input?.missionId
                  : null),
              browserReviewId: data?.browserReviewId ?? data?.browserReview?.id ?? input?.reviewId,
              explorationId: data?.explorationId
                ?? (["start_site_exploration", "get_site_exploration"].includes(definition.name)
                  ? data?.missionId ?? data?.id ?? input?.missionId
                  : null),
              errorCode: result?.error?.code,
              missionRevisionAfter: checkpointAfter?.missionRevision
                ?? checkpointBefore?.missionRevision
                ?? 0,
              activeToolCountAfter: protocol.activeToolCount,
              outputCharacters: serializedCharacterCount(response),
              nextTool: protocol.next?.tool ?? null,
            });
          } catch {
            // Activity telemetry never changes the semantic tool result.
          }
        }
        return response;
      },
    };
  });
}

export function getModelContext(target = globalThis.document) {
  const candidate = target?.modelContext;
  return typeof candidate?.registerTool === "function" ? candidate : null;
}

export function registerFrontmendTools({ service, target, onStatus, toolNames }) {
  const modelContext = getModelContext(target);
  const allTools = createFrontmendTools(service);
  const requestedNames = toolNames ? new Set(toolNames) : null;
  const tools = requestedNames
    ? allTools.filter((definition) => requestedNames.has(definition.name))
    : allTools;
  const statusBase = {
    supported: Boolean(modelContext),
    totalTools: allTools.length,
    activeTools: tools.length,
    toolsetRevision: toolsetRevision(service),
  };
  if (!modelContext) {
    onStatus?.({ ...statusBase, status: "unsupported", toolNames: [], errors: [] });
    const dispose = () => {};
    dispose.ready = Promise.resolve();
    return dispose;
  }

  const controller = new AbortController();
  const registered = [];
  const errors = [];
  const registration = Object.freeze({
    enforceContextualAvailability: true,
    toolsetRevision: statusBase.toolsetRevision,
  });
  onStatus?.({ ...statusBase, status: "registering", toolNames: [], errors: [] });

  // Defer the first registration by one microtask so React Strict Mode can run
  // its development-only setup/cleanup probe without leaving duplicate tools.
  const ready = Promise.resolve().then(async () => {
    if (controller.signal.aborted) return;

    for (const definition of tools) {
      if (controller.signal.aborted) return;
      try {
        const registeredDefinition = {
          ...definition,
          execute(input, options = {}) {
            return definition.execute(input, { ...options, frontmendRegistration: registration });
          },
        };
        await modelContext.registerTool(registeredDefinition, { signal: controller.signal });
        if (controller.signal.aborted) return;
        registered.push(definition.name);
      } catch (error) {
        if (controller.signal.aborted) return;
        errors.push(`${definition.name}: ${registrationErrorMessage(error)}`);
      }
    }

    if (controller.signal.aborted) return;
    onStatus?.({
      ...statusBase,
      status: errors.length ? "error" : "ready",
      toolNames: registered,
      errors,
    });
  });

  const dispose = () => controller.abort();
  dispose.ready = ready;
  return dispose;
}
