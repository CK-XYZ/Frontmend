import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateRepairVerification,
  assignRepairVerificationJobs,
  createLegacyRepairVerificationImpact,
  createRepairPackageVerificationImpact,
  createRepairVerificationImpact,
  createRepairVerificationRun,
  repairVerificationReceiptMarkdown,
  reviewRepairVerificationImpact,
  verificationCandidateProjection,
} from "../src/verification-impact-contract.js";

const source = (strategy, auditId = "color-contrast") => ({ provider: "Lighthouse", auditId, strategy });
const engine = {
  mode: "live-lighthouse",
  provider: "PageSpeed Insights / Lighthouse",
  lighthouseVersion: "12.8.2",
  ruleSetVersion: 1,
};

function report({ auditId, path = "/", outcomes, findings = [] }) {
  return {
    auditId,
    url: `https://example.com${path}`,
    finalUrl: `https://example.com${path}`,
    completedAt: 100,
    engine,
    score: 88,
    findingCount: findings.length,
    checks: { passed: 8, warnings: 0, failed: findings.length },
    findings,
    ruleOutcomes: outcomes.map(([strategy, status, auditId]) => ({ source: source(strategy, auditId), status })),
  };
}

const rootReport = report({
  auditId: "root-audit",
  outcomes: [["mobile", "failed"], ["desktop", "failed"]],
  findings: [{ id: "contrast", source: source("mobile") }],
});
const failedRoute = report({
  auditId: "docs-audit",
  path: "/docs",
  outcomes: [["mobile", "failed"]],
  findings: [{ id: "contrast-docs", source: source("mobile") }],
});
const candidateRoute = report({
  auditId: "pricing-audit",
  path: "/pricing",
  outcomes: [["mobile", "passed"]],
});

function impact(selected = []) {
  return createRepairVerificationImpact({
    repairId: "repair-1",
    repairRevision: 2,
    findingId: "contrast",
    rootReport,
    findingSource: source("mobile"),
    findingScope: { sources: [source("mobile"), source("desktop")] },
    auditedReports: [
      { status: "complete", path: "/docs", report: failedRoute },
      { status: "complete", path: "/pricing", report: candidateRoute },
      { status: "queued", path: "/discovered-only", report: report({ auditId: "queued", path: "/discovered-only", outcomes: [["mobile", "passed"]] }) },
    ],
    verificationTargetIds: selected,
  });
}

test("automatically retains failed routes and exposes only evaluated completed routes as candidates", () => {
  const value = impact();
  const projection = verificationCandidateProjection(value);
  assert.deepEqual(value.previewRows.map((row) => [row.path, row.strategy]), [
    ["/", "mobile"],
    ["/", "desktop"],
    ["/docs", "mobile"],
    ["/", "all-retained"],
    ["/docs", "all-retained"],
  ]);
  assert.equal(projection.auditId, "root-audit");
  assert.equal(projection.findingId, "contrast");
  assert.deepEqual(projection.candidates, [{
    id: "audit:pricing-audit",
    auditId: "pricing-audit",
    path: "/pricing",
    strategies: ["mobile"],
    reason: "The exact retained rule was evaluated on this completed exploration route.",
  }]);
  assert.equal(value.targets.some((target) => target.path === "/discovered-only"), false);
});

test("accepts at most three exact server-issued candidate IDs and rejects paths or arbitrary IDs", () => {
  const selected = impact(["audit:pricing-audit"]);
  assert.equal(selected.previewRows.some((row) => row.path === "/pricing"), true);
  assert.throws(
    () => impact(["/pricing"]),
    (error) => error.code === "INVALID_VERIFICATION_TARGET",
  );
  assert.throws(
    () => createRepairVerificationImpact({
      repairId: "repair-1",
      rootReport,
      findingSource: source("mobile"),
      auditedReports: [],
      verificationTargetIds: ["a", "b", "c", "d"],
    }),
    (error) => error.code === "INVALID_VERIFICATION_TARGET",
  );
});

test("stamps the reviewed matrix and aggregates one existing audit assignment per path", () => {
  const reviewed = reviewRepairVerificationImpact(impact(["audit:pricing-audit"]), "person", 200);
  let run = createRepairVerificationRun(reviewed, "run-1", 210);
  run = assignRepairVerificationJobs(run, [
    { targetId: "audit:root-audit", auditId: "fresh-root" },
    { targetId: "audit:docs-audit", auditId: "fresh-docs" },
    { targetId: "audit:pricing-audit", auditId: "fresh-pricing" },
  ]);
  const freshRoot = report({ auditId: "fresh-root", outcomes: [["mobile", "passed"], ["desktop", "passed"]] });
  const freshDocs = report({ auditId: "fresh-docs", path: "/docs", outcomes: [["mobile", "failed"]] });
  const freshPricing = report({ auditId: "fresh-pricing", path: "/pricing", outcomes: [["mobile", "passed"]] });
  const aggregate = aggregateRepairVerification(reviewed, run, [
    { id: "fresh-root", status: "complete", report: freshRoot },
    { id: "fresh-docs", status: "complete", report: freshDocs },
    { id: "fresh-pricing", status: "complete", report: freshPricing },
  ], 300);
  assert.equal(run.assignments.length, 3);
  assert.equal(aggregate.status, "still-present");
  assert.equal(aggregate.auditId, "root-audit");
  assert.equal(aggregate.summary.resolved, 6);
  assert.equal(aggregate.summary.stillPresent, 1);
  assert.equal(aggregate.receiptAvailable, true);
  assert.match(repairVerificationReceiptMarkdown(aggregate), /\/docs.*still-present/);
  assert.equal(
    aggregateRepairVerification(reviewed, run, [
      { id: "fresh-root", status: "complete", report: freshRoot },
      { id: "fresh-docs", status: "complete", report: freshDocs },
      { id: "fresh-pricing", status: "complete", report: freshPricing },
    ], 999).completedAt,
    aggregate.completedAt,
  );
});

test("marks a newly failed provider guardrail as a regression after the repaired rule passes", () => {
  const baseline = report({
    auditId: "guardrail-root",
    outcomes: [
      ["mobile", "failed", "color-contrast"],
      ["mobile", "passed", "button-name"],
    ],
    findings: [{ id: "contrast", severity: "medium", focusAreas: ["accessibility"], source: source("mobile") }],
  });
  const value = createRepairVerificationImpact({
    repairId: "repair-guardrail",
    findingId: "contrast",
    rootReport: baseline,
    findingSource: source("mobile"),
    focusAreas: ["accessibility"],
  });
  const reviewed = reviewRepairVerificationImpact(value, "person", 200);
  const run = assignRepairVerificationJobs(createRepairVerificationRun(reviewed, "run-guardrail", 210), [
    { targetId: "audit:guardrail-root", auditId: "fresh-guardrail" },
  ]);
  const fresh = report({
    auditId: "fresh-guardrail",
    outcomes: [
      ["mobile", "passed", "color-contrast"],
      ["mobile", "failed", "button-name"],
    ],
  });
  const aggregate = aggregateRepairVerification(reviewed, run, [{ id: fresh.auditId, status: "complete", report: fresh }], 300);
  assert.equal(aggregate.status, "regression");
  assert.equal(aggregate.rows.find((row) => row.proofKind === "provider-rule").status, "resolved");
  assert.equal(aggregate.rows.find((row) => row.proofKind === "provider-guardrail").status, "regression");
  assert.equal(aggregate.summary.regressions, 1);
  assert.match(repairVerificationReceiptMarkdown(aggregate), /provider-guardrail.*regression/i);
});

test("marks only newly introduced high or medium retained-focus findings as regressions", () => {
  const baseline = report({
    auditId: "finding-root",
    outcomes: [["mobile", "failed"]],
    findings: [{ id: "contrast", severity: "medium", focusAreas: ["accessibility"], source: source("mobile") }],
  });
  const value = reviewRepairVerificationImpact(createRepairVerificationImpact({
    repairId: "repair-new-finding",
    findingId: "contrast",
    rootReport: baseline,
    findingSource: source("mobile"),
    focusAreas: ["accessibility"],
  }), "person", 200);
  const run = assignRepairVerificationJobs(createRepairVerificationRun(value, "run-new-finding", 210), [
    { targetId: "audit:finding-root", auditId: "fresh-finding" },
  ]);
  const fresh = report({
    auditId: "fresh-finding",
    outcomes: [["mobile", "passed"]],
    findings: [{
      id: "new-label",
      title: "A new control has no label",
      severity: "high",
      focusAreas: ["accessibility"],
      source: source("mobile", "label"),
    }],
  });
  const regression = aggregateRepairVerification(value, run, [{ id: fresh.auditId, status: "complete", report: fresh }]);
  const newFindingRow = regression.rows.find((row) => row.proofKind === "new-findings-guardrail");
  assert.equal(regression.status, "regression");
  assert.equal(newFindingRow.status, "regression");
  assert.equal(newFindingRow.introducedFindings[0].findingId, "new-label");

  const lowOnly = { ...fresh, findings: [{ ...fresh.findings[0], severity: "low" }] };
  const resolved = aggregateRepairVerification(value, run, [{ id: fresh.auditId, status: "complete", report: lowOnly }]);
  assert.equal(resolved.status, "resolved");
});

test("requires exact replay of retained journey and reflow guardrails", () => {
  const browserReview = {
    requestedChecks: [{
      id: "responsive-reflow",
      kind: "coverage-gap",
      label: "Responsive reflow",
      focusArea: "accessibility",
      focusAreas: ["accessibility"],
      target: { viewport: "mobile", path: "/" },
      assignment: {
        instructions: "Inspect the retained mobile reflow.",
        boundary: "Report direct evidence only.",
        completionCriteria: "Return the fresh reflow outcome.",
      },
    }],
    results: [{ checkId: "responsive-reflow", outcome: "passed", summary: "Content reflowed without clipping." }],
  };
  const reviewed = reviewRepairVerificationImpact(createRepairVerificationImpact({
    repairId: "repair-browser-guardrail",
    findingId: "contrast",
    rootReport,
    findingSource: source("mobile"),
    focusAreas: ["accessibility"],
    browserReview,
  }), "person", 200);
  const row = reviewed.matrix.rows.find((item) => item.proofKind === "browser-guardrail");
  assert.equal(row.baseline.checkId, "responsive-reflow");
  const run = assignRepairVerificationJobs(createRepairVerificationRun(reviewed, "run-browser-guardrail", 210), [
    { targetId: "audit:root-audit", auditId: "fresh-browser-guardrail" },
  ]);
  const fresh = report({ auditId: "fresh-browser-guardrail", outcomes: [["mobile", "passed"], ["desktop", "passed"]] });
  const missing = aggregateRepairVerification(reviewed, run, [{ id: fresh.auditId, status: "complete", report: fresh }]);
  assert.equal(missing.status, "inconclusive");
  assert.equal(missing.rows.find((item) => item.proofKind === "browser-guardrail").comparisonReason, "browser-guardrail-missing");

  fresh.verification = {
    browserGuardrails: [{ checkId: "responsive-reflow", status: "complete", outcome: "issue" }],
  };
  const regression = aggregateRepairVerification(reviewed, run, [{ id: fresh.auditId, status: "complete", report: fresh }]);
  assert.equal(regression.status, "regression");
  assert.equal(regression.summary.regressions, 1);

  fresh.verification.browserGuardrails[0].outcome = "passed";
  const resolved = aggregateRepairVerification(reviewed, run, [{ id: fresh.auditId, status: "complete", report: fresh }]);
  assert.equal(resolved.status, "resolved");
});

test("keeps missing, blocked, and incomparable coverage explicitly inconclusive", () => {
  const reviewed = reviewRepairVerificationImpact(impact(), "delegated-auto-policy", 200);
  const run = assignRepairVerificationJobs(createRepairVerificationRun(reviewed, "run-2", 210), [
    { targetId: "audit:root-audit", auditId: "fresh-root" },
    { targetId: "audit:docs-audit", auditId: "fresh-docs" },
  ]);
  const changedEngine = report({ auditId: "fresh-root", outcomes: [["mobile", "passed"], ["desktop", "passed"]] });
  changedEngine.engine = { ...changedEngine.engine, lighthouseVersion: "13.0.0" };
  const aggregate = aggregateRepairVerification(reviewed, run, [
    { id: "fresh-root", status: "complete", report: changedEngine },
    { id: "fresh-docs", status: "failed", report: null },
  ]);
  assert.equal(aggregate.status, "inconclusive");
  assert.equal(aggregate.rows.every((row) => row.status === "inconclusive"), true);
});

test("creates one exact browser replay row and locks its receipt until the replay is terminal", () => {
  const browserSource = {
    provider: "Frontmend browser review",
    auditId: "task-1:01",
    strategy: "mobile",
  };
  const value = createRepairVerificationImpact({
    repairId: "repair-browser",
    rootReport,
    findingSource: browserSource,
    findingEvidence: {
      source: browserSource,
      selector: "#menu",
      evidence: "The menu clipped at 390 px.",
      browserReviewEvidence: { reviewId: "review-1", checkId: "responsive-reflow" },
    },
  });
  const reviewed = reviewRepairVerificationImpact(value, "person", 200);
  const run = assignRepairVerificationJobs(createRepairVerificationRun(reviewed, "run-browser", 210), [
    { targetId: "audit:root-audit", auditId: "fresh-browser" },
  ]);
  const pending = aggregateRepairVerification(reviewed, run, [{
    id: "fresh-browser",
    status: "complete",
    report: { ...rootReport, auditId: "fresh-browser", verification: { browserReplay: { required: true, status: "blocked", outcome: "blocked" } } },
  }]);
  assert.equal(pending.status, "inconclusive");
  assert.throws(
    () => repairVerificationReceiptMarkdown({ ...pending, receiptAvailable: false }),
    (error) => error.code === "VERIFICATION_RECEIPT_UNAVAILABLE",
  );
});

test("projects an approved legacy single-route verification as one reviewed row", () => {
  const value = createLegacyRepairVerificationImpact({
    rootReport,
    repair: {
      id: "legacy-repair",
      revision: 3,
      status: "approved",
      findingSource: source("mobile"),
      findingScope: { sources: [source("mobile"), source("desktop")] },
      approval: { mode: "explicit-review" },
      reviewedAt: 250,
    },
  });
  assert.equal(value.status, "reviewed");
  assert.equal(value.targets.length, 1);
  assert.equal(value.matrix.rows.length, 1);
  assert.equal(value.matrix.rows[0].path, "/");
});

test("unions exact rows for a frozen package and resolves only when every finding passes", () => {
  const packageRoot = report({
    auditId: "package-root",
    outcomes: [
      ["mobile", "failed", "color-contrast"],
      ["desktop", "failed", "color-contrast"],
      ["mobile", "failed", "errors-in-console"],
    ],
    findings: [
      { id: "contrast", source: source("mobile", "color-contrast") },
      { id: "console", source: source("mobile", "errors-in-console") },
    ],
  });
  const packageImpact = createRepairPackageVerificationImpact({
    repairId: "repair-package",
    repairRevision: 3,
    rootReport: packageRoot,
    findings: [
      {
        findingId: "contrast",
        findingSource: source("mobile", "color-contrast"),
        findingScope: { sources: [source("mobile", "color-contrast"), source("desktop", "color-contrast")] },
        focusAreas: ["accessibility"],
      },
      {
        findingId: "console",
        findingSource: source("mobile", "errors-in-console"),
        findingScope: { sources: [source("mobile", "errors-in-console")] },
        focusAreas: ["reliability"],
      },
    ],
  });
  assert.deepEqual(packageImpact.findingIds, ["contrast", "console"]);
  assert.deepEqual(
    packageImpact.previewRows.filter((row) => row.proofKind === "provider-rule").map((row) => row.findingId),
    ["contrast", "contrast", "console"],
  );
  assert.equal(
    packageImpact.previewRows.filter((row) => row.proofKind === "new-findings-guardrail").length,
    1,
  );

  const reviewed = reviewRepairVerificationImpact(packageImpact, "person", 400);
  const run = assignRepairVerificationJobs(
    createRepairVerificationRun(reviewed, "package-run", 410),
    [{ targetId: "audit:package-root", auditId: "package-fresh" }],
  );
  const passing = report({
    auditId: "package-fresh",
    outcomes: [
      ["mobile", "passed", "color-contrast"],
      ["desktop", "passed", "color-contrast"],
      ["mobile", "passed", "errors-in-console"],
    ],
  });
  const resolved = aggregateRepairVerification(reviewed, run, [
    { id: "package-fresh", status: "complete", report: passing },
  ], 420);
  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.rows.filter((row) => row.proofKind === "provider-rule").every((row) => row.status === "resolved"), true);
  assert.match(repairVerificationReceiptMarkdown(resolved), /\| console \| \/ \| provider-rule/i);

  const failing = report({
    auditId: "package-fresh",
    outcomes: [
      ["mobile", "passed", "color-contrast"],
      ["desktop", "passed", "color-contrast"],
      ["mobile", "failed", "errors-in-console"],
    ],
    findings: [{ id: "console-fresh", source: source("mobile", "errors-in-console") }],
  });
  const stillPresent = aggregateRepairVerification(reviewed, run, [
    { id: "package-fresh", status: "complete", report: failing },
  ], 430);
  assert.equal(stillPresent.status, "still-present");
  assert.equal(stillPresent.rows.find((row) => row.findingId === "console" && row.proofKind === "provider-rule").status, "still-present");
});
