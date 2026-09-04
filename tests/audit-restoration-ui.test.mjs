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

/*
 * A missing audit is terminal: the job is deleted 24h after it finishes, or the
 * address was never issued. Retrying reads the same nothing, so the page must
 * not offer the retry - and it must not claim the note about reading "the
 * existing authoritative job", because there is no job. Locked because the
 * branch is invisible until someone opens a dead link.
 */
test("withdraws the retry when the audit itself is gone", () => {
  assert.match(app, /const RESTORE_NOT_FOUND = "AUDIT_NOT_FOUND";/);
  assert.match(app, /const gone = failed && errorCode === RESTORE_NOT_FOUND;/);
  assert.match(app, /setRestorationErrorCode\(cause instanceof AuditError \? cause\.code : ""\)/);
  // The retry, the note, and the back link are all conditional on not-gone.
  assert.match(app, /\{gone \? null : \([\s\S]{0,200}?className="retry-audit"/);
  assert.match(app, /\{gone \? null : \([\s\S]{0,200}?className="restoration-note"/);
  assert.match(app, /\{gone \? null : \([\s\S]{0,200}?className="back-button"/);
  // The retention window is the reason, and it is stated.
  assert.match(app, /keeps a finished audit for 24 hours and then deletes it/);
  assert.match(app, /Audit not found — Frontmend/);
  // Paused is not restoring: the header must stop claiming work is in flight.
  assert.match(app, /restoreFailed=\{Boolean\(restorationError\)\}/);
  assert.match(app, /\? "WebMCP · paused"/);
});

test("keeps restoration failure distinct from a cached audit until the person leaves", () => {
  assert.match(app, /if \(restorationAuditId\) return "restore"/);
  assert.match(app, /if \(restorationAuditId \|\| !audit/);
  assert.match(app, /const webMcpToolNames = restorationAuditId \? \[\] : auditHandoffFrontmendToolNames/);
  assert.match(app, /WebMcpStatus[\s\S]*restoring=\{Boolean\(restorationAuditId\)\}/);
  assert.match(app, /disabled=\{restoring\}/);
  assert.match(app, /Reading authoritative job and mission state/);
  assert.match(app, /role=\{failed \? "alert" : "status"\}/);
  assert.match(app, /Could not restore audit — Frontmend/);
  assert.match(app, /Start a new audit/);
  assert.match(app, /setRestorationAuditId\(""\)[\s\S]*window\.history\.replaceState\(null, "", "\/"\)/);
});
