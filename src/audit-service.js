import { AuditError, normalizePublicUrl } from "./url-policy.js";
import {
  auditMissionSnapshot,
  assessmentFindings,
  createAuditMission,
  deriveAuditMissionState,
  normalizeRepairFindingIds,
} from "./audit-mission-contract.js";
import { agentCapabilitySnapshot } from "./agent-capability-contract.js";
import { getActiveEvidenceCapsule as createActiveEvidenceCapsule } from "./evidence-capsule-contract.js";
import { createAssessmentReceipt } from "./assessment-receipt.js";
import { auditMissionRevision, createMissionCheckpoint } from "./mission-checkpoint-contract.js";
import {
  ACTIVITY_TOOL_TITLES,
  activityLedgerSnapshot,
  createActivityLedgerRecord,
  mergeActivityLedger,
} from "./activity-ledger-contract.js";

export { AuditError, normalizePublicUrl } from "./url-policy.js";

async function responsePayload(response) {
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new AuditError("INVALID_RESPONSE", "The live audit service returned an invalid response.");
  }
  if (!response.ok || payload?.ok === false) {
    const detail = payload?.error;
    throw new AuditError(
      typeof detail?.code === "string" ? detail.code : "AUDIT_REQUEST_FAILED",
      typeof detail?.message === "string"
        ? detail.message
        : "The live audit service could not complete the request.",
      detail?.recoverable !== false,
      detail?.details && typeof detail.details === "object" ? detail.details : null,
    );
  }
  if (!payload?.data || typeof payload.data !== "object") {
    throw new AuditError("INVALID_RESPONSE", "The live audit service returned incomplete data.");
  }
  return payload.data;
}

export function createHttpAuditTransport(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch?.bind(globalThis);
  const baseUrl = options.baseUrl ?? "";
  if (!fetchImpl) throw new Error("Frontmend requires fetch to reach the live audit service.");

  return {
    async start({ url, source, mission }) {
      const missionInput = mission
        ? {
            intent: mission.intent,
            focusAreas: mission.focusAreas,
            maxPriorities: mission.maxPriorities,
            scope: mission.scope,
            routeLimit: mission.routeLimit,
          }
        : undefined;
      return responsePayload(
        await fetchImpl(`${baseUrl}/api/audits`, {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify({ url, source, mission: missionInput }),
        }),
      );
    },

    async startRelated(auditId, path, source, expectedMissionRevision) {
      return responsePayload(
        await fetchImpl(`${baseUrl}/api/audits/${encodeURIComponent(auditId)}/routes`, {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify({ path, source, expectedMissionRevision }),
        }),
      );
    },

    async prepareRepair(auditId, findingId, source, expectedMissionRevision, findingIds = undefined) {
      return responsePayload(
        await fetchImpl(
          `${baseUrl}/api/audits/${encodeURIComponent(auditId)}/mission/prepare-repair`,
          {
            method: "POST",
            headers: { accept: "application/json", "content-type": "application/json" },
            body: JSON.stringify({
              findingId,
              findingIds: findingIds?.length > 1 ? findingIds : undefined,
              source: source === "agent" ? "agent" : "human",
              expectedMissionRevision,
            }),
          },
        ),
      );
    },

    async declareAgentCapabilities(auditId, capabilities, expectedMissionRevision) {
      return responsePayload(
        await fetchImpl(`${baseUrl}/api/audits/${encodeURIComponent(auditId)}/agent-capabilities`, {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify({ capabilities, expectedMissionRevision }),
        }),
      );
    },

    async startExploration(auditId, selection, source, expectedMissionRevision) {
      const routeSelection = Array.isArray(selection) ? { paths: selection } : selection;
      return responsePayload(
        await fetchImpl(`${baseUrl}/api/audits/${encodeURIComponent(auditId)}/explorations`, {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify({ ...routeSelection, source, expectedMissionRevision }),
        }),
      );
    },

    async listExplorations(auditId) {
      return responsePayload(
        await fetchImpl(`${baseUrl}/api/audits/${encodeURIComponent(auditId)}/explorations`, {
          headers: { accept: "application/json" },
        }),
      );
    },

    async getExploration(auditId, missionId) {
      return responsePayload(
        await fetchImpl(
          `${baseUrl}/api/audits/${encodeURIComponent(auditId)}/explorations/${encodeURIComponent(missionId)}`,
          { headers: { accept: "application/json" } },
        ),
      );
    },

    async listActivities(auditId) {
      return responsePayload(
        await fetchImpl(`${baseUrl}/api/audits/${encodeURIComponent(auditId)}/activities`, {
          headers: { accept: "application/json" },
        }),
      );
    },

    async recordActivity(auditId, activity) {
      return responsePayload(
        await fetchImpl(`${baseUrl}/api/audits/${encodeURIComponent(auditId)}/activities`, {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify(activity),
        }),
      );
    },

    async get(auditId) {
      return responsePayload(
        await fetchImpl(`${baseUrl}/api/audits/${encodeURIComponent(auditId)}`, {
          headers: { accept: "application/json" },
        }),
      );
    },

    async checkpoint(auditId) {
      return responsePayload(
        await fetchImpl(`${baseUrl}/api/audits/${encodeURIComponent(auditId)}/checkpoint`, {
          headers: { accept: "application/json" },
        }),
      );
    },

    async cancel(auditId, expectedMissionRevision) {
      return responsePayload(
        await fetchImpl(`${baseUrl}/api/audits/${encodeURIComponent(auditId)}`, {
          method: "DELETE",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify({ expectedMissionRevision }),
        }),
      );
    },

    async results(auditId) {
      return responsePayload(
        await fetchImpl(`${baseUrl}/api/audits/${encodeURIComponent(auditId)}/results`, {
          headers: { accept: "application/json" },
        }),
      );
    },

    async listRepairs(auditId) {
      return responsePayload(
        await fetchImpl(`${baseUrl}/api/audits/${encodeURIComponent(auditId)}/repairs`, {
          headers: { accept: "application/json" },
        }),
      );
    },

    async verificationCandidates(auditId, findingId, findingIds = undefined) {
      const params = new URLSearchParams({ findingId });
      for (const id of (findingIds?.length ?? 0) > 1 ? findingIds : []) params.append("findingIds", id);
      return responsePayload(
        await fetchImpl(
          `${baseUrl}/api/audits/${encodeURIComponent(auditId)}/verification-candidates?${params}`,
          { headers: { accept: "application/json" } },
        ),
      );
    },

    async repairVerification(auditId, repairId) {
      return responsePayload(
        await fetchImpl(
          `${baseUrl}/api/audits/${encodeURIComponent(auditId)}/repairs/${encodeURIComponent(repairId)}/verification`,
          { headers: { accept: "application/json" } },
        ),
      );
    },

    async getCandidateReview(auditId, repairId) {
      return responsePayload(
        await fetchImpl(
          `${baseUrl}/api/audits/${encodeURIComponent(auditId)}/repairs/${encodeURIComponent(repairId)}/candidate-review`,
          { headers: { accept: "application/json" } },
        ),
      );
    },

    async openCandidateReview(auditId, repairId, candidateOrigin, source = "agent", expectedMissionRevision) {
      return responsePayload(
        await fetchImpl(
          `${baseUrl}/api/audits/${encodeURIComponent(auditId)}/repairs/${encodeURIComponent(repairId)}/candidate-review`,
          {
            method: "POST",
            headers: { accept: "application/json", "content-type": "application/json" },
            body: JSON.stringify({
              candidateOrigin,
              source: source === "person" ? "person" : "agent",
              expectedMissionRevision,
            }),
          },
        ),
      );
    },

    async recordCandidateReviewCheck(
      auditId,
      repairId,
      reviewId,
      input,
      source = "agent",
      expectedMissionRevision,
    ) {
      return responsePayload(
        await fetchImpl(
          `${baseUrl}/api/audits/${encodeURIComponent(auditId)}/repairs/${encodeURIComponent(repairId)}/candidate-review/checks`,
          {
            method: "POST",
            headers: { accept: "application/json", "content-type": "application/json" },
            body: JSON.stringify({
              ...input,
              reviewId,
              source: source === "person" ? "person" : "agent",
              expectedMissionRevision,
            }),
          },
        ),
      );
    },

    async listDiagnosticMissions(auditId) {
      return responsePayload(
        await fetchImpl(`${baseUrl}/api/audits/${encodeURIComponent(auditId)}/diagnostics`, {
          headers: { accept: "application/json" },
        }),
      );
    },

    async getBrowserReview(auditId) {
      return responsePayload(
        await fetchImpl(`${baseUrl}/api/audits/${encodeURIComponent(auditId)}/browser-review`, {
          headers: { accept: "application/json" },
        }),
      );
    },

    async openBrowserReview(auditId, input = {}, expectedMissionRevision) {
      const options = Number.isInteger(input) ? {} : input ?? {};
      const revision = Number.isInteger(input) ? input : expectedMissionRevision;
      return responsePayload(
        await fetchImpl(`${baseUrl}/api/audits/${encodeURIComponent(auditId)}/browser-review`, {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify({ ...options, expectedMissionRevision: revision }),
        }),
      );
    },

    async recordBrowserReviewCheck(auditId, reviewId, input, source = "agent", expectedMissionRevision) {
      return responsePayload(
        await fetchImpl(
          `${baseUrl}/api/audits/${encodeURIComponent(auditId)}/browser-review/${encodeURIComponent(reviewId)}/checks`,
          {
            method: "POST",
            headers: { accept: "application/json", "content-type": "application/json" },
            body: JSON.stringify({ ...input, source: source === "person" ? "person" : "agent", expectedMissionRevision }),
          },
        ),
      );
    },

    async withdrawBrowserReview(auditId, reviewId, expectedMissionRevision) {
      return responsePayload(
        await fetchImpl(
          `${baseUrl}/api/audits/${encodeURIComponent(auditId)}/browser-review/${encodeURIComponent(reviewId)}/withdrawal`,
          {
            method: "POST",
            headers: { accept: "application/json", "content-type": "application/json" },
            body: JSON.stringify({ source: "person", expectedMissionRevision }),
          },
        ),
      );
    },

    async openDiagnosticMission(auditId, findingId, expectedMissionRevision) {
      return responsePayload(
        await fetchImpl(`${baseUrl}/api/audits/${encodeURIComponent(auditId)}/diagnostics`, {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify({ findingId, expectedMissionRevision }),
        }),
      );
    },

    async submitDiagnosticEvidence(auditId, missionId, input, source = "agent", expectedMissionRevision) {
      return responsePayload(
        await fetchImpl(
          `${baseUrl}/api/audits/${encodeURIComponent(auditId)}/diagnostics/${encodeURIComponent(missionId)}/evidence`,
          {
            method: "POST",
            headers: { accept: "application/json", "content-type": "application/json" },
            body: JSON.stringify({ ...input, source: source === "person" ? "person" : "agent", expectedMissionRevision }),
          },
        ),
      );
    },

    async recordDiagnosticBlocker(auditId, missionId, input, source = "agent", expectedMissionRevision) {
      return responsePayload(
        await fetchImpl(
          `${baseUrl}/api/audits/${encodeURIComponent(auditId)}/diagnostics/${encodeURIComponent(missionId)}/blocker`,
          {
            method: "POST",
            headers: { accept: "application/json", "content-type": "application/json" },
            body: JSON.stringify({ ...input, source: source === "person" ? "person" : "agent", expectedMissionRevision }),
          },
        ),
      );
    },

    async getRepairPolicy(auditId) {
      return responsePayload(
        await fetchImpl(`${baseUrl}/api/audits/${encodeURIComponent(auditId)}/repair-policy`, {
          headers: { accept: "application/json" },
        }),
      );
    },

    async setRepairPolicy(auditId, mode, expectedMissionRevision) {
      return responsePayload(
        await fetchImpl(`${baseUrl}/api/audits/${encodeURIComponent(auditId)}/repair-policy`, {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify({ mode, expectedMissionRevision }),
        }),
      );
    },

    async stageRepair(auditId, input, expectedMissionRevision) {
      return responsePayload(
        await fetchImpl(`${baseUrl}/api/audits/${encodeURIComponent(auditId)}/repairs`, {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify({ ...input, expectedMissionRevision }),
        }),
      );
    },

    async approveRepair(auditId, repairId, expectedMissionRevision) {
      return responsePayload(
        await fetchImpl(
          `${baseUrl}/api/audits/${encodeURIComponent(auditId)}/repairs/${encodeURIComponent(repairId)}/approve`,
          {
            method: "POST",
            headers: { accept: "application/json", "content-type": "application/json" },
            body: JSON.stringify({ expectedMissionRevision }),
          },
        ),
      );
    },

    async requestRepairChanges(auditId, repairId, feedback, expectedMissionRevision) {
      return responsePayload(
        await fetchImpl(
          `${baseUrl}/api/audits/${encodeURIComponent(auditId)}/repairs/${encodeURIComponent(repairId)}/changes`,
          {
            method: "POST",
            headers: { accept: "application/json", "content-type": "application/json" },
            body: JSON.stringify({ feedback, expectedMissionRevision }),
          },
        ),
      );
    },

    async reviseRepair(auditId, repairId, input, expectedMissionRevision) {
      return responsePayload(
        await fetchImpl(
          `${baseUrl}/api/audits/${encodeURIComponent(auditId)}/repairs/${encodeURIComponent(repairId)}/revise`,
          {
            method: "POST",
            headers: { accept: "application/json", "content-type": "application/json" },
            body: JSON.stringify({ ...input, source: "agent", expectedMissionRevision }),
          },
        ),
      );
    },

    async recordImplementation(auditId, repairId, input, expectedMissionRevision) {
      return responsePayload(
        await fetchImpl(
          `${baseUrl}/api/audits/${encodeURIComponent(auditId)}/repairs/${encodeURIComponent(repairId)}/implementation`,
          {
            method: "POST",
            headers: { accept: "application/json", "content-type": "application/json" },
            body: JSON.stringify({ ...input, source: "agent", expectedMissionRevision }),
          },
        ),
      );
    },

    async attestDeployment(auditId, repairId, expectedMissionRevision) {
      return responsePayload(
        await fetchImpl(
          `${baseUrl}/api/audits/${encodeURIComponent(auditId)}/repairs/${encodeURIComponent(repairId)}/deployment`,
          {
            method: "POST",
            headers: { accept: "application/json", "content-type": "application/json" },
            body: JSON.stringify({ expectedMissionRevision }),
          },
        ),
      );
    },

    async startVerification(auditId, repairId, expectedMissionRevision) {
      return responsePayload(
        await fetchImpl(
          `${baseUrl}/api/audits/${encodeURIComponent(auditId)}/repairs/${encodeURIComponent(repairId)}/verify`,
          {
            method: "POST",
            headers: { accept: "application/json", "content-type": "application/json" },
            body: JSON.stringify({ expectedMissionRevision }),
          },
        ),
      );
    },

    repairExportUrl(auditId, repairId) {
      return `${baseUrl}/api/audits/${encodeURIComponent(auditId)}/repairs/${encodeURIComponent(repairId)}/export`;
    },

    verificationReceiptUrl(auditId) {
      return `${baseUrl}/api/audits/${encodeURIComponent(auditId)}/receipt`;
    },

    repairVerificationReceiptUrl(auditId, repairId) {
      return `${baseUrl}/api/audits/${encodeURIComponent(auditId)}/repairs/${encodeURIComponent(repairId)}/verification/receipt`;
    },

    auditReportUrl(auditId) {
      return `${baseUrl}/api/audits/${encodeURIComponent(auditId)}/report`;
    },

    assessmentReceiptUrl(auditId) {
      return `${baseUrl}/api/audits/${encodeURIComponent(auditId)}/assessment`;
    },

    explorationReportUrl(auditId, missionId) {
      return `${baseUrl}/api/audits/${encodeURIComponent(auditId)}/explorations/${encodeURIComponent(missionId)}/report`;
    },
  };
}

export function createAuditService(options = {}) {
  const transport = options.transport ?? createHttpAuditTransport(options);
  const now = options.now ?? Date.now;
  const jobs = new Map();
  const repairs = new Map();
  const diagnosticMissions = new Map();
  const browserReviews = new Map();
  const repairPolicies = new Map();
  const explorations = new Map();
  const activeEvidenceFindingByAudit = new Map();
  const listeners = new Set();
  const agentActivitiesByAudit = new Map();
  let pendingAgentActivities = [];
  let activitySequence = 0;
  let activeAuditId = null;
  let generation = 0;

  const emit = () => {
    for (const listener of listeners) listener();
  };

  const missionRevisionFrom = (value) => {
    const revision = value?.missionCheckpoint?.missionRevision ?? value?.missionRevision;
    return Number.isInteger(revision) && revision > 0 ? revision : null;
  };

  const assertNonRegressiveMissionRevision = (auditId, value) => {
    const incomingRevision = missionRevisionFrom(value);
    const currentAudit = jobs.get(auditId);
    if (!currentAudit || !Number.isInteger(incomingRevision)) return value;
    const currentRevision = auditMissionRevision(currentAudit);
    if (incomingRevision < currentRevision) {
      throw new AuditError(
        "MISSION_REVISION_STALE",
        "The audit service returned an older mission revision. Frontmend kept the newer workspace; inspect its current state before acting again.",
        true,
        { missionCheckpoint: checkpointFor(auditId) },
      );
    }
    return value;
  };

  const assertMissionCheckpoint = (checkpoint, auditId) => {
    assertResponseIdentity(checkpoint, "auditId", auditId);
    if (!Number.isInteger(checkpoint?.missionRevision) || checkpoint.missionRevision < 1) {
      throw new AuditError(
        "INVALID_RESPONSE",
        "The audit service returned an invalid mission checkpoint. Retry the original audit address.",
      );
    }
    return assertNonRegressiveMissionRevision(auditId, checkpoint);
  };

  const retainCheckpoint = (auditId, checkpoint, expectedGeneration = generation) => {
    if (!checkpoint) return null;
    assertMissionCheckpoint(checkpoint, auditId);
    if (expectedGeneration !== generation) return checkpoint;
    const previous = jobs.get(auditId);
    if (previous) {
      jobs.set(auditId, {
        ...previous,
        missionRevision: checkpoint.missionRevision,
        missionCheckpoint: checkpoint,
      });
    }
    return checkpoint;
  };

  const rememberCheckpoint = (auditId, checkpoint, expectedGeneration = generation) => {
    const retained = retainCheckpoint(auditId, checkpoint, expectedGeneration);
    if (retained && expectedGeneration === generation && jobs.has(auditId)) emit();
    return retained;
  };

  const revisionFor = (auditId, expectedMissionRevision) => {
    if (Number.isInteger(expectedMissionRevision) && expectedMissionRevision > 0) {
      return expectedMissionRevision;
    }
    return auditMissionRevision(jobs.get(auditId));
  };

  const checkpointFor = (auditId) => {
    const audit = jobs.get(auditId);
    if (!audit) return null;
    return createMissionCheckpoint({
      audit,
      missionState: audit.mission
        ? deriveAuditMissionState({
            report: audit.report,
            mission: audit.mission,
            diagnosticMissions: diagnosticMissions.get(auditId) ?? [],
            repairs: repairs.get(auditId) ?? [],
            browserReview: browserReviews.get(auditId) ?? null,
            explorations: explorations.get(auditId) ?? [],
          })
        : null,
      diagnosticMissions: diagnosticMissions.get(auditId) ?? [],
      repairs: repairs.get(auditId) ?? [],
      browserReview: browserReviews.get(auditId) ?? null,
      explorations: explorations.get(auditId) ?? [],
      agentCapabilities: audit.agentCapabilities ?? null,
    });
  };

  const remember = (audit, expectedGeneration = generation) => {
    if (!audit?.id) return audit;
    if (audit.missionCheckpoint) {
      assertMissionCheckpoint(audit.missionCheckpoint, audit.id);
    } else {
      assertNonRegressiveMissionRevision(audit.id, audit);
    }
    if (expectedGeneration !== generation) return audit;
    const previous = jobs.get(audit.id);
    const retained = {
      ...audit,
      mission: audit.mission ?? previous?.mission ?? null,
      agentCapabilities: audit.agentCapabilities ?? previous?.agentCapabilities ?? null,
    };
    jobs.set(audit.id, retained);
    activeAuditId = audit.id;
    emit();
    return retained;
  };

  const rememberRepair = (repair, expectedGeneration = generation) => {
    if (!repair?.id || expectedGeneration !== generation) return repair;
    retainCheckpoint(repair.auditId, repair.missionCheckpoint, expectedGeneration);
    const storedRepair = { ...repair };
    delete storedRepair.missionCheckpoint;
    const current = repairs.get(repair.auditId) ?? [];
    repairs.set(repair.auditId, [...current.filter((item) => item.id !== repair.id), storedRepair]);
    emit();
    return repair;
  };

  const rememberDiagnosticMission = (mission, expectedGeneration = generation) => {
    if (!mission?.id || expectedGeneration !== generation) return mission;
    retainCheckpoint(mission.auditId, mission.missionCheckpoint, expectedGeneration);
    const storedMission = { ...mission };
    delete storedMission.missionCheckpoint;
    const current = diagnosticMissions.get(mission.auditId) ?? [];
    diagnosticMissions.set(mission.auditId, [
      ...current.filter((item) => item.id !== mission.id),
      storedMission,
    ]);
    emit();
    return mission;
  };

  const retainBrowserReview = (review, expectedGeneration = generation) => {
    if (!review?.id || expectedGeneration !== generation) return review;
    retainCheckpoint(review.auditId, review.missionCheckpoint, expectedGeneration);
    const storedReview = { ...review };
    delete storedReview.missionCheckpoint;
    browserReviews.set(review.auditId, storedReview);
    return review;
  };

  const rememberBrowserReview = (review, expectedGeneration = generation) => {
    const retained = retainBrowserReview(review, expectedGeneration);
    if (review?.id && expectedGeneration === generation) emit();
    return retained;
  };

  const rememberExploration = (exploration, expectedGeneration = generation) => {
    if (!exploration?.id || expectedGeneration !== generation) return exploration;
    const rootAuditId = exploration.rootAuditId;
    if (rootAuditId) {
      retainCheckpoint(rootAuditId, exploration.missionCheckpoint, expectedGeneration);
      const storedExploration = { ...exploration };
      delete storedExploration.missionCheckpoint;
      const current = explorations.get(rootAuditId) ?? [];
      explorations.set(rootAuditId, [
        storedExploration,
        ...current.filter((item) => item.id !== exploration.id),
      ].slice(0, 10));
      emit();
    }
    return exploration;
  };

  const assertResponseIdentity = (value, field, expectedValue) => {
    if (value?.[field] !== expectedValue) {
      throw new AuditError(
        "AUDIT_RESPONSE_MISMATCH",
        "The audit service returned state for a different workspace or mission continuation. Retry the original audit address.",
      );
    }
    return value;
  };

  const assertResponseListIdentity = (values, field, auditId) => {
    for (const value of Array.isArray(values) ? values : []) {
      assertResponseIdentity(value, field, auditId);
    }
    return values;
  };

  const assertMissionCheckpointIdentity = (value, auditId, required = false) => {
    if (value?.missionCheckpoint) {
      assertMissionCheckpoint(value.missionCheckpoint, auditId);
    } else if (required) {
      throw new AuditError(
        "INVALID_RESPONSE",
        "The audit service returned mission state without its authoritative checkpoint. Retry the original audit address.",
      );
    }
    return value;
  };

  const assertAuditScopedResponse = (value, auditId, expectedId = null) => {
    assertResponseIdentity(value, "auditId", auditId);
    if (expectedId) assertResponseIdentity(value, "id", expectedId);
    return assertMissionCheckpointIdentity(value, auditId, true);
  };

  const missionPayloadSignature = (mission) => {
    try {
      return JSON.stringify(auditMissionSnapshot(mission));
    } catch {
      throw new AuditError(
        "INVALID_RESPONSE",
        "The audit service returned an invalid mission payload. Retry the original audit address.",
      );
    }
  };

  const assertMatchingMissionPayloads = (left, right) => {
    if (missionPayloadSignature(left) !== missionPayloadSignature(right)) {
      throw new AuditError(
        "AUDIT_RESPONSE_MISMATCH",
        "The audit service returned contradictory mission state. Retry the original audit address.",
      );
    }
  };

  const assertMatchingMissionRevisions = (audit, checkpoint) => {
    const checkpointRevision = checkpoint.missionRevision;
    const revisions = [audit?.missionRevision, audit?.missionCheckpoint?.missionRevision]
      .filter(Number.isInteger);
    if (revisions.some((revision) => revision !== checkpointRevision)) {
      throw new AuditError(
        "MISSION_REFRESH_UNSTABLE",
        "The audit service returned contradictory mission revisions. Retry before acting.",
        true,
        { missionCheckpoint: checkpoint },
      );
    }
  };

  const assertResponseStringSet = (value, field, expectedValues) => {
    const actual = Array.isArray(value?.[field]) ? [...value[field]].sort() : null;
    const expected = [...expectedValues].sort();
    if (!actual || actual.length !== expected.length || actual.some((item, index) => item !== expected[index])) {
      throw new AuditError(
        "AUDIT_RESPONSE_MISMATCH",
        "The audit service returned state for a different workspace or mission continuation. Retry the original audit address.",
      );
    }
    return value;
  };

  const readAudit = async (auditId) => {
    if (typeof auditId !== "string" || !auditId) {
      throw new AuditError("INVALID_INPUT", "auditId must be a non-empty string.");
    }
    const expectedGeneration = generation;
    const audit = assertResponseIdentity(await transport.get(auditId), "id", auditId);
    return remember(audit, expectedGeneration);
  };

  const restoreActivityLedger = async (auditId, expectedGeneration = generation) => {
    if (typeof transport.listActivities !== "function") return [];
    try {
      const workspace = assertResponseIdentity(
        await transport.listActivities(auditId),
        "auditId",
        auditId,
      );
      const retained = activityLedgerSnapshot(workspace.activities, auditId);
      if (expectedGeneration === generation) {
        agentActivitiesByAudit.set(auditId, retained);
        emit();
      }
      return retained;
    } catch {
      // Activity history is operational context. Its read cannot invalidate evidence state.
      return agentActivitiesByAudit.get(auditId) ?? [];
    }
  };

  const refreshMissionWorkspace = async (auditId, options = {}) => {
    if (typeof auditId !== "string" || !auditId) {
      throw new AuditError("INVALID_INPUT", "auditId must be a non-empty string.");
    }
    const publishOnlyWhenComplete = options?.publishOnlyWhenComplete === true;
    const expectedGeneration = generation;
    let snapshot = null;
    let latestCheckpoint = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const checkpointBefore = assertMissionCheckpoint(await transport.checkpoint(auditId), auditId);
      const settled = await Promise.allSettled([
        transport.get(auditId),
        transport.listRepairs(auditId),
        transport.listDiagnosticMissions(auditId),
        transport.getBrowserReview(auditId),
        transport.listExplorations(auditId),
      ]);
      const checkpointAfter = assertMissionCheckpoint(await transport.checkpoint(auditId), auditId);
      latestCheckpoint = checkpointAfter;
      const auditResult = settled[0];
      if (auditResult.status === "fulfilled") {
        assertResponseIdentity(auditResult.value, "id", auditId);
      }
      const repairResult = settled[1];
      if (repairResult.status === "fulfilled") {
        assertResponseIdentity(repairResult.value, "auditId", auditId);
        assertResponseListIdentity(repairResult.value?.repairs, "auditId", auditId);
      }
      const diagnosticResult = settled[2];
      if (diagnosticResult.status === "fulfilled") {
        assertResponseIdentity(diagnosticResult.value, "auditId", auditId);
        assertResponseListIdentity(diagnosticResult.value?.missions, "auditId", auditId);
      }
      const browserResult = settled[3];
      if (browserResult.status === "fulfilled") {
        assertResponseIdentity(browserResult.value, "auditId", auditId);
        if (browserResult.value?.review) {
          assertResponseIdentity(browserResult.value.review, "auditId", auditId);
        }
      }
      const explorationResult = settled[4];
      if (explorationResult.status === "fulfilled") {
        assertResponseIdentity(explorationResult.value, "rootAuditId", auditId);
        assertResponseListIdentity(explorationResult.value?.explorations, "rootAuditId", auditId);
      }
      const auditRevision = auditResult.status === "fulfilled"
        ? auditResult.value?.missionRevision
        : null;
      const workspaceRevisions = settled.slice(1)
        .filter((result) => result.status === "fulfilled")
        .map((result) => missionRevisionFrom(result.value))
        .filter(Number.isInteger);
      const revisionStayedCurrent =
        checkpointBefore.missionRevision === checkpointAfter.missionRevision
        && (!Number.isInteger(auditRevision) || auditRevision === checkpointAfter.missionRevision)
        && workspaceRevisions.every((revision) => revision === checkpointAfter.missionRevision);
      if (revisionStayedCurrent) {
        snapshot = { missionCheckpoint: checkpointAfter, settled };
        break;
      }
    }
    if (!snapshot) {
      throw new AuditError(
        "MISSION_REFRESH_UNSTABLE",
        "The mission kept changing while Frontmend refreshed it. Refresh this audit again before acting.",
        true,
        latestCheckpoint ? { missionCheckpoint: latestCheckpoint } : null,
      );
    }
    const missionCheckpoint = snapshot.missionCheckpoint;
    const [auditResult, repairResult, diagnosticResult, browserResult, explorationResult] = snapshot.settled;
    const results = {
      audit: auditResult.status === "fulfilled",
      repairs: repairResult.status === "fulfilled",
      diagnostics: diagnosticResult.status === "fulfilled",
      browserReview: browserResult.status === "fulfilled",
      explorations: explorationResult.status === "fulfilled",
    };
    const unavailable = Object.entries(results)
      .filter(([, ready]) => !ready)
      .map(([name]) => name);
    if (expectedGeneration !== generation) {
      return {
        auditId,
        missionCheckpoint,
        refreshed: results,
        unavailable,
        published: false,
      };
    }
    if (publishOnlyWhenComplete && unavailable.length) {
      return {
        auditId,
        missionCheckpoint,
        refreshed: results,
        unavailable,
        published: false,
      };
    }

    if (auditResult.status === "fulfilled" && auditResult.value?.id) {
      const previous = jobs.get(auditId);
      const retained = {
        ...auditResult.value,
        mission: auditResult.value.mission ?? previous?.mission ?? null,
        agentCapabilities: auditResult.value.agentCapabilities ?? previous?.agentCapabilities ?? null,
      };
      jobs.set(auditId, retained);
      activeAuditId = auditId;
    }
    const refreshedAudit = jobs.get(auditId);
    if (refreshedAudit) {
      jobs.set(auditId, {
        ...refreshedAudit,
        missionRevision: missionCheckpoint.missionRevision,
        missionCheckpoint,
      });
    }
    if (repairResult.status === "fulfilled") {
      repairs.set(auditId, repairResult.value.repairs ?? []);
      if (repairResult.value.policy) repairPolicies.set(auditId, repairResult.value.policy);
    }
    if (diagnosticResult.status === "fulfilled") {
      diagnosticMissions.set(auditId, diagnosticResult.value.missions ?? []);
    }
    if (browserResult.status === "fulfilled") {
      if (browserResult.value.review) browserReviews.set(auditId, browserResult.value.review);
      else browserReviews.delete(auditId);
    }
    if (explorationResult.status === "fulfilled") {
      explorations.set(
        auditId,
        [...(explorationResult.value.explorations ?? [])].sort(
          (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0),
        ),
      );
    }
    emit();
    return {
      auditId,
      missionCheckpoint,
      refreshed: results,
      unavailable,
      published: true,
    };
  };

  const reconcileAdvancedDirectRead = async (auditId, value, expectedGeneration) => {
    if (expectedGeneration !== generation) return true;
    const incomingRevision = missionRevisionFrom(value);
    const currentAudit = jobs.get(auditId);
    const currentRevision = currentAudit ? auditMissionRevision(currentAudit) : null;
    if (
      !Number.isInteger(incomingRevision)
      || !Number.isInteger(currentRevision)
      || incomingRevision <= currentRevision
    ) {
      return false;
    }
    const workspace = await refreshMissionWorkspace(auditId, { publishOnlyWhenComplete: true });
    if (expectedGeneration !== generation) return true;
    if (workspace.published !== true || workspace.unavailable.length) {
      throw new AuditError(
        "MISSION_WORKSPACE_INCOMPLETE",
        "The mission advanced, but Frontmend could not reconcile every mission record. Retry this read before acting.",
        true,
        {
          missionCheckpoint: workspace.missionCheckpoint,
          unavailable: workspace.unavailable,
        },
      );
    }
    if (workspace.missionCheckpoint.missionRevision !== incomingRevision) {
      throw new AuditError(
        "MISSION_REFRESH_UNSTABLE",
        "The mission changed again while Frontmend reconciled this read. Retry before acting.",
        true,
        { missionCheckpoint: workspace.missionCheckpoint },
      );
    }
    return true;
  };

  const restoreAuditWorkspace = async (auditId) => {
    const expectedGeneration = generation;
    const audit = await readAudit(auditId);
    if (audit?.status !== "complete") {
      await restoreActivityLedger(auditId, expectedGeneration);
      return {
        audit,
        missionCheckpoint: audit?.missionCheckpoint ?? null,
        refreshed: { audit: true },
        unavailable: [],
      };
    }

    const workspace = await refreshMissionWorkspace(auditId, { publishOnlyWhenComplete: true });
    if (workspace.unavailable.length) {
      throw new AuditError(
        "MISSION_WORKSPACE_INCOMPLETE",
        "The audit job was found, but Frontmend could not restore every mission record. Retry before acting.",
        true,
        {
          missionCheckpoint: workspace.missionCheckpoint,
          unavailable: workspace.unavailable,
        },
      );
    }
    const restoredAudit = jobs.get(auditId);
    if (!restoredAudit) {
      throw new AuditError(
        "AUDIT_RESTORE_INTERRUPTED",
        "The audit workspace changed while Frontmend restored it. Open the stable audit address again.",
      );
    }
    await restoreActivityLedger(auditId, expectedGeneration);
    return { ...workspace, audit: restoredAudit };
  };

  return {
    async startAudit(input) {
      const url = normalizePublicUrl(input?.url);
      const source = input?.source === "agent" ? "agent" : "human";
      const mission = createAuditMission(input?.mission ?? {}, source, now());
      const expectedGeneration = generation;
      const audit = await transport.start({ url, source, mission });
      return remember({ ...audit, mission: audit.mission ?? mission }, expectedGeneration);
    },

    async startRelatedAudit(auditId, path, source = "human", expectedMissionRevision) {
      if (typeof auditId !== "string" || !auditId) {
        throw new AuditError("INVALID_INPUT", "auditId must be a non-empty string.");
      }
      if (typeof path !== "string" || !path || path.length > 256) {
        throw new AuditError("INVALID_INPUT", "path must contain 1 to 256 characters.");
      }
      const expectedGeneration = generation;
      const audit = assertMissionCheckpointIdentity(
        await transport.startRelated(
          auditId,
          path,
          source === "agent" ? "agent" : "human",
          revisionFor(auditId, expectedMissionRevision),
        ),
        auditId,
        true,
      );
      assertResponseIdentity(audit?.exploration, "parentAuditId", auditId);
      assertResponseIdentity(audit?.exploration, "observedPath", path);
      retainCheckpoint(auditId, audit.missionCheckpoint, expectedGeneration);
      const childAudit = { ...audit };
      delete childAudit.missionCheckpoint;
      remember(childAudit, expectedGeneration);
      return audit;
    },

    async prepareRepair(auditId, findingId, source = "human", expectedMissionRevision, findingIds = undefined) {
      if (typeof auditId !== "string" || !auditId) {
        throw new AuditError("INVALID_INPUT", "auditId must be a non-empty string.");
      }
      const requestedFindingIds = normalizeRepairFindingIds(findingId, findingIds);
      const expectedGeneration = generation;
      const result = assertMissionCheckpointIdentity(
        await transport.prepareRepair(
          auditId,
          findingId,
          source === "agent" ? "agent" : "human",
          revisionFor(auditId, expectedMissionRevision),
          requestedFindingIds,
        ),
        auditId,
        true,
      );
      assertResponseIdentity(result?.mission?.repairPreparation, "findingId", findingId);
      if (JSON.stringify(result?.mission?.repairPreparation?.findingIds ?? [result?.mission?.repairPreparation?.findingId]) !== JSON.stringify(requestedFindingIds)) {
        throw new AuditError("AUDIT_RESPONSE_MISMATCH", "The repair preparation returned a different finding package.");
      }
      if (result.audit) {
        assertResponseIdentity(result.audit, "id", auditId);
        assertResponseIdentity(result.audit?.mission?.repairPreparation, "findingId", findingId);
        if (result.audit.missionCheckpoint) {
          assertMissionCheckpointIdentity(result.audit, auditId);
        }
        assertMatchingMissionRevisions(result.audit, result.missionCheckpoint);
        assertMatchingMissionPayloads(result.audit.mission, result.mission);
        remember({
          ...result.audit,
          missionRevision: result.missionCheckpoint.missionRevision,
          missionCheckpoint: result.missionCheckpoint,
        }, expectedGeneration);
      } else {
        rememberCheckpoint(auditId, result.missionCheckpoint, expectedGeneration);
      }
      return result;
    },

    async declareAgentCapabilities(auditId, capabilities, expectedMissionRevision) {
      if (typeof auditId !== "string" || !auditId) {
        throw new AuditError("INVALID_INPUT", "auditId must be a non-empty string.");
      }
      const expectedGeneration = generation;
      const result = assertMissionCheckpointIdentity(
        await transport.declareAgentCapabilities(
          auditId,
          capabilities,
          revisionFor(auditId, expectedMissionRevision),
        ),
        auditId,
        true,
      );
      const declaration = agentCapabilitySnapshot(result.agentCapabilities);
      if (!declaration) {
        throw new AuditError("INVALID_RESPONSE", "The audit service did not retain the capability declaration.");
      }
      if (result.audit) {
        assertResponseIdentity(result.audit, "id", auditId);
        assertMatchingMissionRevisions(result.audit, result.missionCheckpoint);
        remember({
          ...result.audit,
          agentCapabilities: declaration,
          missionRevision: result.missionCheckpoint.missionRevision,
          missionCheckpoint: result.missionCheckpoint,
        }, expectedGeneration);
      } else {
        const current = jobs.get(auditId);
        if (!current) throw new AuditError("AUDIT_NOT_FOUND", "No audit exists with that ID.");
        jobs.set(auditId, {
          ...current,
          agentCapabilities: declaration,
          missionRevision: result.missionCheckpoint.missionRevision,
          missionCheckpoint: result.missionCheckpoint,
        });
        emit();
      }
      return { ...result, agentCapabilities: declaration };
    },

    async startSiteExploration(auditId, selection, source = "human", expectedMissionRevision) {
      if (typeof auditId !== "string" || !auditId) {
        throw new AuditError("INVALID_INPUT", "auditId must be a non-empty string.");
      }
      const values = Array.isArray(selection)
        ? selection
        : selection?.routeCandidateIds;
      if (!Array.isArray(values) || values.length < 1 || values.length > 3) {
        throw new AuditError("INVALID_INPUT", "Choose between 1 and 3 observed routes.");
      }
      const expectedGeneration = generation;
      const exploration = assertResponseIdentity(
        await transport.startExploration(
          auditId,
          selection,
          source === "agent" ? "agent" : "human",
          revisionFor(auditId, expectedMissionRevision),
        ),
        "rootAuditId",
        auditId,
      );
      assertMissionCheckpointIdentity(exploration, auditId, true);
      return rememberExploration(
        exploration,
        expectedGeneration,
      );
    },

    async listSiteExplorations(auditId) {
      if (typeof auditId !== "string" || !auditId) {
        throw new AuditError("INVALID_INPUT", "auditId must be a non-empty string.");
      }
      const expectedGeneration = generation;
      const workspace = assertResponseIdentity(
        await transport.listExplorations(auditId),
        "rootAuditId",
        auditId,
      );
      assertMissionCheckpointIdentity(workspace, auditId, true);
      const retained = assertResponseListIdentity(
        workspace.explorations,
        "rootAuditId",
        auditId,
      );
      if (await reconcileAdvancedDirectRead(auditId, workspace, expectedGeneration)) {
        return workspace;
      }
      if (expectedGeneration === generation) {
        retainCheckpoint(auditId, workspace.missionCheckpoint, expectedGeneration);
        explorations.set(
          auditId,
          [...(retained ?? [])].sort(
            (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0),
          ),
        );
        emit();
      }
      return workspace;
    },

    async getSiteExploration(auditId, missionId) {
      if (
        typeof auditId !== "string" ||
        !auditId ||
        typeof missionId !== "string" ||
        !missionId
      ) {
        throw new AuditError("INVALID_INPUT", "auditId and missionId must be non-empty strings.");
      }
      const expectedGeneration = generation;
      const exploration = assertResponseIdentity(
        await transport.getExploration(auditId, missionId),
        "rootAuditId",
        auditId,
      );
      assertResponseIdentity(exploration, "id", missionId);
      assertMissionCheckpointIdentity(exploration, auditId, true);
      if (await reconcileAdvancedDirectRead(auditId, exploration, expectedGeneration)) {
        return exploration;
      }
      return rememberExploration(
        exploration,
        expectedGeneration,
      );
    },

    async getAudit(auditId) {
      return readAudit(auditId);
    },

    async restoreAuditWorkspace(auditId) {
      return restoreAuditWorkspace(auditId);
    },

    async loadMissionCheckpoint(auditId) {
      if (typeof auditId !== "string" || !auditId) {
        throw new AuditError("INVALID_INPUT", "auditId must be a non-empty string.");
      }
      const expectedGeneration = generation;
      const checkpoint = assertMissionCheckpoint(await transport.checkpoint(auditId), auditId);
      rememberCheckpoint(auditId, checkpoint, expectedGeneration);
      return checkpoint;
    },

    async refreshMissionWorkspace(auditId, options) {
      return refreshMissionWorkspace(auditId, options);
    },

    async cancelAudit(auditId, expectedMissionRevision) {
      if (typeof auditId !== "string" || !auditId) {
        throw new AuditError("INVALID_INPUT", "auditId must be a non-empty string.");
      }
      const expectedGeneration = generation;
      const audit = assertMissionCheckpointIdentity(
        assertResponseIdentity(
          await transport.cancel(auditId, revisionFor(auditId, expectedMissionRevision)),
          "id",
          auditId,
        ),
        auditId,
        true,
      );
      return remember(audit, expectedGeneration);
    },

    async getResults(auditId) {
      if (typeof auditId !== "string" || !auditId) {
        throw new AuditError("INVALID_INPUT", "auditId must be a non-empty string.");
      }
      const expectedGeneration = generation;
      const result = assertMissionCheckpointIdentity(
        assertResponseIdentity(await transport.results(auditId), "auditId", auditId),
        auditId,
        true,
      );
      if (await reconcileAdvancedDirectRead(auditId, result, expectedGeneration)) {
        return result;
      }
      const report = { ...result };
      delete report.missionCheckpoint;
      const existing = jobs.get(auditId);
      if (existing && expectedGeneration === generation) {
        remember({
          ...existing,
          status: "complete",
          progress: 100,
          report,
          missionRevision: result.missionCheckpoint?.missionRevision ?? existing.missionRevision,
          missionCheckpoint: result.missionCheckpoint ?? existing.missionCheckpoint,
        }, expectedGeneration);
      }
      return result;
    },

    async getCoherentResults(auditId) {
      const workspace = await restoreAuditWorkspace(auditId);
      const audit = workspace.audit;
      if (audit?.status !== "complete" || !audit.report) {
        throw new AuditError(
          "AUDIT_RESULTS_UNAVAILABLE",
          "This audit does not have a completed result yet. Read its progress before requesting evidence.",
        );
      }
      assertResponseIdentity(audit.report, "auditId", auditId);
      return {
        ...audit.report,
        missionCheckpoint: workspace.missionCheckpoint ?? audit.missionCheckpoint,
      };
    },

    async listRepairs(auditId) {
      if (typeof auditId !== "string" || !auditId) {
        throw new AuditError("INVALID_INPUT", "auditId must be a non-empty string.");
      }
      const expectedGeneration = generation;
      const workspace = assertResponseIdentity(
        await transport.listRepairs(auditId),
        "auditId",
        auditId,
      );
      assertResponseListIdentity(workspace.repairs, "auditId", auditId);
      assertMissionCheckpointIdentity(workspace, auditId, true);
      if (await reconcileAdvancedDirectRead(auditId, workspace, expectedGeneration)) {
        return workspace;
      }
      if (expectedGeneration === generation) {
        retainCheckpoint(auditId, workspace.missionCheckpoint, expectedGeneration);
        repairs.set(auditId, workspace.repairs ?? []);
        if (workspace.policy) repairPolicies.set(auditId, workspace.policy);
        emit();
      }
      return workspace;
    },

    async getVerificationCandidates(auditId, findingId, findingIds = undefined) {
      if (typeof auditId !== "string" || !auditId || typeof findingId !== "string" || !findingId) {
        throw new AuditError("INVALID_INPUT", "auditId and findingId must be non-empty strings.");
      }
      const requestedFindingIds = normalizeRepairFindingIds(findingId, findingIds);
      const expectedGeneration = generation;
      const scope = assertResponseIdentity(
        await transport.verificationCandidates(auditId, findingId, requestedFindingIds),
        "auditId",
        auditId,
      );
      assertResponseIdentity(scope, "findingId", findingId);
      if (JSON.stringify(scope.findingIds ?? [scope.findingId]) !== JSON.stringify(requestedFindingIds)) {
        throw new AuditError("AUDIT_RESPONSE_MISMATCH", "The verification candidates returned a different finding package.");
      }
      assertMissionCheckpointIdentity(scope, auditId, true);
      if (await reconcileAdvancedDirectRead(auditId, scope, expectedGeneration)) {
        return scope;
      }
      rememberCheckpoint(auditId, scope.missionCheckpoint, expectedGeneration);
      return scope;
    },

    async getRepairVerification(auditId, repairId) {
      if (typeof auditId !== "string" || !auditId || typeof repairId !== "string" || !repairId) {
        throw new AuditError("INVALID_INPUT", "auditId and repairId must be non-empty strings.");
      }
      const expectedGeneration = generation;
      const aggregate = await transport.repairVerification(auditId, repairId);
      assertResponseIdentity(aggregate, "auditId", auditId);
      assertResponseIdentity(aggregate, "repairId", repairId);
      assertMissionCheckpointIdentity(aggregate, auditId, true);
      if (await reconcileAdvancedDirectRead(auditId, aggregate, expectedGeneration)) {
        return aggregate;
      }
      if (expectedGeneration === generation) {
        retainCheckpoint(auditId, aggregate.missionCheckpoint, expectedGeneration);
        const current = repairs.get(auditId) ?? [];
        repairs.set(auditId, current.map((repair) => repair.id === repairId
          ? { ...repair, aggregateVerification: aggregate }
          : repair));
        emit();
      }
      return aggregate;
    },

    async loadCandidateReview(auditId, repairId) {
      if (typeof auditId !== "string" || !auditId || typeof repairId !== "string" || !repairId) {
        throw new AuditError("INVALID_INPUT", "auditId and repairId must be non-empty strings.");
      }
      const expectedGeneration = generation;
      const repair = assertAuditScopedResponse(
        await transport.getCandidateReview(auditId, repairId),
        auditId,
        repairId,
      );
      assertMissionCheckpointIdentity(repair, auditId, true);
      if (await reconcileAdvancedDirectRead(auditId, repair, expectedGeneration)) return repair;
      return rememberRepair(repair, expectedGeneration);
    },

    async openCandidateReview(
      auditId,
      repairId,
      candidateOrigin,
      source = "agent",
      expectedMissionRevision,
    ) {
      if (
        typeof auditId !== "string"
        || !auditId
        || typeof repairId !== "string"
        || !repairId
        || typeof candidateOrigin !== "string"
        || !candidateOrigin.trim()
      ) {
        throw new AuditError("INVALID_INPUT", "auditId, repairId, and candidateOrigin must be non-empty strings.");
      }
      const expectedGeneration = generation;
      return rememberRepair(
        assertAuditScopedResponse(
          await transport.openCandidateReview(
            auditId,
            repairId,
            candidateOrigin,
            source,
            revisionFor(auditId, expectedMissionRevision),
          ),
          auditId,
          repairId,
        ),
        expectedGeneration,
      );
    },

    async recordCandidateReviewCheck(
      auditId,
      repairId,
      reviewId,
      input,
      source = "agent",
      expectedMissionRevision,
    ) {
      if (
        typeof auditId !== "string"
        || !auditId
        || typeof repairId !== "string"
        || !repairId
        || typeof reviewId !== "string"
        || !reviewId
        || typeof input?.checkId !== "string"
        || !input.checkId
      ) {
        throw new AuditError("INVALID_INPUT", "auditId, repairId, reviewId, and checkId must be non-empty strings.");
      }
      const expectedGeneration = generation;
      const repair = assertAuditScopedResponse(
        await transport.recordCandidateReviewCheck(
          auditId,
          repairId,
          reviewId,
          input,
          source,
          revisionFor(auditId, expectedMissionRevision),
        ),
        auditId,
        repairId,
      );
      if (
        repair.candidateReview?.id !== reviewId
        || !(repair.candidateReview.results ?? []).some((result) => result?.checkId === input.checkId)
      ) {
        throw new AuditError(
          "AUDIT_RESPONSE_MISMATCH",
          "The audit service returned a different candidate review continuation.",
        );
      }
      return rememberRepair(repair, expectedGeneration);
    },

    async listDiagnosticMissions(auditId) {
      if (typeof auditId !== "string" || !auditId) {
        throw new AuditError("INVALID_INPUT", "auditId must be a non-empty string.");
      }
      const expectedGeneration = generation;
      const workspace = assertResponseIdentity(
        await transport.listDiagnosticMissions(auditId),
        "auditId",
        auditId,
      );
      assertResponseListIdentity(workspace.missions, "auditId", auditId);
      assertMissionCheckpointIdentity(workspace, auditId, true);
      if (await reconcileAdvancedDirectRead(auditId, workspace, expectedGeneration)) {
        return workspace;
      }
      if (expectedGeneration === generation) {
        retainCheckpoint(auditId, workspace.missionCheckpoint, expectedGeneration);
        diagnosticMissions.set(auditId, workspace.missions ?? []);
        emit();
      }
      return workspace;
    },

    async openDiagnosticMission(auditId, findingId, expectedMissionRevision) {
      if (
        typeof auditId !== "string"
        || !auditId
        || typeof findingId !== "string"
        || !findingId
        || findingId.length > 160
      ) {
        throw new AuditError("INVALID_INPUT", "auditId must be non-empty and findingId must contain 1 to 160 characters.");
      }
      const expectedGeneration = generation;
      const mission = assertAuditScopedResponse(
        await transport.openDiagnosticMission(auditId, findingId, revisionFor(auditId, expectedMissionRevision)),
        auditId,
      );
      assertResponseIdentity(mission, "findingId", findingId);
      return rememberDiagnosticMission(
        mission,
        expectedGeneration,
      );
    },

    async loadBrowserReview(auditId) {
      if (typeof auditId !== "string" || !auditId) {
        throw new AuditError("INVALID_INPUT", "auditId must be a non-empty string.");
      }
      const expectedGeneration = generation;
      const workspace = assertResponseIdentity(
        await transport.getBrowserReview(auditId),
        "auditId",
        auditId,
      );
      assertMissionCheckpointIdentity(workspace, auditId, true);
      if (workspace.review) {
        assertResponseIdentity(workspace.review, "auditId", auditId);
        assertMissionCheckpointIdentity(workspace.review, auditId);
      }
      if (await reconcileAdvancedDirectRead(auditId, workspace, expectedGeneration)) {
        return workspace;
      }
      if (expectedGeneration !== generation) return workspace;
      retainCheckpoint(auditId, workspace.missionCheckpoint, expectedGeneration);
      if (workspace.review) {
        const storedReview = { ...workspace.review };
        delete storedReview.missionCheckpoint;
        browserReviews.set(auditId, storedReview);
      } else {
        browserReviews.delete(auditId);
      }
      emit();
      return workspace;
    },

    async openBrowserReview(auditId, options = {}, expectedMissionRevision) {
      if (typeof auditId !== "string" || !auditId) {
        throw new AuditError("INVALID_INPUT", "auditId must be a non-empty string.");
      }
      const input = Number.isInteger(options) ? {} : options ?? {};
      const explicitRevision = Number.isInteger(options) ? options : expectedMissionRevision;
      const source = input.source === "person" ? "person" : "agent";
      const focusAreas = input.focusAreas;
      if (focusAreas !== undefined) {
        const retainedFocusAreas = Array.isArray(focusAreas)
          ? focusAreas.filter((area) => area === "accessibility" || area === "seo")
          : [];
        if (
          retainedFocusAreas.length < 1
          || retainedFocusAreas.length > 2
          || new Set(retainedFocusAreas).size !== retainedFocusAreas.length
          || retainedFocusAreas.length !== focusAreas.length
        ) {
          throw new AuditError(
            "INVALID_INPUT",
            "focusAreas must contain one or two unique accessibility or SEO values.",
          );
        }
      }
      const expectedGeneration = generation;
      const review = assertAuditScopedResponse(
        await transport.openBrowserReview(
          auditId,
          { source, ...(focusAreas === undefined ? {} : { focusAreas }) },
          revisionFor(auditId, explicitRevision),
        ),
        auditId,
      );
      if (focusAreas !== undefined) {
        assertResponseStringSet(review, "requestedFocusAreas", focusAreas);
      }
      return rememberBrowserReview(
        review,
        expectedGeneration,
      );
    },

    async recordBrowserReviewCheck(auditId, reviewId, input, source = "agent", expectedMissionRevision) {
      if (
        typeof auditId !== "string"
        || !auditId
        || typeof reviewId !== "string"
        || !reviewId
        || typeof input?.checkId !== "string"
        || !input.checkId
      ) {
        throw new AuditError("INVALID_INPUT", "auditId, reviewId, and checkId must be non-empty strings.");
      }
      const expectedGeneration = generation;
      const responseReview = assertAuditScopedResponse(
        await transport.recordBrowserReviewCheck(
          auditId,
          reviewId,
          input,
          source,
          revisionFor(auditId, expectedMissionRevision),
        ),
        auditId,
        reviewId,
      );
      if (!(responseReview.results ?? []).some((result) => result?.checkId === input.checkId)) {
        throw new AuditError(
          "AUDIT_RESPONSE_MISMATCH",
          "The audit service returned state for a different workspace or mission continuation. Retry the original audit address.",
        );
      }
      const routeContribution = responseReview?.purpose === "assessment"
        && (responseReview.results ?? []).some(
          (result) => result?.checkId === input.checkId && (result.observedRoutes?.length ?? 0) > 0,
        );
      if ((responseReview?.purpose === "verification" || routeContribution) && expectedGeneration === generation) {
        const result = assertMissionCheckpointIdentity(
          assertResponseIdentity(await transport.results(auditId), "auditId", auditId),
          auditId,
          true,
        );
        if (missionRevisionFrom(result) !== missionRevisionFrom(responseReview)) {
          throw new AuditError(
            "MISSION_REFRESH_UNSTABLE",
            "The browser evidence changed while Frontmend refreshed its result. Retry this read before acting.",
            true,
            { missionCheckpoint: result.missionCheckpoint },
          );
        }
        const report = { ...result };
        delete report.missionCheckpoint;
        retainBrowserReview(responseReview, expectedGeneration);
        const existing = jobs.get(auditId);
        if (existing) {
          remember({
            ...existing,
            status: "complete",
            progress: 100,
            report,
            missionRevision: result.missionCheckpoint.missionRevision,
            missionCheckpoint: result.missionCheckpoint,
          }, expectedGeneration);
        } else if (expectedGeneration === generation) {
          emit();
        }
        return responseReview;
      }
      return rememberBrowserReview(
        responseReview,
        expectedGeneration,
      );
    },

    async withdrawBrowserReview(auditId, reviewId, expectedMissionRevision) {
      if (typeof auditId !== "string" || !auditId || typeof reviewId !== "string" || !reviewId) {
        throw new AuditError("INVALID_INPUT", "auditId and reviewId must be non-empty strings.");
      }
      const expectedGeneration = generation;
      return rememberBrowserReview(
        assertAuditScopedResponse(
          await transport.withdrawBrowserReview(
            auditId,
            reviewId,
            revisionFor(auditId, expectedMissionRevision),
          ),
          auditId,
          reviewId,
        ),
        expectedGeneration,
      );
    },

    async submitDiagnosticEvidence(auditId, missionId, input, source = "agent", expectedMissionRevision) {
      if (typeof auditId !== "string" || !auditId || typeof missionId !== "string" || !missionId) {
        throw new AuditError("INVALID_INPUT", "auditId and missionId must be non-empty strings.");
      }
      const expectedGeneration = generation;
      return rememberDiagnosticMission(
        assertAuditScopedResponse(
          await transport.submitDiagnosticEvidence(
            auditId,
            missionId,
            input,
            source,
            revisionFor(auditId, expectedMissionRevision),
          ),
          auditId,
          missionId,
        ),
        expectedGeneration,
      );
    },

    async recordDiagnosticBlocker(auditId, missionId, input, source = "agent", expectedMissionRevision) {
      if (typeof auditId !== "string" || !auditId || typeof missionId !== "string" || !missionId) {
        throw new AuditError("INVALID_INPUT", "auditId and missionId must be non-empty strings.");
      }
      const expectedGeneration = generation;
      return rememberDiagnosticMission(
        assertAuditScopedResponse(
          await transport.recordDiagnosticBlocker(
            auditId,
            missionId,
            input,
            source,
            revisionFor(auditId, expectedMissionRevision),
          ),
          auditId,
          missionId,
        ),
        expectedGeneration,
      );
    },

    async stageRepair(auditId, input, expectedMissionRevision) {
      if (typeof auditId !== "string" || !auditId) throw new AuditError("INVALID_INPUT", "auditId must be non-empty.");
      const requestedFindingIds = normalizeRepairFindingIds(input?.findingId, input?.findingIds);
      const expectedGeneration = generation;
      const repair = assertAuditScopedResponse(
        await transport.stageRepair(auditId, input, revisionFor(auditId, expectedMissionRevision)),
        auditId,
      );
      assertResponseIdentity(repair, "findingId", input.findingId);
      if (JSON.stringify(repair.findingIds ?? [repair.findingId]) !== JSON.stringify(requestedFindingIds)) {
        throw new AuditError("AUDIT_RESPONSE_MISMATCH", "The staged repair returned a different frozen finding package.");
      }
      return rememberRepair(
        repair,
        expectedGeneration,
      );
    },

    async setRepairPolicy(auditId, mode, expectedMissionRevision) {
      if (typeof auditId !== "string" || !auditId) {
        throw new AuditError("INVALID_INPUT", "auditId must be a non-empty string.");
      }
      if (!["review", "auto-low-risk"].includes(mode)) {
        throw new AuditError("INVALID_INPUT", "mode must be review or auto-low-risk.");
      }
      const expectedGeneration = generation;
      const policy = await transport.setRepairPolicy(
        auditId,
        mode,
        revisionFor(auditId, expectedMissionRevision),
      );
      assertResponseIdentity(policy, "mode", mode);
      assertMissionCheckpointIdentity(policy, auditId, true);
      if (expectedGeneration === generation) {
        retainCheckpoint(auditId, policy.missionCheckpoint, expectedGeneration);
        const storedPolicy = { ...policy };
        delete storedPolicy.missionCheckpoint;
        repairPolicies.set(auditId, storedPolicy);
        emit();
      }
      return policy;
    },

    async approveRepair(auditId, repairId, expectedMissionRevision) {
      if (typeof auditId !== "string" || !auditId || typeof repairId !== "string" || !repairId) {
        throw new AuditError("INVALID_INPUT", "auditId and repairId must be non-empty strings.");
      }
      const expectedGeneration = generation;
      return rememberRepair(
        assertAuditScopedResponse(
          await transport.approveRepair(auditId, repairId, revisionFor(auditId, expectedMissionRevision)),
          auditId,
          repairId,
        ),
        expectedGeneration,
      );
    },

    async requestRepairChanges(auditId, repairId, feedback, expectedMissionRevision) {
      if (typeof auditId !== "string" || !auditId || typeof repairId !== "string" || !repairId) {
        throw new AuditError("INVALID_INPUT", "auditId and repairId must be non-empty strings.");
      }
      if (typeof feedback !== "string" || !feedback.trim() || feedback.length > 600) {
        throw new AuditError("INVALID_INPUT", "feedback must contain 1 to 600 characters.");
      }
      const expectedGeneration = generation;
      return rememberRepair(
        assertAuditScopedResponse(
          await transport.requestRepairChanges(
            auditId,
            repairId,
            feedback,
            revisionFor(auditId, expectedMissionRevision),
          ),
          auditId,
          repairId,
        ),
        expectedGeneration,
      );
    },

    async reviseRepair(auditId, repairId, input, expectedMissionRevision) {
      if (typeof auditId !== "string" || !auditId || typeof repairId !== "string" || !repairId) {
        throw new AuditError("INVALID_INPUT", "auditId and repairId must be non-empty strings.");
      }
      const expectedGeneration = generation;
      return rememberRepair(
        assertAuditScopedResponse(
          await transport.reviseRepair(auditId, repairId, input, revisionFor(auditId, expectedMissionRevision)),
          auditId,
          repairId,
        ),
        expectedGeneration,
      );
    },

    async recordImplementation(auditId, repairId, input, expectedMissionRevision) {
      if (typeof auditId !== "string" || !auditId || typeof repairId !== "string" || !repairId) {
        throw new AuditError("INVALID_INPUT", "auditId and repairId must be non-empty strings.");
      }
      const expectedGeneration = generation;
      return rememberRepair(
        assertAuditScopedResponse(
          await transport.recordImplementation(
            auditId,
            repairId,
            input,
            revisionFor(auditId, expectedMissionRevision),
          ),
          auditId,
          repairId,
        ),
        expectedGeneration,
      );
    },

    async attestDeployment(auditId, repairId, expectedMissionRevision) {
      if (typeof auditId !== "string" || !auditId || typeof repairId !== "string" || !repairId) {
        throw new AuditError("INVALID_INPUT", "auditId and repairId must be non-empty strings.");
      }
      const expectedGeneration = generation;
      return rememberRepair(
        assertAuditScopedResponse(
          await transport.attestDeployment(auditId, repairId, revisionFor(auditId, expectedMissionRevision)),
          auditId,
          repairId,
        ),
        expectedGeneration,
      );
    },

    async startVerification(auditId, repairId, expectedMissionRevision) {
      if (typeof auditId !== "string" || !auditId || typeof repairId !== "string" || !repairId) {
        throw new AuditError("INVALID_INPUT", "auditId and repairId must be non-empty strings.");
      }
      const expectedGeneration = generation;
      const audit = await transport.startVerification(
        auditId,
        repairId,
        revisionFor(auditId, expectedMissionRevision),
      );
      assertResponseIdentity(audit, "baselineAuditId", auditId);
      assertResponseIdentity(audit, "repairId", repairId);
      assertMissionCheckpointIdentity(audit, auditId, true);
      if (
        typeof audit.id !== "string"
        || !Array.isArray(audit.verificationAuditIds)
        || !audit.verificationAuditIds.includes(audit.id)
      ) {
        throw new AuditError(
          "AUDIT_RESPONSE_MISMATCH",
          "The audit service returned state for a different workspace. Retry the original audit address.",
        );
      }
      retainCheckpoint(auditId, audit.missionCheckpoint, expectedGeneration);
      const verificationAudit = { ...audit };
      delete verificationAudit.missionCheckpoint;
      remember(verificationAudit, expectedGeneration);
      return audit;
    },

    getRepairs(auditId) {
      return repairs.get(auditId) ?? [];
    },

    getDiagnosticMissions(auditId) {
      return diagnosticMissions.get(auditId) ?? [];
    },

    getBrowserReview(auditId) {
      return browserReviews.get(auditId) ?? null;
    },

    getRepairPolicy(auditId) {
      return repairPolicies.get(auditId) ?? {
        version: 1,
        mode: "review",
        grantedBy: null,
        enabledAt: null,
        remainingAutoApprovals: 0,
        riskCeiling: null,
        allowedPatchTypes: [],
        requiresRepositoryPlan: false,
        deploymentAttestation: "person-only",
      };
    },

    getRepairExportUrl(auditId, repairId) {
      return transport.repairExportUrl(auditId, repairId);
    },

    getVerificationReceiptUrl(auditId) {
      return transport.verificationReceiptUrl(auditId);
    },

    getRepairVerificationReceiptUrl(auditId, repairId) {
      return transport.repairVerificationReceiptUrl(auditId, repairId);
    },

    getAuditReportUrl(auditId) {
      return transport.auditReportUrl(auditId);
    },

    getAssessmentReceipt(auditId) {
      if (typeof auditId !== "string" || !auditId) {
        throw new AuditError("INVALID_INPUT", "auditId must be a non-empty string.");
      }
      const audit = jobs.get(auditId);
      return createAssessmentReceipt({
        report: audit?.report ?? null,
        mission: audit?.mission,
        diagnosticMissions: diagnosticMissions.get(auditId) ?? [],
        browserReview: browserReviews.get(auditId) ?? null,
        explorations: explorations.get(auditId) ?? [],
        repairs: repairs.get(auditId) ?? [],
        activities: (agentActivitiesByAudit.get(auditId) ?? []).filter(
          (activity) => activity.status === "succeeded" || activity.status === "failed",
        ),
      });
    },

    getAssessmentReceiptUrl(auditId) {
      return transport.assessmentReceiptUrl(auditId);
    },

    getSiteExplorations(auditId) {
      return explorations.get(auditId) ?? [];
    },

    getSiteExplorationReportUrl(auditId, missionId) {
      return transport.explorationReportUrl(auditId, missionId);
    },

    getActiveAudit() {
      return activeAuditId ? jobs.get(activeAuditId) ?? null : null;
    },

    getMissionCheckpoint(auditId) {
      if (typeof auditId !== "string" || !auditId) {
        throw new AuditError("INVALID_INPUT", "auditId must be a non-empty string.");
      }
      return checkpointFor(auditId);
    },

    getAgentCapabilities(auditId) {
      if (typeof auditId !== "string" || !auditId) {
        throw new AuditError("INVALID_INPUT", "auditId must be a non-empty string.");
      }
      const audit = jobs.get(auditId);
      return audit?.agentCapabilities ? agentCapabilitySnapshot(audit.agentCapabilities) : null;
    },

    setActiveEvidenceFinding(auditId, findingId) {
      if (typeof auditId !== "string" || !auditId || typeof findingId !== "string" || !findingId) {
        throw new AuditError("INVALID_INPUT", "auditId and findingId must be non-empty strings.");
      }
      const audit = jobs.get(auditId);
      const state = audit?.mission ? deriveAuditMissionState({
        report: audit.report,
        mission: audit.mission,
        diagnosticMissions: diagnosticMissions.get(auditId) ?? [],
        repairs: repairs.get(auditId) ?? [],
        browserReview: browserReviews.get(auditId) ?? null,
        explorations: explorations.get(auditId) ?? [],
      }) : null;
      if (!state?.priorities?.some((priority) => priority.findingId === findingId)) {
        throw new AuditError("EVIDENCE_NOT_FOUND", "The selected finding is not a retained mission priority.");
      }
      activeEvidenceFindingByAudit.set(auditId, findingId);
      return findingId;
    },

    getActiveEvidenceCapsule(auditId = activeAuditId) {
      if (typeof auditId !== "string" || !auditId) {
        throw new AuditError("AUDIT_CONTEXT_REQUIRED", "Open a completed audit workspace before reading its active evidence capsule.");
      }
      const audit = jobs.get(auditId);
      if (!audit?.report || audit.status !== "complete") {
        throw new AuditError("AUDIT_NOT_READY", "Finish the audit before reading an evidence capsule.");
      }
      const missionState = audit.mission ? deriveAuditMissionState({
        report: audit.report,
        mission: audit.mission,
        diagnosticMissions: diagnosticMissions.get(auditId) ?? [],
        repairs: repairs.get(auditId) ?? [],
        browserReview: browserReviews.get(auditId) ?? null,
        explorations: explorations.get(auditId) ?? [],
      }) : null;
      const browserReview = browserReviews.get(auditId) ?? null;
      const selectedFindingId = activeEvidenceFindingByAudit.get(auditId);
      const retainedFindingId = missionState?.priorities?.some(
        (priority) => priority.findingId === selectedFindingId,
      )
        ? selectedFindingId
        : missionState?.priorities?.[0]?.findingId ?? null;
      if (retainedFindingId) activeEvidenceFindingByAudit.set(auditId, retainedFindingId);
      return createActiveEvidenceCapsule({
        audit,
        report: audit.report,
        missionState,
        findings: assessmentFindings(audit.report, browserReview),
        browserReview,
        findingId: retainedFindingId,
      });
    },

    getAuditMissionState(auditId) {
      const audit = jobs.get(auditId);
      if (!audit?.mission) return null;
      return deriveAuditMissionState({
        report: audit.report,
        mission: audit.mission,
        diagnosticMissions: diagnosticMissions.get(auditId) ?? [],
        repairs: repairs.get(auditId) ?? [],
        browserReview: browserReviews.get(auditId) ?? null,
        explorations: explorations.get(auditId) ?? [],
      });
    },

    getActiveAuditMissionState() {
      if (!activeAuditId) return null;
      const audit = jobs.get(activeAuditId);
      if (!audit?.mission) return null;
      return deriveAuditMissionState({
        report: audit.report,
        mission: audit.mission,
        diagnosticMissions: diagnosticMissions.get(activeAuditId) ?? [],
        repairs: repairs.get(activeAuditId) ?? [],
        browserReview: browserReviews.get(activeAuditId) ?? null,
        explorations: explorations.get(activeAuditId) ?? [],
      });
    },

    beginAgentActivity({ tool, auditId = null, missionRevisionBefore = null }) {
      activitySequence += 1;
      const semanticTool = String(tool ?? "").slice(0, 80);
      const semanticTitle = ACTIVITY_TOOL_TITLES[semanticTool];
      if (!semanticTitle) {
        throw new AuditError("INVALID_ACTIVITY_LEDGER", "Only current Frontmend semantic actions can enter the activity ledger.");
      }
      const currentAudit = typeof auditId === "string" && auditId
        ? jobs.get(auditId)
        : activeAuditId ? jobs.get(activeAuditId) : null;
      const retainedAuditId = typeof auditId === "string" && auditId
        ? auditId.slice(0, 80)
        : currentAudit?.id ?? null;
      const retainedRevision = Number.isInteger(missionRevisionBefore) && missionRevisionBefore >= 0
        ? missionRevisionBefore
        : currentAudit ? auditMissionRevision(currentAudit) : 0;
      const activity = {
        id: `activity-${globalThis.crypto?.randomUUID?.() ?? `${now()}-${activitySequence}`}`,
        tool: semanticTool,
        title: semanticTitle,
        status: "running",
        actorClass: "webmcp-agent",
        auditId: retainedAuditId,
        repairId: null,
        diagnosticMissionId: null,
        browserReviewId: null,
        explorationId: null,
        errorCode: null,
        missionRevisionBefore: retainedRevision,
        missionRevisionAfter: retainedRevision,
        startedAt: now(),
        completedAt: null,
      };
      if (retainedAuditId) {
        agentActivitiesByAudit.set(
          retainedAuditId,
          [activity, ...(agentActivitiesByAudit.get(retainedAuditId) ?? [])].slice(0, 20),
        );
      } else {
        pendingAgentActivities = [activity, ...pendingAgentActivities].slice(0, 20);
      }
      emit();
      return activity.id;
    },

    async finishAgentActivity(activityId, result) {
      const status = result?.status === "failed" ? "failed" : "succeeded";
      let retained = pendingAgentActivities.find((activity) => activity.id === activityId) ?? null;
      pendingAgentActivities = pendingAgentActivities.filter((activity) => activity.id !== activityId);
      for (const [auditId, activities] of agentActivitiesByAudit) {
        const candidate = activities.find((activity) => activity.id === activityId);
        if (candidate) retained = candidate;
        agentActivitiesByAudit.set(auditId, activities.filter((activity) => activity.id !== activityId));
      }
      if (!retained) return;
      const auditId = typeof result?.auditId === "string" && result.auditId
        ? result.auditId.slice(0, 80)
        : retained.auditId;
      const currentAudit = auditId ? jobs.get(auditId) : null;
      const missionRevisionAfter = Number.isInteger(result?.missionRevisionAfter)
        ? result.missionRevisionAfter
        : currentAudit ? auditMissionRevision(currentAudit) : retained.missionRevisionBefore;
      if (!auditId) {
        pendingAgentActivities = [{
          ...retained,
          status,
          errorCode: typeof result?.errorCode === "string" ? result.errorCode.slice(0, 80) : null,
          missionRevisionAfter,
          completedAt: now(),
        }, ...pendingAgentActivities].slice(0, 20);
        emit();
        return;
      }
      const activity = createActivityLedgerRecord({
        ...retained,
        status,
        auditId,
        repairId: typeof result?.repairId === "string" ? result.repairId.slice(0, 80) : null,
        diagnosticMissionId: typeof result?.diagnosticMissionId === "string"
          ? result.diagnosticMissionId.slice(0, 160)
          : null,
        browserReviewId: typeof result?.browserReviewId === "string"
          ? result.browserReviewId.slice(0, 160)
          : null,
        explorationId: typeof result?.explorationId === "string"
          ? result.explorationId.slice(0, 160)
          : null,
        errorCode: typeof result?.errorCode === "string" ? result.errorCode.slice(0, 80) : null,
        missionRevisionAfter: Math.max(retained.missionRevisionBefore, missionRevisionAfter),
        completedAt: now(),
      }, auditId);
      agentActivitiesByAudit.set(
        auditId,
        mergeActivityLedger(agentActivitiesByAudit.get(auditId), activity, auditId),
      );
      emit();
      if (typeof transport.recordActivity !== "function") return;
      try {
        const workspace = assertResponseIdentity(
          await transport.recordActivity(auditId, activity),
          "auditId",
          auditId,
        );
        agentActivitiesByAudit.set(
          auditId,
          activityLedgerSnapshot(workspace.activities, auditId),
        );
        emit();
      } catch {
        // A telemetry write never changes or masks the semantic tool outcome.
      }
    },

    getAgentActivities(auditId = activeAuditId) {
      const retained = typeof auditId === "string" && auditId
        ? agentActivitiesByAudit.get(auditId) ?? []
        : [];
      return [...pendingAgentActivities, ...retained]
        .sort((left, right) => right.startedAt - left.startedAt)
        .slice(0, 20)
        .map((activity) => ({ ...activity }));
    },

    reset() {
      generation += 1;
      activeAuditId = null;
      repairs.clear();
      diagnosticMissions.clear();
      browserReviews.clear();
      repairPolicies.clear();
      explorations.clear();
      activeEvidenceFindingByAudit.clear();
      agentActivitiesByAudit.clear();
      pendingAgentActivities = [];
      emit();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const auditService = createAuditService();
