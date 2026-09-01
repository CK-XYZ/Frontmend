import { AuditError, normalizePublicUrl } from "./url-policy.js";

const MAX_ROUTE_DEPTH = 5;
const MAX_RENDERED_ROUTE_OBSERVATIONS = 8;
const MAX_ROUTE_VALIDATION_REDIRECTS = 3;
const ROUTE_VALIDATION_TIMEOUT_MS = 8_000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function routeValidationError(message) {
  return new AuditError("ROUTE_VALIDATION_FAILED", message);
}

function boundedRoutePath(value) {
  if (
    typeof value !== "string"
    || !value.startsWith("/")
    || value.startsWith("//")
    || value.length > 256
  ) {
    throw new AuditError(
      "INVALID_BROWSER_REVIEW",
      "observedRoutes accepts only relative same-origin paths beginning with one slash.",
    );
  }
  return value;
}

function isRetainedRoutePath(value) {
  return typeof value === "string"
    && value.startsWith("/")
    && !value.startsWith("//")
    && value.length <= 256
    && !value.includes("?")
    && !value.includes("#");
}

function renderedRouteInput(report, value) {
  const path = boundedRoutePath(value);
  const baseUrl = new URL(normalizePublicUrl(report?.finalUrl ?? report?.url));
  const target = new URL(path, baseUrl);
  if (
    target.origin !== baseUrl.origin
    || target.username
    || target.password
    || target.pathname !== path
    || target.search
    || target.hash
  ) {
    throw new AuditError(
      "INVALID_BROWSER_REVIEW",
      "observedRoutes accepts only relative same-origin paths without credentials, queries, or fragments.",
    );
  }
  return { path, url: normalizePublicUrl(target.href), origin: baseUrl.origin };
}

export function normalizeRenderedRouteObservations(report, observedRoutes) {
  if (!Array.isArray(observedRoutes) || observedRoutes.length < 1 || observedRoutes.length > MAX_RENDERED_ROUTE_OBSERVATIONS) {
    throw new AuditError(
      "INVALID_BROWSER_REVIEW",
      `observedRoutes must contain between 1 and ${MAX_RENDERED_ROUTE_OBSERVATIONS} relative paths when supplied.`,
    );
  }
  const normalized = observedRoutes.map((value) => renderedRouteInput(report, value));
  if (new Set(normalized.map((item) => item.path)).size !== normalized.length) {
    throw new AuditError("INVALID_BROWSER_REVIEW", "observedRoutes must not contain duplicate paths.");
  }
  return normalized;
}

async function fetchRouteHead(fetchImpl, url, signal) {
  let response = await fetchImpl(url, {
    method: "HEAD",
    redirect: "manual",
    headers: { accept: "text/html,application/xhtml+xml" },
    signal,
  });
  if (response.status !== 405 && response.status !== 501) return { response, method: "HEAD" };
  await response.body?.cancel().catch(() => {});
  response = await fetchImpl(url, {
    method: "GET",
    redirect: "manual",
    headers: {
      accept: "text/html,application/xhtml+xml",
      range: "bytes=0-0",
    },
    signal,
  });
  return { response, method: "GET" };
}

async function validateRenderedRoute({ candidate, fetchImpl, signal }) {
  let currentUrl = candidate.url;
  let method = "HEAD";
  for (let redirectCount = 0; redirectCount <= MAX_ROUTE_VALIDATION_REDIRECTS; redirectCount += 1) {
    let fetched;
    try {
      fetched = await fetchRouteHead(fetchImpl, currentUrl, signal);
    } catch {
      throw routeValidationError("A rendered route could not be revalidated from the public audit boundary.");
    }
    const { response } = fetched;
    method = fetched.method;
    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => {});
      if (!location) throw routeValidationError("A rendered route returned an invalid redirect.");
      if (redirectCount === MAX_ROUTE_VALIDATION_REDIRECTS) {
        throw routeValidationError("A rendered route exceeded the validation redirect limit.");
      }
      let redirected;
      let normalized;
      try {
        redirected = new URL(location, currentUrl);
        normalized = normalizePublicUrl(redirected.href);
      } catch (error) {
        if (error instanceof AuditError && error.code === "PRIVATE_TARGET") throw error;
        throw routeValidationError("A rendered route returned an unsafe redirect destination.");
      }
      if (
        redirected.origin !== candidate.origin
        || redirected.username
        || redirected.password
        || redirected.search
        || redirected.hash
      ) {
        throw routeValidationError("A rendered route redirected outside its public same-origin boundary.");
      }
      currentUrl = normalized;
      continue;
    }
    await response.body?.cancel().catch(() => {});
    if (response.status < 200 || response.status >= 300) {
      throw routeValidationError("A rendered route did not return a public successful response.");
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      throw routeValidationError("A rendered route did not identify a public HTML response.");
    }
    const final = new URL(currentUrl);
    return {
      path: final.pathname,
      observedPath: candidate.path,
      finalUrl: currentUrl,
      method,
      status: response.status,
      redirectCount,
    };
  }
  throw routeValidationError("A rendered route could not be revalidated.");
}

export async function validateRenderedRouteObservations({
  report,
  observedRoutes,
  source = "agent",
  fetchImpl = fetch,
  signal,
  now = Date.now(),
}) {
  const candidates = normalizeRenderedRouteObservations(report, observedRoutes);
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) forwardAbort();
  else signal?.addEventListener?.("abort", forwardAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), ROUTE_VALIDATION_TIMEOUT_MS);
  let validated;
  try {
    validated = await Promise.all(
      candidates.map((candidate) => validateRenderedRoute({
        candidate,
        fetchImpl,
        signal: controller.signal,
      })),
    );
  } catch (error) {
    controller.abort();
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.("abort", forwardAbort);
  }
  const unique = new Map();
  for (const route of validated) {
    if (!unique.has(route.path)) {
      unique.set(route.path, {
        ...route,
        source: source === "person"
          ? "person-reported-browser-route"
          : "agent-reported-browser-route",
        validatedAt: Number.isFinite(now) ? now : Date.now(),
      });
    }
  }
  return [...unique.values()].slice(0, MAX_RENDERED_ROUTE_OBSERVATIONS);
}

export function mergeRenderedRouteObservations(report, observations) {
  const retained = Array.isArray(report?.renderedRouteObservations)
    ? report.renderedRouteObservations
    : [];
  const merged = new Map(retained.filter((item) => item?.path).map((item) => [item.path, item]));
  for (const observation of observations ?? []) {
    if (observation?.path) merged.set(observation.path, { ...observation });
  }
  return {
    ...report,
    renderedRouteObservations: [...merged.values()].slice(0, MAX_RENDERED_ROUTE_OBSERVATIONS),
  };
}

export function observedRouteRecords(report) {
  const records = [];
  const seen = new Set();
  for (const path of Array.isArray(report?.documentProfile?.routes) ? report.documentProfile.routes : []) {
    if (!isRetainedRoutePath(path) || seen.has(path)) continue;
    seen.add(path);
    records.push({ path, source: "observed-document-route", validatedAt: report.completedAt ?? null });
  }
  for (const observation of Array.isArray(report?.renderedRouteObservations) ? report.renderedRouteObservations : []) {
    if (!isRetainedRoutePath(observation?.path) || seen.has(observation.path)) continue;
    seen.add(observation.path);
    records.push({
      path: observation.path,
      source: observation.source === "person-reported-browser-route"
        ? "person-reported-browser-route"
        : "agent-reported-browser-route",
      validatedAt: Number.isFinite(observation.validatedAt) ? observation.validatedAt : null,
      validationMethod: observation.method === "GET" ? "GET" : "HEAD",
      observedPath: typeof observation.observedPath === "string" ? observation.observedPath : observation.path,
    });
  }
  return records;
}

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
  const routes = observedRouteRecords(report).map((route) => route.path);
  if (!routes.includes(path)) {
    throw new AuditError(
      "ROUTE_NOT_OBSERVED",
      "Choose a server-validated same-site route observed in this audit's document or rendered browser evidence.",
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
      "Choose a server-validated same-site route observed in this audit's document or rendered browser evidence.",
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

export const routeExplorationLimits = Object.freeze({
  maxDepth: MAX_ROUTE_DEPTH,
  maxRenderedRouteObservations: MAX_RENDERED_ROUTE_OBSERVATIONS,
  maxValidationRedirects: MAX_ROUTE_VALIDATION_REDIRECTS,
  validationTimeoutMs: ROUTE_VALIDATION_TIMEOUT_MS,
});
