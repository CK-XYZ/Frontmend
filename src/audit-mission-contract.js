import {
  browserReviewFindings,
  browserReviewChecksForMission,
  browserReviewRequired,
  browserReviewState,
} from "./browser-review-contract.js";
import { AuditError } from "./url-policy.js";
import { reconcileAssessmentEvidence } from "./evidence-reconciliation-contract.js";

export const AUDIT_FOCUS_AREAS = Object.freeze([
  "accessibility",
  "seo",
  "performance",
  "security",
  "reliability",
]);
export const AUDIT_MISSION_INTENTS = Object.freeze(["assess", "prepare-fix"]);

const MISSION_FIELDS = Object.freeze([
  "schemaVersion",
  "intent",
  "focusAreas",
  "maxPriorities",
  "requestedBy",
  "requestedAt",
  "repairPreparation",
]);
const CREATE_FIELDS = Object.freeze(["intent", "focusAreas", "maxPriorities"]);
const SEVERITY_ORDER = Object.freeze({ high: 0, medium: 1, low: 2 });

function inputObject(value, allowed, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AuditError("INVALID_INPUT", `${label} must be an object.`);
  }
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) throw new AuditError("INVALID_INPUT", `Unknown ${label} field: ${unknown}.`);
  return value;
}

function actor(value) {
  return value === "agent" ? "agent" : "human";
}

function timestamp(value, field) {
  if (!Number.isInteger(value) || value < 0) {
    throw new AuditError("INVALID_INPUT", `${field} must be a non-negative integer timestamp.`);
  }
  return value;
}

function intent(value = "assess") {
  if (!AUDIT_MISSION_INTENTS.includes(value)) {
    throw new AuditError("INVALID_INPUT", "intent must be assess or prepare-fix.");
  }
  return value;
}

function focusAreas(value = []) {
  if (!Array.isArray(value) || value.length > 3) {
    throw new AuditError("INVALID_INPUT", "focusAreas must contain zero to three areas.");
  }
  const result = value.map((area) => {
    if (typeof area !== "string" || !area.trim() || area.length > 40) {
      throw new AuditError("INVALID_INPUT", "Each focus area must be a supported string.");
    }
    return area.trim().toLowerCase();
  });
  if (
    result.some((area) => !AUDIT_FOCUS_AREAS.includes(area)) ||
    new Set(result).size !== result.length
  ) {
    throw new AuditError("INVALID_INPUT", "focusAreas must contain unique supported audit areas.");
  }
  return result;
}

function maxPriorities(value = 3) {
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new AuditError("INVALID_INPUT", "maxPriorities must be an integer from one to five.");
  }
  return value;
}

function findingId(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 160) {
    throw new AuditError("INVALID_INPUT", "findingId must contain 1 to 160 characters.");
  }
  return value.trim();
}

function repairPreparation(value) {
  if (value === null) return null;
  const preparation = inputObject(
    value,
    ["findingId", "requestedBy", "requestedAt"],
    "repairPreparation",
  );
  return {
    findingId: findingId(preparation.findingId),
    requestedBy: actor(preparation.requestedBy),
    requestedAt: timestamp(preparation.requestedAt, "repairPreparation.requestedAt"),
  };
}

export function auditMissionSnapshot(value) {
  const mission = inputObject(value, MISSION_FIELDS, "mission");
  if (mission.schemaVersion !== 1) {
    throw new AuditError("INVALID_INPUT", "mission.schemaVersion must be 1.");
  }
  return {
    schemaVersion: 1,
    intent: intent(mission.intent),
    focusAreas: focusAreas(mission.focusAreas),
    maxPriorities: maxPriorities(mission.maxPriorities),
    requestedBy: actor(mission.requestedBy),
    requestedAt: timestamp(mission.requestedAt, "mission.requestedAt"),
    repairPreparation: repairPreparation(mission.repairPreparation),
  };
}

export function createAuditMission(input = {}, source = "human", now = Date.now()) {
  const value = inputObject(input, CREATE_FIELDS, "mission");
  return auditMissionSnapshot({
    schemaVersion: 1,
    intent: intent(value.intent),
    focusAreas: focusAreas(value.focusAreas),
    maxPriorities: maxPriorities(value.maxPriorities),
    requestedBy: actor(source),
    requestedAt: timestamp(now, "mission.requestedAt"),
    repairPreparation: null,
  });
}

export function auditMissionSignature(value) {
  const mission = auditMissionSnapshot(value);
  return JSON.stringify({
    intent: mission.intent,
    focusAreas: [...mission.focusAreas].sort(),
    maxPriorities: mission.maxPriorities,
    repairFindingId: mission.repairPreparation?.findingId ?? null,
  });
}

export function prepareRepairIntent(missionValue, selectedFindingId, source = "human", now = Date.now()) {
  const mission = auditMissionSnapshot(missionValue);
  const selected = findingId(selectedFindingId);
  if (mission.repairPreparation) {
    if (mission.repairPreparation.findingId !== selected) {
      throw new AuditError(
        "REPAIR_INTENT_CONFLICT",
        "This audit mission is already preparing a different finding for repair.",
      );
    }
    return mission;
  }
  return auditMissionSnapshot({
    ...mission,
    intent: "prepare-fix",
    repairPreparation: {
      findingId: selected,
      requestedBy: actor(source),
      requestedAt: timestamp(now, "repairPreparation.requestedAt"),
    },
  });
}

export function assessmentFindings(report, browserReview = null) {
  return [
    ...(Array.isArray(report?.findings) ? report.findings : []),
    ...browserReviewFindings(browserReview),
  ];
}

export function focusedAuditPriorities(
  report,
  missionValue,
  diagnosticMissions = [],
  browserReview = null,
  repairs = [],
) {
  const mission = auditMissionSnapshot(missionValue);
  const reconciled = reconcileAssessmentEvidence({
    report,
    browserReview,
    diagnosticMissions,
    repairs,
  });
  const candidates = mission.focusAreas.length
    ? reconciled.filter((item) => {
        const records = item.evidenceRecords.provider?.findings ?? item.evidenceRecords.browser?.findings ?? [];
        return records.some((finding) => mission.focusAreas.some((area) => finding.focusAreas.includes(area)));
      })
    : reconciled;
  const grouped = candidates.map((item, sourceIndex) => {
    const providerFindings = item.evidenceRecords.provider?.findings ?? [];
    const browserFindings = item.evidenceRecords.browser?.findings ?? [];
    const finding = providerFindings[0] ?? browserFindings[0];
    const occurrenceFindings = providerFindings.length ? providerFindings : browserFindings;
    const affectedStrategies = [...new Set(occurrenceFindings.map((entry) => entry.strategy).filter(Boolean))];
    const repository = item.evidenceRecords.repository;
    const evidenceState = repository?.state === "blocked"
      ? "diagnosis-blocked"
      : item.relationship === "diagnosis-contributed"
        ? "diagnosis-contributed"
        : item.nextAction?.tool === "submit_runtime_diagnosis"
          ? "diagnosis-in-progress"
          : item.nextAction?.tool === "open_diagnostic_mission"
            ? "diagnosis-recommended"
            : "measured-evidence-sufficient";
    return {
      sourceIndex,
      findingId: item.findingId,
      title: finding?.title ?? "Retained evidence priority",
      severity: finding?.severity ?? "low",
      category: finding?.category ?? "Evidence",
      focusAreas: finding?.focusAreas ?? [],
      evidence: finding?.evidence ?? item.evidenceRecords.browser?.summary ?? "Retained evidence",
      suggestedRepair: finding?.suggestedRepair ?? "Diagnose the retained evidence before repair.",
      occurrenceCount: Math.max(1, occurrenceFindings.length),
      affectedStrategies,
      evidenceProvenance: providerFindings.length ? "measured-provider" : "agent-reported-browser",
      source: {
        provider: item.evidenceRecords.provider?.provider ?? "Frontmend browser review",
        auditId: item.evidenceRecords.provider?.ruleId ?? finding?.source?.auditId ?? item.findingId,
      },
      diagnosticMissionRequired: [
        "provider-browser-conflict",
        "diagnosis-required",
        "browser-only",
      ].includes(item.relationship),
      evidenceState,
      diagnosticMissionId: repository?.missionId ?? null,
      diagnosticBlocker: repository?.blocker ?? null,
      relationship: item.relationship,
      relationshipReason: item.relationshipReason,
      unresolvedRequirement: item.unresolvedRequirement,
      provenance: item.provenance,
      evidenceRecords: item.evidenceRecords,
      nextAction: item.nextAction,
    };
  });

  const priorities = grouped
    .sort((left, right) =>
      (SEVERITY_ORDER[left.severity] ?? 3) - (SEVERITY_ORDER[right.severity] ?? 3) ||
      right.occurrenceCount - left.occurrenceCount ||
      left.sourceIndex - right.sourceIndex,
    )
    .slice(0, mission.maxPriorities)
    .map(({ sourceIndex: _sourceIndex, ...priority }, index) => ({
      rank: index + 1,
      ...priority,
      whyPrioritized: `${priority.severity} severity${priority.occurrenceCount > 1 ? ` across ${priority.occurrenceCount} measured strategies` : ""}`,
    }));

  const categoryScores = {};
  for (const area of mission.focusAreas) {
    const scores = (report?.viewports ?? [])
      .map((viewport) => viewport.scores?.[area])
      .filter(Number.isFinite);
    categoryScores[area] = scores.length
      ? Math.round(scores.reduce((total, score) => total + score, 0) / scores.length)
      : null;
  }

  return {
    requestedFocusAreas: [...mission.focusAreas],
    matchingFindingCount: candidates.reduce((total, item) => {
      const providerCount = item.evidenceRecords.provider?.findings?.length ?? 0;
      const browserCount = item.evidenceRecords.provider ? 0 : item.evidenceRecords.browser?.findings?.length ?? 0;
      return total + providerCount + browserCount;
    }, 0),
    categoryScores,
    priorities,
  };
}

function diagnosticNextAction(priority) {
  if (priority.evidenceState === "diagnosis-blocked") return null;
  if (["open_diagnostic_mission", "submit_runtime_diagnosis"].includes(priority.nextAction?.tool)) {
    return priority.nextAction;
  }
  if (priority.evidenceState === "diagnosis-recommended") {
    return {
      tool: "open_diagnostic_mission",
      input: { findingId: priority.findingId },
      reason: "This measured symptom needs browser reproduction and repository ownership before the assessment is complete.",
    };
  }
  if (priority.evidenceState === "diagnosis-in-progress") {
    return {
      tool: "submit_runtime_diagnosis",
      input: { missionId: priority.diagnosticMissionId },
      reason: "Contribute the browser and repository diagnosis already requested for this measured symptom.",
    };
  }
  return null;
}

export function deriveAuditMissionState({
  report,
  mission: missionValue,
  diagnosticMissions = [],
  repairs = [],
  browserReview = null,
}) {
  const mission = auditMissionSnapshot(missionValue);
  const projection = focusedAuditPriorities(report, mission, diagnosticMissions, browserReview, repairs);
  const reviewRequired = browserReviewRequired(mission);
  const reviewState = browserReview ? browserReviewState(browserReview) : null;
  const requestedBrowserCheckCount = reviewState?.requestedCheckCount
    ?? (reviewRequired ? browserReviewChecksForMission(mission).length : 0);
  const reviewOutstanding = reviewRequired && !reviewState?.complete;
  const unresolved = projection.priorities.find((priority) => diagnosticNextAction(priority));
  const blocked = projection.priorities.find(
    (priority) => priority.evidenceState === "diagnosis-blocked",
  );
  const auditComplete = Boolean(report);
  let status = auditComplete ? "complete" : "in-progress";
  let nextActor = auditComplete ? null : "agent";
  let nextAction = auditComplete
    ? null
    : {
        tool: "check_site_audit_progress",
        input: {},
        reason: "The measurement job has not produced a completed report yet.",
      };

  if (auditComplete && reviewOutstanding) {
    status = reviewState?.status === "blocked"
      ? "blocked"
      : browserReview
        ? "in-progress"
        : "action-available";
    nextActor = "agent";
    nextAction = browserReview
      ? {
          tool: "record_browser_review_check",
          input: {
            reviewId: browserReview.id,
            checkId: reviewState?.nextCheck?.id,
          },
          reason: reviewState?.status === "blocked"
            ? "Retry the blocked browser check when the named capability or target is available; do not invent evidence."
            : "Inspect the exact rendered-browser check and contribute only observations you actually obtain.",
        }
      : {
          tool: "open_browser_review",
          input: {},
          reason: "The agent-started accessibility or SEO assessment requires structured rendered-browser evidence beyond provider measurement.",
        };
  }

  if (auditComplete && !reviewOutstanding && unresolved) {
    status = unresolved.evidenceState === "diagnosis-recommended" ? "action-available" : "in-progress";
    nextActor = "agent";
    nextAction = diagnosticNextAction(unresolved);
  }

  if (auditComplete && !reviewOutstanding && !unresolved && blocked) {
    status = "blocked";
    nextActor = null;
    nextAction = null;
  }

  const assessmentComplete = auditComplete && !reviewOutstanding && !unresolved && !blocked;
  if (auditComplete && !reviewOutstanding && mission.intent === "prepare-fix" && !mission.repairPreparation) {
    status = "awaiting-repair-preparation";
    nextActor = "person";
    nextAction = null;
  }

  if (auditComplete && mission.repairPreparation && !reviewOutstanding && !unresolved && !blocked) {
    const selected = projection.priorities.find(
      (priority) => priority.findingId === mission.repairPreparation.findingId,
    );
    const selectedEvidence = selected
      ? {
          evidenceState: selected.evidenceState,
          diagnosticMissionId: selected.diagnosticMissionId,
          nextAction: selected.nextAction,
        }
      : { evidenceState: "unsupported-continuation", diagnosticMissionId: null, nextAction: null };
    const repair = repairs.find((item) => item?.findingId === mission.repairPreparation.findingId);
    status = "action-available";
    nextActor = "agent";
    nextAction = diagnosticNextAction({
      findingId: mission.repairPreparation.findingId,
      ...selectedEvidence,
    }) ?? (repair
      ? {
          tool: "get_repair_workspace",
          input: { repairId: repair.id },
          reason: "Continue the existing reviewed repair mission for the selected finding.",
        }
      : {
          tool: "stage_site_repair",
          input: { findingId: selected?.findingId ?? mission.repairPreparation.findingId },
          reason: "Prepare a bounded repair draft for the explicitly selected finding.",
        });
  }

  return {
    intent: mission.intent,
    status,
    auditComplete,
    assessmentComplete,
    requestedFocusAreas: projection.requestedFocusAreas,
    priorityCount: projection.priorities.length,
    matchingFindingCount: projection.matchingFindingCount,
    categoryScores: projection.categoryScores,
    priorities: projection.priorities,
    browserReview: {
      required: reviewRequired,
      status: reviewRequired ? reviewState?.status ?? "not-opened" : "not-required",
      reviewId: browserReview?.id ?? null,
      requestedCheckCount: requestedBrowserCheckCount,
      completedCheckCount: reviewState?.completedCheckCount ?? 0,
      issueCount: reviewState?.issueCount ?? 0,
      blockedCheckCount: reviewState?.blockedCheckCount ?? 0,
      nextCheck: reviewState?.nextCheck ?? null,
      provenance: browserReview ? "agent-reported-browser" : null,
    },
    nextActor,
    nextAction,
    authority: {
      mayDiagnose: true,
      mayPrepareRepair: Boolean(mission.repairPreparation),
      mayDeploy: false,
      mayAttestDeployment: false,
    },
  };
}
