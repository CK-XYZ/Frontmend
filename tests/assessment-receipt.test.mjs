import assert from "node:assert/strict";
import test from "node:test";
import {
  assessmentReceiptMarkdown,
  createAssessmentReceipt,
} from "../src/assessment-receipt.js";
import { createAuditMission } from "../src/audit-mission-contract.js";
import {
  createDiagnosticMission,
  recordDiagnosticBlocker,
  submitDiagnosticEvidence,
} from "../src/diagnostic-contract.js";
import {
  createBrowserReviewMission,
  recordBrowserReviewCheck,
  withdrawBrowserReview,
} from "../src/browser-review-contract.js";

const finding = {
  id: "mobile-errors-in-console",
  title: "The page reports browser errors",
  severity: "high",
  category: "reliability",
  focusAreas: ["accessibility"],
  evidence: "Lighthouse observed a first-party console error during the mobile load.",
  repair: "Reproduce and map the failing runtime owner before proposing a repair.",
  source: { provider: "Lighthouse", auditId: "errors-in-console", strategy: "mobile" },
  diagnosticEvidence: {
    kind: "console-errors",
    provenance: "measured-lighthouse",
    completeness: "actionable",
    entries: [{ description: "ReferenceError", sourceUrl: "https://example.com/app.js" }],
    missing: [],
    caveat: "Audited load only.",
  },
};

const report = {
  auditId: "audit-1",
  url: "https://example.com/",
  finalUrl: "https://example.com/",
  completedAt: 1_000,
  engine: {
    mode: "live-lighthouse",
    provider: "PageSpeed Insights / Lighthouse",
    lighthouseVersion: "13.0.1",
  },
  coverage: {
    adapters: [{
      adapterId: "google-pagespeed-lighthouse",
      provider: "PageSpeed Insights",
      kind: "viewport-measurement",
      status: "complete",
      adapterContractVersion: 1,
      evidenceVersion: "13.0.1",
      lighthouseVersion: "13.0.1",
      ruleSetVersion: 1,
      measuredConditions: ["mobile", "desktop"],
      failureCodes: [],
      claimBoundary: "Lab evidence for measured emulated viewports only.",
    }],
  },
  findings: [finding],
  viewports: [{ scores: { accessibility: 91 } }],
};

const mission = createAuditMission({ focusAreas: ["accessibility"], maxPriorities: 3 }, "agent", 100);

function completeAccessibilityReview() {
  let review = createBrowserReviewMission({
    auditId: report.auditId,
    mission,
    target: report.finalUrl,
    now: 110,
  });
  review = recordBrowserReviewCheck(review, {
    checkId: "rendered-structure",
    outcome: "passed",
    summary: "Rendered structure was inspected.",
    observations: ["One primary heading and a named main landmark are rendered."],
  }, "agent", 120);
  review = recordBrowserReviewCheck(review, {
    checkId: "primary-journey",
    outcome: "passed",
    summary: "The safe primary journey was inspected without consequential submission.",
    observations: ["Primary controls expose labels and visible feedback before submission."],
  }, "agent", 130);
  return recordBrowserReviewCheck(review, {
    checkId: "responsive-reflow",
    outcome: "passed",
    summary: "The primary content reflows at a narrow viewport.",
    observations: ["The 390px viewport retains readable content and reachable controls."],
  }, "agent", 140);
}

test("withholds an assessment receipt until required diagnosis is contributed", () => {
  assert.throws(
    () => createAssessmentReceipt({ report, mission }),
    (error) => error?.code === "ASSESSMENT_INCOMPLETE" && /open_browser_review/.test(error.message),
  );

  const browserReview = completeAccessibilityReview();
  assert.throws(
    () => createAssessmentReceipt({ report, mission, browserReview }),
    (error) => error?.code === "ASSESSMENT_INCOMPLETE" && /open_diagnostic_mission/.test(error.message),
  );
  const opened = createDiagnosticMission({ auditId: report.auditId, finding, now: 200 });
  assert.throws(
    () => createAssessmentReceipt({ report, mission, diagnosticMissions: [opened], browserReview }),
    (error) => error?.code === "ASSESSMENT_INCOMPLETE" && /submit_runtime_diagnosis/.test(error.message),
  );
});

test("withholds an assessment receipt when diagnosis is explicitly blocked", () => {
  const browserReview = completeAccessibilityReview();
  const opened = createDiagnosticMission({ auditId: report.auditId, finding, now: 200 });
  const blocked = recordDiagnosticBlocker(opened, {
    reason: "browser-unavailable",
    summary: "This session cannot open the deployed route in a browser.",
  }, "agent", 250);

  assert.throws(
    () => createAssessmentReceipt({ report, mission, diagnosticMissions: [blocked], browserReview }),
    (error) => error?.code === "ASSESSMENT_INCOMPLETE" && /outstanding diagnostic evidence/.test(error.message),
  );
});

test("withholds a receipt when bounded-site measurement has no retained routes", () => {
  const boundedMission = createAuditMission({
    scope: "bounded-site",
    focusAreas: ["performance"],
  }, "agent", 100);
  assert.throws(
    () => createAssessmentReceipt({
      report: { ...report, findings: [], documentProfile: { routes: [] } },
      mission: boundedMission,
    }),
    (error) => error?.code === "ASSESSMENT_INCOMPLETE",
  );
});

test("withholds a previously complete human assessment after rendered review adoption", () => {
  const humanMission = createAuditMission({ focusAreas: [], maxPriorities: 3 }, "human", 100);
  const adoptedReview = createBrowserReviewMission({
    auditId: report.auditId,
    mission: humanMission,
    report,
    target: report.finalUrl,
    source: "agent",
    focusAreas: ["accessibility"],
    now: 150,
  });

  assert.throws(
    () => createAssessmentReceipt({ report, mission: humanMission, browserReview: adoptedReview }),
    (error) => error?.code === "ASSESSMENT_INCOMPLETE" && /record_browser_review_check/.test(error.message),
  );
});

test("exports a visible no-evidence record after an untouched human handoff is withdrawn", () => {
  const humanMission = createAuditMission({ focusAreas: ["seo"], maxPriorities: 3 }, "human", 100);
  const opened = createBrowserReviewMission({
    auditId: report.auditId,
    mission: humanMission,
    report: { ...report, findings: [] },
    target: report.finalUrl,
    source: "person",
    now: 150,
  });
  const browserReview = withdrawBrowserReview(opened, "person", 160);
  const receipt = createAssessmentReceipt({
    report: { ...report, findings: [] },
    mission: humanMission,
    browserReview,
  });

  assert.equal(receipt.browserReview.status, "withdrawn");
  assert.equal(receipt.browserReview.provenance, "no-browser-evidence");
  assert.equal(receipt.browserReview.checks.length, 0);
  assert.match(assessmentReceiptMarkdown(receipt), /withdrawn by the person before any browser evidence/i);
  assert.doesNotMatch(assessmentReceiptMarkdown(receipt), /Agent-contributed browser review/);
});

test("exports person-completed rendered checks with person provenance", () => {
  const humanMission = createAuditMission({ focusAreas: ["seo"], maxPriorities: 3 }, "human", 100);
  const emptyReport = { ...report, findings: [], viewports: [] };
  let browserReview = createBrowserReviewMission({
    auditId: report.auditId,
    mission: humanMission,
    report: emptyReport,
    target: report.finalUrl,
    source: "person",
    now: 150,
  });
  browserReview = recordBrowserReviewCheck(browserReview, {
    checkId: browserReview.state.nextCheck.id,
    outcome: "passed",
    summary: "The rendered structure was inspected directly by the person.",
    observations: ["The primary heading names the page topic."],
  }, "person", 160);
  browserReview = recordBrowserReviewCheck(browserReview, {
    checkId: browserReview.state.nextCheck.id,
    outcome: "passed",
    summary: "The rendered discovery path was inspected directly by the person.",
    observations: ["Descriptive same-site links expose the important destinations."],
  }, "person", 170);

  const receipt = createAssessmentReceipt({ report: emptyReport, mission: humanMission, browserReview });
  assert.equal(receipt.browserReview.provenance, "person-reported-browser");
  assert.deepEqual(receipt.browserReview.checks.map((check) => check.provenance), [
    "person-reported-browser",
    "person-reported-browser",
  ]);
  assert.match(assessmentReceiptMarkdown(receipt), /Provenance: person-reported-browser/);
});

test("exports measured and contributed evidence with separate provenance and authority", () => {
  const browserReview = completeAccessibilityReview();
  const opened = createDiagnosticMission({ auditId: report.auditId, finding, now: 200 });
  const diagnosed = submitDiagnosticEvidence(opened, {
    summary: "The route initialiser reads <unsafe>| and `window.vendor` before its dependency loads.",
    reproduction: "Reload the public route and observe the first-party error before interaction.",
    observations: [{ kind: "console", detail: "ReferenceError occurs once during route startup." }],
    sourceLocations: [{
      file: "src/startup.js",
      line: 42,
      symbol: "initialiseRoute",
      reason: "Owns the failing dependency read.",
    }],
    verificationChecks: ["bun test", "Reload with an empty console"],
    confidence: "high",
  }, "agent", 300);

  const activities = [{
    id: "activity-1",
    tool: "submit_runtime_diagnosis",
    title: "Submit runtime diagnosis",
    status: "succeeded",
    actorClass: "webmcp-agent",
    auditId: report.auditId,
    repairId: null,
    diagnosticMissionId: diagnosed.id,
    browserReviewId: null,
    explorationId: null,
    errorCode: null,
    missionRevisionBefore: 6,
    missionRevisionAfter: 7,
    startedAt: 290,
    completedAt: 300,
  }];
  const receipt = createAssessmentReceipt({
    report,
    mission,
    diagnosticMissions: [diagnosed],
    browserReview,
    activities,
  });
  assert.equal(receipt.assessment.complete, true);
  assert.equal(receipt.assessment.priorityCount, 1);
  assert.equal(receipt.priorities[0].measuredSource.provider, "Lighthouse");
  assert.equal(receipt.browserReview.provenance, "agent-reported-browser");
  assert.equal(receipt.browserReview.completedCheckCount, 3);
  assert.equal(receipt.priorities[0].evidenceChain.stages[0].provenance, "measured-lighthouse");
  assert.equal(receipt.priorities[0].diagnosis.provenance, "agent-reported");
  assert.equal(receipt.priorities[0].diagnosis.sourceLocations[0].file, "src/startup.js");
  assert.equal(receipt.priorities[0].relationship, "diagnosis-contributed");
  assert.match(receipt.priorities[0].relationshipReason, /repository evidence/i);
  assert.equal(receipt.priorities[0].evidenceRecords.provider.provenance, "measured-provider");
  assert.equal(receipt.priorities[0].evidenceRecords.repository.provenance, "agent-reported-repository");
  assert.equal(receipt.authority.sourceContentsReceived, false);
  assert.equal(receipt.authority.deploymentProved, false);
  assert.equal(receipt.build.app, "frontmend");
  assert.equal(receipt.build.protocolVersion, 1);
  assert.equal(receipt.build.toolCount, 23);
  assert.equal(receipt.engine.adapters[0].adapterId, "google-pagespeed-lighthouse");
  assert.equal(receipt.engine.adapters[0].lighthouseVersion, "13.0.1");
  assert.equal(receipt.activityLedger.retention, "last-20-per-audit");
  assert.equal(receipt.activityLedger.entries[0].tool, "submit_runtime_diagnosis");
  assert.equal(receipt.activityLedger.entries[0].missionRevisionAfter, 7);
  assert.equal(JSON.stringify(receipt.activityLedger).includes("https://"), false);

  const markdown = assessmentReceiptMarkdown(receipt);
  assert.match(markdown, /^# Frontmend assessment receipt/m);
  assert.match(markdown, /Measured symptom \| retained \| measured-lighthouse/);
  assert.match(markdown, /Evidence relationship: diagnosis-contributed/);
  assert.match(markdown, /Contributed rendered-browser review/);
  assert.match(markdown, /Coverage: 3 of 3 requested checks/);
  assert.match(markdown, /Browser reproduction \| contributed \| agent-reported/);
  assert.match(markdown, /`src\/startup\.js:42`/);
  assert.match(markdown, /&lt;unsafe&gt;\\\|/);
  assert.match(markdown, /\\`window\.vendor\\`/);
  assert.match(markdown, /does not prove a repair, deployment, or resolution/);
  assert.match(markdown, /Frontmend build: unidentified/);
  assert.match(markdown, /Protocol: v1; tool library v2; 23 contracts/);
  assert.match(markdown, /## Evidence adapters/);
  assert.match(markdown, /google-pagespeed-lighthouse/);
  assert.match(markdown, /Lighthouse version: 13\.0\.1/);
  assert.match(markdown, /## Semantic activity ledger/);
  assert.match(markdown, /submit_runtime_diagnosis/);
  assert.match(markdown, /6 → 7/);
  assert.match(markdown, /tool inputs, patches, source contents, credentials, secrets/);
});

test("exports an honest complete receipt when the retained focus has no matching failures", () => {
  const browserReview = completeAccessibilityReview();
  const zero = createAssessmentReceipt({
    report: { ...report, findings: [] },
    mission,
    diagnosticMissions: [],
    browserReview,
  });
  assert.equal(zero.assessment.complete, true);
  assert.equal(zero.assessment.priorityCount, 0);
  assert.equal(zero.assessment.matchingFindingCount, 0);
  assert.match(assessmentReceiptMarkdown(zero), /Ranked priorities: 0/);
});

test("retains rendered route provenance in a completed bounded-site receipt", () => {
  const boundedMission = createAuditMission({
    scope: "bounded-site",
    focusAreas: [],
  }, "human", 100);
  const renderedReport = {
    ...report,
    findings: [],
    documentProfile: { routes: [] },
    renderedRouteObservations: [{
      path: "/projects",
      observedPath: "/projects",
      source: "agent-reported-browser-route",
      method: "HEAD",
      status: 200,
      validatedAt: 500,
    }],
  };
  const exploration = {
    id: "232d593c-6c81-48c3-b137-a3df269454ff",
    rootAuditId: report.auditId,
    status: "complete",
    createdAt: 600,
    summary: { pagesRequested: 1, pagesComplete: 1, pagesFailed: 0 },
    issues: [],
  };
  const receipt = createAssessmentReceipt({
    report: renderedReport,
    mission: boundedMission,
    explorations: [exploration],
  });

  assert.equal(receipt.assessment.complete, true);
  assert.equal(receipt.assessment.siteScope.routeCandidates[0].path, "/projects");
  assert.equal(
    receipt.assessment.siteScope.routeCandidates[0].source,
    "agent-reported-browser-route",
  );
});
