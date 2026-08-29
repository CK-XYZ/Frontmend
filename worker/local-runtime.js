import { AuditError, normalizePublicUrl } from "../src/url-policy.js";
import {
  auditMissionSignature,
  createAuditMission,
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
import {
  createDiagnosticMission,
  diagnosticMissionForRepair,
  diagnosticMissionSnapshot,
  findingRequiresDiagnosticMission,
  submitDiagnosticEvidence,
} from "../src/diagnostic-contract.js";

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

function snapshot(job) {
  return {
    id: job.id,
    attempt: Number.isFinite(job.attempt) ? job.attempt : 1,
    url: job.url,
    source: job.source,
    mission: job.mission ?? null,
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
    }
  };

  const startJob = ({
    url,
    source,
    client,
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
    const reuseKey = operationKey ? `${url}\n${operationKey}` : url;
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
        mission: previousJob.mission ?? mission,
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
        repairPolicy: repairPolicySnapshot(),
        error: null,
        abortController: new AbortController(),
        createdAt: now,
        completedAt: null,
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
      mission,
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
      repairPolicy: repairPolicySnapshot(),
      error: null,
      abortController: new AbortController(),
      createdAt: now,
      completedAt: null,
      explorations: [],
    };
    jobs.set(job.id, job);
    recentUrls.set(reuseKey, { id: job.id, createdAt: now });
    void run(job);
    return { job, reused: false };
  };

  const startJobBatch = ({ routes, source, client, missionId, rootAuditId }) => {
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

  const aggregateMission = (mission) =>
    siteExplorationSnapshot(
      mission,
      mission.children.map((child) => jobs.get(child.auditId)).filter(Boolean).map(snapshot),
    );

  return async function localAuditMiddleware(request, response, next) {
    const requestUrl = new URL(request.url, "http://frontmend.local");
    if (!requestUrl.pathname.startsWith("/api/")) return next();
    prune();

    try {
      if (request.method === "POST" && requestUrl.pathname === "/api/audits") {
        assertSameOrigin(request);
        const input = await readBody(request);
        const extra = Object.keys(input ?? {}).find((key) => !["url", "source", "mission"].includes(key));
        if (extra) throw new AuditError("INVALID_INPUT", `Unknown field: ${extra}.`);
        const url = normalizePublicUrl(input?.url);
        const source = input?.source === "agent" ? "agent" : "human";
        const mission = createAuditMission(input?.mission ?? {}, source);
        const client = request.socket.remoteAddress ?? "local-preview";
        const { job, reused } = startJob({
          url,
          source,
          mission,
          client,
          operationKey: `mission:${auditMissionSignature(mission)}`,
        });
        return sendJson(response, reused ? 200 : 202, { ok: true, data: snapshot(job) }, {
          location: `/api/audits/${job.id}`,
        });
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
        const extra = Object.keys(input).find((key) => !["path", "source"].includes(key));
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
        const related = createRelatedAuditInput(baseline.report, input.path);
        const source = input.source === "agent" ? "agent" : "human";
        const client = request.socket.remoteAddress ?? "local-preview";
        const { job, reused } = startJob({
          url: related.url,
          source,
          client,
          operationKey: `route:${routeMatch[1]}:${related.exploration.observedPath}`,
          exploration: related.exploration,
        });
        return sendJson(response, reused ? 200 : 202, { ok: true, data: snapshot(job) }, {
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
          const extra = Object.keys(input).find((key) => !["paths", "source"].includes(key));
          if (extra) {
            return sendError(response, new AuditError("INVALID_INPUT", `Unknown field: ${extra}.`));
          }
          const prepared = createSiteExplorationInputs(root.report, input.paths);
          const missionId = crypto.randomUUID();
          const source = input.source === "agent" ? "agent" : "human";
          const client = request.socket.remoteAddress ?? "local-preview";
          const started = startJobBatch({
            routes: prepared.routes,
            source,
            client,
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
          root.explorations = [
            ...(root.explorations ?? []).filter((item) => item.id !== mission.id),
            mission,
          ].slice(-10);
          return sendJson(response, 202, { ok: true, data: aggregateMission(mission) }, {
            location: `/api/audits/${rootAuditId}/explorations/${missionId}`,
          });
        }
        if (!rawMissionId && request.method === "GET") {
          return sendJson(response, 200, {
            ok: true,
            data: {
              rootAuditId,
              explorations: (root.explorations ?? []).map(aggregateMission),
            },
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
        return sendJson(response, 200, { ok: true, data: aggregate });
      }

      const repairPolicyMatch = requestUrl.pathname.match(/^\/api\/audits\/([^/]+)\/repair-policy$/);
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
          baseline.repairPolicy = createRepairPolicy(await readBody(request));
          return sendJson(response, 200, { ok: true, data: baseline.repairPolicy });
        }
        return sendError(
          response,
          new AuditError("METHOD_NOT_ALLOWED", "That repair policy operation is not supported."),
          405,
        );
      }

      const diagnosticMatch = requestUrl.pathname.match(
        /^\/api\/audits\/([^/]+)\/diagnostics(?:\/([^/]+)(?:\/(evidence))?)?$/,
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
          return sendJson(response, 200, { ok: true, data: { auditId, missions: baseline.diagnosticMissions.map(diagnosticMissionSnapshot) } });
        }
        if (!rawMissionId && request.method === "POST") {
          assertSameOrigin(request);
          const input = await readBody(request);
          const extra = Object.keys(input ?? {}).find((key) => key !== "findingId");
          if (extra) return sendError(response, new AuditError("INVALID_DIAGNOSTIC_EVIDENCE", `Unknown diagnostic field: ${extra}.`));
          const finding = baseline.report.findings.find((item) => item.id === input?.findingId);
          if (!finding) return sendError(response, new AuditError("FINDING_NOT_FOUND", "That audit finding does not exist."), 404);
          const existing = baseline.diagnosticMissions.find((mission) => mission.findingId === finding.id);
          if (existing) return sendJson(response, 200, { ok: true, data: diagnosticMissionSnapshot(existing) });
          if (baseline.diagnosticMissions.length >= 10) return sendError(response, new AuditError("DIAGNOSTIC_LIMIT", "This audit already has the maximum number of diagnostic missions."));
          const mission = createDiagnosticMission({ auditId, finding });
          baseline.diagnosticMissions.push(mission);
          return sendJson(response, 201, { ok: true, data: mission });
        }
        const missionId = decodeURIComponent(rawMissionId ?? "");
        const mission = baseline.diagnosticMissions.find((item) => item.id === missionId);
        if (!mission) return sendError(response, new AuditError("DIAGNOSTIC_NOT_FOUND", "That diagnostic mission does not exist."), 404);
        if (!action && request.method === "GET") return sendJson(response, 200, { ok: true, data: diagnosticMissionSnapshot(mission) });
        if (action === "evidence" && request.method === "POST") {
          assertSameOrigin(request);
          const input = await readBody(request);
          const { source, ...evidence } = input ?? {};
          if (source !== "agent" && source !== "person") {
            return sendError(response, new AuditError("INVALID_DIAGNOSTIC_EVIDENCE", "Diagnostic evidence must identify an agent or person source."));
          }
          Object.assign(mission, submitDiagnosticEvidence(mission, evidence, source));
          return sendJson(response, 200, { ok: true, data: mission });
        }
        return sendError(response, new AuditError("METHOD_NOT_ALLOWED", "That diagnostic operation is not supported."), 405);
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
            data: {
              auditId,
              repairs: baseline.repairs.map(repairWithMission),
              policy: repairPolicySnapshot(baseline.repairPolicy),
            },
          });
        }
        if (!rawRepairId && request.method === "POST") {
          assertSameOrigin(request);
          const input = await readBody(request);
          const finding = baseline.report.findings.find((item) => item.id === input?.findingId);
          if (!finding) {
            return sendError(response, new AuditError("FINDING_NOT_FOUND", "That audit finding does not exist."), 404);
          }
          const existing = baseline.repairs.find((repair) => repair.findingId === finding.id);
          if (existing) {
            return sendJson(response, 200, { ok: true, data: repairWithMission(existing) });
          }
          if (baseline.repairs.length >= 10) {
            return sendError(response, new AuditError("REPAIR_LIMIT", "This audit already has the maximum number of repair drafts."));
          }
          const { source, ...proposal } = input;
          let diagnosticMission = null;
          if (source === "agent" && findingRequiresDiagnosticMission(finding)) {
            diagnosticMission = (baseline.diagnosticMissions ?? []).find((mission) => mission.findingId === finding.id) ?? null;
            if (!diagnosticMission || diagnosticMission.state?.state !== "ready-for-repair") {
              return sendError(response, new AuditError(
                "DIAGNOSTIC_MISSION_REQUIRED",
                "Open this finding's diagnostic mission and submit runtime plus repository evidence before staging an agent repair.",
              ), 409);
            }
          }
          let repair = createRepairDraft({
            auditId,
            finding,
            report: baseline.report,
            input: proposal,
            source,
          });
          if (diagnosticMission) repair = { ...repair, diagnosticMission: diagnosticMissionForRepair(diagnosticMission) };
          const policyResult = applyRepairPolicy(repair, baseline.repairPolicy);
          repair = policyResult.repair;
          baseline.repairPolicy = policyResult.policy;
          baseline.repairs.push(repair);
          return sendJson(response, 201, { ok: true, data: repairWithMission(repair) });
        }

        const repairId = validateRepairId(decodeURIComponent(rawRepairId ?? ""));
        const repair = baseline.repairs.find((item) => item.id === repairId);
        if (!repair) {
          return sendError(response, new AuditError("REPAIR_NOT_FOUND", "That repair draft does not exist."), 404);
        }
        if (!action && request.method === "GET") {
          return sendJson(response, 200, { ok: true, data: repairWithMission(repair) });
        }
        if (action === "approve" && request.method === "POST") {
          assertSameOrigin(request);
          await readBody(request);
          if (repair.status === "changes-requested") {
            return sendError(
              response,
              new AuditError("CHANGES_REQUESTED", "Revise this repair before it can be approved."),
              409,
            );
          }
          if (repair.status !== "approved") {
            const approvedAt = Date.now();
            Object.assign(repair, {
              status: "approved",
              requiresHumanReview: false,
              reviewedAt: approvedAt,
              approval: { mode: "explicit-review", grantedBy: "person", approvedAt },
            });
          }
          return sendJson(response, 200, { ok: true, data: repairWithMission(repair) });
        }
        if (action === "changes" && request.method === "POST") {
          assertSameOrigin(request);
          const input = await readBody(request);
          const extra = Object.keys(input ?? {}).find((key) => key !== "feedback");
          if (extra) {
            return sendError(response, new AuditError("INVALID_REPAIR", `Unknown repair field: ${extra}.`));
          }
          Object.assign(repair, requestRepairChanges(repair, input?.feedback));
          return sendJson(response, 200, { ok: true, data: repairWithMission(repair) });
        }
        if (action === "revise" && request.method === "POST") {
          assertSameOrigin(request);
          const input = await readBody(request);
          const { source, ...proposal } = input ?? {};
          if (source !== undefined && source !== "agent") {
            return sendError(
              response,
              new AuditError("INVALID_REPAIR", "Repair revisions must be agent-authored."),
            );
          }
          Object.assign(repair, reviseRepairDraft(repair, proposal, "agent"));
          return sendJson(response, 200, { ok: true, data: repairWithMission(repair) });
        }
        if (action === "implementation" && request.method === "POST") {
          assertSameOrigin(request);
          const input = await readBody(request);
          const { source, ...receipt } = input ?? {};
          if (source !== "agent") {
            return sendError(
              response,
              new AuditError("INVALID_IMPLEMENTATION_RECEIPT", "Repository implementation receipts must be agent-reported."),
            );
          }
          Object.assign(repair, recordRepositoryImplementation(repair, receipt));
          return sendJson(response, 200, { ok: true, data: repairWithMission(repair) });
        }
        if (action === "deployment" && request.method === "POST") {
          assertSameOrigin(request);
          await readBody(request);
          if (repair.status !== "approved") {
            return sendError(
              response,
              new AuditError("REPAIR_NOT_APPROVED", "Approve this repair draft before confirming deployment."),
              409,
            );
          }
          if (!Number.isFinite(repair.deploymentAttestedAt)) {
            repair.deploymentAttestedAt = Date.now();
          }
          return sendJson(response, 200, { ok: true, data: repairWithMission(repair) });
        }
        if (action === "verify" && request.method === "POST") {
          assertSameOrigin(request);
          await readBody(request);
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
          const verification = createVerificationContext(baseline.report, repair);
          const client = request.socket.remoteAddress ?? "local-preview";
          const { job, reused } = startJob({
            url: verification.url,
            source: "verification",
            client,
            operationKey: `repair:${repair.id}`,
            verification,
          });
          return sendJson(response, reused ? 200 : 202, { ok: true, data: snapshot(job) }, {
            location: `/api/audits/${job.id}`,
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
        /^\/api\/audits\/([^/]+)(?:\/(results|report|receipt|evidence)(?:\/([^/]+))?)?$/,
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
          job.abortController?.abort("cancelled");
          Object.assign(job, {
            status: "cancelled",
            phase: "cancelled",
            phaseLabel: "Audit cancelled",
            report: null,
            error: null,
            completedAt: Date.now(),
          });
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
        return sendJson(response, 200, { ok: true, data: job.report });
      }
      if (resource === "receipt") {
        if (job.status !== "complete" || !job.report) {
          return sendError(response, new AuditError("AUDIT_NOT_READY", "The audit is still running."), 409);
        }
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
      return sendError(response, error, error?.code === "RATE_LIMITED" ? 429 : 400);
    }
  };
}
