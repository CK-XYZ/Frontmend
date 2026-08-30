import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const lazyBoundary = readFileSync(new URL("../src/ui/LazyWorkspace.jsx", import.meta.url), "utf8");
const report = readFileSync(new URL("../src/workspaces/ReportWorkspace.jsx", import.meta.url), "utf8");
const diagnosis = readFileSync(new URL("../src/workspaces/DiagnosisWorkspace.jsx", import.meta.url), "utf8");
const repair = readFileSync(new URL("../src/workspaces/RepairWorkspace.jsx", import.meta.url), "utf8");
const repairPolicy = readFileSync(new URL("../src/workspaces/RepairPolicyWorkspace.jsx", import.meta.url), "utf8");
const verification = readFileSync(new URL("../src/workspaces/VerificationWorkspace.jsx", import.meta.url), "utf8");
const inspector = readFileSync(new URL("../src/workspaces/WebMcpCapabilitySheet.jsx", import.meta.url), "utf8");

test("keeps URL intake and active audit progress synchronous while deferring completed workspaces", () => {
  assert.match(app, /function Landing\(/);
  assert.match(app, /function AuditProgress\(/);
  assert.match(app, /function RestoringAudit\(/);
  assert.match(app, /import\("\.\/workspaces\/ReportWorkspace\.jsx"\)/);
  assert.match(app, /import\("\.\/workspaces\/WebMcpCapabilitySheet\.jsx"\)/);
  assert.doesNotMatch(app, /function ReportWorkspace\(/);
  assert.doesNotMatch(app, /function DiagnosticMissionCard\(/);
  assert.doesNotMatch(app, /function RepairWorkbench\(/);
  assert.doesNotMatch(app, /function VerificationBanner\(/);
  assert.doesNotMatch(app, /function WebMcpCapabilitySheet\(/);

  assert.match(report, /import\("\.\/DiagnosisWorkspace\.jsx"\)/);
  assert.match(report, /import\("\.\/RepairPolicyWorkspace\.jsx"\)/);
  assert.match(report, /import\("\.\/RepairWorkspace\.jsx"\)/);
  assert.match(report, /import\("\.\/VerificationWorkspace\.jsx"\)/);
  assert.match(diagnosis, /export default function DiagnosisWorkspace/);
  assert.match(repair, /export default function RepairWorkspace/);
  assert.match(verification, /export default function VerificationWorkspace/);
  assert.match(inspector, /export default function WebMcpCapabilitySheet/);
});

test("provides accessible loading, failure, and fresh-component retry boundaries", () => {
  assert.match(lazyBoundary, /lazy\(load\)/);
  assert.match(lazyBoundary, /<Suspense fallback=\{loading\}>/);
  assert.match(lazyBoundary, /static getDerivedStateFromError/);
  assert.match(lazyBoundary, /role="status"/);
  assert.match(lazyBoundary, /role="alert"/);
  assert.match(lazyBoundary, /role="dialog"/);
  assert.match(lazyBoundary, /aria-modal="true"/);
  assert.match(lazyBoundary, /Try loading again/);
  assert.match(lazyBoundary, /setLoadAttempt\(\(attempt\) => attempt \+ 1\)/);
  assert.match(lazyBoundary, /\[load, loadAttempt, resetKey\]/);
  assert.match(lazyBoundary, /const boundaryKey = `\$\{resetKey\}:\$\{loadAttempt\}`/);
  assert.match(lazyBoundary, /current audit and mission state remain retained/);
  assert.match(lazyBoundary, /retained audit was not restarted or changed/);
  assert.doesNotMatch(lazyBoundary, /startAudit|cancelAudit|stageRepair|approveRepair|startVerification|location\.reload/);
});

test("restores the stable audit before mounting deferred UI and keeps retries presentation-only", () => {
  assert.match(app, /useState\(\(\) => auditService\.getActiveAudit\(\)\)/);
  assert.match(app, /auditIdFromPathname\(window\.location\.pathname\)/);
  assert.match(app, /auditService\s*\.restoreAuditWorkspace\(restorationAuditId\)/);
  assert.match(app, /\[restorationAuditId, restorationAttempt\]/);
  assert.match(app, /if \(restorationAuditId\) return "restore"/);
  assert.match(app, /mode === "report"[\s\S]*load=\{loadReportWorkspace\}/);
  assert.match(app, /resetKey=\{`\$\{audit\.id\}:\$\{audit\.missionRevision \?\? 1\}`\}/);
  assert.match(app, /componentProps=\{\{[\s\S]*audit,[\s\S]*webMcp,[\s\S]*onReset: reset/);
  assert.match(report, /resetKey=\{`\$\{report\.auditId\}:diagnosis:/);
  assert.match(report, /resetKey=\{`\$\{report\.auditId\}:repair:/);
  assert.match(report, /resetKey=\{`\$\{report\.auditId\}:verification:/);
});

test("retains complete Human mode and the twenty-one contextual WebMCP contracts", () => {
  assert.match(app, /const WEBMCP_TOOL_COUNT = 21/);
  assert.match(app, /contextualFrontmendToolNames\(auditService\)/);
  assert.match(app, /registerFrontmendTools\(/);
  assert.match(report, /function HumanBrowserReviewForm\(/);
  assert.match(diagnosis, /function HumanDiagnosticContribution\(/);
  assert.match(repairPolicy, /function RepairPolicyControl\(/);
  assert.match(inspector, /createFrontmendTools\(auditService\)/);
  assert.match(inspector, /createMissionInspector\(/);
});
