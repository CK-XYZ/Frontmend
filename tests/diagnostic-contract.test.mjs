import assert from "node:assert/strict";
import test from "node:test";
import {
  createDiagnosticMission,
  diagnosticMissionForRepair,
  findingRequiresDiagnosticMission,
  submitDiagnosticEvidence,
} from "../src/diagnostic-contract.js";

const finding = {
  id: "mobile-errors-in-console",
  title: "The page reports browser errors",
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

test("opens a measured diagnostic mission and keeps repair authority separate", () => {
  assert.equal(findingRequiresDiagnosticMission(finding), true);
  const mission = createDiagnosticMission({ auditId: "audit-1", finding, now: 10 });
  assert.equal(mission.measuredEvidence.provenance, "measured-lighthouse");
  assert.equal(mission.measuredEvidence.itemCount, 1);
  assert.equal(mission.state.state, "awaiting-diagnosis");
  assert.deepEqual(mission.state.nextActions, [{ id: "submit_runtime_diagnosis", actor: "person-or-agent" }]);
  assert.equal(mission.state.repairAuthority, "separate-review-or-delegation");
  assert.throws(() => diagnosticMissionForRepair(mission), /Complete the runtime and repository diagnosis/);
});

test("accepts bounded agent diagnosis and freezes it separately for repair", () => {
  const mission = createDiagnosticMission({ auditId: "audit-1", finding, now: 10 });
  const diagnosed = submitDiagnosticEvidence(mission, {
    summary: "The route initialiser references a widget before the vendor module loads.",
    reproduction: "Load /checkout in a fresh production tab and observe the first console error.",
    observations: [
      { kind: "console", detail: "ReferenceError occurs before the checkout action becomes interactive." },
      { kind: "network", detail: "The vendor module request completes after the failing initialiser." },
    ],
    sourceLocations: [{
      file: "src/checkout/init.ts",
      line: 42,
      symbol: "initialiseCheckout",
      reason: "This symbol reads the missing widget during route startup.",
    }],
    verificationChecks: ["bun test", "bun run build"],
    confidence: "high",
  }, "agent", 20);

  assert.equal(diagnosed.state.state, "ready-for-repair");
  assert.equal(diagnosed.state.diagnosisEvidence, "agent-reported");
  assert.equal(diagnosed.diagnosis.agentReported, true);
  const frozen = diagnosticMissionForRepair(diagnosed);
  assert.equal(frozen.diagnosis.sourceLocations[0].file, "src/checkout/init.ts");
  assert.equal(frozen.diagnosis.verificationChecks[1], "bun run build");
  assert.equal(frozen.measuredEvidence.provenance, "measured-lighthouse");
});

test("rejects source contents, absolute files, and unknown diagnosis fields", () => {
  const mission = createDiagnosticMission({ auditId: "audit-1", finding });
  const base = {
    summary: "Investigated the runtime failure.",
    reproduction: "Load the public route in a fresh browser session.",
    observations: [{ kind: "console", detail: "The first-party error reproduced." }],
    sourceLocations: [{ file: "src/app.ts", reason: "Owns the failing initialiser." }],
    verificationChecks: ["bun test"],
    confidence: "medium",
  };
  assert.throws(
    () => submitDiagnosticEvidence(mission, { ...base, source: "export const secret = true" }),
    /Unknown diagnosis field/,
  );
  assert.throws(
    () => submitDiagnosticEvidence(mission, {
      ...base,
      sourceLocations: [{ file: "C:\\private\\app.ts", reason: "Absolute path." }],
    }),
    /repository-relative paths/,
  );
});
