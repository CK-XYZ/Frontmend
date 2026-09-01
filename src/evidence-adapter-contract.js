const STRATEGIES = Object.freeze(["mobile", "desktop"]);

/** @typedef {{ adapterId?: unknown, provider?: unknown, adapterContractVersion?: unknown, evidenceVersion?: unknown, lighthouseVersion?: unknown, ruleSetVersion?: unknown }} EvidenceEngine */
/** @typedef {{ id?: unknown }} EvidenceViewport */
/** @typedef {{ code?: unknown }} EvidenceFailure */
/** @typedef {{ engine?: EvidenceEngine, viewports?: EvidenceViewport[], viewportFailures?: EvidenceFailure[] }} EvidenceReport */
/** @typedef {{ code?: unknown }} EvidenceError */

/** @param {unknown} value @param {number} [maximum] */
function boundedText(value, maximum = 160) {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, maximum)
    : "";
}

/** @param {unknown} value */
function boundedVersion(value) {
  return boundedText(value, 80) || null;
}

/** @param {unknown[]} values */
function boundedCodes(values) {
  return [...new Set(values.map((value) => boundedText(value, 80)).filter(Boolean))].slice(0, 4);
}

/** @param {EvidenceReport | null | undefined} report @param {{ adapterId: string, provider: string }} fallback */
function adapterIdentity(report, fallback) {
  const engine = report?.engine ?? {};
  return {
    adapterId: boundedText(engine.adapterId, 80) || fallback.adapterId,
    provider: boundedText(engine.provider, 120) || fallback.provider,
    adapterContractVersion: Number.isInteger(engine.adapterContractVersion)
      ? engine.adapterContractVersion
      : 1,
    evidenceVersion: boundedVersion(engine.evidenceVersion),
    lighthouseVersion: boundedVersion(engine.lighthouseVersion),
    ruleSetVersion: Number.isInteger(engine.ruleSetVersion) ? engine.ruleSetVersion : null,
  };
}

/**
 * Projects provider-specific reports into a small, stable evidence-adapter receipt.
 * These records describe source availability and boundaries; they deliberately
 * avoid collapsing independent evidence into a confidence score.
 * @param {{ lighthouseReport?: EvidenceReport | null, documentReport?: EvidenceReport | null, lighthouseError?: EvidenceError | null, documentError?: EvidenceError | null }} [options]
 */
export function createEvidenceAdapterReceipts({
  lighthouseReport = null,
  documentReport = null,
  lighthouseError = null,
  documentError = null,
} = {}) {
  const measuredStrategies = STRATEGIES.filter((strategy) =>
    (lighthouseReport?.viewports ?? []).some((viewport) => viewport?.id === strategy),
  );
  const viewportFailures = lighthouseReport?.viewportFailures ?? [];
  const viewportStatus = measuredStrategies.length === STRATEGIES.length
    ? "complete"
    : measuredStrategies.length
      ? "partial"
      : "unavailable";
  const viewportIdentity = adapterIdentity(lighthouseReport, {
    adapterId: "google-pagespeed-lighthouse",
    provider: "PageSpeed Insights",
  });
  const documentIdentity = adapterIdentity(documentReport, {
    adapterId: "frontmend-live-document",
    provider: "Frontmend document audit",
  });

  return [
    {
      ...viewportIdentity,
      kind: "viewport-measurement",
      status: viewportStatus,
      expectedConditions: [...STRATEGIES],
      measuredConditions: measuredStrategies,
      failureCodes: boundedCodes([
        lighthouseError?.code,
        ...viewportFailures.map((failure) => failure?.code),
      ]),
      capabilities: ["lab-category-scores", "rule-outcomes", "viewport-screenshots"],
      claimBoundary:
        "Lab evidence for the measured emulated viewports only; it does not prove every rendered state, journey, or real-user outcome.",
    },
    {
      ...documentIdentity,
      kind: "document-inspection",
      status: documentReport ? "complete" : "unavailable",
      expectedConditions: ["document"],
      measuredConditions: documentReport ? ["document"] : [],
      failureCodes: boundedCodes([documentError?.code]),
      capabilities: ["html-rules", "response-headers", "metadata", "route-candidates"],
      claimBoundary:
        "Bounded fetched HTML and response-header evidence only; it does not prove runtime DOM changes, authenticated states, or every journey.",
    },
  ];
}

/** @param {unknown} value */
export function evidenceAdapterReceiptSnapshot(value) {
  if (!value || typeof value !== "object") return null;
  const record = /** @type {Record<string, unknown>} */ (value);
  return {
    adapterId: boundedText(record.adapterId, 80) || "unknown-adapter",
    provider: boundedText(record.provider, 120) || "Unknown provider",
    kind: boundedText(record.kind, 60) || "unknown",
    status: typeof record.status === "string" && ["complete", "partial", "unavailable"].includes(record.status)
      ? record.status
      : "unavailable",
    adapterContractVersion: Number.isInteger(record.adapterContractVersion)
      ? /** @type {number} */ (record.adapterContractVersion)
      : 1,
    evidenceVersion: boundedVersion(record.evidenceVersion),
    lighthouseVersion: boundedVersion(record.lighthouseVersion),
    ruleSetVersion: Number.isInteger(record.ruleSetVersion) ? /** @type {number} */ (record.ruleSetVersion) : null,
    measuredConditions: Array.isArray(record.measuredConditions)
      ? record.measuredConditions.slice(0, 4).map((item) => boundedText(item, 40)).filter(Boolean)
      : [],
    failureCodes: Array.isArray(record.failureCodes) ? boundedCodes(record.failureCodes) : [],
    claimBoundary: boundedText(record.claimBoundary, 360),
  };
}
