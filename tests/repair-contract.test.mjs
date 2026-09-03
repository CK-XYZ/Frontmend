import assert from "node:assert/strict";
import test from "node:test";
import {
  applyRepairPolicy,
  auditReportMarkdown,
  compareVerification,
  createRepairPolicy,
  createRepositoryFixBrief,
  createVerificationContext,
  createRepairDraft,
  recordRepositoryImplementation,
  requestRepairChanges,
  repairMissionState,
  repairExportMarkdown,
  reviseRepairDraft,
  verificationReceiptMarkdown,
} from "../src/repair-contract.js";
import {
  createBrowserVerificationReview,
  recordBrowserReviewCheck,
} from "../src/browser-review-contract.js";
import {
  openCandidateReview,
  recordCandidateReviewCheck,
} from "../src/candidate-review-contract.js";
import { explorationAssessmentFindings } from "../src/audit-mission-contract.js";
import {
  createDiagnosticMission,
  submitDiagnosticEvidence,
} from "../src/diagnostic-contract.js";

const finding = {
  id: "document-content-security-policy",
  title: "No Content Security Policy header was observed",
  severity: "low",
  repair: "Introduce a tested Content Security Policy.",
  source: {
    provider: "Frontmend document audit",
    auditId: "content-security-policy",
    strategy: "document",
  },
};

test("creates a source-safe repository handoff from measured evidence", () => {
  const brief = createRepositoryFixBrief({
    auditId: "b8b16bf0-913c-40ea-a741-bb4bf76d326b",
    url: "https://removemyexif.com/",
    finalUrl: "https://removemyexif.com/",
    engine: { mode: "live-document", provider: "Frontmend document audit", ruleSetVersion: 1 },
    findings: [
      {
        ...finding,
        category: "Security",
        selector: "Document",
        evidence: "The Content-Security-Policy response header was absent.",
      },
    ],
  }, finding.id);

  assert.equal(brief.schemaVersion, 2);
  assert.equal(brief.findingId, finding.id);
  assert.equal(brief.target.publicPath, "/");
  assert.equal(brief.evidence.ruleId, "content-security-policy");
  assert.equal(brief.repositoryHandoff.patchType, "headers");
  assert.equal(brief.repositoryHandoff.risk, "high");
  assert.match(brief.repositoryHandoff.inspectFor[0], /response-header/i);
  assert.match(brief.repositoryHandoff.suggestedChange, /Report-Only/);
  assert.equal(brief.repositoryHandoff.acceptanceCriteria.length, 4);
  assert.deepEqual(brief.candidateReview.sequence, [
    "record_repository_implementation",
    "open_candidate_review",
    "record_candidate_review_check",
    "get_candidate_review",
  ]);
  assert.match(brief.candidateReview.evidenceBoundary, /fresh public Frontmend verification is still required/i);
  assert.equal(brief.authority.frontmendChangedTarget, false);
  assert.equal(brief.authority.sourceAccess, "coding-agent-only");
  assert.match(brief.authority.privacy, /absolute paths/);
});

test("repository handoffs retain bounded measured diagnostics without promoting agent evidence", () => {
  const consoleFinding = {
    ...finding,
    id: "mobile-errors-in-console",
    title: "The page reports browser errors",
    category: "Reliability",
    selector: "https://example.com/app.js",
    evidence: "2 errors logged to the console",
    source: { provider: "Lighthouse", auditId: "errors-in-console", strategy: "mobile" },
    diagnosticEvidence: {
      version: 1,
      kind: "console-errors",
      provenance: "measured-lighthouse",
      completeness: "actionable",
      missing: [],
      entries: [{
        description: "ReferenceError: widget is not defined",
        source: "javascript",
        sourceUrl: "https://example.com/app.js",
        lineNumber: 42,
        columnNumber: 7,
        ignored: "must not cross the contract",
      }],
      omitted: 0,
      caveat: "Reproduce before changing source.",
    },
  };
  const report = {
    schemaVersion: 5,
    auditId: "b8b16bf0-913c-40ea-a741-bb4bf76d326b",
    url: "https://example.com/",
    finalUrl: "https://example.com/",
    completedAt: 1_787_766_000_000,
    score: 90,
    scoreBasis: "measured-lighthouse-viewports",
    viewportCount: 1,
    viewports: [{ id: "mobile", label: "Mobile", detail: "Lighthouse" }],
    viewportFailures: [],
    findingCount: 1,
    findingsOmitted: 0,
    findings: [consoleFinding],
    checks: { passed: 1, warnings: 0, failed: 1 },
    ruleOutcomes: [{ source: consoleFinding.source, status: "failed" }],
    engine: { mode: "live-lighthouse", provider: "PageSpeed Insights", ruleSetVersion: 1, lighthouseVersion: "13.4.1", notice: "Measured." },
  };

  const brief = createRepositoryFixBrief(report, consoleFinding.id);
  assert.equal(brief.evidence.diagnostics.kind, "console-errors");
  assert.equal(brief.evidence.diagnostics.entries[0].lineNumber, 42);
  assert.equal("ignored" in brief.evidence.diagnostics.entries[0], false);
  assert.equal(brief.evidence.occurrences[0].diagnostics.provenance, "measured-lighthouse");

  const markdown = auditReportMarkdown(report);
  assert.match(markdown, /Measured diagnostics: console-errors · actionable/);
  assert.match(markdown, /ReferenceError: widget is not defined/);
  assert.match(markdown, /https:\/\/example\.com\/app\.js:42:7/);
});

test("repository handoff preserves aggregate route evidence and contributed source ownership", () => {
  const report = {
    schemaVersion: 5,
    auditId: "root-audit",
    url: "https://example.com/",
    finalUrl: "https://example.com/",
    completedAt: 100,
    engine: { mode: "live-lighthouse", provider: "PageSpeed Insights / Lighthouse" },
    findings: [],
    ruleOutcomes: [],
  };
  const exploration = {
    id: "232d593c-6c81-48c3-b137-a3df269454ff",
    rootAuditId: report.auditId,
    status: "complete",
    createdAt: 200,
    issues: [{
      findingId: "site-6d9c91c2",
      provider: "Lighthouse",
      ruleId: "label",
      title: "Upload inputs have no accessible label",
      severity: "high",
      category: "Accessibility",
      focusAreas: ["accessibility"],
      status: "detected",
      occurrenceCount: 2,
      distinctPageCount: 2,
      suggestedRepair: "Associate a visible label with each shared upload input.",
      occurrences: [
        {
          occurrenceId: "occ-11111111",
          sourceFindingId: "mobile-label",
          auditId: "remove-audit",
          path: "/remove",
          url: "https://example.com/remove",
          strategy: "mobile",
          viewport: "mobile",
          selector: "#pdf-upload",
          evidence: "The PDF input has no accessible name.",
          evidenceIds: ["/api/audits/remove-audit/evidence/mobile"],
          source: { provider: "Lighthouse", auditId: "label", strategy: "mobile" },
        },
        {
          occurrenceId: "occ-22222222",
          sourceFindingId: "desktop-label",
          auditId: "word-audit",
          path: "/word",
          url: "https://example.com/word",
          strategy: "desktop",
          viewport: "desktop",
          selector: "#word-upload",
          evidence: "The Word input has no accessible name.",
          evidenceIds: ["/api/audits/word-audit/evidence/desktop"],
          source: { provider: "Lighthouse", auditId: "label", strategy: "desktop" },
        },
      ],
    }],
  };
  const [aggregateFinding] = explorationAssessmentFindings([exploration]);
  let diagnosis = createDiagnosticMission({
    auditId: report.auditId,
    finding: aggregateFinding,
    relationship: "repair-trace-required",
    now: 300,
  });
  diagnosis = submitDiagnosticEvidence(diagnosis, {
    summary: "Both routes render the same shared upload component without its label relationship.",
    reproduction: "Inspect #pdf-upload on /remove and #word-upload on /word at their retained viewports.",
    observations: [{ kind: "accessibility", detail: "Both file inputs expose no accessible name." }],
    sourceLocations: [{
      file: "src/components/UploadField.jsx",
      line: 38,
      symbol: "UploadField",
      reason: "Owns the shared input and visible prompt on both retained routes.",
    }],
    verificationChecks: ["bun test", "Replay both retained routes at their measured viewports"],
    confidence: "high",
  }, "agent", 400);

  const brief = createRepositoryFixBrief(
    report,
    aggregateFinding.id,
    [aggregateFinding],
    null,
    [diagnosis],
  );

  assert.equal(brief.findingId, "site-6d9c91c2");
  assert.equal(brief.evidence.occurrenceCount, 2);
  assert.deepEqual(brief.target.routes.map((route) => [route.auditId, route.path]), [
    ["remove-audit", "/remove"],
    ["word-audit", "/word"],
  ]);
  assert.deepEqual(brief.evidence.occurrences.map((occurrence) => ({
    occurrenceId: occurrence.occurrenceId,
    sourceFindingId: occurrence.sourceFindingId,
    selector: occurrence.selector,
    evidenceIds: occurrence.evidenceIds,
  })), [
    {
      occurrenceId: "occ-11111111",
      sourceFindingId: "mobile-label",
      selector: "#pdf-upload",
      evidenceIds: ["/api/audits/remove-audit/evidence/mobile"],
    },
    {
      occurrenceId: "occ-22222222",
      sourceFindingId: "desktop-label",
      selector: "#word-upload",
      evidenceIds: ["/api/audits/word-audit/evidence/desktop"],
    },
  ]);
  assert.deepEqual(brief.repositoryHandoff.contributedDiagnosis.sourceLocations, [{
    file: "src/components/UploadField.jsx",
    line: 38,
    symbol: "UploadField",
    reason: "Owns the shared input and visible prompt on both retained routes.",
  }]);
  assert.deepEqual(brief.repositoryHandoff.contributedDiagnosis.verificationChecks, [
    "bun test",
    "Replay both retained routes at their measured viewports",
  ]);

  const repair = createRepairDraft({
    repairId: "aggregate-repair",
    auditId: report.auditId,
    finding: aggregateFinding,
    diagnosticMissions: [diagnosis],
    report,
    source: "agent",
  });
  assert.equal(repair.findingScope.rootAffected, false);
  assert.deepEqual(repair.findingScope.routes.map((route) => route.path), ["/remove", "/word"]);
  assert.equal(repair.diagnosticMission.diagnosis.sourceLocations[0].file, "src/components/UploadField.jsx");
});

test("delegated auto mode consumes a bounded human grant only for eligible repository plans", () => {
  const policy = createRepairPolicy({ mode: "auto-low-risk" }, 100);
  assert.equal(policy.remainingAutoApprovals, 3);
  assert.equal(policy.deploymentAttestation, "person-only");

  const eligible = createRepairDraft({
    auditId: "b8b16bf0-913c-40ea-a741-bb4bf76d326b",
    finding,
    input: {
      summary: "Repair the measured markup.",
      patchType: "html",
      patch: "Add the missing accessible label.",
      verificationPlan: "Rerun the exact rule in every captured strategy.",
      risk: "low",
      repositoryFiles: ["src/App.jsx"],
      repositoryChecks: ["bun test"],
    },
    source: "agent",
    now: 110,
  });
  const authorised = applyRepairPolicy(eligible, policy, 120);
  assert.equal(authorised.repair.status, "approved");
  assert.equal(authorised.repair.requiresHumanReview, false);
  assert.equal(authorised.repair.approval.mode, "delegated-auto");
  assert.equal(authorised.repair.approval.policyEnabledAt, 100);
  assert.equal(authorised.policy.remainingAutoApprovals, 2);
  assert.equal(repairMissionState(authorised.repair).approvalEvidence, "prior-human-auto-policy");
  assert.equal(repairMissionState(authorised.repair).deploymentEvidence, "none");

  const ineligible = createRepairDraft({
    auditId: "b8b16bf0-913c-40ea-a741-bb4bf76d326b",
    finding: { ...finding, id: "console-errors" },
    input: {
      summary: "Change runtime behaviour.",
      patchType: "javascript",
      patch: "Change the initialisation path.",
      verificationPlan: "Rerun the production console audit.",
      risk: "low",
      repositoryFiles: ["src/main.jsx"],
      repositoryChecks: ["bun test"],
    },
    source: "agent",
    now: 130,
  });
  const gated = applyRepairPolicy(ineligible, authorised.policy, 140);
  assert.equal(gated.repair.status, "draft");
  assert.equal(gated.repair.requiresHumanReview, true);
  assert.match(gated.repair.automation.reasons.join(" "), /HTML and CSS/);
  assert.equal(gated.policy.remainingAutoApprovals, 2);
});

test("repository handoff carries every failing strategy for the same measured rule", () => {
  const mobile = {
    id: "mobile-color-contrast",
    title: "Text contrast is too low",
    severity: "medium",
    category: "Accessibility",
    selector: "button.mobile-action",
    evidence: "Lighthouse score 0 · button.mobile-action",
    repair: "Adjust foreground or background color tokens.",
    viewport: "Mobile · Lighthouse emulation",
    source: { provider: "Lighthouse", auditId: "color-contrast", strategy: "mobile" },
  };
  const desktop = {
    ...mobile,
    id: "desktop-color-contrast",
    selector: "a.desktop-action",
    evidence: "Lighthouse score 0 · a.desktop-action",
    viewport: "Desktop · Lighthouse emulation",
    source: { ...mobile.source, strategy: "desktop" },
  };
  const brief = createRepositoryFixBrief({
    auditId: "b8b16bf0-913c-40ea-a741-bb4bf76d326b",
    url: "https://example.com/",
    finalUrl: "https://example.com/",
    engine: { mode: "live-lighthouse", provider: "PageSpeed Insights", lighthouseVersion: "13.4.1" },
    findings: [mobile, desktop],
    ruleOutcomes: [
      { source: mobile.source, status: "failed" },
      { source: desktop.source, status: "failed" },
    ],
  }, mobile.id);

  assert.equal(brief.evidence.occurrenceCount, 2);
  assert.equal(brief.evidence.occurrencesOmitted, 0);
  assert.deepEqual(brief.evidence.failingStrategies, ["mobile", "desktop"]);
  assert.deepEqual(
    brief.evidence.occurrences.map((occurrence) => occurrence.findingId),
    [mobile.id, desktop.id],
  );
  assert.match(brief.repositoryHandoff.acceptanceCriteria[0], /mobile and desktop/);
});

test("creates a bounded source-attributed repair that requires human review", () => {
  const repair = createRepairDraft({
    auditId: "b8b16bf0-913c-40ea-a741-bb4bf76d326b",
    finding,
    source: "agent",
    input: {
      repositoryFiles: ["frontend/next.config.ts", "frontend/tests/headers.test.ts"],
      repositoryChecks: ["bun test", "bun run build"],
    },
    now: 1_787_766_000_000,
  });

  assert.equal(repair.status, "draft");
  assert.equal(repair.source, "agent");
  assert.equal(repair.requiresHumanReview, true);
  assert.equal(repair.patchType, "headers");
  assert.equal(repair.risk, "high");
  assert.match(repair.patch, /Report-Only/);
  assert.equal(repair.reviewedAt, null);
  assert.equal(repair.deploymentAttestedAt, null);
  assert.deepEqual(repair.repositoryPlan.files, [
    "frontend/next.config.ts",
    "frontend/tests/headers.test.ts",
  ]);
  assert.deepEqual(repair.repositoryPlan.checks, ["bun test", "bun run build"]);
  assert.equal(repair.repositoryPlan.source, "agent");
  assert.equal(repair.repositoryPlan.sourceChangedByFrontmend, false);
});

test("keeps a cohesive multi-finding package immutable and outside delegated auto approval", () => {
  const second = {
    id: "document-missing-h1",
    title: "The document has no primary heading",
    severity: "medium",
    category: "SEO",
    focusAreas: ["seo", "accessibility"],
    evidence: "No h1 element was found in the fetched document.",
    repair: "Add one descriptive primary heading to the shared page template.",
    source: { provider: "Frontmend document audit", auditId: "missing-h1", strategy: "document" },
  };
  const repair = createRepairDraft({
    auditId: "audit-package",
    finding,
    findings: [finding, second],
    input: {
      findingIds: [finding.id, second.id],
      summary: "Repair the retained response policy and page heading in one reviewed template change.",
      patchType: "html",
      patch: "Add the primary heading and the bounded response-policy configuration.",
      verificationPlan: "Rerun both exact rules and retained guardrails.",
      risk: "low",
      repositoryFiles: ["src/template.html"],
      repositoryChecks: ["bun test"],
    },
    source: "agent",
    now: 200,
  });
  assert.deepEqual(repair.findingIds, [finding.id, second.id]);
  assert.equal(repair.findingPackage.items.length, 2);
  assert.equal(repair.findingPackage.primaryFindingId, finding.id);

  const policy = createRepairPolicy({ mode: "auto-low-risk" }, 210);
  const gated = applyRepairPolicy(repair, policy, 220);
  assert.equal(gated.repair.status, "draft");
  assert.equal(gated.repair.requiresHumanReview, true);
  assert.match(gated.repair.automation.reasons.join(" "), /multi-finding packages require explicit review/i);
  assert.equal(gated.policy.remainingAutoApprovals, policy.remainingAutoApprovals);

  const revised = reviseRepairDraft(
    requestRepairChanges(repair, "Clarify the shared verification boundary.", 230),
    { verificationPlan: "Rerun both exact rules on every retained route, then replay browser guardrails." },
    "agent",
    240,
  );
  assert.deepEqual(revised.findingIds, repair.findingIds);
  assert.deepEqual(revised.findingPackage, repair.findingPackage);
  assert.throws(
    () => reviseRepairDraft(requestRepairChanges(repair, "Do not replace package membership.", 250), {
      findingIds: [second.id],
    }),
    (error) => error.code === "INVALID_REPAIR",
  );
});

test("turns bounded CSP evidence into a conservative site-aware report-only draft", () => {
  const repair = createRepairDraft({
    auditId: "b8b16bf0-913c-40ea-a741-bb4bf76d326b",
    finding: {
      ...finding,
      repairContext: {
        type: "csp-resource-inventory",
        directives: [
          {
            directive: "script-src",
            origins: ["https://scripts.example.net", "https://scripts.example.net/path"],
          },
          { directive: "img-src", origins: ["https://images.example.net"] },
          { directive: "connect-src", origins: ["https://ignored.example.net"] },
        ],
        inline: { scripts: 3, styles: 2 },
      },
    },
  });

  assert.match(repair.patch, /Content-Security-Policy-Report-Only:/);
  assert.match(repair.patch, /script-src 'self' https:\/\/scripts\.example\.net/);
  assert.match(repair.patch, /img-src 'self' https:\/\/images\.example\.net/);
  assert.match(repair.patch, /Inline evidence: 3 script blocks, 2 style block\/attributes/);
  assert.doesNotMatch(repair.patch, /scripts\.example\.net\/path/);
  assert.doesNotMatch(repair.patch, /ignored\.example\.net/);
  assert.doesNotMatch(repair.patch, /unsafe-inline/);
  assert.match(repair.verificationPlan, /critical user journeys/);
});

test("rejects unbounded or unknown repair proposal fields", () => {
  assert.throws(
    () =>
      createRepairDraft({
        auditId: "b8b16bf0-913c-40ea-a741-bb4bf76d326b",
        finding,
        input: { secretContext: "no" },
      }),
    (error) => error.code === "INVALID_REPAIR",
  );
  assert.throws(
    () => createRepairDraft({
      auditId: "b8b16bf0-913c-40ea-a741-bb4bf76d326b",
      finding,
      source: "agent",
      input: {
        repositoryFiles: ["C:/private/source.js"],
        repositoryChecks: ["bun test"],
      },
    }),
    (error) => error.code === "INVALID_REPAIR" && /repository-relative/i.test(error.message),
  );
  assert.throws(
    () => createRepairDraft({
      auditId: "b8b16bf0-913c-40ea-a741-bb4bf76d326b",
      finding,
      source: "human",
      input: {
        repositoryFiles: ["src/index.js"],
        repositoryChecks: ["bun test"],
      },
    }),
    (error) => error.code === "INVALID_REPAIR" && /coding agent/i.test(error.message),
  );
  assert.throws(
    () =>
      createRepairDraft({
        auditId: "b8b16bf0-913c-40ea-a741-bb4bf76d326b",
        finding,
        input: { patch: "x".repeat(3_001) },
      }),
    (error) => error.code === "INVALID_REPAIR",
  );
});

test("repair mission state keeps agent, human, and external actions explicit", () => {
  const empty = repairMissionState(null);
  assert.equal(empty.state, "not-started");
  assert.deepEqual(empty.nextActions, [{ id: "stage_repair", actor: "person-or-agent" }]);
  assert.equal(empty.steps.find((step) => step.id === "review").status, "blocked");

  const draft = repairMissionState({ id: "repair-1", status: "draft" });
  assert.equal(draft.state, "awaiting-human-review");
  assert.deepEqual(draft.nextActions, [{ id: "review_in_ui", actor: "person" }]);
  assert.equal(draft.continuation.nextActor, "person");
  assert.equal(draft.continuation.nextAction, null);
  assert.equal(draft.steps.find((step) => step.id === "review").owner, "Person");

  const approved = repairMissionState({ id: "repair-1", status: "approved" });
  assert.equal(approved.state, "awaiting-external-deployment");
  assert.equal(approved.targetMutation, "external-only");
  assert.equal(approved.implementationEvidence, "none");
  assert.equal(approved.deploymentEvidence, "none");
  assert.equal(approved.steps.find((step) => step.id === "deploy").status, "current");
  assert.equal(approved.steps.find((step) => step.id === "verify").status, "blocked");
  assert.equal(approved.continuation.nextAction.tool, "record_repository_implementation");
  assert.deepEqual(
    approved.nextActions.map((action) => action.actor),
    ["agent", "person", "site-owner", "site-owner"],
  );
  assert.equal(approved.nextActions[0].optional, true);
  assert.equal(approved.steps.find((step) => step.id === "implement").status, "available");

  const attested = repairMissionState({
    id: "repair-1",
    status: "approved",
    deploymentAttestedAt: 1_787_766_050_000,
  });
  assert.equal(attested.state, "ready-for-verification");
  assert.equal(attested.deploymentEvidence, "site-owner-attestation");
  assert.equal(attested.steps.find((step) => step.id === "deploy").status, "attested");
  assert.equal(attested.steps.find((step) => step.id === "verify").status, "available");
  assert.equal(attested.continuation.nextAction.tool, "start_repair_verification");
  assert.deepEqual(
    attested.nextActions.map((action) => action.actor),
    ["person", "person-or-agent"],
  );

  const changesRequested = repairMissionState({ id: "repair-1", status: "changes-requested" });
  assert.equal(changesRequested.state, "changes-requested");
  assert.equal(changesRequested.steps.find((step) => step.id === "draft").status, "current");
  assert.equal(changesRequested.steps.find((step) => step.id === "review").status, "blocked");
  assert.deepEqual(changesRequested.nextActions, [{ id: "revise_repair", actor: "agent" }]);
  assert.equal(changesRequested.continuation.nextAction.tool, "revise_site_repair");
});

test("records bounded agent implementation evidence without claiming deployment", () => {
  const approved = {
    ...createRepairDraft({ auditId: "audit-1", finding, now: 100 }),
    status: "approved",
    reviewedAt: 110,
  };
  const implemented = recordRepositoryImplementation(
    approved,
    {
      summary: "Added the reviewed report-only header through the repository configuration.",
      files: ["worker/index.js", "tests/headers.test.mjs"],
      checks: [
        { name: "bun test", status: "passed" },
        { name: "production build", status: "failed" },
      ],
      commitSha: "94a2827",
    },
    120,
  );

  assert.equal(implemented.implementationReceipt.source, "agent");
  assert.equal(implemented.implementationReceipt.revision, 1);
  assert.deepEqual(implemented.implementationHistory, []);
  assert.equal(implemented.implementationReceipt.sourceChangedByFrontmend, false);
  assert.equal(implemented.deploymentAttestedAt, null);
  const failedMission = repairMissionState(implemented);
  assert.equal(failedMission.state, "implementation-attention");
  assert.equal(failedMission.implementationEvidence, "checks-failed");
  assert.equal(failedMission.steps.find((step) => step.id === "implement").status, "attention");
  assert.equal(
    failedMission.steps.find((step) => step.id === "implement").detail,
    "Agent checks failed",
  );
  const rerun = recordRepositoryImplementation(implemented, {
    summary: "Re-ran the checks after correcting the repository test fixture.",
    files: ["worker/index.js", "tests/headers.test.mjs"],
    checks: [{ name: "bun test", status: "passed" }],
    commitSha: "94a2827",
  }, 130);
  assert.equal(rerun.implementationReceipt.revision, 2);
  assert.equal(rerun.implementationHistory.length, 1);
  assert.equal(rerun.implementationHistory[0].revision, 1);
  assert.equal(rerun.implementationHistory[0].checks[1].status, "failed");
  assert.equal(repairMissionState(rerun).implementationEvidence, "checks-passed");
  assert.equal(repairMissionState(rerun).steps.find((step) => step.id === "implement").status, "complete");

  const incompleteMission = repairMissionState({
    ...rerun,
    implementationReceipt: {
      ...rerun.implementationReceipt,
      checks: [{ name: "production build", status: "not-run" }],
    },
  });
  assert.equal(incompleteMission.implementationEvidence, "checks-incomplete");
  assert.equal(incompleteMission.state, "implementation-attention");
  assert.equal(incompleteMission.steps.find((step) => step.id === "implement").status, "attention");
  let boundedHistory = rerun;
  for (let revision = 3; revision <= 8; revision += 1) {
    boundedHistory = recordRepositoryImplementation(boundedHistory, {
      summary: `Implementation receipt revision ${revision}.`,
      files: ["worker/index.js"],
      checks: [{ name: "bun test", status: "passed" }],
    }, 130 + revision);
  }
  assert.equal(boundedHistory.implementationReceipt.revision, 8);
  assert.deepEqual(
    boundedHistory.implementationHistory.map((receipt) => receipt.revision),
    [3, 4, 5, 6, 7],
  );
  assert.throws(
    () => recordRepositoryImplementation(approved, {
      summary: "Unsafe path",
      files: ["C:/private/source.js"],
      checks: [{ name: "test", status: "passed" }],
    }),
    (error) => error.code === "INVALID_IMPLEMENTATION_RECEIPT",
  );
  assert.throws(
    () => recordRepositoryImplementation(approved, {
      summary: "URL is not a repository path",
      files: ["https://example.com/source.js"],
      checks: [{ name: "test", status: "passed" }],
    }),
    (error) => error.code === "INVALID_IMPLEMENTATION_RECEIPT",
  );
  assert.throws(
    () => recordRepositoryImplementation({ ...approved, deploymentAttestedAt: 130 }, {
      summary: "Late receipt",
      files: ["src/index.js"],
      checks: [{ name: "test", status: "passed" }],
    }),
    (error) => error.code === "DEPLOYMENT_ALREADY_ATTESTED",
  );
});

test("candidate issues return the authoritative repair mission to coding implementation", () => {
  let repair = {
    ...createRepairDraft({ auditId: "audit-1", finding, now: 100 }),
    status: "approved",
    reviewedAt: 110,
  };
  repair = recordRepositoryImplementation(repair, {
    summary: "Implemented the reviewed header repair.",
    files: ["worker/index.js"],
    checks: [{ name: "bun test", status: "passed" }],
  }, 120);
  repair = openCandidateReview(repair, { candidateOrigin: "http://localhost:5173" }, "agent", 130);
  repair = recordCandidateReviewCheck(repair, repair.candidateReview.id, {
    checkId: repair.candidateReview.state.nextCheck.id,
    outcome: "issue",
    summary: "The retained candidate symptom remains.",
    observations: ["The exact retained rule still fails at the candidate viewport."],
  }, "agent", 140);

  const mission = repairMissionState(repair);
  assert.equal(mission.state, "candidate-attention");
  assert.equal(mission.candidateReviewStatus, "issues-found");
  assert.equal(mission.continuation.nextActor, "agent");
  assert.equal(mission.continuation.nextAction.tool, "record_repository_implementation");
  assert.equal(mission.candidateCorrectionPacket.issues[0].candidateObservation.source, "agent");
  assert.equal(mission.steps.find((step) => step.id === "candidate").status, "attention");
  assert.equal(mission.steps.find((step) => step.id === "implement").status, "attention");
  assert.equal(mission.deploymentEvidence, "none");
  const markdown = repairExportMarkdown({ report: {}, repair });
  assert.match(markdown, /Candidate correction packet/);
  assert.match(markdown, /Retained baseline/);
});

test("human feedback gates bounded agent revisions and clears stale approvals", () => {
  const original = {
    ...createRepairDraft({
      auditId: "b8b16bf0-913c-40ea-a741-bb4bf76d326b",
      finding,
      source: "agent",
      input: {
        repositoryFiles: ["worker/index.js"],
        repositoryChecks: ["bun test"],
      },
      now: 100,
    }),
    status: "approved",
    reviewedAt: 120,
    deploymentAttestedAt: 130,
  };
  assert.throws(
    () => reviseRepairDraft(original, { patch: `${original.patch}\n# change` }),
    (error) => error.code === "REVISION_NOT_REQUESTED",
  );

  const requested = requestRepairChanges(
    original,
    "Add an explicit CSP reporting endpoint and a critical-journey check.",
    200,
  );
  assert.equal(requested.status, "changes-requested");
  assert.equal(requested.reviewedAt, null);
  assert.equal(requested.deploymentAttestedAt, null);
  assert.equal(requested.changeRequest.requestedAt, 200);
  assert.throws(
    () => requestRepairChanges(requested, "Another request", 201),
    (error) => error.code === "CHANGES_ALREADY_REQUESTED",
  );

  let revised = reviseRepairDraft(
    requested,
    {
      patch: `${requested.patch}; report-uri /csp-report`,
      verificationPlan: `${requested.verificationPlan} Confirm reports reach /csp-report.`,
      repositoryFiles: ["worker/index.js", "tests/sites-worker.test.mjs"],
      repositoryChecks: ["bun test", "bun run build"],
    },
    "agent",
    300,
  );
  assert.equal(revised.status, "draft");
  assert.equal(revised.revision, 2);
  assert.equal(revised.changeRequest, null);
  assert.equal(revised.reviewedAt, null);
  assert.equal(revised.revisionHistory.length, 1);
  assert.equal(revised.revisionHistory[0].revision, 1);
  assert.deepEqual(revised.repositoryPlan.files, ["worker/index.js", "tests/sites-worker.test.mjs"]);
  assert.deepEqual(revised.revisionHistory[0].repositoryPlan.files, ["worker/index.js"]);
  assert.match(revised.revisionHistory[0].changeRequest.feedback, /reporting endpoint/);

  for (let index = 0; index < 6; index += 1) {
    const nextRequest = requestRepairChanges(revised, `Bounded feedback ${index}`, 400 + index * 2);
    revised = reviseRepairDraft(
      nextRequest,
      { patch: `${nextRequest.patch}\n# revision-${index}` },
      "agent",
      401 + index * 2,
    );
  }
  assert.equal(revised.revision, 8);
  assert.equal(revised.revisionHistory.length, 5);
  assert.equal(revised.revisionHistory[0].revision, 3);
  assert.equal(revised.revisionHistory.at(-1).revision, 7);
});

test("verification requires approval and a human deployment attestation", () => {
  const report = {
    auditId: "b8b16bf0-913c-40ea-a741-bb4bf76d326b",
    url: "https://removemyexif.com/",
    engine: { mode: "live-document", provider: "Frontmend document audit", ruleSetVersion: 1 },
    ruleOutcomes: [{ source: finding.source, status: "failed" }],
  };
  const repair = {
    id: "3e8fe191-1f46-4f1b-92ac-492a5d73bb24",
    findingId: finding.id,
    findingTitle: finding.title,
    findingSource: finding.source,
  };
  assert.throws(
    () => createVerificationContext(report, { ...repair, status: "draft" }),
    (error) => error.code === "REPAIR_NOT_APPROVED",
  );
  assert.throws(
    () => createVerificationContext(report, { ...repair, status: "approved" }),
    (error) => error.code === "DEPLOYMENT_NOT_ATTESTED",
  );
});

test("verification claims resolution only for comparable evidence", () => {
  const verification = {
    baselineAuditId: "b8b16bf0-913c-40ea-a741-bb4bf76d326b",
    repairId: "3e8fe191-1f46-4f1b-92ac-492a5d73bb24",
    findingId: finding.id,
    findingTitle: finding.title,
    findingSource: finding.source,
    baselineEngine: {
      mode: "live-document",
      provider: "Frontmend document audit",
      ruleSetVersion: 1,
    },
    baseline: {
      auditId: "b8b16bf0-913c-40ea-a741-bb4bf76d326b",
      completedAt: 90,
      score: 90,
      findingCount: 1,
      checks: { passed: 0, warnings: 0, failed: 1 },
      exactRuleOutcome: "failed",
    },
  };
  const baseReport = {
    engine: {
      mode: "live-document",
      provider: "Frontmend document audit",
      ruleSetVersion: 1,
    },
    findings: [],
    ruleOutcomes: [{ source: finding.source, status: "passed" }],
  };
  assert.equal(compareVerification(baseReport, verification, 10).status, "resolved");
  assert.equal(
    compareVerification(
      { ...baseReport, findings: [], ruleOutcomes: [{ source: finding.source, status: "failed" }] },
      verification,
      10,
    ).status,
    "still-present",
  );
  assert.equal(
    compareVerification(
      {
        ...baseReport,
        engine: { mode: "live-lighthouse", provider: "PageSpeed Insights", ruleSetVersion: 1 },
      },
      verification,
      10,
    )
      .status,
    "inconclusive",
  );
});

test("verification withholds resolution and reports a browser guardrail regression", () => {
  const verification = {
    baselineAuditId: "b8b16bf0-913c-40ea-a741-bb4bf76d326b",
    repairId: "3e8fe191-1f46-4f1b-92ac-492a5d73bb24",
    repairRevision: 2,
    findingId: finding.id,
    findingTitle: finding.title,
    findingSource: finding.source,
    baselineEngine: {
      mode: "live-document",
      provider: "Frontmend document audit",
      ruleSetVersion: 1,
    },
    baseline: {
      auditId: "b8b16bf0-913c-40ea-a741-bb4bf76d326b",
      completedAt: 90,
      score: 90,
      findingCount: 1,
      checks: { passed: 0, warnings: 0, failed: 1 },
      exactRuleOutcome: "failed",
    },
    browserGuardrails: [{
      checkId: "primary-journey",
      label: "Primary journey",
      focusArea: "accessibility",
      viewport: "desktop",
      summary: "The primary journey completed before repair.",
    }],
  };
  const fresh = {
    auditId: "fresh-guardrail-audit",
    url: "https://example.com/",
    finalUrl: "https://example.com/",
    completedAt: 100,
    score: 100,
    checks: { passed: 1, warnings: 0, failed: 0 },
    findings: [],
    engine: {
      mode: "live-document",
      provider: "Frontmend document audit",
      ruleSetVersion: 1,
    },
    ruleOutcomes: [{ source: finding.source, status: "passed" }],
  };
  const waiting = compareVerification(fresh, verification, 110);
  assert.equal(waiting.status, "inconclusive");
  assert.equal(waiting.browserGuardrails[0].status, "not-opened");
  assert.throws(
    () => verificationReceiptMarkdown({ ...fresh, verification: waiting }),
    (error) => error.code === "VERIFICATION_RECEIPT_UNAVAILABLE",
  );

  let review = createBrowserVerificationReview({
    auditId: fresh.auditId,
    verification,
    target: fresh.finalUrl,
    now: 120,
  });
  review = recordBrowserReviewCheck(review, {
    checkId: "fresh-browser-guardrail-1",
    outcome: "issue",
    summary: "The primary journey no longer reaches completion.",
    observations: ["The retained primary action now stops before confirmation."],
  }, "agent", 130);
  const regression = compareVerification(fresh, verification, 140, review);
  assert.equal(regression.status, "regression");
  assert.equal(regression.ruleOutcome, "passed");
  assert.equal(regression.browserGuardrails[0].outcome, "issue");
  assert.match(verificationReceiptMarkdown({ ...fresh, verification: regression }), /Browser regression guardrails/i);
});

test("browser-observed repairs require an exact fresh replay before a verification receipt", () => {
  const browserFinding = {
    id: "browser:responsive-reflow:01",
    title: "Primary action clips at narrow widths",
    severity: "medium",
    category: "Accessibility",
    focusAreas: ["accessibility"],
    selector: "button.primary-action",
    evidence: "The right edge of the primary action is clipped at the mobile viewport.",
    repair: "Allow the action row to wrap within the viewport.",
    source: {
      provider: "Frontmend browser review",
      auditId: "responsive-reflow:01",
      strategy: "mobile",
    },
    browserReviewEvidence: {
      reviewId: "baseline-browser-review",
      checkId: "responsive-reflow",
      checkLabel: "Responsive reflow",
      provenance: "agent-reported-browser",
      reportedAt: 90,
    },
  };
  const baseline = {
    auditId: "b8b16bf0-913c-40ea-a741-bb4bf76d326b",
    url: "https://example.com/",
    finalUrl: "https://example.com/",
    completedAt: 100,
    score: 90,
    scoreBasis: "measured-lighthouse-viewports",
    findingCount: 1,
    checks: { passed: 9, warnings: 0, failed: 1 },
    viewports: [{ id: "mobile" }],
    engine: {
      mode: "live-lighthouse",
      provider: "PageSpeed Insights",
      ruleSetVersion: 1,
      lighthouseVersion: "13.4.1",
    },
    findings: [],
    ruleOutcomes: [],
  };
  const repair = {
    ...createRepairDraft({ auditId: baseline.auditId, finding: browserFinding, report: baseline, now: 105 }),
    status: "approved",
    reviewedAt: 110,
    deploymentAttestedAt: 115,
  };
  assert.equal(repair.findingEvidence.browserReviewEvidence.checkId, "responsive-reflow");

  const context = createVerificationContext(baseline, repair);
  assert.equal(context.browserReplay.required, true);
  assert.equal(context.browserReplay.status, "not-opened");
  assert.equal(context.baseline.exactRuleOutcome, "failed");

  const fresh = {
    ...baseline,
    auditId: "c45d54ea-6884-4c86-b82d-b9048cff697f",
    completedAt: 120,
    score: 94,
    findingCount: 0,
    checks: { passed: 10, warnings: 0, failed: 0 },
  };
  const waiting = compareVerification(fresh, context, 125);
  assert.equal(waiting.status, "inconclusive");
  assert.equal(waiting.comparisonReason, "browser-replay-required");
  assert.equal(waiting.browserReplay.status, "not-opened");
  assert.throws(
    () => verificationReceiptMarkdown({ ...fresh, verification: waiting }),
    (error) => error.code === "VERIFICATION_RECEIPT_UNAVAILABLE",
  );

  let review = createBrowserVerificationReview({
    auditId: fresh.auditId,
    verification: context,
    target: fresh.finalUrl,
    now: 130,
  });
  review = recordBrowserReviewCheck(review, {
    checkId: "fresh-browser-replay",
    outcome: "passed",
    summary: "The primary action now wraps within the mobile viewport.",
    observations: ["The entire primary action is visible without horizontal clipping."],
  }, "agent", 140);
  const resolved = compareVerification(fresh, context, 145, review);
  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.ruleOutcome, "passed");
  assert.equal(resolved.browserReplay.provenance, "agent-reported-browser");
  assert.match(
    verificationReceiptMarkdown({ ...fresh, verification: resolved }),
    /Fresh browser replay[\s\S]*entire primary action/i,
  );

  let blockedReview = createBrowserVerificationReview({
    auditId: fresh.auditId,
    verification: context,
    target: fresh.finalUrl,
    now: 150,
  });
  blockedReview = recordBrowserReviewCheck(blockedReview, {
    checkId: "fresh-browser-replay",
    outcome: "blocked",
    summary: "The retained target now requires authentication.",
    blockerReason: "authentication-required",
  }, "agent", 160);
  const blocked = compareVerification(fresh, context, 165, blockedReview);
  assert.equal(blocked.status, "inconclusive");
  assert.equal(blocked.comparisonReason, "browser-replay-blocked");
  assert.equal(blocked.browserReplay.blockerReason, "authentication-required");

  let failedReview = createBrowserVerificationReview({
    auditId: fresh.auditId,
    verification: context,
    target: fresh.finalUrl,
    now: 170,
  });
  failedReview = recordBrowserReviewCheck(failedReview, {
    checkId: "fresh-browser-replay",
    outcome: "issue",
    summary: "The same primary action remains clipped.",
    observations: ["The right edge remains outside the mobile viewport."],
  }, "agent", 180);
  const stillPresent = compareVerification(fresh, context, 185, failedReview);
  assert.equal(stillPresent.status, "still-present");
  assert.equal(stillPresent.ruleOutcome, "failed");
});

test("a multi-finding browser package withholds resolution until every exact replay completes", () => {
  const makeReplay = (findingId, title, auditId, strategy, evidence) => ({
    required: true,
    status: "not-opened",
    baseline: {
      findingId,
      title,
      category: "Accessibility",
      focusArea: "accessibility",
      selector: strategy === "mobile" ? "button.primary" : "main output",
      evidence,
      repair: "Repair the retained rendered symptom.",
      source: { provider: "Frontmend browser review", auditId, strategy },
      browserReviewEvidence: {
        reviewId: "baseline-review",
        checkId: auditId.split(":")[0],
        checkLabel: title,
        provenance: "agent-reported-browser",
        reportedAt: 90,
      },
    },
  });
  const replays = [
    makeReplay("browser:reflow:01", "Primary action reflow", "responsive-reflow:01", "mobile", "The primary action clipped."),
    makeReplay("browser:feedback:01", "Completion feedback", "primary-journey:01", "desktop", "Completion feedback was absent."),
  ];
  const fresh = {
    auditId: "fresh-browser-package",
    url: "https://example.com/",
    finalUrl: "https://example.com/",
    completedAt: 120,
    score: 100,
    findingCount: 0,
    checks: { passed: 10, warnings: 0, failed: 0 },
    engine: { mode: "live-lighthouse", provider: "PageSpeed Insights", ruleSetVersion: 1, lighthouseVersion: "13.4.1" },
    findings: [],
    ruleOutcomes: [],
  };
  const verification = {
    baselineAuditId: "browser-package-baseline",
    repairId: "repair-browser-package",
    repairRevision: 1,
    findingId: replays[0].baseline.findingId,
    findingIds: replays.map((replay) => replay.baseline.findingId),
    findingTitle: replays[0].baseline.title,
    findingSource: replays[0].baseline.source,
    findingScope: { sources: [replays[0].baseline.source] },
    baselineEngine: fresh.engine,
    baselineEvidence: null,
    baseline: {
      auditId: "browser-package-baseline",
      completedAt: 100,
      score: 90,
      findingCount: 2,
      checks: { passed: 8, warnings: 0, failed: 2 },
      exactRuleOutcome: "failed",
    },
    browserReplay: replays[0],
    browserReplays: replays,
  };
  let review = createBrowserVerificationReview({ auditId: fresh.auditId, verification, target: fresh.url, now: 130 });
  review = recordBrowserReviewCheck(review, {
    checkId: "fresh-browser-replay",
    outcome: "passed",
    summary: "The primary action now reflows inside the viewport.",
    observations: ["The retained action is fully visible."],
  }, "agent", 140);
  const partial = compareVerification(fresh, verification, 145, review);
  assert.equal(partial.status, "inconclusive");
  assert.equal(partial.browserReplays[1].status, "in-progress");
  assert.throws(
    () => verificationReceiptMarkdown({ ...fresh, verification: partial }),
    (error) => error.code === "VERIFICATION_RECEIPT_UNAVAILABLE",
  );
  review = recordBrowserReviewCheck(review, {
    checkId: "fresh-browser-replay-2",
    outcome: "passed",
    summary: "Completion feedback is now visible.",
    observations: ["The retained completion state includes visible feedback."],
  }, "agent", 150);
  const resolved = compareVerification(fresh, verification, 155, review);
  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.browserReplays.length, 2);
  assert.match(verificationReceiptMarkdown({ ...fresh, verification: resolved }), /Fresh browser replays[\s\S]*Completion feedback/i);
});

test("verification requires every captured strategy for the rule to pass", () => {
  const mobile = { provider: "Lighthouse", auditId: "color-contrast", strategy: "mobile" };
  const desktop = { provider: "Lighthouse", auditId: "color-contrast", strategy: "desktop" };
  const baseline = {
    auditId: "b8b16bf0-913c-40ea-a741-bb4bf76d326b",
    url: "https://example.com/",
    finalUrl: "https://example.com/",
    completedAt: 100,
    score: 80,
    scoreBasis: "measured-lighthouse-viewports",
    findingCount: 2,
    checks: { passed: 10, warnings: 0, failed: 2 },
    viewports: [{ id: "mobile" }, { id: "desktop" }],
    engine: {
      mode: "live-lighthouse",
      provider: "PageSpeed Insights",
      ruleSetVersion: 1,
      lighthouseVersion: "13.4.1",
    },
    findings: [
      {
        id: "mobile-color-contrast",
        title: "Text contrast is too low",
        repair: "Adjust the shared colour token.",
        source: mobile,
      },
      {
        id: "desktop-color-contrast",
        title: "Text contrast is too low",
        repair: "Adjust the shared colour token.",
        source: desktop,
      },
    ],
    ruleOutcomes: [
      { source: mobile, status: "failed" },
      { source: desktop, status: "failed" },
    ],
  };
  const repair = {
    ...createRepairDraft({
      auditId: baseline.auditId,
      finding: baseline.findings[0],
      report: baseline,
    }),
    status: "approved",
    reviewedAt: 105,
    deploymentAttestedAt: 110,
  };
  assert.deepEqual(
    repair.findingScope.sources.map((source) => source.strategy),
    ["mobile", "desktop"],
  );
  const context = createVerificationContext(baseline, repair);
  const fresh = {
    ...baseline,
    auditId: "c45d54ea-6884-4c86-b82d-b9048cff697f",
    completedAt: 120,
    score: 90,
    findingCount: 1,
    checks: { passed: 11, warnings: 0, failed: 1 },
    ruleOutcomes: [
      { source: mobile, status: "passed" },
      { source: desktop, status: "failed" },
    ],
  };
  const partialRepair = compareVerification(fresh, context, 130);
  assert.equal(partialRepair.status, "still-present");
  assert.equal(partialRepair.ruleOutcome, "failed");
  assert.deepEqual(
    partialRepair.scopeOutcomes.map((outcome) => [outcome.source.strategy, outcome.outcome]),
    [["mobile", "passed"], ["desktop", "failed"]],
  );
  assert.match(partialRepair.message, /at least one captured rule occurrence failed/i);

  const resolved = compareVerification({
    ...fresh,
    findingCount: 0,
    checks: { passed: 12, warnings: 0, failed: 0 },
    ruleOutcomes: [
      { source: mobile, status: "passed" },
      { source: desktop, status: "passed" },
    ],
  }, context, 140);
  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.ruleOutcome, "passed");
  assert.match(resolved.message, /every captured rule occurrence explicitly passed/i);
  const resolvedReceipt = verificationReceiptMarkdown({
    ...fresh,
    finalUrl: baseline.finalUrl,
    verification: resolved,
  });
  assert.match(resolvedReceipt, /Captured rule occurrences: 2/);
  assert.match(resolvedReceipt, /Rule-scope outcomes/);
  assert.match(resolvedReceipt, /\| Lighthouse \| color-contrast \| mobile \| Yes \| passed \|/);
  assert.match(resolvedReceipt, /\| Lighthouse \| color-contrast \| desktop \| Yes \| passed \|/);
  assert.match(resolvedReceipt, /passing strategy cannot hide a sibling failure/i);

  const repairArtifact = repairExportMarkdown({ report: baseline, repair });
  assert.match(repairArtifact, /Captured rule occurrences: 2/);
  assert.match(repairArtifact, /Captured repair scope/);
  assert.match(repairArtifact, /\| Lighthouse \| color-contrast \| mobile \|/);
  assert.match(repairArtifact, /\| Lighthouse \| color-contrast \| desktop \|/);
  assert.match(repairArtifact, /Every listed occurrence must explicitly pass/i);

  const incomplete = compareVerification({
    ...fresh,
    ruleOutcomes: [{ source: mobile, status: "passed" }],
  }, context, 150);
  assert.equal(incomplete.status, "inconclusive");
  assert.equal(incomplete.ruleOutcome, "not-comparable");
  assert.equal(incomplete.scopeOutcomes[1].comparisonReason, "exact-lighthouse-rule-not-evaluated");
});

test("partial verification separates exact-rule proof from whole-report metric comparability", () => {
  const lighthouseSource = {
    provider: "Lighthouse",
    auditId: "color-contrast",
    strategy: "mobile",
  };
  const baseline = {
    auditId: "b8b16bf0-913c-40ea-a741-bb4bf76d326b",
    url: "https://example.com/",
    finalUrl: "https://example.com/",
    completedAt: 100,
    score: 80,
    scoreBasis: "measured-lighthouse-viewports",
    findingCount: 1,
    checks: { passed: 7, warnings: 0, failed: 1 },
    viewports: [
      { id: "mobile" },
      { id: "document" },
    ],
    documentSupplement: { evaluatedRuleCount: 8, overlappingRulesOmitted: 1 },
    engine: {
      mode: "hybrid-lighthouse-document",
      provider: "PageSpeed Insights + Frontmend document audit",
      ruleSetVersion: 1,
      lighthouseVersion: "13.4.1",
    },
    ruleOutcomes: [{ source: lighthouseSource, status: "failed" }],
  };
  const repair = {
    id: "3e8fe191-1f46-4f1b-92ac-492a5d73bb24",
    findingId: "mobile-color-contrast",
    findingTitle: "Text contrast is too low",
    findingSource: lighthouseSource,
    status: "approved",
    deploymentAttestedAt: 110,
  };
  const context = createVerificationContext(baseline, repair);
  const sameEvidence = {
    ...baseline,
    auditId: "c45d54ea-6884-4c86-b82d-b9048cff697f",
    score: 90,
    findingCount: 0,
    checks: { passed: 8, warnings: 0, failed: 0 },
    ruleOutcomes: [{ source: lighthouseSource, status: "passed" }],
  };
  const resolved = compareVerification(sameEvidence, context, 120);
  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.metricComparable, true);
  assert.equal(resolved.proof.deltas.score, 10);

  const differentStrategy = compareVerification({
    ...sameEvidence,
    viewports: [{ id: "desktop" }, { id: "document" }],
    ruleOutcomes: [{
      source: { ...lighthouseSource, strategy: "desktop" },
      status: "passed",
    }],
  }, context, 121);
  assert.equal(differentStrategy.status, "inconclusive");
  assert.equal(differentStrategy.comparable, false);
  assert.equal(differentStrategy.metricComparable, false);
  assert.equal(differentStrategy.comparisonReason, "exact-lighthouse-rule-not-evaluated");

  const differentVersion = compareVerification({
    ...sameEvidence,
    engine: { ...sameEvidence.engine, lighthouseVersion: "13.5.0" },
  }, context, 122);
  assert.equal(differentVersion.status, "inconclusive");
  assert.equal(differentVersion.comparisonReason, "lighthouse-version-changed");

  const documentSource = {
    provider: "Frontmend document audit",
    auditId: "content-security-policy",
    strategy: "document",
  };
  const documentContext = createVerificationContext(
    { ...baseline, ruleOutcomes: [{ source: documentSource, status: "failed" }] },
    { ...repair, findingId: "document-content-security-policy", findingSource: documentSource },
  );
  const documentResolved = compareVerification({
    ...sameEvidence,
    viewports: [{ id: "desktop" }, { id: "document" }],
    ruleOutcomes: [{ source: documentSource, status: "passed" }],
  }, documentContext, 123);
  assert.equal(documentResolved.status, "resolved");
  assert.equal(documentResolved.comparable, true);
  assert.equal(documentResolved.metricComparable, false);
  assert.equal(documentResolved.lineage.entries[1].metricComparableToBaseline, false);
  assert.deepEqual(
    documentResolved.lineage.entries[1].evidenceSignature.measuredStrategies,
    ["desktop", "document"],
  );
  assert.equal(documentResolved.proof.deltas.score, null);
  assert.match(documentResolved.message, /metrics are not like for like/);
});

test("verification stays inconclusive when the exact rule has no affirmative outcome", () => {
  const verification = {
    baselineAuditId: "b8b16bf0-913c-40ea-a741-bb4bf76d326b",
    repairId: "3e8fe191-1f46-4f1b-92ac-492a5d73bb24",
    findingId: finding.id,
    findingTitle: finding.title,
    findingSource: finding.source,
    baselineEngine: {
      mode: "live-document",
      provider: "Frontmend document audit",
      ruleSetVersion: 1,
    },
  };
  const baseReport = {
    engine: verification.baselineEngine,
    findings: [],
  };

  const missing = compareVerification(baseReport, verification, 10);
  assert.equal(missing.status, "inconclusive");
  assert.equal(missing.ruleOutcome, "missing");
  assert.match(missing.message, /cannot claim it was resolved/i);

  const notApplicable = compareVerification(
    { ...baseReport, ruleOutcomes: [{ source: finding.source, status: "not-applicable" }] },
    verification,
    10,
  );
  assert.equal(notApplicable.status, "inconclusive");
  assert.equal(notApplicable.ruleOutcome, "not-applicable");
});

test("verification carries a bounded before and after proof receipt", () => {
  const baseline = {
    auditId: "b8b16bf0-913c-40ea-a741-bb4bf76d326b",
    url: "https://removemyexif.com/",
    finalUrl: "https://removemyexif.com/",
    completedAt: 1_787_766_000_000,
    score: 89,
    findingCount: 1,
    checks: { passed: 8, warnings: 1, failed: 0 },
    engine: {
      mode: "live-document",
      provider: "Frontmend document audit",
      ruleSetVersion: 1,
    },
    ruleOutcomes: [{ source: finding.source, status: "failed" }],
  };
  const repair = {
    id: "3e8fe191-1f46-4f1b-92ac-492a5d73bb24",
    findingId: finding.id,
    findingTitle: finding.title,
    findingSource: finding.source,
    status: "approved",
    repositoryPlan: {
      files: ["src/worker.js", "tests/worker.test.mjs"],
      checks: ["bun test", "bun run build"],
      source: "agent",
      sourceChangedByFrontmend: false,
    },
    implementationReceipt: {
      revision: 2,
      summary: "Updated the response header and its contract coverage.",
      files: ["src/worker.js", "tests/worker.test.mjs"],
      checks: [{ name: "bun test", status: "passed" }],
      commitSha: "691defd",
      source: "agent",
      reportedAt: 1_787_766_040_000,
      agentReported: true,
      sourceChangedByFrontmend: false,
    },
    deploymentAttestedAt: 1_787_766_050_000,
  };
  const context = createVerificationContext(baseline, repair);
  assert.equal(context.deploymentAttestedAt, repair.deploymentAttestedAt);
  assert.equal(context.repairRevision, 1);
  assert.equal(context.implementationReceipt.revision, 2);
  assert.equal(context.implementationReceipt.commitSha, "691defd");
  assert.deepEqual(context.repositoryPlan.files, ["src/worker.js", "tests/worker.test.mjs"]);
  assert.notEqual(context.repositoryPlan, repair.repositoryPlan);
  assert.notEqual(context.implementationReceipt, repair.implementationReceipt);
  assert.notEqual(context.implementationReceipt.checks, repair.implementationReceipt.checks);
  assert.deepEqual(context.baseline, {
    auditId: baseline.auditId,
    completedAt: baseline.completedAt,
    score: 89,
    findingCount: 1,
    checks: { passed: 8, warnings: 1, failed: 0 },
    exactRuleOutcome: "failed",
    scopeRuleOutcomes: [{ source: finding.source, status: "failed" }],
  });
  assert.equal(context.lineage.rootAuditId, baseline.auditId);
  assert.equal(context.lineage.attemptCount, 0);
  assert.equal(context.lineage.entries[0].metricComparableToBaseline, true);
  assert.equal(context.lineage.entries[0].evidenceSignature.mode, "live-document");
  assert.deepEqual(
    context.lineage.entries.map((entry) => [entry.attempt, entry.status, entry.auditId]),
    [[0, "baseline", baseline.auditId]],
  );

  const fresh = {
    ...baseline,
    auditId: "4dc5342a-3473-4ec7-b003-980f2d0af68b",
    score: 100,
    findingCount: 0,
    checks: { passed: 9, warnings: 0, failed: 0 },
    ruleOutcomes: [{ source: finding.source, status: "passed" }],
  };
  const result = compareVerification(fresh, context, 1_787_766_100_000);
  assert.equal(result.status, "resolved");
  assert.deepEqual(result.repositoryPlan, context.repositoryPlan);
  assert.deepEqual(result.implementationReceipt, context.implementationReceipt);
  assert.equal(result.proof.current.exactRuleOutcome, "passed");
  assert.deepEqual(result.proof.deltas, { score: 11, checksPassed: 1, findings: -1 });
  assert.equal(result.lineage.attemptCount, 1);
  assert.equal(result.lineage.entries[1].metricComparableToBaseline, true);
  assert.deepEqual(result.lineage.entries[1].evidenceSignature, result.measuredEvidence);
  assert.deepEqual(
    result.lineage.entries.map((entry) => [entry.attempt, entry.status, entry.auditId]),
    [
      [0, "baseline", baseline.auditId],
      [1, "resolved", fresh.auditId],
    ],
  );

  const chainedReport = { ...fresh, verification: result };
  const chainedRepair = {
    ...repair,
    id: "a9fbda41-bde0-4823-89ce-d3d766988f92",
  };
  const chainedContext = createVerificationContext(chainedReport, chainedRepair);
  const next = compareVerification(
    {
      ...fresh,
      auditId: "c1de4f26-c222-4e44-a7e5-884ba6d9fe9a",
      ruleOutcomes: [{ source: finding.source, status: "failed" }],
    },
    chainedContext,
    1_787_766_200_000,
  );
  assert.equal(next.lineage.attemptCount, 2);
  assert.deepEqual(
    next.lineage.entries.map((entry) => [entry.attempt, entry.status]),
    [
      [0, "baseline"],
      [1, "resolved"],
      [2, "still-present"],
    ],
  );
});

test("verification lineage preserves the root and compacts older attempts", () => {
  const verification = {
    baselineAuditId: "b8b16bf0-913c-40ea-a741-bb4bf76d326b",
    repairId: "3e8fe191-1f46-4f1b-92ac-492a5d73bb24",
    findingId: finding.id,
    findingTitle: finding.title,
    findingSource: finding.source,
    baselineEngine: {
      mode: "live-document",
      provider: "Frontmend document audit",
      ruleSetVersion: 1,
    },
    baseline: {
      auditId: "root-audit",
      score: 80,
      findingCount: 3,
      checks: { passed: 6, warnings: 1, failed: 2 },
    },
    lineage: {
      rootAuditId: "root-audit",
      findingSource: finding.source,
      attemptCount: 7,
      omitted: 0,
      entries: Array.from({ length: 8 }, (_, attempt) => ({
        auditId: attempt === 0 ? "root-audit" : `audit-${attempt}`,
        attempt,
        status: attempt === 0 ? "baseline" : "still-present",
      })),
    },
  };
  const result = compareVerification(
    {
      auditId: "audit-8",
      score: 82,
      findingCount: 2,
      checks: { passed: 7, warnings: 1, failed: 1 },
      engine: verification.baselineEngine,
      ruleOutcomes: [{ source: finding.source, status: "failed" }],
    },
    verification,
    20,
  );
  assert.equal(result.lineage.attemptCount, 8);
  assert.equal(result.lineage.omitted, 1);
  assert.equal(result.lineage.entries.length, 8);
  assert.equal(result.lineage.entries[0].auditId, "root-audit");
  assert.equal(result.lineage.entries.at(-1).auditId, "audit-8");
});

test("exports a bounded honest verification receipt", () => {
  assert.throws(
    () => verificationReceiptMarkdown({ auditId: "ordinary-audit" }),
    (error) => error.code === "VERIFICATION_RECEIPT_UNAVAILABLE",
  );
  const report = {
    url: "https://removemyexif.com/",
    finalUrl: "https://removemyexif.com/",
    verification: {
      status: "still-present",
      repairRevision: 3,
      findingId: "document-content-security-policy",
      findingTitle: "Unsafe <script> | title",
      findingSource: finding.source,
      ruleOutcome: "failed",
      comparable: true,
      metricComparable: false,
      comparisonReason: "exact-document-rule",
      repositoryPlan: {
        files: ["src/worker.js", "tests/worker.test.mjs"],
        checks: ["bun test", "bun run build"],
        source: "agent",
        sourceChangedByFrontmend: false,
      },
      implementationReceipt: {
        revision: 2,
        summary: "Updated the Worker response header.",
        files: ["src/worker.js", "tests/worker.test.mjs"],
        checks: [
          { name: "bun test", status: "passed" },
          { name: "bun run build", status: "passed" },
        ],
        commitSha: "691defd",
        source: "agent",
        reportedAt: 1_787_766_090_000,
        agentReported: true,
        sourceChangedByFrontmend: false,
      },
      deploymentAttestedAt: 1_787_766_100_000,
      completedAt: 1_787_766_200_000,
      proof: {
        baseline: {
          auditId: "b8b16bf0-913c-40ea-a741-bb4bf76d326b",
          score: 89,
          findingCount: 1,
          checks: { passed: 8 },
        },
        current: {
          auditId: "c1de4f26-c222-4e44-a7e5-884ba6d9fe9a",
          score: 89,
          findingCount: 1,
          checks: { passed: 8 },
        },
        deltas: { score: null, checksPassed: null, findings: null },
      },
      lineage: {
        entries: [
          {
            auditId: "b8b16bf0-913c-40ea-a741-bb4bf76d326b",
            attempt: 0,
            status: "baseline",
            score: 89,
            checksPassed: 8,
            findingCount: 1,
            metricComparableToBaseline: true,
          },
          {
            auditId: "c1de4f26-c222-4e44-a7e5-884ba6d9fe9a",
            attempt: 1,
            status: "still-present",
            score: 89,
            checksPassed: 8,
            findingCount: 1,
            metricComparableToBaseline: false,
          },
        ],
      },
    },
  };
  const receipt = verificationReceiptMarkdown(report);
  assert.match(receipt, /# Frontmend verification receipt/);
  assert.match(receipt, /Frontmend does not claim it deployed or changed the target site/);
  assert.match(receipt, /Attempt 1/);
  assert.match(receipt, /Metric coverage/);
  assert.match(receipt, /Exact rule comparison: like for like/);
  assert.match(receipt, /Attempt 1.*Changed; deltas withheld/);
  assert.match(receipt, /Repository implementation provenance/);
  assert.match(receipt, /Reviewed repository plan/);
  assert.match(receipt, /Planned files: `src\/worker\.js`, `tests\/worker\.test\.mjs`/);
  assert.match(receipt, /Planned checks: bun test; bun run build/);
  assert.match(receipt, /agent-reported receipt revision 2/);
  assert.match(receipt, /Frontmend did not inspect the source, execute these checks, or deploy this Git object/);
  assert.match(receipt, /`src\/worker\.js`/);
  assert.match(receipt, /Git object: 691defd/);
  assert.match(receipt, /Repair revision: 3/);
  assert.match(receipt, /Deployment attested by site owner: 2026-/);
  assert.match(receipt, /Unsafe &lt;script&gt; \\| title/);
  assert.doesNotMatch(receipt, /Unsafe <script>/);
});

test("exports a bounded escaped audit report with an explicit evidence boundary", () => {
  assert.throws(
    () => auditReportMarkdown({ auditId: "ordinary-audit" }),
    (error) => error.code === "AUDIT_REPORT_UNAVAILABLE",
  );
  const unsafeFinding = {
    id: "unsafe-finding",
    title: "Unsafe <script> | title",
    severity: "high",
    category: "Accessibility | HTML",
    evidence: "A <script> marker | appeared in evidence.",
    repair: "Replace <script> | after human review.",
    source: {
      provider: "Provider <name>",
      auditId: "unsafe-rule",
      strategy: "document",
    },
  };
  const report = {
    auditId: "b8b16bf0-913c-40ea-a741-bb4bf76d326b",
    url: "https://removemyexif.com/",
    finalUrl: "https://removemyexif.com/",
    completedAt: 1_787_766_200_000,
    score: 89,
    checks: { passed: 8, warnings: 1, failed: 0 },
    findingCount: 25,
    findingsOmitted: 4,
    viewportCount: 0,
    viewports: [{ id: "document", label: "Document", detail: "Live HTML" }],
    documentProfile: {
      type: "live-document-profile",
      htmlBytes: 24_576,
      elements: { scripts: 3, stylesheets: 1, images: 4, links: 7 },
      inline: { scripts: 2, styles: 1 },
      externalOrigins: ["https://assets.example.net/<script>|"],
      externalOriginsOmitted: 2,
      routes: ["/privacy", "/unsafe-<script>|"],
      routesOmitted: 3,
      routesCaveat: "Observed links only <script> | not audited.",
      headers: {
        contentType: "text/html | unsafe",
        contentSecurityPolicy: false,
        nosniff: true,
      },
      caveat: "Fetched HTML only <script> | boundary.",
    },
    findings: Array.from({ length: 21 }, (_, index) => ({
      ...unsafeFinding,
      id: `unsafe-finding-${index}`,
      title: `${unsafeFinding.title} ${index}`,
    })),
    ruleOutcomes: Array.from({ length: 65 }, () => ({
      source: unsafeFinding.source,
      status: "failed",
    })),
    engine: {
      mode: "live-document",
      provider: "Frontmend document audit",
      ruleSetVersion: 1,
      notice: "Live HTML and response-header evidence.",
    },
  };

  const artifact = auditReportMarkdown(report);
  assert.match(artifact, /# Frontmend audit report/);
  assert.match(artifact, /Evidence artifact only/);
  assert.match(artifact, /Frontmend does not claim it deployed, changed/);
  assert.match(artifact, /Unsafe &lt;script&gt; \\| title 0/);
  assert.doesNotMatch(artifact, /Unsafe <script>/);
  assert.match(artifact, /5 additional findings were omitted/);
  assert.match(artifact, /1 additional rule outcome was omitted/);
  assert.match(artifact, /## Live document profile/);
  assert.match(artifact, /24,?576 bytes|24576 bytes/);
  assert.match(artifact, /assets\.example\.net\/&lt;script&gt;\\\|/);
  assert.match(artifact, /### Same-site routes observed in markup/);
  assert.match(artifact, /\/unsafe-&lt;script&gt; \\|/);
  assert.match(artifact, /3 additional routes were omitted/);
  assert.match(artifact, /Observed links only &lt;script&gt; \\\| not audited/);
  assert.match(artifact, /Fetched HTML only &lt;script&gt; \\| boundary/);
  assert.match(artifact, /did not execute page scripts, exercise user journeys, capture screenshots/);
  assert.equal((artifact.match(/^### \d+\./gm) ?? []).length, 20);
});

test("exports hybrid evidence without implying document rules replace a viewport", () => {
  const artifact = auditReportMarkdown({
    auditId: "b8b16bf0-913c-40ea-a741-bb4bf76d326b",
    url: "https://removemyexif.com/",
    finalUrl: "https://removemyexif.com/",
    completedAt: 1_787_766_200_000,
    score: 82,
    scoreBasis: "measured-lighthouse-viewports",
    checks: { passed: 7, warnings: 1, failed: 3 },
    findingCount: 1,
    findingsOmitted: 0,
    findings: [],
    viewportCount: 1,
    viewports: [{ id: "mobile", label: "Mobile", detail: "Lighthouse" }],
    viewportFailures: [{
      id: "desktop",
      label: "Desktop",
      code: "PROVIDER_RATE_LIMITED",
      message: "Desktop Lighthouse was unavailable.",
    }],
    documentSupplement: {
      evaluatedRuleCount: 8,
      overlappingRulesOmitted: 1,
      caveat: "Document evidence does not replace the unavailable viewport.",
    },
    ruleOutcomes: [],
    engine: {
      mode: "hybrid-lighthouse-document",
      provider: "PageSpeed Insights + Frontmend document audit",
      ruleSetVersion: 1,
      lighthouseVersion: "13.4.1",
      notice: "Non-duplicative document evidence supplemented the report.",
    },
  });

  assert.match(artifact, /Hybrid document supplement/);
  assert.match(artifact, /Non-overlapping document rules added: 8/);
  assert.match(artifact, /Overlapping document rules omitted from totals: 1/);
  assert.match(artifact, /does not replace the unavailable viewport/);
});

test("exports only human-approved repair proposals with an honesty notice", () => {
  const repair = {
    ...createRepairDraft({
      auditId: "b8b16bf0-913c-40ea-a741-bb4bf76d326b",
      finding,
      source: "agent",
      input: {
        repositoryFiles: ["worker/index.js"],
        repositoryChecks: ["bun test", "bun run build"],
      },
      now: 1_787_766_000_000,
    }),
    status: "approved",
    reviewedAt: 1_787_766_001_000,
  };
  const implemented = recordRepositoryImplementation(repair, {
    summary: "Applied the reviewed response-header configuration.",
    files: ["worker/index.js"],
    checks: [{ name: "bun test", status: "passed" }],
    commitSha: "94a2827",
  }, 1_787_766_002_000);
  const rerun = recordRepositoryImplementation(implemented, {
    summary: "Re-ran the approved implementation checks.",
    files: ["worker/index.js"],
    checks: [{ name: "bun test", status: "passed" }],
    commitSha: "94a2827",
  }, 1_787_766_003_000);
  const markdown = repairExportMarkdown({
    report: {
      auditId: repair.auditId,
      url: "https://removemyexif.com/",
      finalUrl: "https://removemyexif.com/",
    },
    repair: rerun,
  });
  assert.match(markdown, /Approval: explicit human review/);
  assert.match(markdown, /Approval recorded:/);
  assert.match(markdown, /Deployment handoff: not yet attested/);
  assert.match(markdown, /does not claim the target site was changed/i);
  assert.match(markdown, /Repository implementation receipt/);
  assert.match(markdown, /## Repository plan/);
  assert.match(markdown, /`worker\/index\.js`/);
  assert.match(markdown, /Planned checks: bun test; bun run build/);
  assert.match(markdown, /did not inspect these files, receive their contents, or run these checks/i);
  assert.match(markdown, /Receipt revision: 2/);
  assert.match(markdown, /Previous receipts retained: 1/);
  assert.match(markdown, /`worker\/index\.js`/);
  assert.match(markdown, /Frontmend did not inspect or change source/);
  assert.throws(
    () => repairExportMarkdown({ report: { auditId: repair.auditId }, repair: { ...repair, status: "draft" } }),
    (error) => error.code === "REPAIR_NOT_APPROVED",
  );
});
