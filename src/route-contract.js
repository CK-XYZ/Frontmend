import { AuditError, normalizePublicUrl } from "./url-policy.js";

const MAX_ROUTE_DEPTH = 5;

function validTrailEntry(entry) {
  return (
    entry &&
    typeof entry === "object" &&
    typeof entry.auditId === "string" &&
    entry.auditId.length > 0 &&
    entry.auditId.length <= 80 &&
    typeof entry.path === "string" &&
    entry.path.startsWith("/") &&
    entry.path.length <= 256
  );
}

export function createRelatedAuditInput(report, path) {
  if (!report?.auditId || typeof report.auditId !== "string") {
    throw new AuditError("AUDIT_NOT_READY", "Finish the parent audit before exploring its routes.");
  }
  if (typeof path !== "string" || !path || path.length > 256) {
    throw new AuditError("INVALID_INPUT", "path must contain 1 to 256 characters.");
  }
  const routes = Array.isArray(report.documentProfile?.routes)
    ? report.documentProfile.routes
    : [];
  if (!routes.includes(path)) {
    throw new AuditError(
      "ROUTE_NOT_OBSERVED",
      "Choose a same-site route observed in this audit's fetched HTML.",
    );
  }

  const parentUrl = new URL(normalizePublicUrl(report.finalUrl ?? report.url));
  const targetUrl = new URL(path, parentUrl);
  if (
    targetUrl.origin !== parentUrl.origin ||
    targetUrl.pathname !== path ||
    targetUrl.search ||
    targetUrl.hash
  ) {
    throw new AuditError(
      "ROUTE_NOT_OBSERVED",
      "Choose a same-site route observed in this audit's fetched HTML.",
    );
  }

  const previousDepth = Number.isFinite(report.exploration?.depth)
    ? Math.max(0, Math.round(report.exploration.depth))
    : 0;
  if (previousDepth >= MAX_ROUTE_DEPTH) {
    throw new AuditError(
      "ROUTE_DEPTH_LIMIT",
      `Route exploration is limited to ${MAX_ROUTE_DEPTH} linked audits per journey.`,
    );
  }
  const previousTrail = Array.isArray(report.exploration?.trail)
    ? report.exploration.trail.filter(validTrailEntry).slice(0, MAX_ROUTE_DEPTH - 1)
    : [];
  const trail = [
    ...previousTrail,
    { auditId: report.auditId.slice(0, 80), path: parentUrl.pathname || "/" },
  ].slice(-MAX_ROUTE_DEPTH);

  return {
    url: normalizePublicUrl(targetUrl.href),
    exploration: {
      rootAuditId:
        typeof report.exploration?.rootAuditId === "string"
          ? report.exploration.rootAuditId.slice(0, 80)
          : report.auditId.slice(0, 80),
      parentAuditId: report.auditId.slice(0, 80),
      observedPath: path,
      depth: previousDepth + 1,
      trail,
    },
  };
}

export const routeExplorationLimits = Object.freeze({ maxDepth: MAX_ROUTE_DEPTH });
