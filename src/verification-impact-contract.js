import { AuditError } from "./url-policy.js";
import { createBuildDescriptor } from "./protocol-contract.js";

const EVALUATED_STATUSES = new Set(["passed", "failed", "not-applicable"]);
const TERMINAL_JOB_STATUSES = new Set(["complete", "failed", "cancelled"]);
const ROW_STATUSES = new Set(["waiting", "running", "resolved", "still-present", "regression", "inconclusive"]);
const MAX_OPTIONAL_TARGETS = 3;
const MAX_TARGETS = 4;
const MAX_ROWS = 72;
const MAX_PROVIDER_GUARDRAILS = 4;
const MAX_BROWSER_GUARDRAILS = 2;
const IMPORTANT_RULE_FOCUS = Object.freeze({
  "button-name": "accessibility",
  "color-contrast": "accessibility",
  "heading-order": "accessibility",
  "html-has-lang": "accessibility",
  "html-lang": "accessibility",
  "image-alt": "accessibility",
  label: "accessibility",
  "link-name": "accessibility",
  "main-landmark": "accessibility",
  "missing-h1": "accessibility",
  viewport: "accessibility",
  canonical: "seo",
  "crawlable-anchors": "seo",
  "document-title": "seo",
  hreflang: "seo",
  "http-status-code": "seo",
  "is-crawlable": "seo",
  "meta-description": "seo",
  "robots-txt": "seo",
  "cumulative-layout-shift": "performance",
  "first-contentful-paint": "performance",
  "largest-contentful-paint": "performance",
  "speed-index": "performance",
  "total-blocking-time": "performance",
  "content-security-policy": "security",
  "x-content-type-options": "security",
  "errors-in-console": "reliability",
});

function bounded(value, maximum = 240) {
  return String(value ?? "").replace(/\r\n/g, "\n").trim().slice(0, maximum);
}

function pathFromUrl(value) {
  try {
    return new URL(value).pathname || "/";
  } catch {
    return "/";
  }
}

function sourceSnapshot(source) {
  if (!source?.provider || !source?.auditId || !source?.strategy) return null;
  return {
    provider: bounded(source.provider, 120),
    auditId: bounded(source.auditId, 160),
    strategy: bounded(source.strategy, 40),
  };
}

function sameRule(left, right) {
  return Boolean(
    left?.provider &&
      right?.provider &&
      left?.auditId &&
      right?.auditId &&
      left.provider === right.provider &&
      left.auditId === right.auditId,
  );
}

function sameSource(left, right) {
  return sameRule(left, right) && left?.strategy === right?.strategy;
}

function findingRuleKey(finding) {
  return `${bounded(finding?.source?.provider, 120)}:${bounded(finding?.source?.auditId ?? finding?.id, 160)}`;
}

function retainedFocusAreas(values, fallbackSource) {
  const result = Array.isArray(values)
    ? values.filter((area) => ["accessibility", "seo", "performance", "security", "reliability"].includes(area))
    : [];
  if (result.length) return [...new Set(result)].slice(0, 3);
  const inferred = IMPORTANT_RULE_FOCUS[fallbackSource?.auditId];
  return inferred ? [inferred] : [];
}

function uniqueSources(values) {
  const result = [];
  for (const value of values) {
    const source = sourceSnapshot(value);
    if (source && !result.some((candidate) => sameSource(candidate, source))) result.push(source);
  }
  return result.slice(0, 4);
}

function engineSnapshot(engine = {}) {
  return {
    mode: bounded(engine.mode, 80) || null,
    provider: bounded(engine.provider, 160) || null,
    ruleSetVersion: Number.isFinite(engine.ruleSetVersion) ? engine.ruleSetVersion : null,
    lighthouseVersion: bounded(engine.lighthouseVersion, 40) || null,
  };
}

function baselineReportSnapshot(report, sources) {
  return {
    auditId: bounded(report?.auditId, 80),
    url: bounded(report?.url, 2_048),
    finalUrl: bounded(report?.finalUrl ?? report?.url, 2_048),
    completedAt: Number.isFinite(report?.completedAt) ? report.completedAt : null,
    engine: engineSnapshot(report?.engine),
    score: Number.isFinite(report?.score) ? report.score : null,
    findingCount: Number.isFinite(report?.findingCount) ? report.findingCount : null,
    checks: report?.checks
      ? {
          passed: Number.isFinite(report.checks.passed) ? report.checks.passed : null,
          warnings: Number.isFinite(report.checks.warnings) ? report.checks.warnings : null,
          failed: Number.isFinite(report.checks.failed) ? report.checks.failed : null,
        }
      : null,
    ruleOutcomes: sources.map((source) => ({
      source,
      status: report?.ruleOutcomes?.find((item) => sameSource(item?.source, source))?.status ?? "failed",
    })),
  };
}

function targetId(auditId) {
  return `audit:${bounded(auditId, 80)}`;
}

function rowId(kind, target, source, suffix = "") {
  return bounded(
    `${kind}:${target.id}:${source?.provider ?? "browser"}:${source?.auditId ?? suffix}:${source?.strategy ?? suffix}`,
    360,
  );
}

function reportRuleEvidence(report, findingSource, rootFallbackSources = []) {
  const evaluated = [];
  const failed = [];
  for (const outcome of Array.isArray(report?.ruleOutcomes) ? report.ruleOutcomes : []) {
    if (!sameRule(outcome?.source, findingSource) || !EVALUATED_STATUSES.has(outcome?.status)) continue;
    evaluated.push(outcome.source);
    if (outcome.status === "failed") failed.push(outcome.source);
  }
  for (const finding of Array.isArray(report?.findings) ? report.findings : []) {
    if (sameRule(finding?.source, findingSource)) {
      evaluated.push(finding.source);
      failed.push(finding.source);
    }
  }
  for (const source of rootFallbackSources) {
    if (sameRule(source, findingSource)) {
      evaluated.push(source);
      failed.push(source);
    }
  }
  return { evaluated: uniqueSources(evaluated), failed: uniqueSources(failed) };
}

function normalizeAuditedReports(rootReport, auditedReports) {
  let rootOrigin;
  try {
    rootOrigin = new URL(rootReport?.finalUrl ?? rootReport?.url).origin;
  } catch {
    throw new AuditError("INVALID_REPAIR", "The retained root audit target is invalid.");
  }
  const values = [{
    auditId: rootReport.auditId,
    path: pathFromUrl(rootReport.finalUrl ?? rootReport.url),
    url: rootReport.finalUrl ?? rootReport.url,
    report: rootReport,
    root: true,
  }];
  for (const entry of Array.isArray(auditedReports) ? auditedReports : []) {
    if (entry?.status !== "complete" || !entry?.report?.auditId) continue;
    let url;
    try {
      url = new URL(entry.report.finalUrl ?? entry.report.url ?? entry.url);
    } catch {
      continue;
    }
    if (url.origin !== rootOrigin || values.some((item) => item.auditId === entry.report.auditId)) continue;
    values.push({
      auditId: entry.report.auditId,
      path: bounded(entry.path ?? url.pathname, 256) || "/",
      url: url.href,
      report: entry.report,
      root: false,
    });
  }
  return values.slice(0, MAX_TARGETS);
}

function validateSelectedCandidateIds(candidateIds, candidates) {
  if (candidateIds === undefined) return [];
  if (!Array.isArray(candidateIds) || candidateIds.length > MAX_OPTIONAL_TARGETS) {
    throw new AuditError(
      "INVALID_VERIFICATION_TARGET",
      `verificationTargetIds must contain at most ${MAX_OPTIONAL_TARGETS} server-issued candidate IDs.`,
    );
  }
  const ids = candidateIds.map((value) => bounded(value, 180));
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) {
    throw new AuditError("INVALID_VERIFICATION_TARGET", "verificationTargetIds must be unique non-empty IDs.");
  }
  const allowed = new Set(candidates.map((candidate) => candidate.id));
  if (ids.some((id) => !allowed.has(id))) {
    throw new AuditError(
      "INVALID_VERIFICATION_TARGET",
      "Every verification target must be a current server-issued audited-route candidate.",
    );
  }
  return ids;
}

function providerRowsForTarget(target, selectedOptional) {
  const sources = target.failedSources.length ? target.failedSources : target.evaluatedSources;
  return sources.map((source) => ({
    id: rowId("provider", target, source),
    targetId: target.id,
    path: target.path,
    strategy: source.strategy,
    proofKind: "provider-rule",
    required: true,
    selection: target.required ? "automatic" : selectedOptional ? "optional-reviewed" : "automatic",
    source,
    baseline: {
      auditId: target.auditId,
      outcome: target.failedSources.some((candidate) => sameSource(candidate, source)) ? "failed" : "passed",
      engine: target.baselineReport.engine,
    },
    status: "waiting",
    assignment: null,
    outcome: null,
    comparisonReason: null,
  }));
}

function providerGuardrailRowsForTarget(target, focusAreas, findingSource) {
  if (!focusAreas.length) return [];
  const sources = uniqueSources(
    (target.report?.ruleOutcomes ?? [])
      .filter((outcome) =>
        outcome?.status === "passed"
        && !sameRule(outcome?.source, findingSource)
        && focusAreas.includes(IMPORTANT_RULE_FOCUS[outcome?.source?.auditId])
      )
      .map((outcome) => outcome.source),
  ).slice(0, MAX_PROVIDER_GUARDRAILS);
  return sources.map((source) => ({
    id: rowId("guardrail", target, source),
    targetId: target.id,
    path: target.path,
    strategy: source.strategy,
    proofKind: "provider-guardrail",
    required: true,
    selection: "automatic-guardrail",
    source,
    baseline: {
      auditId: target.auditId,
      outcome: "passed",
      engine: target.baselineReport.engine,
      focusArea: IMPORTANT_RULE_FOCUS[source.auditId],
    },
    status: "waiting",
    assignment: null,
    outcome: null,
    comparisonReason: null,
  }));
}

function newFindingGuardrailRow(target, focusAreas, findingSource) {
  if (!focusAreas.length) return [];
  const knownFindingRules = [...new Set(
    (target.report?.findings ?? [])
      .filter((finding) => ["high", "medium"].includes(finding?.severity))
      .filter((finding) => (finding.focusAreas ?? []).some((area) => focusAreas.includes(area)))
      .map(findingRuleKey),
  )].slice(0, 20);
  return [{
    id: rowId("new-findings", target, null, "high-medium"),
    targetId: target.id,
    path: target.path,
    strategy: "all-retained",
    proofKind: "new-findings-guardrail",
    required: true,
    selection: "automatic-guardrail",
    source: null,
    baseline: {
      auditId: target.auditId,
      outcome: "no-new-high-medium-findings",
      engine: target.baselineReport.engine,
      focusAreas,
      knownFindingRules,
      repairedRule: `${bounded(findingSource?.provider, 120)}:${bounded(findingSource?.auditId, 160)}`,
      repairedRules: [`${bounded(findingSource?.provider, 120)}:${bounded(findingSource?.auditId, 160)}`],
    },
    status: "waiting",
    assignment: null,
    outcome: null,
    comparisonReason: null,
  }];
}

function browserGuardrailRowsForTarget(target, browserReview, focusAreas) {
  if (!target.root || !browserReview || !focusAreas.length) return [];
  const tasks = browserReview.requestedChecks ?? browserReview.tasks ?? [];
  return (browserReview.results ?? [])
    .filter((result) => result?.outcome === "passed")
    .map((result) => ({ result, task: tasks.find((task) => task?.id === result.checkId) }))
    .filter(({ result, task }) => {
      const id = `${result.checkId ?? ""} ${task?.kind ?? ""}`;
      const areas = task?.focusAreas ?? (task?.focusArea ? [task.focusArea] : []);
      return /(journey|reflow)/i.test(id) && areas.some((area) => focusAreas.includes(area));
    })
    .slice(0, MAX_BROWSER_GUARDRAILS)
    .map(({ result, task }) => {
      const viewport = bounded(task?.target?.viewport ?? task?.viewport ?? "desktop", 40);
      const source = {
        provider: "Frontmend browser review",
        auditId: bounded(result.checkId, 80),
        strategy: viewport,
      };
      return {
        id: rowId("browser-guardrail", target, source),
        targetId: target.id,
        path: target.path,
        strategy: viewport,
        proofKind: "browser-guardrail",
        required: true,
        selection: "automatic-guardrail",
        source,
        baseline: {
          auditId: target.auditId,
          outcome: "passed",
          checkId: bounded(result.checkId, 80),
          label: bounded(task?.label ?? result.checkId, 120),
          focusArea: bounded(task?.focusArea ?? task?.focusAreas?.[0], 40),
          viewport,
          assignment: task?.assignment ? JSON.parse(JSON.stringify(task.assignment)) : null,
          target: task?.target ? JSON.parse(JSON.stringify(task.target)) : null,
          summary: bounded(result.summary, 300),
        },
        status: "waiting",
        assignment: null,
        outcome: null,
        comparisonReason: null,
      };
    });
}

function rowsForSelectedTargets(targets, selectedTargetIds) {
  const withSelection = (target, row) => ({
    ...row,
    selection: target.required ? row.selection : selectedTargetIds.includes(target.id)
      ? "optional-reviewed"
      : row.selection,
  });
  const exact = targets.flatMap((target) => (target.rows ?? [])
    .filter((row) => ["provider-rule", "browser-replay"].includes(row.proofKind))
    .map((row) => withSelection(target, row)));
  const guardrails = targets.flatMap((target) => (target.rows ?? [])
    .filter((row) => !["provider-rule", "browser-replay"].includes(row.proofKind))
    .map((row) => withSelection(target, row)));
  return [...exact, ...guardrails].slice(0, MAX_ROWS);
}

function browserRowForTarget(target, findingEvidence) {
  if (!findingEvidence?.browserReviewEvidence?.reviewId) return [];
  const source = sourceSnapshot(findingEvidence.source) ?? {
    provider: "Frontmend browser review",
    auditId: bounded(findingEvidence.browserReviewEvidence.checkId, 80),
    strategy: "browser",
  };
  return [{
    id: rowId("browser", target, source, findingEvidence.browserReviewEvidence.checkId),
    targetId: target.id,
    path: target.path,
    strategy: "browser",
    proofKind: "browser-replay",
    required: true,
    selection: "automatic",
    source,
    baseline: {
      auditId: target.auditId,
      findingId: bounded(findingEvidence.findingId, 160),
      title: bounded(findingEvidence.title, 240),
      category: bounded(findingEvidence.category, 80),
      focusArea: findingEvidence.focusArea === "seo" ? "seo" : "accessibility",
      outcome: "issue",
      evidence: bounded(findingEvidence.evidence, 600),
      selector: bounded(findingEvidence.selector, 200),
      repair: bounded(findingEvidence.repair, 600),
      source,
      checkId: bounded(findingEvidence.browserReviewEvidence.checkId, 80),
      browserReviewEvidence: {
        reviewId: bounded(findingEvidence.browserReviewEvidence.reviewId, 160),
        checkId: bounded(findingEvidence.browserReviewEvidence.checkId, 80),
        checkLabel: bounded(findingEvidence.browserReviewEvidence.checkLabel, 120),
        provenance: bounded(findingEvidence.browserReviewEvidence.provenance, 80),
        reportedAt: Number.isFinite(findingEvidence.browserReviewEvidence.reportedAt)
          ? findingEvidence.browserReviewEvidence.reportedAt
          : null,
      },
    },
    status: "waiting",
    assignment: null,
    outcome: null,
    comparisonReason: null,
  }];
}

export function createRepairVerificationImpact({
  repairId,
  repairRevision = 1,
  findingId = null,
  rootReport,
  findingSource,
  findingScope = null,
  findingEvidence = null,
  focusAreas = [],
  browserReview = null,
  auditedReports = [],
  verificationTargetIds,
} = {}) {
  if (!repairId || !rootReport?.auditId || !findingSource?.provider || !findingSource?.auditId) {
    throw new AuditError("INVALID_REPAIR", "A repair, root report, and retained finding rule are required.");
  }
  const browserFinding = findingSource.provider === "Frontmend browser review";
  const retainedAreas = retainedFocusAreas(focusAreas, findingSource);
  const reports = normalizeAuditedReports(rootReport, auditedReports);
  const targets = [];
  for (const entry of reports) {
    const evidence = browserFinding
      ? { evaluated: entry.root ? [findingSource] : [], failed: entry.root ? [findingSource] : [] }
      : reportRuleEvidence(
          entry.report,
          findingSource,
          entry.root ? [findingSource, ...(findingScope?.sources ?? [])] : [],
        );
    if (!entry.root && !evidence.evaluated.length) continue;
    const required = entry.root || evidence.failed.length > 0;
    targets.push({
      id: targetId(entry.auditId),
      auditId: bounded(entry.auditId, 80),
      path: bounded(entry.path, 256) || "/",
      url: bounded(entry.url, 2_048),
      root: entry.root === true,
      required,
      reason: required
        ? entry.root
          ? "Root route retained by the selected repair."
          : "The exact retained rule failed on this completed exploration route."
        : "The exact retained rule was evaluated on this completed exploration route.",
      evaluatedSources: evidence.evaluated,
      failedSources: evidence.failed,
      baselineReport: baselineReportSnapshot(entry.report, evidence.evaluated.length ? evidence.evaluated : [findingSource]),
      report: entry.report,
    });
  }
  for (const target of targets) {
    const exactRows = browserFinding
      ? browserRowForTarget(target, findingEvidence)
      : providerRowsForTarget(target, false);
    target.rows = [
      ...exactRows,
      ...providerGuardrailRowsForTarget(target, retainedAreas, findingSource),
      ...newFindingGuardrailRow(target, retainedAreas, findingSource),
      ...browserGuardrailRowsForTarget(target, browserReview, retainedAreas),
    ].slice(0, MAX_ROWS).map((row) => ({
      ...row,
      findingId: bounded(findingId, 160) || null,
      findingIds: bounded(findingId, 160) ? [bounded(findingId, 160)] : [],
    }));
    delete target.report;
  }
  const candidates = targets
    .filter((target) => !target.required)
    .slice(0, MAX_OPTIONAL_TARGETS)
    .map((target) => ({
      id: target.id,
      auditId: target.auditId,
      path: target.path,
      strategies: target.evaluatedSources.map((source) => source.strategy),
      reason: target.reason,
    }));
  const selectedTargetIds = validateSelectedCandidateIds(verificationTargetIds, candidates);
  const selected = targets.filter((target) => target.required || selectedTargetIds.includes(target.id));
  const rows = rowsForSelectedTargets(selected, selectedTargetIds);
  if (!rows.length) {
    throw new AuditError("INVALID_REPAIR", "The retained repair has no exact verification rows.");
  }
  return {
    schemaVersion: 1,
    repairId: bounded(repairId, 80),
    repairRevision: Number.isInteger(repairRevision) && repairRevision > 0 ? repairRevision : 1,
    rootAuditId: bounded(rootReport.auditId, 160),
    findingId: bounded(findingId, 120) || null,
    findingIds: bounded(findingId, 160) ? [bounded(findingId, 160)] : [],
    focusAreas: retainedAreas,
    status: "unreviewed",
    rule: {
      provider: bounded(findingSource.provider, 120),
      auditId: bounded(findingSource.auditId, 160),
    },
    selectedTargetIds,
    candidates,
    targets,
    previewRows: rows,
    matrix: null,
  };
}

function mergePackageRow(existing, incoming) {
  if (!existing) return { ...incoming };
  const findingIds = [...new Set([...(existing.findingIds ?? []), ...(incoming.findingIds ?? [])])].slice(0, 3);
  if (existing.proofKind !== "new-findings-guardrail") {
    return { ...existing, findingIds };
  }
  return {
    ...existing,
    findingIds,
    baseline: {
      ...existing.baseline,
      focusAreas: [...new Set([
        ...(existing.baseline?.focusAreas ?? []),
        ...(incoming.baseline?.focusAreas ?? []),
      ])].slice(0, 5),
      knownFindingRules: [...new Set([
        ...(existing.baseline?.knownFindingRules ?? []),
        ...(incoming.baseline?.knownFindingRules ?? []),
      ])].slice(0, 20),
      repairedRules: [...new Set([
        ...(existing.baseline?.repairedRules ?? [existing.baseline?.repairedRule].filter(Boolean)),
        ...(incoming.baseline?.repairedRules ?? [incoming.baseline?.repairedRule].filter(Boolean)),
      ])].slice(0, 3),
    },
  };
}

export function createRepairPackageVerificationImpact({ findings, ...input } = {}) {
  if (!Array.isArray(findings) || findings.length < 1 || findings.length > 3) {
    throw new AuditError("INVALID_REPAIR", "A repair verification package must contain between one and three retained findings.");
  }
  const findingIds = findings.map((item) => bounded(item?.findingId, 160));
  if (findingIds.some((id) => !id) || new Set(findingIds).size !== findingIds.length) {
    throw new AuditError("INVALID_REPAIR", "Repair verification findings must have unique retained IDs.");
  }
  const impacts = findings.map((item) => createRepairVerificationImpact({
    ...input,
    findingId: item.findingId,
    findingSource: item.findingSource,
    findingScope: item.findingScope,
    findingEvidence: item.findingEvidence,
    focusAreas: item.focusAreas,
    verificationTargetIds: [],
  }));
  if (impacts.length === 1) {
    return selectRepairVerificationTargets(
      impacts[0],
      input.verificationTargetIds ?? [],
      input.repairRevision,
    );
  }
  const targetMap = new Map();
  for (const impact of impacts) {
    for (const target of impact.targets) {
      const existing = targetMap.get(target.id);
      if (!existing) {
        targetMap.set(target.id, {
          ...target,
          evaluatedSources: [...target.evaluatedSources],
          failedSources: [...target.failedSources],
          rows: target.rows.map((row) => ({ ...row })),
        });
        continue;
      }
      existing.required = existing.required || target.required;
      existing.reason = existing.required
        ? existing.path === pathFromUrl(input.rootReport?.finalUrl ?? input.rootReport?.url)
          ? "Root route retained by the selected repair package."
          : "At least one exact retained rule failed on this completed exploration route."
        : "At least one exact retained rule was evaluated on this completed exploration route.";
      existing.evaluatedSources = uniqueSources([...existing.evaluatedSources, ...target.evaluatedSources]);
      existing.failedSources = uniqueSources([...existing.failedSources, ...target.failedSources]);
      const rows = new Map(existing.rows.map((row) => [row.id, row]));
      for (const row of target.rows) rows.set(row.id, mergePackageRow(rows.get(row.id), row));
      existing.rows = [...rows.values()].slice(0, MAX_ROWS);
    }
  }
  const targets = [...targetMap.values()].slice(0, MAX_TARGETS);
  const candidates = targets
    .filter((target) => !target.required)
    .slice(0, MAX_OPTIONAL_TARGETS)
    .map((target) => ({
      id: target.id,
      auditId: target.auditId,
      path: target.path,
      strategies: [...new Set(target.evaluatedSources.map((source) => source.strategy))],
      reason: target.reason,
    }));
  const selectedTargetIds = validateSelectedCandidateIds(input.verificationTargetIds ?? [], candidates);
  const selected = targets.filter((target) => target.required || selectedTargetIds.includes(target.id));
  const rows = rowsForSelectedTargets(selected, selectedTargetIds);
  if (!rows.some((row) => ["provider-rule", "browser-replay"].includes(row.proofKind))) {
    throw new AuditError("INVALID_REPAIR", "The retained repair package has no exact verification rows.");
  }
  return {
    schemaVersion: 1,
    repairId: bounded(input.repairId, 80),
    repairRevision: Number.isInteger(input.repairRevision) && input.repairRevision > 0 ? input.repairRevision : 1,
    rootAuditId: bounded(input.rootReport?.auditId, 160),
    findingId: findingIds[0],
    findingIds,
    focusAreas: [...new Set(impacts.flatMap((impact) => impact.focusAreas ?? []))].slice(0, 5),
    status: "unreviewed",
    rule: { ...impacts[0].rule },
    rules: impacts.map((impact) => ({ findingId: impact.findingId, ...impact.rule })),
    selectedTargetIds,
    candidates,
    targets,
    previewRows: rows,
    matrix: null,
  };
}

export function selectRepairVerificationTargets(impact, verificationTargetIds, repairRevision) {
  if (!impact?.repairId || !Array.isArray(impact.targets)) {
    throw new AuditError("INVALID_REPAIR", "The repair verification impact is unavailable.");
  }
  const selectedTargetIds = validateSelectedCandidateIds(
    verificationTargetIds,
    impact.candidates ?? [],
  );
  const selected = impact.targets.filter((target) => target.required || selectedTargetIds.includes(target.id));
  const hydrated = selected.map((target) => target.rows
    ? target
    : { ...target, rows: impact.previewRows.filter((row) => row.targetId === target.id) });
  const rows = rowsForSelectedTargets(hydrated, selectedTargetIds);
  return {
    ...impact,
    repairRevision: Number.isInteger(repairRevision) && repairRevision > 0
      ? repairRevision
      : impact.repairRevision,
    status: "unreviewed",
    selectedTargetIds,
    previewRows: rows,
    matrix: null,
  };
}

export function reviewRepairVerificationImpact(impact, reviewedBy, now = Date.now()) {
  if (!impact?.repairId || !Array.isArray(impact.previewRows) || !impact.previewRows.length) {
    throw new AuditError("VERIFICATION_MATRIX_REQUIRED", "Review a non-empty repair impact matrix before approval.");
  }
  if (!["person", "delegated-auto-policy"].includes(reviewedBy)) {
    throw new AuditError("VERIFICATION_MATRIX_REQUIRED", "The matrix must be reviewed by a person or eligible delegated policy.");
  }
  return {
    ...impact,
    status: "reviewed",
    matrix: {
      schemaVersion: 1,
      repairId: impact.repairId,
      repairRevision: impact.repairRevision,
      rows: impact.previewRows.map((row) => ({ ...row })),
      reviewedBy,
      reviewedAt: Number.isFinite(now) ? now : Date.now(),
    },
  };
}

export function createLegacyRepairVerificationImpact({ repair, rootReport } = {}) {
  if (!repair?.id || !repair?.findingSource || !rootReport?.auditId) {
    throw new AuditError("INVALID_REPAIR", "A retained legacy repair and root report are required.");
  }
  const impact = createRepairVerificationImpact({
    repairId: repair.id,
    repairRevision: Number.isFinite(repair.revision) ? repair.revision : 1,
    findingId: repair.findingId,
    rootReport,
    findingSource: repair.findingSource,
    findingScope: { sources: [repair.findingSource] },
    findingEvidence: repair.findingEvidence,
    auditedReports: [],
    verificationTargetIds: [],
  });
  const oneRowImpact = {
    ...impact,
    previewRows: impact.previewRows.slice(0, 1),
  };
  if (repair.status !== "approved") return oneRowImpact;
  return reviewRepairVerificationImpact(
    oneRowImpact,
    repair.approval?.mode === "delegated-auto" ? "delegated-auto-policy" : "person",
    repair.reviewedAt,
  );
}

export function verificationCandidateProjection(impact) {
  return {
    auditId: impact?.rootAuditId ?? impact?.targets?.[0]?.auditId ?? null,
    findingId: impact?.findingId ?? null,
    findingIds: [...(impact?.findingIds ?? (impact?.findingId ? [impact.findingId] : []))],
    selectedTargetIds: [...(impact?.selectedTargetIds ?? [])],
    candidates: (impact?.candidates ?? []).map((candidate) => ({
      id: candidate.id,
      auditId: candidate.auditId,
      path: candidate.path,
      strategies: [...candidate.strategies],
      reason: candidate.reason,
    })),
    limit: MAX_OPTIONAL_TARGETS,
    rule: impact?.rule ? { ...impact.rule } : null,
    rules: (impact?.rules ?? []).map((rule) => ({ ...rule })),
  };
}

export function reviewedVerificationTargets(impact) {
  if (impact?.status !== "reviewed" || !impact.matrix?.rows?.length) {
    throw new AuditError(
      "VERIFICATION_MATRIX_REQUIRED",
      "The repair impact matrix must be reviewed before verification starts.",
    );
  }
  const targetIds = [...new Set(impact.matrix.rows.map((row) => row.targetId))];
  return targetIds.map((id) => {
    const target = impact.targets.find((candidate) => candidate.id === id);
    if (!target) throw new AuditError("VERIFICATION_MATRIX_REQUIRED", "A reviewed verification target is unavailable.");
    return {
      ...target,
      rows: impact.matrix.rows.filter((row) => row.targetId === id).map((row) => ({ ...row })),
    };
  });
}

export function browserReplaysForVerificationRows(rows) {
  const values = Array.isArray(rows) ? rows : [];
  return values
    .filter((row) => row?.proofKind === "browser-replay" && row?.baseline?.findingId)
    .filter((row, index, candidates) =>
      candidates.findIndex((candidate) => candidate.baseline.findingId === row.baseline.findingId) === index)
    .slice(0, 3)
    .map((row) => ({
      required: true,
      status: "not-opened",
      rowId: bounded(row.id, 160),
      baseline: {
        findingId: bounded(row.baseline.findingId, 160),
        title: bounded(row.baseline.title, 240),
        category: bounded(row.baseline.category, 80) || "Accessibility",
        focusArea: row.baseline.focusArea === "seo" ? "seo" : "accessibility",
        selector: bounded(row.baseline.selector, 200) || "Rendered page",
        evidence: bounded(row.baseline.evidence, 600),
        repair: bounded(row.baseline.repair, 600) || "Recheck the original rendered issue.",
        source: sourceSnapshot(row.baseline.source ?? row.source),
        browserReviewEvidence: {
          reviewId: bounded(row.baseline.browserReviewEvidence?.reviewId, 160),
          checkId: bounded(row.baseline.browserReviewEvidence?.checkId ?? row.baseline.checkId, 80),
          checkLabel: bounded(row.baseline.browserReviewEvidence?.checkLabel ?? "Browser check", 120),
          provenance: bounded(row.baseline.browserReviewEvidence?.provenance, 80) || "agent-reported-browser",
          reportedAt: Number.isFinite(row.baseline.browserReviewEvidence?.reportedAt)
            ? row.baseline.browserReviewEvidence.reportedAt
            : null,
        },
      },
    }));
}

export function createRepairVerificationRun(impact, runId, now = Date.now()) {
  const targets = reviewedVerificationTargets(impact);
  if (!runId) throw new AuditError("INVALID_REPAIR", "A stable verification run ID is required.");
  return {
    schemaVersion: 1,
    id: bounded(runId, 80),
    repairId: impact.repairId,
    repairRevision: impact.repairRevision,
    status: "waiting",
    startedAt: Number.isFinite(now) ? now : Date.now(),
    completedAt: null,
    assignments: targets.map((target) => ({
      targetId: target.id,
      path: target.path,
      auditId: null,
    })),
  };
}

export function assignRepairVerificationJobs(run, assignments) {
  if (!run?.id || !Array.isArray(run.assignments) || !Array.isArray(assignments)) {
    throw new AuditError("INVALID_REPAIR", "Verification run assignments are invalid.");
  }
  const byTarget = new Map(assignments.map((item) => [item?.targetId, item?.auditId]));
  if ([...byTarget.keys()].some((id) => !run.assignments.some((item) => item.targetId === id))) {
    throw new AuditError("INVALID_REPAIR", "A verification assignment is outside the reviewed matrix.");
  }
  return {
    ...run,
    assignments: run.assignments.map((item) => ({
      ...item,
      auditId: bounded(byTarget.get(item.targetId) ?? item.auditId, 80) || null,
    })),
  };
}

function comparableEngine(baseline, current, source) {
  if (!baseline?.mode || !current?.mode || baseline.mode !== current.mode || baseline.provider !== current.provider) {
    return false;
  }
  if (source?.provider?.includes("Lighthouse") || baseline.mode.includes("lighthouse")) {
    return Boolean(baseline.lighthouseVersion && baseline.lighthouseVersion === current.lighthouseVersion);
  }
  return baseline.ruleSetVersion === current.ruleSetVersion;
}

function providerRowStatus(row, audit) {
  if (!audit?.id || !audit.status) return { status: "waiting", outcome: null, comparisonReason: null };
  if (!TERMINAL_JOB_STATUSES.has(audit.status)) {
    return { status: audit.status === "queued" ? "waiting" : "running", outcome: null, comparisonReason: null };
  }
  if (audit.status !== "complete" || !audit.report) {
    return { status: "inconclusive", outcome: "missing", comparisonReason: `audit-${audit.status}` };
  }
  const outcome = audit.report.ruleOutcomes?.find((item) => sameSource(item?.source, row.source))?.status ?? "missing";
  if (!comparableEngine(row.baseline.engine, engineSnapshot(audit.report.engine), row.source)) {
    return { status: "inconclusive", outcome, comparisonReason: "evidence-engine-changed" };
  }
  if (outcome === "failed") {
    return row.proofKind === "provider-guardrail"
      ? { status: "regression", outcome, comparisonReason: "retained-guardrail-failed" }
      : { status: "still-present", outcome, comparisonReason: "exact-rule-failed" };
  }
  if (outcome === "passed") {
    return {
      status: "resolved",
      outcome,
      comparisonReason: row.proofKind === "provider-guardrail"
        ? "retained-guardrail-passed"
        : "exact-rule-passed",
    };
  }
  return { status: "inconclusive", outcome, comparisonReason: "exact-rule-not-evaluated" };
}

function newFindingsRowStatus(row, audit) {
  if (!audit?.id || !audit.status) return { status: "waiting", outcome: null, comparisonReason: null };
  if (!TERMINAL_JOB_STATUSES.has(audit.status)) {
    return { status: audit.status === "queued" ? "waiting" : "running", outcome: null, comparisonReason: null };
  }
  if (audit.status !== "complete" || !audit.report) {
    return { status: "inconclusive", outcome: "missing", comparisonReason: `audit-${audit.status}` };
  }
  if (!comparableEngine(row.baseline.engine, engineSnapshot(audit.report.engine))) {
    return { status: "inconclusive", outcome: "missing", comparisonReason: "evidence-engine-changed" };
  }
  const known = new Set(row.baseline.knownFindingRules ?? []);
  const repaired = new Set(row.baseline.repairedRules ?? [row.baseline.repairedRule].filter(Boolean));
  const focusAreas = row.baseline.focusAreas ?? [];
  const introduced = (audit.report.findings ?? [])
    .filter((finding) => ["high", "medium"].includes(finding?.severity))
    .filter((finding) => !focusAreas.length || (finding.focusAreas ?? []).some((area) => focusAreas.includes(area)))
    .filter((finding) => !repaired.has(findingRuleKey(finding)))
    .filter((finding) => !known.has(findingRuleKey(finding)))
    .slice(0, 5)
    .map((finding) => ({
      findingId: bounded(finding.id, 160),
      title: bounded(finding.title, 240),
      severity: finding.severity,
      source: sourceSnapshot(finding.source),
    }));
  return introduced.length
    ? {
        status: "regression",
        outcome: "new-high-medium-findings",
        comparisonReason: "new-retained-findings",
        introducedFindings: introduced,
      }
    : {
        status: "resolved",
        outcome: "no-new-high-medium-findings",
        comparisonReason: "no-new-retained-findings",
        introducedFindings: [],
      };
}

function browserRowStatus(row, audit) {
  if (!audit?.id || !audit.status) return { status: "waiting", outcome: null, comparisonReason: null };
  if (!TERMINAL_JOB_STATUSES.has(audit.status)) {
    return { status: audit.status === "queued" ? "waiting" : "running", outcome: null, comparisonReason: null };
  }
  if (audit.status !== "complete" || !audit.report) {
    return { status: "inconclusive", outcome: "missing", comparisonReason: `audit-${audit.status}` };
  }
  const replay = (audit.report.verification?.browserReplays ?? [])
    .find((item) => item?.baseline?.findingId === row.findingId)
    ?? audit.report.verification?.browserReplay;
  if (!replay?.required || replay.status !== "complete") {
    return {
      status: "inconclusive",
      outcome: replay?.outcome ?? "missing",
      comparisonReason: replay?.status === "blocked" ? "browser-replay-blocked" : "browser-replay-missing",
    };
  }
  return replay.outcome === "passed"
    ? { status: "resolved", outcome: "passed", comparisonReason: "exact-browser-replay" }
    : { status: "still-present", outcome: "issue", comparisonReason: "exact-browser-replay" };
}

function browserGuardrailRowStatus(row, audit) {
  if (!audit?.id || !audit.status) return { status: "waiting", outcome: null, comparisonReason: null };
  if (!TERMINAL_JOB_STATUSES.has(audit.status)) {
    return { status: audit.status === "queued" ? "waiting" : "running", outcome: null, comparisonReason: null };
  }
  if (audit.status !== "complete" || !audit.report) {
    return { status: "inconclusive", outcome: "missing", comparisonReason: `audit-${audit.status}` };
  }
  const comparison = (audit.report.verification?.browserGuardrails ?? [])
    .find((item) => item?.checkId === row.baseline.checkId);
  if (!comparison || comparison.status !== "complete") {
    return {
      status: "inconclusive",
      outcome: comparison?.outcome ?? "missing",
      comparisonReason: comparison?.status === "blocked"
        ? "browser-guardrail-blocked"
        : "browser-guardrail-missing",
    };
  }
  return comparison.outcome === "passed"
    ? { status: "resolved", outcome: "passed", comparisonReason: "retained-browser-guardrail-passed" }
    : { status: "regression", outcome: "issue", comparisonReason: "retained-browser-guardrail-failed" };
}

function aggregateStatus(rows) {
  if (rows.some((row) => row.status === "still-present")) return "still-present";
  if (rows.some((row) => row.status === "regression")) return "regression";
  if (rows.some((row) => row.status === "running")) return "running";
  if (rows.some((row) => row.status === "waiting")) return "waiting";
  if (rows.some((row) => row.status === "inconclusive")) return "inconclusive";
  return rows.length && rows.every((row) => row.status === "resolved") ? "resolved" : "inconclusive";
}

export function aggregateRepairVerification(impact, run, audits = [], now = Date.now()) {
  if (impact?.status !== "reviewed" || !impact.matrix?.rows?.length || !run?.id) {
    throw new AuditError("VERIFICATION_RUN_NOT_FOUND", "No reviewed aggregate verification run exists.");
  }
  const auditsById = new Map(audits.filter((audit) => audit?.id).map((audit) => [audit.id, audit]));
  const assignments = new Map(run.assignments.map((item) => [item.targetId, item]));
  const rows = impact.matrix.rows.map((row) => {
    const assignment = assignments.get(row.targetId) ?? null;
    const audit = assignment?.auditId ? auditsById.get(assignment.auditId) : null;
    const result = row.proofKind === "browser-replay"
      ? browserRowStatus(row, audit)
      : row.proofKind === "browser-guardrail"
        ? browserGuardrailRowStatus(row, audit)
        : row.proofKind === "new-findings-guardrail"
          ? newFindingsRowStatus(row, audit)
          : providerRowStatus(row, audit);
    if (!ROW_STATUSES.has(result.status)) {
      throw new AuditError("INVALID_REPAIR", "An aggregate verification row has an invalid status.");
    }
    return {
      ...row,
      ...result,
      assignment: assignment?.auditId
        ? { auditId: assignment.auditId, workspacePath: `/audits/${encodeURIComponent(assignment.auditId)}` }
        : null,
    };
  });
  const status = aggregateStatus(rows);
  const terminal = rows.length > 0 && rows.every((row) =>
    ["resolved", "still-present", "regression", "inconclusive"].includes(row.status));
  const terminalEvidenceTimes = [...auditsById.values()]
    .filter((audit) => TERMINAL_JOB_STATUSES.has(audit?.status))
    .map((audit) => audit.completedAt ?? audit.report?.completedAt)
    .filter(Number.isFinite);
  const completedAt = terminal
    ? (run.completedAt ?? (terminalEvidenceTimes.length
        ? Math.max(...terminalEvidenceTimes)
        : run.startedAt))
    : null;
  return {
    schemaVersion: 1,
    id: run.id,
    auditId: impact.rootAuditId ?? impact.targets?.[0]?.auditId ?? null,
    repairId: impact.repairId,
    repairRevision: impact.repairRevision,
    status,
    reviewedBy: impact.matrix.reviewedBy,
    reviewedAt: impact.matrix.reviewedAt,
    startedAt: run.startedAt,
    completedAt: terminal
      ? (Number.isFinite(completedAt) ? completedAt : (Number.isFinite(now) ? now : Date.now()))
      : null,
    summary: {
      rowCount: rows.length,
      resolved: rows.filter((row) => row.status === "resolved").length,
      stillPresent: rows.filter((row) => row.status === "still-present").length,
      regressions: rows.filter((row) => row.status === "regression").length,
      inconclusive: rows.filter((row) => row.status === "inconclusive").length,
      active: rows.filter((row) => ["waiting", "running"].includes(row.status)).length,
    },
    rows,
    receiptAvailable: terminal,
  };
}

export function repairVerificationReceiptMarkdown(aggregate) {
  if (!aggregate?.receiptAvailable || !["resolved", "still-present", "regression", "inconclusive"].includes(aggregate.status)) {
    throw new AuditError(
      "VERIFICATION_RECEIPT_UNAVAILABLE",
      "The aggregate receipt is available only after every reviewed row reaches a terminal outcome.",
    );
  }
  const build = createBuildDescriptor();
  const lines = [
    "# Frontmend aggregate verification receipt",
    "",
    "> Evidence artifact only. Frontmend did not implement or deploy the reviewed repair.",
    "",
    `- Repair: ${bounded(aggregate.repairId, 80)}`,
    `- Repair revision: ${aggregate.repairRevision}`,
    `- Result: ${aggregate.status}`,
    `- Matrix reviewed by: ${aggregate.reviewedBy}`,
    `- Reviewed: ${new Date(aggregate.reviewedAt).toISOString()}`,
    `- Completed: ${new Date(aggregate.completedAt).toISOString()}`,
    `- Frontmend build: ${build.commit ? `\`${build.commit}\`` : "unidentified"}`,
    `- Protocol: v${build.protocolVersion}; tool library v${build.toolLibraryVersion}; ${build.toolCount} contracts`,
    "",
    "## Reviewed verification matrix",
    "",
    "| Finding | Path | Proof | Strategy | Status | Fresh outcome |",
    "| --- | --- | --- | --- | --- | --- |",
    ...aggregate.rows.map((row) =>
      `| ${bounded(row.findingId ?? row.findingIds?.join(", ") ?? "package guardrail", 160)} | ${bounded(row.path, 256)} | ${bounded(row.proofKind, 40)} | ${bounded(row.strategy, 40)} | ${bounded(row.status, 40)} | ${bounded(row.outcome ?? "—", 40)} |`,
    ),
    "",
    "> Every row came from retained audited scope reviewed before deployment. Missing, blocked, or incomparable evidence remains inconclusive; a retained target failure stays present and a newly failed guardrail is a regression.",
    "",
  ];
  return lines.join("\n");
}

export const verificationImpactLimits = Object.freeze({
  maxOptionalTargets: MAX_OPTIONAL_TARGETS,
  maxTargets: MAX_TARGETS,
  maxRows: MAX_ROWS,
});
