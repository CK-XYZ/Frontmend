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
  findingRequiresDiagnosticMission,
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
  REVISION_BOUND_MISSION_TOOLS,
  createExecutableMissionAction,
} from "./mission-checkpoint-contract.js";
import {
  FRONTMEND_PROTOCOL_VERSION,
  FRONTMEND_TOOL_COUNT,
  FRONTMEND_TOOL_LIBRARY_VERSION,
} from "./protocol-contract.js";

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

const TOOL_CAPABILITIES = Object.freeze({
  start_site_audit: "public-url-selection",
  check_site_audit_progress: "progress-reading",
  get_mission_summary: "mission-reading",
  get_site_audit_results: "full-evidence-reading",
  get_evidence_chain: "evidence-reading",
  open_browser_review: "rendered-browser-inspection",
  record_browser_review_check: "rendered-browser-inspection",
  open_diagnostic_mission: "repository-diagnosis",
  submit_runtime_diagnosis: "repository-diagnosis",
  record_diagnostic_blocker: "repository-diagnosis",
  start_site_exploration: "bounded-site-measurement",
  stage_site_repair: "repository-repair-planning",
  revise_site_repair: "repository-repair-planning",
  record_repository_implementation: "repository-implementation",
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

function protocolEnvelope(service, result, input) {
  const auditId = activeAuditId(service, result, input);
  const checkpoint = safeCheckpoint(service, auditId, result);
  const activeAudit = service?.getActiveAudit?.();
  const missionRevision = Number.isInteger(checkpoint?.missionRevision)
    ? checkpoint.missionRevision
    : Number.isInteger(activeAudit?.missionRevision) ? activeAudit.missionRevision : 0;
  const action = checkpoint?.action
    ?? result?.data?.nextAction
    ?? result?.data?.recommendedNextAction
    ?? null;
  let activeTools = [];
  try {
    activeTools = contextualFrontmendToolNames(service);
  } catch {
    activeTools = [];
  }
  return {
    protocolVersion: FRONTMEND_PROTOCOL_VERSION,
    toolLibraryVersion: FRONTMEND_TOOL_LIBRARY_VERSION,
    toolCount: FRONTMEND_TOOL_COUNT,
    toolsetRevision: missionRevision,
    missionRevision,
    workspacePath: result?.data?.workspacePath
      ?? (auditId ? `/audits/${encodeURIComponent(auditId)}` : "/"),
    activeToolCount: activeTools.length,
    next: action?.tool
      ? {
          tool: action.tool,
          input: action.input && typeof action.input === "object" && !Array.isArray(action.input)
            ? JSON.parse(JSON.stringify(action.input))
            : {},
          requiredCapability: checkpoint?.requiredCapability
            ?? TOOL_CAPABILITIES[action.tool]
            ?? null,
          ...(typeof action.reason === "string" && action.reason ? { reason: action.reason } : {}),
        }
      : null,
    agentRun: checkpoint?.agentRun ?? result?.data?.agentRun ?? null,
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
    ...missionState,
    priorities: missionState.priorities.map(compactPriority),
  };
}

function compactAuditReport(report) {
  return {
    auditId: report.auditId,
    url: report.url,
    finalUrl: report.finalUrl,
    completedAt: report.completedAt,
    score: report.score,
    checks: report.checks,
    findingCount: report.findingCount,
    engine: report.engine,
    viewports: (report.viewports ?? []).map((viewport) => ({
      id: viewport.id,
      strategy: viewport.strategy,
      label: viewport.label,
      score: viewport.score,
      scores: viewport.scores,
      metrics: viewport.metrics,
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

function tool(definition) {
  return {
    name: definition.name,
    title: definition.title,
    description: definition.description,
    inputSchema: definition.inputSchema,
    annotations: definition.annotations,
    execute: (input) => safely(() => definition.run(input)),
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

export function contextualFrontmendToolNames(service) {
  const audit = service?.getActiveAudit?.();
  if (!audit || ["failed", "cancelled"].includes(audit.status)) {
    return ["start_site_audit", "get_mission_summary"];
  }
  if (audit.status !== "complete") {
    return ["check_site_audit_progress", "cancel_site_audit", "get_mission_summary"];
  }

  const available = new Set(["get_mission_summary", "get_site_audit_results"]);
  const browserReview = service?.getBrowserReview?.(audit.id) ?? null;
  const findings = assessmentFindings(audit.report, browserReview);
  const repairs = service?.getRepairs?.(audit.id) ?? [];
  const diagnosticMissions = service?.getDiagnosticMissions?.(audit.id) ?? [];
  const explorations = service?.getSiteExplorations?.(audit.id) ?? [];
  const childRenderedReviewAvailable = explorations.some((exploration) =>
    (exploration?.currentSnapshot ?? exploration)?.pages?.some(
      (page) => page?.renderedReview?.action?.tool === "open_browser_review",
    ));
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
  if (findings.length && browserReviewComplete) {
    available.add("get_repository_fix_brief");
    if (missionState?.assessmentComplete !== false) {
      available.add("prepare_site_repair");
    }
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
  if (childRenderedReviewAvailable) available.add("open_browser_review");
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
  const diagnosticFindings = findings.filter(findingRequiresDiagnosticMission);
  const diagnosticPriorityIds = new Set(
    (missionState?.priorities ?? [])
      .filter((priority) => priority.diagnosticMissionRequired)
      .map((priority) => priority.findingId),
  );
  const openedDiagnosticFindingIds = new Set(
    diagnosticMissions.map((mission) => mission.findingId).filter(Boolean),
  );
  if (
    browserReviewComplete &&
    (
      diagnosticFindings.some((finding) => !openedDiagnosticFindingIds.has(finding.id)) ||
      [...diagnosticPriorityIds].some((id) => !openedDiagnosticFindingIds.has(id))
    )
  ) {
    available.add("open_diagnostic_mission");
  }
  if (browserReviewComplete && diagnosticMissions.some((mission) => ["awaiting-diagnosis", "blocked"].includes(mission.state?.state))) {
    available.add("submit_runtime_diagnosis");
  }
  if (browserReviewComplete && diagnosticMissions.some((mission) => mission.state?.state === "awaiting-diagnosis")) {
    available.add("record_diagnostic_blocker");
  }
  const preparedFindingId = audit.mission?.repairPreparation?.findingId ?? null;
  const preparedFinding = findings.find((finding) => finding.id === preparedFindingId);
  const preparedDiagnostic = diagnosticMissions.find(
    (mission) => mission.findingId === preparedFindingId,
  );
  if (
    missionState?.assessmentComplete !== false &&
    preparedFinding &&
    (
      (!findingRequiresDiagnosticMission(preparedFinding) && !diagnosticPriorityIds.has(preparedFindingId)) ||
      preparedDiagnostic?.state?.state === "ready-for-repair"
    )
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
        "Start a durable Frontmend assessment for a public HTTP or HTTPS website. Use intent assess for natural audit requests, preserve any requested accessibility, SEO, performance, security, or reliability focus, and use prepare-fix only when the person explicitly asked to prepare a repair. Resolve the target URL from their request or current repository deployment configuration; ask only when it cannot be determined safely. After starting, navigate to the stable workspace, check progress, then continue the exact mission until assessmentComplete is true or its named blocker cannot be resolved.",
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
      async run(input) {
        const value = objectInput(input);
        noExtra(value, ["auditId"]);
        const audit = await service.getAudit(auditIdForTool(service, value.auditId));
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
        "Return the small stable Frontmend control-plane view: audit identity and status, protocol and mission revisions, retained intent, assessment truth, up to three priorities, completion criteria, blocker, capability requirement, and exact next action. Use this for routine continuation and stale-tool recovery; request the full results only when detailed measurement is actually needed.",
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
            missionCheckpoint: checkpoint,
            mission: audit.mission ? auditMissionSnapshot(audit.mission) : null,
            assessment: {
              measurementComplete: false,
              assessmentComplete: false,
              status: "measuring",
              blocker: null,
            },
            topPriorities: [],
            completionCriteria: checkpoint?.completionCriteria ?? ["Retain a completed public evidence report."],
            requiredCapability: checkpoint?.requiredCapability ?? "progress-reading",
            nextAction: checkpoint?.action ?? {
              tool: "check_site_audit_progress",
              input: { auditId: audit.id },
              reason: "The bounded measurement job is still active.",
            },
          };
        }
        return {
          auditId: audit.id,
          status: audit.status,
          measurementStatus: audit.status,
          assessmentStatus: missionState.assessmentStatus,
          checkpointStatus: missionState.checkpointStatus,
          explorationStatus: missionState.explorationStatus,
          workspacePath: `/audits/${encodeURIComponent(audit.id)}`,
          missionCheckpoint: checkpoint,
          mission: {
            intent: projection.mission.intent,
            requestedBy: projection.mission.requestedBy,
            focusAreas: [...projection.mission.focusAreas],
            scope: projection.mission.scope,
            routeLimit: projection.mission.routeLimit,
          },
          assessment: {
            measurementComplete: missionState.measurementComplete,
            assessmentComplete: missionState.assessmentComplete,
            status: missionState.assessmentStatus ?? missionState.status,
            blocker: missionState.blocker ?? missionState.siteScope?.blockedReason ?? null,
            siteScope: {
              requested: missionState.siteScope?.requested === true,
              status: missionState.siteScope?.status ?? "not-requested",
              pagesComplete: missionState.siteScope?.pagesComplete ?? 0,
              pagesRequested: missionState.siteScope?.pagesRequested ?? 0,
            },
          },
          topPriorities: missionState.priorities.slice(0, 3).map(compactPriority),
          completionCriteria: checkpoint?.completionCriteria ?? [],
          requiredCapability: checkpoint?.requiredCapability
            ?? TOOL_CAPABILITIES[missionState.nextAction?.tool]
            ?? null,
          nextAction: checkpoint?.action ?? createExecutableMissionAction(missionState.nextAction, audit),
          agentRun: checkpoint?.agentRun ?? null,
          authorityBoundary: checkpoint?.authorityBoundary ?? null,
        };
      },
    }),
    tool({
      name: "get_site_audit_results",
      title: "Get site audit results",
      description:
        "Return a compact completed measurement and persisted assessment mission with bounded priorities, evidence state, assessmentComplete, and an exact next tool/input. Use detailLevel full only when raw retained report evidence is necessary; routine continuation should use this compact default or get_mission_summary, then get_evidence_chain for one priority. Optional focus/max values are a labelled read-only projection and never rewrite mission intent. Do not stop at measurement completion while assessmentComplete is false and the named action is available.",
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
        const projectedPriorities = detailLevel === "full"
          ? missionState.priorities
          : missionState.priorities.map(compactPriority);
        return {
          ...(detailLevel === "full" ? report : compactAuditReport(report)),
          measurementStatus: "complete",
          assessmentStatus: missionState.assessmentStatus,
          checkpointStatus: missionState.checkpointStatus,
          explorationStatus: missionState.explorationStatus,
          mission: persistedMission,
          requestedFocusAreas: missionState.requestedFocusAreas,
          focusSummary: {
            matchingFindingCount: missionState.matchingFindingCount,
            returnedPriorityCount: missionState.priorityCount,
            categoryScores: missionState.categoryScores,
            message: missionState.priorities.length
              ? "Priorities are deduplicated measured rules with explicit diagnosis state. Automated evidence is not a complete manual audit."
              : "No supported failed rule matched this focus. Retained scores are automated evidence, not a complete manual audit.",
          },
          priorities: projectedPriorities,
          browserReview: detailLevel === "full" ? browserReview : compactBrowserReview(browserReview),
          missionState: detailLevel === "full" ? missionState : compactMissionState(missionState),
          missionCheckpoint: service?.getMissionCheckpoint?.(auditId) ?? report.missionCheckpoint,
          resultProjection: {
            mode: overridden ? "read-only-override" : "persisted-mission",
            changedPersistedMission: false,
            focusAreas: missionState.requestedFocusAreas,
            maxPriorities: projectionMission.maxPriorities,
            detailLevel,
          },
          recommendedNextAction: createExecutableMissionAction(
            missionState.nextAction,
            {
              id: auditId,
              missionRevision: service?.getMissionCheckpoint?.(auditId)?.missionRevision
                ?? report.missionCheckpoint?.missionRevision
                ?? remembered?.missionRevision,
            },
          ),
        };
      },
    }),
    tool({
      name: "get_evidence_chain",
      title: "Get one evidence chain",
      description:
        "Return one retained priority as a compact provider, browser, repository, and planned-verification chain. Use this for a coding-agent handoff when the full report is unnecessary. The response keeps provenance explicit, includes only repository-relative locations and bounded checks, and never returns source contents, patches, credentials, or approval/deployment claims.",
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
        "Open the exact rendered-browser contribution required by an agent-started accessibility or SEO assessment, adopt an eligible person-started assessment without restarting its audit, or open the fresh replay required to verify a retained browser finding after deployment. Frontmend returns one non-destructive browser check at a time so the agent inspects the rendered target instead of repeating provider output. Adoption retains the original person attribution and audit ID. This creates no site interaction by itself, accepts no findings, and does not inspect source or claim the page passed.",
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
            description: "Optional rendered-review scope when adopting a broad person-started assessment. A focused assessment retains its existing accessibility or SEO scope.",
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
        "Record the current exact browser-review check after using real browser controls on the retained target. Supply bounded observed facts; the assessment search-discovery task may also contribute up to eight relative same-origin paths, which Frontmend revalidates server-side before minting route candidates. Assessment issues require structured findings, while verification replay compares the retained finding and must not create a new one. Use blocked with an exact reason when the browser, safe interaction, authentication, capability, or retained target prevents honest inspection. Frontmend keeps provider and browser provenance separate and never treats this contribution as repository or deployment proof.",
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
            description: "Optional relative same-origin paths directly observed during the assessment search-discovery task. The server revalidates them before they can become route candidates.",
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
        "Return the completed Frontmend assessment as both structured evidence and portable Markdown. The receipt freezes the retained mission, ranked provider measurements, and any separately attributed browser, repository, and planned-check contributions. It becomes available only when assessmentComplete is true and does not prove repair approval, implementation, deployment, or resolution.",
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
        "Translate one completed Frontmend finding, plus an optional frozen package of up to three findings, into a bounded source-safe implementation contract for a coding agent with repository access. It returns measured evidence, package scope, repository search hints, shared verification candidates, acceptance criteria, and authority boundaries. It does not inspect files, upload source, stage a repair, change the repository, or deploy the target.",
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
          assessmentFindings(report, service?.getBrowserReview?.(auditId) ?? null),
          verificationCandidates,
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
        "Open an idempotent diagnostic mission for a finding with structured runtime evidence, such as console errors, low-contrast nodes, or main-thread blocking. The mission returns an evidenceChain that keeps the measured symptom separate from required browser reproduction, repository ownership, and planned verification. Continue with submit_runtime_diagnosis only from evidence you actually obtain; if browser/repository access is unavailable or the runtime conflicts, use record_diagnostic_blocker instead of inventing a cause. This tool does not diagnose, read repository source, stage a repair, or change the target site.",
      inputSchema: {
        type: "object",
        properties: {
          auditId: { type: "string", minLength: 1, description: "Optional completed audit ID; defaults to the visible audit." },
          findingId: { type: "string", minLength: 1, maxLength: 160, description: "Exact structured diagnostic finding ID." },
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
        "Record why a measured symptom cannot currently be reproduced or mapped to repository ownership. Use this instead of inventing diagnosis when browser access, the correct repository, or matching runtime evidence is unavailable. Frontmend preserves the measured evidence, labels the blocker as agent-reported, keeps the assessment incomplete, and exposes runtime diagnosis again if access is later restored. This does not dismiss the finding, approve a repair, or claim resolution.",
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
          assessmentComplete: false,
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
          ? "The agent-reported checks passed. The site owner may review the receipt, deploy externally, and attest that handoff in the visible UI."
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
      async execute(input) {
        let activityId = null;
        const auditIdBefore = activeAuditId(service, null, input);
        const checkpointBefore = safeCheckpoint(service, auditIdBefore, null);
        try {
          activityId = service.beginAgentActivity?.({
            tool: definition.name,
            title: definition.title,
            auditId: auditIdBefore,
            missionRevisionBefore: checkpointBefore?.missionRevision ?? 0,
          }) ?? null;
        } catch {
          activityId = null;
        }
        const result = await execute(input);
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
            });
          } catch {
            // Activity telemetry never changes the semantic tool result.
          }
        }
        return {
          ...result,
          protocol: protocolEnvelope(service, result, input),
        };
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
  onStatus?.({ ...statusBase, status: "registering", toolNames: [], errors: [] });

  // Defer the first registration by one microtask so React Strict Mode can run
  // its development-only setup/cleanup probe without leaving duplicate tools.
  const ready = Promise.resolve().then(async () => {
    if (controller.signal.aborted) return;

    for (const definition of tools) {
      if (controller.signal.aborted) return;
      try {
        await modelContext.registerTool(definition, { signal: controller.signal });
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
