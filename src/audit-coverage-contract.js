import { createEvidenceAdapterReceipts } from "./evidence-adapter-contract.js";

const STRATEGIES = Object.freeze(["mobile", "desktop"]);
const SEVERITY_ORDER = Object.freeze({ high: 0, medium: 1, low: 2 });
const DOCUMENT_RULE_ALIASES = Object.freeze({
  "html-lang": "html-has-lang",
});

function boundedText(value, maximum = 300) {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, maximum)
    : "";
}

function canonicalDocumentRuleId(value) {
  return DOCUMENT_RULE_ALIASES[value] ?? value;
}

function sourceFailure(source, error) {
  if (!error) return null;
  const fallback = source === "lighthouse"
    ? "Lighthouse evidence was unavailable."
    : "Live document evidence was unavailable.";
  return {
    source,
    status: "unavailable",
    code: boundedText(error.code, 80) || (source === "lighthouse" ? "PROVIDER_FAILED" : "DOCUMENT_FAILED"),
    message: boundedText(error.message, 240) || fallback,
    recoverable: error.recoverable !== false,
  };
}

function mergeChecks(left = {}, right = {}) {
  return {
    passed: (left.passed ?? 0) + (right.passed ?? 0),
    warnings: (left.warnings ?? 0) + (right.warnings ?? 0),
    failed: (left.failed ?? 0) + (right.failed ?? 0),
  };
}

function supplementalDocumentEvidence(lighthouseReport, documentReport) {
  const measuredLighthouseRules = new Set(
    (lighthouseReport?.ruleOutcomes ?? [])
      .filter((outcome) => outcome?.source?.strategy !== "document")
      .map((outcome) => outcome.source.auditId),
  );
  const isSupplementalRule = (ruleId) =>
    !measuredLighthouseRules.has(canonicalDocumentRuleId(ruleId));
  const ruleOutcomes = (documentReport?.ruleOutcomes ?? []).filter((outcome) =>
    isSupplementalRule(outcome?.source?.auditId),
  );
  const findings = (documentReport?.findings ?? []).filter((finding) =>
    isSupplementalRule(finding?.source?.auditId),
  );
  const warningRules = new Set(
    findings
      .filter((finding) => finding?.severity === "low")
      .map((finding) => finding?.source?.auditId),
  );
  const checks = { passed: 0, warnings: 0, failed: 0 };
  for (const outcome of ruleOutcomes) {
    if (outcome.status === "passed") checks.passed += 1;
    else if (outcome.status === "failed" && warningRules.has(outcome.source?.auditId)) {
      checks.warnings += 1;
    } else if (outcome.status === "failed") checks.failed += 1;
  }
  return {
    findings,
    ruleOutcomes,
    checks,
    overlappingRulesOmitted:
      (documentReport?.ruleOutcomes?.length ?? 0) - ruleOutcomes.length,
  };
}

export function createAuditCoverage({
  lighthouseReport = null,
  documentReport = null,
  lighthouseError = null,
  documentError = null,
} = {}) {
  const measuredStrategies = STRATEGIES.filter((strategy) =>
    (lighthouseReport?.viewports ?? []).some((viewport) => viewport?.id === strategy),
  );
  const viewportFailures = (lighthouseReport?.viewportFailures ?? [])
    .filter((failure) => STRATEGIES.includes(failure?.id))
    .map((failure) => ({
      strategy: failure.id,
      code: boundedText(failure.code, 80) || "PROVIDER_FAILED",
      message: boundedText(failure.message, 240) || "Lighthouse evidence was unavailable.",
      recoverable: failure.recoverable !== false,
    }));
  const lighthouseStatus = measuredStrategies.length === STRATEGIES.length
    ? "complete"
    : measuredStrategies.length
      ? "partial"
      : "unavailable";
  const documentStatus = documentReport ? "complete" : "unavailable";
  const routes = Array.isArray(documentReport?.documentProfile?.routes)
    ? documentReport.documentProfile.routes.slice(0, 8)
    : [];
  const sourceFailures = [
    sourceFailure("lighthouse", lighthouseError),
    sourceFailure("document", documentError),
  ].filter(Boolean);
  const limitations = [];
  if (lighthouseStatus !== "complete") {
    const missing = STRATEGIES.filter((strategy) => !measuredStrategies.includes(strategy));
    limitations.push(`Missing Lighthouse ${missing.join(" and ")} evidence.`);
  }
  if (documentStatus !== "complete") {
    limitations.push("Live HTML, response-header, metadata, and route evidence is unavailable.");
  }
  if (documentStatus === "complete") {
    limitations.push("Document inspection does not prove runtime DOM changes, authenticated states, or every user journey.");
  }
  const level = lighthouseStatus === "complete" && documentStatus === "complete"
    ? "page-multi-source"
    : lighthouseStatus !== "unavailable" && documentStatus === "complete"
      ? "page-partial"
      : lighthouseStatus !== "unavailable"
        ? "viewport-only"
        : documentStatus === "complete"
          ? "document-only"
          : "unavailable";
  const adapters = createEvidenceAdapterReceipts({
    lighthouseReport,
    documentReport,
    lighthouseError,
    documentError,
  });
  return {
    schemaVersion: 2,
    level,
    adapters,
    sources: {
      lighthouse: {
        status: lighthouseStatus,
        expectedStrategies: [...STRATEGIES],
        measuredStrategies,
        unavailableStrategies: viewportFailures,
      },
      document: {
        status: documentStatus,
        finalUrl: documentReport?.finalUrl ? boundedText(documentReport.finalUrl, 2_048) : null,
        routeCandidateCount: routes.length,
      },
    },
    routeCandidateCount: routes.length,
    sourceFailures,
    limitations: limitations.slice(0, 4),
  };
}

export function mergeAuditEvidence({
  lighthouse = null,
  document = null,
  lighthouseError = null,
  documentError = null,
} = {}) {
  if (!lighthouse && !document) {
    throw new TypeError("At least one completed audit evidence source is required.");
  }
  const coverage = createAuditCoverage({
    lighthouseReport: lighthouse?.report,
    documentReport: document?.report,
    lighthouseError,
    documentError,
  });
  if (!lighthouse) {
    return {
      screenshots: document.screenshots ?? {},
      report: {
        ...document.report,
        coverage,
        sourceFailures: coverage.sourceFailures,
        engine: {
          ...document.report.engine,
          fallbackReason: boundedText(lighthouseError?.code, 80) || document.report.engine?.fallbackReason || null,
          notice: "Live HTML and response-header evidence was retained. Lighthouse viewport evidence was unavailable for this run.",
        },
      },
    };
  }
  if (!document) {
    return {
      screenshots: lighthouse.screenshots ?? {},
      report: {
        ...lighthouse.report,
        coverage,
        sourceFailures: coverage.sourceFailures,
        engine: {
          ...lighthouse.report.engine,
          mode: lighthouse.report.engine?.mode === "live-lighthouse-partial"
            ? "live-lighthouse-partial"
            : "live-lighthouse-document-unavailable",
          notice: `${boundedText(lighthouse.report.engine?.notice, 300)} Live document evidence was unavailable.`.trim(),
        },
      },
    };
  }

  const supplement = supplementalDocumentEvidence(lighthouse.report, document.report);
  const retainedFindings = [
    ...(lighthouse.report.findings ?? []),
    ...supplement.findings,
  ].sort((left, right) =>
    (SEVERITY_ORDER[left?.severity] ?? 3) - (SEVERITY_ORDER[right?.severity] ?? 3),
  );
  const findings = retainedFindings.slice(0, 10);
  const findingCount =
    (lighthouse.report.findingCount ?? lighthouse.report.findings?.length ?? 0)
    + supplement.findings.length;
  const partial = coverage.sources.lighthouse.status !== "complete";
  const unavailable = coverage.sources.lighthouse.unavailableStrategies
    .map((failure) => failure.strategy)
    .join(" and ");
  const mode = partial ? "hybrid-lighthouse-document" : "live-lighthouse-document";
  const notice = partial
    ? `Retained Lighthouse evidence for ${lighthouse.report.viewportCount} of ${STRATEGIES.length} strategies; ${unavailable || "one or more strategies"} unavailable. Non-duplicative live HTML and response-header rules supplement the report without replacing the missing viewport.`
    : "Live mobile and desktop Lighthouse evidence combined with non-duplicative HTML, response-header, metadata, and route evidence.";

  return {
    screenshots: lighthouse.screenshots ?? {},
    report: {
      ...lighthouse.report,
      completedAt: Math.max(lighthouse.report.completedAt ?? 0, document.report.completedAt ?? 0),
      finalUrl: document.report.finalUrl ?? lighthouse.report.finalUrl,
      hostname: document.report.hostname ?? lighthouse.report.hostname,
      viewports: [
        ...(lighthouse.report.viewports ?? []),
        ...(document.report.viewports ?? []),
      ],
      findingCount,
      findingsOmitted: Math.max(0, findingCount - findings.length),
      findings,
      documentProfile: document.report.documentProfile,
      ruleOutcomes: [
        ...(lighthouse.report.ruleOutcomes ?? []),
        ...supplement.ruleOutcomes,
      ],
      checks: mergeChecks(lighthouse.report.checks, supplement.checks),
      coverage,
      sourceFailures: coverage.sourceFailures,
      documentSupplement: {
        evaluatedRuleCount: supplement.ruleOutcomes.length,
        overlappingRulesOmitted: supplement.overlappingRulesOmitted,
        caveat:
          "Fetched-document rules already evaluated by retained Lighthouse evidence were omitted from combined totals. Document evidence does not replace viewport or rendered-browser evidence.",
      },
      engine: {
        mode,
        provider: `${boundedText(lighthouse.report.engine?.provider, 120) || "Viewport evidence provider"} + ${boundedText(document.report.engine?.provider, 120) || "Frontmend document audit"}`,
        ruleSetVersion: 1,
        lighthouseVersion: lighthouse.report.engine?.lighthouseVersion ?? null,
        adapterContractVersion: 1,
        evidenceAdapters: coverage.adapters.map((adapter) => adapter.adapterId),
        notice,
        fallbackReason: partial ? "PARTIAL_LIGHTHOUSE" : null,
      },
    },
  };
}
