import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const browserReviewSource = async () => (await Promise.all([
  readFile(`${projectRoot}/src/workspaces/ReportWorkspace.jsx`, "utf8"),
  readFile(`${projectRoot}/src/ui/human-mission-recovery.js`, "utf8"),
])).join("\n");

test("Human mode exposes the bounded browser response contract through the shared service", async () => {
  const source = await browserReviewSource();

  assert.match(source, /\["passed", "issue", "blocked"\]/);
  assert.match(source, /maxLength=\{300\}/);
  assert.match(source, /maxLength=\{400\}/);
  assert.match(source, /Structured issue details/);
  assert.match(source, /blockerReason/);
  assert.match(source, /auditService\.recordBrowserReviewCheck\([\s\S]*?"person"/);
  assert.match(source, /auditService\.withdrawBrowserReview\(auditId, review\.id\)/);
});

test("Human mode changes takeover copy by capability and refreshes stale missions without retrying", async () => {
  const source = await browserReviewSource();

  assert.match(source, /webMcp\?\.supported === true && webMcp\?\.status === "ready"/);
  assert.match(source, /Hand off to agent/);
  assert.match(source, /Complete rendered review yourself/);
  assert.match(source, /auditService\.refreshMissionWorkspace\(auditId\)/);
  assert.match(source, /auditService\.getBrowserReview\(auditId\)/);
  assert.match(source, /review it before resubmitting/i);
});

test("the Human review workspace collapses to one column on the 390 px experience", async () => {
  const styles = await readFile(`${projectRoot}/src/styles.css`, "utf8");
  const compact = styles.slice(styles.indexOf("@media (max-width: 620px)"));

  assert.match(compact, /\.browser-review-assignment > div \{\s*grid-template-columns: 1fr;/);
  assert.match(compact, /\.human-review-finding-pair \{\s*grid-template-columns: 1fr;/);
  assert.match(compact, /\.human-review-submit > button \{\s*width: 100%;/);
});
