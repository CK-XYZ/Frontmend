import { auditMissionSnapshot, deriveAuditMissionState } from "./audit-mission-contract.js";
import { browserReviewSnapshot } from "./browser-review-contract.js";
import { diagnosticEvidenceChain, diagnosticMissionSnapshot } from "./diagnostic-contract.js";
import { AuditError } from "./url-policy.js";

const MAX_PRIORITIES = 5;

function text(value, maximum = 400) {
  return String(value ?? "").replace(/\r\n/g, "\n").trim().slice(0, maximum);
}

function markdownText(value, maximum = 400) {
  return text(value, maximum)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\\`*_{}\[\]]/g, "\\$&")
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
  });
  if (!state.assessmentComplete) {
    const action = state.nextAction?.tool
      ? ` Complete ${state.nextAction.tool} first.`
      : " Complete the outstanding diagnostic evidence first.";
    throw new AuditError(
      "ASSESSMENT_INCOMPLETE",
      `The assessment receipt is unavailable while required evidence is incomplete.${action}`,
    );
  }
  const diagnosticByFinding = new Map(diagnostics.map((item) => [item.findingId, item]));
  const priorities = state.priorities.slice(0, MAX_PRIORITIES).map((priority) => {
    const diagnostic = diagnosticByFinding.get(priority.findingId) ?? null;
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
      diagnosticMissionId: diagnostic?.id ?? null,
      evidenceChain: diagnostic
        ? diagnostic.evidenceChain ?? diagnosticEvidenceChain(diagnostic)
        : null,
      diagnosis: boundedDiagnosis(diagnostic),
    };
  });
  return {
    schemaVersion: 1,
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
    },
    mission: {
      intent: mission.intent,
      focusAreas: [...mission.focusAreas],
      maxPriorities: mission.maxPriorities,
      requestedBy: mission.requestedBy,
      requestedAt: mission.requestedAt,
    },
    assessment: {
      complete: true,
      matchingFindingCount: state.matchingFindingCount,
      priorityCount: priorities.length,
      categoryScores: { ...state.categoryScores },
    },
    browserReview: browserReview
      ? {
          id: browserReview.id,
          provenance: "agent-reported-browser",
          status: browserReview.state.status,
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
            summary: text(result.summary, 300),
            observations: result.observations.slice(0, 4).map((item) => text(item, 400)),
            reportedAt: Number.isFinite(result.reportedAt) ? result.reportedAt : null,
          })),
        }
      : null,
    priorities,
    authority: {
      sourceContentsReceived: false,
      repairApprovalProved: false,
      implementationProved: false,
      deploymentProved: false,
      resolutionProved: false,
      boundary: "This receipt proves a completed bounded assessment with separately attributed provider and browser evidence, not repair approval, implementation, deployment, or resolution.",
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
    "> Completed bounded assessment only. Provider measurement and contributed diagnosis remain separately attributed; this artifact does not prove a repair, deployment, or resolution.",
    "",
    `- Target: ${markdownText(receipt.target, 2_048)}`,
    `- Final URL: ${markdownText(receipt.finalUrl, 2_048)}`,
    `- Audit ID: \`${markdownText(receipt.auditId, 80)}\``,
    `- Completed: ${timestamp(receipt.completedAt)}`,
    `- Evidence mode: ${markdownText(receipt.engine?.mode, 80)}`,
    `- Provider: ${markdownText(receipt.engine?.provider, 120)}`,
    "",
    "## Assessment mission",
    "",
    `- Intent: ${markdownText(receipt.mission?.intent, 40)}`,
    `- Focus: ${receipt.mission?.focusAreas?.length ? receipt.mission.focusAreas.map((area) => markdownText(area, 40)).join(", ") : "all supported areas"}`,
    `- Requested by: ${markdownText(receipt.mission?.requestedBy, 40)}`,
    `- Assessment complete: yes`,
    `- Matching findings: ${Number.isFinite(receipt.assessment?.matchingFindingCount) ? receipt.assessment.matchingFindingCount : "—"}`,
    `- Ranked priorities: ${receipt.priorities?.length ?? 0}`,
  ];
  if (receipt.browserReview) {
    lines.push(
      "",
      "## Agent-contributed browser review",
      "",
      `- Provenance: ${markdownText(receipt.browserReview.provenance, 80)}`,
      `- Status: ${markdownText(receipt.browserReview.status, 40)}`,
      `- Coverage: ${receipt.browserReview.completedCheckCount} of ${receipt.browserReview.requestedCheckCount} requested checks`,
      `- Browser-observed issues: ${receipt.browserReview.issueCount}`,
    );
    for (const check of receipt.browserReview.checks ?? []) {
      lines.push(
        "",
        `### ${markdownText(check.label, 120)}`,
        "",
        `- Outcome: ${markdownText(check.outcome, 40)}`,
        `- Summary: ${markdownText(check.summary, 300)}`,
        `- Reported: ${timestamp(check.reportedAt)}`,
        ...check.observations.map((observation) => `- Observed: ${markdownText(observation, 400)}`),
      );
    }
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
      `- Strategies: ${priority.affectedStrategies?.length ? priority.affectedStrategies.map((strategy) => markdownText(strategy, 40)).join(", ") : "document"}`,
      `- Occurrences: ${priority.occurrenceCount}`,
      `- Measured evidence: ${markdownText(priority.evidence, 600)}`,
    );
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
