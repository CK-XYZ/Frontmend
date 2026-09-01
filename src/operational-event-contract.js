const ADMISSION_OUTCOMES = new Set(["allowed", "rejected"]);
const ADMISSION_REASONS = new Set(["none", "client-capacity", "global-capacity"]);
const PROVIDER_OUTCOMES = new Set(["complete", "partial", "failed"]);
const AUDIT_OUTCOMES = new Set(["complete", "failed", "cancelled"]);
const WORKLOADS = new Set(["root", "exploration-child", "verification-child"]);

function boundedText(value, maximum = 80, fallback = "unknown") {
  if (typeof value !== "string") return fallback;
  const text = value.replace(/\s+/g, " ").trim().slice(0, maximum);
  return text || fallback;
}

function boundedInteger(value, maximum = 1_000_000) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(maximum, Math.max(0, Math.round(numeric)));
}

function workload(value) {
  return WORKLOADS.has(value) ? value : "root";
}

export function createAdmissionOperationalEvent({
  outcome,
  reason = "none",
  batchSize = 1,
  newStarts = 0,
  reusedStarts = 0,
  clientWindowStarts = 0,
  globalWindowStarts = 0,
  clientCapacityRemaining = 0,
  globalCapacityRemaining = 0,
} = {}) {
  return {
    event: "frontmend.admission",
    schemaVersion: 1,
    outcome: ADMISSION_OUTCOMES.has(outcome) ? outcome : "rejected",
    reason: ADMISSION_REASONS.has(reason) ? reason : "none",
    batchSize: boundedInteger(batchSize, 3),
    newStarts: boundedInteger(newStarts, 3),
    reusedStarts: boundedInteger(reusedStarts, 3),
    clientWindowStarts: boundedInteger(clientWindowStarts, 5),
    globalWindowStarts: boundedInteger(globalWindowStarts, 60),
    clientCapacityRemaining: boundedInteger(clientCapacityRemaining, 5),
    globalCapacityRemaining: boundedInteger(globalCapacityRemaining, 60),
    queueMode: "direct-admission",
    queueDepth: 0,
  };
}

export function createProviderOperationalEvents(telemetry, value = "root") {
  if (!Array.isArray(telemetry?.providerRuns)) return [];
  return telemetry.providerRuns.slice(0, 4).map((provider) => ({
    event: "frontmend.provider",
    schemaVersion: 1,
    workload: workload(value),
    adapterId: boundedText(provider?.adapterId, 80),
    kind: boundedText(provider?.kind, 40),
    outcome: PROVIDER_OUTCOMES.has(provider?.outcome) ? provider.outcome : "failed",
    latencyMs: boundedInteger(provider?.latencyMs, 300_000),
    measuredConditionCount: boundedInteger(provider?.measuredConditionCount, 8),
    failureCode: provider?.failureCode ? boundedText(provider.failureCode, 80) : null,
    quotaLimited: provider?.quotaLimited === true,
  }));
}

export function createAuditOperationalEvent({
  outcome,
  workload: workloadValue = "root",
  latencyMs = 0,
  fallbackUsed = false,
  availableSourceCount = 0,
  failureCode = null,
} = {}) {
  return {
    event: "frontmend.audit",
    schemaVersion: 1,
    workload: workload(workloadValue),
    outcome: AUDIT_OUTCOMES.has(outcome) ? outcome : "failed",
    latencyMs: boundedInteger(latencyMs, 600_000),
    fallbackUsed: fallbackUsed === true,
    availableSourceCount: boundedInteger(availableSourceCount, 4),
    failureCode: failureCode ? boundedText(failureCode, 80) : null,
  };
}

/**
 * Production Workers use the version-metadata binding as the signal that logs
 * should be emitted. Tests and local diagnostics can inject OPERATIONAL_LOGGER.
 */
export function emitOperationalEvents(env, events) {
  const safeEvents = Array.isArray(events) ? events.filter(Boolean) : [];
  const injected = typeof env?.OPERATIONAL_LOGGER === "function"
    ? env.OPERATIONAL_LOGGER
    : null;
  const logger = injected ?? (env?.FRONTMEND_VERSION ? (event) => console.info(event) : null);
  if (!logger) return 0;
  for (const event of safeEvents) logger(event);
  return safeEvents.length;
}

export const operationalTelemetryBoundary = Object.freeze({
  storage: "Cloudflare Workers structured logs only",
  publicEndpoint: false,
  includes: [
    "aggregate admission outcomes and capacity",
    "provider outcome and latency",
    "fallback and quota indicators",
    "root or child audit outcome",
    "truthful direct-admission queue depth",
  ],
  excludes: [
    "target URLs",
    "client IPs or fingerprints",
    "URL hashes",
    "audit, mission, repair, and exploration IDs",
    "prompts, findings, patches, source contents, credentials, and secrets",
  ],
});
