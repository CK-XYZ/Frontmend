import { AuditError } from "./url-policy.js";

export const AGENT_CAPABILITIES = Object.freeze([
  "visual-browser-access",
  "responsive-emulation",
  "runtime-diagnostics",
  "repository-access",
  "terminal-execution",
]);

export const AGENT_CAPABILITY_FIELDS = Object.freeze({
  "visual-browser-access": "visualBrowserAccess",
  "responsive-emulation": "responsiveEmulation",
  "runtime-diagnostics": "runtimeDiagnostics",
  "repository-access": "repositoryAccess",
  "terminal-execution": "terminalExecution",
});

export const AGENT_CAPABILITY_LABELS = Object.freeze({
  "visual-browser-access": "Visual browser access",
  "responsive-emulation": "Responsive emulation",
  "runtime-diagnostics": "Runtime diagnostics",
  "repository-access": "Repository access",
  "terminal-execution": "Terminal execution",
});

const TOOL_REQUIREMENTS = Object.freeze({
  open_browser_review: ["visual-browser-access"],
  record_browser_review_check: ["visual-browser-access"],
  open_candidate_review: ["visual-browser-access"],
  record_candidate_review_check: ["visual-browser-access"],
  open_diagnostic_mission: ["repository-access"],
  submit_runtime_diagnosis: ["visual-browser-access", "repository-access"],
  stage_site_repair: ["repository-access"],
  revise_site_repair: ["repository-access"],
  record_repository_implementation: ["repository-access", "terminal-execution"],
});

function inputObject(value, allowed, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AuditError("INVALID_AGENT_CAPABILITIES", `${label} must be an object.`);
  }
  const extra = Object.keys(value).find((field) => !allowed.includes(field));
  if (extra) {
    throw new AuditError("INVALID_AGENT_CAPABILITIES", `Unknown ${label} field: ${extra}.`);
  }
  return value;
}

function timestamp(value, field) {
  if (!Number.isFinite(value) || value < 0) {
    throw new AuditError("INVALID_AGENT_CAPABILITIES", `${field} must be a non-negative timestamp.`);
  }
  return Math.round(value);
}

function declarationRevision(value) {
  if (!Number.isInteger(value) || value < 1) {
    throw new AuditError("INVALID_AGENT_CAPABILITIES", "declarationRevision must be a positive integer.");
  }
  return value;
}

function capabilityValues(value) {
  const fields = Object.values(AGENT_CAPABILITY_FIELDS);
  const input = inputObject(value, fields, "capabilities");
  const missing = fields.find((field) => typeof input[field] !== "boolean");
  if (missing) {
    throw new AuditError(
      "INVALID_AGENT_CAPABILITIES",
      `capabilities.${missing} must explicitly be true or false.`,
    );
  }
  return Object.fromEntries(fields.map((field) => [field, input[field]]));
}

function capabilityIds(values, expected) {
  return AGENT_CAPABILITIES.filter(
    (capability) => values[AGENT_CAPABILITY_FIELDS[capability]] === expected,
  );
}

export function agentCapabilitySnapshot(value) {
  if (value == null) return null;
  const input = inputObject(
    value,
    [
      "schemaVersion",
      "provenance",
      "verificationStatus",
      "capabilities",
      "declaredCapabilities",
      "unavailableCapabilities",
      "declaredAt",
      "updatedAt",
      "declarationRevision",
    ],
    "agent capability declaration",
  );
  if (input.schemaVersion !== 1) {
    throw new AuditError("INVALID_AGENT_CAPABILITIES", "Unsupported agent capability schema version.");
  }
  const capabilities = capabilityValues(input.capabilities);
  const declaredAt = timestamp(input.declaredAt, "declaredAt");
  const updatedAt = timestamp(input.updatedAt, "updatedAt");
  if (updatedAt < declaredAt) {
    throw new AuditError("INVALID_AGENT_CAPABILITIES", "updatedAt cannot precede declaredAt.");
  }
  return {
    schemaVersion: 1,
    provenance: "agent-declared",
    verificationStatus: "not-verified",
    capabilities,
    declaredCapabilities: capabilityIds(capabilities, true),
    unavailableCapabilities: capabilityIds(capabilities, false),
    declaredAt,
    updatedAt,
    declarationRevision: declarationRevision(input.declarationRevision),
  };
}

function sameCapabilityValues(left, right) {
  return Object.values(AGENT_CAPABILITY_FIELDS).every((field) => left[field] === right[field]);
}

export function createAgentCapabilityDeclaration(value, previous = null, now = Date.now()) {
  const capabilities = capabilityValues(value);
  const retained = previous == null ? null : agentCapabilitySnapshot(previous);
  if (retained && sameCapabilityValues(retained.capabilities, capabilities)) return retained;
  const updatedAt = timestamp(now, "updatedAt");
  return agentCapabilitySnapshot({
    schemaVersion: 1,
    provenance: "agent-declared",
    verificationStatus: "not-verified",
    capabilities,
    declaredCapabilities: capabilityIds(capabilities, true),
    unavailableCapabilities: capabilityIds(capabilities, false),
    declaredAt: retained?.declaredAt ?? updatedAt,
    updatedAt,
    declarationRevision: (retained?.declarationRevision ?? 0) + 1,
  });
}

export function agentCapabilityRows(value) {
  const declaration = value == null ? null : agentCapabilitySnapshot(value);
  return AGENT_CAPABILITIES.map((id) => ({
    id,
    label: AGENT_CAPABILITY_LABELS[id],
    declared: declaration?.capabilities?.[AGENT_CAPABILITY_FIELDS[id]] === true,
  }));
}

export function requiredCapabilitiesForBrowserTask(task) {
  if (!task) return ["visual-browser-access"];
  const requirements = new Set(["visual-browser-access"]);
  const viewports = [
    task.viewport,
    task.target?.viewport,
    ...(Array.isArray(task.target?.affectedViewports) ? task.target.affectedViewports : []),
  ];
  if (viewports.includes("mobile") || viewports.includes("tablet")) {
    requirements.add("responsive-emulation");
  }
  if (
    task.focusArea === "reliability"
    || task.focusArea === "performance"
    || task.trigger?.ruleId === "errors-in-console"
    || task.trigger?.auditId === "errors-in-console"
  ) {
    requirements.add("runtime-diagnostics");
  }
  return AGENT_CAPABILITIES.filter((capability) => requirements.has(capability));
}

export function requiredAgentCapabilitiesForAction(action, {
  browserReview = null,
  candidateReview = null,
  diagnosticMissions = [],
} = {}) {
  if (!action?.tool) return [];
  const requirements = new Set(TOOL_REQUIREMENTS[action.tool] ?? []);
  if (action.tool === "record_browser_review_check") {
    const task = browserReview?.state?.nextCheck
      ?? browserReview?.requestedChecks?.find((item) => item.id === action.input?.checkId)
      ?? browserReview?.tasks?.find((item) => item.id === action.input?.checkId)
      ?? null;
    for (const capability of requiredCapabilitiesForBrowserTask(task)) requirements.add(capability);
  }
  if (action.tool === "record_candidate_review_check") {
    const task = candidateReview?.state?.nextCheck
      ?? candidateReview?.nextTask
      ?? candidateReview?.requestedChecks?.find((item) => item.id === action.input?.checkId)
      ?? candidateReview?.tasks?.find((item) => item.id === action.input?.checkId)
      ?? null;
    for (const capability of requiredCapabilitiesForBrowserTask(task)) requirements.add(capability);
  }
  if (action.tool === "submit_runtime_diagnosis") {
    const diagnostic = diagnosticMissions.find(
      (mission) => mission.id === action.input?.missionId || mission.findingId === action.input?.findingId,
    );
    if (["console-errors", "main-thread-blocking"].includes(diagnostic?.measuredEvidence?.kind)) {
      requirements.add("runtime-diagnostics");
    }
    if (["mobile", "tablet"].includes(diagnostic?.findingSource?.strategy)) {
      requirements.add("responsive-emulation");
    }
  }
  return AGENT_CAPABILITIES.filter((capability) => requirements.has(capability));
}

export function agentCapabilityMatch(declarationValue, requiredCapabilities = []) {
  const required = [...new Set(requiredCapabilities)].filter((item) => AGENT_CAPABILITIES.includes(item));
  const declaration = declarationValue == null ? null : agentCapabilitySnapshot(declarationValue);
  const missing = declaration
    ? required.filter((capability) => declaration.capabilities[AGENT_CAPABILITY_FIELDS[capability]] !== true)
    : [...required];
  return {
    declaration,
    requiredCapabilities: required,
    matchedCapabilities: required.filter((capability) => !missing.includes(capability)),
    missingCapabilities: missing,
    eligible: Boolean(declaration) && missing.length === 0,
  };
}

export function toolAllowedByAgentCapabilities(toolName, declarationValue, context = {}) {
  const required = requiredAgentCapabilitiesForAction({
    tool: toolName,
    input: context.input ?? {},
  }, context);
  if (!required.length) return true;
  return agentCapabilityMatch(declarationValue, required).eligible;
}
