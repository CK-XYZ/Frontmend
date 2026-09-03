import assert from "node:assert/strict";
import test from "node:test";
import {
  candidateBrowserTarget,
  candidateCorrectionPacket,
  candidateReviewSnapshot,
  candidateReviewStatus,
  normalizeCandidateOrigin,
  openCandidateReview,
  recordCandidateReviewCheck,
} from "../src/candidate-review-contract.js";
import { recordRepositoryImplementation } from "../src/repair-contract.js";

const AUDIT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REPAIR_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function approvedRepair(overrides = {}) {
  return {
    id: REPAIR_ID,
    auditId: AUDIT_ID,
    revision: 2,
    status: "approved",
    implementationReceipt: {
      revision: 1,
      summary: "Implemented the reviewed repair.",
      files: ["src/page.css"],
      checks: [{ name: "bun test", status: "passed" }],
      commitSha: null,
      source: "agent",
      agentReported: true,
      sourceChangedByFrontmend: false,
      reportedAt: 100,
    },
    implementationHistory: [],
    candidateReview: null,
    candidateReviewHistory: [],
    deploymentAttestedAt: null,
    findingId: "contrast",
    findingTitle: "Text contrast is too low",
    findingSource: { provider: "Lighthouse", auditId: "color-contrast", strategy: "mobile" },
    findingScope: { focusAreas: ["accessibility"] },
    findingPackage: {
      schemaVersion: 1,
      primaryFindingId: "contrast",
      items: [
        {
          findingId: "contrast",
          title: "Text contrast is too low",
          category: "Accessibility",
          source: { provider: "Lighthouse", auditId: "color-contrast", strategy: "mobile" },
          scope: { focusAreas: ["accessibility"] },
          retainedSymptom: {
            focusAreas: ["accessibility"],
            selector: ".muted-copy",
            measured: "Foreground and background colours measured below the retained threshold.",
          },
        },
        {
          findingId: "console",
          title: "Errors occurred during page load",
          category: "Reliability",
          source: { provider: "Lighthouse", auditId: "errors-in-console", strategy: "desktop" },
          scope: { focusAreas: ["reliability"] },
          retainedSymptom: {
            focusAreas: ["reliability"],
            selector: "window console",
            measured: "The retained load emitted a ReferenceError.",
          },
        },
      ],
    },
    verificationImpact: {
      matrix: {
        rows: [
          { findingId: "contrast", findingIds: ["contrast"], proofKind: "provider-rule", path: "/settings" },
          { findingId: "console", findingIds: ["console"], proofKind: "provider-rule", path: "/" },
          {
            proofKind: "browser-guardrail",
            path: "/settings",
            source: { auditId: "responsive-reflow" },
            baseline: {
              checkId: "responsive-reflow",
              label: "Responsive reflow",
              focusArea: "accessibility",
              viewport: "mobile",
              summary: "Controls remained reachable at a narrow viewport.",
            },
          },
        ],
      },
      targets: [{ root: true, path: "/" }],
    },
    updatedAt: 100,
    ...overrides,
  };
}

test("accepts loopback HTTP/HTTPS and public HTTPS candidate origins", () => {
  assert.equal(normalizeCandidateOrigin("http://localhost:5173"), "http://localhost:5173");
  assert.equal(normalizeCandidateOrigin("https://127.0.0.1:8443/"), "https://127.0.0.1:8443");
  assert.equal(normalizeCandidateOrigin("http://[::1]:4173"), "http://[::1]:4173");
  assert.equal(normalizeCandidateOrigin("https://preview.example.com:8443"), "https://preview.example.com:8443");
  assert.equal(normalizeCandidateOrigin("https://[2606:4700:4700::1111]"), "https://[2606:4700:4700::1111]");
});

test("rejects credentials, paths, query, fragment, unsafe schemes, public HTTP, and private targets", () => {
  const values = [
    "https://person:secret@example.com",
    "https://example.com/preview",
    "https://example.com/?token=secret",
    "https://example.com/#candidate",
    "ftp://example.com",
    "http://example.com",
    "https://10.0.0.1",
    "https://192.168.1.2",
    "https://169.254.169.254",
    "https://198.51.100.8",
    "https://203.0.113.8",
    "https://[2001:db8::1]",
    "https://devbox",
    "https://preview.local",
    "https://preview.localhost",
    "https://example.com:",
  ];
  for (const value of values) {
    assert.throws(() => normalizeCandidateOrigin(value), { code: "INVALID_CANDIDATE_ORIGIN" }, value);
  }
});

test("requires an approved repair and a latest all-passing implementation receipt", () => {
  assert.throws(
    () => openCandidateReview(approvedRepair({ status: "draft" }), { candidateOrigin: "http://localhost:5173" }),
    { code: "REPAIR_NOT_APPROVED" },
  );
  assert.throws(
    () => openCandidateReview(approvedRepair({ implementationReceipt: null }), { candidateOrigin: "http://localhost:5173" }),
    { code: "IMPLEMENTATION_CHECKS_REQUIRED" },
  );
  assert.throws(
    () => openCandidateReview(approvedRepair({
      implementationReceipt: {
        ...approvedRepair().implementationReceipt,
        checks: [{ name: "bun test", status: "failed" }],
      },
    }), { candidateOrigin: "http://localhost:5173" }),
    { code: "IMPLEMENTATION_CHECKS_REQUIRED" },
  );
});

test("compiles exact finding replays before retained guardrails with dynamic capabilities", () => {
  const repair = openCandidateReview(
    approvedRepair(),
    { candidateOrigin: "http://localhost:5173" },
    "agent",
    200,
  );
  const review = candidateReviewSnapshot(repair.candidateReview, repair.candidateReviewHistory);
  assert.equal(review.purpose, "candidate");
  assert.equal(review.repairRevision, 2);
  assert.equal(review.implementationReceiptRevision, 1);
  assert.deepEqual(review.tasks.map((task) => task.kind), [
    "candidate-replay",
    "candidate-replay",
    "candidate-guardrail",
  ]);
  assert.equal(review.tasks[0].target.path, "/settings");
  assert.equal(review.tasks[0].target.candidateUrl, "http://localhost:5173/settings");
  assert.deepEqual(review.tasks[0].requiredCapabilities, ["visual-browser-access", "responsive-emulation"]);
  assert.deepEqual(review.tasks[1].requiredCapabilities, ["visual-browser-access", "runtime-diagnostics"]);
  assert.equal(candidateBrowserTarget(review, review.nextTask), "http://localhost:5173/settings");
  assert.match(review.evidenceBoundary, /not a provider audit/i);
});

test("candidate routes cannot replace the reviewed origin", () => {
  const review = openCandidateReview(approvedRepair({
    verificationImpact: {
      matrix: { rows: [{ findingId: "contrast", proofKind: "provider-rule", path: "//attacker.example/path" }] },
      targets: [{ root: true, path: "//attacker.example/path" }],
    },
  }), { candidateOrigin: "http://localhost:5173" }, "agent", 200).candidateReview;
  assert.equal(review.tasks[0].target.path, "/");
  assert.equal(review.tasks[0].target.candidateUrl, "http://localhost:5173/");
});

test("the candidate origin stays locked for one implementation revision", () => {
  const repair = openCandidateReview(
    approvedRepair(),
    { candidateOrigin: "http://localhost:5173" },
    "agent",
    200,
  );
  assert.throws(
    () => openCandidateReview(repair, { candidateOrigin: "http://localhost:4173" }, "agent", 210),
    { code: "CANDIDATE_REVIEW_EXISTS" },
  );
});

test("records only the current sequential check and permits blocked-check recovery", () => {
  let repair = openCandidateReview(approvedRepair(), { candidateOrigin: "http://localhost:5173" }, "person", 200);
  const reviewId = repair.candidateReview.id;
  assert.throws(
    () => recordCandidateReviewCheck(repair, reviewId, {
      checkId: "candidate-replay-2",
      outcome: "passed",
      summary: "The console stayed clear.",
      observations: ["No retained error appeared."],
    }, "person", 210),
    { code: "BROWSER_REVIEW_SEQUENCE" },
  );
  repair = recordCandidateReviewCheck(repair, reviewId, {
    checkId: "candidate-replay-1",
    outcome: "blocked",
    summary: "Responsive emulation was unavailable.",
    blockerReason: "unsupported-capability",
  }, "person", 220);
  assert.equal(candidateReviewStatus(repair.candidateReview), "blocked");
  repair = recordCandidateReviewCheck(repair, reviewId, {
    checkId: "candidate-replay-1",
    outcome: "passed",
    summary: "The retained contrast symptom was not visible.",
    observations: ["The muted copy remained readable at the retained mobile viewport."],
  }, "agent", 230);
  assert.equal(candidateReviewStatus(repair.candidateReview), "in-progress");
  assert.equal(repair.candidateReview.results[0].source, "agent");
  assert.equal(repair.candidateReview.history[0].source, "person");
});

test("candidate issues remain attributed observations and cannot create findings or production evidence", () => {
  let repair = openCandidateReview(approvedRepair(), { candidateOrigin: "https://preview.example.com" }, "agent", 200);
  const reviewId = repair.candidateReview.id;
  assert.throws(
    () => recordCandidateReviewCheck(repair, reviewId, {
      checkId: "candidate-replay-1",
      outcome: "issue",
      summary: "The retained symptom remains.",
      observations: ["The muted copy is still difficult to read."],
      findings: [{
        title: "New issue",
        severity: "medium",
        focusArea: "accessibility",
        evidence: "Should not be accepted.",
        suggestedRepair: "Should not be accepted.",
      }],
    }),
    { code: "INVALID_BROWSER_REVIEW" },
  );
  repair = recordCandidateReviewCheck(repair, reviewId, {
    checkId: "candidate-replay-1",
    outcome: "issue",
    summary: "The retained symptom remains.",
    observations: ["The muted copy is still difficult to read."],
  }, "agent", 210);
  assert.equal(repair.candidateReview.findings.length, 0);
  assert.equal(repair.deploymentAttestedAt, null);
  assert.equal(repair.verificationRun, undefined);
});

test("the first candidate issue stops the iteration and compiles an exact correction packet", () => {
  let repair = openCandidateReview(
    approvedRepair({
      repositoryPlan: {
        files: ["src/page.css", "tests/page.test.mjs"],
        checks: ["bun test", "bun run build"],
        source: "agent",
      },
    }),
    { candidateOrigin: "http://localhost:5173" },
    "agent",
    200,
  );
  const reviewId = repair.candidateReview.id;
  repair = recordCandidateReviewCheck(repair, reviewId, {
    checkId: "candidate-replay-1",
    outcome: "issue",
    summary: "The candidate still renders the muted copy below the retained contrast expectation.",
    observations: ["The .muted-copy element remains difficult to distinguish at the mobile viewport."],
  }, "agent", 210);

  const review = candidateReviewSnapshot(repair.candidateReview, repair.candidateReviewHistory);
  const packet = candidateCorrectionPacket(repair);
  assert.equal(review.status, "issues-found");
  assert.equal(review.correctionRequired, true);
  assert.equal(review.nextTask, null);
  assert.equal(review.browserTargetUrl, null);
  assert.equal(review.state.completedCheckCount, 1);
  assert.equal(review.state.requestedCheckCount, 3);
  assert.equal(packet.revisionBinding.candidateReviewId, reviewId);
  assert.equal(packet.issues[0].browserTargetUrl, "http://localhost:5173/settings");
  assert.equal(packet.issues[0].target.selectorOrLandmark, ".muted-copy");
  assert.deepEqual(packet.approvedRepositoryScope.files, ["src/page.css", "tests/page.test.mjs"]);
  assert.deepEqual(packet.approvedRepositoryScope.checks, ["bun test", "bun run build"]);
  assert.equal(packet.nextAction.tool, "record_repository_implementation");
  assert.match(packet.evidenceBoundary, /not source inspection/i);
  assert.throws(
    () => recordCandidateReviewCheck(repair, reviewId, {
      checkId: "candidate-replay-2",
      outcome: "passed",
      summary: "The console stayed clear.",
      observations: ["No retained error appeared."],
    }, "agent", 220),
    { code: "CANDIDATE_CORRECTION_REQUIRED" },
  );
});

test("reopening an identical tuple is idempotent and a new implementation archives the review", () => {
  let repair = openCandidateReview(approvedRepair(), { candidateOrigin: "http://localhost:5173" }, "agent", 200);
  const id = repair.candidateReview.id;
  const reopened = openCandidateReview(repair, { candidateOrigin: "http://localhost:5173/" }, "agent", 220);
  assert.equal(reopened, repair);
  assert.equal(reopened.candidateReview.id, id);

  repair = recordRepositoryImplementation(repair, {
    summary: "Corrected the candidate issue and reran checks.",
    files: ["src/page.css"],
    checks: [{ name: "bun test", status: "passed" }],
  }, 300);
  assert.equal(repair.implementationReceipt.revision, 2);
  assert.equal(repair.candidateReview, null);
  assert.equal(repair.candidateReviewHistory.length, 1);
  const next = openCandidateReview(repair, { candidateOrigin: "http://localhost:5173" }, "agent", 310);
  assert.notEqual(next.candidateReview.id, id);
  assert.equal(next.candidateReview.implementationReceiptRevision, 2);
  assert.equal(candidateReviewSnapshot(next.candidateReview, next.candidateReviewHistory).historySummary[0].id, id);
});
