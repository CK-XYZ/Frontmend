const MAX_RECOMMENDATIONS = 5;
const MAX_TARGETS = 4;

function bounded(value, maximum = 600) {
  return String(value ?? "").replace(/\r\n/g, "\n").trim().slice(0, maximum);
}

function unique(values, maximum = 8) {
  return [...new Set(values.map((value) => bounded(value, 256)).filter(Boolean))].slice(0, maximum);
}

function findingRecords(priority) {
  const provider = priority?.evidenceRecords?.provider?.findings ?? [];
  const browser = priority?.evidenceRecords?.browser?.findings ?? [];
  return [...provider, ...browser].slice(0, MAX_TARGETS);
}

function targetRecords(priority) {
  const targets = [];
  for (const finding of findingRecords(priority)) {
    const occurrences = Array.isArray(finding?.occurrences) && finding.occurrences.length
      ? finding.occurrences
      : [finding];
    for (const occurrence of occurrences) {
      targets.push({
        route: bounded(occurrence?.path ?? occurrence?.route?.path ?? finding?.route?.path, 256) || "/",
        viewport: bounded(
          occurrence?.viewport
            ?? occurrence?.strategy
            ?? finding?.viewport
            ?? finding?.source?.strategy,
          40,
        ) || "document",
        selector: bounded(occurrence?.selector ?? finding?.selector, 200) || null,
        evidence: bounded(occurrence?.evidence ?? finding?.evidence ?? priority?.evidence, 320),
      });
      if (targets.length >= MAX_TARGETS) break;
    }
    if (targets.length >= MAX_TARGETS) break;
  }

  if (!targets.length) {
    targets.push({
      route: "/",
      viewport: bounded(priority?.affectedStrategies?.[0], 40) || "document",
      selector: null,
      evidence: bounded(priority?.evidence, 600),
    });
  }

  const seen = new Set();
  return targets.filter((target) => {
    const key = `${target.route}:${target.viewport}:${target.selector ?? ""}:${target.evidence}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function acceptanceCriteria(priority, targets, ruleId) {
  const viewports = unique([
    ...(priority?.affectedStrategies ?? []),
    ...targets.map((target) => target.viewport),
  ], 4);
  const selectors = unique(targets.map((target) => target.selector), 4);
  const criteria = [
    `Re-run ${ruleId || "the retained audit rule"}${viewports.length ? ` for ${viewports.join(" and ")}` : ""} and confirm the failure is no longer reported.`,
  ];
  if (selectors.length) {
    criteria.push(`Inspect ${selectors.join(", ")} in the browser and confirm the reported symptom is no longer present.`);
  }
  if (viewports.some((viewport) => ["mobile", "desktop", "tablet"].includes(viewport))) {
    criteria.push(`Check the affected route at ${viewports.join(" and ")} for nearby visual or interaction regressions.`);
  }
  return criteria.slice(0, 3);
}

function recommendationRecord(priority, index) {
  const targets = targetRecords(priority);
  const ruleId = bounded(priority?.source?.auditId ?? priority?.findingId, 160);
  const selectors = unique(targets.map((target) => target.selector), 4);
  const routes = unique(targets.map((target) => target.route), 4);
  const viewports = unique([
    ...(priority?.affectedStrategies ?? []),
    ...targets.map((target) => target.viewport),
  ], 4);

  return {
    rank: Number.isInteger(priority?.rank) ? priority.rank : index + 1,
    findingId: bounded(priority?.findingId, 160),
    title: bounded(priority?.title, 240) || "Retained frontend issue",
    severity: ["high", "medium", "low"].includes(priority?.severity) ? priority.severity : "low",
    category: bounded(priority?.category, 80) || "Frontend",
    evidence: bounded(priority?.evidence, 600) || "Frontmend retained a failed audit rule for this page.",
    recommendation: bounded(priority?.suggestedRepair, 600)
      || "Inspect the implementation responsible for this measured symptom and make the smallest safe correction.",
    affected: {
      routes,
      viewports,
      selectors,
      occurrenceCount: Math.max(1, Number(priority?.occurrenceCount) || targets.length),
    },
    source: {
      provider: bounded(priority?.source?.provider, 120) || "Frontmend audit",
      ruleId,
      provenance: bounded(priority?.evidenceProvenance, 80) || "retained-audit-evidence",
    },
    targets,
    repositorySearchHints: unique([ruleId, ...selectors], 5),
    acceptanceCriteria: acceptanceCriteria(priority, targets, ruleId),
  };
}

export function createCodingAgentBrief({ report, priorities = [], mission = null } = {}) {
  const recommendations = (Array.isArray(priorities) ? priorities : [])
    .slice(0, MAX_RECOMMENDATIONS)
    .map(recommendationRecord);
  const targetUrl = bounded(report?.finalUrl ?? report?.url, 2_048);

  return {
    schemaVersion: 1,
    kind: "frontmend-coding-agent-brief",
    auditId: bounded(report?.auditId, 80),
    target: {
      url: targetUrl,
      hostname: bounded(report?.hostname, 253) || (() => {
        try {
          return new URL(targetUrl).hostname;
        } catch {
          return "unknown target";
        }
      })(),
    },
    requestedFocusAreas: unique(mission?.focusAreas ?? mission?.requestedFocusAreas ?? [], 5),
    summary: recommendations.length
      ? `${recommendations.length} ranked ${recommendations.length === 1 ? "recommendation" : "recommendations"} from retained public-site evidence.`
      : "No actionable recommendation was retained for the requested audit focus.",
    recommendations,
    workflow: {
      owner: "coding-agent",
      nextStep: recommendations.length
        ? "Inspect the current repository, implement the smallest safe corrections, run relevant checks, and report the changed files and test results."
        : "Review the retained audit coverage before deciding whether another focused audit is useful.",
      afterDeployment: "Run a fresh Frontmend audit of the public URL to measure the deployed result.",
    },
    evidenceBoundary: {
      publicSiteAudited: true,
      repositoryInspected: false,
      repositoryChanged: false,
      deployed: false,
      resolved: false,
      note: "Frontmend supplies public-site evidence and recommendations. Repository work remains in the coding agent's normal workflow.",
    },
  };
}

export function codingAgentBriefText(brief) {
  const lines = [
    `Use this Frontmend audit to improve ${brief?.target?.hostname ?? "the current site"}.`,
    "",
    "Frontmend has finished the public-site audit. Work in the current repository using your normal coding tools: inspect the implementation, make the smallest safe fixes, run relevant checks, and report what changed. Do not treat these recommendations as proof that anything has been deployed or resolved.",
    "",
  ];

  for (const recommendation of brief?.recommendations ?? []) {
    lines.push(`${recommendation.rank}. [${recommendation.severity.toUpperCase()}] ${recommendation.title}`);
    lines.push(`Evidence: ${recommendation.evidence}`);
    lines.push(`Recommendation: ${recommendation.recommendation}`);
    lines.push(`Source: ${recommendation.source.provider} · ${recommendation.source.ruleId}`);
    if (recommendation.affected.routes.length) lines.push(`Routes: ${recommendation.affected.routes.join(", ")}`);
    if (recommendation.affected.viewports.length) lines.push(`Viewports: ${recommendation.affected.viewports.join(", ")}`);
    if (recommendation.affected.selectors.length) lines.push(`Selectors: ${recommendation.affected.selectors.join(", ")}`);
    if (recommendation.repositorySearchHints.length) {
      lines.push(`Repository search hints: ${recommendation.repositorySearchHints.join(", ")}`);
    }
    lines.push("Acceptance criteria:");
    for (const criterion of recommendation.acceptanceCriteria) lines.push(`- ${criterion}`);
    lines.push("");
  }

  lines.push(`After deployment: ${brief?.workflow?.afterDeployment ?? "Run a fresh public audit."}`);
  lines.push(`Audit ID: ${brief?.auditId ?? "unknown"}`);
  return lines.join("\n").trim();
}
