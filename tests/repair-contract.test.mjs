import assert from "node:assert/strict";
import test from "node:test";
import {
  auditReportMarkdown,
  compareVerification,
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
    findings: [{
      ...finding,
      category: "Security",
      selector: "Document",
      evidence: "The Content-Security-Policy response header was absent.",
    }],
  }, finding.id);

  assert.equal(brief.schemaVersion, 1);
  assert.equal(brief.findingId, finding.id);
  assert.equal(brief.target.publicPath, "/");
  assert.equal(brief.evidence.ruleId, "content-security-policy");
  assert.equal(brief.repositoryHandoff.patchType, "headers");
  assert.equal(brief.repositoryHandoff.risk, "high");
  assert.match(brief.repositoryHandoff.inspectFor[0], /response-header/i);
  assert.match(brief.repositoryHandoff.suggestedChange, /Report-Only/);
  assert.equal(brief.repositoryHandoff.acceptanceCriteria.length, 3);
  assert.equal(brief.authority.frontmendChangedTarget, false);
  assert.equal(brief.authority.sourceAccess, "coding-agent-only");
  assert.match(brief.authority.privacy, /absolute paths/);
});

test("creates a bounded source-attributed repair that requires human review", () => {
  const repair = createRepairDraft({
    auditId: "b8b16bf0-913c-40ea-a741-bb4bf76d326b",
    finding,
    source: "agent",
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
  assert.equal(draft.steps.find((step) => step.id === "review").owner, "Person");

  const approved = repairMissionState({ id: "repair-1", status: "approved" });
  assert.equal(approved.state, "awaiting-external-deployment");
  assert.equal(approved.targetMutation, "external-only");
  assert.equal(approved.deploymentEvidence, "none");
  assert.equal(approved.steps.find((step) => step.id === "deploy").status, "current");
  assert.equal(approved.steps.find((step) => step.id === "verify").status, "blocked");
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
  assert.deepEqual(
    attested.nextActions.map((action) => action.actor),
    ["person", "person-or-agent"],
  );

  const changesRequested = repairMissionState({ id: "repair-1", status: "changes-requested" });
  assert.equal(changesRequested.state, "changes-requested");
  assert.equal(changesRequested.steps.find((step) => step.id === "draft").status, "current");
  assert.equal(changesRequested.steps.find((step) => step.id === "review").status, "blocked");
  assert.deepEqual(changesRequested.nextActions, [{ id: "revise_repair", actor: "agent" }]);
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
  assert.equal(repairMissionState(implemented).steps.find((step) => step.id === "implement").status, "complete");
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

test("human feedback gates bounded agent revisions and clears stale approvals", () => {
  const original = {
    ...createRepairDraft({
      auditId: "b8b16bf0-913c-40ea-a741-bb4bf76d326b",
      finding,
      source: "agent",
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
    deploymentAttestedAt: 1_787_766_050_000,
  };
  const context = createVerificationContext(baseline, repair);
  assert.equal(context.deploymentAttestedAt, repair.deploymentAttestedAt);
  assert.equal(context.repairRevision, 1);
  assert.deepEqual(context.baseline, {
    auditId: baseline.auditId,
    completedAt: baseline.completedAt,
    score: 89,
    findingCount: 1,
    checks: { passed: 8, warnings: 1, failed: 0 },
    exactRuleOutcome: "failed",
  });
  assert.equal(context.lineage.rootAuditId, baseline.auditId);
  assert.equal(context.lineage.attemptCount, 0);
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
  assert.equal(result.proof.current.exactRuleOutcome, "passed");
  assert.deepEqual(result.proof.deltas, { score: 11, checksPassed: 1, findings: -1 });
  assert.equal(result.lineage.attemptCount, 1);
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
        deltas: { score: 0, checksPassed: 0, findings: 0 },
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
          },
          {
            auditId: "c1de4f26-c222-4e44-a7e5-884ba6d9fe9a",
            attempt: 1,
            status: "still-present",
            score: 89,
            checksPassed: 8,
            findingCount: 1,
          },
        ],
      },
    },
  };
  const receipt = verificationReceiptMarkdown(report);
  assert.match(receipt, /# Frontmend verification receipt/);
  assert.match(receipt, /Frontmend does not claim it deployed or changed the target site/);
  assert.match(receipt, /Attempt 1/);
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
  assert.match(markdown, /Human reviewed:/);
  assert.match(markdown, /Deployment handoff: not yet attested/);
  assert.match(markdown, /does not claim the target site was changed/i);
  assert.match(markdown, /Repository implementation receipt/);
  assert.match(markdown, /Receipt revision: 2/);
  assert.match(markdown, /Previous receipts retained: 1/);
  assert.match(markdown, /`worker\/index\.js`/);
  assert.match(markdown, /Frontmend did not inspect or change source/);
  assert.throws(
    () => repairExportMarkdown({ report: { auditId: repair.auditId }, repair: { ...repair, status: "draft" } }),
    (error) => error.code === "REPAIR_NOT_APPROVED",
  );
});
