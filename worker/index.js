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
import {
  createRelatedAuditInput,
  mergeRenderedRouteObservations,
  validateRenderedRouteObservations,
} from "../src/route-contract.js";
import {
  assertMissionId,
  createSiteExplorationInputs,
  createSiteExplorationMission,
  siteExplorationLimits,
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
  createAdmissionOperationalEvent,
  createAuditOperationalEvent,
  createProviderOperationalEvents,
  emitOperationalEvents,
} from "../src/operational-event-contract.js";
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
  extendBrowserReviewMission,
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
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT = 5;
const GLOBAL_RATE_LIMIT = 60;
const REUSE_WINDOW_MS = 10 * 60 * 1000;
const JOB_RETENTION_MS = 24 * 60 * 60 * 1000;
const JOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OWNER_SESSION_HASH_PATTERN = /^[0-9a-f]{64}$/;
const OWNER_SESSION_HASH_HEADER = "x-frontmend-owner-session-hash";

function json(data, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

function publicError(error) {
  if (error instanceof AuditError) {
    const status = [
      "NOT_FOUND",
      "AUDIT_NOT_FOUND",
      "EVIDENCE_NOT_FOUND",
      "REPAIR_NOT_FOUND",
      "FINDING_NOT_FOUND",
      "EXPLORATION_NOT_FOUND",
      "DIAGNOSTIC_NOT_FOUND",
      "BROWSER_REVIEW_NOT_FOUND",
      "CANDIDATE_REVIEW_NOT_FOUND",
      "VERIFICATION_RUN_NOT_FOUND",
    ].includes(error.code)
      ? 404
      : error.code === "AUDIT_WRITE_AUTHORITY_REQUIRED"
        ? 403
      : error.code === "METHOD_NOT_ALLOWED"
        ? 405
        : [
            "AUDIT_NOT_READY",
            "REPAIR_NOT_APPROVED",
            "DEPLOYMENT_NOT_ATTESTED",
            "CHANGES_ALREADY_REQUESTED",
            "CHANGES_REQUESTED",
            "REVISION_NOT_REQUESTED",
            "REPAIR_INTENT_REQUIRED",
            "DIAGNOSTIC_MISSION_REQUIRED",
            "ASSESSMENT_INCOMPLETE",
            "VERIFICATION_RECEIPT_UNAVAILABLE",
            "VERIFICATION_MATRIX_REQUIRED",
            "BROWSER_REVIEW_SEQUENCE",
            "BROWSER_REVIEW_COMPLETE",
            "BROWSER_REVIEW_CHECK_COMPLETE",
            "BROWSER_REVIEW_WITHDRAWAL_LOCKED",
            "BROWSER_REVIEW_WITHDRAWAL_UNAVAILABLE",
            "BROWSER_REVIEW_WITHDRAWN",
            "IMPLEMENTATION_CHECKS_REQUIRED",
            "CANDIDATE_REVIEW_EXISTS",
            "CANDIDATE_REVIEW_PREDEPLOYMENT_ONLY",
            "CANDIDATE_REVIEW_STALE",
            "CANDIDATE_CORRECTION_REQUIRED",
            "MISSION_REVISION_STALE",
          ].includes(error.code)
          ? 409
          : 400;
    return {
      status,
      code: error.code,
      message: error.message,
      recoverable: error.recoverable !== false,
      details: error.details ?? null,
    };
  }
  if (error?.code === "RATE_LIMITED") {
    return { status: 429, code: error.code, message: error.message, recoverable: true };
  }
  return {
    status: 500,
    code: "INTERNAL_ERROR",
    message: "Frontmend could not complete the request.",
    recoverable: false,
  };
}

function errorResponse(error, headers) {
  const detail = publicError(error);
  return json(
    {
      ok: false,
      error: {
        code: detail.code,
        message: detail.message,
        recoverable: detail.recoverable,
        ...(detail.details ? { details: detail.details } : {}),
      },
    },
    { status: detail.status, headers },
  );
}

async function readJsonBody(request) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > BODY_LIMIT_BYTES) {
    throw new AuditError("INVALID_INPUT", "The request body is too large.");
  }
  const reader = request.body?.getReader();
  if (!reader) return {};
  const chunks = [];
  let received = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > BODY_LIMIT_BYTES) {
      await reader.cancel().catch(() => {});
      throw new AuditError("INVALID_INPUT", "The request body is too large.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new AuditError("INVALID_INPUT", "The request body must be valid JSON.");
  }
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function auditSessionForStart(request) {
  const secure = new URL(request.url).protocol === "https:";
  const retained = auditSessionTokenFromCookie(request.headers.get("cookie"), { secure });
  const token = retained ?? createAuditSessionToken();
  return {
    ownerSessionHash: await hashAuditSessionToken(token),
    setCookie: retained ? null : createAuditSessionCookie(token, { secure }),
  };
}

async function ownerSessionHashFromRequest(request) {
  const secure = new URL(request.url).protocol === "https:";
  const token = auditSessionTokenFromCookie(request.headers.get("cookie"), { secure });
  return token ? hashAuditSessionToken(token) : null;
}

async function authorizeAuditMutation(request, env, auditId) {
  assertSameOrigin(request);
  const ownerSessionHash = await ownerSessionHashFromRequest(request);
  if (!ownerSessionHash) {
    throw new AuditError(
      "AUDIT_WRITE_AUTHORITY_REQUIRED",
      "This shared audit is read-only in this browser. Start a new audit to make changes.",
    );
  }
  const response = await jobFromId(env, auditId).fetch("https://frontmend.internal/authorize", {
    headers: { [OWNER_SESSION_HASH_HEADER]: ownerSessionHash },
  });
  if (!response.ok) {
    throw new AuditError(
      "AUDIT_WRITE_AUTHORITY_REQUIRED",
      "This shared audit is read-only in this browser. Start a new audit to make changes.",
    );
  }
  const headers = new Headers(request.headers);
  headers.set(OWNER_SESSION_HASH_HEADER, ownerSessionHash);
  return new Request(request, { headers });
}

function authorizedOwnerSessionHash(request) {
  const value = request.headers.get(OWNER_SESSION_HASH_HEADER);
  if (!value) {
    throw new AuditError(
      "AUDIT_WRITE_AUTHORITY_REQUIRED",
      "This shared audit is read-only in this browser. Start a new audit to make changes.",
    );
  }
  return value;
}

function assertSameOrigin(request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    throw new AuditError("ORIGIN_MISMATCH", "Audit requests must come from this Frontmend page.");
  }
}

function auditSnapshot(state, missionCheckpoint = state.missionCheckpoint ?? null) {
  return {
    id: state.id,
    attempt: Number.isFinite(state.attempt) ? state.attempt : 1,
    url: state.url,
    source: state.source,
    mission: state.mission ?? null,
    agentCapabilities: state.agentCapabilities
      ? agentCapabilitySnapshot(state.agentCapabilities)
      : null,
    missionRevision: auditMissionRevision(state),
    missionCheckpoint,
    status: state.status,
    phase: state.phase,
    phaseLabel: state.phaseLabel,
    progress: state.progress,
    /*
     * The run's own clock, and the clock it is read against. A percentage
     * pinned to real provider events cannot move while a provider is still
     * out, so the surface needs one quantity that always can. Sending the
     * server's `now` alongside `startedAt` keeps that readout exact instead of
     * guessing at the difference between two machines' clocks.
     */
    startedAt: Number.isInteger(state.startedAt) ? state.startedAt : null,
    now: Date.now(),
    streams: Array.isArray(state.streams) ? state.streams : null,
    exploration: state.exploration ?? state.report?.exploration ?? null,
    siteExploration: state.siteExploration ?? state.report?.siteExploration ?? null,
    report: state.status === "complete" ? state.report : null,
    error: state.error ?? null,
  };
}

async function auditJobCheckpoint(ctx, state) {
  const [diagnosticMissions, repairs, browserReview, explorations] = await Promise.all([
    ctx.storage.get("diagnosticMissions"),
    ctx.storage.get("repairs"),
    ctx.storage.get("browserReview"),
    ctx.storage.get("explorations"),
  ]);
  const missionState = [1, 2].includes(state.mission?.schemaVersion)
    ? deriveAuditMissionState({
        report: state.report,
        mission: state.mission,
        diagnosticMissions: diagnosticMissions ?? [],
        repairs: repairs ?? [],
        browserReview: browserReview ?? null,
        explorations: explorations ?? [],
      })
    : null;
  return createMissionCheckpoint({
    audit: state,
    missionState,
    diagnosticMissions: diagnosticMissions ?? [],
    repairs: repairs ?? [],
    browserReview: browserReview ?? null,
    explorations: explorations ?? [],
    agentCapabilities: state.agentCapabilities ?? null,
  });
}

async function assertJobRevision(ctx, state, expectedMissionRevision) {
  if (expectedMissionRevision === undefined) return auditMissionRevision(state);
  const checkpoint = await auditJobCheckpoint(ctx, state);
  return assertExpectedMissionRevision(state, expectedMissionRevision, checkpoint);
}

async function advanceJobRevision(ctx, state, updates = {}) {
  const updated = advanceMissionRevision({ ...state, ...updates });
  await ctx.storage.put("state", updated);
  return updated;
}

async function checkpointedJobData(ctx, state, data) {
  const missionCheckpoint = await auditJobCheckpoint(ctx, state);
  return data && typeof data === "object"
    ? { ...data, missionCheckpoint }
    : { value: data, missionCheckpoint };
}

async function gateAdmissions(request, env, routes, missionId, operation = "exploration") {
  const ip = request.headers.get("cf-connecting-ip") ?? "local-preview";
  const ownerSessionHash = authorizedOwnerSessionHash(request);
  const fingerprint = await sha256(ip);
  const items = await Promise.all(
    routes.map(async (route) => ({
      urlHash: await sha256(
        `${ownerSessionHash}\n${route.url}\n${operation}:${missionId}:${route.path}`,
      ),
    })),
  );
  const gate = env.AUDIT_GATE.get(env.AUDIT_GATE.idFromName("frontmend-gate-v1"));
  const response = await gate.fetch("https://frontmend.internal/admit-batch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fingerprint, items, now: Date.now() }),
  });
  const admission = await response.json();
  if (!admission.allowed) {
    const error = new Error(
      operation === "verification"
        ? "This reviewed verification matrix exceeds the current live-audit budget. Try again in a few minutes."
        : "This site exploration exceeds the current live-audit budget. Try again in a few minutes.",
    );
    error.code = "RATE_LIMITED";
    error.retryAfterMs = admission.retryAfterMs;
    throw error;
  }
  return admission.admissions;
}

async function readExplorationMission(env, rootAuditId, missionId) {
  const rootJob = jobFromId(env, rootAuditId);
  const path = missionId
    ? `/explorations/${encodeURIComponent(assertMissionId(missionId))}`
    : "/explorations";
  const response = await rootJob.fetch(`https://frontmend.internal${path}`);
  const payload = await response.json();
  if (!response.ok || payload?.ok === false) return { response, payload };
  return { response, payload, rootJob };
}

async function aggregateMission(env, mission) {
  const audits = await Promise.all(
    mission.children.map(async (child) => {
      if (!child.auditId) return null;
      try {
        const response = await jobFromId(env, child.auditId).fetch("https://frontmend.internal/");
        const payload = await response.json();
        if (response.ok && payload?.data) return payload.data;
        return {
          id: child.auditId,
          status: "failed",
          progress: 100,
          error: payload?.error ?? {
            code: "AUDIT_NOT_FOUND",
            message: "The child audit is unavailable.",
            recoverable: true,
          },
        };
      } catch {
        return {
          id: child.auditId,
          status: "failed",
          progress: 100,
          error: {
            code: "AUDIT_STATUS_UNAVAILABLE",
            message: "The child audit status is temporarily unavailable.",
            recoverable: true,
          },
        };
      }
    }),
  );
  return siteExplorationSnapshot(mission, audits.filter(Boolean));
}

async function persistExplorationSnapshot(rootJob, mission, snapshot) {
  if (JSON.stringify(mission.currentSnapshot ?? null) === JSON.stringify(snapshot)) return;
  const retained = { ...mission, currentSnapshot: snapshot };
  delete retained.missionCheckpoint;
  await rootJob.fetch(
    `https://frontmend.internal/explorations/${encodeURIComponent(mission.id)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(retained),
    },
  );
}

async function startSiteExploration(request, env, rootAuditId) {
  assertSameOrigin(request);
  const input = await readJsonBody(request);
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new AuditError("INVALID_INPUT", "The request body must be an object.");
  }
  const extra = Object.keys(input).find((key) => !["paths", "routeCandidateIds", "source", "expectedMissionRevision"].includes(key));
  if (extra) throw new AuditError("INVALID_INPUT", `Unknown field: ${extra}.`);
  const rootJob = jobFromId(env, rootAuditId);
  const inputResponse = await rootJob.fetch("https://frontmend.internal/exploration-inputs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      paths: input.paths,
      routeCandidateIds: input.routeCandidateIds,
      expectedMissionRevision: input.expectedMissionRevision,
    }),
  });
  const inputPayload = await inputResponse.json();
  if (!inputResponse.ok || inputPayload?.ok === false) {
    return json(inputPayload, { status: inputResponse.status });
  }

  const missionId = crypto.randomUUID();
  const source = input.source === "agent" ? "agent" : "human";
  const ownerSessionHash = authorizedOwnerSessionHash(request);
  const routes = inputPayload.data.routes;
  const admissions = await gateAdmissions(request, env, routes, missionId);
  const children = await Promise.all(
    routes.map(async (route, index) => {
      const admission = admissions[index];
      const job = env.AUDIT_JOBS.get(env.AUDIT_JOBS.idFromName(admission.jobId));
      try {
        const response = await job.fetch("https://frontmend.internal/start", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: admission.jobId,
            url: route.url,
            source,
            ownerSessionHash,
            exploration: route.exploration,
            siteExploration: {
              missionId,
              rootAuditId,
              position: index + 1,
              total: routes.length,
            },
          }),
        });
        const payload = await response.json();
        if (!response.ok || payload?.ok === false) {
          return { auditId: admission.jobId, startError: payload?.error };
        }
        return { auditId: admission.jobId, audit: payload.data };
      } catch (error) {
        return {
          auditId: admission.jobId,
          startError: { code: "AUDIT_START_FAILED", message: error?.message },
        };
      }
    }),
  );
  const mission = createSiteExplorationMission({
    missionId,
    rootAuditId,
    source,
    routes,
    children,
    createdAt: Date.now(),
  });
  const persistResponse = await rootJob.fetch(
    `https://frontmend.internal/explorations/${encodeURIComponent(missionId)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(mission),
    },
  );
  if (!persistResponse.ok) {
    const payload = await persistResponse.json();
    return json(payload, { status: persistResponse.status });
  }
  const snapshot = siteExplorationSnapshot(
    mission,
    children.map((child) => child.audit).filter(Boolean),
  );
  return json({
    ok: true,
    data: { ...snapshot, missionCheckpoint: inputPayload.data.missionCheckpoint },
  }, {
    status: 202,
    headers: {
      location: `/api/audits/${encodeURIComponent(rootAuditId)}/explorations/${encodeURIComponent(missionId)}`,
    },
  });
}

async function getSiteExplorations(env, rootAuditId, missionId, report = false) {
  const stored = await readExplorationMission(env, rootAuditId, missionId);
  if (!stored.response.ok || stored.payload?.ok === false) {
    return json(stored.payload, { status: stored.response.status });
  }
  if (!missionId) {
    const retainedMissions = stored.payload.data.explorations ?? [];
    const explorations = await Promise.all(retainedMissions.map((mission) => aggregateMission(env, mission)));
    await Promise.all(retainedMissions.map((mission, index) =>
      persistExplorationSnapshot(stored.rootJob, mission, explorations[index])
    ));
    const checkpointResponse = await stored.rootJob.fetch("https://frontmend.internal/checkpoint");
    const checkpointPayload = await checkpointResponse.json();
    return json({
      ok: true,
      data: {
        rootAuditId,
        explorations,
        missionCheckpoint: checkpointPayload.data ?? stored.payload.data.missionCheckpoint,
      },
    });
  }
  const snapshot = await aggregateMission(env, stored.payload.data);
  await persistExplorationSnapshot(stored.rootJob, stored.payload.data, snapshot);
  const checkpointResponse = await stored.rootJob.fetch("https://frontmend.internal/checkpoint");
  const checkpointPayload = await checkpointResponse.json();
  if (report) {
    if (!["complete", "partial", "failed"].includes(snapshot.status)) {
      return errorResponse(
        new AuditError("AUDIT_NOT_READY", "Finish the selected page audits before exporting this exploration."),
      );
    }
    return new Response(siteExplorationMarkdown(snapshot), {
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "content-disposition": `attachment; filename="frontmend-site-exploration-${snapshot.id}.md"`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  }
  return json({
    ok: true,
    data: { ...snapshot, missionCheckpoint: checkpointPayload.data ?? stored.payload.data.missionCheckpoint },
  });
}

async function startRelatedAudit(request, env, baselineAuditId) {
  assertSameOrigin(request);
  const input = await readJsonBody(request);
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new AuditError("INVALID_INPUT", "The request body must be an object.");
  }
  const extra = Object.keys(input).find((key) => !["path", "source", "expectedMissionRevision"].includes(key));
  if (extra) throw new AuditError("INVALID_INPUT", `Unknown field: ${extra}.`);

  const baselineJob = jobFromId(env, baselineAuditId);
  const inputResponse = await baselineJob.fetch("https://frontmend.internal/route-input", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: input.path, expectedMissionRevision: input.expectedMissionRevision }),
  });
  const inputPayload = await inputResponse.json();
  if (!inputResponse.ok || inputPayload?.ok === false) {
    return json(inputPayload, { status: inputResponse.status });
  }

  const related = inputPayload.data;
  const source = input.source === "agent" ? "agent" : "human";
  const ownerSessionHash = authorizedOwnerSessionHash(request);
  const admission = await gateAdmission(
    request,
    env,
    related.url,
    `route:${baselineAuditId}:${related.exploration.observedPath}`,
    ownerSessionHash,
  );
  const job = env.AUDIT_JOBS.get(env.AUDIT_JOBS.idFromName(admission.jobId));
  const response = await job.fetch("https://frontmend.internal/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: admission.jobId,
      url: related.url,
      source,
      ownerSessionHash,
      exploration: related.exploration,
    }),
  });
  const payload = await response.json();
  const responsePayload = response.ok && payload?.ok !== false
    ? {
        ok: true,
        data: {
          ...payload.data,
          missionCheckpoint: related.missionCheckpoint,
        },
      }
    : payload;
  return json(responsePayload, {
    status: response.status === 202 ? 202 : admission.reused ? 200 : 202,
    headers: { location: `/api/audits/${encodeURIComponent(admission.jobId)}` },
  });
}

async function gateAdmission(request, env, url, operationKey = "", ownerSessionHash) {
  const ip = request.headers.get("cf-connecting-ip") ?? "local-preview";
  const [fingerprint, urlHash] = await Promise.all([
    sha256(ip),
    sha256(`${ownerSessionHash}\n${operationKey ? `${url}\n${operationKey}` : url}`),
  ]);
  const gate = env.AUDIT_GATE.get(env.AUDIT_GATE.idFromName("frontmend-gate-v1"));
  const response = await gate.fetch("https://frontmend.internal/admit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fingerprint, urlHash, now: Date.now() }),
  });
  const admission = await response.json();
  if (!admission.allowed) {
    const error = new Error("Too many live audits were started. Try again in a few minutes.");
    error.code = "RATE_LIMITED";
    error.retryAfterMs = admission.retryAfterMs;
    throw error;
  }
  return admission;
}

async function startAudit(request, env) {
  assertSameOrigin(request);
  const input = await readJsonBody(request);
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new AuditError("INVALID_INPUT", "The request body must be an object.");
  }
  const extra = Object.keys(input).find((key) => !["url", "source", "mission"].includes(key));
  if (extra) throw new AuditError("INVALID_INPUT", `Unknown field: ${extra}.`);
  const url = normalizePublicUrl(input.url);
  const source = input.source === "agent" ? "agent" : "human";
  const mission = createAuditMission(input.mission ?? {}, source);
  const session = await auditSessionForStart(request);
  const admission = await gateAdmission(
    request,
    env,
    url,
    `mission:${auditMissionSignature(mission)}`,
    session.ownerSessionHash,
  );
  const job = env.AUDIT_JOBS.get(env.AUDIT_JOBS.idFromName(admission.jobId));
  const response = await job.fetch("https://frontmend.internal/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: admission.jobId,
      url,
      source,
      mission,
      ownerSessionHash: session.ownerSessionHash,
    }),
  });
  const payload = await response.json();
  return json(payload, {
    status: response.status === 202 ? 202 : admission.reused ? 200 : 202,
    headers: {
      location: `/api/audits/${encodeURIComponent(admission.jobId)}`,
      ...(session.setCookie ? { "set-cookie": session.setCookie } : {}),
    },
  });
}

function jobFromId(env, auditId) {
  if (!JOB_ID_PATTERN.test(auditId)) {
    throw new AuditError("AUDIT_NOT_FOUND", "No audit exists with that ID.");
  }
  return env.AUDIT_JOBS.get(env.AUDIT_JOBS.idFromName(auditId));
}

async function proxyJobRequest(job, path, request, body) {
  const headers = new Headers();
  if (body !== undefined) headers.set("content-type", "application/json");
  const init = { method: request.method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  return job.fetch(`https://frontmend.internal${path}`, init);
}

async function startRepairVerification(request, env, baselineAuditId, repairId) {
  assertSameOrigin(request);
  validateRepairId(repairId);
  const input = await readJsonBody(request);
  const extra = Object.keys(input ?? {}).find((key) => key !== "expectedMissionRevision");
  if (extra) throw new AuditError("INVALID_INPUT", `Unknown field: ${extra}.`);
  const baselineJob = jobFromId(env, baselineAuditId);
  const inputResponse = await baselineJob.fetch(
    `https://frontmend.internal/repairs/${encodeURIComponent(repairId)}/verification-start-input`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedMissionRevision: input.expectedMissionRevision }),
    },
  );
  const inputPayload = await inputResponse.json();
  if (!inputResponse.ok || inputPayload?.ok === false) {
    return json(inputPayload, { status: inputResponse.status });
  }
  const { repair, run, targets, missionCheckpoint } = inputPayload.data;
  const ownerSessionHash = authorizedOwnerSessionHash(request);
  const routes = targets.map((target) => ({ path: target.path, url: target.url }));
  const admissions = await gateAdmissions(request, env, routes, run.id, "verification");
  const started = await Promise.all(targets.map(async (target, index) => {
    const providerRows = target.rows.filter((row) => row.proofKind === "provider-rule");
    const scopedRepair = {
      ...repair,
      findingSource: providerRows[0]?.source ?? repair.findingSource,
      findingScope: {
        occurrenceCount: Math.max(1, providerRows.length),
        occurrencesOmitted: 0,
        sources: providerRows.map((row) => row.source),
      },
    };
    const verification = {
      ...createVerificationContext(target.baselineReport, scopedRepair),
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
    };
    const admission = admissions[index];
    const job = env.AUDIT_JOBS.get(env.AUDIT_JOBS.idFromName(admission.jobId));
    const response = await job.fetch("https://frontmend.internal/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: admission.jobId,
        url: target.url,
        source: "verification",
        ownerSessionHash,
        verification,
      }),
    });
    return { target, admission, response, payload: await response.json() };
  }));
  const assignments = started.map(({ target, admission }) => ({
    targetId: target.id,
    auditId: admission.jobId,
  }));
  const assignmentResponse = await baselineJob.fetch(
    `https://frontmend.internal/repairs/${encodeURIComponent(repairId)}/verification-assignments`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId: run.id, assignments }),
    },
  );
  const assignmentPayload = await assignmentResponse.json();
  if (!assignmentResponse.ok || assignmentPayload?.ok === false) {
    return json(assignmentPayload, { status: assignmentResponse.status });
  }
  const aggregateResponse = await baselineJob.fetch(
    `https://frontmend.internal/repairs/${encodeURIComponent(repairId)}/verification`,
  );
  const aggregatePayload = await aggregateResponse.json();
  const primary = started[0];
  return json({
    ok: true,
    data: {
      ...(primary.payload?.data ?? {}),
      baselineAuditId,
      repairId,
      verificationAuditIds: assignments.map((assignment) => assignment.auditId),
      aggregateVerification: aggregatePayload?.data ?? assignmentPayload?.data?.aggregateVerification ?? null,
      missionCheckpoint,
    },
  }, {
    status: admissions.every((admission) => admission.reused) ? 200 : 202,
    headers: { location: `/api/audits/${encodeURIComponent(primary.admission.jobId)}` },
  });
}

async function routeApi(request, env, url) {
  if (url.pathname === "/api/version") {
    if (request.method !== "GET") {
      return errorResponse(new AuditError("METHOD_NOT_ALLOWED", "The build descriptor is read-only."));
    }
    return json({ ok: true, data: createRuntimeBuildDescriptor(env) });
  }
  if (request.method === "POST" && url.pathname === "/api/audits") {
    return startAudit(request, env);
  }

  const scopedMutation = ["POST", "DELETE"].includes(request.method)
    ? url.pathname.match(/^\/api\/audits\/([^/]+)(?:\/|$)/)
    : null;
  if (scopedMutation) {
    request = await authorizeAuditMutation(request, env, decodeURIComponent(scopedMutation[1]));
  }

  const routeMatch = url.pathname.match(/^\/api\/audits\/([^/]+)\/routes$/);
  if (routeMatch) {
    if (request.method !== "POST") {
      return errorResponse(
        new AuditError("METHOD_NOT_ALLOWED", "That route exploration operation is not supported."),
      );
    }
    return startRelatedAudit(request, env, routeMatch[1]);
  }

  const explorationMatch = url.pathname.match(
    /^\/api\/audits\/([^/]+)\/explorations(?:\/([^/]+)(?:\/(report))?)?$/,
  );
  if (explorationMatch) {
    const [, rootAuditId, missionId, resource] = explorationMatch;
    if (!missionId && request.method === "POST") {
      return startSiteExploration(request, env, rootAuditId);
    }
    if (request.method === "GET") {
      return getSiteExplorations(env, rootAuditId, missionId, resource === "report");
    }
    return errorResponse(
      new AuditError("METHOD_NOT_ALLOWED", "That site exploration operation is not supported."),
    );
  }

  const prepareRepairMatch = url.pathname.match(
    /^\/api\/audits\/([^/]+)\/mission\/prepare-repair$/,
  );
  if (prepareRepairMatch) {
    if (request.method !== "POST") {
      return errorResponse(
        new AuditError("METHOD_NOT_ALLOWED", "That audit mission operation is not supported."),
      );
    }
    assertSameOrigin(request);
    const body = await readJsonBody(request);
    const response = await proxyJobRequest(
      jobFromId(env, prepareRepairMatch[1]),
      "/mission/prepare-repair",
      request,
      body,
    );
    return new Response(response.body, response);
  }

  const agentCapabilitiesMatch = url.pathname.match(/^\/api\/audits\/([^/]+)\/agent-capabilities$/);
  if (agentCapabilitiesMatch) {
    if (request.method !== "POST") {
      return errorResponse(
        new AuditError("METHOD_NOT_ALLOWED", "Agent capabilities can only be declared with POST."),
      );
    }
    assertSameOrigin(request);
    const body = await readJsonBody(request);
    const response = await proxyJobRequest(
      jobFromId(env, agentCapabilitiesMatch[1]),
      "/agent-capabilities",
      request,
      body,
    );
    return new Response(response.body, response);
  }

  const activityMatch = url.pathname.match(/^\/api\/audits\/([^/]+)\/activities$/);
  if (activityMatch) {
    if (!["GET", "POST"].includes(request.method)) {
      return errorResponse(new AuditError("METHOD_NOT_ALLOWED", "The activity ledger supports GET and POST only."));
    }
    let body;
    if (request.method === "POST") {
      assertSameOrigin(request);
      body = await readJsonBody(request);
    }
    const response = await proxyJobRequest(
      jobFromId(env, activityMatch[1]),
      "/activities",
      request,
      body,
    );
    return new Response(response.body, response);
  }

  const repairPolicyMatch = url.pathname.match(/^\/api\/audits\/([^/]+)\/repair-policy$/);
  if (repairPolicyMatch) {
    if (!["GET", "POST"].includes(request.method)) {
      return errorResponse(new AuditError("METHOD_NOT_ALLOWED", "That repair policy operation is not supported."));
    }
    let body;
    if (request.method === "POST") {
      assertSameOrigin(request);
      body = await readJsonBody(request);
    }
    const response = await proxyJobRequest(
      jobFromId(env, repairPolicyMatch[1]),
      "/repair-policy",
      request,
      body,
    );
    return new Response(response.body, response);
  }

  const diagnosticMatch = url.pathname.match(
    /^\/api\/audits\/([^/]+)\/diagnostics(?:\/([^/]+)(?:\/(evidence|blocker))?)?$/,
  );
  if (diagnosticMatch) {
    const [, auditId, missionId, action] = diagnosticMatch;
    if (!["GET", "POST"].includes(request.method)) {
      return errorResponse(new AuditError("METHOD_NOT_ALLOWED", "That diagnostic operation is not supported."));
    }
    let body;
    if (request.method === "POST") {
      assertSameOrigin(request);
      body = await readJsonBody(request);
    }
    const suffix = missionId
      ? `/diagnostics/${encodeURIComponent(missionId)}${action ? `/${action}` : ""}`
      : "/diagnostics";
    const response = await proxyJobRequest(jobFromId(env, auditId), suffix, request, body);
    return new Response(response.body, response);
  }

  const browserReviewMatch = url.pathname.match(
    /^\/api\/audits\/([^/]+)\/browser-review(?:\/([^/]+)\/(checks|withdrawal))?$/,
  );
  if (browserReviewMatch) {
    const [, auditId, reviewId, action] = browserReviewMatch;
    if (!["GET", "POST"].includes(request.method)) {
      return errorResponse(new AuditError("METHOD_NOT_ALLOWED", "That browser review operation is not supported."));
    }
    let body;
    if (request.method === "POST") {
      assertSameOrigin(request);
      body = await readJsonBody(request);
    }
    const suffix = reviewId
      ? `/browser-review/${encodeURIComponent(reviewId)}/${action}`
      : "/browser-review";
    const response = await proxyJobRequest(jobFromId(env, auditId), suffix, request, body);
    return new Response(response.body, response);
  }

  const verificationCandidateMatch = url.pathname.match(
    /^\/api\/audits\/([^/]+)\/verification-candidates$/,
  );
  if (verificationCandidateMatch) {
    if (request.method !== "GET") {
      return errorResponse(new AuditError("METHOD_NOT_ALLOWED", "Verification candidates are read-only."));
    }
    const job = jobFromId(env, verificationCandidateMatch[1]);
    const findingId = url.searchParams.get("findingId") ?? "";
    const findingIds = url.searchParams.getAll("findingIds");
    const params = new URLSearchParams({ findingId });
    for (const id of findingIds) params.append("findingIds", id);
    const response = await job.fetch(
      `https://frontmend.internal/verification-candidates?${params}`,
    );
    return new Response(response.body, response);
  }

  const aggregateVerificationMatch = url.pathname.match(
    /^\/api\/audits\/([^/]+)\/repairs\/([^/]+)\/verification(?:\/(receipt))?$/,
  );
  if (aggregateVerificationMatch) {
    if (request.method !== "GET") {
      return errorResponse(new AuditError("METHOD_NOT_ALLOWED", "Aggregate verification reads are GET-only."));
    }
    const [, auditId, repairId, receipt] = aggregateVerificationMatch;
    validateRepairId(repairId);
    const job = jobFromId(env, auditId);
    const suffix = receipt ? "verification-receipt" : "verification";
    const response = await job.fetch(
      `https://frontmend.internal/repairs/${encodeURIComponent(repairId)}/${suffix}`,
    );
    return new Response(response.body, response);
  }

  const candidateReviewMatch = url.pathname.match(
    /^\/api\/audits\/([^/]+)\/repairs\/([^/]+)\/candidate-review(?:\/(checks))?$/,
  );
  if (candidateReviewMatch) {
    const [, auditId, repairId, action] = candidateReviewMatch;
    if ((action && request.method !== "POST") || (!action && !["GET", "POST"].includes(request.method))) {
      return errorResponse(new AuditError("METHOD_NOT_ALLOWED", "That candidate review operation is not supported."));
    }
    validateRepairId(decodeURIComponent(repairId));
    let body;
    if (request.method === "POST") body = await readJsonBody(request);
    const suffix = action ? "candidate-review-checks" : "candidate-review";
    const response = await proxyJobRequest(
      jobFromId(env, auditId),
      `/repairs/${encodeURIComponent(repairId)}/${suffix}`,
      request,
      body,
    );
    return new Response(response.body, response);
  }

  const repairMatch = url.pathname.match(
    /^\/api\/audits\/([^/]+)\/repairs(?:\/([^/]+)(?:\/(approve|changes|revise|implementation|deployment|verify|export))?)?$/,
  );
  if (repairMatch) {
    const [, auditId, repairId, action] = repairMatch;
    const job = jobFromId(env, auditId);
    if (action === "verify" && request.method === "POST") {
      return startRepairVerification(request, env, auditId, repairId);
    }
    if (!["GET", "POST"].includes(request.method)) {
      return errorResponse(new AuditError("METHOD_NOT_ALLOWED", "That repair operation is not supported."));
    }
    let body;
    if (request.method === "POST") {
      assertSameOrigin(request);
      body = await readJsonBody(request);
    }
    const suffix = repairId
      ? `/repairs/${encodeURIComponent(repairId)}${action ? `/${action}` : ""}`
      : "/repairs";
    const response = await proxyJobRequest(job, suffix, request, body);
    return new Response(response.body, response);
  }

  const match = url.pathname.match(
    /^\/api\/audits\/([^/]+)(?:\/(results|checkpoint|report|receipt|assessment|evidence)(?:\/([^/]+))?)?$/,
  );
  if (!match) {
    return errorResponse(new AuditError("NOT_FOUND", "That API route does not exist."));
  }
  const [, auditId, resource, evidenceId] = match;
  const job = jobFromId(env, auditId);
  if (request.method === "DELETE" && !resource) {
    assertSameOrigin(request);
    const body = await readJsonBody(request);
    const response = await job.fetch("https://frontmend.internal/", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return new Response(response.body, response);
  }
  if (request.method !== "GET") {
    return errorResponse(
      new AuditError("METHOD_NOT_ALLOWED", "That audit operation is not supported."),
    );
  }
  const suffix =
    resource === "results"
      ? "/results"
      : resource === "checkpoint"
        ? "/checkpoint"
      : resource === "report"
        ? "/report"
      : resource === "receipt"
        ? "/receipt"
      : resource === "assessment"
        ? "/assessment"
      : resource === "evidence"
        ? `/evidence/${evidenceId ?? ""}`
        : "/";
  const response = await job.fetch(`https://frontmend.internal${suffix}`);
  return new Response(response.body, response);
}

async function serveAssets(request, env) {
  const response = await env.ASSETS.fetch(request);
  const acceptsHtml = request.headers.get("accept")?.includes("text/html");
  if (response.status !== 404 || !acceptsHtml || !["GET", "HEAD"].includes(request.method)) {
    return response;
  }
  const indexUrl = new URL(request.url);
  indexUrl.pathname = "/index.html";
  indexUrl.search = "";
  return env.ASSETS.fetch(new Request(indexUrl, request));
}

function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set("origin-agent-cluster", "?1");
  headers.set("permissions-policy", "tools=(self)");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  if (headers.get("content-type")?.includes("text/html")) {
    headers.set(
      "content-security-policy",
      "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://cloudflareinsights.com; form-action 'self'; upgrade-insecure-requests",
    );
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      const response = url.pathname.startsWith("/api/")
        ? await routeApi(request, env, url)
        : await serveAssets(request, env);
      return withSecurityHeaders(response);
    } catch (error) {
      const headers = error?.retryAfterMs
        ? { "retry-after": String(Math.max(1, Math.ceil(error.retryAfterMs / 1000))) }
        : undefined;
      return withSecurityHeaders(errorResponse(error, headers));
    }
  },
};

export class FrontmendAuditGate {
  constructor(ctx, env = {}) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    if (request.method !== "POST") return json({ allowed: false }, { status: 405 });
    const requestUrl = new URL(request.url);
    const { fingerprint, urlHash, items, now } = await readJsonBody(request);
    const isBatch = requestUrl.pathname === "/admit-batch";
    const batchItems = isBatch ? items : [{ urlHash }];
    if (
      typeof fingerprint !== "string" ||
      !Array.isArray(batchItems) ||
      batchItems.length < 1 ||
      batchItems.length > verificationImpactLimits.maxTargets ||
      batchItems.some((item) => typeof item?.urlHash !== "string" || !item.urlHash) ||
      new Set(batchItems.map((item) => item.urlHash)).size !== batchItems.length ||
      !Number.isFinite(now)
    ) {
      return json({ allowed: false }, { status: 400 });
    }

    const state = (await this.ctx.storage.get("gate")) ?? { rates: {}, jobs: {}, starts: [] };
    const cutoff = now - RATE_WINDOW_MS;
    state.starts = (state.starts ?? []).filter((timestamp) => timestamp > cutoff);
    for (const [key, record] of Object.entries(state.jobs)) {
      if (!record || record.createdAt <= now - REUSE_WINDOW_MS) delete state.jobs[key];
    }
    const reusedStarts = batchItems.filter((item) => Boolean(state.jobs[item.urlHash])).length;
    const newStarts = batchItems.length - reusedStarts;
    const emitAdmission = (outcome, reason, clientStarts, globalStarts) => emitOperationalEvents(
      this.env,
      [createAdmissionOperationalEvent({
        outcome,
        reason,
        batchSize: batchItems.length,
        newStarts,
        reusedStarts,
        clientWindowStarts: clientStarts,
        globalWindowStarts: globalStarts,
        clientCapacityRemaining: Math.max(0, RATE_LIMIT - clientStarts),
        globalCapacityRemaining: Math.max(0, GLOBAL_RATE_LIMIT - globalStarts),
      })],
    );
    if (state.starts.length + batchItems.length > GLOBAL_RATE_LIMIT) {
      emitAdmission("rejected", "global-capacity", (state.rates[fingerprint] ?? []).length, state.starts.length);
      return json({
        allowed: false,
        retryAfterMs: Math.max(1_000, state.starts[0] + RATE_WINDOW_MS - now),
      });
    }
    const attempts = (state.rates[fingerprint] ?? []).filter((timestamp) => timestamp > cutoff);
    if (attempts.length + batchItems.length > RATE_LIMIT) {
      emitAdmission("rejected", "client-capacity", attempts.length, state.starts.length);
      return json({
        allowed: false,
        retryAfterMs: Math.max(1_000, attempts[0] + RATE_WINDOW_MS - now),
      });
    }
    attempts.push(...batchItems.map(() => now));
    state.rates[fingerprint] = attempts;
    state.starts.push(...batchItems.map(() => now));

    const admissions = batchItems.map((item) => {
      const existing = state.jobs[item.urlHash];
      const jobId = existing?.jobId ?? crypto.randomUUID();
      if (!existing) state.jobs[item.urlHash] = { jobId, createdAt: now };
      return { jobId, reused: Boolean(existing) };
    });

    const rateEntries = Object.entries(state.rates)
      .map(([key, timestamps]) => [key, timestamps.filter((timestamp) => timestamp > cutoff)])
      .filter(([, timestamps]) => timestamps.length)
      .slice(-500);
    state.rates = Object.fromEntries(rateEntries);
    state.jobs = Object.fromEntries(Object.entries(state.jobs).slice(-500));
    await this.ctx.storage.put("gate", state);
    emitAdmission("allowed", "none", attempts.length, state.starts.length);

    return isBatch
      ? json({ allowed: true, admissions })
      : json({ allowed: true, ...admissions[0] });
  }
}

export class FrontmendAuditJob {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.abortController = null;
  }

  async alarm() {
    await this.ctx.storage.deleteAll();
  }

  async scheduleRetention() {
    if (typeof this.ctx.storage.setAlarm !== "function") return;
    await this.ctx.storage.setAlarm(Date.now() + JOB_RETENTION_MS).catch(() => {});
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/start") {
      const input = await readJsonBody(request);
      const existing = await this.ctx.storage.get("state");
      if (
        existing?.ownerSessionHash &&
        input.ownerSessionHash !== existing.ownerSessionHash
      ) {
        return errorResponse(new AuditError(
          "AUDIT_WRITE_AUTHORITY_REQUIRED",
          "This audit belongs to a different anonymous browser session.",
        ));
      }
      if (existing && !["failed", "cancelled"].includes(existing.status)) {
        return json({
          ok: true,
          data: auditSnapshot(existing, await auditJobCheckpoint(this.ctx, existing)),
        });
      }
      const state = {
        id: input.id,
        attempt: existing
          ? (Number.isFinite(existing.attempt) ? existing.attempt : 1) + 1
          : 1,
        url: input.url,
        source: input.source,
        ownerSessionHash: existing?.ownerSessionHash
          ?? (OWNER_SESSION_HASH_PATTERN.test(input.ownerSessionHash ?? "")
            ? input.ownerSessionHash
            : null),
        mission: existing?.mission ?? input.mission ?? null,
        agentCapabilities: existing?.agentCapabilities ?? null,
        missionRevision: existing ? auditMissionRevision(existing) + 1 : 1,
        verification: input.verification ?? null,
        exploration: input.exploration ?? null,
        siteExploration: input.siteExploration ?? null,
        status: "queued",
        phase: "queued",
        phaseLabel: "Waiting for the live audit provider",
        progress: 4,
        report: null,
        error: null,
        startedAt: Date.now(),
      };
      await this.ctx.storage.put("state", state);
      if (typeof this.ctx.storage.delete === "function") {
        await this.ctx.storage.delete("browserReview");
      }
      this.abortController = new AbortController();
      this.ctx.waitUntil(this.run(state));
      return json({
        ok: true,
        data: auditSnapshot(state, await auditJobCheckpoint(this.ctx, state)),
      }, { status: 202 });
    }

    const state = await this.ctx.storage.get("state");
    if (!state) {
      return errorResponse(new AuditError("AUDIT_NOT_FOUND", "No audit exists with that ID."));
    }
    if (url.pathname === "/authorize" && request.method === "GET") {
      const presented = request.headers.get(OWNER_SESSION_HASH_HEADER);
      return state.ownerSessionHash && presented === state.ownerSessionHash
        ? json({ ok: true, data: { writeAccess: "read-write" } })
        : errorResponse(new AuditError(
            "AUDIT_WRITE_AUTHORITY_REQUIRED",
            "This shared audit is read-only in this browser. Start a new audit to make changes.",
          ));
    }
    if (url.pathname === "/activities") {
      if (!["GET", "POST"].includes(request.method)) {
        return errorResponse(new AuditError("METHOD_NOT_ALLOWED", "The activity ledger supports GET and POST only."));
      }
      const current = activityLedgerSnapshot(
        await this.ctx.storage.get("activityLedger"),
        state.id,
      );
      if (request.method === "GET") {
        return json({
          ok: true,
          data: await checkpointedJobData(this.ctx, state, {
            auditId: state.id,
            activities: current,
            boundary: activityLedgerBoundary,
          }),
        });
      }
      try {
        const input = await readJsonBody(request);
        const activities = mergeActivityLedger(current, input, state.id);
        await this.ctx.storage.put("activityLedger", activities);
        return json({
          ok: true,
          data: await checkpointedJobData(this.ctx, state, {
            auditId: state.id,
            activities,
            boundary: activityLedgerBoundary,
          }),
        });
      } catch (error) {
        return errorResponse(error);
      }
    }
    if (request.method === "DELETE" && url.pathname === "/") {
      if (["complete", "failed", "cancelled"].includes(state.status)) {
        return json({ ok: true, data: auditSnapshot(state, await auditJobCheckpoint(this.ctx, state)) });
      }
      const input = await readJsonBody(request);
      await assertJobRevision(this.ctx, state, input.expectedMissionRevision);
      this.abortController?.abort("cancelled");
      const cancelled = await advanceJobRevision(this.ctx, state, {
        status: "cancelled",
        phase: "cancelled",
        phaseLabel: "Audit cancelled",
        report: null,
        error: null,
        completedAt: Date.now(),
      });
      await this.scheduleRetention();
      return json({ ok: true, data: auditSnapshot(cancelled, await auditJobCheckpoint(this.ctx, cancelled)) });
    }
    if (request.method === "POST" && url.pathname === "/mission/prepare-repair") {
      if (state.status !== "complete" || !state.report) {
        return errorResponse(
          new AuditError("AUDIT_NOT_READY", "Finish the audit before preparing a finding for repair."),
        );
      }
      const input = await readJsonBody(request);
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        return errorResponse(new AuditError("INVALID_INPUT", "The request body must be an object."));
      }
      const extra = Object.keys(input).find((key) => !["findingId", "findingIds", "source", "expectedMissionRevision"].includes(key));
      if (extra) return errorResponse(new AuditError("INVALID_INPUT", `Unknown mission field: ${extra}.`));
      if (input.source !== "human" && input.source !== "agent") {
        return errorResponse(new AuditError("INVALID_INPUT", "source must be human or agent."));
      }
      const [browserReview, explorations, diagnosticMissions, repairs] = await Promise.all([
        this.ctx.storage.get("browserReview"),
        this.ctx.storage.get("explorations"),
        this.ctx.storage.get("diagnosticMissions"),
        this.ctx.storage.get("repairs"),
      ]);
      try {
        const requestedFindingIds = normalizeRepairFindingIds(input.findingId, input.findingIds);
        const retainedFindings = assessmentFindings(
          state.report,
          browserReview,
          explorations ?? [],
        );
        const findings = requestedFindingIds.map((id) => retainedFindings.find((item) => item.id === id));
        if (findings.some((finding) => !finding)) {
          return errorResponse(new AuditError("FINDING_NOT_FOUND", "Every repair-package finding must belong to this completed audit."));
        }
        const currentMission = state.mission
          ? auditMissionSnapshot(state.mission)
          : createAuditMission(
              {},
              state.source === "agent" ? "agent" : "human",
              Number.isInteger(state.startedAt) ? state.startedAt : Date.now(),
            );
        if (JSON.stringify(currentMission.repairPreparation?.findingIds ?? []) === JSON.stringify(requestedFindingIds)) {
          const missionCheckpoint = await auditJobCheckpoint(this.ctx, state);
          return json({
            ok: true,
            data: {
              audit: auditSnapshot(state, missionCheckpoint),
              mission: currentMission,
              missionState: deriveAuditMissionState({
                report: state.report,
                mission: currentMission,
                diagnosticMissions: diagnosticMissions ?? [],
                repairs: repairs ?? [],
                browserReview,
                explorations: explorations ?? [],
              }),
              missionCheckpoint,
            },
          });
        }
        const currentMissionState = deriveAuditMissionState({
          report: state.report,
          mission: currentMission,
          diagnosticMissions: diagnosticMissions ?? [],
          repairs: repairs ?? [],
          browserReview,
          explorations: explorations ?? [],
        });
        if (!currentMissionState.assessmentComplete) {
          throw new AuditError(
            "ASSESSMENT_INCOMPLETE",
            "Finish the retained browser, route, and diagnostic evidence before selecting a repair package.",
            true,
            {
              rankingStatus: currentMissionState.rankingStatus,
              nextAction: currentMissionState.nextAction,
            },
          );
        }
        await assertJobRevision(this.ctx, state, input.expectedMissionRevision);
        const mission = prepareRepairIntent(currentMission, requestedFindingIds, input.source);
        const updated = await advanceJobRevision(this.ctx, state, { mission });
        const missionCheckpoint = await auditJobCheckpoint(this.ctx, updated);
        return json({
          ok: true,
          data: {
            audit: auditSnapshot(updated, missionCheckpoint),
            mission,
            missionState: deriveAuditMissionState({
              report: updated.report,
              mission,
              diagnosticMissions: diagnosticMissions ?? [],
              repairs: repairs ?? [],
              browserReview: browserReview ?? null,
              explorations: explorations ?? [],
            }),
            missionCheckpoint,
          },
        });
      } catch (error) {
        return errorResponse(error);
      }
    }
    if (request.method === "POST" && url.pathname === "/agent-capabilities") {
      try {
        const input = await readJsonBody(request);
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
          state.agentCapabilities ?? null,
        );
        const current = state.agentCapabilities ? agentCapabilitySnapshot(state.agentCapabilities) : null;
        if (current && JSON.stringify(current.capabilities) === JSON.stringify(declaration.capabilities)) {
          const missionCheckpoint = await auditJobCheckpoint(this.ctx, state);
          return json({
            ok: true,
            data: {
              auditId: state.id,
              audit: auditSnapshot(state, missionCheckpoint),
              agentCapabilities: current,
              missionCheckpoint,
            },
          });
        }
        await assertJobRevision(this.ctx, state, input.expectedMissionRevision);
        const updated = await advanceJobRevision(this.ctx, state, { agentCapabilities: declaration });
        const missionCheckpoint = await auditJobCheckpoint(this.ctx, updated);
        return json({
          ok: true,
          data: {
            auditId: updated.id,
            audit: auditSnapshot(updated, missionCheckpoint),
            agentCapabilities: declaration,
            missionCheckpoint,
          },
        });
      } catch (error) {
        return errorResponse(error);
      }
    }
    if (url.pathname === "/repair-policy") {
      if (state.status !== "complete" || !state.report) {
        return errorResponse(new AuditError("AUDIT_NOT_READY", "Finish the audit before changing repair policy."));
      }
      const current = repairPolicySnapshot(await this.ctx.storage.get("repairPolicy"));
      if (request.method === "GET") return json({ ok: true, data: current });
      if (request.method === "POST") {
        const input = await readJsonBody(request);
        if (input?.mode === current.mode) {
          return json({ ok: true, data: await checkpointedJobData(this.ctx, state, current) });
        }
        await assertJobRevision(this.ctx, state, input?.expectedMissionRevision);
        const { expectedMissionRevision: _expectedMissionRevision, ...policyInput } = input ?? {};
        const policy = createRepairPolicy(policyInput);
        await this.ctx.storage.put("repairPolicy", policy);
        const updated = await advanceJobRevision(this.ctx, state);
        return json({ ok: true, data: await checkpointedJobData(this.ctx, updated, policy) });
      }
      return errorResponse(new AuditError("METHOD_NOT_ALLOWED", "That repair policy operation is not supported."));
    }
    if (url.pathname === "/verification-candidates" && request.method === "GET") {
      if (state.status !== "complete" || !state.report) {
        return errorResponse(new AuditError("AUDIT_NOT_READY", "Finish the audit before reading verification candidates."));
      }
      const findingId = url.searchParams.get("findingId");
      let requestedFindingIds;
      try {
        const queryFindingIds = url.searchParams.getAll("findingIds");
        requestedFindingIds = normalizeRepairFindingIds(findingId, queryFindingIds.length ? queryFindingIds : undefined);
      } catch (error) {
        return errorResponse(error);
      }
      const browserReview = await this.ctx.storage.get("browserReview");
      const retainedFindings = assessmentFindings(
        state.report,
        browserReview,
        (await this.ctx.storage.get("explorations")) ?? [],
      );
      const findings = requestedFindingIds.map((id) => retainedFindings.find((item) => item.id === id));
      if (findings.some((finding) => !finding)) {
        return errorResponse(new AuditError("FINDING_NOT_FOUND", "Every repair-package finding must belong to this completed audit."));
      }
      const previewRepair = createRepairDraft({
        repairId: `candidate-${state.id}`,
        auditId: state.id,
        finding: findings[0],
        findings,
        report: state.report,
        input: { findingId: requestedFindingIds[0], findingIds: requestedFindingIds },
        source: "human",
      });
      const impact = await this.verificationImpactForRepair(state, previewRepair, []);
      return json({
        ok: true,
        data: await checkpointedJobData(this.ctx, state, verificationCandidateProjection(impact)),
      });
    }
    if (url.pathname.startsWith("/repairs")) {
      return this.handleRepairs(request, url, state);
    }
    if (url.pathname.startsWith("/diagnostics")) {
      return this.handleDiagnostics(request, url, state);
    }
    if (url.pathname.startsWith("/browser-review")) {
      return this.handleBrowserReview(request, url, state);
    }
    if (request.method === "POST" && url.pathname === "/exploration-inputs") {
      if (state.status !== "complete" || !state.report) {
        return errorResponse(
          new AuditError("AUDIT_NOT_READY", "Finish the root audit before exploring multiple pages."),
        );
      }
      const input = await readJsonBody(request);
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        return errorResponse(new AuditError("INVALID_INPUT", "The request body must be an object."));
      }
      const extra = Object.keys(input).find((key) => !["paths", "routeCandidateIds", "expectedMissionRevision"].includes(key));
      if (extra) return errorResponse(new AuditError("INVALID_INPUT", `Unknown field: ${extra}.`));
      try {
        await assertJobRevision(this.ctx, state, input.expectedMissionRevision);
        const data = createSiteExplorationInputs(
          state.report,
          { paths: input.paths, routeCandidateIds: input.routeCandidateIds },
          { requireCandidateIds: state.mission?.scope === "bounded-site" },
        );
        const updated = await advanceJobRevision(this.ctx, state);
        return json({ ok: true, data: await checkpointedJobData(this.ctx, updated, data) });
      } catch (error) {
        return errorResponse(error);
      }
    }
    if (url.pathname === "/explorations" && request.method === "GET") {
      const explorations = (await this.ctx.storage.get("explorations")) ?? [];
      return json({
        ok: true,
        data: await checkpointedJobData(this.ctx, state, { rootAuditId: state.id, explorations }),
      });
    }
    const explorationMatch = url.pathname.match(/^\/explorations\/([^/]+)$/);
    if (explorationMatch) {
      let missionId;
      try {
        missionId = assertMissionId(decodeURIComponent(explorationMatch[1]));
      } catch (error) {
        return errorResponse(error);
      }
      const explorations = (await this.ctx.storage.get("explorations")) ?? [];
      if (request.method === "GET") {
        const mission = explorations.find((item) => item.id === missionId);
        return mission
          ? json({ ok: true, data: await checkpointedJobData(this.ctx, state, mission) })
          : errorResponse(
              new AuditError("EXPLORATION_NOT_FOUND", "No site exploration exists with that ID."),
            );
      }
      if (request.method === "POST") {
        const mission = await readJsonBody(request);
        if (mission?.id !== missionId || mission?.rootAuditId !== state.id) {
          return errorResponse(new AuditError("INVALID_INPUT", "The exploration does not match this root audit."));
        }
        const previous = explorations.find((item) => item.id === missionId);
        const retained = [
          ...explorations.filter((item) => item.id !== missionId),
          mission,
        ].slice(-10);
        await this.ctx.storage.put("explorations", retained);
        return json({
          ok: true,
          data: await checkpointedJobData(this.ctx, state, mission),
        }, { status: previous ? 200 : 201 });
      }
      return errorResponse(
        new AuditError("METHOD_NOT_ALLOWED", "That site exploration operation is not supported."),
      );
    }
    if (request.method === "POST" && url.pathname === "/route-input") {
      if (state.status !== "complete" || !state.report) {
        return errorResponse(
          new AuditError("AUDIT_NOT_READY", "Finish the parent audit before exploring its routes."),
        );
      }
      const input = await readJsonBody(request);
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        return errorResponse(new AuditError("INVALID_INPUT", "The request body must be an object."));
      }
      const extra = Object.keys(input).find((key) => !["path", "expectedMissionRevision"].includes(key));
      if (extra) return errorResponse(new AuditError("INVALID_INPUT", `Unknown field: ${extra}.`));
      try {
        await assertJobRevision(this.ctx, state, input.expectedMissionRevision);
        const data = createRelatedAuditInput(state.report, input.path);
        const updated = await advanceJobRevision(this.ctx, state);
        return json({ ok: true, data: await checkpointedJobData(this.ctx, updated, data) });
      } catch (error) {
        return errorResponse(error);
      }
    }
    if (request.method !== "GET") {
      return errorResponse(
        new AuditError("METHOD_NOT_ALLOWED", "That audit operation is not supported."),
      );
    }
    if (url.pathname === "/results") {
      if (state.status === "cancelled") {
        return errorResponse(new AuditError("AUDIT_CANCELLED", "The audit was cancelled."));
      }
      if (state.status === "failed") {
        return json({ ok: false, error: state.error }, { status: 422 });
      }
      if (state.status !== "complete") {
        return errorResponse(new AuditError("AUDIT_NOT_READY", "The audit is still running."));
      }
      return json({
        ok: true,
        data: {
          ...state.report,
          missionCheckpoint: await auditJobCheckpoint(this.ctx, state),
        },
      });
    }
    if (url.pathname === "/checkpoint") {
      return json({ ok: true, data: await auditJobCheckpoint(this.ctx, state) });
    }
    if (url.pathname === "/receipt") {
      if (state.status !== "complete" || !state.report) {
        return errorResponse(new AuditError("AUDIT_NOT_READY", "The audit is still running."));
      }
      try {
        return new Response(verificationReceiptMarkdown(state.report), {
          headers: {
            "content-type": "text/markdown; charset=utf-8",
            "content-disposition": `attachment; filename="frontmend-verification-${state.id}.md"`,
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
          },
        });
      } catch (error) {
        return errorResponse(error);
      }
    }
    if (url.pathname === "/report") {
      if (state.status !== "complete" || !state.report) {
        return errorResponse(new AuditError("AUDIT_NOT_READY", "The audit is still running."));
      }
      try {
        return new Response(auditReportMarkdown(state.report), {
          headers: {
            "content-type": "text/markdown; charset=utf-8",
            "content-disposition": `attachment; filename="frontmend-audit-${state.id}.md"`,
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
          },
        });
      } catch (error) {
        return errorResponse(error);
      }
    }
    if (url.pathname === "/assessment") {
      if (state.status !== "complete" || !state.report) {
        return errorResponse(new AuditError("AUDIT_NOT_READY", "The audit is still running."));
      }
      try {
        const [diagnosticMissions, browserReview, repairs, explorations, activities] = await Promise.all([
          this.ctx.storage.get("diagnosticMissions"),
          this.ctx.storage.get("browserReview"),
          this.ctx.storage.get("repairs"),
          this.ctx.storage.get("explorations"),
          this.ctx.storage.get("activityLedger"),
        ]);
        const receipt = createAssessmentReceipt({
          report: state.report,
          mission: state.mission,
          diagnosticMissions,
          browserReview: browserReview ?? null,
          repairs: repairs ?? [],
          explorations: explorations ?? [],
          activities: activities ?? [],
        });
        return new Response(assessmentReceiptMarkdown(receipt), {
          headers: {
            "content-type": "text/markdown; charset=utf-8",
            "content-disposition": `attachment; filename="frontmend-assessment-${state.id}.md"`,
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
          },
        });
      } catch (error) {
        return errorResponse(error);
      }
    }
    if (url.pathname.startsWith("/evidence/")) {
      const strategy = url.pathname.slice("/evidence/".length);
      const dataUrl = await this.ctx.storage.get(`evidence:${strategy}`);
      if (!dataUrl || typeof dataUrl !== "string") {
        return errorResponse(
          new AuditError("EVIDENCE_NOT_FOUND", "That evidence image is unavailable."),
        );
      }
      const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([a-z0-9+/=]+)$/i);
      if (!match) {
        return errorResponse(new AuditError("EVIDENCE_INVALID", "That evidence image is invalid."));
      }
      const bytes = Uint8Array.from(atob(match[2]), (character) => character.charCodeAt(0));
      return new Response(bytes, {
        headers: {
          "content-type": match[1],
          "cache-control": "public, max-age=600, immutable",
          "x-content-type-options": "nosniff",
        },
      });
    }
    return json({ ok: true, data: auditSnapshot(state, await auditJobCheckpoint(this.ctx, state)) });
  }

  async retainedExplorationReports() {
    if (!this.env?.AUDIT_JOBS?.get || !this.env?.AUDIT_JOBS?.idFromName) return [];
    const explorations = (await this.ctx.storage.get("explorations")) ?? [];
    const children = [];
    for (const mission of explorations) {
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
    return Promise.all(children.map(async (child) => {
      try {
        const job = this.env.AUDIT_JOBS.get(this.env.AUDIT_JOBS.idFromName(child.auditId));
        const response = await job.fetch("https://frontmend.internal/");
        const payload = await response.json();
        return {
          auditId: child.auditId,
          path: child.path,
          url: child.url,
          status: payload?.data?.status ?? "failed",
          report: payload?.data?.report ?? null,
        };
      } catch {
        return { auditId: child.auditId, path: child.path, url: child.url, status: "failed", report: null };
      }
    }));
  }

  async verificationImpactForRepair(state, repair, verificationTargetIds) {
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
      rootReport: state.report,
      findings: packageItems,
      browserReview: (await this.ctx.storage.get("browserReview")) ?? null,
      auditedReports: await this.retainedExplorationReports(),
      verificationTargetIds,
    });
    if (repair.status !== "approved") return impact;
    return reviewRepairVerificationImpact(
      impact,
      repair.approval?.mode === "delegated-auto" ? "delegated-auto-policy" : "person",
      repair.reviewedAt,
    );
  }

  async aggregateVerificationForRepair(repair) {
    if (!repair?.verificationImpact?.matrix || !repair?.verificationRun?.id) return null;
    const audits = await Promise.all((repair.verificationRun.assignments ?? []).map(async (assignment) => {
      if (!assignment.auditId || !this.env?.AUDIT_JOBS?.get || !this.env?.AUDIT_JOBS?.idFromName) {
        return null;
      }
      try {
        const job = this.env.AUDIT_JOBS.get(this.env.AUDIT_JOBS.idFromName(assignment.auditId));
        const response = await job.fetch("https://frontmend.internal/");
        const payload = await response.json();
        return response.ok && payload?.data
          ? payload.data
          : { id: assignment.auditId, status: "failed", report: null };
      } catch {
        return { id: assignment.auditId, status: "failed", report: null };
      }
    }));
    return aggregateRepairVerification(
      repair.verificationImpact,
      repair.verificationRun,
      audits.filter(Boolean),
    );
  }

  async repairWorkspaceItem(repair, state = null) {
    const effectiveRepair = !repair.verificationImpact && state?.report
      ? { ...repair, verificationImpact: createLegacyRepairVerificationImpact({ repair, rootReport: state.report }) }
      : repair;
    const aggregateVerification = await this.aggregateVerificationForRepair(effectiveRepair);
    return repairWithMission({
      ...effectiveRepair,
      aggregateVerification,
    });
  }

  async handleRepairs(request, url, state) {
    if (state.status !== "complete" || !state.report) {
      return errorResponse(new AuditError("AUDIT_NOT_READY", "Finish the audit before staging a repair."));
    }
    const match = url.pathname.match(/^\/repairs(?:\/([^/]+)(?:\/(approve|changes|revise|implementation|deployment|export|candidate-review|candidate-review-checks|verification-input|verification-start-input|verification-assignments|verification|verification-receipt))?)?$/);
    if (!match) return errorResponse(new AuditError("NOT_FOUND", "That repair route does not exist."));
    const [, rawRepairId, action] = match;
    const repairs = (await this.ctx.storage.get("repairs")) ?? [];
    let repairPolicy = repairPolicySnapshot(await this.ctx.storage.get("repairPolicy"));

    if (!rawRepairId && request.method === "GET") {
      const workspaceRepairs = await Promise.all(repairs.map((repair) => this.repairWorkspaceItem(repair, state)));
      return json({
        ok: true,
        data: await checkpointedJobData(this.ctx, state, {
          auditId: state.id,
          repairs: workspaceRepairs,
          policy: repairPolicy,
        }),
      });
    }
    if (!rawRepairId && request.method === "POST") {
      const input = await readJsonBody(request);
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        return errorResponse(new AuditError("INVALID_REPAIR", "The repair proposal must be an object."));
      }
      const browserReview = await this.ctx.storage.get("browserReview");
      let requestedFindingIds;
      try {
        requestedFindingIds = normalizeRepairFindingIds(input.findingId, input.findingIds);
      } catch (error) {
        return errorResponse(error);
      }
      const retainedFindings = assessmentFindings(
        state.report,
        browserReview,
        (await this.ctx.storage.get("explorations")) ?? [],
      );
      const findings = requestedFindingIds.map((id) => retainedFindings.find((item) => item.id === id));
      if (findings.some((finding) => !finding)) {
        return errorResponse(new AuditError("FINDING_NOT_FOUND", "Every repair-package finding must belong to this completed audit."));
      }
      const existing = repairs.find((repair) => JSON.stringify(repair.findingIds ?? [repair.findingId]) === JSON.stringify(requestedFindingIds));
      if (existing) {
        return json({ ok: true, data: await checkpointedJobData(this.ctx, state, await this.repairWorkspaceItem(existing, state)) });
      }
      if (repairs.some((repair) => (repair.findingIds ?? [repair.findingId]).some((id) => requestedFindingIds.includes(id)))) {
        return errorResponse(new AuditError(
          "REPAIR_PACKAGE_CONFLICT",
          "A retained finding already belongs to a different repair package.",
        ));
      }
      const preparedFindingIds = state.mission
        ? auditMissionSnapshot(state.mission).repairPreparation?.findingIds ?? []
        : [];
      if (JSON.stringify(preparedFindingIds) !== JSON.stringify(requestedFindingIds)) {
        return errorResponse(new AuditError(
          "REPAIR_INTENT_REQUIRED",
          "Record explicit repair intent for this exact frozen finding package before staging a repair draft.",
        ));
      }
      if (repairs.length >= 10) {
        return errorResponse(new AuditError("REPAIR_LIMIT", "This audit already has the maximum number of repair drafts."));
      }
      const { source, expectedMissionRevision, verificationTargetIds, ...proposal } = input;
      await assertJobRevision(this.ctx, state, expectedMissionRevision);
      const missions = (await this.ctx.storage.get("diagnosticMissions")) ?? [];
      const priorities = state.mission
        ? deriveAuditMissionState({
            report: state.report,
            mission: state.mission,
            diagnosticMissions: missions,
            repairs,
            browserReview,
            explorations: (await this.ctx.storage.get("explorations")) ?? [],
          }).priorities
        : [];
      const packageDiagnosticMissions = [];
      for (const finding of findings) {
        const priority = priorities.find((item) => item.findingId === finding.id);
        const diagnosticRequired = findingRequiresDiagnosticMission(finding)
          || priority?.diagnosticMissionRequired
          || state.mission?.repairPreparation?.requestedBy === "agent";
        const diagnosticMission = missions.find((mission) => mission.findingId === finding.id) ?? null;
        if (
          diagnosticRequired
          && (source === "agent" || findings.length > 1 || state.mission?.repairPreparation?.requestedBy === "agent")
          && diagnosticMission?.state?.state !== "ready-for-repair"
        ) {
          return errorResponse(new AuditError(
            "DIAGNOSTIC_MISSION_REQUIRED",
            "Every agent-prepared finding must have repair-ready browser and repository trace evidence before staging.",
          ));
        }
        if (diagnosticMission?.state?.state === "ready-for-repair") packageDiagnosticMissions.push(diagnosticMissionForRepair(diagnosticMission));
      }
      const repairId = crypto.randomUUID();
      let repair = createRepairDraft({
        repairId,
        auditId: state.id,
        finding: findings[0],
        findings,
        diagnosticMissions: packageDiagnosticMissions,
        report: state.report,
        input: proposal,
        source,
      });
      repair = {
        ...repair,
        verificationImpact: await this.verificationImpactForRepair(
          state,
          repair,
          verificationTargetIds ?? [],
        ),
      };
      const policyResult = applyRepairPolicy(repair, repairPolicy);
      repair = policyResult.repair;
      repairPolicy = policyResult.policy;
      repairs.push(repair);
      await this.ctx.storage.put("repairs", repairs);
      await this.ctx.storage.put("repairPolicy", repairPolicy);
      const updated = await advanceJobRevision(this.ctx, state);
      return json({ ok: true, data: await checkpointedJobData(this.ctx, updated, await this.repairWorkspaceItem(repair, updated)) }, { status: 201 });
    }

    const repairId = validateRepairId(decodeURIComponent(rawRepairId ?? ""));
    const repairIndex = repairs.findIndex((repair) => repair.id === repairId);
    if (repairIndex < 0) {
      return errorResponse(new AuditError("REPAIR_NOT_FOUND", "That repair draft does not exist."));
    }
    const repair = repairs[repairIndex];
    if (!action && request.method === "GET") {
      return json({ ok: true, data: await this.repairWorkspaceItem(repair, state) });
    }

    if (action === "candidate-review" && request.method === "GET") {
      return json({ ok: true, data: await checkpointedJobData(this.ctx, state, await this.repairWorkspaceItem(repair, state)) });
    }
    if (action === "candidate-review" && request.method === "POST") {
      const input = await readJsonBody(request);
      const extra = Object.keys(input ?? {}).find(
        (key) => !["candidateOrigin", "source", "expectedMissionRevision"].includes(key),
      );
      if (extra) return errorResponse(new AuditError("INVALID_CANDIDATE_REVIEW", `Unknown candidate review field: ${extra}.`));
      if (input?.source !== "agent" && input?.source !== "person") {
        return errorResponse(new AuditError("INVALID_CANDIDATE_REVIEW", "Candidate review must identify an agent or person source."));
      }
      try {
        const next = openCandidateReview(
          repair,
          { candidateOrigin: input.candidateOrigin },
          input.source,
        );
        if (next === repair) {
          return json({ ok: true, data: await checkpointedJobData(this.ctx, state, await this.repairWorkspaceItem(repair, state)) });
        }
        await assertJobRevision(this.ctx, state, input.expectedMissionRevision);
        repairs[repairIndex] = next;
        await this.ctx.storage.put("repairs", repairs);
        const updated = await advanceJobRevision(this.ctx, state);
        return json({ ok: true, data: await checkpointedJobData(this.ctx, updated, await this.repairWorkspaceItem(next, updated)) }, { status: 201 });
      } catch (error) {
        return errorResponse(error);
      }
    }
    if (action === "candidate-review-checks" && request.method === "POST") {
      const input = await readJsonBody(request);
      const { reviewId, source, expectedMissionRevision, ...check } = input ?? {};
      if (source !== "agent" && source !== "person") {
        return errorResponse(new AuditError("INVALID_CANDIDATE_REVIEW", "Candidate review evidence must identify an agent or person source."));
      }
      try {
        if (isIdenticalCandidateReviewContribution(repair, reviewId, check, source)) {
          return json({ ok: true, data: await checkpointedJobData(this.ctx, state, await this.repairWorkspaceItem(repair, state)) });
        }
        await assertJobRevision(this.ctx, state, expectedMissionRevision);
        repairs[repairIndex] = recordCandidateReviewCheck(repair, reviewId, check, source);
        await this.ctx.storage.put("repairs", repairs);
        const updated = await advanceJobRevision(this.ctx, state);
        return json({ ok: true, data: await checkpointedJobData(this.ctx, updated, await this.repairWorkspaceItem(repairs[repairIndex], updated)) });
      } catch (error) {
        return errorResponse(error);
      }
    }

    if (action === "approve" && request.method === "POST") {
      if (repair.status === "changes-requested") {
        return errorResponse(
          new AuditError("CHANGES_REQUESTED", "Revise this repair before it can be approved."),
        );
      }
      if (repair.status === "approved") {
        return json({ ok: true, data: await checkpointedJobData(this.ctx, state, await this.repairWorkspaceItem(repair, state)) });
      }
      const input = await readJsonBody(request);
      await assertJobRevision(this.ctx, state, input?.expectedMissionRevision);
      if (repair.status !== "approved") {
        const approvedAt = Date.now();
        const impact = repair.verificationImpact ?? await this.verificationImpactForRepair(state, repair, []);
        repairs[repairIndex] = {
          ...repair,
          verificationImpact: reviewRepairVerificationImpact(impact, "person", approvedAt),
          status: "approved",
          requiresHumanReview: false,
          reviewedAt: approvedAt,
          approval: { mode: "explicit-review", grantedBy: "person", approvedAt },
        };
        await this.ctx.storage.put("repairs", repairs);
      }
      const updated = await advanceJobRevision(this.ctx, state);
      return json({ ok: true, data: await checkpointedJobData(this.ctx, updated, await this.repairWorkspaceItem(repairs[repairIndex], updated)) });
    }
    if (action === "changes" && request.method === "POST") {
      const input = await readJsonBody(request);
      const extra = Object.keys(input ?? {}).find((key) => !["feedback", "expectedMissionRevision"].includes(key));
      if (extra) return errorResponse(new AuditError("INVALID_REPAIR", `Unknown repair field: ${extra}.`));
      await assertJobRevision(this.ctx, state, input?.expectedMissionRevision);
      repairs[repairIndex] = requestRepairChanges(repair, input?.feedback);
      await this.ctx.storage.put("repairs", repairs);
      const updated = await advanceJobRevision(this.ctx, state);
      return json({ ok: true, data: await checkpointedJobData(this.ctx, updated, await this.repairWorkspaceItem(repairs[repairIndex], updated)) });
    }
    if (action === "revise" && request.method === "POST") {
      const input = await readJsonBody(request);
      const { source, expectedMissionRevision, ...proposal } = input ?? {};
      if (source !== undefined && source !== "agent") {
        return errorResponse(new AuditError("INVALID_REPAIR", "Repair revisions must be agent-authored."));
      }
      await assertJobRevision(this.ctx, state, expectedMissionRevision);
      const repairWithImpact = repair.verificationImpact
        ? repair
        : { ...repair, verificationImpact: await this.verificationImpactForRepair(state, repair, []) };
      repairs[repairIndex] = reviseRepairDraft(repairWithImpact, proposal, "agent");
      await this.ctx.storage.put("repairs", repairs);
      const updated = await advanceJobRevision(this.ctx, state);
      return json({ ok: true, data: await checkpointedJobData(this.ctx, updated, await this.repairWorkspaceItem(repairs[repairIndex], updated)) });
    }
    if (action === "implementation" && request.method === "POST") {
      const input = await readJsonBody(request);
      const { source, expectedMissionRevision, ...receipt } = input ?? {};
      if (source !== "agent") {
        return errorResponse(
          new AuditError("INVALID_IMPLEMENTATION_RECEIPT", "Repository implementation receipts must be agent-reported."),
        );
      }
      await assertJobRevision(this.ctx, state, expectedMissionRevision);
      repairs[repairIndex] = recordRepositoryImplementation(repair, receipt);
      await this.ctx.storage.put("repairs", repairs);
      const updated = await advanceJobRevision(this.ctx, state);
      return json({ ok: true, data: await checkpointedJobData(this.ctx, updated, await this.repairWorkspaceItem(repairs[repairIndex], updated)) });
    }
    if (action === "deployment" && request.method === "POST") {
      if (repair.status !== "approved") {
        return errorResponse(
          new AuditError("REPAIR_NOT_APPROVED", "Approve this repair draft before confirming deployment."),
        );
      }
      if (!Number.isFinite(repair.deploymentAttestedAt)) {
        const input = await readJsonBody(request);
        await assertJobRevision(this.ctx, state, input?.expectedMissionRevision);
        repairs[repairIndex] = { ...repair, deploymentAttestedAt: Date.now() };
        await this.ctx.storage.put("repairs", repairs);
        const updated = await advanceJobRevision(this.ctx, state);
        return json({ ok: true, data: await checkpointedJobData(this.ctx, updated, await this.repairWorkspaceItem(repairs[repairIndex], updated)) });
      }
      return json({ ok: true, data: await checkpointedJobData(this.ctx, state, await this.repairWorkspaceItem(repairs[repairIndex], state)) });
    }
    if (action === "verification-start-input" && request.method === "POST") {
      if (repair.status !== "approved") {
        return errorResponse(new AuditError("REPAIR_NOT_APPROVED", "Approve this repair draft before verification."));
      }
      if (!Number.isFinite(repair.deploymentAttestedAt)) {
        return errorResponse(new AuditError(
          "DEPLOYMENT_NOT_ATTESTED",
          "A person must confirm the reviewed change was deployed before verification.",
        ));
      }
      const input = await readJsonBody(request);
      const effectiveImpact = repair.verificationImpact
        ?? createLegacyRepairVerificationImpact({ repair, rootReport: state.report });
      reviewedVerificationTargets(effectiveImpact);
      if (repair.verificationRun?.id && repair.verificationRun.repairRevision === effectiveImpact.repairRevision) {
        return json({
          ok: true,
          data: await checkpointedJobData(this.ctx, state, {
            repair: await this.repairWorkspaceItem({ ...repair, verificationImpact: effectiveImpact }, state),
            run: repair.verificationRun,
            targets: reviewedVerificationTargets(effectiveImpact),
          }),
        });
      }
      await assertJobRevision(this.ctx, state, input?.expectedMissionRevision);
      const run = createRepairVerificationRun(effectiveImpact, crypto.randomUUID());
      repairs[repairIndex] = { ...repair, verificationImpact: effectiveImpact, verificationRun: run };
      await this.ctx.storage.put("repairs", repairs);
      const updated = await advanceJobRevision(this.ctx, state);
      return json({
        ok: true,
        data: await checkpointedJobData(this.ctx, updated, {
          repair: await this.repairWorkspaceItem(repairs[repairIndex], updated),
          run,
          targets: reviewedVerificationTargets(effectiveImpact),
        }),
      });
    }
    if (action === "verification-assignments" && request.method === "POST") {
      const input = await readJsonBody(request);
      if (!repair.verificationRun?.id || input?.runId !== repair.verificationRun.id) {
        return errorResponse(new AuditError("VERIFICATION_RUN_NOT_FOUND", "That aggregate verification run does not exist."));
      }
      repairs[repairIndex] = {
        ...repair,
        verificationRun: assignRepairVerificationJobs(repair.verificationRun, input.assignments),
      };
      await this.ctx.storage.put("repairs", repairs);
      return json({ ok: true, data: await this.repairWorkspaceItem(repairs[repairIndex], state) });
    }
    if (action === "verification" && request.method === "GET") {
      const aggregate = await this.aggregateVerificationForRepair(repair);
      return aggregate
        ? json({ ok: true, data: await checkpointedJobData(this.ctx, state, aggregate) })
        : errorResponse(new AuditError("VERIFICATION_RUN_NOT_FOUND", "No aggregate verification run exists."));
    }
    if (action === "verification-receipt" && request.method === "GET") {
      try {
        const aggregate = await this.aggregateVerificationForRepair(repair);
        if (!aggregate) throw new AuditError("VERIFICATION_RUN_NOT_FOUND", "No aggregate verification run exists.");
        return new Response(repairVerificationReceiptMarkdown(aggregate), {
          headers: {
            "content-type": "text/markdown; charset=utf-8",
            "content-disposition": `attachment; filename="frontmend-repair-verification-${repair.id}.md"`,
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
          },
        });
      } catch (error) {
        return errorResponse(error);
      }
    }
    if (action === "verification-input" && ["GET", "POST"].includes(request.method)) {
      if (repair.status !== "approved") {
        return errorResponse(new AuditError("REPAIR_NOT_APPROVED", "Approve this repair draft before verification."));
      }
      if (!Number.isFinite(repair.deploymentAttestedAt)) {
        return errorResponse(
          new AuditError(
            "DEPLOYMENT_NOT_ATTESTED",
            "A person must confirm the reviewed change was deployed before verification.",
          ),
        );
      }
      const verification = createVerificationContext(state.report, repair);
      if (request.method === "GET") return json({ ok: true, data: verification });
      const input = await readJsonBody(request);
      await assertJobRevision(this.ctx, state, input?.expectedMissionRevision);
      const updated = await advanceJobRevision(this.ctx, state);
      return json({ ok: true, data: await checkpointedJobData(this.ctx, updated, verification) });
    }
    if (action === "export" && request.method === "GET") {
      try {
        return new Response(repairExportMarkdown({ report: state.report, repair }), {
          headers: {
            "content-type": "text/markdown; charset=utf-8",
            "content-disposition": `attachment; filename="frontmend-repair-${repair.id}.md"`,
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
          },
        });
      } catch (error) {
        return errorResponse(error);
      }
    }
    return errorResponse(new AuditError("METHOD_NOT_ALLOWED", "That repair operation is not supported."));
  }

  async handleDiagnostics(request, url, state) {
    if (state.status !== "complete" || !state.report) {
      return errorResponse(new AuditError("AUDIT_NOT_READY", "Finish the audit before opening a diagnostic mission."));
    }
    const match = url.pathname.match(/^\/diagnostics(?:\/([^/]+)(?:\/(evidence|blocker))?)?$/);
    if (!match) return errorResponse(new AuditError("NOT_FOUND", "That diagnostic route does not exist."));
    const [, rawMissionId, action] = match;
    const missions = (await this.ctx.storage.get("diagnosticMissions")) ?? [];
    if (!rawMissionId && request.method === "GET") {
      return json({
        ok: true,
        data: await checkpointedJobData(this.ctx, state, {
          auditId: state.id,
          missions: missions.map(diagnosticMissionSnapshot),
        }),
      });
    }
    if (!rawMissionId && request.method === "POST") {
      const input = await readJsonBody(request);
      const extra = Object.keys(input ?? {}).find((key) => !["findingId", "expectedMissionRevision"].includes(key));
      if (extra) return errorResponse(new AuditError("INVALID_DIAGNOSTIC_EVIDENCE", `Unknown diagnostic field: ${extra}.`));
      const browserReview = await this.ctx.storage.get("browserReview");
      const finding = assessmentFindings(
        state.report,
        browserReview,
        (await this.ctx.storage.get("explorations")) ?? [],
      ).find((item) => item.id === input?.findingId);
      if (!finding) return errorResponse(new AuditError("FINDING_NOT_FOUND", "That audit finding does not exist."));
      const preparedFindingIds = state.mission?.repairPreparation?.findingIds
        ?? (state.mission?.repairPreparation?.findingId ? [state.mission.repairPreparation.findingId] : []);
      if (!preparedFindingIds.includes(finding.id)) {
        return errorResponse(new AuditError(
          "REPAIR_INTENT_REQUIRED",
          "Select this retained finding with prepare_site_repair before opening repository diagnosis.",
        ));
      }
      const existing = missions.find((mission) => mission.findingId === finding.id);
      if (existing) {
        return json({ ok: true, data: await checkpointedJobData(this.ctx, state, diagnosticMissionSnapshot(existing)) });
      }
      if (missions.length >= 10) return errorResponse(new AuditError("DIAGNOSTIC_LIMIT", "This audit already has the maximum number of diagnostic missions."));
      try {
        await assertJobRevision(this.ctx, state, input?.expectedMissionRevision);
        const repairs = (await this.ctx.storage.get("repairs")) ?? [];
        const priority = state.mission
          ? deriveAuditMissionState({
              report: state.report,
              mission: state.mission,
              diagnosticMissions: missions,
              repairs,
              browserReview,
              explorations: (await this.ctx.storage.get("explorations")) ?? [],
            }).priorities.find((item) => item.findingId === finding.id)
          : null;
        const mission = createDiagnosticMission({
          auditId: state.id,
          finding,
          relationship: state.mission?.repairPreparation?.requestedBy === "agent"
            && state.mission.repairPreparation.findingIds.includes(finding.id)
            ? "repair-trace-required"
            : priority?.relationship ?? null,
        });
        missions.push(mission);
        await this.ctx.storage.put("diagnosticMissions", missions);
        const updated = await advanceJobRevision(this.ctx, state);
        return json({ ok: true, data: await checkpointedJobData(this.ctx, updated, mission) }, { status: 201 });
      } catch (error) {
        return errorResponse(error);
      }
    }
    const missionId = decodeURIComponent(rawMissionId ?? "");
    const missionIndex = missions.findIndex((mission) => mission.id === missionId);
    if (missionIndex < 0) return errorResponse(new AuditError("DIAGNOSTIC_NOT_FOUND", "That diagnostic mission does not exist."));
    if (!action && request.method === "GET") {
      return json({
        ok: true,
        data: await checkpointedJobData(this.ctx, state, diagnosticMissionSnapshot(missions[missionIndex])),
      });
    }
    if (action === "evidence" && request.method === "POST") {
      const preparedFindingIds = state.mission?.repairPreparation?.findingIds
        ?? (state.mission?.repairPreparation?.findingId ? [state.mission.repairPreparation.findingId] : []);
      if (!preparedFindingIds.includes(missions[missionIndex].findingId)) {
        return errorResponse(new AuditError(
          "REPAIR_INTENT_REQUIRED",
          "Select this retained finding with prepare_site_repair before contributing repository diagnosis.",
        ));
      }
      const input = await readJsonBody(request);
      const { source, expectedMissionRevision, ...evidence } = input ?? {};
      if (source !== "agent" && source !== "person") {
        return errorResponse(new AuditError("INVALID_DIAGNOSTIC_EVIDENCE", "Diagnostic evidence must identify an agent or person source."));
      }
      try {
        await assertJobRevision(this.ctx, state, expectedMissionRevision);
        missions[missionIndex] = submitDiagnosticEvidence(missions[missionIndex], evidence, source);
        await this.ctx.storage.put("diagnosticMissions", missions);
        const updated = await advanceJobRevision(this.ctx, state);
        return json({ ok: true, data: await checkpointedJobData(this.ctx, updated, missions[missionIndex]) });
      } catch (error) {
        return errorResponse(error);
      }
    }
    if (action === "blocker" && request.method === "POST") {
      const preparedFindingIds = state.mission?.repairPreparation?.findingIds
        ?? (state.mission?.repairPreparation?.findingId ? [state.mission.repairPreparation.findingId] : []);
      if (!preparedFindingIds.includes(missions[missionIndex].findingId)) {
        return errorResponse(new AuditError(
          "REPAIR_INTENT_REQUIRED",
          "Select this retained finding with prepare_site_repair before recording a repository-diagnosis blocker.",
        ));
      }
      const input = await readJsonBody(request);
      const { source, expectedMissionRevision, ...blocker } = input ?? {};
      if (source !== "agent" && source !== "person") {
        return errorResponse(new AuditError("INVALID_DIAGNOSTIC_BLOCKER", "A diagnostic blocker must identify an agent or person source."));
      }
      try {
        await assertJobRevision(this.ctx, state, expectedMissionRevision);
        missions[missionIndex] = recordDiagnosticBlocker(missions[missionIndex], blocker, source);
        await this.ctx.storage.put("diagnosticMissions", missions);
        const updated = await advanceJobRevision(this.ctx, state);
        return json({ ok: true, data: await checkpointedJobData(this.ctx, updated, missions[missionIndex]) });
      } catch (error) {
        return errorResponse(error);
      }
    }
    return errorResponse(new AuditError("METHOD_NOT_ALLOWED", "That diagnostic operation is not supported."));
  }

  async handleBrowserReview(request, url, state) {
    const verificationReplay = state.verification?.browserReplay?.required === true
      || (state.verification?.browserReplays?.length ?? 0) > 0
      || (state.verification?.browserGuardrails?.length ?? 0) > 0;
    if (state.status !== "complete" || !state.report) {
      return errorResponse(new AuditError("AUDIT_NOT_READY", "Finish the measurement before opening its browser review."));
    }
    const match = url.pathname.match(/^\/browser-review(?:\/([^/]+)\/(checks|withdrawal))?$/);
    if (!match) return errorResponse(new AuditError("NOT_FOUND", "That browser review route does not exist."));
    const [, rawReviewId, action] = match;
    const stored = await this.ctx.storage.get("browserReview");
    if (!rawReviewId && request.method === "GET") {
      return json({
        ok: true,
        data: await checkpointedJobData(this.ctx, state, {
          auditId: state.id,
          review: stored ? browserReviewSnapshot(stored) : null,
        }),
      });
    }
    if (!rawReviewId && request.method === "POST") {
      const input = await readJsonBody(request);
      const extra = Object.keys(input ?? {}).find(
        (key) => !["source", "focusAreas", "expectedMissionRevision"].includes(key),
      );
      if (extra) return errorResponse(new AuditError("INVALID_BROWSER_REVIEW", `Unknown browser review field: ${extra}.`));
      if (stored) {
        const current = browserReviewSnapshot(stored);
        const explorations = (await this.ctx.storage.get("explorations")) ?? [];
        const explorationFindings = assessmentFindings(state.report, null, explorations)
          .filter((finding) => finding.aggregateEvidence);
        const extended = state.mission && explorationFindings.length
          ? extendBrowserReviewMission({
              review: current,
              report: { ...state.report, findings: explorationFindings },
              mission: state.mission,
              target: state.report.finalUrl ?? state.report.url ?? state.url,
            })
          : current;
        if (extended.requestedChecks.length > current.requestedChecks.length) {
          await assertJobRevision(this.ctx, state, input?.expectedMissionRevision);
          await this.ctx.storage.put("browserReview", extended);
          const updatedState = await advanceJobRevision(this.ctx, state);
          return json({
            ok: true,
            data: await checkpointedJobData(this.ctx, updatedState, extended),
          }, { status: 201 });
        }
        return json({ ok: true, data: await checkpointedJobData(this.ctx, state, current) });
      }
      try {
        if (!state.mission && !verificationReplay) {
          throw new AuditError(
            "BROWSER_REVIEW_NOT_REQUIRED",
            "This related audit has no standalone browser-review mission. Continue from its root audit workspace.",
          );
        }
        await assertJobRevision(this.ctx, state, input?.expectedMissionRevision);
        const review = verificationReplay
          ? createBrowserVerificationReview({
              auditId: state.id,
              verification: state.verification,
              target: state.report.finalUrl ?? state.report.url ?? state.url,
            })
          : createBrowserReviewMission({
              auditId: state.id,
              mission: state.mission,
              report: state.report,
              documentProfile: state.report.documentProfile,
              target: state.report.finalUrl ?? state.report.url ?? state.url,
              source: input?.source,
              focusAreas: input?.focusAreas,
            });
        await this.ctx.storage.put("browserReview", review);
        const updatedState = await advanceJobRevision(this.ctx, state);
        return json({ ok: true, data: await checkpointedJobData(this.ctx, updatedState, review) }, { status: 201 });
      } catch (error) {
        return errorResponse(error);
      }
    }
    if (action === "checks" && request.method === "POST") {
      if (!stored || stored.id !== decodeURIComponent(rawReviewId ?? "")) {
        return errorResponse(new AuditError("BROWSER_REVIEW_NOT_FOUND", "That browser review does not exist."));
      }
      const input = await readJsonBody(request);
      const { source, expectedMissionRevision, ...check } = input ?? {};
      if (source !== "agent" && source !== "person") {
        return errorResponse(new AuditError("INVALID_BROWSER_REVIEW", "Browser review evidence must identify an agent or person source."));
      }
      try {
        if (isIdenticalBrowserReviewContribution(stored, check, source)) {
          return json({
            ok: true,
            data: await checkpointedJobData(this.ctx, state, browserReviewSnapshot(stored)),
          });
        }
        await assertJobRevision(this.ctx, state, expectedMissionRevision);
        const review = recordBrowserReviewCheck(stored, check, source);
        const contribution = review.results.find((result) => result.checkId === check.checkId);
        const renderedRoutes = contribution?.observedRoutes?.length
          ? await validateRenderedRouteObservations({
              report: state.report,
              observedRoutes: contribution.observedRoutes,
              source,
              fetchImpl: typeof this.env?.PUBLIC_FETCH === "function" ? this.env.PUBLIC_FETCH : fetch,
            })
          : [];
        await this.ctx.storage.put("browserReview", review);
        if (verificationReplay) {
          const updated = await advanceJobRevision(this.ctx, state, {
            report: {
              ...state.report,
              verification: compareVerification(
                state.report,
                state.verification,
                Date.now(),
                review,
              ),
            },
          });
          return json({ ok: true, data: await checkpointedJobData(this.ctx, updated, review) });
        }
        const updated = await advanceJobRevision(this.ctx, state, {
          report: renderedRoutes.length
            ? mergeRenderedRouteObservations(
                state.report,
                renderedRoutes.map((route) => ({
                  ...route,
                  reviewId: review.id,
                  checkId: contribution.checkId,
                })),
              )
            : state.report,
        });
        return json({ ok: true, data: await checkpointedJobData(this.ctx, updated, review) });
      } catch (error) {
        return errorResponse(error);
      }
    }
    if (action === "withdrawal" && request.method === "POST") {
      if (!stored || stored.id !== decodeURIComponent(rawReviewId ?? "")) {
        return errorResponse(new AuditError("BROWSER_REVIEW_NOT_FOUND", "That browser review does not exist."));
      }
      const input = await readJsonBody(request);
      const extra = Object.keys(input ?? {}).find(
        (key) => !["source", "expectedMissionRevision"].includes(key),
      );
      if (extra) return errorResponse(new AuditError("INVALID_BROWSER_REVIEW", `Unknown browser review withdrawal field: ${extra}.`));
      if (input?.source !== "person") {
        return errorResponse(new AuditError(
          "BROWSER_REVIEW_WITHDRAWAL_HUMAN_ONLY",
          "Only a person can withdraw an optional rendered-review handoff.",
        ));
      }
      try {
        const current = browserReviewSnapshot(stored);
        if (current.withdrawal?.status === "withdrawn") {
          return json({ ok: true, data: await checkpointedJobData(this.ctx, state, current) });
        }
        await assertJobRevision(this.ctx, state, input.expectedMissionRevision);
        const review = withdrawBrowserReview(current, "person");
        await this.ctx.storage.put("browserReview", review);
        const updated = await advanceJobRevision(this.ctx, state);
        return json({ ok: true, data: await checkpointedJobData(this.ctx, updated, review) });
      } catch (error) {
        return errorResponse(error);
      }
    }
    return errorResponse(new AuditError("METHOD_NOT_ALLOWED", "That browser review operation is not supported."));
  }

  async run(initialState) {
    const operationalStartedAt = Date.now();
    const operationalWorkload = initialState.verification
      ? "verification-child"
      : initialState.exploration || initialState.siteExploration
        ? "exploration-child"
        : "root";
    let operational = null;
    try {
      const auditRunner = typeof this.env.AUDIT_RUNNER === "function"
        ? this.env.AUDIT_RUNNER
        : runFrontmendAudit;
      const output = await auditRunner({
        auditId: initialState.id,
        url: initialState.url,
        apiKey: this.env.PAGESPEED_API_KEY,
        signal: this.abortController?.signal,
        onProgress: async (progress) => {
          const current = await this.ctx.storage.get("state");
          if (
            !current ||
            current.attempt !== initialState.attempt ||
            ["complete", "failed", "cancelled"].includes(current.status)
          ) return;
          await this.ctx.storage.put("state", {
            ...current,
            status: "running",
            ...progress,
          });
        },
      });
      operational = output.operational ?? null;
      if (initialState.verification) {
        output.report.verification = compareVerification(output.report, initialState.verification);
      }
      if (initialState.exploration) {
        output.report.exploration = initialState.exploration;
      }
      if (initialState.siteExploration) {
        output.report.siteExploration = initialState.siteExploration;
      }
      const ready = await this.ctx.storage.get("state");
      if (
        !ready ||
        ready.attempt !== initialState.attempt ||
        ready.status === "cancelled"
      ) return;
      for (const [strategy, dataUrl] of Object.entries(output.screenshots)) {
        await this.ctx.storage.put(`evidence:${strategy}`, dataUrl);
      }
      const current = (await this.ctx.storage.get("state")) ?? initialState;
      if (
        current.attempt !== initialState.attempt ||
        current.status === "cancelled"
      ) return;
      await advanceJobRevision(this.ctx, current, {
        status: "complete",
        phase: "complete",
        phaseLabel: "Live audit complete",
        progress: 100,
        report: output.report,
        error: null,
      });
      emitOperationalEvents(this.env, [
        ...createProviderOperationalEvents(operational, operationalWorkload),
        createAuditOperationalEvent({
          outcome: "complete",
          workload: operationalWorkload,
          latencyMs: Date.now() - operationalStartedAt,
          fallbackUsed: operational?.fallbackUsed,
          availableSourceCount: operational?.availableSourceCount,
        }),
      ]);
      await this.scheduleRetention();
    } catch (error) {
      operational = operational ?? error?.operational ?? null;
      const current = (await this.ctx.storage.get("state")) ?? initialState;
      if (
        current.attempt !== initialState.attempt ||
        current.status === "cancelled"
      ) return;
      if (error?.code === "AUDIT_CANCELLED") {
        await advanceJobRevision(this.ctx, current, {
          status: "cancelled",
          phase: "cancelled",
          phaseLabel: "Audit cancelled",
          report: null,
          error: null,
          completedAt: Date.now(),
        });
        emitOperationalEvents(this.env, [
          ...createProviderOperationalEvents(operational, operationalWorkload),
          createAuditOperationalEvent({
            outcome: "cancelled",
            workload: operationalWorkload,
            latencyMs: Date.now() - operationalStartedAt,
            fallbackUsed: operational?.fallbackUsed,
            availableSourceCount: operational?.availableSourceCount,
            failureCode: "AUDIT_CANCELLED",
          }),
        ]);
        await this.scheduleRetention();
        return;
      }
      await advanceJobRevision(this.ctx, current, {
        status: "failed",
        phase: "failed",
        phaseLabel: "Live audit failed",
        progress: current.progress,
        report: null,
        error: {
          code: typeof error?.code === "string" ? error.code : "AUDIT_FAILED",
          message:
            typeof error?.message === "string"
              ? error.message.slice(0, 300)
              : "The live audit could not be completed.",
          recoverable: error?.recoverable !== false,
        },
      });
      emitOperationalEvents(this.env, [
        ...createProviderOperationalEvents(operational, operationalWorkload),
        createAuditOperationalEvent({
          outcome: "failed",
          workload: operationalWorkload,
          latencyMs: Date.now() - operationalStartedAt,
          fallbackUsed: operational?.fallbackUsed,
          availableSourceCount: operational?.availableSourceCount,
          failureCode: typeof error?.code === "string" ? error.code : "AUDIT_FAILED",
        }),
      ]);
      await this.scheduleRetention();
    }
  }
}
