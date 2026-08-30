import { AuditError } from "./url-policy.js";

function boundedLine(value, maximum = 400) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maximum);
}

export function createFreshAgentHandoff(checkpoint, origin) {
  if (!checkpoint || typeof checkpoint !== "object" || Array.isArray(checkpoint)) {
    throw new AuditError("INVALID_INPUT", "A bounded mission checkpoint is required for agent handoff.");
  }
  const auditId = typeof checkpoint.auditId === "string"
    ? boundedLine(checkpoint.auditId, 160)
    : "";
  if (!auditId || !Number.isInteger(checkpoint.missionRevision) || checkpoint.missionRevision < 1) {
    throw new AuditError("INVALID_INPUT", "The mission checkpoint must include an audit ID and positive revision.");
  }

  let publicOrigin;
  try {
    const candidate = new URL(origin);
    if (!["http:", "https:"].includes(candidate.protocol) || candidate.username || candidate.password) {
      throw new Error("Unsupported origin.");
    }
    publicOrigin = candidate.origin;
  } catch {
    throw new AuditError("INVALID_INPUT", "A public HTTP(S) Frontmend origin is required for agent handoff.");
  }

  const workspaceUrl = new URL(`/audits/${encodeURIComponent(auditId)}`, publicOrigin).href;
  const status = boundedLine(
    typeof checkpoint.status === "string" ? checkpoint.status : "unknown",
    60,
  );
  const requiredCapability = boundedLine(
    typeof checkpoint.requiredCapability === "string"
      ? checkpoint.requiredCapability
      : "contextual mission state",
    80,
  );
  const copiedMissionRevision = checkpoint.missionRevision;
  const defaultAuthorityBoundary = {
    humanOnly: [
      "Approve or reject a repair and define any delegated policy.",
      "Deploy the reviewed change and attest that deployment.",
      "Accept unresolved business risk or change the public target.",
    ],
    agentMay: "Perform only the exact contextual action and return bounded evidence.",
    claim: "This handoff grants no authority and proves no outcome.",
  };
  const suppliedAuthorityBoundary = checkpoint.authorityBoundary;
  const suppliedHumanOnly = Array.isArray(suppliedAuthorityBoundary?.humanOnly)
    ? suppliedAuthorityBoundary.humanOnly
        .filter((item) => typeof item === "string")
        .slice(0, 5)
        .map((item) => boundedLine(item, 180))
        .filter(Boolean)
    : [];
  const authorityBoundary = suppliedAuthorityBoundary && typeof suppliedAuthorityBoundary === "object"
    ? {
        humanOnly: suppliedHumanOnly.length
          ? suppliedHumanOnly
          : defaultAuthorityBoundary.humanOnly,
        agentMay: boundedLine(
          typeof suppliedAuthorityBoundary.agentMay === "string"
            ? suppliedAuthorityBoundary.agentMay
            : defaultAuthorityBoundary.agentMay,
          280,
        ),
        claim: boundedLine(
          typeof suppliedAuthorityBoundary.claim === "string"
            ? suppliedAuthorityBoundary.claim
            : defaultAuthorityBoundary.claim,
          280,
        ),
      }
    : defaultAuthorityBoundary;
  const prompt = [
    `Open the Frontmend workspace ${workspaceUrl} and continue its existing mission from the current authoritative state.`,
    `This handoff was copied at mission revision ${copiedMissionRevision}, when the status was ${status} and the required capability was ${requiredCapability}. Treat those values as orientation only.`,
    "After opening the workspace, read the latest mission checkpoint and the currently registered contextual tools. Do not reuse or replay an action, input, or revision from an earlier chat.",
    "Perform only the exact action exposed by the current checkpoint. Return bounded direct evidence or an honest supported blocker, and keep provider, browser, repository, implementation, deployment, and verification evidence separately attributed.",
    "Stop at person-owned repair intent, approval or policy, deployment, deployment attestation, and risk acceptance. The handoff grants no additional authority and is not proof of implementation, deployment, or resolution.",
  ].join("\n\n");

  return {
    schemaVersion: 1,
    kind: "fresh-agent-handoff",
    auditId,
    workspaceUrl,
    copiedMissionRevision,
    statusAtCopy: status,
    requiredCapabilityAtCopy: requiredCapability,
    prompt,
    liveStateRule: "The checkpoint read after opening the workspace always supersedes this copied orientation.",
    authorityBoundary,
  };
}
