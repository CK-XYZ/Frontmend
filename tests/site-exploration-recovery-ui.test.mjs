import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const report = readFileSync(new URL("../src/workspaces/ReportWorkspace.jsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

function explorationSource() {
  const match = report.match(
    /function SiteExploration\(\{ report, mission \}\) \{[\s\S]*?\n\}\n\nexport default function ReportWorkspace/,
  );
  assert.ok(match, "expected the site exploration workspace");
  return match[0];
}

function pollingEffectSource(source) {
  const match = source.match(
    /useEffect\(\(\) => \{[\s\S]*?\}, \[pollAttempt, report\.auditId\]\);/,
  );
  assert.ok(match, "expected the exploration polling effect");
  return match[0];
}

test("retains the last authoritative exploration when a status read is interrupted", () => {
  const source = explorationSource();
  const polling = pollingEffectSource(source);
  const catchBlock = polling.match(/\} catch \(cause\) \{[\s\S]*?\} finally \{/i)?.[0] ?? "";

  assert.match(polling, /listSiteExplorations\(report\.auditId\)/);
  assert.match(polling, /getSiteExploration\(report\.auditId, mission\.id\)/);
  assert.match(catchBlock, /setReadError\(/);
  assert.match(catchBlock, /setTimeout\(poll, 3_000\)/);
  assert.doesNotMatch(catchBlock, /setExplorations|startSiteExploration|cancelAudit|status:\s*"failed"/);
  assert.match(source, /The last confirmed mission remains visible and has not been marked failed/);
  assert.match(source, /No mission was created or marked failed by this read error/);
});

test("offers an accessible read-only exploration retry that remains usable at 390 px", () => {
  const source = explorationSource();
  const retry = source.match(/const retryStatus = \(\) => \{[\s\S]*?\n  \};/)?.[0] ?? "";

  assert.match(retry, /setPollAttempt\(\(attempt\) => attempt \+ 1\)/);
  assert.doesNotMatch(retry, /auditService|startSiteExploration|cancelAudit/);
  assert.match(source, /className="site-exploration-read-warning" role="alert"/);
  assert.match(source, /Retry status now only reads the retained exploration/);
  assert.match(styles, /\.site-exploration-read-warning\s*\{[\s\S]*grid-template-columns: auto minmax\(0, 1fr\) auto/);
  assert.match(styles, /\.site-exploration-read-warning button\s*\{[\s\S]*min-height: 44px/);
  assert.match(styles, /@media \(max-width: 620px\)[\s\S]*\.site-exploration-read-warning\s*\{[\s\S]*grid-template-columns: auto minmax\(0, 1fr\)/);
});
