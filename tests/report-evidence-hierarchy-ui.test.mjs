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

test("starts repair diagnosis only after explicit repair packaging intent", () => {
  assert.match(reportSource, /repairReadyPriorities = missionState\.priorities\.filter/);
  assert.match(reportSource, /selectedFinding && selectedRepairPrepared/);
  assert.match(reportSource, /selectedFinding && missionState\.assessmentComplete/);
  assert.match(reportSource, /priorities=\{repairReadyPriorities\}/);
  assert.match(reportSource, /Selecting Prepare a fix starts a separate repair phase/);
  assert.match(reportSource, /repairReadyPriorities\.length \|\| preparedFindingIds\.length \|\| repairs\.length/);
});

test("keeps the evidence hierarchy operable at the 620 px workspace breakpoint", () => {
  const mobile = styles.slice(styles.indexOf("@media (max-width: 620px)", styles.indexOf("@media (max-width: 820px)")));
  assert.match(mobile, /\.evidence-overview-grid\s*\{\s*grid-template-columns: 1fr;/);
  assert.match(mobile, /\.evidence-overview-failures li\s*\{\s*grid-template-columns: 1fr max-content;/);
  assert.doesNotMatch(styles, /\.score-card/);
});

test("presents the mission projection instead of a duplicate raw finding queue", () => {
  const priorityQueueSource = reportSource.slice(
    reportSource.indexOf('className="finding-list"'),
    reportSource.indexOf('className="preview-column"'),
  );

  assert.match(reportSource, /const displayedFindings = missionPriorityFindings/);
  assert.match(reportSource, /retainedObservationCount = Number\.isFinite\(missionState\.matchingFindingCount\)/);
  assert.match(reportSource, /retained observations grouped by rule and evidence source/);
  assert.match(reportSource, /mission \$\{displayedFindings\.length === 1 \? "priority" : "priorities"\} from/);
  assert.match(reportSource, /Recommended first/);
  assert.match(reportSource, /priority\?\.occurrenceCount/);
  assert.match(reportSource, /grouped observations/);
  assert.doesNotMatch(priorityQueueSource, /\{findings\.map\(\(finding, index\) =>/);
});

test("puts the agent continuation before raw diagnostic detail and compacts the mobile index", () => {
  const findingDetailIndex = reportSource.indexOf('<h2 id={findingDetailTitleId}>{selectedFinding.title}</h2>');
  const diagnosisIndex = reportSource.indexOf('label="repository diagnosis workspace"', findingDetailIndex);
  const measuredEvidenceIndex = reportSource.indexOf('>Inspect measured evidence<', findingDetailIndex);
  const evidenceSectionIndex = reportSource.indexOf('id="case-evidence"');
  const elevatedTakeoverIndex = reportSource.indexOf("<AgentTakeover", evidenceSectionIndex);
  const summarySectionIndex = reportSource.indexOf('id="case-summary"');

  assert.equal(findingDetailIndex > 0, true);
  assert.equal(diagnosisIndex > findingDetailIndex, true);
  assert.equal(diagnosisIndex < measuredEvidenceIndex, true);
  assert.equal(elevatedTakeoverIndex > evidenceSectionIndex, true);
  assert.equal(elevatedTakeoverIndex < summarySectionIndex, true);
  assert.match(reportSource, /className="case-file-index-toggle"/);
  assert.match(reportSource, /data-expanded=\{expanded \? "true" : "false"\}/);
  assert.match(styles, /\.case-file-index\[data-expanded="false"\] \.case-file-index-content\s*\{\s*display: none;/);
});
