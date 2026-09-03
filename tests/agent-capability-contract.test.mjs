import assert from "node:assert/strict";
import test from "node:test";
import {
  agentCapabilityMatch,
  agentCapabilityRows,
  createAgentCapabilityDeclaration,
  requiredCapabilitiesForBrowserTask,
  toolAllowedByAgentCapabilities,
} from "../src/agent-capability-contract.js";

const capabilities = {
  visualBrowserAccess: true,
  responsiveEmulation: true,
  runtimeDiagnostics: false,
  repositoryAccess: true,
  terminalExecution: false,
};

test("retains an explicit agent-declared and unverified capability snapshot", () => {
  const declaration = createAgentCapabilityDeclaration(capabilities, null, 100);
  assert.equal(declaration.provenance, "agent-declared");
  assert.equal(declaration.verificationStatus, "not-verified");
  assert.equal(declaration.declarationRevision, 1);
  assert.deepEqual(declaration.declaredCapabilities, [
    "visual-browser-access",
    "responsive-emulation",
    "repository-access",
  ]);
  assert.deepEqual(declaration.unavailableCapabilities, [
    "runtime-diagnostics",
    "terminal-execution",
  ]);
  assert.deepEqual(agentCapabilityRows(declaration).map((row) => row.declared), [true, true, false, true, false]);

  const replay = createAgentCapabilityDeclaration(capabilities, declaration, 200);
  assert.deepEqual(replay, declaration);
  const changed = createAgentCapabilityDeclaration({ ...capabilities, runtimeDiagnostics: true }, declaration, 300);
  assert.equal(changed.declarationRevision, 2);
  assert.equal(changed.declaredAt, 100);
  assert.equal(changed.updatedAt, 300);
});

test("requires every capability to be explicitly declared and rejects unknown fields", () => {
  assert.throws(
    () => createAgentCapabilityDeclaration({ ...capabilities, runtimeDiagnostics: undefined }),
    (error) => error.code === "INVALID_AGENT_CAPABILITIES" && /explicitly be true or false/i.test(error.message),
  );
  assert.throws(
    () => createAgentCapabilityDeclaration({ ...capabilities, secretAccess: true }),
    (error) => error.code === "INVALID_AGENT_CAPABILITIES" && /unknown capabilities field/i.test(error.message),
  );
  assert.throws(
    () => createAgentCapabilityDeclaration({
      ...capabilities,
      terminalAndDeploymentAccess: true,
    }),
    (error) => error.code === "INVALID_AGENT_CAPABILITIES" && /unknown capabilities field/i.test(error.message),
  );
});

test("compiles browser requirements from the actual viewport and diagnostic task", () => {
  assert.deepEqual(requiredCapabilitiesForBrowserTask({
    viewport: "mobile",
    focusArea: "reliability",
  }), ["visual-browser-access", "responsive-emulation", "runtime-diagnostics"]);
  assert.deepEqual(requiredCapabilitiesForBrowserTask({ viewport: "desktop" }), ["visual-browser-access"]);
});

test("allows only mission tools supported by the declared capability set", () => {
  const declaration = createAgentCapabilityDeclaration(capabilities, null, 100);
  assert.equal(toolAllowedByAgentCapabilities("open_browser_review", declaration), true);
  assert.equal(toolAllowedByAgentCapabilities("open_candidate_review", declaration), true);
  assert.equal(toolAllowedByAgentCapabilities("record_candidate_review_check", declaration, {
    candidateReview: {
      state: {
        nextCheck: {
          focusArea: "performance",
          target: { viewport: "mobile", affectedViewports: ["mobile"] },
        },
      },
    },
  }), false);
  assert.equal(toolAllowedByAgentCapabilities("submit_runtime_diagnosis", declaration, {
    input: { missionId: "diagnostic-1" },
    diagnosticMissions: [{
      id: "diagnostic-1",
      measuredEvidence: { kind: "console-errors" },
      findingSource: { strategy: "desktop" },
    }],
  }), false);
  assert.equal(toolAllowedByAgentCapabilities("submit_runtime_diagnosis", declaration, {
    input: { missionId: "diagnostic-2" },
    diagnosticMissions: [{
      id: "diagnostic-2",
      measuredEvidence: { kind: "contrast-nodes" },
      findingSource: { strategy: "mobile" },
    }],
  }), true);
  assert.equal(toolAllowedByAgentCapabilities("record_repository_implementation", declaration), false);
  assert.deepEqual(agentCapabilityMatch(declaration, [
    "repository-access",
    "terminal-execution",
  ]).missingCapabilities, ["terminal-execution"]);

  const terminalCapable = createAgentCapabilityDeclaration({
    ...capabilities,
    terminalExecution: true,
  }, null, 100);
  assert.equal(toolAllowedByAgentCapabilities("record_repository_implementation", terminalCapable), true);
});
