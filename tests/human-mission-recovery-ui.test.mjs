import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const missionMutationSource = async () => (await Promise.all([
  readFile(`${projectRoot}/src/App.jsx`, "utf8"),
  readFile(`${projectRoot}/src/workspaces/ReportWorkspace.jsx`, "utf8"),
  readFile(`${projectRoot}/src/workspaces/DiagnosisWorkspace.jsx`, "utf8"),
  readFile(`${projectRoot}/src/workspaces/RepairWorkspace.jsx`, "utf8"),
  readFile(`${projectRoot}/src/workspaces/RepairPolicyWorkspace.jsx`, "utf8"),
  readFile(`${projectRoot}/src/ui/human-mission-recovery.js`, "utf8"),
])).join("\n");

test("remaining person-owned mission controls share one no-retry stale recovery", async () => {
  const source = await missionMutationSource();
  const protectedMutations = [
    "prepareRepair",
    "openBrowserReview",
    "openDiagnosticMission",
    "stageRepair",
    "approveRepair",
    "requestRepairChanges",
    "attestDeployment",
    "setRepairPolicy",
    "startSiteExploration",
    "cancelAudit",
  ];

  assert.match(source, /async function humanMissionMutationFailure/);
  assert.match(source, /cause\?\.code !== "MISSION_REVISION_STALE"/);
  assert.match(source, /auditService\.refreshMissionWorkspace\(auditId\)/);
  assert.match(source, /inspect the current mission before acting again/);
  for (const method of protectedMutations) {
    assert.match(source, new RegExp(`auditService\\.${method}\\(`), `${method} must remain wired through the shared service`);
  }
  assert.ok(
    source.match(/humanMissionMutationFailure\(/g).length >= 8,
    "person-owned controls must route stale writes through shared recovery",
  );

  const helper = await readFile(`${projectRoot}/src/ui/human-mission-recovery.js`, "utf8");
  for (const method of protectedMutations) {
    assert.doesNotMatch(helper, new RegExp(`auditService\\.${method}\\(`), `recovery must not replay ${method}`);
  }
});

test("stale review state clears local authority and scope inputs before another action", async () => {
  const source = await missionMutationSource();

  assert.match(source, /if \(failure\.stale\) \{[\s\S]*?setReviewConfirmed\(false\)/);
  assert.match(source, /setDeploymentConfirmed\(false\)/);
  assert.match(source, /setRevisionFeedback\(""\)/);
  assert.match(source, /setVerificationTargetIds\(\[\]\)/);
  assert.match(source, /if \(failure\.stale\) setConfirmed\(false\)/);
  assert.match(source, /if \(failure\.stale\) setSelected\(\[\]\)/);
});
