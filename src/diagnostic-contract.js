import { AuditError } from "./url-policy.js";

const DIAGNOSTIC_KINDS = Object.freeze([
  "console-errors",
  "contrast-nodes",
  "main-thread-blocking",
  "browser-observation",
  "evidence-conflict",
]);
const OBSERVATION_KINDS = Object.freeze([
  "console",
  "network",
  "interaction",
  "performance",
  "accessibility",
]);
const CONFIDENCE_LEVELS = Object.freeze(["low", "medium", "high"]);
export const DIAGNOSTIC_BLOCKER_REASONS = Object.freeze([
  "browser-unavailable",
  "repository-unavailable",
  "not-reproduced",
  "wrong-repository",
  "conflicting-runtime",
]);
const MAX_DIAGNOSTIC_REVISIONS = 5;

function boundedString(value, field, maximum) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new AuditError(
      "INVALID_DIAGNOSTIC_EVIDENCE",
      `${field} must contain 1 to ${maximum} characters.`,
    );
  }
  return value.replace(/\r\n/g, "\n").trim();
}

function boundedUniqueList(value, field, maximum, normalize) {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum) {
    throw new AuditError(
      "INVALID_DIAGNOSTIC_EVIDENCE",
      `${field} must contain between 1 and ${maximum} items.`,
    );
  }
  const result = value.map(normalize);
  if (new Set(result.map((item) => JSON.stringify(item))).size !== result.length) {
    throw new AuditError("INVALID_DIAGNOSTIC_EVIDENCE", `${field} must not contain duplicates.`);
  }
  return result;
}

function repositoryRelativePath(value) {
  const path = boundedString(value, "file", 200).replace(/\\/g, "/");
  const segments = path.split("/");
  if (
    path.startsWith("/") ||
    /^[a-z]:\//i.test(path) ||
    path.includes(":") ||
    segments.some((segment) => !segment || segment === "." || segment === "..") ||
    /[\u0000-\u001f\u007f]/.test(path)
  ) {
    throw new AuditError(
      "INVALID_DIAGNOSTIC_EVIDENCE",
      "files must contain repository-relative paths without parent traversal.",
    );
  }
  return path;
}

function finiteLine(value) {
  if (value == null) return null;
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 10_000_000) {
    throw new AuditError(
      "INVALID_DIAGNOSTIC_EVIDENCE",
      "line must be an integer between 1 and 10000000.",
    );
  }
  return numeric;
}

function diagnosticKind(finding) {
  const kind = finding?.diagnosticEvidence?.kind;
  return DIAGNOSTIC_KINDS.includes(kind) ? kind : null;
}

export function findingRequiresDiagnosticMission(finding) {
  return Boolean(diagnosticKind(finding));
}

function requiredInvestigations(kind) {
  const byKind = {
    "console-errors": [
      "Reproduce the exact console or network failure",
      "Map the runtime source to repository ownership",
      "Name checks that will prove the repair locally",
    ],
    "contrast-nodes": [
      "Inspect the measured node and its interactive states",
      "Map the component or design token to repository ownership",
      "Name checks for contrast, focus, hover, and disabled states",
    ],
    "main-thread-blocking": [
      "Profile the measured load and identify the responsible long task",
      "Map the bundled runtime source to repository ownership",
      "Name checks for the local build and fresh performance measurement",
    ],
    "browser-observation": [
      "Reconfirm the contributed browser observation on the retained target",
      "Map the rendered element or journey to repository ownership",
      "Name local and fresh-browser checks that will prove the repair",
    ],
    "evidence-conflict": [
      "Reproduce the exact provider and browser disagreement",
      "Map the affected rule or element to repository ownership",
      "Name fresh provider and browser checks that can resolve the conflict",
    ],
  };
  return byKind[kind] ?? [];
}

function measuredEvidenceSummary(finding, kindOverride = null) {
  const evidence = finding?.diagnosticEvidence;
  const kind = kindOverride ?? diagnosticKind(finding);
  const itemCount = evidence?.kind === "console-errors"
    ? evidence.entries?.length ?? 0
    : evidence?.kind === "contrast-nodes"
      ? evidence.nodes?.length ?? 0
      : evidence?.kind === "main-thread-blocking"
        ? evidence.longTasks?.length ?? 0
        : evidence?.kind === "browser-observation"
          ? evidence.items?.length ?? 0
        : kind === "evidence-conflict" ? 1 : 0;
  return {
    kind,
    provenance: evidence?.kind === "browser-observation"
      ? ["agent-reported-browser", "person-reported-browser", "mixed-attributed-browser"].includes(evidence.provenance)
        ? evidence.provenance
        : "agent-reported-browser"
      : "measured-lighthouse",
    completeness: evidence?.completeness === "actionable" ? "actionable" : "partial",
    itemCount: Math.max(0, Math.min(5, itemCount)),
    missing: Array.isArray(evidence?.missing)
      ? evidence.missing.slice(0, 5).map((item) => String(item).slice(0, 100))
      : [],
    caveat: typeof evidence?.caveat === "string" ? evidence.caveat.slice(0, 360) : "",
  };
}

function diagnosisSnapshot(diagnosis) {
  if (!diagnosis) return null;
  return {
    revision: diagnosis.revision,
    source: diagnosis.source,
    sourceChangedByFrontmend: false,
    summary: diagnosis.summary,
    reproduction: diagnosis.reproduction,
    observations: diagnosis.observations.map((item) => ({ ...item })),
    sourceLocations: diagnosis.sourceLocations.map((item) => ({ ...item })),
    verificationChecks: [...diagnosis.verificationChecks],
    confidence: diagnosis.confidence,
    reportedAt: diagnosis.reportedAt,
    agentReported: diagnosis.agentReported,
  };
}

function blockerSnapshot(blocker) {
  if (!blocker) return null;
  return {
    revision: blocker.revision,
    reason: blocker.reason,
    summary: blocker.summary,
    source: blocker.source,
    sourceChangedByFrontmend: false,
    reportedAt: blocker.reportedAt,
    agentReported: blocker.agentReported,
  };
}

export function diagnosticEvidenceChain(mission) {
  const diagnosis = mission?.diagnosis ?? null;
  const blocker = blockerSnapshot(mission?.blocker);
  const contributedBy = diagnosis
    ? diagnosis.agentReported
      ? "agent-reported"
      : "person-reported"
    : null;
  const stages = [
    {
      id: "measurement",
      label: "Measured symptom",
      state: "retained",
      provenance: mission?.measuredEvidence?.provenance ?? "measured-provider",
      itemCount: Math.max(0, Math.min(5, mission?.measuredEvidence?.itemCount ?? 0)),
    },
    {
      id: "browser",
      label: "Browser reproduction",
      state: diagnosis?.observations?.length ? "contributed" : "required",
      provenance: diagnosis?.observations?.length ? contributedBy : null,
      itemCount: Math.max(0, Math.min(5, diagnosis?.observations?.length ?? 0)),
    },
    {
      id: "repository",
      label: "Repository ownership",
      state: diagnosis?.sourceLocations?.length ? "contributed" : "required",
      provenance: diagnosis?.sourceLocations?.length ? contributedBy : null,
      itemCount: Math.max(0, Math.min(8, diagnosis?.sourceLocations?.length ?? 0)),
    },
    {
      id: "verification",
      label: "Planned checks",
      state: diagnosis?.verificationChecks?.length ? "contributed" : "required",
      provenance: diagnosis?.verificationChecks?.length ? contributedBy : null,
      itemCount: Math.max(0, Math.min(8, diagnosis?.verificationChecks?.length ?? 0)),
    },
  ];
  return {
    schemaVersion: 1,
    status: blocker
      ? "blocked"
      : stages.slice(1).every((stage) => stage.state === "contributed")
        ? "ready-for-repair"
        : "awaiting-diagnosis",
    stages,
    blocker,
    authority: {
      repair: "separate-review-or-delegation",
      deployment: "site-owner",
      claim: "Contributed evidence does not approve, implement, deploy, or verify a repair.",
    },
  };
}

export function diagnosticMissionState(mission) {
  const diagnosis = mission?.diagnosis;
  const ready = Boolean(
    diagnosis?.summary &&
    diagnosis?.reproduction &&
    diagnosis?.observations?.length &&
    diagnosis?.sourceLocations?.length &&
    diagnosis?.verificationChecks?.length,
  );
  const blocked = !ready && Boolean(mission?.blocker);
  return {
    state: ready ? "ready-for-repair" : blocked ? "blocked" : "awaiting-diagnosis",
    measuredEvidence: mission?.measuredEvidence?.completeness === "actionable"
      ? "actionable"
      : "partial",
    diagnosisEvidence: ready
      ? diagnosis?.agentReported
        ? "agent-reported"
        : "person-reported"
      : blocked
        ? mission?.blocker?.agentReported
          ? "blocked-agent-reported"
          : "blocked-person-reported"
        : "none",
    nextActions: ready
      ? [{ id: "submit_repository_mission", actor: "person-or-agent" }]
      : blocked
        ? []
        : [{ id: "submit_runtime_diagnosis", actor: "person-or-agent" }],
    recoveryAction: blocked
      ? {
          id: "submit_runtime_diagnosis",
          actor: "person-or-agent",
          condition: "browser-and-repository-access-restored",
        }
      : null,
    repairAuthority: "separate-review-or-delegation",
    deploymentAuthority: "site-owner",
  };
}

export function diagnosticMissionSnapshot(mission) {
  const snapshot = {
    ...mission,
    diagnosis: diagnosisSnapshot(mission.diagnosis),
    history: (mission.history ?? []).slice(-MAX_DIAGNOSTIC_REVISIONS).map(diagnosisSnapshot),
    blocker: blockerSnapshot(mission.blocker),
    blockerHistory: (mission.blockerHistory ?? [])
      .slice(-MAX_DIAGNOSTIC_REVISIONS)
      .map(blockerSnapshot),
    state: diagnosticMissionState(mission),
  };
  return {
    ...snapshot,
    evidenceChain: diagnosticEvidenceChain(snapshot),
  };
}

export function createDiagnosticMission({ auditId, finding, relationship = null, now = Date.now() }) {
  const kind = diagnosticKind(finding)
    ?? (relationship === "provider-browser-conflict" ? "evidence-conflict" : null);
  if (!kind) {
    throw new AuditError(
      "DIAGNOSTIC_NOT_SUPPORTED",
      "This finding does not expose a structured diagnostic mission.",
    );
  }
  return diagnosticMissionSnapshot({
    id: crypto.randomUUID(),
    auditId,
    findingId: finding.id,
    findingTitle: String(finding.title ?? "Diagnostic finding").slice(0, 240),
    findingSource: {
      provider: String(finding.source?.provider ?? "Lighthouse").slice(0, 120),
      auditId: String(finding.source?.auditId ?? finding.id).slice(0, 160),
      strategy: String(finding.source?.strategy ?? "unknown").slice(0, 40),
    },
    measuredEvidence: measuredEvidenceSummary(finding, kind),
    requiredInvestigations: requiredInvestigations(kind),
    diagnosis: null,
    history: [],
    blocker: null,
    blockerHistory: [],
    createdAt: now,
    updatedAt: now,
  });
}

export function submitDiagnosticEvidence(mission, input = {}, source = "agent", now = Date.now()) {
  if (!mission?.id) {
    throw new AuditError("DIAGNOSTIC_NOT_FOUND", "That diagnostic mission does not exist.");
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new AuditError("INVALID_DIAGNOSTIC_EVIDENCE", "The diagnosis must be an object.");
  }
  const allowed = [
    "summary",
    "reproduction",
    "observations",
    "sourceLocations",
    "verificationChecks",
    "confidence",
  ];
  const extra = Object.keys(input).find((key) => !allowed.includes(key));
  if (extra) {
    throw new AuditError("INVALID_DIAGNOSTIC_EVIDENCE", `Unknown diagnosis field: ${extra}.`);
  }
  if (!CONFIDENCE_LEVELS.includes(input.confidence)) {
    throw new AuditError(
      "INVALID_DIAGNOSTIC_EVIDENCE",
      "confidence must be low, medium, or high.",
    );
  }
  const observations = boundedUniqueList(input.observations, "observations", 5, (item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new AuditError("INVALID_DIAGNOSTIC_EVIDENCE", "Each observation must be an object.");
    }
    const unknown = Object.keys(item).find((key) => !["kind", "detail"].includes(key));
    if (unknown || !OBSERVATION_KINDS.includes(item.kind)) {
      throw new AuditError(
        "INVALID_DIAGNOSTIC_EVIDENCE",
        "Each observation must contain only a supported kind and detail.",
      );
    }
    return { kind: item.kind, detail: boundedString(item.detail, "observation detail", 400) };
  });
  const sourceLocations = boundedUniqueList(input.sourceLocations, "sourceLocations", 8, (item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new AuditError("INVALID_DIAGNOSTIC_EVIDENCE", "Each source location must be an object.");
    }
    const unknown = Object.keys(item).find((key) => !["file", "line", "symbol", "reason"].includes(key));
    if (unknown) {
      throw new AuditError(
        "INVALID_DIAGNOSTIC_EVIDENCE",
        "Source locations accept only file, line, symbol, and reason.",
      );
    }
    return {
      file: repositoryRelativePath(item.file),
      line: finiteLine(item.line),
      symbol: item.symbol == null ? null : boundedString(item.symbol, "symbol", 120),
      reason: boundedString(item.reason, "source location reason", 300),
    };
  });
  const verificationChecks = boundedUniqueList(
    input.verificationChecks,
    "verificationChecks",
    8,
    (item) => boundedString(item, "verification check", 120),
  );
  const previous = diagnosisSnapshot(mission.diagnosis);
  const diagnosis = {
    revision: previous ? previous.revision + 1 : 1,
    source: source === "agent" ? "agent" : "person",
    sourceChangedByFrontmend: false,
    summary: boundedString(input.summary, "summary", 300),
    reproduction: boundedString(input.reproduction, "reproduction", 600),
    observations,
    sourceLocations,
    verificationChecks,
    confidence: input.confidence,
    reportedAt: now,
    agentReported: source === "agent",
  };
  return diagnosticMissionSnapshot({
    ...mission,
    diagnosis,
    history: previous
      ? [...(mission.history ?? []), previous].slice(-MAX_DIAGNOSTIC_REVISIONS)
      : (mission.history ?? []).slice(-MAX_DIAGNOSTIC_REVISIONS),
    blocker: null,
    blockerHistory: mission.blocker
      ? [...(mission.blockerHistory ?? []), blockerSnapshot(mission.blocker)].slice(-MAX_DIAGNOSTIC_REVISIONS)
      : (mission.blockerHistory ?? []).slice(-MAX_DIAGNOSTIC_REVISIONS),
    updatedAt: now,
  });
}

export function recordDiagnosticBlocker(mission, input = {}, source = "agent", now = Date.now()) {
  if (!mission?.id) {
    throw new AuditError("DIAGNOSTIC_NOT_FOUND", "That diagnostic mission does not exist.");
  }
  if (diagnosticMissionState(mission).state === "ready-for-repair") {
    throw new AuditError(
      "DIAGNOSTIC_ALREADY_COMPLETE",
      "This diagnostic mission already contains repair-ready evidence.",
    );
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new AuditError("INVALID_DIAGNOSTIC_BLOCKER", "The diagnostic blocker must be an object.");
  }
  const extra = Object.keys(input).find((key) => !["reason", "summary"].includes(key));
  if (extra) {
    throw new AuditError("INVALID_DIAGNOSTIC_BLOCKER", `Unknown diagnostic blocker field: ${extra}.`);
  }
  if (!DIAGNOSTIC_BLOCKER_REASONS.includes(input.reason)) {
    throw new AuditError(
      "INVALID_DIAGNOSTIC_BLOCKER",
      `reason must be one of: ${DIAGNOSTIC_BLOCKER_REASONS.join(", ")}.`,
    );
  }
  if (typeof input.summary !== "string" || !input.summary.trim() || input.summary.length > 300) {
    throw new AuditError(
      "INVALID_DIAGNOSTIC_BLOCKER",
      "summary must contain 1 to 300 characters.",
    );
  }
  const previous = blockerSnapshot(mission.blocker);
  const blocker = {
    revision: previous ? previous.revision + 1 : 1,
    reason: input.reason,
    summary: input.summary.replace(/\r\n/g, "\n").trim(),
    source: source === "agent" ? "agent" : "person",
    sourceChangedByFrontmend: false,
    reportedAt: now,
    agentReported: source === "agent",
  };
  return diagnosticMissionSnapshot({
    ...mission,
    blocker,
    blockerHistory: previous
      ? [...(mission.blockerHistory ?? []), previous].slice(-MAX_DIAGNOSTIC_REVISIONS)
      : (mission.blockerHistory ?? []).slice(-MAX_DIAGNOSTIC_REVISIONS),
    updatedAt: now,
  });
}

export function diagnosticMissionForRepair(mission) {
  if (diagnosticMissionState(mission).state !== "ready-for-repair") {
    throw new AuditError(
      "DIAGNOSTIC_MISSION_REQUIRED",
      "Complete the runtime and repository diagnosis before an agent submits this repair mission.",
    );
  }
  return {
    id: mission.id,
    findingId: mission.findingId,
    measuredEvidence: { ...mission.measuredEvidence },
    diagnosis: diagnosisSnapshot(mission.diagnosis),
    state: diagnosticMissionState(mission),
  };
}
