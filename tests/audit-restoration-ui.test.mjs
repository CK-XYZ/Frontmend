import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");

function restorationEffectSource() {
  const match = app.match(
    /useEffect\(\(\) => \{[\s\S]*?if \(!restorationAuditId\)[\s\S]*?\.restoreAuditWorkspace\(restorationAuditId\)[\s\S]*?\}, \[restorationAuditId, restorationAttempt\]\);/,
  );
  assert.ok(match, "expected the authoritative restoration effect");
  return match[0];
}

test("retains a failed shared-audit address and retries only its authoritative read", () => {
  const restorationEffect = restorationEffectSource();

  assert.match(app, /const \[restorationAuditId, setRestorationAuditId\] = useState/);
  assert.match(restorationEffect, /\.restoreAuditWorkspace\(restorationAuditId\)/);
  assert.match(restorationEffect, /setRestorationError\(/);
  assert.doesNotMatch(restorationEffect, /history\.replaceState|startAudit|cancelAudit/);
  assert.match(app, /setRestorationAttempt\(\(attempt\) => attempt \+ 1\)/);
  assert.match(app, /Retrying only reads the existing[\s\S]*does not restart the audit or replay a mission action/);
});

test("keeps restoration failure distinct from a cached audit until the person leaves", () => {
  assert.match(app, /if \(restorationAuditId\) return "restore"/);
  assert.match(app, /if \(restorationAuditId \|\| !audit/);
  assert.match(app, /const webMcpToolNames = restorationAuditId \? \[\] : contextualFrontmendToolNames/);
  assert.match(app, /WebMcpStatus[\s\S]*restoring=\{Boolean\(restorationAuditId\)\}/);
  assert.match(app, /disabled=\{restoring\}/);
  assert.match(app, /Reading authoritative job and mission state/);
  assert.match(app, /role=\{failed \? "alert" : "status"\}/);
  assert.match(app, /Could not restore audit — Frontmend/);
  assert.match(app, /Start a new audit/);
  assert.match(app, /setRestorationAuditId\(""\)[\s\S]*window\.history\.replaceState\(null, "", "\/"\)/);
});
