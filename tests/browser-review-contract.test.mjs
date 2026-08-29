import test from "node:test";
import assert from "node:assert/strict";
import {
  browserReviewChecksForMission,
  browserReviewFindings,
  browserReviewRequired,
  createBrowserReviewMission,
  recordBrowserReviewCheck,
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
  assert.equal(review.authority.provenance, "agent-reported-browser");
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
