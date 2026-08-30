import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const reportFile = readFileSync(new URL("../src/workspaces/ReportWorkspace.jsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const report = reportFile.slice(reportFile.indexOf("export default function ReportWorkspace"));

function refreshEffectSource() {
  const match = report.match(
    /useEffect\(\(\) => \{[\s\S]*?refreshMissionWorkspace\(report\.auditId,[\s\S]*?\}, \[report\.auditId, workspaceRefreshAttempt\]\);/,
  );
  assert.ok(match, "expected the coherent report workspace refresh effect");
  return match[0];
}

test("refreshes completed mission details as one complete-only snapshot", () => {
  const effect = refreshEffectSource();
  const catchBlock = effect.match(/\} catch \(cause\) \{[\s\S]*?\} finally \{/i)?.[0] ?? "";

  assert.match(effect, /publishOnlyWhenComplete: true/);
  assert.match(effect, /result\.published !== true/);
  assert.match(effect, /setWorkspaceUnavailable\(result\.unavailable \?\? \[\]\)/);
  assert.match(effect, /setTimeout\(readWorkspace, 3_000\)/);
  assert.match(effect, /clearTimeout\(retryTimer\)/);
  assert.doesNotMatch(effect, /listRepairs\(|listDiagnosticMissions\(|loadBrowserReview\(/);
  assert.match(catchBlock, /setWorkspaceReadError\(/);
  assert.doesNotMatch(catchBlock, /setRepairs|setDiagnosticMissions|setBrowserReview|stageRepair|openBrowserReview/);
});

test("keeps report refresh recovery accessible, read-only, and narrow-screen safe", () => {
  const retry = report.match(/const retryMissionWorkspace = \(\) => \{[\s\S]*?\n  \};/)?.[0] ?? "";

  assert.match(retry, /setWorkspaceRefreshAttempt\(\(attempt\) => attempt \+ 1\)/);
  assert.doesNotMatch(retry, /auditService|stageRepair|openBrowserReview|startSiteExploration/);
  assert.match(report, /className="mission-workspace-read-warning" role="alert"/);
  assert.match(report, /The last coherent mission remains visible/);
  assert.match(report, /never replays an action/);
  assert.match(styles, /\.mission-workspace-read-warning\s*\{[\s\S]*grid-template-columns: auto minmax\(0, 1fr\) auto/);
  assert.match(styles, /\.mission-workspace-read-warning button\s*\{[\s\S]*min-height: 44px/);
  assert.match(styles, /@media \(max-width: 620px\)[\s\S]*\.mission-workspace-read-warning\s*\{[\s\S]*grid-template-columns: auto minmax\(0, 1fr\)/);
});
