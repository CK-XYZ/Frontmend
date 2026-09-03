import assert from "node:assert/strict";
import test from "node:test";
import { runMissionEvaluation } from "../scripts/eval-mission.mjs";
import { FRONTMEND_TOOL_COUNT } from "../src/protocol-contract.js";

test("executes the complete deterministic mission protocol across local and Worker adapters", { timeout: 30_000 }, async () => {
  const result = await runMissionEvaluation();
  assert.equal(result.status, "passed");
  assert.equal(result.evidenceMode, "deterministic-offline-protocol");
  assert.equal(result.liveBrowserProof, false);
  assert.equal(result.deploymentPerformed, false);
  assert.equal(result.toolCount, FRONTMEND_TOOL_COUNT);
  assert.deepEqual(result.adapters.map((adapter) => [adapter.adapter, adapter.status]), [
    ["local", "passed"],
    ["worker", "passed"],
  ]);
  assert.deepEqual(result.parity, {
    preDiagnosisRelationship: "diagnosis-required",
    staleError: "MISSION_REVISION_STALE",
    assessmentComplete: true,
    packageSize: 2,
    approvalMode: "explicit-review",
    candidateFirstIteration: "issues-found",
    candidateSecondIteration: "checks-passed",
    candidateIterationsRetained: 1,
    deploymentOwnerAttested: true,
    verificationStatus: "resolved",
    verificationRoutes: 2,
    exactRows: 4,
    blockerRelationship: "provider-browser-conflict",
    blockerReason: "repository-unavailable",
    blockerAssessmentComplete: true,
    receiptAvailable: true,
    repairStagingWithheld: true,
  });
  assert.match(result.authority.claim, /not live browser, repository, deployment, or production evidence/i);
});
