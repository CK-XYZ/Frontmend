const MAX_RECORDS = 8;

function bounded(value, maximum = 600) {
  return String(value ?? "").replace(/\r\n/g, "\n").trim().slice(0, maximum);
}

function sourceKey(provider, auditId) {
  return `${bounded(provider, 120) || "unknown"}:${bounded(auditId, 160) || "unknown"}`;
}

function providerFindingRecord(finding) {
  return {
    findingId: bounded(finding?.id, 160),
    title: bounded(finding?.title, 240),
    severity: ["high", "medium", "low"].includes(finding?.severity) ? finding.severity : "low",
    category: bounded(finding?.category, 80),
    focusAreas: Array.isArray(finding?.focusAreas) ? finding.focusAreas.slice(0, 5).map((item) => bounded(item, 40)) : [],
    strategy: bounded(finding?.source?.strategy ?? "document", 40),
    selector: finding?.selector ? bounded(finding.selector, 200) : null,
    evidence: bounded(finding?.evidence, 600),
    suggestedRepair: bounded(finding?.repair, 600),
    source: {
      provider: bounded(finding?.source?.provider ?? "unknown", 120),
      auditId: bounded(finding?.source?.auditId ?? finding?.id, 160),
      strategy: bounded(finding?.source?.strategy ?? "document", 40),
    },
    ...(finding?.route ? {
      route: {
        auditId: bounded(finding.route.auditId, 160),
        path: bounded(finding.route.path, 256),
        explorationId: bounded(finding.route.explorationId, 160),
      },
    } : {}),
    diagnosticKind: finding?.diagnosticEvidence?.kind ?? null,
  };
}

function browserResultRecord(result, task) {
  if (!result) return null;
  return {
    taskId: bounded(result.checkId ?? task?.id, 80),
    taskKind: bounded(task?.kind ?? "coverage-gap", 40),
    outcome: ["passed", "issue", "blocked"].includes(result.outcome) ? result.outcome : "blocked",
    summary: bounded(result.summary, 300),
    observations: Array.isArray(result.observations)
      ? result.observations.slice(0, 4).map((item) => bounded(item, 400))
      : [],
    findings: Array.isArray(result.findings)
      ? result.findings.slice(0, 3).map(providerFindingRecord)
      : [],
    reportedAt: Number.isFinite(result.reportedAt) ? result.reportedAt : null,
    provenance: result.source === "person" ? "person-reported-browser" : "agent-reported-browser",
    trigger: task?.trigger
      ? {
          provider: bounded(task.trigger.provider, 120),
          auditId: bounded(task.trigger.auditId, 160),
          findingId: task.trigger.findingId ? bounded(task.trigger.findingId, 160) : null,
          ruleId: task.trigger.ruleId ? bounded(task.trigger.ruleId, 120) : null,
          selector: task.trigger.selector ? bounded(task.trigger.selector, 200) : null,
        }
      : null,
  };
}

function repositoryRecord(mission) {
  if (!mission) return null;
  const state = mission?.state?.state
    ?? (mission?.diagnosis?.sourceLocations?.length && mission?.diagnosis?.verificationChecks?.length
      ? "ready-for-repair"
      : mission?.blocker ? "blocked" : "awaiting-diagnosis");
  return {
    missionId: bounded(mission.id, 160),
    state,
    provenance: mission?.diagnosis
      ? mission.diagnosis.agentReported ? "agent-reported-repository" : "person-reported-repository"
      : mission?.blocker ? "agent-reported-blocker" : null,
    summary: mission?.diagnosis?.summary ? bounded(mission.diagnosis.summary, 300) : null,
    sourceLocations: Array.isArray(mission?.diagnosis?.sourceLocations)
      ? mission.diagnosis.sourceLocations.slice(0, 8).map((item) => ({
          file: bounded(item?.file, 200),
          line: Number.isInteger(item?.line) ? item.line : null,
          symbol: item?.symbol ? bounded(item.symbol, 120) : null,
          reason: bounded(item?.reason, 300),
        }))
      : [],
    verificationChecks: Array.isArray(mission?.diagnosis?.verificationChecks)
      ? mission.diagnosis.verificationChecks.slice(0, 8).map((item) => bounded(item, 120))
      : [],
    blocker: mission?.blocker
      ? {
          reason: bounded(mission.blocker.reason, 80),
          summary: bounded(mission.blocker.summary, 300),
          reportedAt: Number.isFinite(mission.blocker.reportedAt) ? mission.blocker.reportedAt : null,
        }
      : null,
    reportedAt: Number.isFinite(mission?.diagnosis?.reportedAt) ? mission.diagnosis.reportedAt : null,
  };
}

function verificationRecord(report, repair, findingIds) {
  const reportVerification = findingIds.has(report?.verification?.findingId) ? report.verification : null;
  const run = repair?.verificationRun ?? null;
  const status = reportVerification?.status ?? run?.status ?? null;
  const normalStatus = ["resolved", "still-present", "inconclusive"].includes(status) ? status : null;
  if (normalStatus) {
    return {
      status: normalStatus,
      provenance: "fresh-verification",
      auditId: bounded(reportVerification?.proof?.current?.auditId ?? run?.auditId, 160) || null,
      completedAt: Number.isFinite(reportVerification?.completedAt ?? run?.completedAt)
        ? reportVerification?.completedAt ?? run?.completedAt
        : null,
      message: bounded(reportVerification?.message ?? run?.message, 500),
    };
  }
  const implementationRecorded = Boolean(repair?.implementationReceipt);
  const deploymentAttested = Number.isFinite(repair?.deploymentAttestedAt);
  const runStarted = Boolean(run);
  if (!implementationRecorded && !deploymentAttested && !runStarted) return null;
  return {
    status: "required",
    provenance: deploymentAttested ? "site-owner-attestation" : implementationRecorded
      ? "agent-reported-implementation" : "verification-operation",
    auditId: bounded(run?.auditId, 160) || null,
    completedAt: null,
    message: deploymentAttested
      ? "Deployment was attested, but fresh public verification has not resolved the retained scope."
      : implementationRecorded
        ? "Implementation evidence was recorded, but fresh public verification is still required."
        : "A verification operation exists, but it has not produced a final comparable result.",
  };
}

function relationshipFor({ provider, browser, repository, verification }) {
  if (verification?.status === "resolved") {
    return {
      relationship: "verified-resolved",
      reason: "Fresh verification resolved the retained evidence scope.",
      unresolvedRequirement: null,
      nextAction: null,
    };
  }
  if (verification?.status === "still-present") {
    return {
      relationship: "verified-still-present",
      reason: "Fresh verification found the retained symptom still present.",
      unresolvedRequirement: "The reviewed repair remains unresolved and needs another bounded diagnosis or revision before any new claim.",
      nextAction: null,
    };
  }
  if (verification?.status === "inconclusive") {
    return {
      relationship: "verification-inconclusive",
      reason: "Fresh verification could not produce complete comparable proof for the retained scope.",
      unresolvedRequirement: "Restore the missing or incomparable verification coverage before claiming resolution.",
      nextAction: null,
    };
  }
  if (verification?.status === "required") {
    return {
      relationship: "verification-required",
      reason: verification.message,
      unresolvedRequirement: "Run fresh public verification for the reviewed repair scope.",
      nextAction: { tool: "start_repair_verification", reason: "Fresh public evidence is required before a resolution claim." },
    };
  }
  if (repository?.state === "ready-for-repair") {
    return {
      relationship: "diagnosis-contributed",
      reason: "Bounded browser and repository evidence plus planned checks were contributed without replacing the original sources.",
      unresolvedRequirement: null,
      nextAction: null,
    };
  }
  const conflict = Boolean(provider && browser?.outcome === "passed");
  if (conflict) {
    return {
      relationship: "provider-browser-conflict",
      reason: "The evidence-led browser task passed while the retained provider rule failed; neither source overrides the other.",
      unresolvedRequirement: "Contribute a bounded repository diagnosis explaining the provider/browser disagreement and name fresh checks.",
      nextAction: { tool: repository ? "submit_runtime_diagnosis" : "open_diagnostic_mission", reason: "Resolve the retained provider/browser conflict without averaging the sources." },
    };
  }
  const diagnosisRequired = Boolean(provider?.findings?.some((finding) => finding.diagnosticKind));
  if (diagnosisRequired) {
    return {
      relationship: "diagnosis-required",
      reason: browser?.outcome === "issue"
        ? "Provider and browser evidence retain the symptom, but repository ownership and repair checks are still missing."
        : "The provider retained a diagnostic symptom that still needs bounded browser and repository evidence.",
      unresolvedRequirement: "Contribute browser reproduction, repository ownership, and planned verification checks.",
      nextAction: {
        tool: repository ? "submit_runtime_diagnosis" : "open_diagnostic_mission",
        reason: repository
          ? "Contribute the browser and repository diagnosis already requested for this measured symptom."
          : "This measured symptom needs browser reproduction and repository ownership before the assessment is complete.",
      },
    };
  }
  if (provider && browser?.outcome === "issue") {
    return {
      relationship: "browser-confirmed",
      reason: "A trigger-linked browser issue directly confirmed the retained provider symptom while preserving both sources.",
      unresolvedRequirement: null,
      nextAction: null,
    };
  }
  if (!provider && browser?.outcome === "issue") {
    return {
      relationship: "browser-only",
      reason: "The rendered issue came from a generic browser task and has no matching provider failure.",
      unresolvedRequirement: "Map the rendered symptom to repository ownership and name fresh checks before repair.",
      nextAction: { tool: repository ? "submit_runtime_diagnosis" : "open_diagnostic_mission", reason: "Browser-only evidence needs repository mapping before repair." },
    };
  }
  return {
    relationship: "provider-only",
    reason: "The retained provider failure has no trigger-linked browser outcome.",
    unresolvedRequirement: null,
    nextAction: null,
  };
}

function reconciliationRecord(group, { report, diagnosticMissions, repairs }) {
  const findingIds = new Set([
    ...(group.provider?.findings ?? []).map((finding) => finding.findingId),
    ...(group.browser?.findings ?? []).map((finding) => finding.findingId),
  ]);
  const diagnostic = diagnosticMissions.find((mission) => findingIds.has(mission?.findingId)) ?? null;
  const repair = repairs.find((item) =>
    (item?.findingIds ?? [item?.findingId]).some((findingId) => findingIds.has(findingId))) ?? null;
  const repository = repositoryRecord(diagnostic);
  const verification = verificationRecord(report, repair, findingIds);
  const relationship = relationshipFor({
    provider: group.provider,
    browser: group.browser,
    repository,
    verification,
  });
  const findingId = group.provider?.findings?.[0]?.findingId ?? group.browser?.findings?.[0]?.findingId;
  const nextAction = relationship.nextAction
    ? {
        ...relationship.nextAction,
        input: relationship.nextAction.tool === "submit_runtime_diagnosis"
          ? { missionId: repository?.missionId }
          : relationship.nextAction.tool === "open_diagnostic_mission"
            ? { findingId }
            : repair?.id ? { repairId: repair.id } : {},
      }
    : null;
  const provenance = [
    group.provider ? {
      kind: "provider",
      provenance: "measured-provider",
      sourceId: sourceKey(group.provider.provider, group.provider.ruleId),
      recordedAt: Number.isFinite(report?.completedAt) ? report.completedAt : null,
    } : null,
    group.browser ? {
      kind: "browser",
      provenance: group.browser.provenance,
      sourceId: group.browser.taskId,
      recordedAt: group.browser.reportedAt,
    } : null,
    repository ? {
      kind: "repository",
      provenance: repository.provenance ?? "not-contributed",
      sourceId: repository.missionId,
      recordedAt: repository.reportedAt,
    } : null,
    verification ? {
      kind: "verification",
      provenance: verification.provenance,
      sourceId: verification.auditId,
      recordedAt: verification.completedAt,
    } : null,
  ].filter(Boolean);
  return {
    key: group.key,
    findingId,
    relationship: relationship.relationship,
    relationshipReason: relationship.reason,
    unresolvedRequirement: relationship.unresolvedRequirement,
    nextAction,
    provenance,
    evidenceRecords: {
      provider: group.provider,
      browser: group.browser,
      repository,
      verification,
    },
  };
}

export function reconcileAssessmentEvidence({
  report,
  browserReview = null,
  diagnosticMissions = [],
  repairs = [],
} = {}) {
  const groups = new Map();
  for (const finding of Array.isArray(report?.findings) ? report.findings : []) {
    const record = providerFindingRecord(finding);
    const key = sourceKey(record.source.provider, record.source.auditId);
    const existing = groups.get(key) ?? {
      key,
      provider: {
        provenance: "measured-provider",
        provider: record.source.provider,
        ruleId: record.source.auditId,
        findings: [],
      },
      browser: null,
    };
    existing.provider.findings.push(record);
    groups.set(key, existing);
  }

  const tasks = Array.isArray(browserReview?.requestedChecks) ? browserReview.requestedChecks : [];
  for (const result of Array.isArray(browserReview?.results) ? browserReview.results : []) {
    const task = tasks.find((item) => item?.id === result?.checkId) ?? null;
    const trigger = result?.taskTrigger ?? task?.trigger ?? null;
    const triggerKey = trigger?.ruleId
      ? [...groups.keys()].find((key) => key.endsWith(`:${bounded(trigger.ruleId, 160)}`))
      : null;
    if (task?.kind === "provider-confirmation" && triggerKey && groups.has(triggerKey)) {
      groups.get(triggerKey).browser = browserResultRecord(result, task);
      continue;
    }
    if (result?.outcome !== "issue") continue;
    for (const finding of Array.isArray(result.findings) ? result.findings : []) {
      const record = providerFindingRecord(finding);
      const key = `browser:${record.findingId}`;
      groups.set(key, {
        key,
        provider: null,
        browser: {
          ...browserResultRecord({ ...result, findings: [finding] }, task),
          findings: [record],
        },
      });
    }
  }

  return [...groups.values()].slice(0, 40).map((group) => reconciliationRecord(group, {
    report,
    diagnosticMissions: Array.isArray(diagnosticMissions) ? diagnosticMissions.slice(0, 10) : [],
    repairs: Array.isArray(repairs) ? repairs.slice(0, 10) : [],
  }));
}

export const EVIDENCE_RELATIONSHIPS = Object.freeze([
  "verified-resolved",
  "verified-still-present",
  "verification-inconclusive",
  "verification-required",
  "provider-browser-conflict",
  "diagnosis-contributed",
  "diagnosis-required",
  "browser-confirmed",
  "browser-only",
  "provider-only",
]);
