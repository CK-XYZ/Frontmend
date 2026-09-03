import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workspace = readFileSync(new URL("../src/workspaces/RepairWorkspace.jsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

test("Human mode uses the shared candidate-review service and preserves the production boundary", () => {
  assert.match(workspace, /auditService\.openCandidateReview\(/);
  assert.match(workspace, /auditService\.recordCandidateReviewCheck\(/);
  assert.match(workspace, /<CandidateReviewCard auditId=\{auditId\} repair=\{repair\}/);
  assert.match(workspace, /Candidate checks passed—production unverified/);
  assert.match(workspace, /Correction packet ready/);
  assert.match(workspace, /Correct this bounded issue, then record a newer implementation receipt/);
  assert.match(workspace, /Deployment remains your decision; production is unverified/);
  assert.match(workspace, /target="_blank"/);
  assert.match(workspace, /rel="noreferrer"/);
  assert.doesNotMatch(workspace, /fetch\(candidate|navigate\(candidate/i);
});

test("candidate review remains keyboard-operable and reflows at the compact breakpoint", () => {
  assert.match(workspace, /htmlFor="candidate-origin"/);
  assert.match(workspace, /id="candidate-origin"/);
  assert.match(workspace, /aria-describedby="candidate-origin-help"/);
  assert.match(workspace, /role="alert"/);
  assert.match(workspace, /headingRef\.current\?\.focus\(\)/);
  assert.match(styles, /\.candidate-review-card\s*\{/);
  assert.match(styles, /\.candidate-correction-packet\s*\{/);
  assert.match(styles, /\.candidate-review-open button,[\s\S]*?min-height: 39px;/);
  assert.match(styles, /@media \(max-width: 620px\)\s*\{[\s\S]*?\.candidate-review-open,[\s\S]*?grid-template-columns: 1fr;/);
  assert.match(styles, /\.candidate-review-card button:focus-visible/);
});
