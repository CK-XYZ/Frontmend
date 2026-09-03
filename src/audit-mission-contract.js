import {
  browserReviewAdoptionAvailable,
  browserReviewFindings,
  browserReviewInvestigationGap,
  browserReviewChecksForMission,
  browserReviewPolicy,
  browserReviewProvenance,
  browserReviewRequired,
  browserReviewState,
} from "./browser-review-contract.js";
import { AuditError } from "./url-policy.js";
import { reconcileAssessmentEvidence } from "./evidence-reconciliation-contract.js";
import { createSiteRouteCandidates } from "./site-exploration-contract.js";
import { repairMissionContinuation } from "./repair-contract.js";

export const AUDIT_FOCUS_AREAS = Object.freeze([
  "accessibility",
  "seo",
  "performance",
  "security",
  "reliability",
]);
export const AUDIT_MISSION_INTENTS = Object.freeze(["assess", "prepare-fix"]);
export const AUDIT_MISSION_SCOPES = Object.freeze(["page", "bounded-site"]);

const MISSION_FIELDS = Object.freeze([
  "schemaVersion",
  "intent",
  "focusAreas",
  "maxPriorities",
  "scope",
  "routeLimit",
  "requestedBy",
  "requestedAt",
  "repairPreparation",
]);
const CREATE_FIELDS = Object.freeze(["intent", "focusAreas", "maxPriorities", "scope", "routeLimit"]);
const SEVERITY_ORDER = Object.freeze({ high: 0, medium: 1, low: 2 });
const EVIDENCE_ORDER = Object.freeze({
  "verified-still-present": 0,
  "browser-confirmed": 0,
  "browser-only": 0,
  "provider-only": 1,
  "diagnosis-required": 1,
  "provider-browser-conflict": 2,
  "diagnosis-contributed": 3,
});

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
  if (!Array.isArray(value) || value.length > AUDIT_FOCUS_AREAS.length) {
    throw new AuditError("INVALID_INPUT", `focusAreas must contain zero to ${AUDIT_FOCUS_AREAS.length} areas.`);
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

function missionScope(value = "page") {
  if (!AUDIT_MISSION_SCOPES.includes(value)) {
    throw new AuditError("INVALID_INPUT", "scope must be page or bounded-site.");
  }
  return value;
}

function routeLimit(value = 3) {
  if (!Number.isInteger(value) || value < 1 || value > 3) {
    throw new AuditError("INVALID_INPUT", "routeLimit must be an integer from one to three.");
  }
  return value;
}

function findingId(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 160) {
    throw new AuditError("INVALID_INPUT", "findingId must contain 1 to 160 characters.");
  }
  return value.trim();
}

function findingIds(value, fallback = null) {
  const values = Array.isArray(value) ? value : fallback == null ? [] : [fallback];
  if (values.length < 1 || values.length > 3) {
    throw new AuditError("INVALID_INPUT", "findingIds must contain between one and three finding IDs.");
  }
  const result = values.map(findingId);
  if (new Set(result).size !== result.length) {
    throw new AuditError("INVALID_INPUT", "findingIds must contain unique finding IDs.");
  }
  return result;
}

export function normalizeRepairFindingIds(primaryFindingId, values = undefined) {
  const retained = findingIds(values, primaryFindingId);
  const primary = findingId(primaryFindingId ?? retained[0]);
  if (retained[0] !== primary) {
    throw new AuditError("INVALID_INPUT", "findingId must be the first retained finding ID.");
  }
  return retained;
}

function repairPreparation(value) {
  if (value === null) return null;
  const preparation = inputObject(
    value,
    ["findingId", "findingIds", "requestedBy", "requestedAt"],
    "repairPreparation",
  );
  const retainedFindingIds = normalizeRepairFindingIds(preparation.findingId, preparation.findingIds);
  const primaryFindingId = retainedFindingIds[0];
  return {
    findingId: primaryFindingId,
    findingIds: retainedFindingIds,
    requestedBy: actor(preparation.requestedBy),
    requestedAt: timestamp(preparation.requestedAt, "repairPreparation.requestedAt"),
  };
}

export function auditMissionSnapshot(value) {
  const mission = inputObject(value, MISSION_FIELDS, "mission");
  if (![1, 2].includes(mission.schemaVersion)) {
    throw new AuditError("INVALID_INPUT", "mission.schemaVersion must be 1 or 2.");
  }
  return {
    schemaVersion: 2,
    intent: intent(mission.intent),
    focusAreas: focusAreas(mission.focusAreas),
    maxPriorities: maxPriorities(mission.maxPriorities),
    scope: mission.schemaVersion === 1 ? "page" : missionScope(mission.scope),
    routeLimit: mission.schemaVersion === 1 ? 3 : routeLimit(mission.routeLimit),
    requestedBy: actor(mission.requestedBy),
    requestedAt: timestamp(mission.requestedAt, "mission.requestedAt"),
    repairPreparation: repairPreparation(mission.repairPreparation),
  };
}

export function createAuditMission(input = {}, source = "human", now = Date.now()) {
  const value = inputObject(input, CREATE_FIELDS, "mission");
  return auditMissionSnapshot({
    schemaVersion: 2,
    intent: intent(value.intent),
    focusAreas: focusAreas(value.focusAreas),
    maxPriorities: maxPriorities(value.maxPriorities),
    scope: missionScope(value.scope),
    routeLimit: routeLimit(value.routeLimit),
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
    scope: mission.scope,
    routeLimit: mission.routeLimit,
    repairFindingIds: mission.repairPreparation?.findingIds ?? [],
  });
}

export function prepareRepairIntent(missionValue, selectedFindingId, source = "human", now = Date.now()) {
  const mission = auditMissionSnapshot(missionValue);
  const selected = findingIds(selectedFindingId, selectedFindingId);
  if (mission.repairPreparation) {
    if (JSON.stringify(mission.repairPreparation.findingIds) !== JSON.stringify(selected)) {
      throw new AuditError(
        "REPAIR_INTENT_CONFLICT",
        "This audit mission is already preparing a different frozen finding package for repair.",
      );
    }
    return mission;
  }
  return auditMissionSnapshot({
    ...mission,
    intent: "prepare-fix",
    repairPreparation: {
      findingId: selected[0],
      findingIds: selected,
      requestedBy: actor(source),
      requestedAt: timestamp(now, "repairPreparation.requestedAt"),
    },
  });
}

export function explorationAssessmentFindings(explorations = []) {
  const findings = [];
  const latest = (Array.isArray(explorations) ? explorations : [])
    .map((retained) => retained?.currentSnapshot ?? retained)
    .sort((left, right) => (right?.createdAt ?? 0) - (left?.createdAt ?? 0))[0] ?? null;
  for (const retained of latest ? [latest] : []) {
    const exploration = retained?.currentSnapshot ?? retained;
    if (exploration?.status !== "complete") continue;
    for (const issue of Array.isArray(exploration?.issues) ? exploration.issues : []) {
      const occurrences = (Array.isArray(issue?.occurrences) ? issue.occurrences : [])
        .slice(0, 8)
        .map((occurrence) => ({
          occurrenceId: occurrence?.occurrenceId ?? null,
          findingId: issue.findingId ?? occurrence?.findingId ?? `site:${exploration.id}:${issue.ruleId}`,
          sourceFindingId: occurrence?.sourceFindingId ?? null,
          auditId: occurrence?.auditId ?? null,
          path: occurrence?.path ?? "/",
          url: occurrence?.url ?? null,
          viewport: ["mobile", "desktop", "document"].includes(occurrence?.viewport)
            ? occurrence.viewport
            : ["mobile", "desktop", "document"].includes(occurrence?.strategy)
              ? occurrence.strategy
              : "document",
          strategy: occurrence?.strategy || "document",
          selector: occurrence?.selector ?? null,
          evidence: occurrence?.evidence || "Retained cross-page occurrence.",
          evidenceIds: Array.isArray(occurrence?.evidenceIds)
            ? occurrence.evidenceIds.slice(0, 4)
            : [],
          source: {
            provider: occurrence?.source?.provider ?? issue.provider,
            auditId: occurrence?.source?.auditId ?? issue.ruleId,
            strategy: occurrence?.source?.strategy ?? occurrence?.strategy ?? "document",
          },
        }));
      if (!occurrences.length) continue;
      const first = occurrences[0];
      const canonicalFindingId = issue.findingId ?? first.findingId;
      const occurrenceCount = issue.occurrenceCount ?? occurrences.length;
      const distinctPageCount = issue.distinctPageCount
        ?? new Set(occurrences.map((item) => item.auditId || item.path)).size;
      findings.push({
        id: canonicalFindingId,
        title: issue.title,
        severity: issue.severity,
        category: issue.category,
        focusAreas: Array.isArray(issue.focusAreas) ? issue.focusAreas : [],
        viewport: first.viewport,
        selector: first.selector,
        evidence: `${occurrenceCount} retained occurrence${occurrenceCount === 1 ? "" : "s"} across ${distinctPageCount} selected page${distinctPageCount === 1 ? "" : "s"}. ${first.path}: ${first.evidence}`,
        repair: issue.suggestedRepair,
        source: {
          provider: issue.provider,
          auditId: issue.ruleId,
          strategy: first.strategy,
        },
        route: {
          auditId: first.auditId,
          path: first.path,
          explorationId: exploration.id,
          occurrenceId: first.occurrenceId,
          sourceFindingId: first.sourceFindingId,
        },
        occurrences: occurrences.map((occurrence) => ({
          ...occurrence,
          findingId: canonicalFindingId,
        })),
        aggregateEvidence: {
          findingId: canonicalFindingId,
          explorationId: exploration.id,
          status: issue.status ?? "detected",
          occurrenceCount,
          distinctPageCount,
        },
      });
    }
  }
  return findings;
}

export function assessmentFindings(report, browserReview = null, explorations = []) {
  return [
    ...(Array.isArray(report?.findings) ? report.findings : []),
    ...explorationAssessmentFindings(explorations),
    ...browserReviewFindings(browserReview),
  ];
}

function explorationEvidenceReport(report, explorations) {
  const findings = explorationAssessmentFindings(explorations);
  return findings.length
    ? { ...report, findings: [...(report?.findings ?? []), ...findings] }
    : report;
}

function expandedProviderOccurrences(providerFindings, browserFindings) {
  const retained = providerFindings.length ? providerFindings : browserFindings;
  return retained.flatMap((finding) => finding.occurrences?.length
    ? finding.occurrences.map((occurrence) => ({
        ...finding,
        findingId: occurrence.findingId ?? finding.findingId,
        strategy: occurrence.strategy ?? finding.strategy,
        viewport: occurrence.viewport ?? finding.viewport,
        selector: occurrence.selector ?? finding.selector,
        evidence: occurrence.evidence ?? finding.evidence,
        route: {
          auditId: occurrence.auditId,
          path: occurrence.path,
          explorationId: finding.route?.explorationId,
          occurrenceId: occurrence.occurrenceId,
          sourceFindingId: occurrence.sourceFindingId,
        },
      }))
    : [finding]);
}

export function focusedAuditPriorities(
  report,
  missionValue,
  diagnosticMissions = [],
  browserReview = null,
  repairs = [],
  explorations = [],
) {
  const mission = auditMissionSnapshot(missionValue);
  const reconciled = reconcileAssessmentEvidence({
    report: explorationEvidenceReport(report, explorations),
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
    const occurrenceFindings = expandedProviderOccurrences(providerFindings, browserFindings);
    const affectedStrategies = [...new Set(occurrenceFindings.map((entry) => entry.strategy).filter(Boolean))];
    const distinctPageKeys = new Set(
      occurrenceFindings
        .map((entry) => entry.route?.auditId || entry.route?.path)
        .filter(Boolean),
    );
    if (occurrenceFindings.some((entry) => !entry.route?.auditId && !entry.route?.path)) {
      distinctPageKeys.add("root-audit");
    }
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
      distinctPageCount: Math.max(1, distinctPageKeys.size),
      affectedStrategies,
      evidenceProvenance: providerFindings.length
        ? "measured-provider"
        : item.evidenceRecords.browser?.provenance ?? "agent-reported-browser",
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
      (EVIDENCE_ORDER[left.relationship] ?? 2) - (EVIDENCE_ORDER[right.relationship] ?? 2) ||
      right.distinctPageCount - left.distinctPageCount ||
      right.occurrenceCount - left.occurrenceCount ||
      left.sourceIndex - right.sourceIndex,
    )
    .slice(0, mission.maxPriorities)
    .map(({ sourceIndex: _sourceIndex, ...priority }, index) => ({
      rank: index + 1,
      ...priority,
      whyPrioritized: `${priority.severity} severity · ${priority.relationship}${priority.distinctPageCount > 1 ? ` · ${priority.distinctPageCount} affected pages` : ""}${priority.occurrenceCount > 1 ? ` · ${priority.occurrenceCount} retained occurrences` : ""}`,
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
      const providerCount = (item.evidenceRecords.provider?.findings ?? []).reduce(
        (count, finding) => count + Math.max(1, finding.occurrences?.length ?? 0),
        0,
      );
      const browserCount = item.evidenceRecords.provider ? 0 : item.evidenceRecords.browser?.findings?.length ?? 0;
      return total + providerCount + browserCount;
    }, 0),
    categoryScores,
    priorities,
  };
}

function boundedSiteState(report, mission, explorations, { routeDiscoveryPending = false } = {}) {
  const routeCandidates = report
    ? createSiteRouteCandidates(report).slice(0, mission.routeLimit)
    : [];
  if (mission.scope !== "bounded-site") {
    return {
      requested: false,
      status: "not-requested",
      routeLimit: mission.routeLimit,
      routeCandidates,
      explorationId: null,
      pagesRequested: 0,
      pagesComplete: 0,
      pagesFailed: 0,
      terminal: true,
      blockedReason: null,
    };
  }
  const exploration = [...(Array.isArray(explorations) ? explorations : [])]
    .map((retained) => retained?.currentSnapshot ?? retained)
    .sort((left, right) => (right?.createdAt ?? 0) - (left?.createdAt ?? 0))[0] ?? null;
  if (!routeCandidates.length) {
    if (routeDiscoveryPending) {
      return {
        requested: true,
        status: "awaiting-route-discovery",
        routeLimit: mission.routeLimit,
        routeCandidates,
        explorationId: null,
        pagesRequested: 0,
        pagesComplete: 0,
        pagesFailed: 0,
        terminal: false,
        blockedReason: null,
      };
    }
    return {
      requested: true,
      status: "blocked",
      routeLimit: mission.routeLimit,
      routeCandidates,
      explorationId: null,
      pagesRequested: 0,
      pagesComplete: 0,
      pagesFailed: 0,
      terminal: true,
      blockedReason: "The retained document and rendered-browser evidence produced no server-validated same-site route candidates.",
    };
  }
  if (!exploration) {
    return {
      requested: true,
      status: "not-started",
      routeLimit: mission.routeLimit,
      routeCandidates,
      explorationId: null,
      pagesRequested: 0,
      pagesComplete: 0,
      pagesFailed: 0,
      terminal: false,
      blockedReason: null,
    };
  }
  const terminal = ["complete", "partial", "failed"].includes(exploration.status);
  return {
    requested: true,
    status: exploration.status,
    routeLimit: mission.routeLimit,
    routeCandidates,
    explorationId: exploration.id,
    pagesRequested: exploration.summary?.pagesRequested ?? exploration.children?.length ?? 0,
    pagesComplete: exploration.summary?.pagesComplete ?? 0,
    pagesFailed: exploration.summary?.pagesFailed ?? 0,
    terminal,
    blockedReason: ["partial", "failed"].includes(exploration.status)
      ? "One or more retained route audits failed, so bounded-site coverage is explicitly incomplete."
      : null,
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
  explorations = [],
}) {
  const mission = auditMissionSnapshot(missionValue);
  const projection = focusedAuditPriorities(
    report,
    mission,
    diagnosticMissions,
    browserReview,
    repairs,
    explorations,
  );
  const reviewPolicy = browserReviewPolicy(mission, browserReview);
  const reviewRequired = browserReviewRequired(mission, browserReview);
  const reviewAdoptionAvailable = browserReviewAdoptionAvailable(mission, browserReview);
  const reviewState = browserReview ? browserReviewState(browserReview) : null;
  const initialReviewOutstanding = reviewRequired && !reviewState?.complete;
  const siteScope = boundedSiteState(report, mission, explorations, {
    routeDiscoveryPending: initialReviewOutstanding,
  });
  const explorationFindings = siteScope.status === "complete"
    ? explorationAssessmentFindings(explorations)
    : [];
  const explorationReviewTasks = reviewRequired
    && reviewState?.complete
    && explorationFindings.length
    ? browserReviewInvestigationGap(browserReview, {
        report: { ...report, findings: explorationFindings },
        mission,
        target: report?.finalUrl ?? report?.url,
      })
    : [];
  const reviewExtensionPending = explorationReviewTasks.length > 0;
  const reviewOutstanding = initialReviewOutstanding || reviewExtensionPending;
  const requestedBrowserCheckCount = (reviewState?.requestedCheckCount
    ?? (reviewRequired ? browserReviewChecksForMission(mission).length : 0))
    + explorationReviewTasks.length;
  const unresolved = projection.priorities.find((priority) => diagnosticNextAction(priority));
  const blocked = projection.priorities.find(
    (priority) => priority.evidenceState === "diagnosis-blocked",
  );
  const measurementComplete = Boolean(report);
  // Retained for compatibility with existing clients. New code should use the
  // narrower measurementComplete name and assessmentComplete separately.
  const auditComplete = measurementComplete;
  let status = measurementComplete ? "complete" : "in-progress";
  let nextActor = measurementComplete ? null : "agent";
  let nextAction = measurementComplete
    ? null
    : {
        tool: "check_site_audit_progress",
        input: {},
        reason: "The measurement job has not produced a completed report yet.",
      };

  if (auditComplete && initialReviewOutstanding) {
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

  if (auditComplete && !initialReviewOutstanding && siteScope.requested) {
    if (siteScope.status === "not-started") {
      status = "action-available";
      nextActor = "agent";
      nextAction = {
        tool: "start_site_exploration",
        input: { routeCandidateIds: siteScope.routeCandidates.map((candidate) => candidate.id) },
        reason: "The bounded-site mission must retain its server-issued route coverage before the assessment can finish.",
      };
    } else if (!siteScope.terminal) {
      status = "in-progress";
      nextActor = "agent";
      nextAction = {
        tool: "get_site_exploration",
        input: { missionId: siteScope.explorationId },
        reason: "The retained route audits are still running.",
      };
    } else if (siteScope.status !== "complete") {
      status = "blocked";
      nextActor = null;
      nextAction = null;
    }
  }

  const siteScopeSuccessful = !siteScope.requested || siteScope.status === "complete";
  if (auditComplete && siteScopeSuccessful && reviewExtensionPending) {
    status = "action-available";
    nextActor = "agent";
    nextAction = {
      tool: "open_browser_review",
      input: {},
      reason: "The completed bounded-site exploration discovered exact route-level evidence. Extend the root browser review before treating the ranking as final.",
    };
  }

  if (auditComplete && siteScopeSuccessful && !reviewOutstanding && unresolved) {
    status = unresolved.evidenceState === "diagnosis-recommended" ? "action-available" : "in-progress";
    nextActor = "agent";
    nextAction = diagnosticNextAction(unresolved);
  }

  if (auditComplete && siteScopeSuccessful && !reviewOutstanding && !unresolved && blocked) {
    status = "blocked";
    nextActor = null;
    nextAction = null;
  }

  const assessmentComplete = measurementComplete
    && !reviewOutstanding
    && !unresolved
    && !blocked
    && siteScopeSuccessful;
  const pendingRoutes = siteScope.requested
    ? siteScope.status === "not-started" || siteScope.status === "awaiting-route-discovery"
      ? siteScope.routeCandidates.length
      : Math.max(0, siteScope.pagesRequested - siteScope.pagesComplete)
    : 0;
  const rankingStatus = measurementComplete && siteScopeSuccessful && !reviewOutstanding
    ? "final"
    : "provisional";
  if (assessmentComplete && siteScopeSuccessful && mission.intent === "prepare-fix" && !mission.repairPreparation) {
    status = "awaiting-repair-preparation";
    nextActor = "person";
    nextAction = null;
  }

  if (assessmentComplete && siteScopeSuccessful && mission.repairPreparation && !reviewOutstanding && !unresolved && !blocked) {
    const selectedIds = mission.repairPreparation.findingIds;
    const selectedPriorities = selectedIds.map((selectedId) => projection.priorities.find(
      (priority) => priority.findingId === selectedId,
    )).filter(Boolean);
    const agentRepositoryTraceRequired = mission.repairPreparation.requestedBy === "agent";
    const repositoryTracePriority = agentRepositoryTraceRequired
      ? selectedPriorities.find((priority) => diagnosticMissions.find(
          (diagnostic) => diagnostic.findingId === priority.findingId,
        )?.state?.state !== "ready-for-repair")
      : null;
    const repositoryTraceMission = repositoryTracePriority
      ? diagnosticMissions.find((diagnostic) => diagnostic.findingId === repositoryTracePriority.findingId) ?? null
      : null;
    const diagnosticPriority = selectedPriorities.find((priority) => diagnosticNextAction({
      findingId: priority.findingId,
      evidenceState: priority.evidenceState,
      diagnosticMissionId: priority.diagnosticMissionId,
      nextAction: priority.nextAction,
    }));
    const repair = repairs.find((item) => {
      const repairIds = item?.findingIds ?? (item?.findingId ? [item.findingId] : []);
      return JSON.stringify(repairIds) === JSON.stringify(selectedIds);
    });
    status = "action-available";
    nextActor = "agent";
    const repairNext = repairMissionContinuation(repair);
    if (repositoryTracePriority) {
      if (!repositoryTraceMission) {
        nextAction = {
          tool: "open_diagnostic_mission",
          input: { findingId: repositoryTracePriority.findingId },
          reason: "Trace the selected finding to repository-relative source ownership and exact checks before proposing a patch.",
        };
      } else if (repositoryTraceMission.state?.state === "blocked") {
        status = "blocked";
        nextActor = null;
        nextAction = null;
      } else {
        status = "in-progress";
        nextAction = {
          tool: "submit_runtime_diagnosis",
          input: { missionId: repositoryTraceMission.id },
          reason: "Contribute the bounded browser reproduction, repository-relative ownership, and planned checks before proposing a patch.",
        };
      }
    } else {
      nextAction = diagnosticPriority
        ? diagnosticNextAction({
            findingId: diagnosticPriority.findingId,
            evidenceState: diagnosticPriority.evidenceState,
            diagnosticMissionId: diagnosticPriority.diagnosticMissionId,
            nextAction: diagnosticPriority.nextAction,
          })
        : (repairNext
        ? repairNext.nextAction
        : {
            tool: "stage_site_repair",
            input: selectedIds.length > 1
              ? { findingId: selectedIds[0], findingIds: selectedIds }
              : { findingId: selectedIds[0] },
            reason: selectedIds.length > 1
              ? "Prepare one bounded repair package for the explicitly selected diagnosed findings."
              : "Prepare a bounded repair draft for the explicitly selected finding.",
          });
      if (!diagnosticPriority && repairNext) {
        status = repairNext.status;
        nextActor = repairNext.nextActor;
      }
    }
  }

  return {
    intent: mission.intent,
    status,
    checkpointStatus: status,
    auditComplete,
    measurementComplete,
    assessmentStatus: assessmentComplete ? "complete" : status === "blocked" ? "blocked" : "incomplete",
    explorationStatus: siteScope.status,
    evidenceSnapshotAvailable: measurementComplete,
    assessmentReceiptAvailable: assessmentComplete,
    assessmentComplete,
    requestedFocusAreas: projection.requestedFocusAreas,
    priorityCount: projection.priorities.length,
    matchingFindingCount: projection.matchingFindingCount,
    categoryScores: projection.categoryScores,
    priorities: projection.priorities,
    rankingStatus,
    scopeVersion: mission.schemaVersion,
    pendingRoutes,
    priorityRanking: {
      status: rankingStatus,
      scopeVersion: mission.schemaVersion,
      pendingRoutes,
      pendingBrowserChecks: reviewOutstanding
        ? Math.max(0, requestedBrowserCheckCount - (reviewState?.completedCheckCount ?? 0))
        : 0,
      reason: rankingStatus === "final"
        ? "The retained route scope and required browser evidence are complete."
        : siteScope.requested && !siteScopeSuccessful
          ? "Bounded route evidence is still being collected, so priorities may change."
          : "Required rendered-browser evidence is still being collected, so priorities may change.",
    },
    browserReview: {
      required: reviewRequired,
      policy: reviewPolicy.mode,
      policyReason: reviewPolicy.reason,
      policyFocusAreas: reviewPolicy.areas,
      adoptionAvailable: reviewAdoptionAvailable,
      adoptedFromHumanMission: browserReview?.adoption?.mode === "human-to-agent",
      adoption: browserReview?.adoption ? { ...browserReview.adoption } : null,
      status: reviewState?.status === "withdrawn"
        ? "withdrawn"
        : reviewExtensionPending
          ? "coverage-required"
        : reviewRequired ? reviewState?.status ?? "not-opened" : "not-required",
      reviewId: browserReview?.id ?? null,
      requestedCheckCount: requestedBrowserCheckCount,
      completedCheckCount: reviewState?.completedCheckCount ?? 0,
      issueCount: reviewState?.issueCount ?? 0,
      blockedCheckCount: reviewState?.blockedCheckCount ?? 0,
      nextCheck: reviewState?.nextCheck ?? null,
      extensionRequired: reviewExtensionPending,
      extensionChecks: explorationReviewTasks,
      withdrawalAvailable: reviewState?.withdrawalAvailable ?? false,
      withdrawal: reviewState?.withdrawal ?? null,
      provenance: browserReview ? browserReviewProvenance(browserReview) : null,
    },
    siteScope,
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
