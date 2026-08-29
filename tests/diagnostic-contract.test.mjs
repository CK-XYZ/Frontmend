import assert from "node:assert/strict";
import test from "node:test";
import {
  createDiagnosticMission,
  diagnosticEvidenceChain,
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
  assert.equal(mission.evidenceChain.status, "awaiting-diagnosis");
  assert.deepEqual(
    mission.evidenceChain.stages.map((stage) => [stage.id, stage.state]),
    [
      ["measurement", "retained"],
      ["browser", "required"],
      ["repository", "required"],
      ["verification", "required"],
    ],
  );
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
  assert.equal(diagnosed.evidenceChain.status, "ready-for-repair");
  assert.deepEqual(
    diagnosed.evidenceChain.stages.map((stage) => [stage.id, stage.state, stage.provenance, stage.itemCount]),
    [
      ["measurement", "retained", "measured-lighthouse", 1],
      ["browser", "contributed", "agent-reported", 2],
      ["repository", "contributed", "agent-reported", 1],
      ["verification", "contributed", "agent-reported", 2],
    ],
  );
  assert.match(diagnosed.evidenceChain.authority.claim, /does not approve, implement, deploy, or verify/);
  const frozen = diagnosticMissionForRepair(diagnosed);
  assert.equal(frozen.diagnosis.sourceLocations[0].file, "src/checkout/init.ts");
  assert.equal(frozen.diagnosis.verificationChecks[1], "bun run build");
  assert.equal(frozen.measuredEvidence.provenance, "measured-lighthouse");
});

test("derives a bounded evidence chain for legacy diagnostic snapshots", () => {
  const chain = diagnosticEvidenceChain({
    measuredEvidence: { provenance: "measured-lighthouse", itemCount: 99 },
    diagnosis: {
      agentReported: false,
      observations: Array.from({ length: 9 }, (_, index) => ({ kind: "console", detail: String(index) })),
      sourceLocations: Array.from({ length: 12 }, (_, index) => ({ file: `src/${index}.js` })),
      verificationChecks: Array.from({ length: 12 }, (_, index) => `check ${index}`),
    },
  });

  assert.equal(chain.status, "ready-for-repair");
  assert.deepEqual(chain.stages.map((stage) => stage.itemCount), [5, 5, 8, 8]);
  assert.deepEqual(chain.stages.slice(1).map((stage) => stage.provenance), [
    "person-reported",
    "person-reported",
    "person-reported",
  ]);
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
