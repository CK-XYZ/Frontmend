import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const report = readFileSync(new URL("../src/workspaces/ReportWorkspace.jsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

test("copies a fresh-agent handoff from the current bounded checkpoint", () => {
  assert.match(report, /auditService\.getMissionCheckpoint\(report\.auditId\)/);
  assert.match(report, /createFreshAgentHandoff\(missionCheckpoint, window\.location\.origin\)/);
  assert.match(report, /navigator\.clipboard\.writeText\(agentHandoff\.prompt\)/);
  assert.match(report, /Copy agent handoff/);
  assert.match(report, /Handoff copied/);
  assert.doesNotMatch(report, /navigator\.clipboard\.writeText\(missionCheckpoint\.action/);
});

test("keeps the handoff usable without clipboard access at narrow widths", () => {
  assert.match(report, /id="manual-agent-handoff"/);
  assert.match(report, /value=\{agentHandoff\.prompt\}/);
  assert.match(report, /the receiving agent must[\s\S]*read its latest checkpoint before acting/);
  assert.match(styles, /\.manual-agent-handoff\s*\{[\s\S]*calc\(100vw - 48px\)/);
  assert.match(styles, /\.manual-agent-handoff textarea\s*\{[\s\S]*resize: vertical/);
  assert.match(styles, /@media \(max-width: 620px\)[\s\S]*\.report-nav-actions\s*\{[\s\S]*flex-wrap: wrap/);
});
