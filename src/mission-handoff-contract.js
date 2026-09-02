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
      "Approve or reject a repair, define delegated policy, and authorise deployment.",
      "Attest that the reviewed version was deployed to the retained public target.",
      "Accept unresolved business risk or change the public target.",
    ],
    agentMay: "Continue across consecutive agent-owned checkpoint actions until a named human boundary, supported blocker, or completion.",
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
    "Execute the checkpoint action with its exact audit ID and mission revision. After each successful action, follow the newest returned checkpoint and continue automatically through consecutive agent-owned actions. Do not stop merely because Lighthouse or another measurement provider finished.",
    "Return bounded direct evidence or an honest supported blocker, and keep provider, browser, repository, implementation, deployment, and verification evidence separately attributed.",
    "Stop only when the live checkpoint names a person as the next actor, reaches a supported blocker with no available evidence path, or completes with no next action. Repair approval, delegated policy, deployment authorisation, deployment attestation, risk acceptance, and target changes remain person-owned. The handoff grants no additional authority and is not proof of implementation, deployment, or resolution.",
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
    continuationRule: "Continue across consecutive agent-owned checkpoints; stop only at a live human boundary, supported blocker, or completion.",
    authorityBoundary,
  };
}
