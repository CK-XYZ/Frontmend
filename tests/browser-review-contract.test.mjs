import test from "node:test";
import assert from "node:assert/strict";
import {
  browserReviewAdoptionAvailable,
  browserReviewChecksForMission,
  browserReviewFindings,
  browserReviewProvenance,
  browserReviewRequired,
  browserReviewWithdrawalAvailable,
  createBrowserReviewMission,
  createBrowserVerificationReview,
  recordBrowserReviewCheck,
  withdrawBrowserReview,
} from "../src/browser-review-contract.js";

const AUDIT_ID = "102fe458-702c-4d97-8aac-5ac3d6f7a609";
const mission = {
  requestedBy: "agent",
  focusAreas: ["accessibility", "seo"],
};

test("requires a browser review only for agent-started accessibility or SEO missions", () => {
  assert.equal(browserReviewRequired(mission), true);
  assert.equal(browserReviewRequired({ ...mission, requestedBy: "human" }), false);
  assert.equal(browserReviewRequired({ requestedBy: "agent", focusAreas: ["performance"] }), false);
  assert.deepEqual(
    browserReviewChecksForMission(mission).map((check) => check.id),
    ["rendered-structure", "primary-journey", "responsive-reflow", "search-discovery"],
  );
});

test("adopts an eligible person-started assessment without restarting its audit", () => {
  const humanMission = {
    schemaVersion: 1,
    intent: "assess",
    requestedBy: "human",
    focusAreas: [],
    maxPriorities: 3,
    requestedAt: 5,
    repairPreparation: null,
  };
  assert.equal(browserReviewAdoptionAvailable(humanMission), true);
  assert.equal(browserReviewAdoptionAvailable({ ...humanMission, focusAreas: ["seo"] }), true);
  assert.equal(browserReviewAdoptionAvailable({ ...humanMission, focusAreas: ["performance"] }), false);
  assert.equal(browserReviewAdoptionAvailable({ ...humanMission, intent: "prepare-fix" }), false);
  assert.equal(browserReviewAdoptionAvailable({ ...humanMission, repairPreparation: { findingId: "finding-1" } }), false);

  const review = createBrowserReviewMission({
    auditId: AUDIT_ID,
    mission: humanMission,
    target: "https://example.com/",
    source: "agent",
    focusAreas: ["accessibility", "seo"],
    now: 10,
  });

  assert.equal(review.auditId, AUDIT_ID);
  assert.deepEqual(review.requestedFocusAreas, ["accessibility", "seo"]);
  assert.equal(review.adoption.mode, "human-to-agent");
  assert.equal(review.adoption.originalMissionActor, "human");
  assert.equal(review.adoption.openedBy, "agent");
  assert.equal(review.adoption.sameAudit, true);
  assert.equal(review.adoption.restarted, false);
  assert.equal(browserReviewRequired(humanMission, review), true);
  assert.equal(browserReviewAdoptionAvailable(humanMission, review), false);
  assert.ok(review.state.requestedCheckCount > 0);
});

test("keeps a focused person-started takeover inside its retained review scope", () => {
  const humanSeoMission = { requestedBy: "human", intent: "assess", focusAreas: ["seo"] };
  const review = createBrowserReviewMission({
    auditId: AUDIT_ID,
    mission: humanSeoMission,
    target: "https://example.com/",
    source: "person",
    now: 10,
  });
  assert.deepEqual(review.requestedFocusAreas, ["seo"]);
  assert.equal(review.adoption.openedBy, "person");
  assert.throws(
    () => createBrowserReviewMission({
      auditId: AUDIT_ID,
      mission: humanSeoMission,
      target: "https://example.com/",
      focusAreas: ["accessibility"],
    }),
    (error) => error.code === "INVALID_BROWSER_REVIEW",
  );
});

test("opens an ordered browser review with exact browser tasks and authority boundaries", () => {
  const review = createBrowserReviewMission({
    auditId: AUDIT_ID,
    mission,
    target: "https://example.com/",
    now: 10,
  });
  assert.equal(review.state.status, "in-progress");
  assert.equal(review.state.requestedCheckCount, 4);
  assert.equal(review.state.nextCheck.id, "rendered-structure");
  assert.match(review.state.nextCheck.instruction, /rendered page structure/i);
  assert.equal(review.authority.provenance, "no-browser-evidence");
  assert.equal(review.authority.deployment, "site-owner");
});

test("records browser facts sequentially and promotes observed issues with separate provenance", () => {
  let review = createBrowserReviewMission({
    auditId: AUDIT_ID,
    mission: { requestedBy: "agent", focusAreas: ["seo"] },
    target: "https://example.com/",
    now: 10,
  });
  review = recordBrowserReviewCheck(review, {
    checkId: "rendered-structure",
    outcome: "passed",
    summary: "The rendered document exposes one clear primary heading.",
    observations: ["One visible H1 names the page topic after client rendering."],
  }, "agent", 20);
  assert.equal(review.state.nextCheck.id, "search-discovery");

  review = recordBrowserReviewCheck(review, {
    checkId: "search-discovery",
    outcome: "issue",
    summary: "Important product guidance is unreachable from the primary navigation.",
    observations: ["The rendered header links only to the homepage and account action."],
    findings: [{
      title: "Important guidance has no rendered discovery path",
      severity: "medium",
      focusArea: "seo",
      evidence: "The primary navigation exposes no same-site link to the product guide.",
      suggestedRepair: "Add a descriptive, crawlable navigation link to the guide.",
      element: "header nav",
    }],
  }, "agent", 30);

  assert.equal(review.state.status, "complete");
  assert.equal(review.state.issueCount, 1);
  const [finding] = browserReviewFindings(review);
  assert.equal(finding.id, "browser:search-discovery:01");
  assert.equal(finding.source.provider, "Frontmend browser review");
  assert.equal(finding.browserReviewEvidence.provenance, "agent-reported-browser");
  assert.equal(finding.diagnosticEvidence.kind, "browser-observation");
});

test("attributes person-recorded browser evidence without changing its shared schema", () => {
  let review = createBrowserReviewMission({
    auditId: AUDIT_ID,
    mission: { requestedBy: "human", intent: "assess", focusAreas: ["seo"] },
    target: "https://example.com/",
    source: "person",
    now: 10,
  });
  review = recordBrowserReviewCheck(review, {
    checkId: review.state.nextCheck.id,
    outcome: "issue",
    summary: "The retained page topic is missing from the rendered primary heading.",
    observations: ["The rendered H1 contains only an account prompt."],
    findings: [{
      title: "Rendered heading does not name the page topic",
      severity: "medium",
      focusArea: "seo",
      evidence: "The visible H1 does not describe the page topic.",
      suggestedRepair: "Use a descriptive primary heading for the route.",
      element: "h1",
    }],
  }, "person", 20);

  assert.equal(review.results[0].source, "person");
  assert.equal(review.results[0].agentReported, false);
  assert.equal(review.findings[0].browserReviewEvidence.provenance, "person-reported-browser");
  assert.equal(review.findings[0].diagnosticEvidence.provenance, "person-reported-browser");
  assert.equal(review.authority.provenance, "person-reported-browser");
  assert.equal(browserReviewProvenance(review), "person-reported-browser");
});

test("withdraws only an untouched person-opened assessment handoff and retains its record", () => {
  const humanMission = { requestedBy: "human", intent: "assess", focusAreas: ["seo"] };
  const review = createBrowserReviewMission({
    auditId: AUDIT_ID,
    mission: humanMission,
    target: "https://example.com/",
    source: "person",
    now: 10,
  });
  assert.equal(browserReviewWithdrawalAvailable(review), true);

  const withdrawn = withdrawBrowserReview(review, "person", 20);
  assert.equal(withdrawn.id, review.id);
  assert.equal(withdrawn.state.status, "withdrawn");
  assert.equal(withdrawn.state.withdrawalAvailable, false);
  assert.equal(withdrawn.withdrawal.withdrawnBy, "person");
  assert.equal(withdrawn.authority.provenance, "no-browser-evidence");
  assert.equal(browserReviewRequired(humanMission, withdrawn), false);
  assert.equal(browserReviewAdoptionAvailable(humanMission, withdrawn), false);
  assert.equal(withdrawBrowserReview(withdrawn, "person", 30).updatedAt, 20);
  assert.throws(
    () => recordBrowserReviewCheck(withdrawn, {
      checkId: review.state.nextCheck.id,
      outcome: "passed",
      summary: "This must not be accepted after withdrawal.",
      observations: ["No observation may be added."],
    }, "person", 30),
    (error) => error.code === "BROWSER_REVIEW_WITHDRAWN",
  );
  assert.throws(
    () => withdrawBrowserReview(review, "agent", 20),
    (error) => error.code === "BROWSER_REVIEW_WITHDRAWAL_HUMAN_ONLY",
  );
});

test("locks withdrawal once evidence exists and excludes required verification reviews", () => {
  const humanMission = { requestedBy: "human", intent: "assess", focusAreas: ["seo"] };
  let review = createBrowserReviewMission({
    auditId: AUDIT_ID,
    mission: humanMission,
    target: "https://example.com/",
    source: "person",
    now: 10,
  });
  review = recordBrowserReviewCheck(review, {
    checkId: review.state.nextCheck.id,
    outcome: "passed",
    summary: "The rendered structure was checked by the person.",
    observations: ["The primary heading names the page topic."],
  }, "person", 20);
  assert.equal(browserReviewWithdrawalAvailable(review), false);
  assert.throws(
    () => withdrawBrowserReview(review, "person", 30),
    (error) => error.code === "BROWSER_REVIEW_WITHDRAWAL_LOCKED",
  );

  const agentStarted = createBrowserReviewMission({
    auditId: AUDIT_ID,
    mission,
    target: "https://example.com/",
    now: 10,
  });
  assert.throws(
    () => withdrawBrowserReview(agentStarted, "person", 20),
    (error) => error.code === "BROWSER_REVIEW_WITHDRAWAL_UNAVAILABLE",
  );
});

test("keeps a browser blocker honest and lets the same check recover later", () => {
  let review = createBrowserReviewMission({
    auditId: AUDIT_ID,
    mission: { requestedBy: "agent", focusAreas: ["accessibility"] },
    target: "https://example.com/",
    now: 10,
  });
  review = recordBrowserReviewCheck(review, {
    checkId: "rendered-structure",
    outcome: "blocked",
    summary: "The browser session cannot reach the public target.",
    blockerReason: "browser-unavailable",
  }, "agent", 20);
  assert.equal(review.state.status, "blocked");
  assert.equal(review.state.nextCheck.id, "rendered-structure");

  review = recordBrowserReviewCheck(review, {
    checkId: "rendered-structure",
    outcome: "passed",
    summary: "Browser access was restored and the rendered structure was checked.",
    observations: ["The page exposes a main landmark and one primary heading."],
  }, "agent", 30);
  assert.equal(review.state.status, "in-progress");
  assert.equal(review.history.length, 1);
  assert.equal(review.history[0].blockerReason, "browser-unavailable");
  assert.equal(review.results[0].revision, 2);
});

test("replays the exact retained browser issue after deployment without creating a new finding", () => {
  const verification = {
    browserReplay: {
      required: true,
      baseline: {
        findingId: "browser:responsive-reflow:01",
        title: "Primary action clips at narrow widths",
        category: "Accessibility",
        focusArea: "accessibility",
        selector: "button.primary-action",
        evidence: "The right edge of the primary action is clipped at the mobile viewport.",
        repair: "Allow the action row to wrap within the viewport.",
        source: {
          provider: "Frontmend browser review",
          auditId: "responsive-reflow:01",
          strategy: "mobile",
        },
        browserReviewEvidence: {
          reviewId: "baseline-review",
          checkId: "responsive-reflow",
          checkLabel: "Responsive reflow",
          provenance: "agent-reported-browser",
          reportedAt: 5,
        },
      },
    },
  };
  let review = createBrowserVerificationReview({
    auditId: AUDIT_ID,
    verification,
    target: "https://example.com/",
    now: 10,
  });
  assert.equal(review.purpose, "verification");
  assert.equal(review.state.nextCheck.id, "fresh-browser-replay");
  assert.equal(review.state.nextCheck.viewport, "mobile");
  assert.match(review.state.nextCheck.instruction, /right edge.*clipped/i);

  review = recordBrowserReviewCheck(review, {
    checkId: "fresh-browser-replay",
    outcome: "issue",
    summary: "The same primary action remains clipped.",
    observations: ["The right edge remains outside the mobile viewport."],
  }, "agent", 20);
  assert.equal(review.state.status, "complete");
  assert.equal(review.state.issueCount, 1);
  assert.equal(review.results[0].findings.length, 0);
  assert.equal(review.verificationBaseline.findingId, "browser:responsive-reflow:01");
});

test("keeps a blocked verification replay resumable until the exact comparison passes", () => {
  const verification = {
    browserReplay: {
      required: true,
      baseline: {
        findingId: "browser:search-discovery:01",
        title: "Guide has no discovery path",
        category: "SEO",
        focusArea: "seo",
        selector: "header nav",
        evidence: "No same-site guide link was visible.",
        repair: "Add a crawlable guide link.",
        source: {
          provider: "Frontmend browser review",
          auditId: "search-discovery:01",
          strategy: "desktop",
        },
        browserReviewEvidence: {
          reviewId: "baseline-review",
          checkId: "search-discovery",
          checkLabel: "Search discovery path",
          reportedAt: 5,
        },
      },
    },
  };
  let review = createBrowserVerificationReview({ auditId: AUDIT_ID, verification, target: "https://example.com/", now: 10 });
  review = recordBrowserReviewCheck(review, {
    checkId: "fresh-browser-replay",
    outcome: "blocked",
    summary: "The retained target now requires authentication.",
    blockerReason: "authentication-required",
  }, "agent", 20);
  assert.equal(review.state.status, "blocked");
  assert.equal(review.state.nextCheck.id, "fresh-browser-replay");

  review = recordBrowserReviewCheck(review, {
    checkId: "fresh-browser-replay",
    outcome: "passed",
    summary: "The public page is reachable and now exposes the guide link.",
    observations: ["The rendered primary navigation contains a crawlable Guide link."],
  }, "agent", 30);
  assert.equal(review.state.status, "complete");
  assert.equal(review.history[0].blockerReason, "authentication-required");
  assert.equal(review.results[0].revision, 2);
});

test("rejects skipped checks and unsupported outcome payloads", () => {
  const review = createBrowserReviewMission({
    auditId: AUDIT_ID,
    mission,
    target: "https://example.com/",
    now: 10,
  });
  assert.throws(
    () => recordBrowserReviewCheck(review, {
      checkId: "primary-journey",
      outcome: "passed",
      summary: "Skipped the current check.",
      observations: ["A fact."],
    }),
    (error) => error.code === "BROWSER_REVIEW_SEQUENCE",
  );
  assert.throws(
    () => recordBrowserReviewCheck(review, {
      checkId: "rendered-structure",
      outcome: "issue",
      summary: "An issue without a structured finding.",
      observations: ["A fact."],
    }),
    (error) => error.code === "INVALID_BROWSER_REVIEW",
  );
});
