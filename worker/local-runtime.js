import { AuditError, normalizePublicUrl } from "../src/url-policy.js";
import {
  auditSessionTokenFromCookie,
  createAuditSessionCookie,
  createAuditSessionToken,
  hashAuditSessionToken,
} from "../src/audit-session-contract.js";
import { assessmentReceiptMarkdown, createAssessmentReceipt } from "../src/assessment-receipt.js";
import { createRuntimeBuildDescriptor } from "../src/protocol-contract.js";
import {
  activityLedgerBoundary,
  activityLedgerSnapshot,
  mergeActivityLedger,
} from "../src/activity-ledger-contract.js";
import {
  auditMissionSignature,
  auditMissionSnapshot,
  assessmentFindings,
  createAuditMission,
  deriveAuditMissionState,
  normalizeRepairFindingIds,
  prepareRepairIntent,
} from "../src/audit-mission-contract.js";
import { createRelatedAuditInput } from "../src/route-contract.js";
import {
  assertMissionId,
  createSiteExplorationInputs,
  createSiteExplorationMission,
  siteExplorationMarkdown,
  siteExplorationSnapshot,
} from "../src/site-exploration-contract.js";
import {
  applyRepairPolicy,
  auditReportMarkdown,
  compareVerification,
  createRepairPolicy,
  createVerificationContext,
  createRepairDraft,
  recordRepositoryImplementation,
  requestRepairChanges,
  repairExportMarkdown,
  repairPolicySnapshot,
  repairWithMission,
  reviseRepairDraft,
  verificationReceiptMarkdown,
  validateRepairId,
} from "../src/repair-contract.js";
import { runFrontmendAudit } from "./pagespeed-provider.js";
import { resolveLocalHostname } from "./local-resolver.js";
import {
  createDiagnosticMission,
  diagnosticMissionForRepair,
  diagnosticMissionSnapshot,
  findingRequiresDiagnosticMission,
  recordDiagnosticBlocker,
  submitDiagnosticEvidence,
} from "../src/diagnostic-contract.js";
import {
  browserReviewSnapshot,
  createBrowserReviewMission,
  createBrowserVerificationReview,
  isIdenticalBrowserReviewContribution,
  recordBrowserReviewCheck,
  withdrawBrowserReview,
} from "../src/browser-review-contract.js";
import {
  advanceMissionRevision,
  assertExpectedMissionRevision,
  auditMissionRevision,
  createMissionCheckpoint,
} from "../src/mission-checkpoint-contract.js";
import {
  agentCapabilitySnapshot,
  createAgentCapabilityDeclaration,
} from "../src/agent-capability-contract.js";
import {
  aggregateRepairVerification,
  assignRepairVerificationJobs,
  browserReplaysForVerificationRows,
  createLegacyRepairVerificationImpact,
  createRepairPackageVerificationImpact,
  createRepairVerificationRun,
  repairVerificationReceiptMarkdown,
  reviewRepairVerificationImpact,
  reviewedVerificationTargets,
  verificationCandidateProjection,
  verificationImpactLimits,
} from "../src/verification-impact-contract.js";
import {
  isIdenticalCandidateReviewContribution,
  openCandidateReview,
  recordCandidateReviewCheck,
} from "../src/candidate-review-contract.js";

const BODY_LIMIT_BYTES = 12 * 1024;
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const JOB_RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_RETAINED_JOBS = 200;

function sendJson(response, status, payload, headers = {}) {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
  response.end(JSON.stringify(payload));
}

function sendError(response, error, status = 400) {
  sendJson(response, status, {
    ok: false,
    error: {
      code: typeof error?.code === "string" ? error.code : "LOCAL_AUDIT_FAILED",
      message:
        typeof error?.message === "string"
          ? error.message.slice(0, 300)
          : "The local live-audit adapter could not complete the request.",
      recoverable: error?.recoverable !== false,
      ...(error?.details ? { details: error.details } : {}),
    },
  });
}

async function readBody(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > BODY_LIMIT_BYTES) {
      throw new AuditError("INVALID_INPUT", "The request body is too large.");
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AuditError("INVALID_INPUT", "The request body must be valid JSON.");
  }
}

async function readOptionalBody(request) {
  if (request.headers["content-length"] === "0") return {};
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > BODY_LIMIT_BYTES) throw new AuditError("INVALID_INPUT", "The request body is too large.");
    chunks.push(chunk);
  }
  if (!chunks.length || Buffer.concat(chunks).toString("utf8").trim() === "") return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AuditError("INVALID_INPUT", "The request body must be valid JSON.");
  }
}

function localCheckpoint(job) {
  const missionState = [1, 2].includes(job.mission?.schemaVersion)
    ? deriveAuditMissionState({
        report: job.report,
        mission: job.mission,
        diagnosticMissions: job.diagnosticMissions ?? [],
        repairs: job.repairs ?? [],
        browserReview: job.browserReview ?? null,
        explorations: job.explorations ?? [],
      })
    : null;
  return createMissionCheckpoint({
    audit: job,
    missionState,
    diagnosticMissions: job.diagnosticMissions ?? [],
    repairs: job.repairs ?? [],
    browserReview: job.browserReview ?? null,
    explorations: job.explorations ?? [],
    agentCapabilities: job.agentCapabilities ?? null,
  });
}

function assertLocalRevision(job, expectedMissionRevision) {
  if (expectedMissionRevision === undefined) return auditMissionRevision(job);
  return assertExpectedMissionRevision(job, expectedMissionRevision, localCheckpoint(job));
}

function advanceLocalRevision(job) {
  Object.assign(job, advanceMissionRevision(job));
  return job;
}

function checkpointedLocal(job, data) {
  return { ...data, missionCheckpoint: localCheckpoint(job) };
}

function snapshot(job) {
  return {
    id: job.id,
    attempt: Number.isFinite(job.attempt) ? job.attempt : 1,
    url: job.url,
    source: job.source,
    mission: job.mission ?? null,
    agentCapabilities: job.agentCapabilities
      ? agentCapabilitySnapshot(job.agentCapabilities)
      : null,
    missionRevision: auditMissionRevision(job),
    missionCheckpoint: localCheckpoint(job),
    status: job.status,
    phase: job.phase,
    phaseLabel: job.phaseLabel,
    progress: job.progress,
    exploration: job.exploration ?? job.report?.exploration ?? null,
    siteExploration: job.siteExploration ?? job.report?.siteExploration ?? null,
    report: job.status === "complete" ? job.report : null,
    error: job.error ?? null,
  };
}

function assertSameOrigin(request) {
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (!origin || !host) return;
  let originHost;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new AuditError("ORIGIN_MISMATCH", "Audit requests must come from this Frontmend page.");
  }
  if (originHost !== host) {
    throw new AuditError("ORIGIN_MISMATCH", "Audit requests must come from this Frontmend page.");
  }
}

export function createLocalAuditRuntime(options = {}) {
  const jobs = new Map();
  const recentUrls = new Map();
  const rates = new Map();
  const apiKey = options.apiKey ?? process.env.PAGESPEED_API_KEY;
  const fetchImpl = options.fetchImpl ?? fetch;
  const resolveHostname = options.resolveHostname
    ?? (options.fetchImpl ? null : resolveLocalHostname);

  const prune = (now = Date.now()) => {
    for (const [id, job] of jobs) {
      const terminalAt = job.completedAt ?? job.createdAt;
      if (["complete", "failed", "cancelled"].includes(job.status) && terminalAt <= now - JOB_RETENTION_MS) {
        jobs.delete(id);
      }
    }
    for (const [key, record] of recentUrls) {
      if (record.createdAt <= now - RATE_WINDOW_MS || !jobs.has(record.id)) recentUrls.delete(key);
    }
    for (const [client, timestamps] of rates) {
      const current = timestamps.filter((timestamp) => timestamp > now - RATE_WINDOW_MS);
      if (current.length) rates.set(client, current);
      else rates.delete(client);
    }
    const removable = [...jobs.values()]
      .filter((job) => ["complete", "failed", "cancelled"].includes(job.status))
      .sort((a, b) => (a.completedAt ?? a.createdAt) - (b.completedAt ?? b.createdAt));
    while (jobs.size > MAX_RETAINED_JOBS && removable.length) jobs.delete(removable.shift().id);
  };

  const run = async (job) => {
    const attempt = job.attempt;
    const signal = job.abortController?.signal;
    try {
      const output = await runFrontmendAudit({
        auditId: job.id,
        url: job.url,
        apiKey,
        fetchImpl,
        resolveHostname,
        signal,
        onProgress: async (progress) => {
          if (
            job.attempt !== attempt ||
            ["complete", "failed", "cancelled"].includes(job.status)
          ) return;
          Object.assign(job, { status: "running", ...progress });
        },
      });
      if (job.attempt !== attempt || job.status === "cancelled") return;
      if (job.verification) {
        output.report.verification = compareVerification(output.report, job.verification);
      }
      if (job.exploration) {
        output.report.exploration = job.exploration;
      }
      if (job.siteExploration) {
        output.report.siteExploration = job.siteExploration;
      }
      Object.assign(job, {
        status: "complete",
        phase: "complete",
        phaseLabel: "Live audit complete",
        progress: 100,
        report: output.report,
        screenshots: output.screenshots,
        error: null,
        completedAt: Date.now(),
      });
      advanceLocalRevision(job);
    } catch (error) {
      if (job.attempt !== attempt || job.status === "cancelled") return;
      if (error?.code === "AUDIT_CANCELLED") {
        Object.assign(job, {
          status: "cancelled",
          phase: "cancelled",
          phaseLabel: "Audit cancelled",
          report: null,
          error: null,
          completedAt: Date.now(),
        });
        return;
      }
      Object.assign(job, {
        status: "failed",
        phase: "failed",
        phaseLabel: "Live audit failed",
        report: null,
        error: {
          code: typeof error?.code === "string" ? error.code : "AUDIT_FAILED",
          message:
            typeof error?.message === "string"
              ? error.message.slice(0, 300)
              : "The live audit could not be completed.",
          recoverable: error?.recoverable !== false,
        },
        completedAt: Date.now(),
      });
      advanceLocalRevision(job);
    }
  };

  const startJob = ({
    url,
    source,
    client,
    ownerSessionHash,
    operationKey = "",
    mission = null,
    verification = null,
    exploration = null,
    siteExploration = null,
    rateRecorded = false,
  }) => {
    const now = Date.now();
    prune(now);
    const recent = (rates.get(client) ?? []).filter((timestamp) => timestamp > now - RATE_WINDOW_MS);
    if (!rateRecorded) {
      if (recent.length >= RATE_LIMIT) {
        throw new AuditError("RATE_LIMITED", "Too many live audits were started. Try again shortly.");
      }
      recent.push(now);
      rates.set(client, recent);
    }
    const reuseKey = `${ownerSessionHash}\n${operationKey ? `${url}\n${operationKey}` : url}`;
    const previous = recentUrls.get(reuseKey);
    if (previous && previous.createdAt > now - RATE_WINDOW_MS && jobs.has(previous.id)) {
      const previousJob = jobs.get(previous.id);
      if (!["failed", "cancelled"].includes(previousJob.status)) {
        return { job: previousJob, reused: true };
      }
      Object.assign(previousJob, {
        attempt: (Number.isFinite(previousJob.attempt) ? previousJob.attempt : 1) + 1,
        url,
        source,
        ownerSessionHash: previousJob.ownerSessionHash ?? ownerSessionHash,
        mission: previousJob.mission ?? mission,
        agentCapabilities: previousJob.agentCapabilities ?? null,
        verification,
        exploration,
        siteExploration,
        status: "queued",
        phase: "queued",
        phaseLabel: "Waiting for the live audit provider",
        progress: 4,
        report: null,
        screenshots: {},
        repairs: [],
        diagnosticMissions: [],
        browserReview: null,
        repairPolicy: repairPolicySnapshot(),
        error: null,
        abortController: new AbortController(),
        createdAt: now,
        completedAt: null,
        missionRevision: auditMissionRevision(previousJob) + 1,
      });
      recentUrls.set(reuseKey, { id: previousJob.id, createdAt: now });
      void run(previousJob);
      return { job: previousJob, reused: false };
    }
    const job = {
      id: crypto.randomUUID(),
      attempt: 1,
      url,
      source,
      ownerSessionHash,
      mission,
      agentCapabilities: null,
      missionRevision: 1,
      verification,
      exploration,
      siteExploration,
      status: "queued",
      phase: "queued",
      phaseLabel: "Waiting for the live audit provider",
      progress: 4,
      report: null,
      screenshots: {},
      repairs: [],
      diagnosticMissions: [],
      browserReview: null,
      repairPolicy: repairPolicySnapshot(),
      error: null,
      abortController: new AbortController(),
      createdAt: now,
      completedAt: null,
      explorations: [],
      activityLedger: [],
    };
    jobs.set(job.id, job);
    recentUrls.set(reuseKey, { id: job.id, createdAt: now });
    void run(job);
    return { job, reused: false };
  };

  const startJobBatch = ({ routes, source, client, ownerSessionHash, missionId, rootAuditId }) => {
    const now = Date.now();
    prune(now);
    const recent = (rates.get(client) ?? []).filter((timestamp) => timestamp > now - RATE_WINDOW_MS);
    if (recent.length + routes.length > RATE_LIMIT) {
      throw new AuditError(
        "RATE_LIMITED",
        "This site exploration exceeds the current live-audit budget. Try again shortly.",
      );
    }
    recent.push(...routes.map(() => now));
    rates.set(client, recent);
    return routes.map((route, index) =>
      startJob({
        url: route.url,
        source,
        client,
        ownerSessionHash,
        operationKey: `exploration:${missionId}:${route.path}`,
        exploration: route.exploration,
        siteExploration: {
          missionId,
          rootAuditId,
          position: index + 1,
          total: routes.length,
        },
        rateRecorded: true,
      }),
    );
  };

  const aggregateMission = (mission) => {
    const aggregate = siteExplorationSnapshot(
      mission,
      mission.children.map((child) => jobs.get(child.auditId)).filter(Boolean).map(snapshot),
    );
    const changed = JSON.stringify(mission.currentSnapshot ?? null) !== JSON.stringify(aggregate);
    if (changed) mission.currentSnapshot = aggregate;
    return aggregate;
  };

  const retainedExplorationReports = (root) => {
    const children = [];
    for (const mission of root.explorations ?? []) {
      for (const child of mission?.children ?? []) {
        if (
          child?.auditId &&
          !children.some((item) => item.auditId === child.auditId) &&
          children.length < verificationImpactLimits.maxOptionalTargets
        ) {
          children.push(child);
        }
      }
    }
    return children.map((child) => {
      const audit = jobs.get(child.auditId);
      return {
        auditId: child.auditId,
        path: child.path,
        url: child.url,
        status: audit?.status ?? "failed",
        report: audit?.status === "complete" ? audit.report : null,
      };
    });
  };

  const verificationImpactForRepair = (root, repair, verificationTargetIds) => {
    const packageItems = repair.findingPackage?.items?.length
      ? repair.findingPackage.items.map((item) => ({
          findingId: item.findingId,
          findingSource: item.source,
          findingScope: item.scope,
          findingEvidence: item.evidence,
          focusAreas: item.scope?.focusAreas ?? [],
        }))
      : [{
          findingId: repair.findingId,
          findingSource: repair.findingSource,
          findingScope: repair.findingScope,
          findingEvidence: repair.findingEvidence,
          focusAreas: repair.findingScope?.focusAreas ?? [],
        }];
    const impact = createRepairPackageVerificationImpact({
      repairId: repair.id,
      repairRevision: Number.isFinite(repair.revision) ? repair.revision : 1,
      rootReport: root.report,
      findings: packageItems,
      browserReview: root.browserReview ?? null,
      auditedReports: retainedExplorationReports(root),
      verificationTargetIds,
    });
    if (repair.status !== "approved") return impact;
    return reviewRepairVerificationImpact(
      impact,
      repair.approval?.mode === "delegated-auto" ? "delegated-auto-policy" : "person",
      repair.reviewedAt,
    );
  };

  const aggregateVerificationForRepair = (repair) => {
    if (!repair?.verificationImpact?.matrix || !repair?.verificationRun?.id) return null;
    const audits = (repair.verificationRun.assignments ?? []).map((assignment) => {
      if (!assignment.auditId) return null;
      const audit = jobs.get(assignment.auditId);
      return audit
        ? snapshot(audit)
        : { id: assignment.auditId, status: "failed", report: null };
    }).filter(Boolean);
    return aggregateRepairVerification(repair.verificationImpact, repair.verificationRun, audits);
  };

  const repairWorkspaceItem = (root, repair) => {
    const effectiveRepair = repair.verificationImpact
      ? repair
      : { ...repair, verificationImpact: createLegacyRepairVerificationImpact({ repair, rootReport: root.report }) };
    return repairWithMission({
      ...effectiveRepair,
      aggregateVerification: aggregateVerificationForRepair(effectiveRepair),
    });
  };

  return async function localAuditMiddleware(request, response, next) {
    const requestUrl = new URL(request.url, "http://frontmend.local");
    if (!requestUrl.pathname.startsWith("/api/")) return next();
    prune();

    try {
      if (requestUrl.pathname === "/api/version") {
        if (request.method !== "GET") {
          return sendError(response, new AuditError("METHOD_NOT_ALLOWED", "The build descriptor is read-only."), 405);
        }
        return sendJson(response, 200, { ok: true, data: createRuntimeBuildDescriptor(process.env) });
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/audits") {
        assertSameOrigin(request);
        const input = await readBody(request);
        const extra = Object.keys(input ?? {}).find((key) => !["url", "source", "mission"].includes(key));
        if (extra) throw new AuditError("INVALID_INPUT", `Unknown field: ${extra}.`);
        const url = normalizePublicUrl(input?.url);
        const source = input?.source === "agent" ? "agent" : "human";
        const mission = createAuditMission(input?.mission ?? {}, source);
        const client = request.socket.remoteAddress ?? "local-preview";
        const retainedSession = auditSessionTokenFromCookie(request.headers.cookie, { secure: false });
        const sessionToken = retainedSession ?? createAuditSessionToken();
        const ownerSessionHash = await hashAuditSessionToken(sessionToken);
        const { job, reused } = startJob({
          url,
          source,
          mission,
          client,
          ownerSessionHash,
          operationKey: `mission:${auditMissionSignature(mission)}`,
        });
        return sendJson(response, reused ? 200 : 202, { ok: true, data: snapshot(job) }, {
          location: `/api/audits/${job.id}`,
          ...(retainedSession
            ? {}
            : { "set-cookie": createAuditSessionCookie(sessionToken, { secure: false }) }),
        });
      }

      const scopedMutation = ["POST", "DELETE"].includes(request.method)
        ? requestUrl.pathname.match(/^\/api\/audits\/([^/]+)(?:\/|$)/)
        : null;
      if (scopedMutation) {
        const ownedJob = jobs.get(scopedMutation[1]);
        if (ownedJob) {
          const sessionToken = auditSessionTokenFromCookie(request.headers.cookie, { secure: false });
          const ownerSessionHash = sessionToken
            ? await hashAuditSessionToken(sessionToken)
            : null;
          if (!ownedJob.ownerSessionHash || ownerSessionHash !== ownedJob.ownerSessionHash) {
            return sendError(
              response,
              new AuditError(
                "AUDIT_WRITE_AUTHORITY_REQUIRED",
                "This shared audit is read-only in this browser. Start a new audit to make changes.",
              ),
              403,
            );
          }
        }
      }

      const routeMatch = requestUrl.pathname.match(/^\/api\/audits\/([^/]+)\/routes$/);
      if (routeMatch) {
        if (request.method !== "POST") {
          return sendError(
            response,
            new AuditError("METHOD_NOT_ALLOWED", "That route exploration operation is not supported."),
            405,
          );
        }
        assertSameOrigin(request);
        const input = await readBody(request);
        if (!input || typeof input !== "object" || Array.isArray(input)) {
          return sendError(response, new AuditError("INVALID_INPUT", "The request body must be an object."));
        }
        const extra = Object.keys(input).find((key) => !["path", "source", "expectedMissionRevision"].includes(key));
        if (extra) {
          return sendError(response, new AuditError("INVALID_INPUT", `Unknown field: ${extra}.`));
        }
        const baseline = jobs.get(routeMatch[1]);
        if (!baseline) {
          return sendError(
            response,
            new AuditError("AUDIT_NOT_FOUND", "No audit exists with that ID."),
            404,
          );
        }
        if (baseline.status !== "complete" || !baseline.report) {
          return sendError(
            response,
            new AuditError("AUDIT_NOT_READY", "Finish the parent audit before exploring its routes."),
            409,
          );
        }
        assertLocalRevision(baseline, input.expectedMissionRevision);
        const related = createRelatedAuditInput(baseline.report, input.path);
        const source = input.source === "agent" ? "agent" : "human";
        const client = request.socket.remoteAddress ?? "local-preview";
        const { job, reused } = startJob({
          url: related.url,
          source,
          client,
          ownerSessionHash: baseline.ownerSessionHash,
          operationKey: `route:${routeMatch[1]}:${related.exploration.observedPath}`,
          exploration: related.exploration,
        });
        advanceLocalRevision(baseline);
        return sendJson(response, reused ? 200 : 202, { ok: true, data: checkpointedLocal(baseline, snapshot(job)) }, {
          location: `/api/audits/${job.id}`,
        });
      }

      const explorationMatch = requestUrl.pathname.match(
        /^\/api\/audits\/([^/]+)\/explorations(?:\/([^/]+)(?:\/(report))?)?$/,
      );
      if (explorationMatch) {
        const [, rootAuditId, rawMissionId, resource] = explorationMatch;
        const root = jobs.get(rootAuditId);
        if (!root) {
          return sendError(
            response,
            new AuditError("AUDIT_NOT_FOUND", "No audit exists with that ID."),
            404,
          );
        }
        if (root.status !== "complete" || !root.report) {
          return sendError(
            response,
            new AuditError("AUDIT_NOT_READY", "Finish the root audit before exploring multiple pages."),
            409,
          );
        }
        if (!rawMissionId && request.method === "POST") {
          assertSameOrigin(request);
          const input = await readBody(request);
          if (!input || typeof input !== "object" || Array.isArray(input)) {
            return sendError(response, new AuditError("INVALID_INPUT", "The request body must be an object."));
          }
          const extra = Object.keys(input).find((key) => !["paths", "routeCandidateIds", "source", "expectedMissionRevision"].includes(key));
          if (extra) {
            return sendError(response, new AuditError("INVALID_INPUT", `Unknown field: ${extra}.`));
          }
          assertLocalRevision(root, input.expectedMissionRevision);
          const prepared = createSiteExplorationInputs(
            root.report,
            { paths: input.paths, routeCandidateIds: input.routeCandidateIds },
            { requireCandidateIds: root.mission?.scope === "bounded-site" },
          );
          const missionId = crypto.randomUUID();
          const source = input.source === "agent" ? "agent" : "human";
          const client = request.socket.remoteAddress ?? "local-preview";
          const started = startJobBatch({
            routes: prepared.routes,
            source,
            client,
            ownerSessionHash: root.ownerSessionHash,
            missionId,
            rootAuditId,
          });
          const mission = createSiteExplorationMission({
            missionId,
            rootAuditId,
            source,
            routes: prepared.routes,
            children: started.map(({ job }) => ({ auditId: job.id })),
            createdAt: Date.now(),
          });
          mission.currentSnapshot = aggregateMission(mission);
          root.explorations = [
            ...(root.explorations ?? []).filter((item) => item.id !== mission.id),
            mission,
          ].slice(-10);
          advanceLocalRevision(root);
          return sendJson(response, 202, { ok: true, data: checkpointedLocal(root, aggregateMission(mission)) }, {
            location: `/api/audits/${rootAuditId}/explorations/${missionId}`,
          });
        }
        if (!rawMissionId && request.method === "GET") {
          return sendJson(response, 200, {
            ok: true,
            data: checkpointedLocal(root, {
              rootAuditId,
              explorations: (root.explorations ?? []).map(aggregateMission),
            }),
          });
        }
        let missionId;
        try {
          missionId = assertMissionId(decodeURIComponent(rawMissionId ?? ""));
        } catch (error) {
          return sendError(response, error, 404);
        }
        const mission = (root.explorations ?? []).find((item) => item.id === missionId);
        if (!mission) {
          return sendError(
            response,
            new AuditError("EXPLORATION_NOT_FOUND", "No site exploration exists with that ID."),
            404,
          );
        }
        if (request.method !== "GET") {
          return sendError(
            response,
            new AuditError("METHOD_NOT_ALLOWED", "That site exploration operation is not supported."),
            405,
          );
        }
        const aggregate = aggregateMission(mission);
        if (resource === "report") {
          if (!["complete", "partial", "failed"].includes(aggregate.status)) {
            return sendError(
              response,
              new AuditError("AUDIT_NOT_READY", "Finish the selected page audits before exporting this exploration."),
              409,
            );
          }
          response.statusCode = 200;
          response.setHeader("content-type", "text/markdown; charset=utf-8");
          response.setHeader(
            "content-disposition",
            `attachment; filename="frontmend-site-exploration-${mission.id}.md"`,
          );
          response.setHeader("cache-control", "no-store");
          response.setHeader("x-content-type-options", "nosniff");
          return response.end(siteExplorationMarkdown(aggregate));
        }
        return sendJson(response, 200, { ok: true, data: checkpointedLocal(root, aggregate) });
      }

      const activityMatch = requestUrl.pathname.match(/^\/api\/audits\/([^/]+)\/activities$/);
      if (activityMatch) {
        const auditId = activityMatch[1];
        const job = jobs.get(auditId);
        if (!job) {
          return sendError(response, new AuditError("AUDIT_NOT_FOUND", "No audit exists with that ID."), 404);
        }
        if (!["GET", "POST"].includes(request.method)) {
          return sendError(response, new AuditError("METHOD_NOT_ALLOWED", "The activity ledger supports GET and POST only."), 405);
        }
        const current = activityLedgerSnapshot(job.activityLedger, auditId);
        if (request.method === "GET") {
          return sendJson(response, 200, {
            ok: true,
            data: checkpointedLocal(job, {
              auditId,
              activities: current,
              boundary: activityLedgerBoundary,
            }),
          });
        }
        assertSameOrigin(request);
        const input = await readBody(request);
        job.activityLedger = mergeActivityLedger(current, input, auditId);
        return sendJson(response, 200, {
          ok: true,
          data: checkpointedLocal(job, {
            auditId,
            activities: job.activityLedger,
            boundary: activityLedgerBoundary,
          }),
        });
      }

      const repairPolicyMatch = requestUrl.pathname.match(/^\/api\/audits\/([^/]+)\/repair-policy$/);

      const agentCapabilitiesMatch = requestUrl.pathname.match(
        /^\/api\/audits\/([^/]+)\/agent-capabilities$/,
      );
      if (agentCapabilitiesMatch) {
        const baseline = jobs.get(agentCapabilitiesMatch[1]);
        if (!baseline) {
          return sendError(response, new AuditError("AUDIT_NOT_FOUND", "No audit exists with that ID."), 404);
        }
        if (request.method !== "POST") {
          return sendError(
            response,
            new AuditError("METHOD_NOT_ALLOWED", "Agent capabilities can only be declared with POST."),
            405,
          );
        }
        assertSameOrigin(request);
        try {
          const input = await readBody(request);
          if (!input || typeof input !== "object" || Array.isArray(input)) {
            throw new AuditError("INVALID_AGENT_CAPABILITIES", "The request body must be an object.");
          }
          const extra = Object.keys(input).find(
            (key) => !["capabilities", "expectedMissionRevision"].includes(key),
          );
          if (extra) {
            throw new AuditError("INVALID_AGENT_CAPABILITIES", `Unknown agent capability field: ${extra}.`);
          }
          if (!Number.isInteger(input.expectedMissionRevision) || input.expectedMissionRevision < 1) {
            throw new AuditError(
              "INVALID_AGENT_CAPABILITIES",
              "expectedMissionRevision must identify the current positive mission revision.",
            );
          }
          const declaration = createAgentCapabilityDeclaration(
            input.capabilities,
            baseline.agentCapabilities ?? null,
          );
          const current = baseline.agentCapabilities
            ? agentCapabilitySnapshot(baseline.agentCapabilities)
            : null;
          if (current && JSON.stringify(current.capabilities) === JSON.stringify(declaration.capabilities)) {
            return sendJson(response, 200, {
              ok: true,
              data: checkpointedLocal(baseline, {
                auditId: baseline.id,
                audit: snapshot(baseline),
                agentCapabilities: current,
              }),
            });
          }
          assertLocalRevision(baseline, input.expectedMissionRevision);
          baseline.agentCapabilities = declaration;
          advanceLocalRevision(baseline);
          return sendJson(response, 200, {
            ok: true,
            data: checkpointedLocal(baseline, {
              auditId: baseline.id,
              audit: snapshot(baseline),
              agentCapabilities: declaration,
            }),
          });
        } catch (error) {
          return sendError(
            response,
            error,
            error?.code === "MISSION_REVISION_STALE" ? 409 : 400,
          );
        }
      }

      const prepareRepairMatch = requestUrl.pathname.match(
        /^\/api\/audits\/([^/]+)\/mission\/prepare-repair$/,
      );
      if (prepareRepairMatch) {
        const baseline = jobs.get(prepareRepairMatch[1]);
        if (!baseline) {
          return sendError(response, new AuditError("AUDIT_NOT_FOUND", "No audit exists with that ID."), 404);
        }
        if (request.method !== "POST") {
          return sendError(
            response,
            new AuditError("METHOD_NOT_ALLOWED", "That audit mission operation is not supported."),
            405,
          );
        }
        assertSameOrigin(request);
        if (baseline.status !== "complete" || !baseline.report) {
          return sendError(
            response,
            new AuditError("AUDIT_NOT_READY", "Finish the audit before preparing a finding for repair."),
            409,
          );
        }
        const input = await readBody(request);
        const extra = Object.keys(input ?? {}).find((key) => !["findingId", "findingIds", "source", "expectedMissionRevision"].includes(key));
        if (extra) return sendError(response, new AuditError("INVALID_INPUT", `Unknown mission field: ${extra}.`));
        if (input?.source !== "human" && input?.source !== "agent") {
          return sendError(response, new AuditError("INVALID_INPUT", "source must be human or agent."));
        }
        let requestedFindingIds;
        try {
          requestedFindingIds = normalizeRepairFindingIds(input.findingId, input.findingIds);
        } catch (error) {
          return sendError(response, error, 400);
        }
        const retainedFindings = assessmentFindings(baseline.report, baseline.browserReview);
        const findings = requestedFindingIds.map((id) => retainedFindings.find((item) => item.id === id));
        if (findings.some((finding) => !finding)) {
          return sendError(response, new AuditError("FINDING_NOT_FOUND", "Every repair-package finding must belong to this completed audit."), 404);
        }
        const retainedMission = baseline.mission ? auditMissionSnapshot(baseline.mission) : null;
        if (JSON.stringify(retainedMission?.repairPreparation?.findingIds ?? []) === JSON.stringify(requestedFindingIds)) {
          return sendJson(response, 200, {
            ok: true,
            data: checkpointedLocal(baseline, {
              audit: snapshot(baseline),
              mission: baseline.mission,
              missionState: deriveAuditMissionState({
                report: baseline.report,
                mission: baseline.mission,
                diagnosticMissions: baseline.diagnosticMissions ?? [],
                repairs: baseline.repairs ?? [],
                browserReview: baseline.browserReview ?? null,
                explorations: baseline.explorations ?? [],
              }),
            }),
          });
        }
        try {
          assertLocalRevision(baseline, input.expectedMissionRevision);
          baseline.mission = prepareRepairIntent(
            retainedMission ?? createAuditMission(
              {},
              baseline.source === "agent" ? "agent" : "human",
              Number.isInteger(baseline.createdAt) ? baseline.createdAt : Date.now(),
            ),
            requestedFindingIds,
            input.source,
          );
          advanceLocalRevision(baseline);
          return sendJson(response, 200, {
            ok: true,
            data: checkpointedLocal(baseline, {
              audit: snapshot(baseline),
              mission: baseline.mission,
              missionState: deriveAuditMissionState({
                report: baseline.report,
                mission: baseline.mission,
                diagnosticMissions: baseline.diagnosticMissions ?? [],
                repairs: baseline.repairs ?? [],
                browserReview: baseline.browserReview ?? null,
                explorations: baseline.explorations ?? [],
              }),
            }),
          });
        } catch (error) {
          return sendError(response, error, error?.code === "REPAIR_INTENT_CONFLICT" ? 409 : 400);
        }
      }

      if (repairPolicyMatch) {
        const baseline = jobs.get(repairPolicyMatch[1]);
        if (!baseline) {
          return sendError(response, new AuditError("AUDIT_NOT_FOUND", "No audit exists with that ID."), 404);
        }
        if (baseline.status !== "complete" || !baseline.report) {
          return sendError(response, new AuditError("AUDIT_NOT_READY", "Finish the audit before changing repair policy."), 409);
        }
        if (request.method === "GET") {
          return sendJson(response, 200, { ok: true, data: repairPolicySnapshot(baseline.repairPolicy) });
        }
        if (request.method === "POST") {
          assertSameOrigin(request);
          const input = await readBody(request);
          const { expectedMissionRevision, ...policyInput } = input ?? {};
          const nextPolicy = createRepairPolicy(policyInput);
          const currentPolicy = repairPolicySnapshot(baseline.repairPolicy);
          if (currentPolicy.mode === nextPolicy.mode) {
            return sendJson(response, 200, { ok: true, data: checkpointedLocal(baseline, currentPolicy) });
          }
          assertLocalRevision(baseline, expectedMissionRevision);
          baseline.repairPolicy = nextPolicy;
          advanceLocalRevision(baseline);
          return sendJson(response, 200, { ok: true, data: checkpointedLocal(baseline, baseline.repairPolicy) });
        }
        return sendError(
          response,
          new AuditError("METHOD_NOT_ALLOWED", "That repair policy operation is not supported."),
          405,
        );
      }

      const diagnosticMatch = requestUrl.pathname.match(
        /^\/api\/audits\/([^/]+)\/diagnostics(?:\/([^/]+)(?:\/(evidence|blocker))?)?$/,
      );
      if (diagnosticMatch) {
        const [, auditId, rawMissionId, action] = diagnosticMatch;
        const baseline = jobs.get(auditId);
        if (!baseline) return sendError(response, new AuditError("AUDIT_NOT_FOUND", "No audit exists with that ID."), 404);
        if (baseline.status !== "complete" || !baseline.report) {
          return sendError(response, new AuditError("AUDIT_NOT_READY", "Finish the audit before opening a diagnostic mission."), 409);
        }
        baseline.diagnosticMissions ??= [];
        if (!rawMissionId && request.method === "GET") {
          return sendJson(response, 200, {
            ok: true,
            data: checkpointedLocal(baseline, {
              auditId,
              missions: baseline.diagnosticMissions.map(diagnosticMissionSnapshot),
            }),
          });
        }
        if (!rawMissionId && request.method === "POST") {
          assertSameOrigin(request);
          const input = await readBody(request);
          const extra = Object.keys(input ?? {}).find((key) => !["findingId", "expectedMissionRevision"].includes(key));
          if (extra) return sendError(response, new AuditError("INVALID_DIAGNOSTIC_EVIDENCE", `Unknown diagnostic field: ${extra}.`));
          const finding = assessmentFindings(baseline.report, baseline.browserReview).find((item) => item.id === input?.findingId);
          if (!finding) return sendError(response, new AuditError("FINDING_NOT_FOUND", "That audit finding does not exist."), 404);
          const existing = baseline.diagnosticMissions.find((mission) => mission.findingId === finding.id);
          if (existing) return sendJson(response, 200, { ok: true, data: checkpointedLocal(baseline, diagnosticMissionSnapshot(existing)) });
          if (baseline.diagnosticMissions.length >= 10) return sendError(response, new AuditError("DIAGNOSTIC_LIMIT", "This audit already has the maximum number of diagnostic missions."));
          assertLocalRevision(baseline, input.expectedMissionRevision);
          const priority = baseline.mission
            ? deriveAuditMissionState({
                report: baseline.report,
                mission: baseline.mission,
                diagnosticMissions: baseline.diagnosticMissions,
                repairs: baseline.repairs,
                browserReview: baseline.browserReview,
                explorations: baseline.explorations ?? [],
              }).priorities.find((item) => item.findingId === finding.id)
            : null;
          const mission = createDiagnosticMission({
            auditId,
            finding,
            relationship: priority?.relationship ?? null,
          });
          baseline.diagnosticMissions.push(mission);
          advanceLocalRevision(baseline);
          return sendJson(response, 201, { ok: true, data: checkpointedLocal(baseline, mission) });
        }
        const missionId = decodeURIComponent(rawMissionId ?? "");
        const mission = baseline.diagnosticMissions.find((item) => item.id === missionId);
        if (!mission) return sendError(response, new AuditError("DIAGNOSTIC_NOT_FOUND", "That diagnostic mission does not exist."), 404);
        if (!action && request.method === "GET") {
          return sendJson(response, 200, {
            ok: true,
            data: checkpointedLocal(baseline, diagnosticMissionSnapshot(mission)),
          });
        }
        if (action === "evidence" && request.method === "POST") {
          assertSameOrigin(request);
          const input = await readBody(request);
          const { source, expectedMissionRevision, ...evidence } = input ?? {};
          if (source !== "agent" && source !== "person") {
            return sendError(response, new AuditError("INVALID_DIAGNOSTIC_EVIDENCE", "Diagnostic evidence must identify an agent or person source."));
          }
          assertLocalRevision(baseline, expectedMissionRevision);
          Object.assign(mission, submitDiagnosticEvidence(mission, evidence, source));
          advanceLocalRevision(baseline);
          return sendJson(response, 200, { ok: true, data: checkpointedLocal(baseline, mission) });
        }
        if (action === "blocker" && request.method === "POST") {
          assertSameOrigin(request);
          const input = await readBody(request);
          const { source, expectedMissionRevision, ...blocker } = input ?? {};
          if (source !== "agent" && source !== "person") {
            return sendError(response, new AuditError("INVALID_DIAGNOSTIC_BLOCKER", "A diagnostic blocker must identify an agent or person source."));
          }
          assertLocalRevision(baseline, expectedMissionRevision);
          Object.assign(mission, recordDiagnosticBlocker(mission, blocker, source));
          advanceLocalRevision(baseline);
          return sendJson(response, 200, { ok: true, data: checkpointedLocal(baseline, mission) });
        }
        return sendError(response, new AuditError("METHOD_NOT_ALLOWED", "That diagnostic operation is not supported."), 405);
      }

      const browserReviewMatch = requestUrl.pathname.match(
        /^\/api\/audits\/([^/]+)\/browser-review(?:\/([^/]+)\/(checks|withdrawal))?$/,
      );
      if (browserReviewMatch) {
        const [, auditId, rawReviewId, action] = browserReviewMatch;
        const baseline = jobs.get(auditId);
        if (!baseline) return sendError(response, new AuditError("AUDIT_NOT_FOUND", "No audit exists with that ID."), 404);
        const verificationReplay = baseline.verification?.browserReplay?.required === true
          || (baseline.verification?.browserReplays?.length ?? 0) > 0
          || (baseline.verification?.browserGuardrails?.length ?? 0) > 0;
        if (baseline.status !== "complete" || !baseline.report || (!baseline.mission && !verificationReplay)) {
          return sendError(response, new AuditError("AUDIT_NOT_READY", "Finish the measurement before opening its browser review."), 409);
        }
        if (!rawReviewId && request.method === "GET") {
          return sendJson(response, 200, {
            ok: true,
            data: checkpointedLocal(baseline, {
              auditId,
              review: baseline.browserReview ? browserReviewSnapshot(baseline.browserReview) : null,
            }),
          });
        }
        if (!rawReviewId && request.method === "POST") {
          assertSameOrigin(request);
          const input = await readBody(request);
          const extra = Object.keys(input ?? {}).find(
            (key) => !["source", "focusAreas", "expectedMissionRevision"].includes(key),
          );
          if (extra) return sendError(response, new AuditError("INVALID_BROWSER_REVIEW", `Unknown browser review field: ${extra}.`));
          if (baseline.browserReview) return sendJson(response, 200, { ok: true, data: checkpointedLocal(baseline, browserReviewSnapshot(baseline.browserReview)) });
          try {
            assertLocalRevision(baseline, input?.expectedMissionRevision);
            baseline.browserReview = verificationReplay
              ? createBrowserVerificationReview({
                  auditId,
                  verification: baseline.verification,
                  target: baseline.report.finalUrl ?? baseline.report.url ?? baseline.url,
                })
              : createBrowserReviewMission({
                  auditId,
                  mission: baseline.mission,
                  report: baseline.report,
                  documentProfile: baseline.report.documentProfile,
                  target: baseline.report.finalUrl ?? baseline.report.url ?? baseline.url,
                  source: input?.source,
                  focusAreas: input?.focusAreas,
                });
            advanceLocalRevision(baseline);
            return sendJson(response, 201, { ok: true, data: checkpointedLocal(baseline, baseline.browserReview) });
          } catch (error) {
            return sendError(
              response,
              error,
              ["MISSION_REVISION_STALE", "BROWSER_REVIEW_WITHDRAWAL_LOCKED", "BROWSER_REVIEW_WITHDRAWAL_UNAVAILABLE", "BROWSER_REVIEW_WITHDRAWN"].includes(error?.code)
                ? 409
                : 400,
            );
          }
        }
        if (action === "checks" && request.method === "POST") {
          assertSameOrigin(request);
          if (!baseline.browserReview || baseline.browserReview.id !== decodeURIComponent(rawReviewId ?? "")) {
            return sendError(response, new AuditError("BROWSER_REVIEW_NOT_FOUND", "That browser review does not exist."), 404);
          }
          const input = await readBody(request);
          const { source, expectedMissionRevision, ...check } = input ?? {};
          if (source !== "agent" && source !== "person") {
            return sendError(response, new AuditError("INVALID_BROWSER_REVIEW", "Browser review evidence must identify an agent or person source."));
          }
          try {
            if (isIdenticalBrowserReviewContribution(baseline.browserReview, check, source)) {
              return sendJson(response, 200, {
                ok: true,
                data: checkpointedLocal(baseline, browserReviewSnapshot(baseline.browserReview)),
              });
            }
            assertLocalRevision(baseline, expectedMissionRevision);
            baseline.browserReview = recordBrowserReviewCheck(baseline.browserReview, check, source);
            if (verificationReplay) {
              baseline.report.verification = compareVerification(
                baseline.report,
                baseline.verification,
                Date.now(),
                baseline.browserReview,
              );
            }
            advanceLocalRevision(baseline);
            return sendJson(response, 200, { ok: true, data: checkpointedLocal(baseline, baseline.browserReview) });
          } catch (error) {
            return sendError(
              response,
              error,
              ["MISSION_REVISION_STALE", "BROWSER_REVIEW_WITHDRAWAL_LOCKED", "BROWSER_REVIEW_WITHDRAWAL_UNAVAILABLE", "BROWSER_REVIEW_WITHDRAWN"].includes(error?.code)
                ? 409
                : 400,
            );
          }
        }
        if (action === "withdrawal" && request.method === "POST") {
          assertSameOrigin(request);
          if (!baseline.browserReview || baseline.browserReview.id !== decodeURIComponent(rawReviewId ?? "")) {
            return sendError(response, new AuditError("BROWSER_REVIEW_NOT_FOUND", "That browser review does not exist."), 404);
          }
          const input = await readBody(request);
          const extra = Object.keys(input ?? {}).find(
            (key) => !["source", "expectedMissionRevision"].includes(key),
          );
          if (extra) return sendError(response, new AuditError("INVALID_BROWSER_REVIEW", `Unknown browser review withdrawal field: ${extra}.`));
          if (input?.source !== "person") {
            return sendError(response, new AuditError(
              "BROWSER_REVIEW_WITHDRAWAL_HUMAN_ONLY",
              "Only a person can withdraw an optional rendered-review handoff.",
            ));
          }
          try {
            const current = browserReviewSnapshot(baseline.browserReview);
            if (current.withdrawal?.status === "withdrawn") {
              return sendJson(response, 200, { ok: true, data: checkpointedLocal(baseline, current) });
            }
            assertLocalRevision(baseline, input.expectedMissionRevision);
            baseline.browserReview = withdrawBrowserReview(current, "person");
            advanceLocalRevision(baseline);
            return sendJson(response, 200, { ok: true, data: checkpointedLocal(baseline, baseline.browserReview) });
          } catch (error) {
            return sendError(
              response,
              error,
              ["MISSION_REVISION_STALE", "BROWSER_REVIEW_WITHDRAWAL_LOCKED", "BROWSER_REVIEW_WITHDRAWAL_UNAVAILABLE", "BROWSER_REVIEW_WITHDRAWN"].includes(error?.code)
                ? 409
                : 400,
            );
          }
        }
        return sendError(response, new AuditError("METHOD_NOT_ALLOWED", "That browser review operation is not supported."), 405);
      }

      const verificationCandidateMatch = requestUrl.pathname.match(
        /^\/api\/audits\/([^/]+)\/verification-candidates$/,
      );
      if (verificationCandidateMatch) {
        if (request.method !== "GET") {
          return sendError(response, new AuditError("METHOD_NOT_ALLOWED", "Verification candidates are read-only."), 405);
        }
        const baseline = jobs.get(verificationCandidateMatch[1]);
        if (!baseline) return sendError(response, new AuditError("AUDIT_NOT_FOUND", "No audit exists with that ID."), 404);
        if (baseline.status !== "complete" || !baseline.report) {
          return sendError(response, new AuditError("AUDIT_NOT_READY", "Finish the audit before reading verification candidates."), 409);
        }
        const findingId = requestUrl.searchParams.get("findingId");
        let requestedFindingIds;
        try {
          const queryFindingIds = requestUrl.searchParams.getAll("findingIds");
          requestedFindingIds = normalizeRepairFindingIds(findingId, queryFindingIds.length ? queryFindingIds : undefined);
        } catch (error) {
          return sendError(response, error, 400);
        }
        const retainedFindings = assessmentFindings(baseline.report, baseline.browserReview);
        const findings = requestedFindingIds.map((id) => retainedFindings.find((item) => item.id === id));
        if (findings.some((finding) => !finding)) {
          return sendError(response, new AuditError("FINDING_NOT_FOUND", "Every repair-package finding must belong to this completed audit."), 404);
        }
        const previewRepair = createRepairDraft({
          repairId: `candidate-${baseline.id}`,
          auditId: baseline.id,
          finding: findings[0],
          findings,
          report: baseline.report,
          input: { findingId: requestedFindingIds[0], findingIds: requestedFindingIds },
          source: "human",
        });
        return sendJson(response, 200, {
          ok: true,
          data: checkpointedLocal(
            baseline,
            verificationCandidateProjection(
              verificationImpactForRepair(baseline, previewRepair, []),
            ),
          ),
        });
      }

      const candidateReviewMatch = requestUrl.pathname.match(
        /^\/api\/audits\/([^/]+)\/repairs\/([^/]+)\/candidate-review(?:\/(checks))?$/,
      );
      if (candidateReviewMatch) {
        const [, auditId, rawRepairId, action] = candidateReviewMatch;
        if ((action && request.method !== "POST") || (!action && !["GET", "POST"].includes(request.method))) {
          return sendError(response, new AuditError("METHOD_NOT_ALLOWED", "That candidate review operation is not supported."), 405);
        }
        const baseline = jobs.get(auditId);
        if (!baseline) return sendError(response, new AuditError("AUDIT_NOT_FOUND", "No audit exists with that ID."), 404);
        if (baseline.status !== "complete" || !baseline.report) {
          return sendError(response, new AuditError("AUDIT_NOT_READY", "Finish the audit before opening candidate review."), 409);
        }
        const repairId = validateRepairId(decodeURIComponent(rawRepairId));
        const repair = baseline.repairs.find((item) => item.id === repairId);
        if (!repair) return sendError(response, new AuditError("REPAIR_NOT_FOUND", "That repair draft does not exist."), 404);
        if (!action && request.method === "GET") {
          return sendJson(response, 200, { ok: true, data: checkpointedLocal(baseline, repairWorkspaceItem(baseline, repair)) });
        }
        assertSameOrigin(request);
        const input = await readBody(request);
        try {
          if (!action) {
            const extra = Object.keys(input ?? {}).find(
              (key) => !["candidateOrigin", "source", "expectedMissionRevision"].includes(key),
            );
            if (extra) throw new AuditError("INVALID_CANDIDATE_REVIEW", `Unknown candidate review field: ${extra}.`);
            if (input?.source !== "agent" && input?.source !== "person") {
              throw new AuditError("INVALID_CANDIDATE_REVIEW", "Candidate review must identify an agent or person source.");
            }
            const next = openCandidateReview(repair, { candidateOrigin: input.candidateOrigin }, input.source);
            if (next !== repair) {
              assertLocalRevision(baseline, input.expectedMissionRevision);
              Object.assign(repair, next);
              advanceLocalRevision(baseline);
            }
            return sendJson(response, next === repair ? 200 : 201, {
              ok: true,
              data: checkpointedLocal(baseline, repairWorkspaceItem(baseline, repair)),
            });
          }
          const { reviewId, source, expectedMissionRevision, ...check } = input ?? {};
          if (source !== "agent" && source !== "person") {
            throw new AuditError("INVALID_CANDIDATE_REVIEW", "Candidate review evidence must identify an agent or person source.");
          }
          if (!isIdenticalCandidateReviewContribution(repair, reviewId, check, source)) {
            assertLocalRevision(baseline, expectedMissionRevision);
            Object.assign(repair, recordCandidateReviewCheck(repair, reviewId, check, source));
            advanceLocalRevision(baseline);
          }
          return sendJson(response, 200, {
            ok: true,
            data: checkpointedLocal(baseline, repairWorkspaceItem(baseline, repair)),
          });
        } catch (error) {
          const status = [
            "MISSION_REVISION_STALE",
            "REPAIR_NOT_APPROVED",
            "IMPLEMENTATION_CHECKS_REQUIRED",
            "CANDIDATE_REVIEW_EXISTS",
            "CANDIDATE_REVIEW_PREDEPLOYMENT_ONLY",
            "CANDIDATE_REVIEW_STALE",
            "CANDIDATE_CORRECTION_REQUIRED",
            "BROWSER_REVIEW_SEQUENCE",
            "BROWSER_REVIEW_COMPLETE",
            "BROWSER_REVIEW_CHECK_COMPLETE",
          ].includes(error?.code) ? 409 : error?.code === "CANDIDATE_REVIEW_NOT_FOUND" ? 404 : 400;
          return sendError(response, error, status);
        }
      }

      const aggregateVerificationMatch = requestUrl.pathname.match(
        /^\/api\/audits\/([^/]+)\/repairs\/([^/]+)\/verification(?:\/(receipt))?$/,
      );
      if (aggregateVerificationMatch) {
        if (request.method !== "GET") {
          return sendError(response, new AuditError("METHOD_NOT_ALLOWED", "Aggregate verification reads are GET-only."), 405);
        }
        const [, auditId, rawRepairId, receipt] = aggregateVerificationMatch;
        const baseline = jobs.get(auditId);
        if (!baseline) return sendError(response, new AuditError("AUDIT_NOT_FOUND", "No audit exists with that ID."), 404);
        const repairId = validateRepairId(decodeURIComponent(rawRepairId));
        const repair = baseline.repairs.find((item) => item.id === repairId);
        if (!repair) return sendError(response, new AuditError("REPAIR_NOT_FOUND", "That repair draft does not exist."), 404);
        const aggregate = aggregateVerificationForRepair(repair);
        if (!aggregate) return sendError(response, new AuditError("VERIFICATION_RUN_NOT_FOUND", "No aggregate verification run exists."), 404);
        if (!receipt) {
          return sendJson(response, 200, { ok: true, data: checkpointedLocal(baseline, aggregate) });
        }
        try {
          response.statusCode = 200;
          response.setHeader("content-type", "text/markdown; charset=utf-8");
          response.setHeader(
            "content-disposition",
            `attachment; filename="frontmend-repair-verification-${repair.id}.md"`,
          );
          response.setHeader("cache-control", "no-store");
          response.setHeader("x-content-type-options", "nosniff");
          return response.end(repairVerificationReceiptMarkdown(aggregate));
        } catch (error) {
          return sendError(response, error, 409);
        }
      }

      const repairMatch = requestUrl.pathname.match(
        /^\/api\/audits\/([^/]+)\/repairs(?:\/([^/]+)(?:\/(approve|changes|revise|implementation|deployment|verify|export))?)?$/,
      );
      if (repairMatch) {
        const [, auditId, rawRepairId, action] = repairMatch;
        const baseline = jobs.get(auditId);
        if (!baseline) {
          return sendError(response, new AuditError("AUDIT_NOT_FOUND", "No audit exists with that ID."), 404);
        }
        if (baseline.status !== "complete" || !baseline.report) {
          return sendError(response, new AuditError("AUDIT_NOT_READY", "Finish the audit before staging a repair."), 409);
        }
        if (!rawRepairId && request.method === "GET") {
          return sendJson(response, 200, {
            ok: true,
            data: checkpointedLocal(baseline, {
              auditId,
              repairs: baseline.repairs.map((repair) => repairWorkspaceItem(baseline, repair)),
              policy: repairPolicySnapshot(baseline.repairPolicy),
            }),
          });
        }
        if (!rawRepairId && request.method === "POST") {
          assertSameOrigin(request);
          const input = await readBody(request);
          let requestedFindingIds;
          try {
            requestedFindingIds = normalizeRepairFindingIds(input?.findingId, input?.findingIds);
          } catch (error) {
            return sendError(response, error, 400);
          }
          const retainedFindings = assessmentFindings(baseline.report, baseline.browserReview);
          const findings = requestedFindingIds.map((id) => retainedFindings.find((item) => item.id === id));
          if (findings.some((finding) => !finding)) {
            return sendError(response, new AuditError("FINDING_NOT_FOUND", "Every repair-package finding must belong to this completed audit."), 404);
          }
          const existing = baseline.repairs.find((repair) => JSON.stringify(repair.findingIds ?? [repair.findingId]) === JSON.stringify(requestedFindingIds));
          if (existing) {
            return sendJson(response, 200, { ok: true, data: checkpointedLocal(baseline, repairWorkspaceItem(baseline, existing)) });
          }
          if (baseline.repairs.some((repair) => (repair.findingIds ?? [repair.findingId]).some((id) => requestedFindingIds.includes(id)))) {
            return sendError(response, new AuditError(
              "REPAIR_PACKAGE_CONFLICT",
              "A retained finding already belongs to a different repair package.",
            ), 409);
          }
          const preparedFindingIds = baseline.mission
            ? auditMissionSnapshot(baseline.mission).repairPreparation?.findingIds ?? []
            : [];
          if (JSON.stringify(preparedFindingIds) !== JSON.stringify(requestedFindingIds)) {
            return sendError(
              response,
              new AuditError(
                "REPAIR_INTENT_REQUIRED",
                "Record explicit repair intent for this exact frozen finding package before staging a repair draft.",
              ),
              409,
            );
          }
          if (baseline.repairs.length >= 10) {
            return sendError(response, new AuditError("REPAIR_LIMIT", "This audit already has the maximum number of repair drafts."));
          }
          const { source, expectedMissionRevision, verificationTargetIds, ...proposal } = input;
          assertLocalRevision(baseline, expectedMissionRevision);
          const priorities = baseline.mission
            ? deriveAuditMissionState({
                report: baseline.report,
                mission: baseline.mission,
                diagnosticMissions: baseline.diagnosticMissions ?? [],
                repairs: baseline.repairs,
                browserReview: baseline.browserReview,
                explorations: baseline.explorations ?? [],
              }).priorities
            : [];
          const packageDiagnosticMissions = [];
          for (const finding of findings) {
            const priority = priorities.find((item) => item.findingId === finding.id);
            const diagnosticRequired = findingRequiresDiagnosticMission(finding) || priority?.diagnosticMissionRequired;
            const diagnosticMission = (baseline.diagnosticMissions ?? []).find((mission) => mission.findingId === finding.id) ?? null;
            if (diagnosticRequired && (source === "agent" || findings.length > 1) && diagnosticMission?.state?.state !== "ready-for-repair") {
              return sendError(response, new AuditError(
                "DIAGNOSTIC_MISSION_REQUIRED",
                "Every diagnosis-required finding in this package must have repair-ready runtime and repository evidence before staging.",
              ), 409);
            }
            if (diagnosticMission?.state?.state === "ready-for-repair") packageDiagnosticMissions.push(diagnosticMissionForRepair(diagnosticMission));
          }
          const repairId = crypto.randomUUID();
          let repair = createRepairDraft({
            repairId,
            auditId,
            finding: findings[0],
            findings,
            diagnosticMissions: packageDiagnosticMissions,
            report: baseline.report,
            input: proposal,
            source,
          });
          repair = {
            ...repair,
            verificationImpact: verificationImpactForRepair(
              baseline,
              repair,
              verificationTargetIds ?? [],
            ),
          };
          const policyResult = applyRepairPolicy(repair, baseline.repairPolicy);
          repair = policyResult.repair;
          baseline.repairPolicy = policyResult.policy;
          baseline.repairs.push(repair);
          advanceLocalRevision(baseline);
          return sendJson(response, 201, { ok: true, data: checkpointedLocal(baseline, repairWorkspaceItem(baseline, repair)) });
        }

        const repairId = validateRepairId(decodeURIComponent(rawRepairId ?? ""));
        const repair = baseline.repairs.find((item) => item.id === repairId);
        if (!repair) {
          return sendError(response, new AuditError("REPAIR_NOT_FOUND", "That repair draft does not exist."), 404);
        }
        if (!action && request.method === "GET") {
          return sendJson(response, 200, { ok: true, data: repairWorkspaceItem(baseline, repair) });
        }
        if (action === "approve" && request.method === "POST") {
          assertSameOrigin(request);
          const input = await readBody(request);
          if (repair.status === "changes-requested") {
            return sendError(
              response,
              new AuditError("CHANGES_REQUESTED", "Revise this repair before it can be approved."),
              409,
            );
          }
          if (repair.status !== "approved") {
            assertLocalRevision(baseline, input?.expectedMissionRevision);
            const approvedAt = Date.now();
            Object.assign(repair, {
              verificationImpact: reviewRepairVerificationImpact(
                repair.verificationImpact ?? createLegacyRepairVerificationImpact({ repair, rootReport: baseline.report }),
                "person",
                approvedAt,
              ),
              status: "approved",
              requiresHumanReview: false,
              reviewedAt: approvedAt,
              approval: { mode: "explicit-review", grantedBy: "person", approvedAt },
            });
            advanceLocalRevision(baseline);
          }
          return sendJson(response, 200, { ok: true, data: checkpointedLocal(baseline, repairWorkspaceItem(baseline, repair)) });
        }
        if (action === "changes" && request.method === "POST") {
          assertSameOrigin(request);
          const input = await readBody(request);
          const extra = Object.keys(input ?? {}).find((key) => !["feedback", "expectedMissionRevision"].includes(key));
          if (extra) {
            return sendError(response, new AuditError("INVALID_REPAIR", `Unknown repair field: ${extra}.`));
          }
          assertLocalRevision(baseline, input?.expectedMissionRevision);
          Object.assign(repair, requestRepairChanges(repair, input?.feedback));
          advanceLocalRevision(baseline);
          return sendJson(response, 200, { ok: true, data: checkpointedLocal(baseline, repairWorkspaceItem(baseline, repair)) });
        }
        if (action === "revise" && request.method === "POST") {
          assertSameOrigin(request);
          const input = await readBody(request);
          const { source, expectedMissionRevision, ...proposal } = input ?? {};
          if (source !== undefined && source !== "agent") {
            return sendError(
              response,
              new AuditError("INVALID_REPAIR", "Repair revisions must be agent-authored."),
            );
          }
          assertLocalRevision(baseline, expectedMissionRevision);
          const repairWithImpact = repair.verificationImpact
            ? repair
            : { ...repair, verificationImpact: createLegacyRepairVerificationImpact({ repair, rootReport: baseline.report }) };
          Object.assign(repair, reviseRepairDraft(repairWithImpact, proposal, "agent"));
          advanceLocalRevision(baseline);
          return sendJson(response, 200, { ok: true, data: checkpointedLocal(baseline, repairWorkspaceItem(baseline, repair)) });
        }
        if (action === "implementation" && request.method === "POST") {
          assertSameOrigin(request);
          const input = await readBody(request);
          const { source, expectedMissionRevision, ...receipt } = input ?? {};
          if (source !== "agent") {
            return sendError(
              response,
              new AuditError("INVALID_IMPLEMENTATION_RECEIPT", "Repository implementation receipts must be agent-reported."),
            );
          }
          assertLocalRevision(baseline, expectedMissionRevision);
          Object.assign(repair, recordRepositoryImplementation(repair, receipt));
          advanceLocalRevision(baseline);
          return sendJson(response, 200, { ok: true, data: checkpointedLocal(baseline, repairWorkspaceItem(baseline, repair)) });
        }
        if (action === "deployment" && request.method === "POST") {
          assertSameOrigin(request);
          const input = await readBody(request);
          if (repair.status !== "approved") {
            return sendError(
              response,
              new AuditError("REPAIR_NOT_APPROVED", "Approve this repair draft before confirming deployment."),
              409,
            );
          }
          if (!Number.isFinite(repair.deploymentAttestedAt)) {
            assertLocalRevision(baseline, input?.expectedMissionRevision);
            repair.deploymentAttestedAt = Date.now();
            advanceLocalRevision(baseline);
          }
          return sendJson(response, 200, { ok: true, data: checkpointedLocal(baseline, repairWorkspaceItem(baseline, repair)) });
        }
        if (action === "verify" && request.method === "POST") {
          assertSameOrigin(request);
          const input = await readBody(request);
          if (repair.status !== "approved") {
            return sendError(response, new AuditError("REPAIR_NOT_APPROVED", "Approve this repair draft before verification."), 409);
          }
          if (!Number.isFinite(repair.deploymentAttestedAt)) {
            return sendError(
              response,
              new AuditError(
                "DEPLOYMENT_NOT_ATTESTED",
                "A person must confirm the reviewed change was deployed before verification.",
              ),
              409,
            );
          }
          const effectiveImpact = repair.verificationImpact
            ?? createLegacyRepairVerificationImpact({ repair, rootReport: baseline.report });
          if (repair.verificationRun?.id && repair.verificationRun.repairRevision === effectiveImpact.repairRevision) {
            const aggregateVerification = aggregateVerificationForRepair(repair);
            const primaryId = repair.verificationRun.assignments?.[0]?.auditId;
            const primary = primaryId ? jobs.get(primaryId) : null;
            return sendJson(response, 200, {
              ok: true,
              data: checkpointedLocal(baseline, {
                ...(primary ? snapshot(primary) : {}),
                baselineAuditId: baseline.id,
                repairId: repair.id,
                verificationAuditIds: repair.verificationRun.assignments.map((assignment) => assignment.auditId).filter(Boolean),
                aggregateVerification,
              }),
            }, primaryId ? { location: `/api/audits/${primaryId}` } : {});
          }
          reviewedVerificationTargets(effectiveImpact);
          const reviewedImpact = effectiveImpact;
          assertLocalRevision(baseline, input?.expectedMissionRevision);
          const run = createRepairVerificationRun(reviewedImpact, crypto.randomUUID());
          const targets = reviewedVerificationTargets(reviewedImpact);
          const client = request.socket.remoteAddress ?? "local-preview";
          const now = Date.now();
          const recent = (rates.get(client) ?? []).filter((timestamp) => timestamp > now - RATE_WINDOW_MS);
          if (recent.length + targets.length > RATE_LIMIT) {
            throw new AuditError(
              "RATE_LIMITED",
              "This reviewed verification matrix exceeds the current live-audit budget. Try again shortly.",
            );
          }
          recent.push(...targets.map(() => now));
          rates.set(client, recent);
          const started = targets.map((target) => startJob({
            url: target.url,
            source: "verification",
            client,
            ownerSessionHash: baseline.ownerSessionHash,
            operationKey: `verification:${run.id}:${target.id}`,
            verification: {
              ...createVerificationContext(target.baselineReport, {
                ...repair,
                verificationImpact: reviewedImpact,
              }),
              browserReplay: browserReplaysForVerificationRows(target.rows)[0] ?? null,
              browserReplays: browserReplaysForVerificationRows(target.rows),
              browserGuardrails: target.rows
                .filter((row) => row.proofKind === "browser-guardrail")
                .map((row) => ({ ...row.baseline })),
              aggregateMatrix: {
                schemaVersion: 1,
                runId: run.id,
                targetId: target.id,
                rowIds: target.rows.map((row) => row.id),
              },
            },
            rateRecorded: true,
          }));
          repair.verificationImpact = reviewedImpact;
          repair.verificationRun = assignRepairVerificationJobs(
            run,
            targets.map((target, index) => ({ targetId: target.id, auditId: started[index].job.id })),
          );
          advanceLocalRevision(baseline);
          const primary = started[0].job;
          return sendJson(response, started.every((item) => item.reused) ? 200 : 202, {
            ok: true,
            data: checkpointedLocal(baseline, {
              ...snapshot(primary),
              baselineAuditId: baseline.id,
              repairId: repair.id,
              verificationAuditIds: started.map((item) => item.job.id),
              aggregateVerification: aggregateVerificationForRepair(repair),
            }),
          }, {
            location: `/api/audits/${primary.id}`,
          });
        }
        if (action === "export" && request.method === "GET") {
          const markdown = repairExportMarkdown({ report: baseline.report, repair });
          response.statusCode = 200;
          response.setHeader("content-type", "text/markdown; charset=utf-8");
          response.setHeader("content-disposition", `attachment; filename="frontmend-repair-${repair.id}.md"`);
          response.setHeader("cache-control", "no-store");
          response.setHeader("x-content-type-options", "nosniff");
          return response.end(markdown);
        }
        return sendError(response, new AuditError("METHOD_NOT_ALLOWED", "That repair operation is not supported."), 405);
      }

      const match = requestUrl.pathname.match(
        /^\/api\/audits\/([^/]+)(?:\/(results|checkpoint|report|receipt|assessment|evidence)(?:\/([^/]+))?)?$/,
      );
      if (!match) {
        return sendError(response, new AuditError("NOT_FOUND", "That API route does not exist."), 404);
      }
      const [, id, resource, evidenceId] = match;
      const job = jobs.get(id);
      if (!job) return sendError(response, new AuditError("AUDIT_NOT_FOUND", "No audit exists with that ID."), 404);
      if (request.method === "DELETE" && !resource) {
        assertSameOrigin(request);
        if (!["complete", "failed", "cancelled"].includes(job.status)) {
          const input = await readOptionalBody(request);
          assertLocalRevision(job, input?.expectedMissionRevision);
          job.abortController?.abort("cancelled");
          Object.assign(job, {
            status: "cancelled",
            phase: "cancelled",
            phaseLabel: "Audit cancelled",
            report: null,
            error: null,
            completedAt: Date.now(),
          });
          advanceLocalRevision(job);
        }
        return sendJson(response, 200, { ok: true, data: snapshot(job) });
      }
      if (request.method !== "GET") {
        return sendError(
          response,
          new AuditError("METHOD_NOT_ALLOWED", "That audit operation is not supported."),
          405,
        );
      }
      if (resource === "results") {
        if (job.status === "cancelled") {
          return sendError(response, new AuditError("AUDIT_CANCELLED", "The audit was cancelled."), 409);
        }
        if (job.status === "failed") return sendJson(response, 422, { ok: false, error: job.error });
        if (job.status !== "complete") {
          return sendError(response, new AuditError("AUDIT_NOT_READY", "The audit is still running."), 409);
        }
        return sendJson(response, 200, { ok: true, data: checkpointedLocal(job, job.report) });
      }
      if (resource === "checkpoint") {
        return sendJson(response, 200, { ok: true, data: localCheckpoint(job) });
      }
      if (resource === "receipt") {
        if (job.status !== "complete" || !job.report) {
          return sendError(response, new AuditError("AUDIT_NOT_READY", "The audit is still running."), 409);
        }
        try {
          const markdown = verificationReceiptMarkdown(job.report);
          response.statusCode = 200;
          response.setHeader("content-type", "text/markdown; charset=utf-8");
          response.setHeader(
            "content-disposition",
            `attachment; filename="frontmend-verification-${job.id}.md"`,
          );
          response.setHeader("cache-control", "no-store");
          response.setHeader("x-content-type-options", "nosniff");
          return response.end(markdown);
        } catch (error) {
          return sendError(
            response,
            error,
            error?.code === "VERIFICATION_RECEIPT_UNAVAILABLE" ? 409 : 400,
          );
        }
      }
      if (resource === "report") {
        if (job.status !== "complete" || !job.report) {
          return sendError(response, new AuditError("AUDIT_NOT_READY", "The audit is still running."), 409);
        }
        const markdown = auditReportMarkdown(job.report);
        response.statusCode = 200;
        response.setHeader("content-type", "text/markdown; charset=utf-8");
        response.setHeader(
          "content-disposition",
          `attachment; filename="frontmend-audit-${job.id}.md"`,
        );
        response.setHeader("cache-control", "no-store");
        response.setHeader("x-content-type-options", "nosniff");
        return response.end(markdown);
      }
      if (resource === "assessment") {
        if (job.status !== "complete" || !job.report) {
          return sendError(response, new AuditError("AUDIT_NOT_READY", "The audit is still running."), 409);
        }
        try {
          const receipt = createAssessmentReceipt({
            report: job.report,
            mission: job.mission,
            diagnosticMissions: job.diagnosticMissions ?? [],
            browserReview: job.browserReview ?? null,
            repairs: job.repairs ?? [],
            explorations: job.explorations ?? [],
            activities: job.activityLedger ?? [],
          });
          response.statusCode = 200;
          response.setHeader("content-type", "text/markdown; charset=utf-8");
          response.setHeader(
            "content-disposition",
            `attachment; filename="frontmend-assessment-${job.id}.md"`,
          );
          response.setHeader("cache-control", "no-store");
          response.setHeader("x-content-type-options", "nosniff");
          return response.end(assessmentReceiptMarkdown(receipt));
        } catch (error) {
          return sendError(response, error, error?.code === "ASSESSMENT_INCOMPLETE" ? 409 : 400);
        }
      }
      if (resource === "evidence") {
        const dataUrl = job.screenshots[evidenceId];
        const image = dataUrl?.match(/^data:(image\/(?:jpeg|png|webp));base64,([a-z0-9+/=]+)$/i);
        if (!image) {
          return sendError(
            response,
            new AuditError("EVIDENCE_NOT_FOUND", "That evidence image is unavailable."),
            404,
          );
        }
        response.statusCode = 200;
        response.setHeader("content-type", image[1]);
        response.setHeader("cache-control", "public, max-age=600, immutable");
        response.setHeader("x-content-type-options", "nosniff");
        return response.end(Buffer.from(image[2], "base64"));
      }
      return sendJson(response, 200, { ok: true, data: snapshot(job) });
    } catch (error) {
      return sendError(
        response,
        error,
        error?.code === "RATE_LIMITED" ? 429 : error?.code === "MISSION_REVISION_STALE" ? 409 : 400,
      );
    }
  };
}
