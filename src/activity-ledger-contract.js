import { AuditError } from "./url-policy.js";

export const ACTIVITY_LEDGER_LIMIT = 20;
export const ACTIVITY_ACTOR_CLASSES = Object.freeze(["person-ui", "webmcp-agent", "system"]);
const TERMINAL_STATUSES = Object.freeze(["succeeded", "failed"]);
const OPERATION_KINDS = Object.freeze(["read", "mutation"]);
export const ACTIVITY_TOOL_TITLES = Object.freeze({
  start_site_audit: "Start site audit",
  check_site_audit_progress: "Check site audit progress",
  cancel_site_audit: "Cancel site audit",
  get_mission_summary: "Get mission summary",
  declare_agent_capabilities: "Declare agent capabilities",
  get_site_audit_results: "Get site audit results",
  get_active_evidence_capsule: "Get active evidence capsule",
  get_evidence_chain: "Get one evidence chain",
  open_browser_review: "Open agent browser review",
  record_browser_review_check: "Record browser review check",
  get_assessment_receipt: "Get assessment receipt",
  get_repository_fix_brief: "Prepare repository fix brief",
  start_related_page_audit: "Audit an observed route",
  open_diagnostic_mission: "Open diagnostic mission",
  submit_runtime_diagnosis: "Submit runtime diagnosis",
  record_diagnostic_blocker: "Record diagnostic blocker",
  start_site_exploration: "Explore selected site routes",
  get_site_exploration: "Read site exploration",
  get_verification_receipt: "Get verification receipt",
  prepare_site_repair: "Prepare site repair",
  stage_site_repair: "Stage site repair",
  revise_site_repair: "Revise site repair",
  get_repair_workspace: "Get repair workspace",
  record_repository_implementation: "Record repository implementation",
  open_candidate_review: "Open candidate browser review",
  record_candidate_review_check: "Record candidate browser check",
  get_candidate_review: "Get candidate browser review",
  start_repair_verification: "Start repair verification",
});
const IDENTIFIER_FIELDS = Object.freeze([
  "auditId",
  "repairId",
  "diagnosticMissionId",
  "browserReviewId",
  "explorationId",
]);
const ALLOWED_FIELDS = new Set([
  "id",
  "tool",
  "title",
  "status",
  "actorClass",
  "operationKind",
  ...IDENTIFIER_FIELDS,
  "errorCode",
  "missionRevisionBefore",
  "missionRevisionAfter",
  "activeToolCountBefore",
  "activeToolCountAfter",
  "outputCharacters",
  "nextTool",
  "startedAt",
  "completedAt",
]);

function boundedString(value, field, maximum, nullable = false) {
  if (nullable && value == null) return null;
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new AuditError("INVALID_ACTIVITY_LEDGER", `${field} must contain 1 to ${maximum} characters.`);
  }
  return value.trim();
}

function revision(value, field) {
  if (!Number.isInteger(value) || value < 0) {
    throw new AuditError("INVALID_ACTIVITY_LEDGER", `${field} must be a non-negative integer.`);
  }
  return value;
}

function timestamp(value, field) {
  if (!Number.isFinite(value) || value < 0) {
    throw new AuditError("INVALID_ACTIVITY_LEDGER", `${field} must be a non-negative timestamp.`);
  }
  return Math.round(value);
}

function optionalCount(value, field, maximum) {
  if (value == null) return null;
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw new AuditError("INVALID_ACTIVITY_LEDGER", `${field} must be an integer between 0 and ${maximum}.`);
  }
  return value;
}

export function createActivityLedgerRecord(input, expectedAuditId = undefined) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new AuditError("INVALID_ACTIVITY_LEDGER", "The activity ledger record must be an object.");
  }
  const extra = Object.keys(input).find((field) => !ALLOWED_FIELDS.has(field));
  if (extra) throw new AuditError("INVALID_ACTIVITY_LEDGER", `Unknown activity ledger field: ${extra}.`);
  const auditId = boundedString(input.auditId, "auditId", 80);
  if (expectedAuditId !== undefined && auditId !== expectedAuditId) {
    throw new AuditError("AUDIT_RESPONSE_MISMATCH", "The activity record belongs to a different audit.");
  }
  if (!TERMINAL_STATUSES.includes(input.status)) {
    throw new AuditError("INVALID_ACTIVITY_LEDGER", "status must be succeeded or failed.");
  }
  if (!ACTIVITY_ACTOR_CLASSES.includes(input.actorClass)) {
    throw new AuditError("INVALID_ACTIVITY_LEDGER", "actorClass must be person-ui, webmcp-agent, or system.");
  }
  const operationKind = input.operationKind == null ? null : input.operationKind;
  if (operationKind !== null && !OPERATION_KINDS.includes(operationKind)) {
    throw new AuditError("INVALID_ACTIVITY_LEDGER", "operationKind must be read or mutation.");
  }
  const before = revision(input.missionRevisionBefore, "missionRevisionBefore");
  const after = revision(input.missionRevisionAfter, "missionRevisionAfter");
  if (after < before) {
    throw new AuditError("INVALID_ACTIVITY_LEDGER", "missionRevisionAfter cannot precede missionRevisionBefore.");
  }
  const startedAt = timestamp(input.startedAt, "startedAt");
  const completedAt = timestamp(input.completedAt, "completedAt");
  if (completedAt < startedAt) {
    throw new AuditError("INVALID_ACTIVITY_LEDGER", "completedAt cannot precede startedAt.");
  }
  const tool = boundedString(input.tool, "tool", 80);
  const title = ACTIVITY_TOOL_TITLES[tool];
  if (!title) {
    throw new AuditError("INVALID_ACTIVITY_LEDGER", "tool must name a current Frontmend semantic action.");
  }
  const nextTool = boundedString(input.nextTool, "nextTool", 80, true);
  if (nextTool && !ACTIVITY_TOOL_TITLES[nextTool]) {
    throw new AuditError("INVALID_ACTIVITY_LEDGER", "nextTool must name a current Frontmend semantic action.");
  }
  const record = {
    id: boundedString(input.id, "id", 120),
    tool,
    title,
    status: input.status,
    actorClass: input.actorClass,
    ...(Object.hasOwn(input, "operationKind") ? { operationKind } : {}),
    auditId,
    repairId: boundedString(input.repairId, "repairId", 80, true),
    diagnosticMissionId: boundedString(input.diagnosticMissionId, "diagnosticMissionId", 160, true),
    browserReviewId: boundedString(input.browserReviewId, "browserReviewId", 160, true),
    explorationId: boundedString(input.explorationId, "explorationId", 160, true),
    errorCode: boundedString(input.errorCode, "errorCode", 80, true),
    missionRevisionBefore: before,
    missionRevisionAfter: after,
    ...(Object.hasOwn(input, "activeToolCountBefore")
      ? { activeToolCountBefore: optionalCount(input.activeToolCountBefore, "activeToolCountBefore", 100) }
      : {}),
    ...(Object.hasOwn(input, "activeToolCountAfter")
      ? { activeToolCountAfter: optionalCount(input.activeToolCountAfter, "activeToolCountAfter", 100) }
      : {}),
    ...(Object.hasOwn(input, "outputCharacters")
      ? { outputCharacters: optionalCount(input.outputCharacters, "outputCharacters", 1_000_000) }
      : {}),
    ...(Object.hasOwn(input, "nextTool") ? { nextTool } : {}),
    startedAt,
    completedAt,
  };
  return record;
}

export function activityLedgerSnapshot(value, expectedAuditId = undefined) {
  if (!Array.isArray(value)) return [];
  const retained = [];
  const seen = new Set();
  for (const input of value) {
    const record = createActivityLedgerRecord(input, expectedAuditId);
    if (seen.has(record.id)) continue;
    seen.add(record.id);
    retained.push(record);
  }
  return retained
    .sort((left, right) => right.completedAt - left.completedAt || right.startedAt - left.startedAt)
    .slice(0, ACTIVITY_LEDGER_LIMIT);
}

export function mergeActivityLedger(value, input, expectedAuditId = undefined) {
  const record = createActivityLedgerRecord(input, expectedAuditId);
  return activityLedgerSnapshot([
    record,
    ...(Array.isArray(value) ? value.filter((item) => item?.id !== record.id) : []),
  ], expectedAuditId);
}

export const activityLedgerBoundary = Object.freeze({
  retention: "last-20-per-audit",
  included: [
    "semantic tool name and status",
    "mission revision before and after",
    "read or mutation class, contextual tool counts, and bounded output size",
    "next semantic tool when one is returned",
    "bounded audit and workflow identifiers",
    "error code, actor class, and timestamps",
  ],
  excluded: ["URLs", "prompts", "tool inputs", "patches", "source contents", "credentials", "secrets"],
});
