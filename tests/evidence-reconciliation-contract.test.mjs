import test from "node:test";
import assert from "node:assert/strict";
import {
  EVIDENCE_RELATIONSHIPS,
  reconcileAssessmentEvidence,
} from "../src/evidence-reconciliation-contract.js";

const providerFinding = {
  id: "mobile-color-contrast",
  title: "Controls have insufficient contrast",
  severity: "high",
  category: "Accessibility",
  focusAreas: ["accessibility"],
  selector: ".hero-cta",
  evidence: "The retained control failed the provider contrast rule.",
  repair: "Correct the owned colour tokens after diagnosis.",
  source: { provider: "Lighthouse", auditId: "color-contrast", strategy: "mobile" },
};

function report(overrides = {}) {
  return {
    auditId: "audit-1",
    completedAt: 100,
    findings: [providerFinding],
    ...overrides,
  };
}

function review(outcome, { taskKind = "provider-confirmation", findings = [] } = {}) {
  return {
    requestedChecks: [{
      id: "investigate-color-contrast-mobile",
      kind: taskKind,
      trigger: taskKind === "provider-confirmation"
        ? {
            provider: "Lighthouse",
            auditId: "color-contrast",
            findingId: providerFinding.id,
            ruleId: "color-contrast",
            selector: ".hero-cta",
          }
        : {
            provider: "Frontmend",
            auditId: "rendered-structure",
            findingId: null,
            ruleId: null,
            selector: null,
          },
    }],
    results: [{
      checkId: "investigate-color-contrast-mobile",
      outcome,
      summary: outcome === "passed" ? "The rendered control appeared readable." : "The rendered symptom was observed.",
      observations: ["A direct rendered observation."],
      findings,
      reportedAt: 200,
    }],
  };
}

const browserFinding = {
  id: "browser:rendered-structure:01",
  title: "Primary heading is ambiguous",
  severity: "medium",
  category: "Accessibility",
  focusAreas: ["accessibility"],
  selector: "main h1",
  evidence: "Two visual headings compete as the primary topic.",
  repair: "Expose one clear page-level heading.",
  source: { provider: "Frontmend browser review", auditId: "rendered-structure:01", strategy: "desktop" },
  diagnosticEvidence: { kind: "browser-observation" },
};

function relationship(input) {
  const records = reconcileAssessmentEvidence(input);
  assert.equal(records.length, 1);
  return records[0];
}

test("retains a provider-only priority with separate measured provenance", () => {
  const result = relationship({ report: report() });
  assert.equal(result.relationship, "provider-only");
  assert.equal(result.evidenceRecords.provider.findings.length, 1);
  assert.equal(result.evidenceRecords.browser, null);
  assert.equal(result.provenance[0].kind, "provider");
});

test("links an evidence-led issue to its provider trigger as browser-confirmed", () => {
  const result = relationship({
    report: report(),
    browserReview: review("issue", { findings: [browserFinding] }),
  });
  assert.equal(result.relationship, "browser-confirmed");
  assert.equal(result.findingId, providerFinding.id);
  assert.equal(result.evidenceRecords.browser.outcome, "issue");
  assert.deepEqual(result.provenance.map((item) => item.kind), ["provider", "browser"]);
});

test("keeps a trigger-linked browser pass as an unresolved provider/browser conflict", () => {
  const result = relationship({ report: report(), browserReview: review("passed") });
  assert.equal(result.relationship, "provider-browser-conflict");
  assert.equal(result.nextAction.tool, "open_diagnostic_mission");
  assert.equal(result.nextAction.input.findingId, providerFinding.id);
  assert.match(result.unresolvedRequirement, /repository diagnosis/i);
});

test("resolves a provider/browser conflict after bounded repository diagnosis", () => {
  const result = relationship({
    report: report(),
    browserReview: review("passed"),
    diagnosticMissions: [{
      id: "diagnosis-1",
      findingId: providerFinding.id,
      state: { state: "ready-for-repair" },
      diagnosis: {
        agentReported: true,
        summary: "The static document shell is replaced by the rendered application structure.",
        sourceLocations: [{ file: "src/App.tsx", line: 12, reason: "Owns the rendered landmark." }],
        verificationChecks: ["Inspect the rendered landmark after the application mounts."],
        reportedAt: 300,
      },
    }],
  });

  assert.equal(result.relationship, "diagnosis-contributed");
  assert.equal(result.evidenceRecords.browser.outcome, "passed");
  assert.equal(result.evidenceRecords.repository.state, "ready-for-repair");
  assert.deepEqual(result.provenance.map((item) => item.kind), ["provider", "browser", "repository"]);
  assert.deepEqual(result.evidenceRecords.repository.verificationChecks, [
    "Inspect the rendered landmark after the application mounts.",
  ]);
  assert.equal(result.unresolvedRequirement, null);
  assert.equal(result.nextAction, null);
});

test("uses diagnosis-required for structured symptoms and diagnosis-contributed after repository evidence", () => {
  const diagnosticFinding = {
    ...providerFinding,
    diagnosticEvidence: { kind: "contrast-nodes" },
  };
  const required = relationship({ report: report({ findings: [diagnosticFinding] }) });
  assert.equal(required.relationship, "diagnosis-required");

  const contributed = relationship({
    report: report({ findings: [diagnosticFinding] }),
    diagnosticMissions: [{
      id: "diagnosis-1",
      findingId: diagnosticFinding.id,
      state: { state: "ready-for-repair" },
      diagnosis: {
        agentReported: true,
        summary: "The owned token produces the retained low-contrast state.",
        sourceLocations: [{ file: "src/theme.css", line: 12, reason: "Owns the token." }],
        verificationChecks: ["bun test"],
        reportedAt: 300,
      },
    }],
  });
  assert.equal(contributed.relationship, "diagnosis-contributed");
  assert.equal(contributed.evidenceRecords.repository.provenance, "agent-reported-repository");
  assert.equal(contributed.nextAction, null);
});

test("keeps generic-task issues browser-only and independent", () => {
  const result = relationship({
    report: report({ findings: [] }),
    browserReview: review("issue", { taskKind: "coverage-gap", findings: [browserFinding] }),
  });
  assert.equal(result.relationship, "browser-only");
  assert.equal(result.evidenceRecords.provider, null);
  assert.equal(result.nextAction.tool, "open_diagnostic_mission");
});

test("prioritises verification-required after implementation and each final verification outcome", () => {
  const required = relationship({
    report: report(),
    repairs: [{
      id: "repair-1",
      findingId: providerFinding.id,
      implementationReceipt: { agentReported: true },
    }],
  });
  assert.equal(required.relationship, "verification-required");
  assert.equal(required.evidenceRecords.verification.provenance, "agent-reported-implementation");

  for (const [status, expected] of [
    ["resolved", "verified-resolved"],
    ["still-present", "verified-still-present"],
    ["inconclusive", "verification-inconclusive"],
  ]) {
    const final = relationship({
      report: report({
        verification: {
          findingId: providerFinding.id,
          status,
          completedAt: 400,
          proof: { current: { auditId: "verification-audit" } },
          message: `Verification ended ${status}.`,
        },
      }),
    });
    assert.equal(final.relationship, expected);
  }
});

test("exports the complete categorical relationship vocabulary", () => {
  assert.deepEqual(EVIDENCE_RELATIONSHIPS, [
    "verified-resolved",
    "verified-still-present",
    "verification-inconclusive",
    "verification-required",
    "provider-browser-conflict",
    "diagnosis-contributed",
    "diagnosis-required",
    "browser-confirmed",
    "browser-only",
    "provider-only",
  ]);
});
