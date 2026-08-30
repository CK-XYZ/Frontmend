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
  findingRequiresDiagnosticMission,
} from "./diagnostic-contract.js";
import {
  AUDIT_FOCUS_AREAS,
  assessmentFindings,
  auditMissionSnapshot,
  createAuditMission,
  deriveAuditMissionState,
} from "./audit-mission-contract.js";
import {
  BROWSER_REVIEW_BLOCKER_REASONS,
  BROWSER_REVIEW_OUTCOMES,
  browserReviewAdoptionAvailable,
} from "./browser-review-contract.js";
import { repairVerificationReceiptMarkdown } from "./verification-impact-contract.js";

const emptySchema = { type: "object", properties: {}, additionalProperties: false };
const expectedMissionRevisionProperty = {
  type: "integer",
  minimum: 1,
  description: "Exact mission revision from the latest checkpoint. Stale writes are rejected with the current checkpoint.",
};
const checkpointedMutationTools = new Set([
  "cancel_site_audit",
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
  "start_repair_verification",
]);

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
  if (!audit || ["failed", "cancelled"].includes(audit.status)) return ["start_site_audit"];
  if (audit.status !== "complete") {
    return ["check_site_audit_progress", "cancel_site_audit"];
  }

  const available = new Set(["get_site_audit_results"]);
  const browserReview = service?.getBrowserReview?.(audit.id) ?? null;
  const findings = assessmentFindings(audit.report, browserReview);
  const routes = audit.report?.documentProfile?.routes ?? [];
  const repairs = service?.getRepairs?.(audit.id) ?? [];
  const diagnosticMissions = service?.getDiagnosticMissions?.(audit.id) ?? [];
  const explorations = service?.getSiteExplorations?.(audit.id) ?? [];
  const missionState = audit.mission?.schemaVersion === 1
    ? deriveAuditMissionState({
        report: audit.report,
        mission: audit.mission,
        diagnosticMissions,
        repairs,
        browserReview,
      })
    : null;
  const verificationReplay = audit.report?.verification?.browserReplay ?? null;
  const verificationReplayRequired = verificationReplay?.required === true;
  const verificationReplayComplete = !verificationReplayRequired || verificationReplay.status === "complete";
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
    available.add("prepare_site_repair");
  }
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
        },
        required: ["url"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      async run(input) {
        const value = objectInput(input);
        noExtra(value, ["url", "intent", "focusAreas", "maxPriorities"]);
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
      name: "get_site_audit_results",
      title: "Get site audit results",
      description:
        "Return the completed measurement and the persisted assessment mission with bounded priorities, evidence state, assessmentComplete, and an exact next tool/input. Omit focus and maximum to continue the person's original goal without restating it. Optional focus/max values are a labelled read-only result projection and never rewrite mission intent. Do not stop at Lighthouse job completion while assessmentComplete is false and the named diagnostic action is available.",
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
        },
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      async run(input) {
        const value = objectInput(input);
        noExtra(value, ["auditId", "focusAreas", "maxPriorities"]);
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
        const missionState = deriveAuditMissionState({
          report,
          mission: projectionMission,
          diagnosticMissions: service?.getDiagnosticMissions?.(auditId) ?? [],
          repairs: service?.getRepairs?.(auditId) ?? [],
          browserReview: service?.getBrowserReview?.(auditId) ?? null,
        });
        const overridden = value.focusAreas !== undefined || value.maxPriorities !== undefined;
        return {
          ...report,
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
          priorities: missionState.priorities,
          browserReview: service?.getBrowserReview?.(auditId) ?? null,
          missionState,
          missionCheckpoint: report.missionCheckpoint ?? service?.getMissionCheckpoint?.(auditId),
          resultProjection: {
            mode: overridden ? "read-only-override" : "persisted-mission",
            changedPersistedMission: false,
            focusAreas: missionState.requestedFocusAreas,
            maxPriorities: projectionMission.maxPriorities,
          },
          recommendedNextAction: missionState.nextAction
            ? { tool: missionState.nextAction.tool, ...missionState.nextAction.input, reason: missionState.nextAction.reason }
            : null,
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
          browserReview: review,
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
        "Record the current exact browser-review check after using real browser controls on the retained target. Supply bounded observed facts; assessment issues require structured findings, while verification replay compares the retained finding and must not create a new one. Use blocked with an exact reason when the browser, safe interaction, authentication, capability, or retained target prevents honest inspection. Frontmend keeps provider and browser provenance separate and never treats this contribution as repository or deployment proof.",
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
        noExtra(value, ["auditId", "reviewId", "checkId", "outcome", "summary", "observations", "findings", "blockerReason", "expectedMissionRevision"]);
        const auditId = auditIdForTool(service, value.auditId);
        const review = await service.recordBrowserReviewCheck(
          auditId,
          requiredString(value.reviewId, "reviewId", 160),
          {
            checkId: requiredString(value.checkId, "checkId", 80),
            outcome: value.outcome,
            summary: requiredString(value.summary, "summary", 300),
            observations: value.observations,
            findings: value.findings,
            blockerReason: value.blockerReason,
          },
          "agent",
          expectedMissionRevisionForTool(service, auditId, value.expectedMissionRevision),
        );
        const nextCheck = review.state.nextCheck;
        return {
          auditId,
          browserReview: review,
          missionCheckpoint: review.missionCheckpoint ?? service?.getMissionCheckpoint?.(auditId),
          acceptedCheck: review.results.find((result) => result.checkId === value.checkId) ?? null,
          assessmentComplete: Boolean(service?.getAuditMissionState?.(auditId)?.assessmentComplete),
          verificationComplete: review.purpose === "verification" && review.state.complete,
          nextAction: review.state.complete
            ? review.purpose === "verification"
              ? {
                  tool: "get_verification_receipt",
                  input: { auditId },
                  reason: "The exact fresh browser comparison is complete, so Frontmend can now return the bounded verification receipt.",
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
        "Translate one completed Frontmend finding into a bounded, source-safe implementation contract for a coding agent with repository access. It returns measured evidence, repository search hints, acceptance criteria, and authority boundaries. It does not inspect files, upload source, stage a repair, change the repository, or deploy the target.",
      inputSchema: {
        type: "object",
        properties: {
          auditId: { type: "string", minLength: 1, description: "Optional completed audit ID; defaults to the visible audit." },
          findingId: { type: "string", minLength: 1, maxLength: 160, description: "Exact finding ID from the completed report." },
        },
        required: ["findingId"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      async run(input) {
        const value = objectInput(input);
        noExtra(value, ["auditId", "findingId"]);
        const auditId = auditIdForTool(service, value.auditId);
        const findingId = requiredString(value.findingId, "findingId", 160);
        const report = await coherentResultsForTool(service, auditId);
        const verificationCandidates = await (
          service?.getVerificationCandidates?.(auditId, findingId) ?? null
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
        "Start a bounded multi-page exploration for one to three exact same-site paths observed in the completed root audit. Each path becomes a separate live audit under one durable exploration ID; this is not an exhaustive crawl.",
      inputSchema: {
        type: "object",
        properties: {
          auditId: { type: "string", minLength: 1, description: "Optional completed root audit ID; defaults to the visible audit." },
          paths: {
            type: "array",
            minItems: 1,
            maxItems: 3,
            uniqueItems: true,
            items: { type: "string", minLength: 1, maxLength: 256 },
            description: "One to three exact paths from documentProfile.routes.",
          },
        },
        required: ["paths"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      async run(input) {
        const value = objectInput(input);
        noExtra(value, ["auditId", "paths", "expectedMissionRevision"]);
        const rootAuditId = auditIdForTool(service, value.auditId);
        const exploration = await service.startSiteExploration(
          rootAuditId,
          observedPaths(value.paths),
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
        "Read progress or aggregated cross-page evidence for a durable site exploration. Omit missionId to use the most recent exploration attached to the visible root audit.",
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
        "Return a portable Markdown evidence receipt for a completed repair verification, including every captured rule occurrence and its fresh outcome, before/after metrics, and bounded audit lineage. Omit auditId to use the visible verification audit. This does not change or deploy the target site.",
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
          return {
            auditId,
            repairId,
            status: aggregate.status,
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
        "Record that the person explicitly asked to prepare or fix one assessed finding. Call this only after that explicit request. It freezes the finding and enables a separate bounded repair proposal when diagnosis is ready; it is not approval, does not consume auto-mode allowance, accepts no plan or code, and cannot implement, deploy, or attest anything.",
      inputSchema: {
        type: "object",
        properties: {
          auditId: { type: "string", minLength: 1, description: "Optional completed audit ID; defaults to the visible audit." },
          findingId: { type: "string", minLength: 1, maxLength: 160, description: "Exact retained finding the person asked to prepare for repair." },
        },
        required: ["findingId"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      async run(input) {
        const value = objectInput(input);
        noExtra(value, ["auditId", "findingId", "expectedMissionRevision"]);
        const auditId = auditIdForTool(service, value.auditId);
        const findingId = requiredString(value.findingId, "findingId", 160);
        const prepared = await service.prepareRepair(
          auditId,
          findingId,
          "agent",
          expectedMissionRevisionForTool(service, auditId, value.expectedMissionRevision),
        );
        return {
          auditId,
          findingId,
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
        "Submit a bounded repository repair mission for one completed audit finding, freezing every measured strategy sharing that failed rule and optionally attaching source-safe repository-relative target files plus planned checks. In review mode it waits for visible human approval. If a person previously enabled delegated auto mode, an eligible low-risk HTML or CSS mission with a complete repository plan is auto-authorised under that recorded grant. This never changes the target site, deploys, or bypasses the person-only deployment attestation.",
      inputSchema: {
        type: "object",
        properties: {
          auditId: { type: "string", minLength: 1, description: "Optional completed audit ID; defaults to the visible audit." },
          findingId: { type: "string", minLength: 1, description: "Finding ID from the completed report." },
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
        noExtra(value, ["auditId", "findingId", "summary", "patchType", "patch", "verificationPlan", "risk", "repositoryFiles", "repositoryChecks", "verificationTargetIds", "expectedMissionRevision"]);
        const auditId = auditIdForTool(service, value.auditId);
        const findingId = requiredString(value.findingId, "findingId", 160);
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
        try {
          activityId = service.beginAgentActivity?.({
            tool: definition.name,
            title: definition.title,
          }) ?? null;
        } catch {
          activityId = null;
        }
        const result = await execute(input);
        if (activityId) {
          const data = result?.data;
          try {
            service.finishAgentActivity?.(activityId, {
              status: result?.ok ? "succeeded" : "failed",
              auditId: data?.auditId ?? data?.id,
              repairId: data?.repairId,
              errorCode: result?.error?.code,
            });
          } catch {
            // Activity telemetry never changes the semantic tool result.
          }
        }
        return result;
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
