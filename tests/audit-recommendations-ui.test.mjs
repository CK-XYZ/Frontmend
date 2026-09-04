import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workspace = await readFile(
  new URL("../src/workspaces/AuditRecommendationsWorkspace.jsx", import.meta.url),
  "utf8",
);
const report = await readFile(
  new URL("../src/workspaces/ReportWorkspace.jsx", import.meta.url),
  "utf8",
);
const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
const webmcp = await readFile(new URL("../src/webmcp.js", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

test("mounts the concise recommendations workspace as the completed audit experience", () => {
  assert.match(report, /return <AuditRecommendationsWorkspace \{\.\.\.props\} \/>/);
  assert.match(workspace, /The useful bit/);
  assert.match(workspace, /Recommended change/);
  assert.match(workspace, /Done when/);
  assert.match(workspace, /Exact audit evidence/);
  assert.match(workspace, /Copy coding-agent brief/);
  assert.match(workspace, /Frontmend does not sit in the middle of that work/);
  assert.doesNotMatch(workspace, /Approve|Reject|Prepare a fix|RepairWorkspace|deployment attestation/i);
});

test("keeps the human list and WebMCP handoff on the same brief contract", () => {
  assert.match(workspace, /createCodingAgentBrief/);
  assert.match(workspace, /codingAgentBriefText/);
  assert.match(webmcp, /createCodingAgentBrief/);
  assert.match(webmcp, /codingAgentBrief/);
  assert.match(webmcp, /workflowBoundary: "Frontmend audits and explains the public site/);
  assert.match(app, /auditHandoffFrontmendToolNames\(auditService\)/);
});

test("the result is a single responsive editorial list rather than a split dashboard", () => {
  assert.match(workspace, /className="recommendations-list"/);
  assert.match(styles, /\.audit-recommendation\s*\{[\s\S]*grid-template-columns: 64px minmax\(0, 1fr\)/);
  assert.match(styles, /@media \(max-width: 620px\)[\s\S]*\.audit-recommendation\s*\{[\s\S]*grid-template-columns: 1fr/);
  assert.match(styles, /\.coding-agent-handoff > button\s*\{[\s\S]*min-height: 48px/);
  assert.doesNotMatch(workspace, /selectedFinding|inspector|split-pane|checkbox/i);
});
