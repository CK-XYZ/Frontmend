import assert from "node:assert/strict";
import test from "node:test";
import { createAuditMission } from "../src/audit-mission-contract.js";
import {
  assertExpectedBuildDescriptor,
  createBuildDescriptor,
  createRuntimeBuildDescriptor,
  FRONTMEND_PROTOCOL_VERSION,
  FRONTMEND_TOOL_COUNT,
  FRONTMEND_TOOL_LIBRARY_VERSION,
} from "../src/protocol-contract.js";
import { createFrontmendTools } from "../src/webmcp.js";

function findTool(tools, name) {
  const retained = tools.find((item) => item.name === name);
  assert.ok(retained, `Missing ${name}`);
  return retained;
}

test("normalizes a public non-sensitive build identity and marks dirty source honestly", () => {
  const identified = createBuildDescriptor({
    commit: "A".repeat(40),
    builtAt: "2026-09-01T12:00:00+08:00",
  });
  assert.equal(identified.commit, "a".repeat(40));
  assert.equal(identified.builtAt, "2026-09-01T04:00:00.000Z");
  assert.equal(identified.buildIdentified, true);
  assert.equal(identified.sourceDirty, false);
  assert.equal(identified.toolCount, FRONTMEND_TOOL_COUNT);

  const dirty = createRuntimeBuildDescriptor({
    FRONTMEND_BUILD_COMMIT: "b".repeat(40),
    FRONTMEND_BUILT_AT: "2026-09-01T04:00:00.000Z",
    FRONTMEND_SOURCE_DIRTY: "true",
    FRONTMEND_VERSION: { id: "worker-version-1" },
  });
  assert.equal(dirty.buildIdentified, false);
  assert.equal(dirty.sourceDirty, true);
  assert.equal(dirty.deploymentVersion, "worker-version-1");

  const unknown = createBuildDescriptor({ commit: "branch-main", builtAt: "not-a-date" });
  assert.equal(unknown.commit, null);
  assert.equal(unknown.builtAt, null);
  assert.equal(unknown.buildIdentified, false);

  assert.equal(assertExpectedBuildDescriptor(identified, { commit: "a".repeat(40) }), identified);
  assert.throws(
    () => assertExpectedBuildDescriptor(dirty, { commit: "b".repeat(40) }),
    /not identified as a clean source build/i,
  );
  assert.throws(
    () => assertExpectedBuildDescriptor(identified, { commit: "c".repeat(40) }),
    /not c{40}/i,
  );
});

test("returns compact mission and one-finding evidence queries with a protocol envelope", async () => {
  const auditId = "52a68023-ad7f-4bb0-951c-f7b87b08895c";
  const checkpoint = {
    auditId,
    missionRevision: 4,
    action: { tool: "get_site_audit_results", input: {} },
    requiredCapability: "full-evidence-reading",
    completionCriteria: ["Review the retained evidence."],
    agentRun: { schemaVersion: 1, mode: "complete", continueAutomatically: false },
  };
  const mission = createAuditMission({ focusAreas: ["security"] }, "agent", 10);
  const finding = {
    id: "document-content-security-policy",
    title: "No Content Security Policy header was observed",
    severity: "low",
    category: "Security",
    focusAreas: ["security"],
    evidence: "The public response did not include a Content-Security-Policy header.",
    repair: "Introduce a tested policy through the site's deployment configuration.",
    source: {
      provider: "Frontmend document audit",
      auditId: "content-security-policy",
      strategy: "document",
    },
  };
  const report = {
    auditId,
    url: "https://example.com/",
    finalUrl: "https://example.com/",
    completedAt: 20,
    engine: { mode: "live-document", provider: "Frontmend document audit" },
    findings: [finding],
    viewports: [],
    missionCheckpoint: checkpoint,
  };
  const audit = {
    id: auditId,
    status: "complete",
    missionRevision: 4,
    mission,
    report,
  };
  const service = {
    getActiveAudit: () => audit,
    getResults: async () => report,
    getMissionCheckpoint: () => checkpoint,
    getDiagnosticMissions: () => [],
    getRepairs: () => [],
    getBrowserReview: () => null,
    getSiteExplorations: () => [],
  };
  const tools = createFrontmendTools(service);
  assert.equal(tools.length, FRONTMEND_TOOL_COUNT);

  const summary = await findTool(tools, "get_mission_summary").execute({});
  assert.equal(summary.ok, true);
  assert.equal(summary.data.auditId, auditId);
  assert.equal(summary.data.measurementStatus, "complete");
  assert.equal(summary.data.assessmentStatus, "complete");
  assert.equal(summary.data.checkpointStatus, "complete");
  assert.equal(summary.data.explorationStatus, "not-requested");
  assert.equal(summary.data.assessment.measurementComplete, true);
  assert.equal(summary.data.topPriorities.length, 1);
  assert.equal("report" in summary.data, false);
  assert.equal("findings" in summary.data, false);
  assert.deepEqual(summary.protocol, {
    protocolVersion: FRONTMEND_PROTOCOL_VERSION,
    toolLibraryVersion: FRONTMEND_TOOL_LIBRARY_VERSION,
    toolCount: FRONTMEND_TOOL_COUNT,
    toolsetRevision: 4,
    missionRevision: 4,
    workspacePath: `/audits/${auditId}`,
    activeToolCount: summary.protocol.activeToolCount,
    next: {
      tool: "get_site_audit_results",
      input: {},
      requiredCapability: "full-evidence-reading",
    },
    agentRun: checkpoint.agentRun,
  });
  assert.ok(summary.protocol.activeToolCount < FRONTMEND_TOOL_COUNT);

  const evidence = await findTool(tools, "get_evidence_chain").execute({ findingId: finding.id });
  assert.equal(evidence.ok, true);
  assert.equal(evidence.data.finding.findingId, finding.id);
  assert.equal(evidence.data.evidenceSources.provider.provider, "Frontmend document audit");
  assert.deepEqual(evidence.data.evidenceSources.provider.strategies, ["document"]);
  assert.equal(evidence.data.evidenceSources.repository, null);
  assert.equal(evidence.data.authority.sourceContentsReceived, false);
  assert.equal("report" in evidence.data, false);
  assert.equal(evidence.protocol.missionRevision, 4);
});

test("keeps the stable mission summary available before an audit and envelopes errors", async () => {
  const tools = createFrontmendTools({ getActiveAudit: () => null });
  const idle = await findTool(tools, "get_mission_summary").execute({});
  assert.equal(idle.data.status, "idle");
  assert.equal(idle.data.measurementStatus, "not-started");
  assert.equal(idle.data.assessmentStatus, "not-started");
  assert.equal(idle.data.nextAction.tool, "start_site_audit");
  assert.equal(idle.protocol.activeToolCount, 2);
  assert.equal(idle.protocol.next.tool, "start_site_audit");

  const failed = await findTool(tools, "get_evidence_chain").execute({ findingId: "not-retained" });
  assert.equal(failed.ok, false);
  assert.equal(failed.error.code, "AUDIT_NOT_COMPLETE");
  assert.equal(failed.protocol.protocolVersion, FRONTMEND_PROTOCOL_VERSION);
  assert.equal(failed.protocol.toolsetRevision, 0);
});
