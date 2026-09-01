const STRATEGIES = Object.freeze(["mobile", "desktop"]);

function boundedText(value, maximum = 160) {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, maximum)
    : "";
}

function boundedVersion(value) {
  return boundedText(value, 80) || null;
}

function boundedCodes(values) {
  return [...new Set(values.map((value) => boundedText(value, 80)).filter(Boolean))].slice(0, 4);
}

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

export function evidenceAdapterReceiptSnapshot(value) {
  if (!value || typeof value !== "object") return null;
  return {
    adapterId: boundedText(value.adapterId, 80) || "unknown-adapter",
    provider: boundedText(value.provider, 120) || "Unknown provider",
    kind: boundedText(value.kind, 60) || "unknown",
    status: ["complete", "partial", "unavailable"].includes(value.status)
      ? value.status
      : "unavailable",
    adapterContractVersion: Number.isInteger(value.adapterContractVersion)
      ? value.adapterContractVersion
      : 1,
    evidenceVersion: boundedVersion(value.evidenceVersion),
    lighthouseVersion: boundedVersion(value.lighthouseVersion),
    ruleSetVersion: Number.isInteger(value.ruleSetVersion) ? value.ruleSetVersion : null,
    measuredConditions: Array.isArray(value.measuredConditions)
      ? value.measuredConditions.slice(0, 4).map((item) => boundedText(item, 40)).filter(Boolean)
      : [],
    failureCodes: Array.isArray(value.failureCodes) ? boundedCodes(value.failureCodes) : [],
    claimBoundary: boundedText(value.claimBoundary, 360),
  };
}
