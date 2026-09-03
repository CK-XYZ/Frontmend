import assert from "node:assert/strict";
import test from "node:test";
import {
  auditMissionSnapshot,
  auditMissionSignature,
  createAuditMission,
  deriveAuditMissionState,
  explorationAssessmentFindings,
  focusedAuditPriorities,
  prepareRepairIntent,
} from "../src/audit-mission-contract.js";
import {
  createDiagnosticMission,
  recordDiagnosticBlocker,
  submitDiagnosticEvidence,
} from "../src/diagnostic-contract.js";
import {
  createBrowserReviewMission,
  extendBrowserReviewMission,
  recordBrowserReviewCheck,
  withdrawBrowserReview,
} from "../src/browser-review-contract.js";

const consoleFinding = (strategy, severity = "medium") => ({
  id: `${strategy}-errors-in-console`,
  title: "The page reports browser errors",
  severity,
  category: "Reliability",
  focusAreas: ["reliability", "performance"],
  evidence: `${strategy} emitted a first-party console error.`,
  repair: "Reproduce and repair the owned runtime failure.",
  source: { provider: "Lighthouse", auditId: "errors-in-console", strategy },
  diagnosticEvidence: {
    kind: "console-errors",
    completeness: "actionable",
    entries: [{ description: "ReferenceError" }],
  },
});

const report = {
  auditId: "audit-1",
  viewports: [
    { strategy: "mobile", scores: { accessibility: 97, performance: 91, reliability: 90 } },
    { strategy: "desktop", scores: { accessibility: 98, performance: 93, reliability: 92 } },
  ],
  findings: [
    consoleFinding("mobile"),
    consoleFinding("desktop"),
    {
      id: "mobile-color-contrast",
      title: "Controls have insufficient contrast",
      severity: "low",
      category: "Accessibility",
      focusAreas: ["accessibility"],
      evidence: "One control failed the automated contrast check.",
      repair: "Correct the foreground and background tokens.",
      source: { provider: "Lighthouse", auditId: "color-contrast", strategy: "mobile" },
    },
  ],
};

test("creates a bounded Assess mission without retaining prompt text", () => {
  assert.deepEqual(createAuditMission({}, "human", 10), {
    schemaVersion: 2,
    intent: "assess",
    focusAreas: [],
    maxPriorities: 3,
    scope: "page",
    routeLimit: 3,
    requestedBy: "human",
    requestedAt: 10,
    repairPreparation: null,
  });
  assert.throws(
    () => createAuditMission({ prompt: "Audit my private repository" }, "agent", 10),
    /Unknown mission field: prompt/,
  );
  assert.throws(() => createAuditMission({ focusAreas: ["seo", "seo"] }), /unique supported/);
  assert.deepEqual(
    createAuditMission({
      focusAreas: ["accessibility", "seo", "performance", "security", "reliability"],
    }, "human", 10).focusAreas,
    ["accessibility", "seo", "performance", "security", "reliability"],
  );
  assert.throws(() => createAuditMission({ maxPriorities: 6 }), /one to five/);
  assert.throws(() => createAuditMission({ scope: "crawl" }), /page or bounded-site/);
});

test("projects legacy v1 missions as page-scoped v2 missions", () => {
  const projected = auditMissionSnapshot({
    schemaVersion: 1,
    intent: "assess",
    focusAreas: ["seo"],
    maxPriorities: 2,
    requestedBy: "agent",
    requestedAt: 10,
    repairPreparation: null,
  });
  assert.equal(projected.schemaVersion, 2);
  assert.equal(projected.scope, "page");
  assert.equal(projected.routeLimit, 3);
});

test("holds bounded-site completion for server-issued routes and folds recurrence into priorities", () => {
  const scopedReport = {
    ...report,
    documentProfile: { routes: ["/privacy", "/terms", "/about", "/omitted"] },
  };
  const mission = createAuditMission({
    scope: "bounded-site",
    routeLimit: 2,
    focusAreas: ["accessibility"],
  }, "human", 10);
  const waiting = deriveAuditMissionState({ report: scopedReport, mission });
  assert.equal(waiting.assessmentComplete, false);
  assert.equal(waiting.nextAction.tool, "start_site_exploration");
  assert.equal(waiting.siteScope.routeCandidates.length, 2);
  assert.deepEqual(
    waiting.nextAction.input.routeCandidateIds,
    waiting.siteScope.routeCandidates.map((candidate) => candidate.id),
  );

  const exploration = {
    id: "232d593c-6c81-48c3-b137-a3df269454ff",
    rootAuditId: report.auditId,
    status: "complete",
    createdAt: 20,
    summary: { pagesRequested: 2, pagesComplete: 2, pagesFailed: 0 },
    issues: [{
      provider: "Lighthouse",
      ruleId: "color-contrast",
      title: "Controls have insufficient contrast",
      severity: "medium",
      category: "Accessibility",
      focusAreas: ["accessibility"],
      suggestedRepair: "Correct the foreground and background tokens.",
      occurrences: [{
        auditId: "route-audit-1",
        findingId: "route-color-contrast",
        path: "/privacy",
        strategy: "mobile",
        evidence: "The same control failed on the retained route.",
      }],
    }],
  };
  const complete = deriveAuditMissionState({ report: scopedReport, mission, explorations: [exploration] });
  assert.equal(complete.assessmentComplete, true);
  assert.equal(complete.siteScope.status, "complete");
  assert.equal(complete.priorities[0].occurrenceCount, 2);
});

test("converges route exploration into the root review and one repairable canonical finding", () => {
  const canonicalFindingId = "site-6d9c91c2";
  const scopedReport = {
    ...report,
    finalUrl: "https://example.com/",
    findings: [],
    documentProfile: { routes: ["/remove"] },
  };
  const mission = createAuditMission({
    scope: "bounded-site",
    routeLimit: 1,
    focusAreas: ["accessibility"],
  }, "agent", 10);
  let review = createBrowserReviewMission({
    auditId: report.auditId,
    mission,
    report: scopedReport,
    target: scopedReport.finalUrl,
    now: 20,
  });
  let now = 30;
  while (review.state.nextCheck) {
    review = recordBrowserReviewCheck(review, {
      checkId: review.state.nextCheck.id,
      outcome: "passed",
      summary: "The retained root-page browser check passed.",
      observations: ["The requested root-page state was inspected directly."],
    }, "agent", now++);
  }
  const exploration = {
    id: "232d593c-6c81-48c3-b137-a3df269454ff",
    rootAuditId: report.auditId,
    status: "complete",
    createdAt: 50,
    summary: { pagesRequested: 1, pagesComplete: 1, pagesFailed: 0 },
    issues: [{
      findingId: canonicalFindingId,
      provider: "Lighthouse",
      ruleId: "label",
      title: "The upload control has no accessible label",
      severity: "high",
      category: "Accessibility",
      focusAreas: ["accessibility"],
      status: "detected",
      occurrenceCount: 1,
      distinctPageCount: 1,
      suggestedRepair: "Give the upload input an explicit accessible name.",
      occurrences: [{
        occurrenceId: "occurrence-7e0f4cb1",
        findingId: canonicalFindingId,
        sourceFindingId: "mobile-label",
        auditId: "route-audit-1",
        path: "/remove",
        url: "https://example.com/remove",
        viewport: "mobile",
        strategy: "mobile",
        selector: "input[type=file]",
        evidence: "The file input has no associated label.",
        evidenceIds: ["/api/audits/route-audit-1/evidence/mobile"],
        source: { provider: "Lighthouse", auditId: "label", strategy: "mobile" },
      }],
    }],
  };

  const awaitingRouteReview = deriveAuditMissionState({
    report: scopedReport,
    mission,
    browserReview: review,
    explorations: [exploration],
  });
  assert.equal(awaitingRouteReview.assessmentComplete, false);
  assert.equal(awaitingRouteReview.rankingStatus, "provisional");
  assert.equal(awaitingRouteReview.browserReview.extensionRequired, true);
  assert.equal(awaitingRouteReview.nextAction.tool, "open_browser_review");

  review = extendBrowserReviewMission({
    review,
    report: {
      ...scopedReport,
      findings: explorationAssessmentFindings([exploration]),
    },
    mission,
    target: scopedReport.finalUrl,
    now: 60,
  });
  const routeTask = review.state.nextCheck;
  assert.equal(routeTask.kind, "provider-confirmation");
  assert.equal(routeTask.target.path, "/remove");
  assert.equal(routeTask.trigger.findingId, canonicalFindingId);
  assert.equal(routeTask.trigger.occurrences[0].occurrenceId, "occurrence-7e0f4cb1");
  assert.equal(routeTask.trigger.occurrences[0].sourceFindingId, "mobile-label");
  assert.deepEqual(routeTask.trigger.occurrences[0].evidenceIds, [
    "/api/audits/route-audit-1/evidence/mobile",
  ]);

  review = recordBrowserReviewCheck(review, {
    checkId: routeTask.id,
    outcome: "issue",
    summary: "The route-level upload control still has no accessible name.",
    observations: ["At the retained mobile viewport the file input exposes no accessible name."],
    findings: [{
      title: "The upload control has no accessible label",
      severity: "high",
      focusArea: "accessibility",
      evidence: "The retained file input exposes no accessible name at the mobile viewport.",
      suggestedRepair: "Associate a visible label with the file input.",
      element: "input[type=file]",
    }],
  }, "agent", 70);

  const finalAssessment = deriveAuditMissionState({
    report: scopedReport,
    mission,
    browserReview: review,
    explorations: [exploration],
  });
  assert.equal(finalAssessment.assessmentComplete, true);
  assert.equal(finalAssessment.rankingStatus, "final");
  assert.equal(finalAssessment.priorities[0].findingId, canonicalFindingId);
  assert.equal(finalAssessment.priorities[0].relationship, "browser-confirmed");
  assert.equal(finalAssessment.priorities[0].distinctPageCount, 1);

  const repairMission = prepareRepairIntent(mission, canonicalFindingId, "agent", 80);
  const awaitingTrace = deriveAuditMissionState({
    report: scopedReport,
    mission: repairMission,
    browserReview: review,
    explorations: [exploration],
  });
  assert.equal(awaitingTrace.nextAction.tool, "open_diagnostic_mission");
  let diagnostic = createDiagnosticMission({
    auditId: report.auditId,
    finding: {
      id: canonicalFindingId,
      title: awaitingTrace.priorities[0].title,
      source: awaitingTrace.priorities[0].source,
    },
    relationship: "repair-trace-required",
    now: 90,
  });
  diagnostic = submitDiagnosticEvidence(diagnostic, {
    summary: "The shared uploader renders the file input without its visible label relationship.",
    reproduction: "Open /remove at the retained mobile viewport and inspect the upload input's accessible name.",
    observations: [{ kind: "accessibility", detail: "The file input has no accessible name." }],
    sourceLocations: [{ file: "src/components/Uploader.jsx", line: 42, symbol: "Uploader", reason: "Owns the shared file input." }],
    verificationChecks: ["bun test", "Replay /remove at the mobile viewport"],
    confidence: "high",
  }, "agent", 100);
  const repairReady = deriveAuditMissionState({
    report: scopedReport,
    mission: repairMission,
    diagnosticMissions: [diagnostic],
    browserReview: review,
    explorations: [exploration],
  });
  assert.equal(repairReady.nextAction.tool, "stage_site_repair");
  assert.equal(repairReady.nextAction.input.findingId, canonicalFindingId);
});

test("keeps a zero-route bounded-site assessment blocked and receipt-ineligible", () => {
  const scopedReport = {
    ...report,
    findings: [],
    documentProfile: { routes: [] },
  };
  const mission = createAuditMission({
    scope: "bounded-site",
    focusAreas: ["performance"],
  }, "agent", 10);
  const state = deriveAuditMissionState({ report: scopedReport, mission });

  assert.equal(state.measurementComplete, true);
  assert.equal(state.auditComplete, true);
  assert.equal(state.evidenceSnapshotAvailable, true);
  assert.equal(state.siteScope.status, "blocked");
  assert.equal(state.assessmentStatus, "blocked");
  assert.equal(state.assessmentComplete, false);
  assert.equal(state.assessmentReceiptAvailable, false);
  assert.equal(state.nextAction, null);
});

test("waits for rendered route discovery before declaring bounded scope blocked", () => {
  const mission = createAuditMission({
    scope: "bounded-site",
    focusAreas: ["seo"],
  }, "agent", 10);
  const state = deriveAuditMissionState({
    report: { ...report, findings: [], documentProfile: { routes: [] } },
    mission,
  });

  assert.equal(state.assessmentComplete, false);
  assert.equal(state.siteScope.status, "awaiting-route-discovery");
  assert.equal(state.siteScope.terminal, false);
  assert.equal(state.siteScope.blockedReason, null);
  assert.equal(state.nextAction.tool, "open_browser_review");
  assert.equal(state.checkpointStatus, "action-available");
  assert.equal(state.explorationStatus, "awaiting-route-discovery");
});

test("requires rendered accessibility and SEO evidence for an agent-started broad mission", () => {
  const mission = createAuditMission({}, "agent", 10);
  const state = deriveAuditMissionState({ report: { ...report, findings: [] }, mission });

  assert.equal(state.assessmentComplete, false);
  assert.equal(state.browserReview.required, true);
  assert.equal(state.browserReview.policy, "required");
  assert.deepEqual(state.browserReview.policyFocusAreas, ["accessibility", "seo"]);
  assert.equal(state.nextAction.tool, "open_browser_review");
});

test("uses semantic mission values for stable admission signatures", () => {
  const first = createAuditMission({ focusAreas: ["accessibility", "seo"] }, "agent", 10);
  const reordered = createAuditMission({ focusAreas: ["seo", "accessibility"] }, "agent", 20);
  const narrower = createAuditMission({ focusAreas: ["seo"], maxPriorities: 1 }, "agent", 20);
  assert.equal(auditMissionSignature(first), auditMissionSignature(reordered));
  assert.notEqual(auditMissionSignature(first), auditMissionSignature(narrower));
});

test("deduplicates measured rules, retains strategies, and orders by severity", () => {
  const mission = createAuditMission({ focusAreas: ["reliability", "performance"] }, "agent", 10);
  const projection = focusedAuditPriorities(report, mission, []);
  assert.equal(projection.matchingFindingCount, 2);
  assert.equal(projection.priorities.length, 1);
  assert.equal(projection.priorities[0].occurrenceCount, 2);
  assert.deepEqual(projection.priorities[0].affectedStrategies, ["mobile", "desktop"]);
  assert.equal(projection.priorities[0].evidenceState, "diagnosis-recommended");
  assert.equal(projection.categoryScores.performance, 92);
});

test("ranks rendered-confirmed issues ahead of repeated diagnosed document conflicts", () => {
  const mission = createAuditMission({ focusAreas: ["accessibility"], maxPriorities: 3 }, "human", 10);
  const rankedReport = {
    auditId: report.auditId,
    findings: [{
      id: "document-heading",
      title: "The fetched document is missing a primary heading",
      severity: "medium",
      category: "Accessibility",
      focusAreas: ["accessibility"],
      evidence: "The fetched shell contains no h1.",
      repair: "Reconcile the static shell with the rendered application.",
      source: { provider: "Frontmend document audit", auditId: "document-heading", strategy: "document" },
    }],
  };
  const explorations = [{
    id: "exploration-1",
    status: "complete",
    issues: [{
      provider: "Frontmend document audit",
      ruleId: "document-heading",
      title: "The fetched document is missing a primary heading",
      severity: "medium",
      category: "Accessibility",
      focusAreas: ["accessibility"],
      suggestedRepair: "Reconcile the static shell with the rendered application.",
      occurrences: [
        { auditId: "child-a", path: "/projects", findingId: "child-a-heading", strategy: "mobile", evidence: "No h1 in fetched shell." },
        { auditId: "child-b", path: "/services", findingId: "child-b-heading", strategy: "desktop", evidence: "No h1 in fetched shell." },
      ],
    }],
  }];
  const browserReview = {
    tasks: [{ id: "rendered-issue", kind: "coverage-gap" }],
    results: [{
      checkId: "rendered-issue",
      outcome: "issue",
      summary: "The rendered services route skips a heading level.",
      observations: ["The rendered outline moves from h1 to h3."],
      source: "agent",
      findings: [{
        id: "browser-services-heading",
        title: "Rendered service headings skip a level",
        severity: "medium",
        category: "Accessibility",
        focusAreas: ["accessibility"],
        evidence: "The rendered outline moves from h1 to h3.",
        repair: "Use an h2 for each service heading.",
        source: { provider: "Frontmend browser review", auditId: "rendered-heading-order", strategy: "browser" },
      }],
    }],
  };
  const diagnosticMissions = [{
    id: "diagnostic-heading",
    findingId: "document-heading",
    state: { state: "ready-for-repair" },
  }];
  const projection = focusedAuditPriorities(
    rankedReport,
    mission,
    diagnosticMissions,
    browserReview,
    [],
    explorations,
  );

  assert.equal(projection.priorities[0].relationship, "browser-only");
  assert.equal(projection.priorities[0].title, "Rendered service headings skip a level");
  assert.equal(projection.priorities[1].relationship, "diagnosis-contributed");
  assert.equal(projection.priorities[1].occurrenceCount, 3);
  assert.equal(projection.priorities[1].distinctPageCount, 3);
});

test("finalises the audit before repair diagnosis and opens repository work only after repair intent", () => {
  const mission = createAuditMission({ focusAreas: ["reliability"] }, "agent", 10);
  const completeAudit = deriveAuditMissionState({ report, mission });
  assert.equal(completeAudit.auditComplete, true);
  assert.equal(completeAudit.assessmentComplete, true);
  assert.equal(completeAudit.status, "complete");
  assert.equal(completeAudit.rankingStatus, "final");
  assert.equal(completeAudit.nextAction, null);
  assert.equal(completeAudit.repairReadiness.status, "not-started");
  assert.equal(completeAudit.authority.mayDiagnose, false);

  const repairMission = prepareRepairIntent(mission, "mobile-errors-in-console", "agent", 15);
  const pending = deriveAuditMissionState({ report, mission: repairMission });
  assert.equal(pending.assessmentComplete, true);
  assert.equal(pending.status, "action-available");
  assert.deepEqual(pending.nextAction.input, { findingId: "mobile-errors-in-console" });
  assert.equal(pending.nextAction.tool, "open_diagnostic_mission");
  assert.equal(pending.repairReadiness.status, "diagnosis-required");
  assert.equal(pending.authority.mayDiagnose, true);

  const diagnostic = createDiagnosticMission({ auditId: "audit-1", finding: report.findings[0], now: 20 });
  const inProgress = deriveAuditMissionState({ report, mission: repairMission, diagnosticMissions: [diagnostic] });
  assert.equal(inProgress.assessmentComplete, true);
  assert.equal(inProgress.status, "in-progress");
  assert.equal(inProgress.nextAction.tool, "submit_runtime_diagnosis");
  assert.deepEqual(inProgress.nextAction.input, { missionId: diagnostic.id });

  const diagnosed = submitDiagnosticEvidence(diagnostic, {
    summary: "The route reads a vendor global before its script finishes loading.",
    reproduction: "Open the audited route in a fresh tab and inspect the first console error.",
    observations: [{ kind: "console", detail: "ReferenceError occurs during route startup." }],
    sourceLocations: [{ file: "src/runtime.js", line: 42, reason: "Owns the early global read." }],
    verificationChecks: ["bun test", "bun run build"],
    confidence: "high",
  }, "agent", 30);
  const complete = deriveAuditMissionState({ report, mission: repairMission, diagnosticMissions: [diagnosed] });
  assert.equal(complete.assessmentComplete, true);
  assert.equal(complete.status, "action-available");
  assert.equal(complete.priorities[0].evidenceState, "diagnosis-contributed");
  assert.equal(complete.nextAction.tool, "stage_site_repair");
  assert.equal(complete.repairReadiness.status, "ready-to-stage");
});

test("keeps the final audit available when selected repair diagnosis is blocked", () => {
  const mission = prepareRepairIntent(
    createAuditMission({ focusAreas: ["reliability"] }, "agent", 10),
    "mobile-errors-in-console",
    "agent",
    15,
  );
  const diagnostic = createDiagnosticMission({ auditId: "audit-1", finding: report.findings[0], now: 20 });
  const blockedDiagnostic = recordDiagnosticBlocker(diagnostic, {
    reason: "wrong-repository",
    summary: "The available checkout does not produce the deployed asset that emitted the measured error.",
  }, "agent", 30);
  const state = deriveAuditMissionState({
    report,
    mission,
    diagnosticMissions: [blockedDiagnostic],
  });

  assert.equal(state.status, "blocked");
  assert.equal(state.auditComplete, true);
  assert.equal(state.assessmentComplete, true);
  assert.equal(state.assessmentReceiptAvailable, true);
  assert.equal(state.nextActor, null);
  assert.equal(state.nextAction, null);
  assert.equal(state.repairReadiness.status, "blocked");
  assert.equal(state.priorities[0].evidenceState, "diagnosis-blocked");
  assert.equal(state.priorities[0].diagnosticBlocker.reason, "wrong-repository");
});

test("completes an honest zero-match assessment only after its requested browser review", () => {
  const mission = createAuditMission({ focusAreas: ["seo"] }, "agent", 10);
  const providerOnly = deriveAuditMissionState({ report, mission });
  assert.equal(providerOnly.assessmentComplete, false);
  assert.equal(providerOnly.nextAction.tool, "open_browser_review");
  let browserReview = createBrowserReviewMission({
    auditId: report.auditId,
    mission,
    target: "https://example.com/",
    now: 20,
  });
  browserReview = recordBrowserReviewCheck(browserReview, {
    checkId: "rendered-structure",
    outcome: "passed",
    summary: "The rendered structure exposes the page topic.",
    observations: ["One primary heading and a named main landmark are rendered."],
  }, "agent", 30);
  browserReview = recordBrowserReviewCheck(browserReview, {
    checkId: "search-discovery",
    outcome: "passed",
    summary: "The primary rendered content and navigation expose the important destinations.",
    observations: ["Descriptive same-site links are present in the primary navigation."],
  }, "agent", 40);
  const state = deriveAuditMissionState({ report, mission, browserReview });
  assert.equal(state.matchingFindingCount, 0);
  assert.equal(state.priorityCount, 0);
  assert.equal(state.assessmentComplete, true);
  assert.equal(state.nextAction, null);
  assert.deepEqual(state.categoryScores, { seo: null });
  assert.equal(state.browserReview.status, "complete");
});

test("turns an optional human-to-agent takeover into a required same-audit investigation", () => {
  const mission = createAuditMission({ focusAreas: ["seo"] }, "human", 10);
  const beforeAdoption = deriveAuditMissionState({ report, mission });
  assert.equal(beforeAdoption.assessmentComplete, true);
  assert.equal(beforeAdoption.browserReview.required, false);
  assert.equal(beforeAdoption.browserReview.adoptionAvailable, true);

  const browserReview = createBrowserReviewMission({
    auditId: report.auditId,
    mission,
    report,
    target: "https://example.com/",
    source: "agent",
    now: 20,
  });
  const adopted = deriveAuditMissionState({ report, mission, browserReview });

  assert.equal(adopted.assessmentComplete, false);
  assert.equal(adopted.browserReview.required, true);
  assert.equal(adopted.browserReview.adoptionAvailable, false);
  assert.equal(adopted.browserReview.adoptedFromHumanMission, true);
  assert.equal(adopted.browserReview.adoption.originalMissionActor, "human");
  assert.equal(adopted.status, "in-progress");
  assert.equal(adopted.nextAction.tool, "record_browser_review_check");
  assert.equal(browserReview.auditId, report.auditId);
  assert.equal(mission.requestedBy, "human");
});

test("restores a human assessment after an untouched handoff is visibly withdrawn", () => {
  const mission = createAuditMission({ focusAreas: ["seo"] }, "human", 10);
  const opened = createBrowserReviewMission({
    auditId: report.auditId,
    mission,
    report,
    target: "https://example.com/",
    source: "person",
    now: 20,
  });
  const withdrawn = withdrawBrowserReview(opened, "person", 30);
  const state = deriveAuditMissionState({ report, mission, browserReview: withdrawn });

  assert.equal(state.assessmentComplete, true);
  assert.equal(state.browserReview.required, false);
  assert.equal(state.browserReview.status, "withdrawn");
  assert.equal(state.browserReview.withdrawal.withdrawnBy, "person");
  assert.equal(state.browserReview.provenance, "no-browser-evidence");
  assert.equal(state.browserReview.adoptionAvailable, false);
  assert.equal(state.nextAction, null);
});

test("ranks browser-observed issues without starting repository diagnosis before repair intent", () => {
  const mission = createAuditMission({ focusAreas: ["seo"] }, "agent", 10);
  let browserReview = createBrowserReviewMission({
    auditId: report.auditId,
    mission,
    target: "https://example.com/",
    now: 20,
  });
  browserReview = recordBrowserReviewCheck(browserReview, {
    checkId: "rendered-structure",
    outcome: "passed",
    summary: "The rendered structure exposes the page topic.",
    observations: ["One primary heading is rendered."],
  }, "agent", 30);
  browserReview = recordBrowserReviewCheck(browserReview, {
    checkId: "search-discovery",
    outcome: "issue",
    summary: "The rendered page does not expose a path to important guidance.",
    observations: ["No descriptive same-site link reaches the product guide."],
    findings: [{
      title: "Important guidance is absent from rendered navigation",
      severity: "medium",
      focusArea: "seo",
      evidence: "The header and footer contain no link to the product guide.",
      suggestedRepair: "Add a descriptive same-site link to the guide.",
      element: "header nav, footer nav",
    }],
  }, "agent", 40);
  const state = deriveAuditMissionState({ report, mission, browserReview });
  assert.equal(state.priorityCount, 1);
  assert.equal(state.assessmentComplete, true);
  assert.equal(state.priorities[0].evidenceProvenance, "agent-reported-browser");
  assert.equal(state.priorities[0].source.provider, "Frontmend browser review");
  assert.equal(state.nextAction, null);
  assert.equal(state.repairReadiness.status, "not-started");

  const repairMission = prepareRepairIntent(mission, "browser:search-discovery:01", "agent", 50);
  const repairState = deriveAuditMissionState({ report, mission: repairMission, browserReview });
  assert.equal(repairState.nextAction.tool, "open_diagnostic_mission");
  assert.equal(repairState.nextAction.input.findingId, "browser:search-discovery:01");
});

test("keeps a trigger-linked browser pass final while deferring conflict diagnosis to repair preparation", () => {
  const mission = createAuditMission({ focusAreas: ["accessibility"] }, "agent", 10);
  let browserReview = createBrowserReviewMission({
    auditId: report.auditId,
    mission,
    report,
    target: "https://example.com/",
    now: 20,
  });
  assert.equal(browserReview.state.nextCheck.trigger.ruleId, "color-contrast");
  browserReview = recordBrowserReviewCheck(browserReview, {
    checkId: browserReview.state.nextCheck.id,
    outcome: "passed",
    summary: "The retained control appeared readable in the rendered mobile state.",
    observations: ["The foreground and background were visually distinct at the retained selector."],
  }, "agent", 30);

  const state = deriveAuditMissionState({ report, mission, browserReview });
  assert.equal(state.assessmentComplete, true);
  assert.equal(state.priorities[0].relationship, "provider-browser-conflict");
  assert.equal(state.nextAction, null);
  const repairMission = prepareRepairIntent(mission, state.priorities[0].findingId, "agent", 35);
  const repairState = deriveAuditMissionState({ report, mission: repairMission, browserReview });
  assert.equal(repairState.nextAction.tool, "open_diagnostic_mission");
  const conflictMission = createDiagnosticMission({
    auditId: report.auditId,
    finding: report.findings.find((finding) => finding.source.auditId === "color-contrast"),
    relationship: state.priorities[0].relationship,
    now: 40,
  });
  assert.equal(conflictMission.measuredEvidence.kind, "evidence-conflict");
});

test("freezes explicit repair intent idempotently and rejects replacement", () => {
  const mission = createAuditMission({ intent: "assess", focusAreas: ["accessibility"] }, "agent", 10);
  const prepared = prepareRepairIntent(mission, "mobile-color-contrast", "human", 20);
  assert.equal(mission.intent, "assess");
  assert.equal(mission.repairPreparation, null);
  assert.equal(prepared.intent, "prepare-fix");
  assert.deepEqual(prepared.repairPreparation, {
    findingId: "mobile-color-contrast",
    findingIds: ["mobile-color-contrast"],
    requestedBy: "human",
    requestedAt: 20,
  });
  assert.deepEqual(prepareRepairIntent(prepared, "mobile-color-contrast", "agent", 30), prepared);
  assert.throws(
    () => prepareRepairIntent(prepared, "mobile-errors-in-console", "agent", 30),
    (error) => error.code === "REPAIR_INTENT_CONFLICT",
  );
});

test("names repair staging only after an explicit selected finding transition", () => {
  const assess = createAuditMission({ focusAreas: ["accessibility"] }, "human", 10);
  const prepared = prepareRepairIntent(assess, "mobile-color-contrast", "human", 20);
  const state = deriveAuditMissionState({ report, mission: prepared });
  assert.equal(state.assessmentComplete, true);
  assert.equal(state.status, "action-available");
  assert.equal(state.authority.mayPrepareRepair, true);
  assert.deepEqual(state.nextAction, {
    tool: "stage_site_repair",
    input: { findingId: "mobile-color-contrast" },
    reason: "Prepare a bounded repair draft for the explicitly selected finding.",
  });
  assert.equal(state.authority.mayDeploy, false);
  assert.equal(state.authority.mayAttestDeployment, false);
});

test("continues approved repair work autonomously and stops at real person boundaries", () => {
  const mission = prepareRepairIntent(
    createAuditMission({ focusAreas: ["accessibility"] }, "human", 10),
    "mobile-color-contrast",
    "human",
    20,
  );
  const baseRepair = {
    id: "repair-1",
    findingId: "mobile-color-contrast",
    status: "draft",
    patchType: "css",
  };

  const review = deriveAuditMissionState({ report, mission, repairs: [baseRepair] });
  assert.equal(review.status, "awaiting-human-review");
  assert.equal(review.nextActor, "person");
  assert.equal(review.nextAction, null);

  const implementation = deriveAuditMissionState({
    report,
    mission,
    repairs: [{ ...baseRepair, status: "approved" }],
  });
  assert.equal(implementation.nextActor, "agent");
  assert.deepEqual(implementation.nextAction, {
    tool: "record_repository_implementation",
    input: { repairId: "repair-1" },
    reason: "Implement the approved repository plan, run its checks, and record the bounded implementation receipt.",
  });

  const deployment = deriveAuditMissionState({
    report,
    mission,
    repairs: [{
      ...baseRepair,
      status: "approved",
      implementationReceipt: {
        agentReported: true,
        checks: [{ name: "bun test", status: "passed" }],
      },
    }],
  });
  assert.equal(deployment.status, "awaiting-external-deployment");
  assert.equal(deployment.nextActor, "person");
  assert.equal(deployment.nextAction, null);

  const verification = deriveAuditMissionState({
    report,
    mission,
    repairs: [{ ...baseRepair, status: "approved", deploymentAttestedAt: 30 }],
  });
  assert.equal(verification.nextActor, "agent");
  assert.equal(verification.nextAction.tool, "start_repair_verification");

  const verifying = deriveAuditMissionState({
    report,
    mission,
    repairs: [{
      ...baseRepair,
      status: "approved",
      deploymentAttestedAt: 30,
      verificationRun: { id: "run-1" },
    }],
  });
  assert.equal(verifying.status, "in-progress");
  assert.equal(verifying.nextAction.tool, "get_verification_receipt");

  const complete = deriveAuditMissionState({
    report,
    mission,
    repairs: [{
      ...baseRepair,
      status: "approved",
      deploymentAttestedAt: 30,
      verificationRun: { id: "run-1" },
      aggregateVerification: { receiptAvailable: true, status: "resolved" },
    }],
  });
  assert.equal(complete.status, "complete");
  assert.equal(complete.nextActor, null);
  assert.equal(complete.nextAction, null);
});

test("freezes one to three repair findings and advances only when every required diagnosis is ready", () => {
  const selected = ["mobile-errors-in-console", "mobile-color-contrast"];
  const mission = prepareRepairIntent(
    createAuditMission({ focusAreas: ["reliability", "accessibility"] }, "human", 10),
    selected,
    "human",
    20,
  );
  assert.deepEqual(mission.repairPreparation.findingIds, selected);
  assert.deepEqual(prepareRepairIntent(mission, selected, "agent", 30), mission);
  assert.throws(
    () => prepareRepairIntent(mission, [...selected].reverse(), "human", 30),
    (error) => error.code === "REPAIR_INTENT_CONFLICT",
  );

  const waiting = deriveAuditMissionState({ report, mission });
  assert.equal(waiting.nextAction.tool, "open_diagnostic_mission");
  assert.equal(waiting.nextAction.input.findingId, selected[0]);

  const diagnostic = createDiagnosticMission({ auditId: report.auditId, finding: report.findings[0], now: 40 });
  const diagnosed = submitDiagnosticEvidence(diagnostic, {
    summary: "The owned runtime reads a vendor global before the script is ready.",
    reproduction: "Open the audited route and inspect the first retained console error.",
    observations: [{ kind: "console", detail: "ReferenceError occurs during route startup." }],
    sourceLocations: [{ file: "src/runtime.js", line: 42, reason: "Owns the early global read." }],
    verificationChecks: ["bun test", "bun run build"],
    confidence: "high",
  }, "agent", 50);
  const ready = deriveAuditMissionState({ report, mission, diagnosticMissions: [diagnosed] });
  assert.equal(ready.nextAction.tool, "stage_site_repair");
  assert.deepEqual(ready.nextAction.input, {
    findingId: selected[0],
    findingIds: selected,
  });
});
