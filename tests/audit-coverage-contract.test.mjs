import assert from "node:assert/strict";
import test from "node:test";
import { createAuditCoverage, mergeAuditEvidence } from "../src/audit-coverage-contract.js";

const lighthouse = {
  screenshots: { mobile: "data:image/jpeg;base64,YWJj" },
  report: {
    auditId: "audit-1",
    completedAt: 10,
    finalUrl: "https://example.com/",
    hostname: "example.com",
    viewportCount: 2,
    viewports: [{ id: "mobile" }, { id: "desktop" }],
    viewportFailures: [],
    findingCount: 1,
    findings: [{
      id: "mobile-image-alt",
      severity: "medium",
      source: { provider: "Lighthouse", auditId: "image-alt", strategy: "mobile" },
    }],
    ruleOutcomes: [{
      source: { provider: "Lighthouse", auditId: "image-alt", strategy: "mobile" },
      status: "failed",
    }],
    checks: { passed: 0, warnings: 0, failed: 1 },
    engine: {
      mode: "live-lighthouse",
      provider: "PageSpeed Insights",
      adapterId: "google-pagespeed-lighthouse",
      adapterContractVersion: 1,
      evidenceVersion: "13.4.1",
      lighthouseVersion: "13.4.1",
      ruleSetVersion: 1,
    },
  },
};

const document = {
  screenshots: {},
  report: {
    auditId: "audit-1",
    completedAt: 12,
    finalUrl: "https://example.com/",
    hostname: "example.com",
    viewports: [{ id: "document" }],
    findings: [
      {
        id: "document-image-alt",
        severity: "medium",
        source: { provider: "Frontmend document audit", auditId: "image-alt", strategy: "document" },
      },
      {
        id: "document-content-security-policy",
        severity: "low",
        source: { provider: "Frontmend document audit", auditId: "content-security-policy", strategy: "document" },
      },
    ],
    ruleOutcomes: [
      {
        source: { provider: "Frontmend document audit", auditId: "image-alt", strategy: "document" },
        status: "failed",
      },
      {
        source: { provider: "Frontmend document audit", auditId: "content-security-policy", strategy: "document" },
        status: "failed",
      },
    ],
    checks: { passed: 0, warnings: 1, failed: 1 },
    documentProfile: { routes: ["/about", "/privacy"] },
    engine: {
      mode: "live-document",
      provider: "Frontmend document audit",
      adapterId: "frontmend-live-document",
      adapterContractVersion: 1,
      evidenceVersion: "frontmend-document-rules-1",
      ruleSetVersion: 1,
    },
  },
};

test("projects categorical source coverage without inventing a confidence score", () => {
  const coverage = createAuditCoverage({
    lighthouseReport: lighthouse.report,
    documentReport: document.report,
  });

  assert.equal(coverage.level, "page-multi-source");
  assert.deepEqual(coverage.sources.lighthouse.measuredStrategies, ["mobile", "desktop"]);
  assert.equal(coverage.sources.document.status, "complete");
  assert.equal(coverage.routeCandidateCount, 2);
  assert.equal("score" in coverage, false);
  assert.equal("confidence" in coverage, false);
  assert.deepEqual(coverage.sourceFailures, []);
  assert.deepEqual(coverage.adapters.map((adapter) => ({
    id: adapter.adapterId,
    provider: adapter.provider,
    kind: adapter.kind,
    status: adapter.status,
    evidenceVersion: adapter.evidenceVersion,
  })), [
    {
      id: "google-pagespeed-lighthouse",
      provider: "PageSpeed Insights",
      kind: "viewport-measurement",
      status: "complete",
      evidenceVersion: "13.4.1",
    },
    {
      id: "frontmend-live-document",
      provider: "Frontmend document audit",
      kind: "document-inspection",
      status: "complete",
      evidenceVersion: "frontmend-document-rules-1",
    },
  ]);
});

test("merges independent sources while suppressing duplicate document rules", () => {
  const merged = mergeAuditEvidence({ lighthouse, document });

  assert.equal(merged.report.engine.mode, "live-lighthouse-document");
  assert.deepEqual(merged.report.engine.evidenceAdapters, [
    "google-pagespeed-lighthouse",
    "frontmend-live-document",
  ]);
  assert.equal(merged.report.completedAt, 12);
  assert.equal(merged.report.findingCount, 2);
  assert.deepEqual(
    merged.report.findings.map((finding) => finding.id),
    ["mobile-image-alt", "document-content-security-policy"],
  );
  assert.equal(
    merged.report.ruleOutcomes.filter((outcome) => outcome.source.auditId === "image-alt").length,
    1,
  );
  assert.deepEqual(merged.report.checks, { passed: 0, warnings: 1, failed: 1 });
  assert.equal(merged.report.documentSupplement.overlappingRulesOmitted, 1);
  assert.deepEqual(merged.screenshots, lighthouse.screenshots);
});

test("retains one successful source and a bounded explicit failure for the other", () => {
  const error = new Error("<script>provider detail must remain data</script>".repeat(30));
  error.code = "DOCUMENT_HTTP_ERROR";
  const merged = mergeAuditEvidence({ lighthouse, documentError: error });

  assert.equal(merged.report.coverage.level, "viewport-only");
  assert.equal(merged.report.engine.mode, "live-lighthouse-document-unavailable");
  assert.equal(merged.report.sourceFailures.length, 1);
  assert.equal(merged.report.sourceFailures[0].source, "document");
  assert.equal(merged.report.sourceFailures[0].message.length <= 240, true);
  assert.equal("instructions" in merged.report.sourceFailures[0], false);
  assert.equal("authority" in merged.report.sourceFailures[0], false);
});

test("projects partial Lighthouse strategies separately from document completion", () => {
  const partial = {
    ...lighthouse,
    report: {
      ...lighthouse.report,
      viewportCount: 1,
      viewports: [{ id: "mobile" }],
      viewportFailures: [{
        id: "desktop",
        code: "PROVIDER_TIMEOUT",
        message: "Desktop timed out.",
        recoverable: true,
      }],
    },
  };
  const coverage = createAuditCoverage({
    lighthouseReport: partial.report,
    documentReport: document.report,
  });

  assert.equal(coverage.level, "page-partial");
  assert.equal(coverage.sources.lighthouse.status, "partial");
  assert.deepEqual(coverage.sources.lighthouse.unavailableStrategies, [{
    strategy: "desktop",
    code: "PROVIDER_TIMEOUT",
    message: "Desktop timed out.",
    recoverable: true,
  }]);
});
