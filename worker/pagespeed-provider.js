import { normalizePublicUrl } from "../src/url-policy.js";

const ENDPOINT = "https://pagespeedonline.googleapis.com/pagespeedonline/v5/runPagespeed";
const STRATEGIES = ["mobile", "desktop"];
const CATEGORY_IDS = ["performance", "accessibility", "best-practices", "seo"];
const RESPONSE_LIMIT_BYTES = 12 * 1024 * 1024;
const SCREENSHOT_LIMIT_CHARS = 110_000;
const DOCUMENT_LIMIT_BYTES = 2 * 1024 * 1024;
const CSP_ORIGIN_LIMIT = 8;
const DOCUMENT_PROFILE_ORIGIN_LIMIT = 12;
const DOCUMENT_PROFILE_ROUTE_LIMIT = 8;

const RULES = Object.freeze({
  "color-contrast": {
    category: "Accessibility",
    title: "Text contrast is too low",
    summary: "Rendered text does not meet Lighthouse contrast thresholds.",
    repair: "Adjust foreground or background color tokens while preserving the visual hierarchy.",
  },
  "tap-targets": {
    category: "Interaction",
    title: "Tap targets are too small or crowded",
    summary: "Interactive controls are difficult to activate reliably on a mobile viewport.",
    repair: "Increase the interactive area and spacing without inflating the visible control.",
  },
  "image-alt": {
    category: "Accessibility",
    title: "Images are missing text alternatives",
    summary: "One or more meaningful images do not expose an accessible alternative.",
    repair: "Add concise alt text to meaningful images and empty alt text to decorative images.",
  },
  label: {
    category: "Accessibility",
    title: "Form controls are missing labels",
    summary: "A form control does not expose a reliable accessible name.",
    repair: "Associate every control with a visible label or an equivalent accessible name.",
  },
  "button-name": {
    category: "Accessibility",
    title: "Buttons are missing accessible names",
    summary: "A button cannot be identified consistently by assistive technology or agents.",
    repair: "Provide a visible label or an aria-label that describes the button action.",
  },
  "link-name": {
    category: "Accessibility",
    title: "Links are missing accessible names",
    summary: "A link cannot be identified consistently by assistive technology or agents.",
    repair: "Give each link meaningful visible text or an equivalent accessible name.",
  },
  viewport: {
    category: "Responsive",
    title: "The page is not configured for mobile viewports",
    summary: "The rendered page is missing a mobile viewport configuration.",
    repair: "Add a width=device-width viewport declaration and verify the responsive breakpoints.",
  },
  "heading-order": {
    category: "Accessibility",
    title: "Heading levels are out of order",
    summary: "The document outline skips heading levels and weakens navigation.",
    repair: "Reorder headings into a logical hierarchy without using heading levels for styling.",
  },
  "document-title": {
    category: "Document",
    title: "The document title is missing",
    summary: "The page does not provide a useful title for browser and assistive contexts.",
    repair: "Add a concise, page-specific title element.",
  },
  "html-has-lang": {
    category: "Document",
    title: "The document language is missing",
    summary: "The root document does not declare its primary language.",
    repair: "Set the lang attribute on the html element to the page's primary language.",
  },
  "errors-in-console": {
    category: "Reliability",
    title: "The page reports browser errors",
    summary: "The audited load produced errors in the browser console.",
    repair: "Resolve the first-party console errors and rerun the same audit conditions.",
  },
  "is-on-https": {
    category: "Security",
    title: "The page is not fully served over HTTPS",
    summary: "The audited experience includes an insecure document or resource.",
    repair: "Serve the page and every active resource over HTTPS, then remove mixed-content paths.",
  },
  "largest-contentful-paint": {
    category: "Performance",
    title: "Largest Contentful Paint is slow",
    summary: "The primary visible content takes too long to render in the audited conditions.",
    repair: "Prioritize the LCP resource, reduce render blocking work, and verify the result on mobile.",
  },
  "cumulative-layout-shift": {
    category: "Performance",
    title: "The layout shifts while loading",
    summary: "Visible content moves unexpectedly during the audited page load.",
    repair: "Reserve media and component dimensions and avoid inserting content above rendered UI.",
  },
  "total-blocking-time": {
    category: "Performance",
    title: "Main-thread work blocks interaction",
    summary: "Long tasks prevent the page from responding promptly during load.",
    repair: "Split long tasks, defer non-critical JavaScript, and reduce third-party execution cost.",
  },
  "meta-description": {
    category: "SEO",
    title: "The page is missing a meta description",
    summary: "Search results may not have a useful page-specific summary.",
    repair: "Add a concise, page-specific meta description that accurately describes the visible content.",
  },
  "link-text": {
    category: "SEO",
    title: "Links do not have descriptive text",
    summary: "Some link labels do not explain their destination to people or search engines.",
    repair: "Replace vague link text with a concise description of the destination or action.",
  },
  "crawlable-anchors": {
    category: "SEO",
    title: "Links are not crawlable",
    summary: "Some navigation targets cannot be followed as standard links.",
    repair: "Use valid href destinations for navigation and reserve scripted controls for actions.",
  },
  "robots-txt": {
    category: "SEO",
    title: "robots.txt is invalid",
    summary: "Search crawlers may not interpret the site's crawl directives reliably.",
    repair: "Correct invalid robots.txt directives and verify the intended public crawl policy.",
  },
  hreflang: {
    category: "SEO",
    title: "Language annotations are invalid",
    summary: "Alternate-language links do not form a valid hreflang set.",
    repair: "Use valid language and region codes with reciprocal canonical alternate URLs.",
  },
  canonical: {
    category: "SEO",
    title: "The canonical URL is invalid",
    summary: "Search engines may not receive a clear canonical URL for this page.",
    repair: "Add one valid absolute canonical URL that resolves to the intended public page.",
  },
  "is-crawlable": {
    category: "SEO",
    title: "The page is blocked from indexing",
    summary: "Search engines are instructed not to index the audited page.",
    repair: "Remove unintended noindex directives while preserving deliberate private-page exclusions.",
  },
  "http-status-code": {
    category: "SEO",
    title: "The page returned an unsuccessful status",
    summary: "Search engines did not receive a successful response for the audited page.",
    repair: "Return a successful status for the canonical public page and repair unintended redirect or error paths.",
  },
});

const ACCESSIBILITY_AUDITS = new Set([
  "color-contrast", "tap-targets", "image-alt", "label", "button-name", "link-name",
  "heading-order", "document-title", "html-has-lang", "html-lang", "missing-h1", "multiple-h1",
  "main-landmark",
]);
const SEO_AUDITS = new Set([
  "document-title", "html-has-lang", "html-lang", "image-alt", "heading-order", "missing-h1",
  "multiple-h1", "meta-description",
  "link-text", "crawlable-anchors", "robots-txt", "hreflang", "canonical", "is-crawlable",
  "http-status-code",
]);

function focusAreasFor(id, category) {
  const areas = [];
  if (ACCESSIBILITY_AUDITS.has(id)) areas.push("accessibility");
  if (SEO_AUDITS.has(id)) areas.push("seo");
  if (category === "Performance") areas.push("performance");
  if (category === "Security") areas.push("security");
  if (category === "Reliability") areas.push("reliability");
  return areas;
}

function providerError(code, message, recoverable = true) {
  const error = new Error(message);
  error.code = code;
  error.recoverable = recoverable;
  return error;
}

function cancellableSignal(externalSignal, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => {
    if (!controller.signal.aborted) controller.abort(externalSignal?.reason ?? "cancelled");
  };
  if (externalSignal?.aborted) abortFromCaller();
  else externalSignal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    if (!controller.signal.aborted) controller.abort("timeout");
  }, timeoutMs);
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    cleanup() {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", abortFromCaller);
    },
  };
}

function throwIfCancelled(signal) {
  if (signal?.aborted) {
    throw providerError("AUDIT_CANCELLED", "The audit was cancelled.");
  }
}

function bounded(value, maximum = 240) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maximum);
}

function firstNode(audit) {
  const items = Array.isArray(audit?.details?.items) ? audit.details.items : [];
  for (const item of items.slice(0, 12)) {
    const node = item?.node ?? item?.source ?? item;
    const selector = bounded(node?.selector ?? node?.nodeLabel ?? item?.url, 160);
    if (selector) return selector;
  }
  return "Document";
}

function finiteMetric(value, { minimum = 0, maximum = 86_400_000 } = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.min(maximum, Math.max(minimum, Math.round(numeric * 100) / 100));
}

function publicResourceReference(value, maximum = 240) {
  const reference = bounded(value, maximum);
  if (!reference) return null;
  try {
    const url = new URL(reference);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return bounded(`${url.origin}${url.pathname}`, maximum);
  } catch {
    return reference.startsWith("/") ? reference : null;
  }
}

function detailItems(audit, maximum = 5) {
  const items = Array.isArray(audit?.details?.items) ? audit.details.items : [];
  return { retained: items.slice(0, maximum), omitted: Math.max(0, items.length - maximum) };
}

function ratioFromExplanation(explanation) {
  const text = bounded(explanation, 360);
  const observed = text.match(/contrast(?: ratio)?(?: of|:)?\s*([0-9]+(?:\.[0-9]+)?)/i)?.[1];
  const expected = text.match(/expected(?: ratio)?(?: of|:)?\s*([0-9]+(?:\.[0-9]+)?)/i)?.[1]
    ?? text.match(/minimum required(?: ratio)?(?: is|:)?\s*([0-9]+(?:\.[0-9]+)?)/i)?.[1];
  return {
    observed: observed ? finiteMetric(observed, { maximum: 100 }) : null,
    expected: expected ? finiteMetric(expected, { maximum: 100 }) : null,
  };
}

function consoleDiagnosticEvidence(audit) {
  const { retained, omitted } = detailItems(audit);
  const entries = retained.flatMap((item) => {
    const location = item?.sourceLocation ?? {};
    const description = bounded(item?.description ?? item?.text ?? item?.message, 320);
    const source = bounded(item?.source, 80);
    const sourceUrl = publicResourceReference(location.url ?? item?.url);
    if (!description && !source && !sourceUrl) return [];
    return [{
      description: description || "Console error detail unavailable",
      source: source || null,
      sourceUrl,
      lineNumber: finiteMetric(location.line ?? location.lineNumber, { maximum: 10_000_000 }),
      columnNumber: finiteMetric(location.column ?? location.columnNumber, { maximum: 10_000_000 }),
    }];
  });
  return {
    version: 1,
    kind: "console-errors",
    provenance: "measured-lighthouse",
    completeness: entries.length ? "actionable" : "partial",
    missing: entries.length ? [] : ["console-message-details"],
    entries,
    omitted,
    caveat: "Console entries describe the audited load only; reproduce them before changing source.",
  };
}

function contrastDiagnosticEvidence(audit) {
  const { retained, omitted } = detailItems(audit);
  const nodes = retained.flatMap((item) => {
    const node = item?.node ?? item;
    const selector = bounded(node?.selector ?? node?.nodeLabel, 160);
    const explanation = bounded(node?.explanation ?? item?.explanation, 360);
    const snippet = bounded(node?.snippet, 260);
    const ratios = ratioFromExplanation(explanation);
    if (!selector && !explanation && !snippet) return [];
    return [{
      selector: selector || "Measured node",
      nodeLabel: bounded(node?.nodeLabel, 160) || null,
      snippet: snippet || null,
      explanation: explanation || null,
      observedRatio: ratios.observed,
      expectedRatio: ratios.expected,
    }];
  });
  return {
    version: 1,
    kind: "contrast-nodes",
    provenance: "measured-lighthouse",
    completeness: nodes.length ? "actionable" : "partial",
    missing: nodes.length ? [] : ["affected-node-details"],
    nodes,
    omitted,
    caveat: "Measured nodes belong to Lighthouse's emulated load; interactive states still require targeted checks.",
  };
}

function blockingDiagnosticEvidence(audit, audits) {
  const longTaskAudit = audits?.["long-tasks"];
  const { retained, omitted } = detailItems(longTaskAudit);
  const longTasks = retained.flatMap((item) => {
    const durationMs = finiteMetric(item?.duration);
    if (durationMs === null) return [];
    return [{
      durationMs,
      startTimeMs: finiteMetric(item?.startTime),
      sourceUrl: publicResourceReference(item?.url),
    }];
  });
  return {
    version: 1,
    kind: "main-thread-blocking",
    provenance: "measured-lighthouse",
    completeness: longTasks.length ? "actionable" : "partial",
    missing: longTasks.length ? [] : ["long-task-attribution"],
    totalBlockingTimeMs: finiteMetric(audit?.numericValue),
    longTasks,
    omitted,
    caveat: "Long-task attribution describes the audited load and does not map bundled code to repository modules.",
  };
}

function diagnosticEvidenceFor(id, audit, audits) {
  if (id === "errors-in-console") return consoleDiagnosticEvidence(audit);
  if (id === "color-contrast") return contrastDiagnosticEvidence(audit);
  if (id === "total-blocking-time") return blockingDiagnosticEvidence(audit, audits);
  return null;
}

function severityFor(id, audit) {
  const score = typeof audit?.score === "number" ? audit.score : 1;
  const numeric = Number(audit?.numericValue);
  if (id === "largest-contentful-paint") return numeric > 4000 ? "high" : "medium";
  if (id === "cumulative-layout-shift") return numeric > 0.25 ? "high" : "medium";
  if (id === "total-blocking-time") return numeric > 600 ? "high" : "medium";
  if (["button-name", "link-name", "label", "is-on-https", "is-crawlable", "http-status-code"].includes(id)) return "high";
  return score < 0.5 ? "medium" : "low";
}

function findingFromAudit(id, audit, strategy, audits) {
  const rule = RULES[id];
  if (!rule || audit?.scoreDisplayMode === "notApplicable" || audit?.score === null) return null;
  if (typeof audit?.score !== "number" || audit.score >= 0.9) return null;
  const selector = firstNode(audit);
  const measured = bounded(audit.displayValue, 120) || `Lighthouse score ${Math.round(audit.score * 100)}`;
  return {
    id: `${strategy}-${id}`,
    severity: severityFor(id, audit),
    category: rule.category,
    focusAreas: focusAreasFor(id, rule.category),
    title: rule.title,
    summary: rule.summary,
    selector,
    viewport: strategy === "mobile" ? "Mobile · Lighthouse emulation" : "Desktop · Lighthouse emulation",
    evidence: selector === "Document" ? measured : `${measured} · ${selector}`,
    repair: rule.repair,
    source: { provider: "Lighthouse", auditId: id, strategy },
    diagnosticEvidence: diagnosticEvidenceFor(id, audit, audits),
  };
}

function ruleOutcomeFromAudit(id, audit, strategy) {
  if (!RULES[id]) return null;
  let status = "not-evaluated";
  if (audit?.scoreDisplayMode === "notApplicable" || audit?.score === null) {
    status = "not-applicable";
  } else if (typeof audit?.score === "number") {
    status = audit.score >= 0.9 ? "passed" : "failed";
  }
  return {
    source: { provider: "Lighthouse", auditId: id, strategy },
    status,
  };
}

function countChecks(results) {
  const counts = { passed: 0, warnings: 0, failed: 0 };
  for (const result of results) {
    for (const [id, audit] of Object.entries(result.lighthouseResult?.audits ?? {})) {
      if (!RULES[id]) continue;
      if (typeof audit?.score !== "number" || audit.scoreDisplayMode === "notApplicable") continue;
      if (audit.score >= 0.9) counts.passed += 1;
      else if (audit.score >= 0.5) counts.warnings += 1;
      else counts.failed += 1;
    }
  }
  return counts;
}

function categoryScores(result) {
  const categories = result.lighthouseResult?.categories ?? {};
  return Object.fromEntries(
    CATEGORY_IDS.flatMap((key) =>
      typeof categories[key]?.score === "number"
        ? [[key, Math.round(categories[key].score * 100)]]
        : [],
    ),
  );
}

function screenshotFrom(result) {
  const data = result.lighthouseResult?.audits?.["final-screenshot"]?.details?.data;
  return typeof data === "string" &&
    /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(data) &&
    data.length <= SCREENSHOT_LIMIT_CHARS
    ? data
    : null;
}

async function readError(response) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let output = "";
  while (output.length < 500) {
    const { value, done } = await reader.read();
    if (done) break;
    output += decoder.decode(value, { stream: true });
  }
  await reader.cancel().catch(() => {});
  return bounded(output, 500);
}

async function readDocument(response) {
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > DOCUMENT_LIMIT_BYTES) {
    throw providerError("DOCUMENT_TOO_LARGE", "The page document exceeded the 2 MB audit limit.");
  }
  const reader = response.body?.getReader();
  if (!reader) return (await response.text()).slice(0, DOCUMENT_LIMIT_BYTES);
  const decoder = new TextDecoder();
  let output = "";
  let bytes = 0;
  while (bytes <= DOCUMENT_LIMIT_BYTES) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > DOCUMENT_LIMIT_BYTES) {
      await reader.cancel().catch(() => {});
      throw providerError("DOCUMENT_TOO_LARGE", "The page document exceeded the 2 MB audit limit.");
    }
    output += decoder.decode(value, { stream: true });
  }
  output += decoder.decode();
  return output;
}

async function readProviderJson(response) {
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > RESPONSE_LIMIT_BYTES) {
    throw providerError("PROVIDER_RESPONSE_TOO_LARGE", "The live audit response exceeded the safe limit.");
  }
  const reader = response.body?.getReader();
  if (!reader) {
    throw providerError("PROVIDER_INVALID_RESPONSE", "The live audit provider returned unreadable evidence.");
  }
  const decoder = new TextDecoder();
  let output = "";
  let bytes = 0;
  while (bytes <= RESPONSE_LIMIT_BYTES) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > RESPONSE_LIMIT_BYTES) {
      await reader.cancel().catch(() => {});
      throw providerError("PROVIDER_RESPONSE_TOO_LARGE", "The live audit response exceeded the safe limit.");
    }
    output += decoder.decode(value, { stream: true });
  }
  output += decoder.decode();
  try {
    return JSON.parse(output);
  } catch {
    throw providerError("PROVIDER_INVALID_RESPONSE", "The live audit provider returned invalid JSON evidence.");
  }
}

async function fetchPublicDocument({ url, fetchImpl, signal }) {
  let currentUrl = normalizePublicUrl(url);
  for (let redirect = 0; redirect <= 5; redirect += 1) {
    const response = await fetchImpl(currentUrl, {
      redirect: "manual",
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": "FrontmendAudit/1.0 (+https://frontmend.dev)",
      },
      signal,
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => {});
      if (!location) throw providerError("DOCUMENT_REDIRECT_INVALID", "The page returned an empty redirect.");
      currentUrl = normalizePublicUrl(new URL(location, currentUrl).href);
      continue;
    }
    return { response, finalUrl: currentUrl };
  }
  throw providerError("DOCUMENT_REDIRECT_LIMIT", "The page exceeded the five redirect audit limit.");
}

function countMatches(html, pattern) {
  return Array.from(html.matchAll(pattern)).length;
}

function tagsNamed(html, name) {
  return Array.from(html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "gi")), (match) => match[0]);
}

function tagAttribute(tag, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const quoted = tag.match(new RegExp(`\\b${escaped}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"));
  if (quoted) return quoted[2].replace(/&amp;/gi, "&").trim();
  return tag.match(new RegExp(`\\b${escaped}\\s*=\\s*([^\\s>]+)`, "i"))?.[1]?.trim() ?? "";
}

function cspResourceInventory(html, finalUrl) {
  const documentOrigin = new URL(finalUrl).origin;
  const buckets = new Map([
    ["script-src", new Set()],
    ["style-src", new Set()],
    ["img-src", new Set()],
    ["font-src", new Set()],
    ["frame-src", new Set()],
    ["media-src", new Set()],
  ]);
  const omitted = Object.fromEntries([...buckets.keys()].map((key) => [key, 0]));
  const add = (directive, reference) => {
    if (!reference || !buckets.has(directive)) return;
    let origin;
    try {
      const parsed = new URL(reference, finalUrl);
      if (!["http:", "https:"].includes(parsed.protocol)) return;
      origin = parsed.origin;
    } catch {
      return;
    }
    if (origin === documentOrigin || buckets.get(directive).has(origin)) return;
    if (buckets.get(directive).size >= CSP_ORIGIN_LIMIT) {
      omitted[directive] += 1;
      return;
    }
    buckets.get(directive).add(origin);
  };
  const addSrcset = (directive, value) => {
    for (const candidate of value.split(",").slice(0, 24)) {
      add(directive, candidate.trim().split(/\s+/)[0]);
    }
  };

  const scripts = tagsNamed(html, "script");
  for (const tag of scripts) add("script-src", tagAttribute(tag, "src"));
  const links = tagsNamed(html, "link");
  for (const tag of links) {
    const rel = tagAttribute(tag, "rel").toLowerCase().split(/\s+/);
    const as = tagAttribute(tag, "as").toLowerCase();
    const href = tagAttribute(tag, "href");
    if (rel.includes("stylesheet")) add("style-src", href);
    if (rel.includes("icon") || rel.includes("apple-touch-icon")) add("img-src", href);
    if (rel.includes("preload") && as === "font") add("font-src", href);
    if ((rel.includes("preload") && as === "script") || rel.includes("modulepreload")) {
      add("script-src", href);
    }
  }
  for (const tag of tagsNamed(html, "img")) {
    add("img-src", tagAttribute(tag, "src"));
    addSrcset("img-src", tagAttribute(tag, "srcset"));
  }
  for (const tag of tagsNamed(html, "iframe")) add("frame-src", tagAttribute(tag, "src"));
  for (const name of ["audio", "video", "source"]) {
    for (const tag of tagsNamed(html, name)) {
      add("media-src", tagAttribute(tag, "src"));
      if (name === "source") addSrcset("img-src", tagAttribute(tag, "srcset"));
    }
  }

  return {
    type: "csp-resource-inventory",
    source: "static-html",
    documentOrigin,
    directives: [...buckets.entries()]
      .filter(([, origins]) => origins.size)
      .map(([directive, origins]) => ({
        directive,
        origins: [...origins].sort(),
        omitted: omitted[directive],
      })),
    inline: {
      scripts: scripts.filter((tag) => !tagAttribute(tag, "src")).length,
      styles:
        tagsNamed(html, "style").length + countMatches(html, /\sstyle\s*=\s*(?:["'][^"']*["']|[^\s>]+)/gi),
    },
    caveat:
      "Observed in the fetched HTML only. Runtime requests, CSS imports, and user journeys may require additional origins.",
  };
}

function discoverDocumentRoutes(html, finalUrl) {
  const documentUrl = new URL(finalUrl);
  const currentPath = documentUrl.pathname || "/";
  const assetPath = /\.(?:avif|css|gif|ico|jpe?g|js|json|map|mp3|mp4|pdf|png|svg|txt|webm|webp|woff2?|xml|zip)$/i;
  const routes = [];
  const seen = new Set();
  for (const tag of tagsNamed(html, "a")) {
    const href = tagAttribute(tag, "href");
    if (!href) continue;
    let candidate;
    try {
      candidate = new URL(href, documentUrl);
    } catch {
      continue;
    }
    if (
      !["http:", "https:"].includes(candidate.protocol) ||
      candidate.origin !== documentUrl.origin
    ) continue;
    const path = candidate.pathname || "/";
    if (
      path === currentPath ||
      path.length > 256 ||
      assetPath.test(path) ||
      seen.has(path)
    ) continue;
    seen.add(path);
    routes.push(path);
  }
  return {
    routes: routes.slice(0, DOCUMENT_PROFILE_ROUTE_LIMIT),
    routesOmitted: Math.max(0, routes.length - DOCUMENT_PROFILE_ROUTE_LIMIT),
  };
}

function createDocumentProfile(html, headers, resourceInventory, finalUrl) {
  const scripts = tagsNamed(html, "script");
  const links = tagsNamed(html, "link");
  const externalOrigins = [...new Set(
    resourceInventory.directives.flatMap((record) => record.origins),
  )].sort();
  const inventoryOmissions = resourceInventory.directives.reduce(
    (total, record) => total + (Number.isFinite(record.omitted) ? record.omitted : 0),
    0,
  );
  const routeDiscovery = discoverDocumentRoutes(html, finalUrl);
  return {
    type: "live-document-profile",
    source: "fetched-html",
    htmlBytes: new TextEncoder().encode(html).byteLength,
    elements: {
      scripts: scripts.length,
      stylesheets: links.filter((tag) =>
        tagAttribute(tag, "rel").toLowerCase().split(/\s+/).includes("stylesheet"),
      ).length,
      images: tagsNamed(html, "img").length,
      links: tagsNamed(html, "a").filter((tag) => Boolean(tagAttribute(tag, "href"))).length,
      forms: tagsNamed(html, "form").length,
      headings: countMatches(html, /<h[1-6]\b[^>]*>/gi),
    },
    inline: { ...resourceInventory.inline },
    externalOrigins: externalOrigins.slice(0, DOCUMENT_PROFILE_ORIGIN_LIMIT),
    externalOriginsOmitted:
      Math.max(0, externalOrigins.length - DOCUMENT_PROFILE_ORIGIN_LIMIT) + inventoryOmissions,
    ...routeDiscovery,
    routesCaveat:
      "Candidates are unique same-origin link paths observed in the fetched HTML. They were not visited or audited by this run.",
    headers: {
      contentType: bounded(headers.get("content-type"), 120),
      contentSecurityPolicy: Boolean(headers.get("content-security-policy")),
      nosniff: /nosniff/i.test(headers.get("x-content-type-options") ?? ""),
    },
    caveat:
      "Counts reflect the bounded fetched HTML and response headers only. Runtime DOM changes, CSS imports, requests, and user journeys are not included.",
  };
}

function documentFinding({ id, severity, category, title, summary, evidence, repair, repairContext }) {
  return {
    id: `document-${id}`,
    severity,
    category,
    focusAreas: focusAreasFor(id, category),
    title,
    summary,
    selector: "Document",
    viewport: "Fetched HTML document",
    evidence,
    repair,
    ...(repairContext ? { repairContext } : {}),
    source: { provider: "Frontmend document audit", auditId: id, strategy: "document" },
  };
}

function inspectDocument(html, headers, finalUrl) {
  const findings = [];
  const checks = [];
  const ruleOutcomes = [];
  const addCheck = (passed, finding) => {
    checks.push(passed);
    ruleOutcomes.push({
      source: {
        provider: "Frontmend document audit",
        auditId: finding.id,
        strategy: "document",
      },
      status: passed ? "passed" : "failed",
    });
    if (!passed && finding) findings.push(documentFinding(finding));
  };
  const htmlTag = html.match(/<html\b[^>]*>/i)?.[0] ?? "";
  const hasLang = /\blang\s*=\s*["'][^"']+["']/i.test(htmlTag);
  addCheck(hasLang, {
    id: "html-lang",
    severity: "medium",
    category: "Document",
    title: "The document language is missing",
    summary: "The fetched HTML does not declare a primary language.",
    evidence: "No non-empty lang attribute was found on the html element.",
    repair: "Set the lang attribute on the html element to the page's primary language.",
  });
  const title = bounded(html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1], 160);
  addCheck(Boolean(title), {
    id: "document-title",
    severity: "high",
    category: "Document",
    title: "The document title is missing",
    summary: "The fetched HTML does not provide a useful page title.",
    evidence: "No non-empty title element was found.",
    repair: "Add a concise, page-specific title element.",
  });
  const metaDescriptionTag = html.match(/<meta\b[^>]*name\s*=\s*["']description["'][^>]*>/i)?.[0]
    ?? html.match(/<meta\b[^>]*content\s*=\s*["'][^"']+["'][^>]*name\s*=\s*["']description["'][^>]*>/i)?.[0];
  const metaDescription = bounded(metaDescriptionTag?.match(/\bcontent\s*=\s*["']([^"']+)["']/i)?.[1], 240);
  addCheck(Boolean(metaDescription), {
    id: "meta-description",
    severity: "medium",
    category: "SEO",
    title: "The page is missing a meta description",
    summary: "The fetched HTML does not provide a page-specific search summary.",
    evidence: "No non-empty meta description was found in the document head.",
    repair: "Add a concise, page-specific meta description that accurately describes the visible content.",
  });
  const viewport = html.match(/<meta\b[^>]*name\s*=\s*["']viewport["'][^>]*>/i)?.[0]
    ?? html.match(/<meta\b[^>]*content\s*=\s*["'][^"']+["'][^>]*name\s*=\s*["']viewport["'][^>]*>/i)?.[0];
  addCheck(Boolean(viewport && /width\s*=\s*device-width/i.test(viewport)), {
    id: "viewport",
    severity: "high",
    category: "Responsive",
    title: "The page is not configured for mobile viewports",
    summary: "The fetched document lacks a width=device-width viewport declaration.",
    evidence: "No responsive viewport declaration was found in the document head.",
    repair: "Add a width=device-width viewport declaration and verify responsive breakpoints.",
  });
  const h1Count = countMatches(html, /<h1\b[^>]*>/gi);
  addCheck(h1Count > 0, {
    id: "missing-h1",
    severity: "medium",
    category: "Accessibility",
    title: "The page has no primary heading",
    summary: "The fetched document has no h1 element to identify its primary topic.",
    evidence: "Observed 0 h1 elements.",
    repair: "Add one descriptive h1 for the page's primary content.",
  });
  addCheck(h1Count <= 1, {
    id: "multiple-h1",
    severity: "low",
    category: "Document",
    title: "The page has multiple primary headings",
    summary: "The fetched document exposes more than one h1 element.",
    evidence: `Observed ${h1Count} h1 elements.`,
    repair: "Confirm the document outline and keep one clear page-level heading where practical.",
  });
  const imageTags = Array.from(html.matchAll(/<img\b[^>]*>/gi), (match) => match[0]);
  const missingAlt = imageTags.filter((tag) => !/\balt\s*=\s*["'][^"']*["']/i.test(tag)).length;
  addCheck(missingAlt === 0, {
    id: "image-alt",
    severity: "high",
    category: "Accessibility",
    title: "Images are missing text alternatives",
    summary: "One or more image elements do not expose an alt attribute.",
    evidence: `Observed ${missingAlt} of ${imageTags.length} image elements without alt attributes.`,
    repair: "Add concise alt text to meaningful images and empty alt text to decorative images.",
  });
  const mainCount = countMatches(html, /<main\b[^>]*>|\brole\s*=\s*["']main["']/gi);
  addCheck(mainCount > 0, {
    id: "main-landmark",
    severity: "medium",
    category: "Accessibility",
    title: "The page has no main landmark",
    summary: "The fetched document does not identify its primary content region.",
    evidence: "No main element or role=main landmark was found.",
    repair: "Wrap the page's primary content in one main landmark.",
  });
  const hasCsp = Boolean(headers.get("content-security-policy"));
  const cspInventory = cspResourceInventory(html, finalUrl);
  addCheck(hasCsp, {
    id: "content-security-policy",
    severity: "low",
    category: "Security",
    title: "No Content Security Policy header was observed",
    summary: "The document response does not declare a Content Security Policy.",
    evidence: "The Content-Security-Policy response header was absent.",
    repair: "Introduce a tested Content Security Policy that permits only required resource origins.",
    repairContext: cspInventory,
  });
  const hasNosniff = /nosniff/i.test(headers.get("x-content-type-options") ?? "");
  addCheck(hasNosniff, {
    id: "nosniff",
    severity: "low",
    category: "Security",
    title: "MIME sniffing protection is missing",
    summary: "The document response does not opt out of browser MIME sniffing.",
    evidence: "The X-Content-Type-Options: nosniff response header was absent.",
    repair: "Send X-Content-Type-Options: nosniff on document and asset responses.",
  });
  return {
    title,
    documentProfile: createDocumentProfile(html, headers, cspInventory, finalUrl),
    findings,
    checks: {
      passed: checks.filter(Boolean).length,
      warnings: findings.filter((finding) => finding.severity === "low").length,
      failed: findings.filter((finding) => finding.severity !== "low").length,
    },
    ruleOutcomes,
    score: Math.round((checks.filter(Boolean).length / checks.length) * 100),
  };
}

async function fetchStrategy({ url, strategy, fetchImpl, apiKey, signal }) {
  const endpoint = new URL(ENDPOINT);
  endpoint.searchParams.set("url", url);
  endpoint.searchParams.set("strategy", strategy);
  endpoint.searchParams.set("locale", "en");
  for (const category of CATEGORY_IDS) {
    endpoint.searchParams.append("category", category);
  }
  if (apiKey) endpoint.searchParams.set("key", apiKey);

  const response = await fetchImpl(endpoint, {
    headers: { accept: "application/json" },
    signal,
  });
  if (!response.ok) {
    await readError(response);
    const rateLimited = response.status === 429;
    throw providerError(
      rateLimited ? "PROVIDER_RATE_LIMITED" : "PROVIDER_FAILED",
      rateLimited
        ? "The live audit provider is busy. Try again in a few minutes."
        : `The live audit provider returned HTTP ${response.status}.`,
    );
  }
  const result = await readProviderJson(response);
  if (!result?.lighthouseResult?.audits || !result?.lighthouseResult?.categories) {
    throw providerError("PROVIDER_INVALID_RESPONSE", "The live audit provider returned incomplete evidence.");
  }
  return result;
}

async function fetchStrategyOutcome({ url, strategy, fetchImpl, apiKey, signal }) {
  const cancellation = cancellableSignal(signal, 90_000);
  try {
    const result = await fetchStrategy({
      url,
      strategy,
      fetchImpl,
      apiKey,
      signal: cancellation.signal,
    });
    return { strategy, result, error: null };
  } catch (error) {
    if (signal?.aborted) {
      throw providerError("AUDIT_CANCELLED", "The audit was cancelled.");
    }
    if (cancellation.timedOut()) {
      return {
        strategy,
        result: null,
        error: providerError(
          "PROVIDER_TIMEOUT",
          `The ${strategy} Lighthouse audit exceeded the 90 second time limit.`,
        ),
      };
    }
    return {
      strategy,
      result: null,
      error: error?.code
        ? error
        : providerError("PROVIDER_FAILED", `The ${strategy} Lighthouse audit failed.`),
    };
  } finally {
    cancellation.cleanup();
  }
}

function viewportFailure(outcome) {
  return {
    id: outcome.strategy,
    label: outcome.strategy === "mobile" ? "Mobile" : "Desktop",
    status: "unavailable",
    code: bounded(outcome.error?.code, 80) || "PROVIDER_FAILED",
    message: bounded(outcome.error?.message, 240) || "Lighthouse evidence was unavailable.",
    recoverable: outcome.error?.recoverable !== false,
  };
}

export async function runPageSpeedAudit({
  auditId,
  url,
  apiKey,
  fetchImpl = fetch,
  onProgress = async () => {},
  now = () => Date.now(),
  signal,
}) {
  throwIfCancelled(signal);
  await onProgress({
    phase: "capture",
    phaseLabel: "Running mobile and desktop Lighthouse audits",
    progress: 18,
  });
  const outcomes = await Promise.all(
    STRATEGIES.map((strategy) =>
      fetchStrategyOutcome({ url, strategy, fetchImpl, apiKey, signal }),
    ),
  );

  throwIfCancelled(signal);
  await onProgress({ phase: "inspect", phaseLabel: "Structuring measured evidence", progress: 82 });
  throwIfCancelled(signal);
  const successful = outcomes.filter((outcome) => outcome.result);
  const failed = outcomes.filter((outcome) => outcome.error);
  if (!successful.length) {
    throw failed[0]?.error ?? providerError("PROVIDER_FAILED", "Lighthouse evidence was unavailable.");
  }
  const results = successful.map((outcome) => outcome.result);
  const findings = [];
  const ruleOutcomes = [];
  for (const { strategy, result } of successful) {
    for (const [id, audit] of Object.entries(result.lighthouseResult.audits)) {
      const outcome = ruleOutcomeFromAudit(id, audit, strategy);
      if (outcome) ruleOutcomes.push(outcome);
      const finding = findingFromAudit(id, audit, strategy, result.lighthouseResult.audits);
      if (finding) findings.push(finding);
    }
  }
  const severityOrder = { high: 0, medium: 1, low: 2 };
  findings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
  const boundedFindings = findings.slice(0, 10);
  const scores = results.map(categoryScores);
  const scoreValues = scores.flatMap((entry) => Object.values(entry));
  const score = scoreValues.length
    ? Math.round(scoreValues.reduce((total, value) => total + value, 0) / scoreValues.length)
    : 0;
  const completedAt = now();
  const finalUrl = bounded(results[0].lighthouseResult.finalUrl, 2048) || url;
  const screenshots = Object.fromEntries(
    successful.flatMap(({ strategy, result }) => {
      const screenshot = screenshotFrom(result);
      return screenshot ? [[strategy, screenshot]] : [];
    }),
  );
  const viewportFailures = failed.map(viewportFailure);
  const partial = viewportFailures.length > 0;

  return {
    screenshots,
    report: {
      schemaVersion: 5,
      auditId,
      url,
      finalUrl,
      hostname: new URL(finalUrl).hostname,
      completedAt,
      score,
      scoreBasis: "measured-lighthouse-viewports",
      viewportCount: successful.length,
      viewports: successful.map(({ strategy }, index) => ({
        id: strategy,
        label: strategy === "mobile" ? "Mobile" : "Desktop",
        detail: "Lighthouse",
        scores: scores[index],
        evidenceUrl: screenshots[strategy]
          ? `/api/audits/${encodeURIComponent(auditId)}/evidence/${strategy}`
          : null,
      })),
      viewportFailures,
      findingCount: findings.length,
      findingsOmitted: Math.max(0, findings.length - boundedFindings.length),
      findings: boundedFindings,
      ruleOutcomes,
      checks: countChecks(results),
      engine: {
        mode: partial ? "live-lighthouse-partial" : "live-lighthouse",
        provider: "PageSpeed Insights",
        ruleSetVersion: 1,
        lighthouseVersion: bounded(results[0].lighthouseResult.lighthouseVersion, 40),
        notice: partial
          ? `Lighthouse evidence retained for ${successful.length} of ${STRATEGIES.length} strategies; ${viewportFailures.map((failure) => failure.label.toLowerCase()).join(" and ")} unavailable.`
          : "Live evidence measured by Lighthouse in mobile and desktop emulation.",
      },
    },
  };
}

export async function runDocumentAudit({
  auditId,
  url,
  fetchImpl = fetch,
  onProgress = async () => {},
  now = () => Date.now(),
  fallbackReason = null,
  signal,
}) {
  const cancellation = cancellableSignal(signal, 25_000);
  try {
    throwIfCancelled(signal);
    await onProgress({
      phase: "inspect",
      phaseLabel: "Inspecting the live HTML document",
      progress: 58,
    });
    const { response, finalUrl } = await fetchPublicDocument({
      url,
      fetchImpl,
      signal: cancellation.signal,
    });
    throwIfCancelled(signal);
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw providerError("DOCUMENT_HTTP_ERROR", `The page returned HTTP ${response.status}.`);
    }
    if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      await response.body?.cancel().catch(() => {});
      throw providerError("DOCUMENT_NOT_HTML", "The public URL did not return an HTML document.");
    }
    const html = await readDocument(response);
    const inspection = inspectDocument(html, response.headers, finalUrl);
    const completedAt = now();
    return {
      screenshots: {},
      report: {
        schemaVersion: 5,
        auditId,
        url,
        finalUrl,
        hostname: new URL(finalUrl).hostname,
        completedAt,
        score: inspection.score,
        viewportCount: 0,
        viewports: [{
          id: "document",
          label: "Document",
          detail: "Live HTML",
          scores: { document: inspection.score },
          evidenceUrl: null,
        }],
        findingCount: inspection.findings.length,
        findingsOmitted: 0,
        findings: inspection.findings,
        documentProfile: inspection.documentProfile,
        ruleOutcomes: inspection.ruleOutcomes,
        checks: inspection.checks,
        engine: {
          mode: "live-document",
          provider: "Frontmend document audit",
          ruleSetVersion: 1,
          lighthouseVersion: null,
          notice: fallbackReason
            ? "Live HTML and response-header evidence. Lighthouse was unavailable for this run."
            : "Live HTML and response-header evidence from the public page.",
          fallbackReason: fallbackReason ? bounded(fallbackReason, 80) : null,
        },
      },
    };
  } catch (error) {
    if (signal?.aborted) {
      throw providerError("AUDIT_CANCELLED", "The audit was cancelled.");
    }
    if (cancellation.timedOut()) {
      throw providerError("DOCUMENT_TIMEOUT", "The live document audit exceeded the 25 second time limit.");
    }
    throw error;
  } finally {
    cancellation.cleanup();
  }
}

function mergeChecks(left = {}, right = {}) {
  return {
    passed: (left.passed ?? 0) + (right.passed ?? 0),
    warnings: (left.warnings ?? 0) + (right.warnings ?? 0),
    failed: (left.failed ?? 0) + (right.failed ?? 0),
  };
}

const DOCUMENT_RULE_ALIASES = Object.freeze({
  "html-lang": "html-has-lang",
});

function canonicalDocumentRuleId(value) {
  return DOCUMENT_RULE_ALIASES[value] ?? value;
}

function supplementalDocumentEvidence(lighthouseReport, documentReport) {
  const measuredLighthouseRules = new Set(
    (lighthouseReport.ruleOutcomes ?? [])
      .filter((outcome) => outcome.source?.provider === "Lighthouse")
      .map((outcome) => outcome.source.auditId),
  );
  const isSupplementalRule = (ruleId) =>
    !measuredLighthouseRules.has(canonicalDocumentRuleId(ruleId));
  const ruleOutcomes = (documentReport.ruleOutcomes ?? []).filter((outcome) =>
    isSupplementalRule(outcome.source?.auditId),
  );
  const findings = (documentReport.findings ?? []).filter((finding) =>
    isSupplementalRule(finding.source?.auditId),
  );
  const warningRules = new Set(
    findings
      .filter((finding) => finding.severity === "low")
      .map((finding) => finding.source?.auditId),
  );
  const checks = { passed: 0, warnings: 0, failed: 0 };
  for (const outcome of ruleOutcomes) {
    if (outcome.status === "passed") checks.passed += 1;
    else if (outcome.status === "failed" && warningRules.has(outcome.source?.auditId)) {
      checks.warnings += 1;
    } else if (outcome.status === "failed") checks.failed += 1;
  }
  return {
    findings,
    ruleOutcomes,
    checks,
    overlappingRulesOmitted:
      (documentReport.ruleOutcomes?.length ?? 0) - ruleOutcomes.length,
  };
}

function mergeHybridEvidence(lighthouse, document) {
  const severityOrder = { high: 0, medium: 1, low: 2 };
  const supplement = supplementalDocumentEvidence(lighthouse.report, document.report);
  const retainedFindings = [
    ...(lighthouse.report.findings ?? []),
    ...supplement.findings,
  ].sort((left, right) => severityOrder[left.severity] - severityOrder[right.severity]);
  const findings = retainedFindings.slice(0, 10);
  const findingCount =
    (lighthouse.report.findingCount ?? lighthouse.report.findings?.length ?? 0) +
    supplement.findings.length;
  const unavailable = (lighthouse.report.viewportFailures ?? [])
    .map((failure) => failure.label.toLowerCase())
    .join(" and ");

  return {
    screenshots: lighthouse.screenshots,
    report: {
      ...lighthouse.report,
      completedAt: document.report.completedAt,
      finalUrl: document.report.finalUrl ?? lighthouse.report.finalUrl,
      hostname: document.report.hostname ?? lighthouse.report.hostname,
      viewports: [
        ...(lighthouse.report.viewports ?? []),
        ...(document.report.viewports ?? []),
      ],
      findingCount,
      findingsOmitted: Math.max(0, findingCount - findings.length),
      findings,
      documentProfile: document.report.documentProfile,
      ruleOutcomes: [
        ...(lighthouse.report.ruleOutcomes ?? []),
        ...supplement.ruleOutcomes,
      ],
      checks: mergeChecks(lighthouse.report.checks, supplement.checks),
      documentSupplement: {
        evaluatedRuleCount: supplement.ruleOutcomes.length,
        overlappingRulesOmitted: supplement.overlappingRulesOmitted,
        caveat:
          "Fetched-document rules already evaluated by the retained Lighthouse strategy were omitted from hybrid totals. Document evidence does not replace the unavailable viewport.",
      },
      engine: {
        mode: "hybrid-lighthouse-document",
        provider: "PageSpeed Insights + Frontmend document audit",
        ruleSetVersion: 1,
        lighthouseVersion: lighthouse.report.engine.lighthouseVersion,
        notice: `Retained Lighthouse evidence for ${lighthouse.report.viewportCount} of ${STRATEGIES.length} strategies; ${unavailable} unavailable. Non-duplicative live HTML and response-header rules supplement the report without replacing the missing viewport.`,
        fallbackReason: "PARTIAL_LIGHTHOUSE",
      },
    },
  };
}

export async function runFrontmendAudit(options) {
  try {
    const lighthouse = await runPageSpeedAudit(options);
    if (lighthouse.report.engine.mode !== "live-lighthouse-partial") return lighthouse;
    try {
      const document = await runDocumentAudit({
        ...options,
        fallbackReason: "PARTIAL_LIGHTHOUSE",
        onProgress: async (state) => {
          const progress = state.progress < 70 ? 86 : 92;
          await options.onProgress?.({
            ...state,
            phaseLabel: "Retaining partial Lighthouse evidence and inspecting live HTML",
            progress,
          });
        },
      });
      return mergeHybridEvidence(lighthouse, document);
    } catch (error) {
      if (error?.code === "AUDIT_CANCELLED") throw error;
      return lighthouse;
    }
  } catch (error) {
    const fallbackCodes = new Set([
      "PROVIDER_RATE_LIMITED",
      "PROVIDER_FAILED",
      "PROVIDER_TIMEOUT",
      "PROVIDER_INVALID_RESPONSE",
    ]);
    if (!fallbackCodes.has(error?.code)) throw error;
    await options.onProgress?.({
      phase: "inspect",
      phaseLabel: "Lighthouse unavailable; switching to live document evidence",
      progress: 42,
    });
    return runDocumentAudit({ ...options, fallbackReason: error.code });
  }
}
