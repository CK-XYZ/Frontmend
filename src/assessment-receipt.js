import { auditMissionSnapshot, deriveAuditMissionState } from "./audit-mission-contract.js";
import { browserReviewSnapshot } from "./browser-review-contract.js";
import { diagnosticEvidenceChain, diagnosticMissionSnapshot } from "./diagnostic-contract.js";
import { AuditError } from "./url-policy.js";
import { createBuildDescriptor } from "./protocol-contract.js";
import { activityLedgerBoundary, activityLedgerSnapshot } from "./activity-ledger-contract.js";
import { evidenceAdapterReceiptSnapshot } from "./evidence-adapter-contract.js";

const MAX_PRIORITIES = 5;

function text(value, maximum = 400) {
  return String(value ?? "").replace(/\r\n/g, "\n").trim().slice(0, maximum);
}

function markdownText(value, maximum = 400) {
  return text(value, maximum)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\\`*_{}[\]]/g, "\\$&")
    .replace(/\|/g, "\\|")
    .replace(/\s+/g, " ") || "—";
}

function timestamp(value) {
  if (!Number.isFinite(value)) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toISOString();
}

function boundedDiagnosis(mission) {
  if (!mission?.diagnosis) return null;
  const diagnosis = mission.diagnosis;
  return {
    revision: Number.isInteger(diagnosis.revision) ? Math.max(1, diagnosis.revision) : 1,
    provenance: diagnosis.agentReported ? "agent-reported" : "person-reported",
    summary: text(diagnosis.summary, 300),
    reproduction: text(diagnosis.reproduction, 600),
    observations: (diagnosis.observations ?? []).slice(0, 5).map((observation) => ({
      kind: text(observation?.kind, 40),
      detail: text(observation?.detail, 400),
    })),
    sourceLocations: (diagnosis.sourceLocations ?? []).slice(0, 8).map((location) => ({
      file: text(location?.file, 200),
      line: Number.isInteger(location?.line) ? location.line : null,
      symbol: location?.symbol == null ? null : text(location.symbol, 120),
      reason: text(location?.reason, 300),
    })),
    verificationChecks: (diagnosis.verificationChecks ?? []).slice(0, 8).map((check) => text(check, 120)),
    confidence: ["low", "medium", "high"].includes(diagnosis.confidence)
      ? diagnosis.confidence
      : "low",
    reportedAt: Number.isFinite(diagnosis.reportedAt) ? diagnosis.reportedAt : null,
  };
}

function findingSource(report, findingId) {
  const finding = (report?.findings ?? []).find((candidate) => candidate?.id === findingId);
  return {
    provider: text(finding?.source?.provider ?? report?.engine?.provider ?? "unknown", 120),
    auditId: text(finding?.source?.auditId ?? findingId, 160),
  };
}

export function createAssessmentReceipt({
  report,
  mission: missionValue,
  diagnosticMissions = [],
  browserReview: browserReviewValue = null,
  repairs = [],
  explorations = [],
  activities = [],
  build = createBuildDescriptor(),
}) {
  if (!report?.auditId || !report?.engine?.provider) {
    throw new AuditError(
      "ASSESSMENT_RECEIPT_UNAVAILABLE",
      "A completed audit report is required before an assessment receipt can be created.",
    );
  }
  const mission = auditMissionSnapshot(missionValue);
  const diagnostics = (Array.isArray(diagnosticMissions) ? diagnosticMissions : [])
    .slice(0, 10)
    .map(diagnosticMissionSnapshot);
  const browserReview = browserReviewValue ? browserReviewSnapshot(browserReviewValue) : null;
  const state = deriveAuditMissionState({
    report,
    mission,
    diagnosticMissions: diagnostics,
    browserReview,
    repairs,
    explorations,
  });
  if (!state.assessmentComplete) {
    const action = state.nextAction?.tool
      ? ` Complete ${state.nextAction.tool} first.`
      : " Complete the outstanding retained audit evidence first.";
    throw new AuditError(
      "ASSESSMENT_INCOMPLETE",
      `The assessment receipt is unavailable while required evidence is incomplete.${action}`,
    );
  }
  const diagnosticByFinding = new Map(diagnostics.map((item) => [item.findingId, item]));
  const selectedRepairFindingIds = new Set(mission.repairPreparation?.findingIds ?? []);
  const priorities = state.priorities.slice(0, MAX_PRIORITIES).map((priority) => {
    const diagnostic = diagnosticByFinding.get(priority.findingId) ?? null;
    const repairDiagnosisStatus = diagnostic?.diagnosis
      ? "contributed"
      : diagnostic?.blocker
        ? "blocked"
        : selectedRepairFindingIds.has(priority.findingId)
          ? "required"
          : "not-started";
    const occurrences = (priority.evidenceRecords?.provider?.findings ?? [])
      .flatMap((finding) => finding.occurrences ?? [])
      .slice(0, 8)
      .map((occurrence) => ({
        occurrenceId: occurrence.occurrenceId ? text(occurrence.occurrenceId, 80) : null,
        auditId: occurrence.auditId ? text(occurrence.auditId, 160) : null,
        path: text(occurrence.path || "/", 256),
        viewport: text(occurrence.viewport ?? occurrence.strategy ?? "document", 40),
        selector: occurrence.selector ? text(occurrence.selector, 200) : null,
        evidence: text(occurrence.evidence, 600),
        evidenceIds: (occurrence.evidenceIds ?? []).slice(0, 4).map((item) => text(item, 240)),
      }));
    return {
      rank: priority.rank,
      findingId: text(priority.findingId, 160),
      title: text(priority.title, 240),
      severity: text(priority.severity, 40),
      category: text(priority.category, 80),
      focusAreas: (priority.focusAreas ?? []).slice(0, 5).map((area) => text(area, 40)),
      evidence: text(priority.evidence, 600),
      occurrenceCount: Math.max(1, Math.min(8, priority.occurrenceCount ?? 1)),
      affectedStrategies: (priority.affectedStrategies ?? []).slice(0, 8).map((strategy) => text(strategy, 40)),
      measuredSource: priority.source?.provider
        ? {
            provider: text(priority.source.provider, 120),
            auditId: text(priority.source.auditId ?? priority.findingId, 160),
          }
        : findingSource(report, priority.findingId),
      evidenceProvenance: text(priority.evidenceProvenance, 80),
      evidenceState: text(priority.evidenceState, 60),
      relationship: text(priority.relationship, 60),
      relationshipReason: text(priority.relationshipReason, 500),
      unresolvedRequirement: priority.unresolvedRequirement
        ? text(priority.unresolvedRequirement, 500)
        : null,
      provenance: (priority.provenance ?? []).slice(0, 4).map((record) => ({
        kind: text(record.kind, 40),
        provenance: text(record.provenance, 80),
        sourceId: record.sourceId ? text(record.sourceId, 200) : null,
        recordedAt: Number.isFinite(record.recordedAt) ? record.recordedAt : null,
      })),
      evidenceRecords: priority.evidenceRecords,
      occurrences,
      diagnosticMissionId: diagnostic?.id ?? null,
      repairDiagnosisStatus,
      evidenceChain: diagnostic
        ? diagnostic.evidenceChain ?? diagnosticEvidenceChain(diagnostic)
        : null,
      diagnosis: boundedDiagnosis(diagnostic),
    };
  });
  return {
    schemaVersion: 1,
    build: createBuildDescriptor(build),
    receiptId: `assessment:${text(report.auditId, 80)}:v1`,
    auditId: text(report.auditId, 80),
    target: text(report.url, 2_048),
    finalUrl: text(report.finalUrl ?? report.url, 2_048),
    completedAt: Number.isFinite(report.completedAt) ? report.completedAt : null,
    engine: {
      mode: text(report.engine.mode, 80),
      provider: text(report.engine.provider, 120),
      lighthouseVersion: report.engine.lighthouseVersion
        ? text(report.engine.lighthouseVersion, 80)
        : null,
      adapters: (report.coverage?.adapters ?? [])
        .map(evidenceAdapterReceiptSnapshot)
        .filter(Boolean)
        .slice(0, 4),
    },
    mission: {
      intent: mission.intent,
      focusAreas: [...mission.focusAreas],
      maxPriorities: mission.maxPriorities,
      scope: mission.scope,
      routeLimit: mission.routeLimit,
      requestedBy: mission.requestedBy,
      requestedAt: mission.requestedAt,
      repairPreparation: mission.repairPreparation
        ? {
            findingIds: [...mission.repairPreparation.findingIds],
            requestedBy: mission.repairPreparation.requestedBy,
            requestedAt: mission.repairPreparation.requestedAt,
          }
        : null,
    },
    assessment: {
      complete: true,
      matchingFindingCount: state.matchingFindingCount,
      priorityCount: priorities.length,
      categoryScores: { ...state.categoryScores },
      siteScope: state.siteScope,
      rankingStatus: state.rankingStatus,
      scopeVersion: state.scopeVersion,
      pendingRoutes: state.pendingRoutes,
      repairReadiness: state.repairReadiness,
    },
    browserReview: browserReview
      ? {
          id: browserReview.id,
          provenance: browserReview.authority.provenance,
          status: browserReview.state.status,
          withdrawal: browserReview.withdrawal ? { ...browserReview.withdrawal } : null,
          requestedFocusAreas: [...browserReview.requestedFocusAreas],
          requestedCheckCount: browserReview.state.requestedCheckCount,
          completedCheckCount: browserReview.state.completedCheckCount,
          issueCount: browserReview.state.issueCount,
          checks: browserReview.results.map((result) => ({
            checkId: text(result.checkId, 80),
            label: text(
              browserReview.requestedChecks.find((check) => check.id === result.checkId)?.label,
              120,
            ),
            outcome: text(result.outcome, 40),
            source: result.source === "person" ? "person" : "agent",
            provenance: result.source === "person" ? "person-reported-browser" : "agent-reported-browser",
            summary: text(result.summary, 300),
            observations: result.observations.slice(0, 4).map((item) => text(item, 400)),
            observedRoutes: (result.observedRoutes ?? []).slice(0, 8).map((item) => text(item, 256)),
            reportedAt: Number.isFinite(result.reportedAt) ? result.reportedAt : null,
          })),
        }
      : null,
    activityLedger: {
      ...activityLedgerBoundary,
      entries: activityLedgerSnapshot(activities, report.auditId),
    },
    priorities,
    authority: {
      sourceContentsReceived: false,
      repairApprovalProved: false,
      implementationProved: false,
      deploymentProved: false,
      resolutionProved: false,
      boundary: "This receipt proves a completed bounded audit with separately attributed provider and browser evidence. Repository diagnosis is a later, optional repair-preparation contribution and is not required to finalise the ranking; this receipt does not prove repair approval, implementation, deployment, or resolution.",
    },
  };
}

export function assessmentReceiptMarkdown(receipt) {
  if (!receipt?.auditId || receipt?.assessment?.complete !== true) {
    throw new AuditError(
      "ASSESSMENT_RECEIPT_UNAVAILABLE",
      "A completed structured assessment receipt is required.",
    );
  }
  const lines = [
    "# Frontmend assessment receipt",
    "",
    "> Completed bounded audit only. Provider and browser evidence determine the final ranking; optional repository diagnosis belongs to later repair preparation and remains separately attributed. This artifact does not prove a repair, deployment, or resolution.",
    "",
    `- Target: ${markdownText(receipt.target, 2_048)}`,
    `- Final URL: ${markdownText(receipt.finalUrl, 2_048)}`,
    `- Audit ID: \`${markdownText(receipt.auditId, 80)}\``,
    `- Completed: ${timestamp(receipt.completedAt)}`,
    `- Frontmend build: ${receipt.build?.commit ? `\`${markdownText(receipt.build.commit, 40)}\`` : "unidentified"}`,
    `- Protocol: v${Number.isInteger(receipt.build?.protocolVersion) ? receipt.build.protocolVersion : 1}; tool library v${Number.isInteger(receipt.build?.toolLibraryVersion) ? receipt.build.toolLibraryVersion : 1}; ${Number.isInteger(receipt.build?.toolCount) ? receipt.build.toolCount : "unknown"} contracts`,
    `- Evidence mode: ${markdownText(receipt.engine?.mode, 80)}`,
    `- Provider: ${markdownText(receipt.engine?.provider, 120)}`,
    `- Lighthouse version: ${receipt.engine?.lighthouseVersion ? markdownText(receipt.engine.lighthouseVersion, 80) : "not used"}`,
    "",
  ];
  if (receipt.engine?.adapters?.length) {
    lines.push(
      "## Evidence adapters",
      "",
      "| Adapter | Provider | Kind | Status | Evidence version | Measured conditions |",
      "| --- | --- | --- | --- | --- | --- |",
      ...receipt.engine.adapters.map((adapter) =>
        `| ${markdownText(adapter.adapterId, 80)} | ${markdownText(adapter.provider, 120)} | ${markdownText(adapter.kind, 60)} | ${markdownText(adapter.status, 40)} | ${markdownText(adapter.evidenceVersion ?? adapter.lighthouseVersion ?? (adapter.ruleSetVersion ? `rules-${adapter.ruleSetVersion}` : "not reported"), 80)} | ${(adapter.measuredConditions ?? []).map((item) => markdownText(item, 40)).join(", ") || "none"} |`,
      ),
      "",
      ...receipt.engine.adapters.map((adapter) =>
        `- ${markdownText(adapter.adapterId, 80)} boundary: ${markdownText(adapter.claimBoundary, 360)}`,
      ),
      "",
    );
  }
  lines.push(
    "## Assessment mission",
    "",
    `- Intent: ${markdownText(receipt.mission?.intent, 40)}`,
    `- Scope: ${markdownText(receipt.mission?.scope ?? "page", 40)}`,
    `- Focus: ${receipt.mission?.focusAreas?.length ? receipt.mission.focusAreas.map((area) => markdownText(area, 40)).join(", ") : "all supported areas"}`,
    `- Requested by: ${markdownText(receipt.mission?.requestedBy, 40)}`,
    `- Assessment complete: yes`,
    `- Priority ranking: ${markdownText(receipt.assessment?.rankingStatus ?? "final", 40)} (scope v${receipt.assessment?.scopeVersion ?? 2})`,
    `- Repair diagnosis: ${receipt.mission?.repairPreparation ? markdownText(receipt.assessment?.repairReadiness?.status ?? "in-progress", 40) : "not started; explicit repair selection required"}`,
    `- Matching findings: ${Number.isFinite(receipt.assessment?.matchingFindingCount) ? receipt.assessment.matchingFindingCount : "—"}`,
    `- Ranked priorities: ${receipt.priorities?.length ?? 0}`,
  );
  if (receipt.assessment?.siteScope?.requested) {
    lines.push(
      "",
      "## Bounded-site coverage",
      "",
      `- Status: ${markdownText(receipt.assessment.siteScope.status, 40)}`,
      `- Retained route limit: ${receipt.assessment.siteScope.routeLimit ?? 3}`,
      `- Pages complete: ${receipt.assessment.siteScope.pagesComplete ?? 0} of ${receipt.assessment.siteScope.pagesRequested ?? 0}`,
      `- Pages failed: ${receipt.assessment.siteScope.pagesFailed ?? 0}`,
      `- Limitation: ${receipt.assessment.siteScope.blockedReason ? markdownText(receipt.assessment.siteScope.blockedReason, 500) : "none"}`,
    );
  }
  if (receipt.browserReview) {
    lines.push(
      "",
      receipt.browserReview.status === "withdrawn"
        ? "## Rendered-review handoff"
        : "## Contributed rendered-browser review",
      "",
      `- Provenance: ${markdownText(receipt.browserReview.provenance, 80)}`,
      `- Status: ${markdownText(receipt.browserReview.status, 40)}`,
      `- Coverage: ${receipt.browserReview.completedCheckCount} of ${receipt.browserReview.requestedCheckCount} requested checks`,
      `- Browser-observed issues: ${receipt.browserReview.issueCount}`,
    );
    if (receipt.browserReview.status === "withdrawn") {
      lines.push(
        `- Handoff: withdrawn by the person before any browser evidence was recorded`,
        `- History: retained as an untouched optional handoff; provider evidence remains the assessment basis`,
      );
    }
    for (const check of receipt.browserReview.checks ?? []) {
      lines.push(
        "",
        `### ${markdownText(check.label, 120)}`,
        "",
        `- Outcome: ${markdownText(check.outcome, 40)}`,
        `- Provenance: ${markdownText(check.provenance, 80)}`,
        `- Summary: ${markdownText(check.summary, 300)}`,
        `- Reported: ${timestamp(check.reportedAt)}`,
        ...check.observations.map((observation) => `- Observed: ${markdownText(observation, 400)}`),
        ...(check.observedRoutes ?? []).map((path) => `- Server-validated rendered route: ${markdownText(path, 256)}`),
      );
    }
  }
  lines.push(
    "",
    "## Semantic activity ledger",
    "",
    `- Retention: ${markdownText(receipt.activityLedger?.retention ?? "last-20-per-audit", 80)}`,
    `- Excluded: ${(receipt.activityLedger?.excluded ?? []).map((item) => markdownText(item, 80)).join(", ") || "URLs, prompts, tool inputs, patches, source contents, credentials, secrets"}`,
  );
  if (receipt.activityLedger?.entries?.length) {
    lines.push(
      "",
      "| Actor | Tool | Status | Mission revision | Related records | Completed |",
      "| --- | --- | --- | --- | --- | --- |",
      ...receipt.activityLedger.entries.map((entry) => {
        const related = [
          entry.repairId ? `repair ${entry.repairId}` : null,
          entry.diagnosticMissionId ? `diagnosis ${entry.diagnosticMissionId}` : null,
          entry.browserReviewId ? `browser review ${entry.browserReviewId}` : null,
          entry.explorationId ? `exploration ${entry.explorationId}` : null,
          entry.errorCode ? `error ${entry.errorCode}` : null,
        ].filter(Boolean).join("; ") || "—";
        return `| ${markdownText(entry.actorClass, 40)} | \`${entry.tool}\` | ${markdownText(entry.status, 40)} | ${entry.missionRevisionBefore} → ${entry.missionRevisionAfter} | ${markdownText(related, 400)} | ${timestamp(entry.completedAt)} |`;
      }),
    );
  } else {
    lines.push("- Entries: none retained for this audit");
  }
  for (const priority of receipt.priorities ?? []) {
    lines.push(
      "",
      `## ${priority.rank}. ${markdownText(priority.title, 240)}`,
      "",
      `- Severity: ${markdownText(priority.severity, 40)}`,
      `- Category: ${markdownText(priority.category, 80)}`,
      `- Evidence source: ${markdownText(priority.measuredSource?.provider, 120)} · ${markdownText(priority.measuredSource?.auditId, 160)}`,
      `- Evidence provenance: ${markdownText(priority.evidenceProvenance, 80)}`,
      `- Evidence relationship: ${markdownText(priority.relationship, 80)}`,
      `- Relationship reason: ${markdownText(priority.relationshipReason, 500)}`,
      `- Repair diagnosis: ${markdownText(priority.repairDiagnosisStatus ?? "not-started", 40)}`,
      `- Repair-preparation requirement: ${priority.unresolvedRequirement ? markdownText(priority.unresolvedRequirement, 500) : "none"}`,
      `- Strategies: ${priority.affectedStrategies?.length ? priority.affectedStrategies.map((strategy) => markdownText(strategy, 40)).join(", ") : "document"}`,
      `- Occurrences: ${priority.occurrenceCount}`,
      `- Measured evidence: ${markdownText(priority.evidence, 600)}`,
    );
    if (priority.occurrences?.length) {
      lines.push(
        "",
        "### Retained occurrences",
        "",
        "| Route | Viewport | Selector | Evidence ID |",
        "| --- | --- | --- | --- |",
        ...priority.occurrences.map((occurrence) =>
          `| ${markdownText(occurrence.path, 256)} | ${markdownText(occurrence.viewport, 40)} | ${markdownText(occurrence.selector ?? "not retained", 200)} | ${markdownText(occurrence.evidenceIds?.join(", ") || occurrence.occurrenceId || "not retained", 300)} |`,
        ),
      );
    }
    if (priority.evidenceChain?.stages?.length) {
      lines.push(
        "",
        "### Evidence chain",
        "",
        "| Stage | State | Provenance | Items |",
        "| --- | --- | --- | ---: |",
        ...priority.evidenceChain.stages.map((stage) =>
          `| ${markdownText(stage.label, 80)} | ${markdownText(stage.state, 40)} | ${markdownText(stage.provenance ?? "not contributed", 80)} | ${Number.isFinite(stage.itemCount) ? stage.itemCount : 0} |`,
        ),
      );
    }
    if (priority.diagnosis) {
      const diagnosis = priority.diagnosis;
      lines.push(
        "",
        "### Contributed diagnosis",
        "",
        `- Provenance: ${markdownText(diagnosis.provenance, 80)}`,
        `- Confidence: ${markdownText(diagnosis.confidence, 40)}`,
        `- Summary: ${markdownText(diagnosis.summary, 300)}`,
        `- Reproduction: ${markdownText(diagnosis.reproduction, 600)}`,
      );
      if (diagnosis.observations.length) {
        lines.push("", "Browser observations:", ...diagnosis.observations.map((item) =>
          `- ${markdownText(item.kind, 40)}: ${markdownText(item.detail, 400)}`,
        ));
      }
      if (diagnosis.sourceLocations.length) {
        lines.push("", "Repository ownership:", ...diagnosis.sourceLocations.map((item) =>
          `- \`${markdownText(item.file, 200)}${item.line ? `:${item.line}` : ""}\`${item.symbol ? ` · ${markdownText(item.symbol, 120)}` : ""} — ${markdownText(item.reason, 300)}`,
        ));
      }
      if (diagnosis.verificationChecks.length) {
        lines.push("", "Planned checks:", ...diagnosis.verificationChecks.map((check) =>
          `- \`${markdownText(check, 120)}\``,
        ));
      }
    }
  }
  lines.push(
    "",
    "## Authority boundary",
    "",
    `> ${markdownText(receipt.authority?.boundary, 500)}`,
    "",
  );
  return lines.join("\n");
}
