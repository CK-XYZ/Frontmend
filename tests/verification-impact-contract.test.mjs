import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateRepairVerification,
  assignRepairVerificationJobs,
  createLegacyRepairVerificationImpact,
  createRepairVerificationImpact,
  createRepairVerificationRun,
  repairVerificationReceiptMarkdown,
  reviewRepairVerificationImpact,
  verificationCandidateProjection,
} from "../src/verification-impact-contract.js";

const source = (strategy) => ({ provider: "Lighthouse", auditId: "color-contrast", strategy });
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
    ruleOutcomes: outcomes.map(([strategy, status]) => ({ source: source(strategy), status })),
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
  assert.equal(aggregate.summary.resolved, 3);
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
