import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const reportSource = await readFile(
  new URL("../src/workspaces/ReportWorkspace.jsx", import.meta.url),
  "utf8",
);
const overviewSource = await readFile(
  new URL("../src/ui/EvidenceOverview.jsx", import.meta.url),
  "utf8",
);
const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

test("puts mission status ahead of coverage, sources, measured score, and the priority queue", () => {
  const missionIndex = reportSource.indexOf("<AuditMissionSummary");
  const evidenceIndex = reportSource.indexOf("<EvidenceOverview");
  const detailedMetricsIndex = reportSource.indexOf('<div className="summary-row"');
  const findingsIndex = reportSource.indexOf('<div className="workspace-grid"');

  assert.equal(missionIndex > 0, true);
  assert.equal(missionIndex < evidenceIndex, true);
  assert.equal(evidenceIndex < detailedMetricsIndex, true);
  assert.equal(detailedMetricsIndex < findingsIndex, true);
  assert.match(overviewSource, />Requested coverage</);
  assert.match(overviewSource, />Evidence sources</);
  assert.match(overviewSource, />Measured score</);
  assert.match(overviewSource, />Priority queue</);
  assert.match(overviewSource, /Supporting signal, not mission completion/);
  assert.doesNotMatch(reportSource, /score-card|>Health<|Audit complete/);
});

test("keeps repair packaging behind diagnosis readiness", () => {
  assert.match(reportSource, /repairReadyPriorities = missionState\.priorities\.filter/);
  assert.match(reportSource, /selectedDiagnosticReady \|\| selectedRepairPrepared/);
  assert.match(reportSource, /priorities=\{repairReadyPriorities\}/);
  assert.match(reportSource, /Repair controls unlock only after/);
  assert.match(reportSource, /repairReadyPriorities\.length \|\| preparedFindingIds\.length \|\| repairs\.length/);
});

test("keeps the evidence hierarchy operable at the 620 px workspace breakpoint", () => {
  const mobile = styles.slice(styles.indexOf("@media (max-width: 620px)", styles.indexOf("@media (max-width: 820px)")));
  assert.match(mobile, /\.evidence-overview-grid\s*\{\s*grid-template-columns: 1fr;/);
  assert.match(mobile, /\.evidence-overview-failures li\s*\{\s*grid-template-columns: 1fr max-content;/);
  assert.doesNotMatch(styles, /\.score-card/);
});
