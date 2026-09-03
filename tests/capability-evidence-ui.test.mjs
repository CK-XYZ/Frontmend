import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const reportWorkspace = await readFile(
  new URL("../src/workspaces/ReportWorkspace.jsx", import.meta.url),
  "utf8",
);
const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

test("visibly labels capability claims as agent-declared and not verified", () => {
  assert.match(reportWorkspace, /Agent-declared · not verified/);
  assert.match(reportWorkspace, /Self-report only/);
  assert.match(reportWorkspace, /never grants credentials, repair approval, or deployment authority/);
  assert.match(reportWorkspace, /agentCapabilityRows\(declaration\)/);
  assert.match(styles, /\.agent-capability-handshake > header > span\.declared/);
});

test("binds the visible finding selection to the no-ID evidence capsule handoff", () => {
  assert.match(reportWorkspace, /auditService\.setActiveEvidenceFinding\(report\.auditId, finding\.id\)/);
  assert.match(reportWorkspace, /get_active_evidence_capsule/);
  assert.match(reportWorkspace, /Priority \{capsule\.priorityRank\} · revision-bound/);
  assert.match(reportWorkspace, /Retained Lighthouse capture/);
  assert.match(reportWorkspace, /Exact observation task/);
});

test("reflows the handshake and capsule at narrow workspace widths", () => {
  assert.match(styles, /@media \(max-width: 860px\)[\s\S]*?\.agent-capability-handshake ul\s*\{[\s\S]*?grid-template-columns: repeat\(2/);
  assert.match(styles, /@media \(max-width: 860px\)[\s\S]*?\.evidence-capsule-grid\s*\{[\s\S]*?grid-template-columns: 1fr/);
  assert.match(styles, /@media \(max-width: 620px\)[\s\S]*?\.agent-capability-handshake ul\s*\{[\s\S]*?grid-template-columns: 1fr/);
  assert.match(styles, /\.evidence-capsule-record code,[\s\S]*?overflow-wrap: anywhere/);
});
