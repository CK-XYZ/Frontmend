import assert from "node:assert/strict";
import test from "node:test";
import {
  assessmentReceiptMarkdown,
  createAssessmentReceipt,
} from "../src/assessment-receipt.js";
import { createAuditMission } from "../src/audit-mission-contract.js";
import {
  createDiagnosticMission,
  recordDiagnosticBlocker,
  submitDiagnosticEvidence,
} from "../src/diagnostic-contract.js";

const finding = {
  id: "mobile-errors-in-console",
  title: "The page reports browser errors",
  severity: "high",
  category: "reliability",
  focusAreas: ["accessibility"],
  evidence: "Lighthouse observed a first-party console error during the mobile load.",
  repair: "Reproduce and map the failing runtime owner before proposing a repair.",
  source: { provider: "Lighthouse", auditId: "errors-in-console", strategy: "mobile" },
  diagnosticEvidence: {
    kind: "console-errors",
    provenance: "measured-lighthouse",
    completeness: "actionable",
    entries: [{ description: "ReferenceError", sourceUrl: "https://example.com/app.js" }],
    missing: [],
    caveat: "Audited load only.",
  },
};

const report = {
  auditId: "audit-1",
  url: "https://example.com/",
  finalUrl: "https://example.com/",
  completedAt: 1_000,
  engine: {
    mode: "live-lighthouse",
    provider: "PageSpeed Insights / Lighthouse",
    lighthouseVersion: "13.0.1",
  },
  findings: [finding],
  viewports: [{ scores: { accessibility: 91 } }],
};

const mission = createAuditMission({ focusAreas: ["accessibility"], maxPriorities: 3 }, "agent", 100);

test("withholds an assessment receipt until required diagnosis is contributed", () => {
  assert.throws(
    () => createAssessmentReceipt({ report, mission }),
    (error) => error?.code === "ASSESSMENT_INCOMPLETE" && /open_diagnostic_mission/.test(error.message),
  );

  const opened = createDiagnosticMission({ auditId: report.auditId, finding, now: 200 });
  assert.throws(
    () => createAssessmentReceipt({ report, mission, diagnosticMissions: [opened] }),
    (error) => error?.code === "ASSESSMENT_INCOMPLETE" && /submit_runtime_diagnosis/.test(error.message),
  );
});

test("withholds an assessment receipt when diagnosis is explicitly blocked", () => {
  const opened = createDiagnosticMission({ auditId: report.auditId, finding, now: 200 });
  const blocked = recordDiagnosticBlocker(opened, {
    reason: "browser-unavailable",
    summary: "This session cannot open the deployed route in a browser.",
  }, "agent", 250);

  assert.throws(
    () => createAssessmentReceipt({ report, mission, diagnosticMissions: [blocked] }),
    (error) => error?.code === "ASSESSMENT_INCOMPLETE" && /outstanding diagnostic evidence/.test(error.message),
  );
});

test("exports measured and contributed evidence with separate provenance and authority", () => {
  const opened = createDiagnosticMission({ auditId: report.auditId, finding, now: 200 });
  const diagnosed = submitDiagnosticEvidence(opened, {
    summary: "The route initialiser reads <unsafe>| and `window.vendor` before its dependency loads.",
    reproduction: "Reload the public route and observe the first-party error before interaction.",
    observations: [{ kind: "console", detail: "ReferenceError occurs once during route startup." }],
    sourceLocations: [{
      file: "src/startup.js",
      line: 42,
      symbol: "initialiseRoute",
      reason: "Owns the failing dependency read.",
    }],
    verificationChecks: ["bun test", "Reload with an empty console"],
    confidence: "high",
  }, "agent", 300);

  const receipt = createAssessmentReceipt({ report, mission, diagnosticMissions: [diagnosed] });
  assert.equal(receipt.assessment.complete, true);
  assert.equal(receipt.assessment.priorityCount, 1);
  assert.equal(receipt.priorities[0].measuredSource.provider, "Lighthouse");
  assert.equal(receipt.priorities[0].evidenceChain.stages[0].provenance, "measured-lighthouse");
  assert.equal(receipt.priorities[0].diagnosis.provenance, "agent-reported");
  assert.equal(receipt.priorities[0].diagnosis.sourceLocations[0].file, "src/startup.js");
  assert.equal(receipt.authority.sourceContentsReceived, false);
  assert.equal(receipt.authority.deploymentProved, false);

  const markdown = assessmentReceiptMarkdown(receipt);
  assert.match(markdown, /^# Frontmend assessment receipt/m);
  assert.match(markdown, /Measured symptom \| retained \| measured-lighthouse/);
  assert.match(markdown, /Browser reproduction \| contributed \| agent-reported/);
  assert.match(markdown, /`src\/startup\.js:42`/);
  assert.match(markdown, /&lt;unsafe&gt;\\\|/);
  assert.match(markdown, /\\`window\.vendor\\`/);
  assert.match(markdown, /does not prove a repair, deployment, or resolution/);
});

test("exports an honest complete receipt when the retained focus has no matching failures", () => {
  const zero = createAssessmentReceipt({
    report: { ...report, findings: [] },
    mission,
    diagnosticMissions: [],
  });
  assert.equal(zero.assessment.complete, true);
  assert.equal(zero.assessment.priorityCount, 0);
  assert.equal(zero.assessment.matchingFindingCount, 0);
  assert.match(assessmentReceiptMarkdown(zero), /Ranked priorities: 0/);
});
