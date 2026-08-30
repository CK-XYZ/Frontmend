import assert from "node:assert/strict";
import { Readable } from "node:stream";
import worker, { FrontmendAuditJob } from "../worker/index.js";
import { createLocalAuditRuntime } from "../worker/local-runtime.js";
import { createAuditService, createHttpAuditTransport } from "../src/audit-service.js";
import {
  contextualFrontmendToolNames,
  createFrontmendTools,
} from "../src/webmcp.js";

const BASE_URL = "https://frontmend.eval";
const TARGET_URL = "https://example.com/";
const MAX_POLLS = 60;
const FULL_TOOL_NAMES = createFrontmendTools({}).map((tool) => tool.name);

function fixtureController() {
  let fixed = false;
  const lighthouse = (strategy, target) => {
    const mobile = strategy === "mobile";
    const failing = mobile && !fixed;
    return {
      analysisUTCTimestamp: "2026-08-31T00:00:00.000Z",
      lighthouseResult: {
        finalUrl: target,
        lighthouseVersion: "13.4.1",
        categories: {
          performance: { score: fixed ? 0.96 : mobile ? 0.88 : 0.95 },
          accessibility: { score: fixed ? 1 : mobile ? 0.91 : 1 },
          "best-practices": { score: fixed ? 1 : mobile ? 0.9 : 1 },
          seo: { score: 1 },
        },
        audits: {
          "errors-in-console": {
            score: failing ? 0 : 1,
            scoreDisplayMode: "binary",
            displayValue: failing ? "1 error logged to the console" : undefined,
            details: {
              items: failing
                ? [{
                    source: "javascript",
                    description: "ReferenceError: bootWidget is not defined",
                    sourceLocation: { url: `${new URL(target).origin}/assets/app.js`, line: 42, column: 7 },
                  }]
                : [],
            },
          },
          "color-contrast": {
            score: failing ? 0 : 1,
            scoreDisplayMode: "binary",
            displayValue: failing ? "1 element" : undefined,
            details: {
              items: failing
                ? [{
                    node: {
                      selector: ".primary-copy",
                      nodeLabel: "Continue",
                      snippet: '<button class="primary-copy">Continue</button>',
                      explanation: "Element has insufficient color contrast of 2.8. Expected ratio of 4.5:1",
                    },
                  }]
                : [],
            },
          },
          "document-title": { score: 1, scoreDisplayMode: "binary" },
          "meta-description": { score: 1, scoreDisplayMode: "binary" },
          "robots-txt": { score: 1, scoreDisplayMode: "binary" },
          "is-crawlable": { score: 1, scoreDisplayMode: "binary" },
        },
      },
    };
  };
  const fetchImpl = async (input) => {
    const url = input instanceof URL ? input : new URL(String(input));
    if (url.hostname === "pagespeedonline.googleapis.com") {
      const target = url.searchParams.get("url") ?? TARGET_URL;
      return Response.json(lighthouse(url.searchParams.get("strategy") ?? "mobile", target));
    }
    const title = url.pathname === "/docs" ? "Example documentation" : "Example product";
    return new Response(
      `<!doctype html><html lang="en"><head><title>${title}</title><meta name="description" content="Deterministic mission evaluation fixture."><meta name="viewport" content="width=device-width"></head><body><main><h1>${title}</h1><button class="primary-copy">Continue</button><a href="/docs">Documentation</a></main></body></html>`,
      {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "content-security-policy": "default-src 'self'",
          "x-content-type-options": "nosniff",
        },
      },
    );
  };
  return {
    fetchImpl,
    setFixed(value) { fixed = value === true; },
  };
}

function invokeLocalMiddleware(middleware, request) {
  const url = new URL(request.url);
  return new Promise((resolve, reject) => {
    const requestHeaders = Object.fromEntries(request.headers.entries());
    const bodyPromise = request.arrayBuffer();
    bodyPromise.then((bodyBuffer) => {
      const body = Buffer.from(bodyBuffer);
      const incoming = Readable.from(body.length ? [body] : []);
      Object.assign(incoming, {
        method: request.method,
        url: `${url.pathname}${url.search}`,
        headers: {
          host: url.host,
          origin: url.origin,
          ...requestHeaders,
        },
        socket: { remoteAddress: "127.0.0.1" },
      });
      const headers = new Headers();
      const outgoing = {
        statusCode: 200,
        setHeader(name, value) { headers.set(name, String(value)); },
        end(value = "") {
          resolve(new Response(Buffer.isBuffer(value) ? value : String(value), {
            status: this.statusCode,
            headers,
          }));
        },
      };
      Promise.resolve(middleware(incoming, outgoing, () => reject(new Error("Unexpected local middleware fallthrough."))))
        .catch(reject);
    }).catch(reject);
  });
}

function createLocalAdapter(controller) {
  const middleware = createLocalAuditRuntime({ fetchImpl: controller.fetchImpl });
  return {
    name: "local",
    fetch: (url, init = {}) => invokeLocalMiddleware(middleware, new Request(url, init)),
    flush: async () => Promise.resolve(),
  };
}

class MemoryStorage {
  constructor() { this.values = new Map(); }
  async get(key) { return this.values.get(key); }
  async put(key, value) { this.values.set(key, structuredClone(value)); }
  async delete(key) {
    if (Array.isArray(key)) key.forEach((item) => this.values.delete(item));
    else this.values.delete(key);
  }
  async deleteAll() { this.values.clear(); }
  async setAlarm() {}
}

class EvaluationJobNamespace {
  constructor() {
    this.jobs = new Map();
    this.pending = [];
    this.env = null;
  }
  idFromName(name) { return name; }
  get(id) {
    if (!this.jobs.has(id)) {
      const storage = new MemoryStorage();
      const ctx = {
        storage,
        waitUntil: (promise) => { this.pending.push(Promise.resolve(promise)); },
      };
      const instance = new FrontmendAuditJob(ctx, this.env);
      this.jobs.set(id, {
        instance,
        stub: {
          fetch: (url, init = {}) => instance.fetch(new Request(url, init)),
        },
      });
    }
    return this.jobs.get(id).stub;
  }
  async flush() {
    while (this.pending.length) {
      const current = this.pending.splice(0);
      const settled = await Promise.allSettled(current);
      const rejected = settled.find((result) => result.status === "rejected");
      if (rejected) throw rejected.reason;
    }
  }
}

function createEvaluationGate() {
  const admissions = new Map();
  const admissionFor = (key) => {
    if (!admissions.has(key)) admissions.set(key, crypto.randomUUID());
    return admissions.get(key);
  };
  return {
    idFromName: (name) => name,
    get: () => ({
      fetch: async (url, init = {}) => {
        const input = JSON.parse(init.body ?? "{}");
        if (new URL(url).pathname === "/admit-batch") {
          return Response.json({
            allowed: true,
            admissions: (input.items ?? []).map((item) => ({
              jobId: admissionFor(item.urlHash),
              reused: false,
            })),
          });
        }
        return Response.json({
          allowed: true,
          jobId: admissionFor(input.urlHash),
          reused: false,
        });
      },
    }),
  };
}

function createWorkerAdapter() {
  const jobs = new EvaluationJobNamespace();
  const env = {
    AUDIT_GATE: createEvaluationGate(),
    AUDIT_JOBS: jobs,
    ASSETS: { fetch: async () => new Response("not found", { status: 404 }) },
  };
  jobs.env = env;
  return {
    name: "worker",
    fetch: (url, init = {}) => worker.fetch(new Request(url, init), env),
    flush: () => jobs.flush(),
  };
}

function toolDefinition(service, name) {
  const definition = createFrontmendTools(service).find((candidate) => candidate.name === name);
  assert.ok(definition, `Missing WebMCP tool ${name}.`);
  return definition;
}

async function callContextualTool(service, name, input, sequence) {
  const available = contextualFrontmendToolNames(service);
  assert.ok(available.includes(name), `${name} was not registered in contextual state: ${available.join(", ")}`);
  const result = await toolDefinition(service, name).execute(input ?? {});
  assert.equal(result.ok, true, `${name} failed: ${JSON.stringify(result.error)}`);
  sequence.push(name);
  return result.data;
}

async function waitForAudit(service, adapter, auditId, sequence) {
  for (let attempt = 0; attempt < MAX_POLLS; attempt += 1) {
    await adapter.flush();
    const audit = await callContextualTool(service, "check_site_audit_progress", { auditId }, sequence);
    if (audit.status === "complete") return audit;
    assert.notEqual(audit.status, "failed", `Audit ${auditId} failed during deterministic evaluation.`);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Audit ${auditId} did not complete within ${MAX_POLLS} reads.`);
}

async function waitForExploration(service, adapter, auditId, missionId, sequence) {
  for (let attempt = 0; attempt < MAX_POLLS; attempt += 1) {
    await adapter.flush();
    const available = contextualFrontmendToolNames(service);
    assert.ok(available.includes("get_site_exploration"));
    const result = await toolDefinition(service, "get_site_exploration").execute({ auditId, missionId });
    if (!result.ok && result.error.code === "MISSION_REFRESH_UNSTABLE") {
      await service.restoreAuditWorkspace(auditId);
      continue;
    }
    assert.equal(result.ok, true, `get_site_exploration failed: ${JSON.stringify(result.error)}`);
    sequence.push("get_site_exploration");
    const mission = result.data;
    if (["complete", "partial", "failed"].includes(mission.status)) return mission;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Exploration ${missionId} did not complete within ${MAX_POLLS} reads.`);
}

async function recordAssessmentReview(service, opened, auditId, sequence, conflict = true) {
  let task = opened.nextAction.browserTask;
  let last = opened;
  while (task) {
    const providerConflict = conflict && task.trigger?.ruleId === "color-contrast";
    last = await callContextualTool(service, "record_browser_review_check", {
      auditId,
      reviewId: opened.browserReview.id,
      checkId: task.id,
      outcome: "passed",
      summary: providerConflict
        ? "The retained control appeared readable in the deterministic rendered observation."
        : "The retained rendered check completed without an observed issue.",
      observations: [providerConflict
        ? "The foreground and background were visually distinct at the retained selector."
        : "The rendered page exposed the expected bounded structure."],
    }, sequence);
    task = last.nextAction?.tool === "record_browser_review_check"
      ? last.nextAction.browserTask
      : null;
  }
  return last;
}

async function diagnoseFinding(service, auditId, findingId, sequence) {
  const opened = await callContextualTool(service, "open_diagnostic_mission", { auditId, findingId }, sequence);
  return callContextualTool(service, "submit_runtime_diagnosis", {
    auditId,
    missionId: opened.diagnosticMissionId,
    summary: findingId.includes("console")
      ? "The owned boot path reads a module binding before initialisation completes."
      : "The shared foreground token produces the retained insufficient contrast symptom.",
    reproduction: "Open the audited route in a fresh rendered session and repeat the retained check.",
    observations: [{
      kind: findingId.includes("console") ? "console" : "accessibility",
      detail: "The retained public symptom was reproduced before inspecting repository ownership.",
    }],
    sourceLocations: [{
      file: findingId.includes("console") ? "src/runtime.js" : "src/styles.css",
      line: 42,
      reason: "This repository-relative location owns the retained symptom.",
    }],
    verificationChecks: ["bun test", "bun run build"],
    confidence: "high",
  }, sequence);
}

async function humanMutation(adapter, path, expectedMissionRevision) {
  const response = await adapter.fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ expectedMissionRevision }),
  });
  const payload = await response.json();
  assert.equal(response.ok, true, `Human mutation ${path} failed: ${JSON.stringify(payload.error)}`);
  return payload.data;
}

async function runMainScenario(adapter, controller) {
  const transport = createHttpAuditTransport({ baseUrl: BASE_URL, fetchImpl: adapter.fetch });
  const service = createAuditService({ transport });
  const sequence = [];
  const checkpointRevisions = [];
  const started = await callContextualTool(service, "start_site_audit", {
    url: TARGET_URL,
    focusAreas: ["accessibility", "reliability"],
    maxPriorities: 3,
    scope: "bounded-site",
    routeLimit: 1,
  }, sequence);
  const auditId = started.id;
  await waitForAudit(service, adapter, auditId, sequence);
  await service.restoreAuditWorkspace(auditId);
  checkpointRevisions.push(service.getMissionCheckpoint(auditId).missionRevision);

  const initialResults = await callContextualTool(service, "get_site_audit_results", { auditId }, sequence);
  assert.equal(initialResults.missionState.assessmentComplete, false);
  assert.equal(initialResults.mission.scope, "bounded-site");
  assert.equal(initialResults.missionState.siteScope.routeCandidates.length, 1);

  const exploration = await callContextualTool(service, "start_site_exploration", {
    auditId,
    routeCandidateIds: initialResults.missionState.siteScope.routeCandidates.map((candidate) => candidate.id),
  }, sequence);
  await waitForExploration(service, adapter, auditId, exploration.id, sequence);
  await service.restoreAuditWorkspace(auditId);
  checkpointRevisions.push(service.getMissionCheckpoint(auditId).missionRevision);

  const openedReview = await callContextualTool(service, "open_browser_review", { auditId }, sequence);
  const staleService = createAuditService({ transport });
  await staleService.restoreAuditWorkspace(auditId);
  const firstTask = openedReview.nextAction.browserTask;
  assert.ok(firstTask, "The evidence-led review did not expose its first browser task.");
  const firstResult = await callContextualTool(service, "record_browser_review_check", {
    auditId,
    reviewId: openedReview.browserReview.id,
    checkId: firstTask.id,
    outcome: "issue",
    summary: "The retained control reproduced the deterministic insufficient-contrast symptom.",
    observations: ["The foreground and background remained below the retained contrast threshold."],
    findings: [{
      title: "Retained control has insufficient contrast",
      severity: "medium",
      focusArea: "accessibility",
      evidence: "The rendered control reproduced the retained provider symptom at the assigned selector.",
      suggestedRepair: "Correct the shared foreground and background tokens, then repeat the exact check.",
      element: firstTask.trigger?.selector ?? ".primary-copy",
    }],
  }, sequence);
  const staleAttempt = await toolDefinition(staleService, "record_browser_review_check").execute({
    auditId,
    reviewId: openedReview.browserReview.id,
    checkId: firstTask.id,
    outcome: "passed",
    summary: "A conflicting stale observation must not be accepted.",
    observations: ["This stale contribution intentionally conflicts with the accepted result."],
  });
  assert.equal(staleAttempt.ok, false);
  assert.equal(staleAttempt.error.code, "MISSION_REVISION_STALE");
  assert.ok(staleAttempt.error.details?.missionCheckpoint?.missionRevision > checkpointRevisions.at(-1));
  await staleService.restoreAuditWorkspace(auditId);
  assert.equal(
    staleService.getMissionCheckpoint(auditId).missionRevision,
    staleAttempt.error.details.missionCheckpoint.missionRevision,
  );
  let nextTask = firstResult.nextAction?.tool === "record_browser_review_check"
    ? firstResult.nextAction.browserTask
    : null;
  while (nextTask) {
    const recorded = await callContextualTool(service, "record_browser_review_check", {
      auditId,
      reviewId: openedReview.browserReview.id,
      checkId: nextTask.id,
      outcome: "passed",
      summary: "The next retained rendered check completed without an observed issue.",
      observations: ["The rendered page exposed the expected bounded structure."],
    }, sequence);
    nextTask = recorded.nextAction?.tool === "record_browser_review_check"
      ? recorded.nextAction.browserTask
      : null;
  }

  const confirmedResults = await callContextualTool(service, "get_site_audit_results", { auditId }, sequence);
  const contrastPriority = confirmedResults.priorities.find((priority) => priority.findingId === "mobile-color-contrast");
  assert.equal(contrastPriority.relationship, "diagnosis-required");
  assert.equal(contrastPriority.unresolvedRequirement !== null, true);

  const packageIds = ["mobile-errors-in-console", "mobile-color-contrast"];
  for (const findingId of packageIds) await diagnoseFinding(service, auditId, findingId, sequence);
  const completedResults = await callContextualTool(service, "get_site_audit_results", { auditId }, sequence);
  assert.equal(
    completedResults.missionState.assessmentComplete,
    true,
    `Assessment remained incomplete: ${JSON.stringify({
      status: completedResults.missionState.status,
      nextAction: completedResults.missionState.nextAction,
      priorities: completedResults.priorities.map((priority) => ({
        findingId: priority.findingId,
        relationship: priority.relationship,
        unresolvedRequirement: priority.unresolvedRequirement,
      })),
    })}`,
  );
  assert.equal(completedResults.missionState.siteScope.pagesComplete, 1);
  const receipt = await callContextualTool(service, "get_assessment_receipt", { auditId }, sequence);
  assert.match(receipt.markdown, /does not prove a repair, deployment, or resolution/i);

  const brief = await callContextualTool(service, "get_repository_fix_brief", {
    auditId,
    findingId: packageIds[0],
    findingIds: packageIds,
  }, sequence);
  assert.deepEqual(brief.repairPackage.findingIds, packageIds);
  await callContextualTool(service, "prepare_site_repair", {
    auditId,
    findingId: packageIds[0],
    findingIds: packageIds,
  }, sequence);
  const staged = await callContextualTool(service, "stage_site_repair", {
    auditId,
    findingId: packageIds[0],
    findingIds: packageIds,
    summary: "Repair the diagnosed boot and contrast symptoms in one reviewed application change.",
    patchType: "guidance",
    patch: "Correct the owned initialisation order and update the shared foreground token.",
    verificationPlan: "Rerun both exact rules on the root and retained route, then evaluate every reviewed guardrail.",
    risk: "medium",
    repositoryFiles: ["src/runtime.js", "src/styles.css"],
    repositoryChecks: ["bun test", "bun run build"],
  }, sequence);
  assert.equal(staged.requiresHumanReview, true);
  assert.equal(staged.approval, null);
  assert.match(staged.automation.reasons.join(" "), /multi-finding packages require explicit review/i);
  const repairId = staged.repairId;
  assert.ok(repairId, "The staged repair response did not expose its stable repair ID.");

  let revision = service.getMissionCheckpoint(auditId).missionRevision;
  const approved = await humanMutation(
    adapter,
    `/api/audits/${encodeURIComponent(auditId)}/repairs/${encodeURIComponent(repairId)}/approve`,
    revision,
  );
  assert.equal(approved.approval.mode, "explicit-review");
  await service.restoreAuditWorkspace(auditId);
  await callContextualTool(service, "record_repository_implementation", {
    auditId,
    repairId,
    summary: "Applied the exact reviewed package in the two repository-relative files.",
    files: ["src/runtime.js", "src/styles.css"],
    checks: [
      { name: "bun test", status: "passed" },
      { name: "bun run build", status: "passed" },
    ],
  }, sequence);
  revision = service.getMissionCheckpoint(auditId).missionRevision;
  const deployed = await humanMutation(
    adapter,
    `/api/audits/${encodeURIComponent(auditId)}/repairs/${encodeURIComponent(repairId)}/deployment`,
    revision,
  );
  assert.equal(Number.isFinite(deployed.deploymentAttestedAt), true);
  await service.restoreAuditWorkspace(auditId);

  controller.setFixed(true);
  const verificationStart = await callContextualTool(service, "start_repair_verification", {
    auditId,
    repairId,
  }, sequence);
  assert.equal(verificationStart.verificationAuditIds.length, 2);
  await adapter.flush();
  for (const verificationAuditId of verificationStart.verificationAuditIds) {
    let terminalAudit = null;
    for (let attempt = 0; attempt < MAX_POLLS; attempt += 1) {
      await adapter.flush();
      const current = await service.getAudit(verificationAuditId);
      if (current.status === "complete") {
        terminalAudit = current;
        break;
      }
      assert.notEqual(current.status, "failed");
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    assert.equal(terminalAudit?.status, "complete");
  }
  await service.restoreAuditWorkspace(auditId);
  const aggregate = await service.getRepairVerification(auditId, repairId);
  assert.equal(aggregate.status, "resolved");
  assert.equal(aggregate.receiptAvailable, true);
  assert.equal(aggregate.rows.filter((row) => row.proofKind === "provider-rule").length, 4);
  assert.equal(new Set(aggregate.rows.map((row) => row.path)).size, 2);
  await service.getAudit(auditId);
  const verificationReceipt = await callContextualTool(service, "get_verification_receipt", {
    auditId,
    repairId,
  }, sequence);
  assert.equal(verificationReceipt.matrix.status, "resolved");
  assert.match(verificationReceipt.receipt, /Reviewed verification matrix/);

  return {
    preDiagnosisRelationship: contrastPriority.relationship,
    staleError: staleAttempt.error.code,
    assessmentComplete: completedResults.missionState.assessmentComplete,
    packageSize: staged.findingIds.length,
    approvalMode: approved.approval.mode,
    deploymentOwnerAttested: Number.isFinite(deployed.deploymentAttestedAt),
    verificationStatus: aggregate.status,
    verificationRoutes: new Set(aggregate.rows.map((row) => row.path)).size,
    exactRows: aggregate.rows.filter((row) => row.proofKind === "provider-rule").length,
    toolSequence: sequence,
  };
}

async function runBlockerScenario(adapter, controller) {
  controller.setFixed(false);
  const transport = createHttpAuditTransport({ baseUrl: BASE_URL, fetchImpl: adapter.fetch });
  const service = createAuditService({ transport });
  const sequence = [];
  const started = await callContextualTool(service, "start_site_audit", {
    url: TARGET_URL,
    focusAreas: ["accessibility"],
    scope: "page",
  }, sequence);
  await waitForAudit(service, adapter, started.id, sequence);
  await service.restoreAuditWorkspace(started.id);
  const opened = await callContextualTool(service, "open_browser_review", { auditId: started.id }, sequence);
  let task = opened.nextAction.browserTask;
  let conflictFindingId = null;
  while (task) {
    if (task.trigger?.ruleId === "color-contrast") conflictFindingId = task.trigger.findingId;
    const recorded = await callContextualTool(service, "record_browser_review_check", {
      auditId: started.id,
      reviewId: opened.browserReview.id,
      checkId: task.id,
      outcome: "passed",
      summary: task.trigger?.ruleId === "color-contrast"
        ? "The rendered observation did not reproduce the retained contrast failure."
        : "The rendered check completed without an observed issue.",
      observations: [task.trigger?.ruleId === "color-contrast"
        ? "The assigned control appeared readable even though the provider retained a failed rule."
        : "The rendered page exposed the expected bounded structure."],
    }, sequence);
    task = recorded.nextAction?.tool === "record_browser_review_check"
      ? recorded.nextAction.browserTask
      : null;
  }
  assert.ok(conflictFindingId, "The blocker scenario did not retain its evidence-led contrast trigger.");
  const results = await callContextualTool(service, "get_site_audit_results", { auditId: started.id }, sequence);
  const priority = results.priorities.find((item) => item.findingId === conflictFindingId);
  assert.equal(priority.relationship, "provider-browser-conflict");
  const diagnostic = await callContextualTool(service, "open_diagnostic_mission", {
    auditId: started.id,
    findingId: conflictFindingId,
  }, sequence);
  const blocked = await callContextualTool(service, "record_diagnostic_blocker", {
    auditId: started.id,
    missionId: diagnostic.diagnosticMissionId,
    reason: "repository-unavailable",
    summary: "The correct repository was deliberately withheld in this protocol scenario, so ownership cannot be asserted.",
  }, sequence);
  assert.equal(blocked.assessmentComplete, false);
  assert.equal(blocked.blocker.reason, "repository-unavailable");
  const available = contextualFrontmendToolNames(service);
  assert.equal(available.includes("get_assessment_receipt"), false);
  assert.equal(available.includes("stage_site_repair"), false);
  return {
    relationship: priority.relationship,
    blocker: blocked.blocker.reason,
    assessmentComplete: blocked.assessmentComplete,
    receiptWithheld: !available.includes("get_assessment_receipt"),
    repairStagingWithheld: !available.includes("stage_site_repair"),
    toolSequence: sequence,
  };
}

async function runAdapter(adapter, controller) {
  const previousFetch = globalThis.fetch;
  if (adapter.name === "worker") globalThis.fetch = controller.fetchImpl;
  try {
    const main = await runMainScenario(adapter, controller);
    const blocker = await runBlockerScenario(adapter, controller);
    return {
      adapter: adapter.name,
      status: "passed",
      main,
      blocker,
    };
  } finally {
    if (adapter.name === "worker") globalThis.fetch = previousFetch;
  }
}

function comparableShape(result) {
  return {
    preDiagnosisRelationship: result.main.preDiagnosisRelationship,
    staleError: result.main.staleError,
    assessmentComplete: result.main.assessmentComplete,
    packageSize: result.main.packageSize,
    approvalMode: result.main.approvalMode,
    deploymentOwnerAttested: result.main.deploymentOwnerAttested,
    verificationStatus: result.main.verificationStatus,
    verificationRoutes: result.main.verificationRoutes,
    exactRows: result.main.exactRows,
    blockerRelationship: result.blocker.relationship,
    blockerReason: result.blocker.blocker,
    blockerAssessmentComplete: result.blocker.assessmentComplete,
    receiptWithheld: result.blocker.receiptWithheld,
    repairStagingWithheld: result.blocker.repairStagingWithheld,
  };
}

export async function runMissionEvaluation() {
  assert.equal(FULL_TOOL_NAMES.length, 21, "The full mission evaluation must not change the twenty-one-tool library.");
  const localController = fixtureController();
  const workerController = fixtureController();
  const local = await runAdapter(createLocalAdapter(localController), localController);
  const workerResult = await runAdapter(createWorkerAdapter(), workerController);
  assert.deepEqual(comparableShape(workerResult), comparableShape(local));
  return {
    schemaVersion: 1,
    status: "passed",
    evidenceMode: "deterministic-offline-protocol",
    liveBrowserProof: false,
    deploymentPerformed: false,
    toolCount: FULL_TOOL_NAMES.length,
    adapters: [local, workerResult],
    parity: comparableShape(local),
    authority: {
      repositoryContentsReceived: false,
      approval: "explicit-person-route",
      deployment: "site-owner-attestation-fixture",
      claim: "This evaluation proves repeatable contracts over deterministic fixtures. It is not live browser, repository, deployment, or production evidence.",
    },
  };
}

if (import.meta.main) {
  const result = await runMissionEvaluation();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
