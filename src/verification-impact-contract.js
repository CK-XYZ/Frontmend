import { AuditError } from "./url-policy.js";

const EVALUATED_STATUSES = new Set(["passed", "failed", "not-applicable"]);
const TERMINAL_JOB_STATUSES = new Set(["complete", "failed", "cancelled"]);
const ROW_STATUSES = new Set(["waiting", "running", "resolved", "still-present", "inconclusive"]);
const MAX_OPTIONAL_TARGETS = 3;
const MAX_TARGETS = 4;
const MAX_ROWS = 20;

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
      outcome: "issue",
      evidence: bounded(findingEvidence.evidence, 600),
      selector: bounded(findingEvidence.selector, 200),
      checkId: bounded(findingEvidence.browserReviewEvidence.checkId, 80),
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
  rootReport,
  findingSource,
  findingScope = null,
  findingEvidence = null,
  auditedReports = [],
  verificationTargetIds,
} = {}) {
  if (!repairId || !rootReport?.auditId || !findingSource?.provider || !findingSource?.auditId) {
    throw new AuditError("INVALID_REPAIR", "A repair, root report, and retained finding rule are required.");
  }
  const browserFinding = findingSource.provider === "Frontmend browser review";
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
      required,
      reason: required
        ? entry.root
          ? "Root route retained by the selected repair."
          : "The exact retained rule failed on this completed exploration route."
        : "The exact retained rule was evaluated on this completed exploration route.",
      evaluatedSources: evidence.evaluated,
      failedSources: evidence.failed,
      baselineReport: baselineReportSnapshot(entry.report, evidence.evaluated.length ? evidence.evaluated : [findingSource]),
    });
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
  const rows = selected.flatMap((target) => browserFinding
    ? browserRowForTarget(target, findingEvidence)
    : providerRowsForTarget(target, selectedTargetIds.includes(target.id))).slice(0, MAX_ROWS);
  if (!rows.length) {
    throw new AuditError("INVALID_REPAIR", "The retained repair has no exact verification rows.");
  }
  return {
    schemaVersion: 1,
    repairId: bounded(repairId, 80),
    repairRevision: Number.isInteger(repairRevision) && repairRevision > 0 ? repairRevision : 1,
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

export function selectRepairVerificationTargets(impact, verificationTargetIds, repairRevision) {
  if (!impact?.repairId || !Array.isArray(impact.targets)) {
    throw new AuditError("INVALID_REPAIR", "The repair verification impact is unavailable.");
  }
  const selectedTargetIds = validateSelectedCandidateIds(
    verificationTargetIds,
    impact.candidates ?? [],
  );
  const selected = impact.targets.filter((target) => target.required || selectedTargetIds.includes(target.id));
  const browserFinding = impact.rule?.provider === "Frontmend browser review";
  const rows = selected.flatMap((target) => browserFinding
    ? impact.previewRows.filter((row) => row.targetId === target.id)
    : providerRowsForTarget(target, selectedTargetIds.includes(target.id))).slice(0, MAX_ROWS);
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
  if (source?.provider?.includes("Lighthouse")) {
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
  if (outcome === "failed") return { status: "still-present", outcome, comparisonReason: "exact-rule-failed" };
  if (outcome === "passed") return { status: "resolved", outcome, comparisonReason: "exact-rule-passed" };
  return { status: "inconclusive", outcome, comparisonReason: "exact-rule-not-evaluated" };
}

function browserRowStatus(row, audit) {
  if (!audit?.id || !audit.status) return { status: "waiting", outcome: null, comparisonReason: null };
  if (!TERMINAL_JOB_STATUSES.has(audit.status)) {
    return { status: audit.status === "queued" ? "waiting" : "running", outcome: null, comparisonReason: null };
  }
  if (audit.status !== "complete" || !audit.report) {
    return { status: "inconclusive", outcome: "missing", comparisonReason: `audit-${audit.status}` };
  }
  const replay = audit.report.verification?.browserReplay;
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

function aggregateStatus(rows) {
  if (rows.some((row) => row.status === "still-present")) return "still-present";
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
    ["resolved", "still-present", "inconclusive"].includes(row.status));
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
      inconclusive: rows.filter((row) => row.status === "inconclusive").length,
      active: rows.filter((row) => ["waiting", "running"].includes(row.status)).length,
    },
    rows,
    receiptAvailable: terminal,
  };
}

export function repairVerificationReceiptMarkdown(aggregate) {
  if (!aggregate?.receiptAvailable || !["resolved", "still-present", "inconclusive"].includes(aggregate.status)) {
    throw new AuditError(
      "VERIFICATION_RECEIPT_UNAVAILABLE",
      "The aggregate receipt is available only after every reviewed row reaches a terminal outcome.",
    );
  }
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
    "",
    "## Reviewed verification matrix",
    "",
    "| Path | Proof | Strategy | Status | Fresh outcome |",
    "| --- | --- | --- | --- | --- |",
    ...aggregate.rows.map((row) =>
      `| ${bounded(row.path, 256)} | ${bounded(row.proofKind, 40)} | ${bounded(row.strategy, 40)} | ${bounded(row.status, 40)} | ${bounded(row.outcome ?? "—", 40)} |`,
    ),
    "",
    "> Every row came from retained audited scope reviewed before deployment. Missing, blocked, or incomparable evidence remains inconclusive; one failure keeps the repair still present.",
    "",
  ];
  return lines.join("\n");
}

export const verificationImpactLimits = Object.freeze({
  maxOptionalTargets: MAX_OPTIONAL_TARGETS,
  maxTargets: MAX_TARGETS,
  maxRows: MAX_ROWS,
});
