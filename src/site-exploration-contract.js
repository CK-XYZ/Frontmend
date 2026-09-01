import { AuditError } from "./url-policy.js";
import { createRelatedAuditInput, observedRouteRecords } from "./route-contract.js";

const MAX_ROUTES = 3;
const MAX_ISSUES = 20;
const MAX_OCCURRENCES = 8;
const MISSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TERMINAL_STATUSES = new Set(["complete", "failed", "cancelled"]);
const SEVERITY_RANK = Object.freeze({ low: 1, medium: 2, high: 3 });

function routeCandidateId(auditId, path) {
  let hash = 2_166_136_261;
  for (const character of `${auditId}\n${path}`) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return `route-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function boundedText(value, limit) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function assertMissionId(value) {
  if (!MISSION_ID_PATTERN.test(value ?? "")) {
    throw new AuditError("EXPLORATION_NOT_FOUND", "No site exploration exists with that ID.");
  }
  return value;
}

export function createSiteRouteCandidates(report) {
  if (!report?.auditId || typeof report.auditId !== "string") {
    throw new AuditError("AUDIT_NOT_READY", "Finish the root audit before selecting retained routes.");
  }
  return observedRouteRecords(report).slice(0, MAX_ROUTES).map((route) => ({
    id: routeCandidateId(report.auditId, route.path),
    ...route,
  }));
}

export function createSiteExplorationInputs(report, selection, options = {}) {
  const candidates = createSiteRouteCandidates(report);
  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const selectedIds = Array.isArray(selection?.routeCandidateIds)
    ? selection.routeCandidateIds
    : null;
  const legacyPaths = Array.isArray(selection) ? selection : selection?.paths;
  if (options.requireCandidateIds && !selectedIds) {
    throw new AuditError(
      "INVALID_INPUT",
      "bounded-site missions require server-issued routeCandidateIds.",
    );
  }
  const paths = selectedIds
    ? selectedIds.map((id) => {
        if (typeof id !== "string" || !candidateById.has(id)) {
          throw new AuditError(
            "ROUTE_CANDIDATE_INVALID",
            "Choose only server-issued route candidates from this completed audit.",
          );
        }
        return candidateById.get(id).path;
      })
    : legacyPaths;
  if (!Array.isArray(paths)) {
    throw new AuditError(
      "INVALID_INPUT",
      "routeCandidateIds must be an array of server-issued retained routes.",
    );
  }
  if (paths.length < 1 || paths.length > MAX_ROUTES) {
    throw new AuditError(
      "INVALID_INPUT",
      `Choose between 1 and ${MAX_ROUTES} observed routes for one site exploration.`,
    );
  }
  const unique = new Set();
  const routes = paths.map((path) => {
    if (unique.has(path)) {
      throw new AuditError("INVALID_INPUT", "Each site-exploration path must be unique.");
    }
    unique.add(path);
    const related = createRelatedAuditInput(report, path);
    return {
      path,
      source: candidateById.get(routeCandidateId(report.auditId, path))?.source ?? "observed-document-route",
      ...related,
    };
  });
  return {
    rootAuditId: report.auditId,
    routeCandidateIds: paths.map((path) => routeCandidateId(report.auditId, path)),
    routes,
    routeCandidates: candidates,
    caveat:
      "Each page is a separate public audit. The aggregate covers only the selected observed routes and does not represent a complete crawl.",
  };
}

export function createSiteExplorationMission({
  missionId,
  rootAuditId,
  source,
  routes,
  children,
  createdAt,
}) {
  assertMissionId(missionId);
  if (typeof rootAuditId !== "string" || !rootAuditId) {
    throw new AuditError("INVALID_INPUT", "rootAuditId must be a non-empty string.");
  }
  if (!Array.isArray(routes) || !Array.isArray(children) || routes.length !== children.length) {
    throw new AuditError("INVALID_INPUT", "The exploration routes and child audits must align.");
  }
  if (routes.length < 1 || routes.length > MAX_ROUTES) {
    throw new AuditError("INVALID_INPUT", "The exploration contains an invalid route count.");
  }
  return {
    id: missionId,
    rootAuditId: rootAuditId.slice(0, 80),
    source: source === "agent" ? "agent" : "human",
    status: "queued",
    createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
    children: children.map((child, index) => ({
      auditId: boundedText(child?.auditId, 80),
      path: boundedText(routes[index]?.path, 256),
      url: boundedText(routes[index]?.url, 2_048),
      routeSource: [
        "observed-document-route",
        "agent-reported-browser-route",
        "person-reported-browser-route",
      ].includes(routes[index]?.source)
        ? routes[index].source
        : "observed-document-route",
      position: index + 1,
      startError: child?.startError
        ? {
            code: boundedText(child.startError.code, 80) || "AUDIT_START_FAILED",
            message: boundedText(child.startError.message, 300) || "The page audit could not start.",
          }
        : null,
    })),
    caveat:
      "This mission aggregates only selected server-validated routes observed by document or rendered-browser evidence. It is not an exhaustive site crawl.",
  };
}

function pageSnapshot(child, audit) {
  const startFailed = child.startError || !child.auditId;
  const status = startFailed ? "failed" : boundedText(audit?.status, 24) || "queued";
  const report = status === "complete" ? audit?.report : null;
  const progress = startFailed
    ? 100
    : Number.isFinite(audit?.progress)
      ? Math.max(0, Math.min(100, Math.round(audit.progress)))
      : 0;
  return {
    auditId: child.auditId || null,
    path: child.path,
    url: child.url,
    routeSource: child.routeSource ?? "observed-document-route",
    position: child.position,
    status,
    progress,
    score: Number.isFinite(report?.score) ? report.score : null,
    checks: report?.checks ?? null,
    findingCount: Number.isFinite(report?.findingCount) ? report.findingCount : null,
    completedAt: Number.isFinite(report?.completedAt)
      ? report.completedAt
      : Number.isFinite(audit?.completedAt)
        ? audit.completedAt
        : null,
    workspacePath: child.auditId ? `/audits/${encodeURIComponent(child.auditId)}` : null,
    error: startFailed ? child.startError : audit?.error ?? null,
  };
}

function aggregateIssues(mission, auditsById) {
  const issues = new Map();
  for (const child of mission.children) {
    const audit = auditsById.get(child.auditId);
    if (audit?.status !== "complete" || !Array.isArray(audit.report?.findings)) continue;
    for (const finding of audit.report.findings) {
      const provider = boundedText(finding?.source?.provider, 80) || "unknown-provider";
      const ruleId = boundedText(finding?.source?.auditId ?? finding?.id, 120) || "unknown-rule";
      const category = boundedText(finding?.category, 80) || "other";
      const title = boundedText(finding?.title, 180) || "Untitled finding";
      const key = `${provider}\n${ruleId}\n${category}\n${title}`;
      const severity = SEVERITY_RANK[finding?.severity] ? finding.severity : "low";
      const current = issues.get(key) ?? {
        ruleId,
        provider,
        category,
        title,
        severity,
        focusAreas: [],
        suggestedRepair: "Diagnose the retained cross-page evidence before repair.",
        occurrenceCount: 0,
        pageKeys: new Set(),
        occurrences: [],
      };
      if (SEVERITY_RANK[severity] > SEVERITY_RANK[current.severity]) current.severity = severity;
      current.focusAreas = [...new Set([
        ...current.focusAreas,
        ...(Array.isArray(finding?.focusAreas) ? finding.focusAreas : []),
      ])].slice(0, 5);
      if (finding?.suggestedRepair) {
        current.suggestedRepair = boundedText(finding.suggestedRepair, 500);
      }
      current.occurrenceCount += 1;
      current.pageKeys.add(child.auditId || child.path);
      if (current.occurrences.length < MAX_OCCURRENCES) {
        current.occurrences.push({
          auditId: child.auditId,
          path: child.path,
          findingId: boundedText(finding?.id, 160),
          strategy: boundedText(finding?.source?.strategy, 40),
          evidence: boundedText(finding?.evidence ?? finding?.summary, 300),
        });
      }
      issues.set(key, current);
    }
  }
  return [...issues.values()]
    .map(({ pageKeys, ...issue }) => ({
      ...issue,
      distinctPageCount: pageKeys.size,
    }))
    .sort(
      (a, b) =>
        b.occurrenceCount - a.occurrenceCount ||
        SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
        a.title.localeCompare(b.title),
    )
    .slice(0, MAX_ISSUES);
}

export function siteExplorationSnapshot(mission, audits = []) {
  assertMissionId(mission?.id);
  const auditsById = new Map(
    audits.filter((audit) => audit?.id).map((audit) => [audit.id, audit]),
  );
  const pages = mission.children.map((child) => pageSnapshot(child, auditsById.get(child.auditId)));
  const completePages = pages.filter((page) => page.status === "complete").length;
  const failedPages = pages.filter((page) => ["failed", "cancelled"].includes(page.status)).length;
  const terminalPages = pages.filter((page) => TERMINAL_STATUSES.has(page.status)).length;
  const issues = aggregateIssues(mission, auditsById);
  const totalFindings = pages.reduce(
    (total, page) => total + (Number.isFinite(page.findingCount) ? page.findingCount : 0),
    0,
  );
  const status =
    terminalPages < pages.length
      ? pages.some((page) => page.status === "running" || page.progress > 0)
        ? "running"
        : "queued"
      : failedPages === 0
        ? "complete"
        : completePages > 0
          ? "partial"
          : "failed";
  return {
    id: mission.id,
    rootAuditId: mission.rootAuditId,
    source: mission.source,
    status,
    progress: pages.length
      ? Math.round(pages.reduce((total, page) => total + page.progress, 0) / pages.length)
      : 0,
    createdAt: mission.createdAt,
    completedAt:
      terminalPages === pages.length
        ? Math.max(0, ...pages.map((page) => page.completedAt ?? 0)) || null
        : null,
    summary: {
      pagesRequested: pages.length,
      pagesComplete: completePages,
      pagesFailed: failedPages,
      totalFindings,
      uniqueIssues: issues.length,
      recurringIssues: issues.filter((issue) => issue.distinctPageCount > 1).length,
    },
    pages,
    issues,
    caveat: mission.caveat,
  };
}

function markdownText(value, limit = 500) {
  return boundedText(value, limit)
    .replace(/[\\`*_{}[\]<>|]/g, "\\$&")
    .replace(/[\r\n]+/g, " ");
}

export function siteExplorationMarkdown(snapshot) {
  assertMissionId(snapshot?.id);
  const pages = Array.isArray(snapshot.pages) ? snapshot.pages.slice(0, MAX_ROUTES) : [];
  const issues = Array.isArray(snapshot.issues) ? snapshot.issues.slice(0, MAX_ISSUES) : [];
  const lines = [
    "# Frontmend site exploration",
    "",
    "> Evidence artifact only. This bounded mission does not claim a complete crawl or any change to the target site.",
    "",
    `- Exploration ID: ${markdownText(snapshot.id, 80)}`,
    `- Root audit: ${markdownText(snapshot.rootAuditId, 80)}`,
    `- Status: ${markdownText(snapshot.status, 24)}`,
    `- Pages requested: ${snapshot.summary?.pagesRequested ?? pages.length}`,
    `- Pages complete: ${snapshot.summary?.pagesComplete ?? 0}`,
    `- Pages failed: ${snapshot.summary?.pagesFailed ?? 0}`,
    `- Findings observed: ${snapshot.summary?.totalFindings ?? 0}`,
    `- Recurring issues: ${snapshot.summary?.recurringIssues ?? 0}`,
    "",
    "## Pages",
    "",
    "| Path | Route evidence | Audit | Status | Score | Findings |",
    "| --- | --- | --- | --- | ---: | ---: |",
    ...pages.map(
      (page) =>
        `| ${markdownText(page.path, 256)} | ${markdownText(page.routeSource ?? "observed-document-route", 80)} | ${markdownText(page.auditId ?? "—", 80)} | ${markdownText(page.status, 24)} | ${page.score ?? "—"} | ${page.findingCount ?? "—"} |`,
    ),
    "",
    "## Cross-page issues",
    "",
  ];
  if (!issues.length) {
    lines.push("No retained findings were available across the completed selected pages.");
  } else {
    for (const issue of issues) {
      const occurrenceCount = Number.isInteger(issue.occurrenceCount) ? issue.occurrenceCount : 0;
      const distinctPageCount = Number.isInteger(issue.distinctPageCount)
        ? issue.distinctPageCount
        : new Set((issue.occurrences ?? []).map((occurrence) => occurrence.auditId || occurrence.path)).size;
      lines.push(
        `### ${markdownText(issue.title, 180)}`,
        "",
        `- Rule: ${markdownText(issue.ruleId, 120)}`,
        `- Provider: ${markdownText(issue.provider, 80)}`,
        `- Severity: ${markdownText(issue.severity, 24)}`,
        `- Observed: ${occurrenceCount} occurrence${occurrenceCount === 1 ? "" : "s"} across ${distinctPageCount} selected page${distinctPageCount === 1 ? "" : "s"}`,
        "",
        ...issue.occurrences.map(
          (occurrence) =>
            `- ${markdownText(occurrence.path, 256)} — audit ${markdownText(occurrence.auditId, 80)}${occurrence.evidence ? ` — ${markdownText(occurrence.evidence, 300)}` : ""}`,
        ),
        "",
      );
    }
  }
  lines.push("## Boundary", "", markdownText(snapshot.caveat, 500), "");
  return lines.join("\n");
}

export const siteExplorationLimits = Object.freeze({
  maxRoutes: MAX_ROUTES,
  maxIssues: MAX_ISSUES,
  maxOccurrences: MAX_OCCURRENCES,
});

export { assertMissionId };
