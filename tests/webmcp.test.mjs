import assert from "node:assert/strict";
import test from "node:test";
import { AuditError, createAuditService } from "../src/audit-service.js";
import {
  contextualFrontmendToolNames,
  createFrontmendTools,
  registerFrontmendTools,
} from "../src/webmcp.js";

function findTool(tools, name) {
  const tool = tools.find((item) => item.name === name);
  assert.ok(tool, `Missing tool ${name}`);
  return tool;
}

const TOOL_NAMES = [
  "start_site_audit",
  "check_site_audit_progress",
  "cancel_site_audit",
  "get_site_audit_results",
  "get_repository_fix_brief",
  "start_related_page_audit",
  "start_site_exploration",
  "get_site_exploration",
  "get_verification_receipt",
  "stage_site_repair",
  "revise_site_repair",
  "get_repair_workspace",
  "record_repository_implementation",
  "start_repair_verification",
];

test("repository fix brief gives a coding agent bounded evidence without claiming source access", async () => {
  const auditId = "b8b16bf0-913c-40ea-a741-bb4bf76d326b";
  const finding = {
    id: "document-content-security-policy",
    title: "No Content Security Policy header was observed",
    severity: "low",
    category: "Security",
    selector: "Document",
    evidence: "The Content-Security-Policy response header was absent.",
    repair: "Introduce a tested Content Security Policy.",
    source: {
      provider: "Frontmend document audit",
      auditId: "content-security-policy",
      strategy: "document",
    },
  };
  const service = {
    getActiveAudit: () => ({ id: auditId, status: "complete" }),
    getResults: async () => ({
      auditId,
      url: "https://removemyexif.com/",
      finalUrl: "https://removemyexif.com/",
      engine: { mode: "live-document", provider: "Frontmend document audit", ruleSetVersion: 1 },
      findings: [finding],
    }),
  };

  const result = await findTool(
    createFrontmendTools(service),
    "get_repository_fix_brief",
  ).execute({ findingId: finding.id });

  assert.equal(result.ok, true);
  assert.equal(result.data.findingId, finding.id);
  assert.equal(result.data.repositoryHandoff.patchType, "headers");
  assert.equal(result.data.authority.sourceAccess, "coding-agent-only");
  assert.equal(result.data.authority.frontmendChangedTarget, false);
  assert.equal("absolutePath" in result.data.repositoryHandoff, false);
});

test("cancel tool uses visible audit context and returns persisted terminal state", async () => {
  const calls = [];
  const service = {
    getActiveAudit: () => ({ id: "audit-1", status: "running" }),
    cancelAudit: async (auditId) => {
      calls.push(auditId);
      return { id: auditId, attempt: 2, status: "cancelled" };
    },
  };
  const result = await findTool(createFrontmendTools(service), "cancel_site_audit").execute({});

  assert.equal(result.ok, true);
  assert.deepEqual(calls, ["audit-1"]);
  assert.equal(result.data.status, "cancelled");
  assert.equal(result.data.attempt, 2);
  assert.equal(result.data.workspacePath, "/audits/audit-1");
  assert.match(result.data.message, /No result was produced/);
});

test("related-page tool starts only an observed route through the shared service", async () => {
  const calls = [];
  const service = {
    getActiveAudit: () => ({ id: "audit-1", status: "complete" }),
    startRelatedAudit: async (auditId, path, source) => {
      calls.push({ auditId, path, source });
      return {
        id: "audit-2",
        attempt: 1,
        url: `https://removemyexif.com${path}`,
        source,
        status: "queued",
        exploration: {
          rootAuditId: "audit-1",
          parentAuditId: "audit-1",
          observedPath: path,
          depth: 1,
          trail: [{ auditId: "audit-1", path: "/" }],
        },
      };
    },
  };
  const result = await findTool(
    createFrontmendTools(service),
    "start_related_page_audit",
  ).execute({ path: "/privacy" });

  assert.equal(result.ok, true);
  assert.deepEqual(calls, [{ auditId: "audit-1", path: "/privacy", source: "agent" }]);
  assert.equal(result.data.baselineAuditId, "audit-1");
  assert.equal(result.data.observedPath, "/privacy");
  assert.equal(result.data.rootAuditId, "audit-1");
  assert.equal(result.data.parentAuditId, "audit-1");
  assert.equal(result.data.routeDepth, 1);
  assert.deepEqual(result.data.routeTrail, [{ auditId: "audit-1", path: "/" }]);
  assert.equal(result.data.workspacePath, "/audits/audit-2");
});

test("site-exploration tools start and read one durable cross-page mission", async () => {
  const calls = [];
  const exploration = {
    id: "232d593c-6c81-48c3-b137-a3df269454ff",
    rootAuditId: "audit-1",
    status: "running",
    progress: 34,
    summary: { pagesRequested: 2, pagesComplete: 0, pagesFailed: 0, totalFindings: 0, recurringIssues: 0 },
    pages: [],
    issues: [],
  };
  const service = {
    getActiveAudit: () => ({ id: "audit-1", status: "complete" }),
    getSiteExplorations: () => [exploration],
    startSiteExploration: async (auditId, paths, source) => {
      calls.push(["start", auditId, paths, source]);
      return exploration;
    },
    getSiteExploration: async (auditId, missionId) => {
      calls.push(["get", auditId, missionId]);
      return { ...exploration, status: "complete", progress: 100 };
    },
  };
  const tools = createFrontmendTools(service);
  const started = await findTool(tools, "start_site_exploration").execute({
    paths: ["/privacy", "/terms"],
  });
  assert.equal(started.ok, true);
  assert.equal(started.data.explorationId, exploration.id);
  assert.deepEqual(calls[0], ["start", "audit-1", ["/privacy", "/terms"], "agent"]);

  const read = await findTool(tools, "get_site_exploration").execute({});
  assert.equal(read.ok, true);
  assert.equal(read.data.status, "complete");
  assert.match(read.data.reportPath, new RegExp(`${exploration.id}/report$`));
  assert.deepEqual(calls[1], ["get", "audit-1", exploration.id]);
});

test("agent tools use the same audit service as the human interface", async () => {
  const auditId = "b8b16bf0-913c-40ea-a741-bb4bf76d326b";
  const report = { auditId, schemaVersion: 2, findings: [] };
  const service = createAuditService({
    transport: {
      start: async ({ url, source }) => ({
        id: auditId,
        attempt: 1,
        url,
        source,
        status: "queued",
        phase: "queued",
        progress: 4,
        report: null,
      }),
      get: async () => ({
        id: auditId,
        attempt: 2,
        url: "https://removemyexif.com/",
        source: "agent",
        status: "complete",
        phase: "complete",
        progress: 100,
        report,
      }),
      results: async () => report,
    },
  });
  const tools = createFrontmendTools(service);
  const started = await findTool(tools, "start_site_audit").execute({ url: "removemyexif.com" });

  assert.equal(started.ok, true);
  assert.equal(started.data.workspacePath, `/audits/${started.data.id}`);
  assert.equal(service.getActiveAudit().id, started.data.id);
  assert.equal(service.getActiveAudit().source, "agent");

  const progress = await findTool(tools, "check_site_audit_progress").execute({});
  assert.equal(progress.data.status, "complete");
  assert.equal(progress.data.attempt, 2);
  const results = await findTool(tools, "get_site_audit_results").execute({});
  assert.equal(results.ok, true);
  assert.equal(results.data.auditId, started.data.id);
  const activities = service.getAgentActivities();
  assert.deepEqual(
    activities.map((activity) => [activity.tool, activity.status]),
    [
      ["get_site_audit_results", "succeeded"],
      ["check_site_audit_progress", "succeeded"],
      ["start_site_audit", "succeeded"],
    ],
  );
  assert.equal(activities.every((activity) => !("input" in activity)), true);
});

test("repair tools use visible audit context while preserving explicit repair IDs", async () => {
  const calls = [];
  let repair = {
    id: "3e8fe191-1f46-4f1b-92ac-492a5d73bb24",
    auditId: "b8b16bf0-913c-40ea-a741-bb4bf76d326b",
    findingId: "document-content-security-policy",
    findingTitle: "No Content Security Policy header was observed",
    status: "draft",
    source: "agent",
    summary: "Introduce a tested report-only policy first.",
    patchType: "headers",
    patch: "Content-Security-Policy-Report-Only: default-src 'self'",
    verificationPlan: "Deploy, observe, promote, and rerun the header check.",
    risk: "high",
    requiresHumanReview: true,
    reviewedAt: null,
    revision: 1,
    revisionHistory: [],
    changeRequest: null,
  };
  const service = {
    getActiveAudit: () => ({ id: repair.auditId }),
    stageRepair: async (auditId, input) => {
      calls.push(["stage", auditId, input]);
      return repair;
    },
    listRepairs: async (auditId) => {
      calls.push(["list", auditId]);
      return { auditId, repairs: [repair] };
    },
    reviseRepair: async (auditId, repairId, input) => {
      calls.push(["revise", auditId, repairId, input]);
      if (repair.status !== "changes-requested") {
        throw new AuditError(
          "REVISION_NOT_REQUESTED",
          "A person must request changes before this repair can be revised.",
        );
      }
      repair = {
        ...repair,
        ...input,
        status: "draft",
        revision: repair.revision + 1,
        revisionHistory: [{ revision: repair.revision, summary: repair.summary }],
        changeRequest: null,
      };
      return repair;
    },
    startVerification: async (auditId, repairId) => {
      calls.push(["verify", auditId, repairId]);
      if (!Number.isFinite(repair.deploymentAttestedAt)) {
        throw new AuditError(
          "DEPLOYMENT_NOT_ATTESTED",
          "A person must confirm the reviewed change was deployed before verification.",
        );
      }
      return { id: "c45d54ea-6884-4c86-b82d-b9048cff697f", status: "queued" };
    },
  };
  const tools = createFrontmendTools(service);
  const staged = await findTool(tools, "stage_site_repair").execute({
    findingId: repair.findingId,
    summary: repair.summary,
    patchType: repair.patchType,
    patch: repair.patch,
    verificationPlan: repair.verificationPlan,
    risk: repair.risk,
  });
  assert.equal(staged.ok, true);
  assert.equal(staged.data.requiresHumanReview, true);
  assert.equal("patch" in staged.data, false);
  assert.equal(staged.data.mission.state, "awaiting-human-review");
  assert.deepEqual(staged.data.mission.nextActions, [{ id: "review_in_ui", actor: "person" }]);
  assert.equal(calls[0][2].source, "agent");

  const workspace = await findTool(tools, "get_repair_workspace").execute({
    repairId: repair.id,
  });
  assert.equal(workspace.data.repairs[0].patch, repair.patch);
  assert.equal(
    workspace.data.repairs[0].mission.steps.find((step) => step.id === "review").status,
    "current",
  );

  const revisionInput = {
    auditId: repair.auditId,
    repairId: repair.id,
    summary: "Introduce a report-only policy with an explicit reporting endpoint.",
    patchType: "headers",
    patch: "Content-Security-Policy-Report-Only: default-src 'self'; report-uri /csp-report",
    verificationPlan: "Exercise critical journeys and inspect the reporting endpoint before enforcement.",
    risk: "high",
  };
  const unrequestedRevision = await findTool(tools, "revise_site_repair").execute(revisionInput);
  assert.equal(unrequestedRevision.ok, false);
  assert.equal(unrequestedRevision.error.code, "REVISION_NOT_REQUESTED");

  repair = {
    ...repair,
    status: "changes-requested",
    changeRequest: {
      feedback: "Add a reporting endpoint and make the validation journey explicit.",
      requestedAt: 10,
    },
  };
  const feedbackWorkspace = await findTool(tools, "get_repair_workspace").execute({
    auditId: repair.auditId,
    repairId: repair.id,
  });
  assert.match(feedbackWorkspace.data.repairs[0].changeRequest.feedback, /reporting endpoint/);
  assert.equal(feedbackWorkspace.data.repairs[0].mission.state, "changes-requested");

  const revised = await findTool(tools, "revise_site_repair").execute(revisionInput);
  assert.equal(revised.ok, true);
  assert.equal(revised.data.revision, 2);
  assert.equal(revised.data.status, "draft");
  assert.equal(revised.data.mission.state, "awaiting-human-review");
  assert.equal(calls.at(-1)[0], "revise");

  const earlyVerification = await findTool(tools, "start_repair_verification").execute({
    auditId: repair.auditId,
    repairId: repair.id,
  });
  assert.equal(earlyVerification.ok, false);
  assert.equal(earlyVerification.error.code, "DEPLOYMENT_NOT_ATTESTED");

  repair = {
    ...repair,
    status: "approved",
    implementationReceipt: {
      revision: 2,
      summary: "Current implementation",
      files: ["worker/index.js"],
      checks: [{ name: "bun test", status: "passed" }],
      commitSha: "94a2827",
      source: "agent",
      reportedAt: 19,
    },
    implementationHistory: [{
      revision: 1,
      summary: "Initial implementation",
      files: ["worker/index.js"],
      checks: [{ name: "bun test", status: "failed" }],
      commitSha: null,
      source: "agent",
      reportedAt: 18,
    }],
    deploymentAttestedAt: 20,
  };
  const readyWorkspace = await findTool(tools, "get_repair_workspace").execute({
    auditId: repair.auditId,
    repairId: repair.id,
  });
  assert.equal(readyWorkspace.data.repairs[0].deploymentAttestedAt, 20);
  assert.equal(readyWorkspace.data.repairs[0].implementationReceipt.revision, 2);
  assert.equal(readyWorkspace.data.repairs[0].implementationHistory[0].checks[0].status, "failed");
  assert.equal(readyWorkspace.data.repairs[0].implementationHistory[0].sourceChangedByFrontmend, false);
  assert.equal(readyWorkspace.data.repairs[0].mission.state, "ready-for-verification");

  const verification = await findTool(tools, "start_repair_verification").execute({
    auditId: repair.auditId,
    repairId: repair.id,
  });
  assert.equal(verification.ok, true);
  assert.match(verification.data.workspacePath, /^\/audits\//);
  assert.deepEqual(calls.at(-1), ["verify", repair.auditId, repair.id]);
});

test("implementation receipt tool reports bounded repository evidence only", async () => {
  const auditId = "b8b16bf0-913c-40ea-a741-bb4bf76d326b";
  const repairId = "3e8fe191-1f46-4f1b-92ac-492a5d73bb24";
  const calls = [];
  const service = {
    getActiveAudit: () => ({ id: auditId, status: "complete" }),
    recordImplementation: async (receivedAuditId, receivedRepairId, input) => {
      calls.push({ receivedAuditId, receivedRepairId, input });
      return {
        id: repairId,
        status: "approved",
        implementationReceipt: {
          ...input,
          source: "agent",
          agentReported: true,
          sourceChangedByFrontmend: false,
          reportedAt: 20,
        },
      };
    },
  };
  const result = await findTool(
    createFrontmendTools(service),
    "record_repository_implementation",
  ).execute({
    repairId,
    summary: "Applied the reviewed header configuration.",
    files: ["worker/index.js"],
    checks: [{ name: "bun test", status: "passed" }],
    commitSha: "94a2827",
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.implementationReceipt.sourceChangedByFrontmend, false);
  assert.deepEqual(calls[0], {
    receivedAuditId: auditId,
    receivedRepairId: repairId,
    input: {
      summary: "Applied the reviewed header configuration.",
      files: ["worker/index.js"],
      checks: [{ name: "bun test", status: "passed" }],
      commitSha: "94a2827",
    },
  });
});

test("verification receipt tool returns the same bounded proof artifact", async () => {
  const auditId = "c1de4f26-c222-4e44-a7e5-884ba6d9fe9a";
  const report = {
    auditId,
    url: "https://removemyexif.com/",
    verification: {
      status: "resolved",
      findingId: "document-image-alt",
      findingTitle: "Images are missing text alternatives",
      findingSource: {
        provider: "Frontmend document audit",
        auditId: "image-alt",
        strategy: "document",
      },
      ruleOutcome: "passed",
      comparable: true,
      metricComparable: true,
      comparisonReason: "exact-document-rule",
      completedAt: 1_787_766_200_000,
      proof: {
        baseline: { auditId: "baseline-audit", score: 88, findingCount: 1, checks: { passed: 8 } },
        current: { auditId, score: 100, findingCount: 0, checks: { passed: 9 } },
        deltas: { score: 12, checksPassed: 1, findings: -1 },
      },
      lineage: { entries: [] },
    },
  };
  const receipt = await findTool(
    createFrontmendTools({ getActiveAudit: () => ({ id: auditId }), getResults: async () => report }),
    "get_verification_receipt",
  ).execute({});
  assert.equal(receipt.ok, true);
  assert.equal(receipt.data.status, "resolved");
  assert.equal(receipt.data.format, "text/markdown");
  assert.equal(receipt.data.downloadPath, `/api/audits/${auditId}/receipt`);
  assert.match(receipt.data.receipt, /\| Score \| 88 \| 100 \| \+12 \|/);
});

test("audit-scoped schemas make only the current audit ID optional", async () => {
  const service = { getActiveAudit: () => null, getResults: async () => ({}) };
  const tools = createFrontmendTools(service);
  const auditScopedNames = TOOL_NAMES.filter((name) => name !== "start_site_audit");

  for (const name of auditScopedNames) {
    const definition = findTool(tools, name);
    assert.equal(definition.inputSchema.required?.includes("auditId") ?? false, false, name);
    assert.equal(definition.inputSchema.properties.auditId.description.includes("visible audit"), true, name);
  }

  const withoutContext = await findTool(tools, "get_site_audit_results").execute({});
  assert.equal(withoutContext.ok, false);
  assert.equal(withoutContext.error.code, "AUDIT_CONTEXT_REQUIRED");
  assert.match(withoutContext.error.message, /Provide auditId or open the audit workspace/);
});

test("tools reject unknown fields without mutating state", async () => {
  const service = createAuditService();
  const result = await findTool(createFrontmendTools(service), "start_site_audit").execute({
    url: "example.com",
    surprise: true,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "INVALID_INPUT");
  assert.equal(service.getActiveAudit(), null);
  assert.equal(service.getAgentActivities()[0].status, "failed");
  assert.equal(service.getAgentActivities()[0].errorCode, "INVALID_INPUT");
});

test("registration gracefully preserves human mode when WebMCP is unavailable", async () => {
  const snapshots = [];
  const dispose = await registerFrontmendTools({
    service: createAuditService(),
    target: {},
    onStatus: (snapshot) => snapshots.push(snapshot),
  });

  assert.equal(snapshots.at(-1).status, "unsupported");
  assert.deepEqual(snapshots.at(-1).toolNames, []);
  dispose();
});

test("contextual tool availability follows the visible audit and human review state", () => {
  let audit = null;
  let repairs = [];
  let explorations = [];
  const service = {
    getActiveAudit: () => audit,
    getRepairs: () => repairs,
    getSiteExplorations: () => explorations,
  };

  assert.deepEqual(contextualFrontmendToolNames(service), ["start_site_audit"]);

  audit = { id: "audit-1", status: "running", report: null };
  assert.deepEqual(contextualFrontmendToolNames(service), [
    "check_site_audit_progress",
    "cancel_site_audit",
  ]);

  audit = { id: "audit-1", status: "failed", report: null };
  assert.deepEqual(contextualFrontmendToolNames(service), ["start_site_audit"]);

  audit = { id: "audit-1", status: "cancelled", report: null };
  assert.deepEqual(contextualFrontmendToolNames(service), ["start_site_audit"]);

  audit = { id: "audit-1", status: "complete", report: { findings: [] } };
  assert.deepEqual(contextualFrontmendToolNames(service), ["get_site_audit_results"]);

  audit = {
    id: "audit-1",
    status: "complete",
    report: { findings: [], documentProfile: { routes: ["/privacy"] } },
  };
  assert.deepEqual(contextualFrontmendToolNames(service), [
    "get_site_audit_results",
    "start_related_page_audit",
    "start_site_exploration",
  ]);

  explorations = [{ id: "exploration-1" }];
  assert.deepEqual(contextualFrontmendToolNames(service), [
    "get_site_audit_results",
    "start_related_page_audit",
    "start_site_exploration",
    "get_site_exploration",
  ]);
  explorations = [];

  audit = {
    id: "audit-1",
    status: "complete",
    report: { findings: [{ id: "csp" }] },
  };
  assert.deepEqual(contextualFrontmendToolNames(service), [
    "get_site_audit_results",
    "get_repository_fix_brief",
    "stage_site_repair",
    "get_repair_workspace",
  ]);

  repairs = [{ status: "changes-requested", deploymentAttestedAt: null }];
  assert.deepEqual(contextualFrontmendToolNames(service), [
    "get_site_audit_results",
    "get_repository_fix_brief",
    "stage_site_repair",
    "revise_site_repair",
    "get_repair_workspace",
  ]);

  repairs = [{ status: "approved", deploymentAttestedAt: null }];
  assert.deepEqual(contextualFrontmendToolNames(service), [
    "get_site_audit_results",
    "get_repository_fix_brief",
    "stage_site_repair",
    "get_repair_workspace",
    "record_repository_implementation",
  ]);

  repairs = [{ status: "approved", deploymentAttestedAt: 1_777_000_000_000 }];
  audit.report.verification = { status: "resolved" };
  assert.deepEqual(contextualFrontmendToolNames(service), [
    "get_site_audit_results",
    "get_repository_fix_brief",
    "get_verification_receipt",
    "stage_site_repair",
    "get_repair_workspace",
    "start_repair_verification",
  ]);
});

test("registration publishes only the requested contextual tool subset", async () => {
  const registered = [];
  const snapshots = [];
  const target = {
    modelContext: {
      async registerTool(tool) {
        registered.push(tool.name);
      },
    },
  };

  const dispose = registerFrontmendTools({
    service: createAuditService(),
    target,
    toolNames: ["start_site_audit"],
    onStatus: (snapshot) => snapshots.push(snapshot),
  });
  await dispose.ready;

  assert.deepEqual(registered, ["start_site_audit"]);
  assert.equal(snapshots.at(-1).status, "ready");
  assert.equal(snapshots.at(-1).activeTools, 1);
  assert.equal(snapshots.at(-1).totalTools, 14);
  dispose();
});

test("registers the complete audit and repair toolset with an abortable lifecycle", async () => {
  const registered = [];
  const signals = [];
  const target = {
    modelContext: {
      async registerTool(tool, options) {
        registered.push(tool.name);
        signals.push(options.signal);
      },
    },
  };
  const snapshots = [];
  const dispose = registerFrontmendTools({
    service: createAuditService(),
    target,
    onStatus: (snapshot) => snapshots.push(snapshot),
  });
  await dispose.ready;

  assert.deepEqual(registered, TOOL_NAMES);
  assert.equal(snapshots.at(-1).status, "ready");
  dispose();
  assert.equal(signals.every((signal) => signal.aborted), true);
});

test("immediate cleanup prevents Strict Mode registration races", async () => {
  const registered = [];
  const target = {
    modelContext: {
      async registerTool(tool) {
        registered.push(tool.name);
      },
    },
  };

  const first = registerFrontmendTools({ service: createAuditService(), target });
  first();
  const second = registerFrontmendTools({ service: createAuditService(), target });

  await Promise.all([first.ready, second.ready]);
  assert.deepEqual(registered, TOOL_NAMES);
  second();
});

test("registration surfaces structured browser errors as useful text", async () => {
  const snapshots = [];
  const target = {
    modelContext: {
      async registerTool(tool) {
        if (tool.name === "check_site_audit_progress") {
          throw { message: "Tool name is already registered." };
        }
      },
    },
  };

  const dispose = registerFrontmendTools({
    service: createAuditService(),
    target,
    onStatus: (snapshot) => snapshots.push(snapshot),
  });
  await dispose.ready;

  assert.equal(snapshots.at(-1).status, "error");
  assert.equal(snapshots.at(-1).totalTools, 14);
  assert.deepEqual(
    snapshots.at(-1).toolNames,
    TOOL_NAMES.filter((name) => name !== "check_site_audit_progress"),
  );
  assert.deepEqual(snapshots.at(-1).errors, [
    "check_site_audit_progress: Tool name is already registered.",
  ]);
  dispose();
});
