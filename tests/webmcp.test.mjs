import assert from "node:assert/strict";
import test from "node:test";
import { AuditError, createAuditService } from "../src/audit-service.js";
import {
  contextualFrontmendToolNames,
  createFrontmendTools,
  registerFrontmendTools,
} from "../src/webmcp.js";
import {
  createBrowserReviewMission,
  createBrowserVerificationReview,
  recordBrowserReviewCheck,
  withdrawBrowserReview,
} from "../src/browser-review-contract.js";
import { deriveAuditMissionState } from "../src/audit-mission-contract.js";
import { FRONTMEND_TOOL_COUNT } from "../src/protocol-contract.js";

function findTool(tools, name) {
  const tool = tools.find((item) => item.name === name);
  assert.ok(tool, `Missing tool ${name}`);
  return tool;
}

const TOOL_NAMES = [
  "start_site_audit",
  "check_site_audit_progress",
  "cancel_site_audit",
  "get_mission_summary",
  "get_site_audit_results",
  "get_evidence_chain",
  "open_browser_review",
  "record_browser_review_check",
  "get_assessment_receipt",
  "get_repository_fix_brief",
  "start_related_page_audit",
  "open_diagnostic_mission",
  "submit_runtime_diagnosis",
  "record_diagnostic_blocker",
  "start_site_exploration",
  "get_site_exploration",
  "get_verification_receipt",
  "prepare_site_repair",
  "stage_site_repair",
  "revise_site_repair",
  "get_repair_workspace",
  "record_repository_implementation",
  "start_repair_verification",
];
const CHECKPOINTED_MUTATION_TOOLS = [
  "cancel_site_audit",
  "open_browser_review",
  "record_browser_review_check",
  "start_related_page_audit",
  "open_diagnostic_mission",
  "submit_runtime_diagnosis",
  "record_diagnostic_blocker",
  "start_site_exploration",
  "prepare_site_repair",
  "stage_site_repair",
  "revise_site_repair",
  "record_repository_implementation",
  "start_repair_verification",
];

function completedBrowserReview({ auditId, mission, target = "https://example.com/" }) {
  let review = createBrowserReviewMission({ auditId, mission, target, now: 20 });
  let now = 30;
  while (review.state.nextCheck) {
    const check = review.state.nextCheck;
    review = recordBrowserReviewCheck(review, {
      checkId: check.id,
      outcome: "passed",
      summary: `${check.label} was inspected in the rendered browser.`,
      observations: [`The ${check.id} browser check produced a directly observed fact.`],
    }, "agent", now);
    now += 10;
  }
  return review;
}

test("repository fix brief gives a coding agent bounded evidence without claiming source access", async () => {
  const auditId = "b8b16bf0-913c-40ea-a741-bb4bf76d326b";
  const checkpoint = { auditId, missionRevision: 3 };
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
      missionCheckpoint: checkpoint,
    }),
    getVerificationCandidates: async () => ({
      auditId,
      findingId: finding.id,
      candidates: [],
      missionCheckpoint: checkpoint,
    }),
  };

  const result = await findTool(
    createFrontmendTools(service),
    "get_repository_fix_brief",
  ).execute({ findingId: finding.id });

  assert.equal(result.ok, true);
  assert.equal(result.data.findingId, finding.id);
  assert.equal(result.data.schemaVersion, 2);
  assert.equal(result.data.evidence.occurrenceCount, 1);
  assert.equal(result.data.repositoryHandoff.patchType, "headers");
  assert.equal(result.data.authority.sourceAccess, "coding-agent-only");
  assert.equal(result.data.authority.frontmendChangedTarget, false);
  assert.deepEqual(result.data.missionCheckpoint, checkpoint);
  assert.equal("absolutePath" in result.data.repositoryHandoff, false);
});

test("repository fix brief fails closed when its report and route scope cross revisions", async () => {
  const auditId = "b8b16bf0-913c-40ea-a741-bb4bf76d326b";
  const findingId = "document-content-security-policy";
  const currentCheckpoint = { auditId, missionRevision: 4 };
  const result = await findTool(createFrontmendTools({
    getActiveAudit: () => ({ id: auditId, status: "complete" }),
    getMissionCheckpoint: () => currentCheckpoint,
    getResults: async () => ({
      auditId,
      url: "https://example.com/",
      findings: [{
        id: findingId,
        title: "CSP is missing",
        severity: "low",
        category: "Security",
        source: { provider: "Frontmend document audit", auditId: "csp", strategy: "document" },
      }],
      missionCheckpoint: { auditId, missionRevision: 3 },
    }),
    getVerificationCandidates: async () => ({
      auditId,
      findingId,
      candidates: [],
      missionCheckpoint: currentCheckpoint,
    }),
  }), "get_repository_fix_brief").execute({ findingId });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "MISSION_REFRESH_UNSTABLE");
  assert.deepEqual(result.error.details, { missionCheckpoint: currentCheckpoint });
});

test("repair workspace reads hand the adopted checkpoint to the next WebMCP mutation", async () => {
  const auditId = "b8b16bf0-913c-40ea-a741-bb4bf76d326b";
  const findingId = "color-contrast";
  let stagedRevision = null;
  let audit = null;
  const checkpoint = { auditId, missionRevision: 3 };
  const service = createAuditService({
    transport: {
      start: async ({ url, source, mission }) => {
        audit = {
          id: auditId,
          url,
          source,
          mission,
          status: "complete",
          progress: 100,
          report: { auditId, findings: [{ id: findingId }] },
          missionRevision: 2,
          missionCheckpoint: { auditId, missionRevision: 2 },
        };
        return audit;
      },
      get: async () => ({ ...audit, missionRevision: 3, missionCheckpoint: checkpoint }),
      checkpoint: async () => checkpoint,
      listRepairs: async () => ({
        auditId,
        repairs: [],
        policy: { mode: "review" },
        missionCheckpoint: checkpoint,
      }),
      listDiagnosticMissions: async () => ({ auditId, missions: [], missionCheckpoint: checkpoint }),
      getBrowserReview: async () => ({ auditId, review: null, missionCheckpoint: checkpoint }),
      listExplorations: async () => ({ rootAuditId: auditId, explorations: [], missionCheckpoint: checkpoint }),
      stageRepair: async (_auditId, input, expectedMissionRevision) => {
        stagedRevision = expectedMissionRevision;
        return {
          id: "repair-1",
          auditId,
          findingId: input.findingId,
          status: "draft",
          revision: 1,
          summary: "Adjust contrast.",
          patchType: "css",
          patch: "Update the colour token.",
          risk: "low",
          requiresHumanReview: true,
          verificationImpact: { candidates: [] },
          missionCheckpoint: { auditId, missionRevision: 4 },
        };
      },
    },
  });
  await service.startAudit({ url: "https://example.com/" });
  const tools = createFrontmendTools(service);

  const workspace = await findTool(tools, "get_repair_workspace").execute({});
  assert.equal(workspace.ok, true);
  assert.equal(workspace.data.missionCheckpoint.missionRevision, 3);
  assert.equal(service.getMissionCheckpoint(auditId).missionRevision, 3);

  const staged = await findTool(tools, "stage_site_repair").execute({
    findingId,
    expectedMissionRevision: 3,
  });
  assert.equal(staged.ok, true);
  assert.equal(stagedRevision, 3);
  assert.equal(staged.data.missionCheckpoint.missionRevision, 4);
});

test("a newer direct workspace read publishes one coherent contextual tool state", async () => {
  const auditId = "b8b16bf0-913c-40ea-a741-bb4bf76d326b";
  const checkpoint = { auditId, missionRevision: 3 };
  let currentAudit = null;
  let review = null;
  const report = {
    auditId,
    findings: [],
    documentProfile: { routes: ["/privacy"] },
  };
  const repair = {
    id: "repair-1",
    auditId,
    findingId: "color-contrast",
    status: "draft",
  };
  const exploration = {
    id: "exploration-1",
    rootAuditId: auditId,
    status: "running",
  };
  const service = createAuditService({
    transport: {
      start: async ({ url, source, mission }) => {
        review = createBrowserReviewMission({
          auditId,
          mission,
          report,
          target: url,
          now: 20,
        });
        currentAudit = {
          id: auditId,
          url,
          source,
          mission,
          status: "complete",
          progress: 100,
          report,
          missionRevision: 2,
          missionCheckpoint: { auditId, missionRevision: 2 },
        };
        return currentAudit;
      },
      get: async () => ({ ...currentAudit, missionRevision: 3, missionCheckpoint: checkpoint }),
      checkpoint: async () => checkpoint,
      listRepairs: async () => ({
        auditId,
        repairs: [repair],
        policy: { mode: "review" },
        missionCheckpoint: checkpoint,
      }),
      listDiagnosticMissions: async () => ({ auditId, missions: [], missionCheckpoint: checkpoint }),
      getBrowserReview: async () => ({ auditId, review, missionCheckpoint: checkpoint }),
      listExplorations: async () => ({
        rootAuditId: auditId,
        explorations: [exploration],
        missionCheckpoint: checkpoint,
      }),
    },
  });

  await service.startAudit({
    url: "https://example.com/",
    source: "agent",
    mission: { focusAreas: ["accessibility"] },
  });
  const before = contextualFrontmendToolNames(service);
  assert.ok(before.includes("open_browser_review"));
  assert.equal(before.includes("record_browser_review_check"), false);

  const publications = [];
  const unsubscribe = service.subscribe(() => publications.push(contextualFrontmendToolNames(service)));
  await service.listRepairs(auditId);

  assert.equal(publications.length, 1);
  assert.equal(publications[0].includes("open_browser_review"), false);
  assert.ok(publications[0].includes("record_browser_review_check"));
  assert.ok(publications[0].includes("get_repair_workspace"));
  assert.ok(publications[0].includes("get_site_exploration"));
  unsubscribe();
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
  const activities = [];
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
    startSiteExploration: async (auditId, selection, source) => {
      calls.push(["start", auditId, selection, source]);
      return exploration;
    },
    getSiteExploration: async (auditId, missionId) => {
      calls.push(["get", auditId, missionId]);
      return { ...exploration, status: "complete", progress: 100 };
    },
    getMissionCheckpoint: () => ({ auditId: "audit-1", missionRevision: 5 }),
    beginAgentActivity: (activity) => {
      activities.push(["begin", activity]);
      return `activity-${activities.length}`;
    },
    finishAgentActivity: async (activityId, activity) => {
      activities.push(["finish", activityId, activity]);
    },
  };
  const tools = createFrontmendTools(service);
  const started = await findTool(tools, "start_site_exploration").execute({
    routeCandidateIds: ["route-11111111", "route-22222222"],
    expectedMissionRevision: 1,
  });
  assert.equal(started.ok, true);
  assert.equal(started.data.explorationId, exploration.id);
  assert.deepEqual(calls[0], [
    "start",
    "audit-1",
    { routeCandidateIds: ["route-11111111", "route-22222222"] },
    "agent",
  ]);

  const read = await findTool(tools, "get_site_exploration").execute({});
  assert.equal(read.ok, true);
  assert.equal(read.data.status, "complete");
  assert.match(read.data.reportPath, new RegExp(`${exploration.id}/report$`));
  assert.equal(read.protocol.workspacePath, "/audits/audit-1");
  assert.deepEqual(calls[1], ["get", "audit-1", exploration.id]);
  assert.equal(activities[1][2].auditId, "audit-1");
  assert.equal(activities[1][2].explorationId, exploration.id);
  assert.equal(activities[3][2].auditId, "audit-1");
  assert.equal(activities[3][2].explorationId, exploration.id);
});

test("agent tools use the same audit service as the human interface", async () => {
  const auditId = "b8b16bf0-913c-40ea-a741-bb4bf76d326b";
  const checkpoint = { auditId, missionRevision: 1 };
  const report = {
    auditId,
    schemaVersion: 2,
    findings: [],
    missionCheckpoint: checkpoint,
  };
  const service = createAuditService({
    now: () => 10,
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
        missionRevision: 1,
        missionCheckpoint: checkpoint,
      }),
      results: async () => report,
      checkpoint: async () => checkpoint,
      listRepairs: async () => ({ auditId, repairs: [], missionCheckpoint: checkpoint }),
      listDiagnosticMissions: async () => ({ auditId, missions: [], missionCheckpoint: checkpoint }),
      getBrowserReview: async () => ({ auditId, review: null, missionCheckpoint: checkpoint }),
      listExplorations: async () => ({ rootAuditId: auditId, explorations: [], missionCheckpoint: checkpoint }),
    },
  });
  const tools = createFrontmendTools(service);
  const started = await findTool(tools, "start_site_audit").execute({
    url: "removemyexif.com",
    intent: "assess",
    focusAreas: ["accessibility", "seo"],
    maxPriorities: 3,
  });

  assert.equal(started.ok, true);
  assert.equal(started.data.workspacePath, `/audits/${started.data.id}`);
  assert.equal(service.getActiveAudit().id, started.data.id);
  assert.equal(service.getActiveAudit().source, "agent");
  assert.deepEqual(started.data.mission.focusAreas, ["accessibility", "seo"]);
  assert.equal(started.data.nextAction.tool, "check_site_audit_progress");

  const progress = await findTool(tools, "check_site_audit_progress").execute({});
  assert.equal(progress.data.status, "complete");
  assert.equal(progress.data.attempt, 2);
  const results = await findTool(tools, "get_site_audit_results").execute({});
  assert.equal(results.ok, true);
  assert.equal(results.data.auditId, started.data.id);
  assert.equal(results.data.missionState.assessmentComplete, false);
  assert.equal(results.data.recommendedNextAction.tool, "open_browser_review");
  assert.equal(results.data.resultProjection.mode, "persisted-mission");
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

test("assessment receipt tool returns one portable completion artifact without broadening authority", async () => {
  const auditId = "b8b16bf0-913c-40ea-a741-bb4bf76d326b";
  const receipt = {
    auditId,
    target: "https://example.com/",
    finalUrl: "https://example.com/",
    completedAt: 1_777_000_000_000,
    engine: { mode: "live-pagespeed", provider: "PageSpeed Insights / Lighthouse" },
    mission: { intent: "assess", focusAreas: ["accessibility", "seo"], requestedBy: "agent" },
    assessment: { complete: true, matchingFindingCount: 0, priorityCount: 0, categoryScores: {} },
    priorities: [],
    authority: {
      deploymentProved: false,
      resolutionProved: false,
      boundary: "This receipt proves a completed bounded assessment, not repair approval, implementation, deployment, or resolution.",
    },
  };
  const calls = [];
  const service = {
    getActiveAudit: () => ({ id: auditId, status: "complete" }),
    getAssessmentReceipt: (id) => {
      calls.push(id);
      return receipt;
    },
    recordAgentActivity() {},
  };
  const tool = findTool(createFrontmendTools(service), "get_assessment_receipt");
  const result = await tool.execute({});

  assert.equal(result.ok, true);
  assert.deepEqual(calls, [auditId]);
  assert.equal(result.data.assessment.complete, true);
  assert.equal(result.data.authority.deploymentProved, false);
  assert.equal(result.data.downloadPath, `/api/audits/${auditId}/assessment`);
  assert.equal(result.data.format, "text/markdown");
  assert.match(result.data.markdown, /^# Frontmend assessment receipt/m);
  assert.equal(tool.annotations.readOnlyHint, true);
  assert.equal(tool.annotations.untrustedContentHint, true);
});

test("repair tools use visible audit context while preserving explicit repair IDs", async () => {
  const calls = [];
  let repair = {
    id: "3e8fe191-1f46-4f1b-92ac-492a5d73bb24",
    auditId: "b8b16bf0-913c-40ea-a741-bb4bf76d326b",
    findingId: "document-content-security-policy",
    findingTitle: "No Content Security Policy header was observed",
    findingSource: {
      provider: "Lighthouse",
      auditId: "color-contrast",
      strategy: "mobile",
    },
    findingScope: {
      occurrenceCount: 2,
      occurrencesOmitted: 0,
      sources: [
        { provider: "Lighthouse", auditId: "color-contrast", strategy: "mobile" },
        { provider: "Lighthouse", auditId: "color-contrast", strategy: "desktop" },
      ],
    },
    repositoryPlan: {
      files: ["frontend/next.config.ts", "frontend/tests/headers.test.ts"],
      checks: ["bun test", "bun run build"],
      source: "agent",
      sourceChangedByFrontmend: false,
    },
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
      return {
        auditId,
        repairs: [repair],
        policy: { mode: "review", remainingAutoApprovals: 0, deploymentAttestation: "person-only" },
      };
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
    repositoryFiles: repair.repositoryPlan.files,
    repositoryChecks: repair.repositoryPlan.checks,
  });
  assert.equal(staged.ok, true);
  assert.equal(staged.data.requiresHumanReview, true);
  assert.equal(staged.data.findingScope.occurrenceCount, 2);
  assert.deepEqual(staged.data.findingScope.sources.map((source) => source.strategy), ["mobile", "desktop"]);
  assert.deepEqual(staged.data.repositoryPlan.files, repair.repositoryPlan.files);
  assert.equal("patch" in staged.data, false);
  assert.equal(staged.data.mission.state, "awaiting-human-review");
  assert.deepEqual(staged.data.mission.nextActions, [{ id: "review_in_ui", actor: "person" }]);
  assert.equal(calls[0][2].source, "agent");

  const workspace = await findTool(tools, "get_repair_workspace").execute({
    repairId: repair.id,
  });
  assert.equal(workspace.data.repairs[0].patch, repair.patch);
  assert.equal(workspace.data.policy.mode, "review");
  assert.equal(workspace.data.repairs[0].findingScope.occurrenceCount, 2);
  assert.deepEqual(workspace.data.repairs[0].repositoryPlan.checks, ["bun test", "bun run build"]);
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
    repositoryFiles: ["frontend/next.config.ts", "frontend/tests/csp.test.ts"],
    repositoryChecks: ["bun test", "bun run build"],
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
  assert.equal(revised.data.findingScope.occurrenceCount, 2);
  assert.equal(revised.data.repositoryPlan.sourceChangedByFrontmend, false);
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
      agentReported: true,
      sourceChangedByFrontmend: false,
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
  assert.equal(readyWorkspace.data.repairs[0].mission.implementationEvidence, "checks-passed");

  const verification = await findTool(tools, "start_repair_verification").execute({
    auditId: repair.auditId,
    repairId: repair.id,
  });
  assert.equal(verification.ok, true);
  assert.match(verification.data.workspacePath, /^\/audits\//);
  assert.deepEqual(calls.at(-1), ["verify", repair.auditId, repair.id]);
});

test("natural accessibility and SEO requests return three deduplicated priorities", async () => {
  const auditId = "b8b16bf0-913c-40ea-a741-bb4bf76d326b";
  const finding = (id, auditIdValue, strategy, severity, focusAreas) => ({
    id,
    title: id.includes("contrast") ? "Text contrast is too low" : "The page is missing a meta description",
    severity,
    category: focusAreas.includes("accessibility") ? "Accessibility" : "SEO",
    focusAreas,
    evidence: "Measured failure",
    repair: "Repair the measured rule.",
    source: { provider: "Lighthouse", auditId: auditIdValue, strategy },
    ...(id.includes("contrast") ? { diagnosticEvidence: { kind: "contrast-nodes" } } : {}),
  });
  const report = {
    auditId,
    findings: [
      finding("mobile-color-contrast", "color-contrast", "mobile", "medium", ["accessibility"]),
      finding("desktop-color-contrast", "color-contrast", "desktop", "medium", ["accessibility"]),
      finding("mobile-meta-description", "meta-description", "mobile", "medium", ["seo"]),
    ],
    viewports: [
      { id: "mobile", scores: { accessibility: 92, seo: 88 } },
      { id: "desktop", scores: { accessibility: 96, seo: 100 } },
    ],
  };
  const mission = {
    schemaVersion: 1,
    intent: "assess",
    focusAreas: ["accessibility", "seo"],
    maxPriorities: 3,
    requestedBy: "agent",
    requestedAt: 10,
    repairPreparation: null,
  };
  let diagnosticMissions = [];
  let browserReview = null;
  const service = {
    getActiveAudit: () => ({ id: auditId, status: "complete", report, mission }),
    getResults: async () => report,
    getDiagnosticMissions: () => diagnosticMissions,
    getBrowserReview: () => browserReview,
    getRepairs: () => [],
  };
  const tool = findTool(createFrontmendTools(service), "get_site_audit_results");
  const result = await tool.execute({});

  assert.equal(result.ok, true);
  assert.deepEqual(result.data.requestedFocusAreas, ["accessibility", "seo"]);
  assert.equal(result.data.priorities.length, 2);
  assert.equal(result.data.priorities[0].occurrenceCount, 2);
  assert.deepEqual(result.data.priorities[0].affectedStrategies, ["mobile", "desktop"]);
  assert.equal(result.data.priorities[0].diagnosticMissionRequired, true);
  assert.deepEqual(result.data.recommendedNextAction, {
    tool: "open_browser_review",
    reason: "The agent-started accessibility or SEO assessment requires structured rendered-browser evidence beyond provider measurement.",
  });
  assert.deepEqual(result.data.focusSummary.categoryScores, { accessibility: 94, seo: 94 });
  assert.equal(result.data.missionState.auditComplete, true);
  assert.equal(result.data.missionState.assessmentComplete, false);
  assert.deepEqual(result.data.missionState.nextAction.input, {});
  assert.equal(result.data.resultProjection.mode, "persisted-mission");

  browserReview = completedBrowserReview({ auditId, mission });
  const browserContributed = await tool.execute({});
  assert.equal(browserContributed.data.browserReview.state.status, "complete");
  assert.deepEqual(browserContributed.data.recommendedNextAction, {
    tool: "open_diagnostic_mission",
    findingId: "mobile-color-contrast",
    reason: "This measured symptom needs browser reproduction and repository ownership before the assessment is complete.",
  });

  diagnosticMissions = [{
    id: "diagnostic-1",
    findingId: "mobile-color-contrast",
    blocker: {
      reason: "not-reproduced",
      summary: "The measured contrast state was not present in the current runtime.",
      agentReported: true,
    },
    state: { state: "blocked" },
  }];
  const blocked = await tool.execute({});
  assert.equal(blocked.data.priorities[0].evidenceState, "diagnosis-blocked");
  assert.equal(blocked.data.priorities[0].diagnosticBlocker.reason, "not-reproduced");
  assert.equal(blocked.data.missionState.status, "blocked");
  assert.equal(blocked.data.missionState.assessmentComplete, false);
  assert.equal(blocked.data.recommendedNextAction, null);

  diagnosticMissions = [{
    id: "diagnostic-1",
    findingId: "mobile-color-contrast",
    state: { state: "ready-for-repair" },
  }];
  const contributed = await tool.execute({});
  assert.equal(contributed.data.priorities[0].evidenceState, "diagnosis-contributed");
  assert.equal(contributed.data.missionState.assessmentComplete, true);
  assert.equal(contributed.data.missionState.nextAction, null);

  const override = await tool.execute({ focusAreas: ["seo"], maxPriorities: 1 });
  assert.equal(override.data.resultProjection.mode, "read-only-override");
  assert.equal(override.data.resultProjection.changedPersistedMission, false);
  assert.deepEqual(override.data.requestedFocusAreas, ["seo"]);
  assert.deepEqual(mission.focusAreas, ["accessibility", "seo"]);
});

test("result, receipt, and repository-brief tools derive from one coherent restored revision", async () => {
  const auditId = "b8b16bf0-913c-40ea-a741-bb4bf76d326b";
  const findingId = "mobile-color-contrast";
  const mission = {
    schemaVersion: 1,
    intent: "assess",
    focusAreas: ["accessibility"],
    maxPriorities: 3,
    requestedBy: "agent",
    requestedAt: 10,
    repairPreparation: null,
  };
  const report = {
    auditId,
    url: "https://example.com/",
    finalUrl: "https://example.com/",
    engine: { mode: "live-lighthouse", provider: "PageSpeed Insights" },
    findings: [{
      id: findingId,
      title: "Text contrast is too low",
      severity: "medium",
      category: "Accessibility",
      focusAreas: ["accessibility"],
      evidence: "Measured failure",
      repair: "Repair the measured rule.",
      diagnosticEvidence: { kind: "contrast-nodes" },
      source: { provider: "Lighthouse", auditId: "color-contrast", strategy: "mobile" },
    }],
    viewports: [{ id: "mobile", scores: { accessibility: 92 } }],
  };
  const checkpoint = { auditId, missionRevision: 3 };
  const review = completedBrowserReview({ auditId, mission });
  const diagnosis = {
    id: "diagnostic-1",
    auditId,
    findingId,
    diagnosis: {
      revision: 1,
      summary: "The measured text inherits the low-contrast secondary token.",
      reproduction: "Render the page at the measured mobile viewport and inspect the affected text.",
      observations: [{ kind: "browser", detail: "The affected text uses the secondary foreground token." }],
      sourceLocations: [{ file: "src/styles.css", line: 12, reason: "Owns the secondary foreground token." }],
      verificationChecks: ["Rerun the exact contrast rule."],
      confidence: "high",
      source: "agent",
      agentReported: true,
      reportedAt: 20,
    },
    state: { state: "ready-for-repair" },
  };
  const currentAudit = {
    id: auditId,
    url: report.url,
    source: "agent",
    mission,
    status: "complete",
    progress: 100,
    report,
    missionRevision: 3,
    missionCheckpoint: checkpoint,
  };
  let startRevision = 2;
  const service = createAuditService({
    transport: {
      start: async () => ({
        ...currentAudit,
        missionRevision: startRevision,
        missionCheckpoint: { auditId, missionRevision: startRevision },
      }),
      get: async () => currentAudit,
      results: async () => ({ ...report, missionCheckpoint: checkpoint }),
      checkpoint: async () => checkpoint,
      listRepairs: async () => ({ auditId, repairs: [], policy: { mode: "review" }, missionCheckpoint: checkpoint }),
      listDiagnosticMissions: async () => ({ auditId, missions: [diagnosis], missionCheckpoint: checkpoint }),
      getBrowserReview: async () => ({ auditId, review, missionCheckpoint: checkpoint }),
      listExplorations: async () => ({ rootAuditId: auditId, explorations: [], missionCheckpoint: checkpoint }),
      verificationCandidates: async () => ({ auditId, findingId, candidates: [], missionCheckpoint: checkpoint }),
    },
  });
  await service.startAudit({
    url: report.url,
    source: "agent",
    mission: { intent: "assess", focusAreas: ["accessibility"], maxPriorities: 3 },
  });

  const result = await findTool(createFrontmendTools(service), "get_site_audit_results").execute({});

  assert.equal(result.ok, true);
  assert.equal(result.data.missionCheckpoint.missionRevision, 3);
  assert.equal(result.data.browserReview.state.status, "complete");
  assert.equal(result.data.priorities[0].evidenceState, "diagnosis-contributed");
  assert.equal(result.data.missionState.assessmentComplete, true);
  assert.equal(result.data.missionState.nextAction, null);
  assert.ok(contextualFrontmendToolNames(service).includes("get_assessment_receipt"));
  assert.equal(contextualFrontmendToolNames(service).includes("submit_runtime_diagnosis"), false);

  service.reset();
  startRevision = 3;
  await service.startAudit({
    url: report.url,
    source: "agent",
    mission: { intent: "assess", focusAreas: ["accessibility"], maxPriorities: 3 },
  });
  assert.equal(service.getBrowserReview(auditId), null);
  const receipt = await findTool(createFrontmendTools(service), "get_assessment_receipt").execute({});
  assert.equal(receipt.ok, true, JSON.stringify(receipt));
  assert.equal(receipt.data.missionCheckpoint.missionRevision, 3);
  assert.equal(receipt.data.assessment.complete, true);
  assert.equal(service.getBrowserReview(auditId).state.status, "complete");

  service.reset();
  await service.startAudit({
    url: report.url,
    source: "agent",
    mission: { intent: "assess", focusAreas: ["accessibility"], maxPriorities: 3 },
  });
  assert.equal(service.getBrowserReview(auditId), null);
  const brief = await findTool(createFrontmendTools(service), "get_repository_fix_brief").execute({ findingId });
  assert.equal(brief.ok, true);
  assert.equal(brief.data.missionCheckpoint.missionRevision, 3);
  assert.equal(service.getBrowserReview(auditId).state.status, "complete");
});

test("contextual WebMCP always publishes the authoritative mission action", () => {
  const auditId = "mission-action-invariant";
  const mission = {
    schemaVersion: 1,
    intent: "assess",
    focusAreas: ["accessibility"],
    maxPriorities: 3,
    requestedBy: "agent",
    requestedAt: 10,
    repairPreparation: null,
  };
  const report = {
    auditId,
    engine: { mode: "live-lighthouse", provider: "PageSpeed Insights" },
    findings: [{
      id: "mobile-color-contrast",
      title: "Text contrast is too low",
      severity: "medium",
      category: "Accessibility",
      focusAreas: ["accessibility"],
      evidence: "The retained foreground and background colours do not meet the measured threshold.",
      repair: "Adjust the owned colour token after diagnosis.",
      diagnosticEvidence: { kind: "contrast-nodes" },
      source: { provider: "Lighthouse", auditId: "color-contrast", strategy: "mobile" },
    }],
    viewports: [{ id: "mobile", scores: { accessibility: 97 } }],
  };
  const browserReview = completedBrowserReview({ auditId, mission });
  const diagnosticMissions = [{
    id: "diagnostic-1",
    findingId: "mobile-color-contrast",
    state: { state: "diagnosis-recording" },
  }];
  const service = {
    getActiveAudit: () => ({ id: auditId, status: "complete", mission, report }),
    getBrowserReview: () => browserReview,
    getRepairs: () => [],
    getDiagnosticMissions: () => diagnosticMissions,
    getSiteExplorations: () => [],
  };
  const state = deriveAuditMissionState({ report, mission, browserReview, diagnosticMissions });
  const contextual = contextualFrontmendToolNames(service);

  assert.equal(state.nextAction.tool, "submit_runtime_diagnosis");
  assert.ok(contextual.includes(state.nextAction.tool));
});

test("browser review tools turn one exact browser task at a time into attributed evidence", async () => {
  const auditId = "b8b16bf0-913c-40ea-a741-bb4bf76d326b";
  const mission = {
    schemaVersion: 1,
    intent: "assess",
    focusAreas: ["seo"],
    maxPriorities: 3,
    requestedBy: "agent",
    requestedAt: 10,
    repairPreparation: null,
  };
  let review = null;
  const calls = [];
  const service = {
    getActiveAudit: () => ({ id: auditId, status: "complete", mission }),
    openBrowserReview: async (id) => {
      calls.push(["open", id]);
      review ??= createBrowserReviewMission({
        auditId,
        mission,
        target: "https://example.com/",
        now: 20,
      });
      return review;
    },
    recordBrowserReviewCheck: async (id, reviewId, input, source) => {
      calls.push(["record", id, reviewId, input.checkId, source]);
      review = recordBrowserReviewCheck(review, input, source, 30 + review.results.length);
      return review;
    },
    getAuditMissionState: () => ({ assessmentComplete: review?.state.complete ?? false }),
  };
  const tools = createFrontmendTools(service);
  const opened = await findTool(tools, "open_browser_review").execute({});
  assert.equal(opened.ok, true);
  assert.equal(opened.data.nextAction.browserTask.id, "rendered-structure");
  assert.match(opened.data.nextAction.browserTask.boundary, /Do not repeat the provider score/);

  const first = await findTool(tools, "record_browser_review_check").execute({
    reviewId: review.id,
    checkId: "rendered-structure",
    outcome: "passed",
    summary: "The rendered page exposes a coherent structure.",
    observations: ["One primary heading and a named main landmark are rendered."],
  });
  assert.equal(first.ok, true);
  assert.equal(first.data.acceptedCheck.agentReported, true);
  assert.equal(first.data.nextAction.browserTask.id, "search-discovery");

  const final = await findTool(tools, "record_browser_review_check").execute({
    reviewId: review.id,
    checkId: "search-discovery",
    outcome: "issue",
    summary: "Important supporting guidance is not discoverable from rendered navigation.",
    observations: ["No same-site link reaches the product guide."],
    findings: [{
      title: "Product guidance has no rendered discovery path",
      severity: "medium",
      focusArea: "seo",
      evidence: "The header and footer expose no link to the product guide.",
      suggestedRepair: "Add a descriptive, crawlable link to the guide.",
      element: "header nav, footer nav",
    }],
  });
  assert.equal(final.ok, true);
  assert.equal(final.data.browserReview.state.status, "complete");
  assert.equal(final.data.browserReview.findings[0].source.provider, "Frontmend browser review");
  assert.equal(final.data.browserReview.findings[0].browserReviewEvidence.provenance, "agent-reported-browser");
  assert.equal(final.data.nextAction.tool, "get_site_audit_results");
  assert.deepEqual(calls.map((call) => call[0]), ["open", "record", "record"]);
});

test("browser search discovery contributes bounded routes and receives the minted exploration action", async () => {
  const auditId = "b8b16bf0-913c-40ea-a741-bb4bf76d326b";
  let captured = null;
  const checkpoint = {
    auditId,
    missionRevision: 8,
    action: {
      tool: "start_site_exploration",
      input: { routeCandidateIds: ["route-12345678", "route-87654321"] },
      reason: "Start the server-validated retained routes.",
    },
  };
  const service = {
    getActiveAudit: () => ({ id: auditId, status: "complete", missionRevision: 7 }),
    getMissionCheckpoint: () => checkpoint,
    getAuditMissionState: () => ({ assessmentComplete: false }),
    recordBrowserReviewCheck: async (id, reviewId, input, source, revision) => {
      captured = { id, reviewId, input, source, revision };
      return {
        id: reviewId,
        auditId: id,
        purpose: "assessment",
        results: [{ checkId: input.checkId, observedRoutes: [...input.observedRoutes] }],
        state: { status: "complete", complete: true, nextCheck: null },
        authority: { provenance: "agent-reported-browser" },
        missionCheckpoint: checkpoint,
      };
    },
  };
  const tool = findTool(createFrontmendTools(service), "record_browser_review_check");
  const result = await tool.execute({
    reviewId: "browser-review-1",
    checkId: "search-discovery",
    outcome: "passed",
    summary: "Rendered navigation exposes projects and services.",
    observations: ["Named same-site Projects and Services links are rendered."],
    observedRoutes: ["/projects", "/services"],
    expectedMissionRevision: 7,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(captured.input.observedRoutes, ["/projects", "/services"]);
  assert.equal(captured.revision, 7);
  assert.deepEqual(result.data.nextAction, {
    tool: "start_site_exploration",
    input: { auditId, routeCandidateIds: ["route-12345678", "route-87654321"] },
    reason: "Start the server-validated retained routes.",
  });
});

test("a browser-capable agent adopts a person-started assessment under the same audit ID", async () => {
  const auditId = "b8b16bf0-913c-40ea-a741-bb4bf76d326b";
  const mission = {
    schemaVersion: 1,
    intent: "assess",
    focusAreas: [],
    maxPriorities: 3,
    requestedBy: "human",
    requestedAt: 10,
    repairPreparation: null,
  };
  const report = {
    auditId,
    url: "https://example.com/",
    finalUrl: "https://example.com/",
    engine: { mode: "live-document", provider: "Frontmend live document" },
    findings: [],
    viewports: [],
  };
  let review = null;
  const calls = [];
  const service = {
    getActiveAudit: () => ({ id: auditId, status: "complete", missionRevision: 4, mission, report }),
    getBrowserReview: () => review,
    getRepairs: () => [],
    getDiagnosticMissions: () => [],
    getSiteExplorations: () => [],
    getMissionCheckpoint: () => ({ auditId, missionRevision: 4 }),
    openBrowserReview: async (id, options, revision) => {
      calls.push({ id, options, revision });
      review = createBrowserReviewMission({
        auditId: id,
        mission,
        report,
        target: report.finalUrl,
        source: options.source,
        focusAreas: options.focusAreas,
        now: 20,
      });
      return review;
    },
  };

  const contextual = contextualFrontmendToolNames(service);
  assert.ok(contextual.includes("open_browser_review"));
  assert.equal(contextual.includes("record_browser_review_check"), false);

  const opened = await findTool(createFrontmendTools(service), "open_browser_review").execute({
    focusAreas: ["accessibility", "seo"],
    expectedMissionRevision: 4,
  });

  assert.equal(opened.ok, true);
  assert.equal(opened.data.auditId, auditId);
  assert.equal(opened.data.browserReview.auditId, auditId);
  assert.equal(opened.data.adoption.mode, "human-to-agent");
  assert.equal(opened.data.adoption.originalMissionActor, "human");
  assert.equal(opened.data.adoption.restarted, false);
  assert.deepEqual(calls, [{
    id: auditId,
    options: { source: "agent", focusAreas: ["accessibility", "seo"] },
    revision: 4,
  }]);
  assert.equal(mission.requestedBy, "human");
  assert.ok(contextualFrontmendToolNames(service).includes("record_browser_review_check"));
});

test("a withdrawn untouched handoff returns contextual WebMCP to read-only assessment tools", () => {
  const auditId = "withdrawn-audit";
  const mission = {
    schemaVersion: 1,
    intent: "assess",
    focusAreas: ["seo"],
    maxPriorities: 3,
    requestedBy: "human",
    requestedAt: 10,
    repairPreparation: null,
  };
  const report = {
    auditId,
    url: "https://example.com/",
    finalUrl: "https://example.com/",
    engine: { mode: "live-document", provider: "Frontmend live document" },
    findings: [],
    viewports: [],
  };
  const opened = createBrowserReviewMission({
    auditId,
    mission,
    report,
    target: report.finalUrl,
    source: "person",
    now: 20,
  });
  const review = withdrawBrowserReview(opened, "person", 30);
  const service = {
    getActiveAudit: () => ({ id: auditId, status: "complete", missionRevision: 3, mission, report }),
    getBrowserReview: () => review,
    getRepairs: () => [],
    getDiagnosticMissions: () => [],
    getSiteExplorations: () => [],
  };
  const contextual = contextualFrontmendToolNames(service);

  assert.ok(contextual.includes("get_site_audit_results"));
  assert.ok(contextual.includes("get_assessment_receipt"));
  assert.equal(contextual.includes("open_browser_review"), false);
  assert.equal(contextual.includes("record_browser_review_check"), false);
  assert.equal(createFrontmendTools(service).length, FRONTMEND_TOOL_COUNT);
});

test("contextual WebMCP withholds a verification receipt until exact replay and browser guardrails complete", async () => {
  const auditId = "c1de4f26-c222-4e44-a7e5-884ba6d9fe9a";
  const verificationContext = {
    browserReplay: {
      required: true,
      status: "not-opened",
      baseline: {
        findingId: "browser:responsive-reflow:01",
        title: "Primary action clips at narrow widths",
        category: "Accessibility",
        focusArea: "accessibility",
        selector: "button.primary-action",
        evidence: "The right edge of the primary action is clipped at the mobile viewport.",
        repair: "Allow the action row to wrap within the viewport.",
        source: {
          provider: "Frontmend browser review",
          auditId: "responsive-reflow:01",
          strategy: "mobile",
        },
        browserReviewEvidence: {
          reviewId: "baseline-review",
          checkId: "responsive-reflow",
          checkLabel: "Responsive reflow",
          reportedAt: 10,
        },
      },
    },
    browserGuardrails: [{
      checkId: "primary-journey",
      label: "Primary journey",
      focusArea: "accessibility",
      viewport: "desktop",
      summary: "The primary journey completed before repair.",
    }],
  };
  let review = null;
  const audit = {
    id: auditId,
    status: "complete",
    report: {
      auditId,
      findings: [],
      verification: {
        status: "inconclusive",
        browserReplay: verificationContext.browserReplay,
        browserGuardrails: verificationContext.browserGuardrails.map((guardrail) => ({
          ...guardrail,
          status: "not-opened",
          outcome: null,
        })),
      },
    },
  };
  const service = {
    getActiveAudit: () => audit,
    getBrowserReview: () => review,
    getRepairs: () => [],
    getDiagnosticMissions: () => [],
    getSiteExplorations: () => [],
    openBrowserReview: async () => {
      review = createBrowserVerificationReview({
        auditId,
        verification: verificationContext,
        target: "https://example.com/",
        now: 20,
      });
      return review;
    },
    recordBrowserReviewCheck: async (_auditId, _reviewId, input, source) => {
      review = recordBrowserReviewCheck(review, input, source, 30);
      const exact = review.results.find((result) => result.checkId === "fresh-browser-replay");
      const guardrail = review.results.find((result) => result.checkId === "fresh-browser-guardrail-1");
      audit.report.verification = {
        ...audit.report.verification,
        status: !review.state.complete
          ? "inconclusive"
          : exact?.outcome === "issue"
            ? "still-present"
            : guardrail?.outcome === "issue"
              ? "regression"
              : "resolved",
        browserReplay: {
          ...verificationContext.browserReplay,
          status: exact ? "complete" : "in-progress",
          outcome: exact?.outcome ?? null,
        },
        browserGuardrails: verificationContext.browserGuardrails.map((baseline) => ({
          ...baseline,
          status: guardrail ? "complete" : "in-progress",
          outcome: guardrail?.outcome ?? null,
        })),
      };
      return review;
    },
  };
  assert.deepEqual(contextualFrontmendToolNames(service), [
    "get_mission_summary",
    "get_site_audit_results",
    "open_browser_review",
  ]);

  const tools = createFrontmendTools(service);
  const opened = await findTool(tools, "open_browser_review").execute({});
  assert.equal(opened.data.nextAction.browserTask.id, "fresh-browser-replay");
  assert.match(opened.data.nextAction.browserTask.boundary, /Report passed only/i);
  assert.deepEqual(contextualFrontmendToolNames(service), [
    "get_mission_summary",
    "get_site_audit_results",
    "record_browser_review_check",
  ]);

  const completed = await findTool(tools, "record_browser_review_check").execute({
    reviewId: review.id,
    checkId: "fresh-browser-replay",
    outcome: "passed",
    summary: "The entire primary action is visible at the retained mobile viewport.",
    observations: ["No horizontal clipping is visible around the primary action."],
  });
  assert.equal(completed.data.verificationComplete, false);
  assert.equal(completed.data.nextAction.tool, "record_browser_review_check");
  assert.equal(completed.data.nextAction.input.checkId, "fresh-browser-guardrail-1");
  assert.deepEqual(contextualFrontmendToolNames(service), [
    "get_mission_summary",
    "get_site_audit_results",
    "record_browser_review_check",
  ]);

  const guarded = await findTool(tools, "record_browser_review_check").execute({
    reviewId: review.id,
    checkId: "fresh-browser-guardrail-1",
    outcome: "passed",
    summary: "The primary journey still reaches completion.",
    observations: ["The original primary action reaches the same completion state."],
  });
  assert.equal(guarded.data.verificationComplete, true);
  assert.equal(guarded.data.nextAction.tool, "get_verification_receipt");
  assert.deepEqual(contextualFrontmendToolNames(service), [
    "get_mission_summary",
    "get_site_audit_results",
    "get_verification_receipt",
  ]);
});

test("prepare repair tool records only explicit finding intent", async () => {
  const auditId = "b8b16bf0-913c-40ea-a741-bb4bf76d326b";
  const calls = [];
  const preparedMission = {
    schemaVersion: 1,
    intent: "prepare-fix",
    focusAreas: ["accessibility"],
    maxPriorities: 3,
    requestedBy: "agent",
    requestedAt: 10,
    repairPreparation: {
      findingId: "mobile-color-contrast",
      requestedBy: "agent",
      requestedAt: 20,
    },
  };
  const service = {
    getActiveAudit: () => ({ id: auditId, status: "complete" }),
    prepareRepair: async (...args) => {
      calls.push(args);
      return {
        mission: preparedMission,
        missionState: {
          status: "action-available",
          nextAction: { tool: "stage_site_repair", input: { findingId: "mobile-color-contrast" } },
        },
      };
    },
  };
  const tool = findTool(createFrontmendTools(service), "prepare_site_repair");
  const prepared = await tool.execute({ findingId: "mobile-color-contrast" });
  assert.equal(prepared.ok, true);
  assert.deepEqual(calls, [[auditId, "mobile-color-contrast", "agent", 1]]);
  assert.equal(prepared.data.authority.recordedIntentOnly, true);
  assert.equal(prepared.data.authority.approved, false);
  assert.equal(prepared.data.authority.deployed, false);
  assert.equal(prepared.data.nextAction.tool, "stage_site_repair");

  const rejected = await tool.execute({
    findingId: "mobile-color-contrast",
    patch: "body { color: black; }",
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, "INVALID_INPUT");
  assert.equal(calls.length, 1);
});

test("repair tools preserve an exact multi-finding package without broadening authority", async () => {
  const auditId = "b8b16bf0-913c-40ea-a741-bb4bf76d326b";
  const findingIds = ["mobile-errors-in-console", "mobile-color-contrast"];
  const prepareCalls = [];
  const stageCalls = [];
  const service = {
    getActiveAudit: () => ({ id: auditId, status: "complete" }),
    prepareRepair: async (...args) => {
      prepareCalls.push(args);
      return {
        mission: {
          schemaVersion: 2,
          intent: "prepare-fix",
          focusAreas: ["reliability", "accessibility"],
          maxPriorities: 3,
          scope: "page",
          routeLimit: 3,
          requestedBy: "agent",
          requestedAt: 10,
          repairPreparation: {
            findingId: findingIds[0],
            findingIds,
            requestedBy: "agent",
            requestedAt: 20,
          },
        },
        missionState: {
          status: "action-available",
          nextAction: { tool: "stage_site_repair", input: { findingId: findingIds[0], findingIds } },
        },
      };
    },
    stageRepair: async (_auditId, input) => {
      stageCalls.push(input);
      return {
        id: "repair-package",
        auditId,
        findingId: findingIds[0],
        findingIds,
        findingPackage: {
          schemaVersion: 1,
          primaryFindingId: findingIds[0],
          items: findingIds.map((findingId) => ({ findingId })),
        },
        findingScope: { sources: [] },
        status: "draft",
        revision: 1,
        summary: "Repair both diagnosed symptoms in one reviewed change.",
        patchType: "guidance",
        risk: "medium",
        requiresHumanReview: true,
        approval: null,
        automation: {
          eligible: false,
          reasons: ["multi-finding packages require explicit review"],
          policyMode: "auto-low-risk",
        },
      };
    },
  };
  const tools = createFrontmendTools(service);
  const prepared = await findTool(tools, "prepare_site_repair").execute({
    findingId: findingIds[0],
    findingIds,
  });
  assert.equal(prepared.ok, true);
  assert.deepEqual(prepareCalls, [[auditId, findingIds[0], "agent", 1, findingIds]]);
  assert.deepEqual(prepared.data.findingIds, findingIds);

  const staged = await findTool(tools, "stage_site_repair").execute({
    findingId: findingIds[0],
    findingIds,
  });
  assert.equal(staged.ok, true);
  assert.deepEqual(stageCalls[0].findingIds, findingIds);
  assert.deepEqual(staged.data.findingIds, findingIds);
  assert.equal(staged.data.requiresHumanReview, true);
  assert.equal(staged.data.approval, null);
  assert.match(staged.data.automation.reasons.join(" "), /multi-finding packages require explicit review/i);
});

test("repair preparation updates contextual tools without exposing person-only authority", async () => {
  const auditId = "b8b16bf0-913c-40ea-a741-bb4bf76d326b";
  const finding = {
    id: "document-description",
    title: "The document has no description",
    severity: "medium",
    focusAreas: ["seo"],
    source: { provider: "Frontmend document audit", auditId: "description", strategy: "document" },
  };
  let audit;
  let notifications = 0;
  const service = createAuditService({
    now: () => 10,
    transport: {
      start: async ({ url, source, mission }) => {
        audit = {
          id: auditId,
          url,
          source,
          mission,
          status: "complete",
          phase: "complete",
          progress: 100,
          report: { auditId, findings: [finding] },
        };
        return audit;
      },
      prepareRepair: async (_auditId, findingId, source) => {
        audit = {
          ...audit,
          mission: {
            ...audit.mission,
            intent: "prepare-fix",
            repairPreparation: { findingId, requestedBy: source, requestedAt: 20 },
          },
        };
        return {
          audit,
          mission: audit.mission,
          missionState: {
            status: "action-available",
            nextAction: { tool: "stage_site_repair", input: { findingId } },
          },
          missionCheckpoint: { auditId, missionRevision: 2 },
        };
      },
    },
  });
  service.subscribe(() => {
    notifications += 1;
  });
  await service.startAudit({ url: "example.com", source: "human", mission: { focusAreas: ["seo"] } });
  assert.deepEqual(contextualFrontmendToolNames(service), [
    "get_mission_summary",
    "get_site_audit_results",
    "get_evidence_chain",
    "open_browser_review",
    "get_repository_fix_brief",
    "prepare_site_repair",
  ]);

  const prepared = await findTool(
    createFrontmendTools(service),
    "prepare_site_repair",
  ).execute({ findingId: finding.id });
  assert.equal(prepared.ok, true);
  assert.equal(prepared.data.authority.recordedIntentOnly, true);
  assert.equal(prepared.data.authority.approved, false);
  assert.equal(prepared.data.authority.deployed, false);
  assert.deepEqual(contextualFrontmendToolNames(service), [
    "get_mission_summary",
    "get_site_audit_results",
    "get_evidence_chain",
    "get_repository_fix_brief",
    "prepare_site_repair",
    "stage_site_repair",
  ]);
  assert.ok(notifications >= 2);
  assert.equal(TOOL_NAMES.some((name) => /(approve|attest|deploy|repair_policy)/.test(name)), false);
});

test("staged repair tools disclose delegated auto authority and the next agent action", async () => {
  const auditId = "b8b16bf0-913c-40ea-a741-bb4bf76d326b";
  const repairId = "3e8fe191-1f46-4f1b-92ac-492a5d73bb24";
  const autoRepair = {
    id: repairId,
    auditId,
    findingId: "mobile-color-contrast-1",
    status: "approved",
    source: "agent",
    risk: "low",
    patchType: "css",
    summary: "Adjust the measured control token.",
    repositoryPlan: {
      files: ["src/styles.css"],
      checks: ["bun test", "bun run build"],
      source: "agent",
      sourceChangedByFrontmend: false,
    },
    requiresHumanReview: false,
    approval: { mode: "delegated-auto", grantedBy: "person", approvedAt: 20 },
    automation: { eligible: true, policyMode: "auto-low-risk", reasons: [] },
  };
  const result = await findTool(createFrontmendTools({
    getActiveAudit: () => ({ id: auditId }),
    stageRepair: async () => autoRepair,
  }), "stage_site_repair").execute({
    findingId: autoRepair.findingId,
    summary: autoRepair.summary,
    patchType: "css",
    patch: "Update the affected foreground token.",
    verificationPlan: "Rerun the exact contrast rule.",
    risk: "low",
    repositoryFiles: ["src/styles.css"],
    repositoryChecks: ["bun test", "bun run build"],
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.requiresHumanReview, false);
  assert.equal(result.data.approval.mode, "delegated-auto");
  assert.equal(result.data.mission.approvalEvidence, "prior-human-auto-policy");
  assert.match(result.data.nextAction, /Implement the reviewed repository plan/);
  assert.match(result.data.nextAction, /record the implementation receipt/);
});

test("repair tools carry only server-issued verification target IDs and return the reviewed matrix", async () => {
  const auditId = "b8b16bf0-913c-40ea-a741-bb4bf76d326b";
  const candidateId = "audit:pricing-audit";
  const calls = [];
  const impact = {
    status: "reviewed",
    selectedTargetIds: [candidateId],
    candidates: [{ id: candidateId, auditId: "pricing-audit", path: "/pricing", strategies: ["mobile"] }],
    matrix: { rows: [{ id: "row-1", path: "/pricing", status: "waiting" }] },
  };
  const service = {
    getActiveAudit: () => ({ id: auditId }),
    stageRepair: async (_auditId, input) => {
      calls.push(input);
      return {
        id: "repair-1",
        auditId,
        findingId: input.findingId,
        status: "approved",
        revision: 1,
        summary: "Adjust contrast.",
        patchType: "css",
        risk: "low",
        findingScope: { sources: [] },
        repositoryPlan: null,
        requiresHumanReview: false,
        approval: { mode: "delegated-auto" },
        automation: { eligible: true },
        verificationImpact: impact,
      };
    },
  };
  const result = await findTool(createFrontmendTools(service), "stage_site_repair").execute({
    findingId: "contrast",
    verificationTargetIds: [candidateId],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls[0].verificationTargetIds, [candidateId]);
  assert.equal(result.data.verificationImpact.matrix.rows[0].path, "/pricing");
  assert.deepEqual(result.data.verificationCandidates, impact.candidates);
});

test("verification receipt tool returns the aggregate reviewed repair matrix", async () => {
  const auditId = "b8b16bf0-913c-40ea-a741-bb4bf76d326b";
  const aggregate = {
    id: "run-1",
    repairId: "repair-1",
    repairRevision: 2,
    status: "resolved",
    reviewedBy: "person",
    reviewedAt: 10,
    completedAt: 20,
    receiptAvailable: true,
    rows: [{ id: "row-1", path: "/", proofKind: "provider-rule", strategy: "mobile", status: "resolved", outcome: "passed" }],
  };
  const result = await findTool(createFrontmendTools({
    getActiveAudit: () => ({ id: auditId }),
    getRepairVerification: async () => aggregate,
  }), "get_verification_receipt").execute({ repairId: "repair-1" });
  assert.equal(result.ok, true);
  assert.equal(result.data.matrix.status, "resolved");
  assert.match(result.data.receipt, /Reviewed verification matrix/);
  assert.match(result.data.downloadPath, /repair-1\/verification\/receipt$/);
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
  assert.equal(result.data.mission.implementationEvidence, "checks-passed");
  assert.match(result.data.nextAction, /checks passed/i);
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

  const failed = await findTool(
    createFrontmendTools(service),
    "record_repository_implementation",
  ).execute({
    repairId,
    summary: "Applied the change but the production build failed.",
    files: ["worker/index.js"],
    checks: [{ name: "bun run build", status: "failed" }],
  });
  assert.equal(failed.ok, true);
  assert.equal(failed.data.mission.implementationEvidence, "checks-failed");
  assert.equal(
    failed.data.mission.steps.find((step) => step.id === "implement").status,
    "attention",
  );
  assert.match(failed.data.nextAction, /record a new receipt/i);
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
        provider: "Lighthouse",
        auditId: "color-contrast",
        strategy: "mobile",
      },
      findingScope: {
        occurrenceCount: 2,
        occurrencesOmitted: 0,
        sources: [
          { provider: "Lighthouse", auditId: "color-contrast", strategy: "mobile" },
          { provider: "Lighthouse", auditId: "color-contrast", strategy: "desktop" },
        ],
      },
      scopeOutcomes: [
        {
          source: { provider: "Lighthouse", auditId: "color-contrast", strategy: "mobile" },
          outcome: "passed",
          comparable: true,
          comparisonReason: "exact-lighthouse-rule",
        },
        {
          source: { provider: "Lighthouse", auditId: "color-contrast", strategy: "desktop" },
          outcome: "passed",
          comparable: true,
          comparisonReason: "exact-lighthouse-rule",
        },
      ],
      repositoryPlan: {
        files: ["src/App.jsx", "tests/App.test.jsx"],
        checks: ["bun test", "bun run build"],
        source: "agent",
        sourceChangedByFrontmend: false,
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
  assert.equal(receipt.data.findingScope.occurrenceCount, 2);
  assert.deepEqual(receipt.data.scopeOutcomes.map((outcome) => outcome.source.strategy), ["mobile", "desktop"]);
  assert.deepEqual(receipt.data.repositoryPlan.files, ["src/App.jsx", "tests/App.test.jsx"]);
  assert.equal(receipt.data.format, "text/markdown");
  assert.equal(receipt.data.downloadPath, `/api/audits/${auditId}/receipt`);
  assert.match(receipt.data.receipt, /\| Score \| 88 \| 100 \| \+12 \|/);
  assert.match(receipt.data.receipt, /Rule-scope outcomes/);
  assert.match(receipt.data.receipt, /Reviewed repository plan/);
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

  for (const name of CHECKPOINTED_MUTATION_TOOLS) {
    const definition = findTool(tools, name);
    assert.equal(definition.inputSchema.required.includes("expectedMissionRevision"), true, name);
    assert.equal(definition.inputSchema.properties.expectedMissionRevision.minimum, 1, name);
  }
  const browserContribution = findTool(tools, "record_browser_review_check");
  assert.equal(browserContribution.inputSchema.properties.observedRoutes.maxItems, 8);
  assert.equal(browserContribution.inputSchema.properties.observedRoutes.uniqueItems, true);

  const withoutContext = await findTool(tools, "get_site_audit_results").execute({});
  assert.equal(withoutContext.ok, false);
  assert.equal(withoutContext.error.code, "AUDIT_CONTEXT_REQUIRED");
  assert.match(withoutContext.error.message, /Provide auditId or open the audit workspace/);
});

test("WebMCP preserves the current checkpoint in a safe stale-write error", async () => {
  const checkpoint = { auditId: "audit-1", missionRevision: 5 };
  const service = {
    getActiveAudit: () => ({ id: "audit-1", status: "running", missionRevision: 5 }),
    cancelAudit: async () => {
      throw new AuditError(
        "MISSION_REVISION_STALE",
        "The mission changed.",
        true,
        { missionCheckpoint: checkpoint },
      );
    },
  };
  const result = await findTool(createFrontmendTools(service), "cancel_site_audit").execute({
    expectedMissionRevision: 4,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "MISSION_REVISION_STALE");
  assert.deepEqual(result.error.details, { missionCheckpoint: checkpoint });
});

test("diagnostic tools keep measured evidence separate from agent-reported repository diagnosis", async () => {
  const auditId = "b8b16bf0-913c-40ea-a741-bb4bf76d326b";
  const missionId = "8cb30d34-76ce-4c47-a67e-d568b1db4d0a";
  let mission = {
    id: missionId,
    auditId,
    findingId: "lighthouse-errors-in-console-mobile",
    measuredEvidence: { kind: "console-errors", provenance: "measured-lighthouse", completeness: "actionable" },
    requiredInvestigations: ["Reproduce the exact console or network failure"],
    diagnosis: null,
    state: { state: "awaiting-diagnosis" },
  };
  const service = {
    getActiveAudit: () => ({ id: auditId, status: "complete" }),
    openDiagnosticMission: async (receivedAuditId, findingId) => {
      assert.equal(receivedAuditId, auditId);
      assert.equal(findingId, mission.findingId);
      return mission;
    },
    submitDiagnosticEvidence: async (receivedAuditId, receivedMissionId, input, source) => {
      assert.equal(receivedAuditId, auditId);
      assert.equal(receivedMissionId, missionId);
      assert.equal(source, "agent");
      mission = {
        ...mission,
        diagnosis: { ...input, source: "agent", agentReported: true, reportedAt: 20 },
        blocker: null,
        state: { state: "ready-for-repair" },
      };
      return mission;
    },
    recordDiagnosticBlocker: async (receivedAuditId, receivedMissionId, input, source) => {
      assert.equal(receivedAuditId, auditId);
      assert.equal(receivedMissionId, missionId);
      assert.equal(source, "agent");
      mission = {
        ...mission,
        blocker: { ...input, source: "agent", agentReported: true, reportedAt: 15 },
        state: { state: "blocked" },
      };
      return mission;
    },
  };
  const tools = createFrontmendTools(service);
  const opened = await findTool(tools, "open_diagnostic_mission").execute({ findingId: mission.findingId });
  assert.equal(opened.ok, true);
  assert.equal(opened.data.measuredEvidence.provenance, "measured-lighthouse");
  assert.equal(opened.data.evidenceChain.status, "awaiting-diagnosis");
  assert.deepEqual(opened.data.evidenceChain.stages.slice(1).map((stage) => stage.state), [
    "required",
    "required",
    "required",
  ]);

  const blocked = await findTool(tools, "record_diagnostic_blocker").execute({
    missionId,
    reason: "repository-unavailable",
    summary: "This session can reproduce the symptom but cannot access the repository that owns the deployed bundle.",
  });
  assert.equal(blocked.ok, true);
  assert.equal(blocked.data.assessmentComplete, false);
  assert.equal(blocked.data.blocker.agentReported, true);
  assert.equal(blocked.data.evidenceChain.status, "blocked");
  assert.match(blocked.data.nextAction, /no repair can be staged/);

  const diagnosed = await findTool(tools, "submit_runtime_diagnosis").execute({
    missionId,
    summary: "The initial request rejects without an expected error boundary.",
    reproduction: "Reload the page, open Console, and observe the first-party rejection.",
    observations: [{ kind: "console", detail: "The error occurs once before interaction." }],
    sourceLocations: [{ file: "src/load.js", line: 12, symbol: "loadData", reason: "Owns the rejected request." }],
    verificationChecks: ["bun test", "Reload with an empty console"],
    confidence: "high",
  });
  assert.equal(diagnosed.ok, true);
  assert.equal(diagnosed.data.diagnosis.agentReported, true);
  assert.equal(diagnosed.data.measuredEvidence.provenance, "measured-lighthouse");
  assert.equal(diagnosed.data.evidenceChain.status, "ready-for-repair");
  assert.deepEqual(diagnosed.data.evidenceChain.stages.slice(1).map((stage) => stage.provenance), [
    "agent-reported",
    "agent-reported",
    "agent-reported",
  ]);
  assert.equal(diagnosed.data.state.state, "ready-for-repair");
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
    getDiagnosticMissions: () => diagnosticMissions,
  };
  let diagnosticMissions = [];

  assert.deepEqual(contextualFrontmendToolNames(service), ["start_site_audit", "get_mission_summary"]);

  audit = { id: "audit-1", status: "running", report: null };
  assert.deepEqual(contextualFrontmendToolNames(service), [
    "check_site_audit_progress",
    "cancel_site_audit",
    "get_mission_summary",
  ]);

  audit = { id: "audit-1", status: "failed", report: null };
  assert.deepEqual(contextualFrontmendToolNames(service), ["start_site_audit", "get_mission_summary"]);

  audit = { id: "audit-1", status: "cancelled", report: null };
  assert.deepEqual(contextualFrontmendToolNames(service), ["start_site_audit", "get_mission_summary"]);

  audit = { id: "audit-1", status: "complete", report: { findings: [] } };
  assert.deepEqual(contextualFrontmendToolNames(service), ["get_mission_summary", "get_site_audit_results"]);

  audit = {
    id: "audit-1",
    status: "complete",
    mission: {
      schemaVersion: 1,
      intent: "assess",
      focusAreas: [],
      maxPriorities: 3,
      requestedBy: "agent",
      requestedAt: 1_777_000_000_000,
      repairPreparation: null,
    },
    report: {
      auditId: "audit-1",
      engine: { mode: "live-pagespeed", provider: "PageSpeed Insights / Lighthouse" },
      findings: [],
    },
  };
  assert.deepEqual(contextualFrontmendToolNames(service), [
    "get_mission_summary",
    "get_site_audit_results",
    "open_browser_review",
  ]);

  audit = {
    id: "audit-1",
    status: "complete",
    report: { findings: [], documentProfile: { routes: ["/privacy"] } },
  };
  assert.deepEqual(contextualFrontmendToolNames(service), [
    "get_mission_summary",
    "get_site_audit_results",
    "start_related_page_audit",
    "start_site_exploration",
  ]);

  explorations = [{ id: "exploration-1" }];
  assert.deepEqual(contextualFrontmendToolNames(service), [
    "get_mission_summary",
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
    "get_mission_summary",
    "get_site_audit_results",
    "get_evidence_chain",
    "get_repository_fix_brief",
    "prepare_site_repair",
  ]);

  audit.mission = {
    repairPreparation: { findingId: "csp" },
  };
  assert.deepEqual(contextualFrontmendToolNames(service), [
    "get_mission_summary",
    "get_site_audit_results",
    "get_evidence_chain",
    "get_repository_fix_brief",
    "prepare_site_repair",
    "stage_site_repair",
  ]);

  repairs = [{ status: "changes-requested", deploymentAttestedAt: null }];
  assert.deepEqual(contextualFrontmendToolNames(service), [
    "get_mission_summary",
    "get_site_audit_results",
    "get_evidence_chain",
    "get_repository_fix_brief",
    "prepare_site_repair",
    "stage_site_repair",
    "revise_site_repair",
    "get_repair_workspace",
  ]);

  repairs = [{ status: "approved", deploymentAttestedAt: null }];
  assert.deepEqual(contextualFrontmendToolNames(service), [
    "get_mission_summary",
    "get_site_audit_results",
    "get_evidence_chain",
    "get_repository_fix_brief",
    "prepare_site_repair",
    "stage_site_repair",
    "get_repair_workspace",
    "record_repository_implementation",
  ]);

  repairs = [{ status: "approved", deploymentAttestedAt: 1_777_000_000_000 }];
  audit.report.verification = { status: "resolved" };
  assert.deepEqual(contextualFrontmendToolNames(service), [
    "get_mission_summary",
    "get_site_audit_results",
    "get_evidence_chain",
    "get_repository_fix_brief",
    "get_verification_receipt",
    "prepare_site_repair",
    "stage_site_repair",
    "get_repair_workspace",
    "start_repair_verification",
  ]);

  repairs = [];
  audit = {
    id: "audit-1",
    status: "complete",
    report: { findings: [{ id: "console", diagnosticEvidence: { kind: "console-errors" } }] },
  };
  assert.deepEqual(contextualFrontmendToolNames(service), [
    "get_mission_summary",
    "get_site_audit_results",
    "get_evidence_chain",
    "get_repository_fix_brief",
    "open_diagnostic_mission",
    "prepare_site_repair",
  ]);
  diagnosticMissions = [{ findingId: "console", state: { state: "awaiting-diagnosis" } }];
  assert.deepEqual(contextualFrontmendToolNames(service), [
    "get_mission_summary",
    "get_site_audit_results",
    "get_evidence_chain",
    "get_repository_fix_brief",
    "submit_runtime_diagnosis",
    "record_diagnostic_blocker",
    "prepare_site_repair",
  ]);
  diagnosticMissions = [{ findingId: "console", state: { state: "blocked" } }];
  assert.deepEqual(contextualFrontmendToolNames(service), [
    "get_mission_summary",
    "get_site_audit_results",
    "get_evidence_chain",
    "get_repository_fix_brief",
    "submit_runtime_diagnosis",
    "prepare_site_repair",
  ]);
  diagnosticMissions = [{ findingId: "console", state: { state: "ready-for-repair" } }];
  assert.deepEqual(contextualFrontmendToolNames(service), [
    "get_mission_summary",
    "get_site_audit_results",
    "get_evidence_chain",
    "get_repository_fix_brief",
    "prepare_site_repair",
  ]);
  audit.mission = { repairPreparation: { findingId: "console" } };
  assert.deepEqual(contextualFrontmendToolNames(service), [
    "get_mission_summary",
    "get_site_audit_results",
    "get_evidence_chain",
    "get_repository_fix_brief",
    "prepare_site_repair",
    "stage_site_repair",
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
  assert.equal(snapshots.at(-1).totalTools, FRONTMEND_TOOL_COUNT);
  dispose();
});

test("registration can pause every contextual tool while authoritative state restores", async () => {
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
    toolNames: [],
    onStatus: (snapshot) => snapshots.push(snapshot),
  });
  await dispose.ready;

  assert.deepEqual(registered, []);
  assert.equal(snapshots.at(-1).status, "ready");
  assert.equal(snapshots.at(-1).activeTools, 0);
  assert.equal(snapshots.at(-1).totalTools, FRONTMEND_TOOL_COUNT);
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
  assert.equal(snapshots.at(-1).totalTools, FRONTMEND_TOOL_COUNT);
  assert.deepEqual(
    snapshots.at(-1).toolNames,
    TOOL_NAMES.filter((name) => name !== "check_site_audit_progress"),
  );
  assert.deepEqual(snapshots.at(-1).errors, [
    "check_site_audit_progress: Tool name is already registered.",
  ]);
  dispose();
});
