import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

function pollingEffectSource() {
  const match = app.match(
    /useEffect\(\(\) => \{[\s\S]*?if \(restorationAuditId \|\| !audit[\s\S]*?\.getAudit\(audit\.id\)[\s\S]*?\}, \[audit\?\.id, audit\?\.status, restorationAuditId, pollAttempt\]\);/,
  );
  assert.ok(match, "expected the active-audit polling effect");
  return match[0];
}

test("does not turn an interrupted progress read into an authoritative failed audit", () => {
  const pollingEffect = pollingEffectSource();
  const catchBlock = pollingEffect.match(/\} catch \(cause\) \{[\s\S]*?\} finally \{/i)?.[0] ?? "";

  assert.match(catchBlock, /setPollError\(/);
  assert.match(catchBlock, /setTimeout\(poll, 3_000\)/);
  assert.doesNotMatch(catchBlock, /setAudit|status: "failed"|startAudit|cancelAudit/);
  assert.match(app, /The retained job has not been marked failed/);
  assert.match(app, /retrying[\s\S]*only reads the existing job/i);
});

test("keeps status recovery accessible, read-only, and usable at 390 px", () => {
  assert.match(app, /className="audit-poll-warning" role="alert"/);
  assert.match(app, /setPollAttempt\(\(attempt\) => attempt \+ 1\)/);
  assert.match(app, /onRetryStatus=\{retryAuditStatus\}/);
  assert.match(styles, /\.audit-poll-warning\s*\{[\s\S]*grid-template-columns: auto minmax\(0, 1fr\) auto/);
  assert.match(styles, /@media \(max-width: 620px\)[\s\S]*\.audit-poll-warning\s*\{[\s\S]*grid-template-columns: auto minmax\(0, 1fr\)/);
  assert.match(styles, /\.audit-poll-warning button\s*\{[\s\S]*min-height: 44px/);
});
