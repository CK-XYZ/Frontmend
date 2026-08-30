import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const repairFile = readFileSync(new URL("../src/workspaces/RepairWorkspace.jsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const workbench = repairFile.slice(
  repairFile.indexOf("function RepairWorkbench"),
  repairFile.indexOf("export default function RepairWorkspace"),
);

function scopeEffectSource() {
  const match = workbench.match(
    /useEffect\(\(\) => \{[\s\S]*?getVerificationCandidates\(auditId, finding\.id, packageFindingIds\)[\s\S]*?\}, \[auditId, diagnosticReady, finding\?\.id, packageFindingIds\.join\("\|"\), repair, repairPrepared, scopeRefreshRevision\]\);/,
  );
  assert.ok(match, "expected the verification-scope read effect");
  return match[0];
}

test("retries verification-scope reads without retaining stale candidates", () => {
  const effect = scopeEffectSource();
  const catchBlock = effect.match(/\.catch\(\(cause\) => \{[\s\S]*?\n      \}\);/)?.[0] ?? "";

  assert.match(effect, /setVerificationScope\(null\)/);
  assert.match(effect, /setVerificationTargetIds\(\[\]\)/);
  assert.match(catchBlock, /setVerificationScopeStatus\("unavailable"\)/);
  assert.match(catchBlock, /setVerificationScopeError\(/);
  assert.match(catchBlock, /setTimeout\(\(\) => \{/);
  assert.match(catchBlock, /setScopeRefreshRevision\(\(revision\) => revision \+ 1\)/);
  assert.match(effect, /clearTimeout\(retryTimer\)/);
  assert.doesNotMatch(catchBlock, /stageRepair|setBusy|onRepairChange/);
});

test("fails closed until the exact current candidate scope is ready", () => {
  const stage = workbench.match(/const stage = async \(\) => \{[\s\S]*?\n  \};/)?.[0] ?? "";

  assert.match(stage, /verificationScopeStatus !== "ready" \|\| !verificationScope/);
  assert.match(stage, /Wait for the current verification scope before staging/);
  assert.match(workbench, /disabled=\{Boolean\(busy\) \|\| verificationScopeStatus !== "ready"\}/);
  assert.match(workbench, /className="verification-scope-warning" role="alert"/);
  assert.match(workbench, /No repair can be staged until this read succeeds/);
  assert.doesNotMatch(workbench, /Optional routes are unavailable\. Required retained evidence will still be included/);
});

test("keeps verification-scope retry read-only and operable at 390 px", () => {
  const retry = workbench.match(/const retryVerificationScope = \(\) => \{[\s\S]*?\n  \};/)?.[0] ?? "";

  assert.match(retry, /setScopeRefreshRevision\(\(revision\) => revision \+ 1\)/);
  assert.doesNotMatch(retry, /auditService|stageRepair|onRepairChange/);
  assert.match(styles, /\.verification-scope-warning\s*\{[\s\S]*grid-template-columns: auto minmax\(0, 1fr\) auto/);
  assert.match(styles, /\.verification-scope-warning button\s*\{[\s\S]*min-height: 44px/);
  assert.match(styles, /@media \(max-width: 620px\)[\s\S]*\.verification-scope-warning\s*\{[\s\S]*grid-template-columns: auto minmax\(0, 1fr\)/);
});
