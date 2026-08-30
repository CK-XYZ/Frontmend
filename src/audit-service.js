import { AuditError, normalizePublicUrl } from "./url-policy.js";
import { createAuditMission, deriveAuditMissionState } from "./audit-mission-contract.js";
import { createAssessmentReceipt } from "./assessment-receipt.js";
import { auditMissionRevision, createMissionCheckpoint } from "./mission-checkpoint-contract.js";

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

    async prepareRepair(auditId, findingId, source, expectedMissionRevision) {
      return responsePayload(
        await fetchImpl(
          `${baseUrl}/api/audits/${encodeURIComponent(auditId)}/mission/prepare-repair`,
          {
            method: "POST",
            headers: { accept: "application/json", "content-type": "application/json" },
            body: JSON.stringify({
              findingId,
              source: source === "agent" ? "agent" : "human",
              expectedMissionRevision,
            }),
          },
        ),
      );
    },

    async startExploration(auditId, paths, source, expectedMissionRevision) {
      return responsePayload(
        await fetchImpl(`${baseUrl}/api/audits/${encodeURIComponent(auditId)}/explorations`, {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify({ paths, source, expectedMissionRevision }),
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

    async verificationCandidates(auditId, findingId) {
      return responsePayload(
        await fetchImpl(
          `${baseUrl}/api/audits/${encodeURIComponent(auditId)}/verification-candidates?findingId=${encodeURIComponent(findingId)}`,
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
  const listeners = new Set();
  let agentActivities = [];
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

  const rememberCheckpoint = (auditId, checkpoint, expectedGeneration = generation) => {
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
      emit();
    }
    return checkpoint;
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
          })
        : null,
      diagnosticMissions: diagnosticMissions.get(auditId) ?? [],
      repairs: repairs.get(auditId) ?? [],
      browserReview: browserReviews.get(auditId) ?? null,
      explorations: explorations.get(auditId) ?? [],
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
    const retained = audit.mission || !previous?.mission
      ? audit
      : { ...audit, mission: previous.mission };
    jobs.set(audit.id, retained);
    activeAuditId = audit.id;
    emit();
    return retained;
  };

  const rememberRepair = (repair, expectedGeneration = generation) => {
    if (!repair?.id || expectedGeneration !== generation) return repair;
    rememberCheckpoint(repair.auditId, repair.missionCheckpoint, expectedGeneration);
    const storedRepair = { ...repair };
    delete storedRepair.missionCheckpoint;
    const current = repairs.get(repair.auditId) ?? [];
    repairs.set(repair.auditId, [...current.filter((item) => item.id !== repair.id), storedRepair]);
    emit();
    return repair;
  };

  const rememberDiagnosticMission = (mission, expectedGeneration = generation) => {
    if (!mission?.id || expectedGeneration !== generation) return mission;
    rememberCheckpoint(mission.auditId, mission.missionCheckpoint, expectedGeneration);
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

  const rememberBrowserReview = (review, expectedGeneration = generation) => {
    if (!review?.id || expectedGeneration !== generation) return review;
    rememberCheckpoint(review.auditId, review.missionCheckpoint, expectedGeneration);
    const storedReview = { ...review };
    delete storedReview.missionCheckpoint;
    browserReviews.set(review.auditId, storedReview);
    emit();
    return review;
  };

  const rememberExploration = (exploration, expectedGeneration = generation) => {
    if (!exploration?.id || expectedGeneration !== generation) return exploration;
    const rootAuditId = exploration.rootAuditId;
    if (rootAuditId) {
      rememberCheckpoint(rootAuditId, exploration.missionCheckpoint, expectedGeneration);
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
    return assertMissionCheckpointIdentity(value, auditId);
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
      const retained = auditResult.value.mission || !previous?.mission
        ? auditResult.value
        : { ...auditResult.value, mission: previous.mission };
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

  const restoreAuditWorkspace = async (auditId) => {
    const audit = await readAudit(auditId);
    if (audit?.status !== "complete") {
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
      );
      assertResponseIdentity(audit?.exploration, "parentAuditId", auditId);
      assertResponseIdentity(audit?.exploration, "observedPath", path);
      rememberCheckpoint(auditId, audit.missionCheckpoint, expectedGeneration);
      const childAudit = { ...audit };
      delete childAudit.missionCheckpoint;
      remember(childAudit, expectedGeneration);
      return audit;
    },

    async prepareRepair(auditId, findingId, source = "human", expectedMissionRevision) {
      if (typeof auditId !== "string" || !auditId) {
        throw new AuditError("INVALID_INPUT", "auditId must be a non-empty string.");
      }
      if (typeof findingId !== "string" || !findingId || findingId.length > 160) {
        throw new AuditError("INVALID_INPUT", "findingId must contain 1 to 160 characters.");
      }
      const expectedGeneration = generation;
      const result = assertMissionCheckpointIdentity(
        await transport.prepareRepair(
          auditId,
          findingId,
          source === "agent" ? "agent" : "human",
          revisionFor(auditId, expectedMissionRevision),
        ),
        auditId,
      );
      assertResponseIdentity(result?.mission?.repairPreparation, "findingId", findingId);
      if (result.audit) {
        assertResponseIdentity(result.audit, "id", auditId);
        assertResponseIdentity(result.audit?.mission?.repairPreparation, "findingId", findingId);
        if (result.audit.missionCheckpoint) {
          assertMissionCheckpointIdentity(result.audit, auditId);
        }
        remember(result.audit, expectedGeneration);
      }
      rememberCheckpoint(auditId, result.missionCheckpoint, expectedGeneration);
      return result;
    },

    async startSiteExploration(auditId, paths, source = "human", expectedMissionRevision) {
      if (typeof auditId !== "string" || !auditId) {
        throw new AuditError("INVALID_INPUT", "auditId must be a non-empty string.");
      }
      if (!Array.isArray(paths) || paths.length < 1 || paths.length > 3) {
        throw new AuditError("INVALID_INPUT", "Choose between 1 and 3 observed routes.");
      }
      const expectedGeneration = generation;
      const exploration = assertResponseIdentity(
        await transport.startExploration(
          auditId,
          paths,
          source === "agent" ? "agent" : "human",
          revisionFor(auditId, expectedMissionRevision),
        ),
        "rootAuditId",
        auditId,
      );
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
      if (expectedGeneration === generation) {
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
      const audit = assertResponseIdentity(
        await transport.cancel(auditId, revisionFor(auditId, expectedMissionRevision)),
        "id",
        auditId,
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
      );
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
      if (expectedGeneration === generation) {
        repairs.set(auditId, workspace.repairs ?? []);
        if (workspace.policy) repairPolicies.set(auditId, workspace.policy);
        emit();
      }
      return workspace;
    },

    async getVerificationCandidates(auditId, findingId) {
      if (typeof auditId !== "string" || !auditId || typeof findingId !== "string" || !findingId) {
        throw new AuditError("INVALID_INPUT", "auditId and findingId must be non-empty strings.");
      }
      const scope = assertResponseIdentity(
        await transport.verificationCandidates(auditId, findingId),
        "auditId",
        auditId,
      );
      assertResponseIdentity(scope, "findingId", findingId);
      assertMissionCheckpointIdentity(scope, auditId, true);
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
      if (expectedGeneration === generation) {
        const current = repairs.get(auditId) ?? [];
        repairs.set(auditId, current.map((repair) => repair.id === repairId
          ? { ...repair, aggregateVerification: aggregate }
          : repair));
        emit();
      }
      return aggregate;
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
      if (expectedGeneration === generation) {
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
        rememberBrowserReview(workspace.review, expectedGeneration);
      } else if (expectedGeneration === generation) {
        browserReviews.delete(auditId);
        emit();
      }
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
      const review = rememberBrowserReview(
        responseReview,
        expectedGeneration,
      );
      if (review?.purpose === "verification" && expectedGeneration === generation) {
        const result = assertMissionCheckpointIdentity(
          assertResponseIdentity(await transport.results(auditId), "auditId", auditId),
          auditId,
        );
        const report = { ...result };
        delete report.missionCheckpoint;
        rememberCheckpoint(auditId, result.missionCheckpoint, expectedGeneration);
        const existing = jobs.get(auditId);
        if (existing) {
          remember({ ...existing, status: "complete", progress: 100, report }, expectedGeneration);
        }
      }
      return review;
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
      if (
        typeof auditId !== "string"
        || !auditId
        || typeof input?.findingId !== "string"
        || !input.findingId
        || input.findingId.length > 160
      ) {
        throw new AuditError("INVALID_INPUT", "auditId must be non-empty and findingId must contain 1 to 160 characters.");
      }
      const expectedGeneration = generation;
      const repair = assertAuditScopedResponse(
        await transport.stageRepair(auditId, input, revisionFor(auditId, expectedMissionRevision)),
        auditId,
      );
      assertResponseIdentity(repair, "findingId", input.findingId);
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
      rememberCheckpoint(auditId, policy.missionCheckpoint, expectedGeneration);
      if (expectedGeneration === generation) {
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
      assertMissionCheckpointIdentity(audit, auditId);
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
      rememberCheckpoint(auditId, audit.missionCheckpoint, expectedGeneration);
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
        repairs: repairs.get(auditId) ?? [],
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

    getAuditMissionState(auditId) {
      const audit = jobs.get(auditId);
      if (!audit?.mission) return null;
      return deriveAuditMissionState({
        report: audit.report,
        mission: audit.mission,
        diagnosticMissions: diagnosticMissions.get(auditId) ?? [],
        repairs: repairs.get(auditId) ?? [],
        browserReview: browserReviews.get(auditId) ?? null,
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
      });
    },

    beginAgentActivity({ tool, title }) {
      activitySequence += 1;
      const activity = {
        id: `agent-${activitySequence}`,
        tool: String(tool ?? "unknown").slice(0, 80),
        title: String(title ?? tool ?? "Agent action").slice(0, 120),
        status: "running",
        auditId: null,
        repairId: null,
        errorCode: null,
        startedAt: now(),
        completedAt: null,
      };
      agentActivities = [activity, ...agentActivities].slice(0, 20);
      emit();
      return activity.id;
    },

    finishAgentActivity(activityId, result) {
      const status = result?.status === "failed" ? "failed" : "succeeded";
      agentActivities = agentActivities.map((activity) =>
        activity.id === activityId
          ? {
              ...activity,
              status,
              auditId: typeof result?.auditId === "string" ? result.auditId.slice(0, 80) : null,
              repairId: typeof result?.repairId === "string" ? result.repairId.slice(0, 80) : null,
              errorCode: typeof result?.errorCode === "string" ? result.errorCode.slice(0, 80) : null,
              completedAt: now(),
            }
          : activity,
      );
      emit();
    },

    getAgentActivities() {
      return agentActivities.map((activity) => ({ ...activity }));
    },

    clearAgentActivities() {
      agentActivities = [];
      emit();
    },

    reset() {
      generation += 1;
      activeAuditId = null;
      repairs.clear();
      diagnosticMissions.clear();
      browserReviews.clear();
      repairPolicies.clear();
      explorations.clear();
      emit();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const auditService = createAuditService();
