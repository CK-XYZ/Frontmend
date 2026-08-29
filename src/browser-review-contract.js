import { AuditError } from "./url-policy.js";
import {
  compileBrowserInvestigations,
  projectLegacyBrowserCheck,
} from "./browser-investigation-compiler.js";

export const BROWSER_REVIEW_OUTCOMES = Object.freeze(["passed", "issue", "blocked"]);
export const BROWSER_REVIEW_BLOCKER_REASONS = Object.freeze([
  "browser-unavailable",
  "interaction-unsafe",
  "authentication-required",
  "unsupported-capability",
  "target-changed",
]);

export const BROWSER_REVIEW_CHECKS = Object.freeze([
  Object.freeze({
    id: "rendered-structure",
    label: "Rendered structure",
    focusAreas: Object.freeze(["accessibility", "seo"]),
    viewport: "desktop",
    instruction:
      "Inspect the rendered page structure, including landmarks, heading order, accessible names, title, canonical intent, and the primary content an agent can actually observe after load.",
    boundary:
      "Report rendered browser facts only. Do not repeat the provider score or infer hidden source implementation.",
  }),
  Object.freeze({
    id: "primary-journey",
    label: "Primary journey",
    focusAreas: Object.freeze(["accessibility"]),
    viewport: "desktop",
    instruction:
      "Walk the main task through its safe, non-destructive states and inspect labels, instructions, focus order, feedback, and error recovery before any consequential submission.",
    boundary:
      "Do not upload private data, submit a consequential form, purchase, publish, or change account state.",
  }),
  Object.freeze({
    id: "responsive-reflow",
    label: "Responsive reflow",
    focusAreas: Object.freeze(["accessibility"]),
    viewport: "mobile",
    instruction:
      "Inspect the rendered page at a narrow mobile viewport for reflow, zoom-safe content, reachable controls, readable hierarchy, and hidden or clipped primary actions.",
    boundary:
      "Use a real responsive browser viewport and report only what is visible or inspectable there.",
  }),
  Object.freeze({
    id: "search-discovery",
    label: "Search discovery path",
    focusAreas: Object.freeze(["seo"]),
    viewport: "desktop",
    instruction:
      "Inspect whether the rendered primary content, navigation, and same-site discovery path make the page topic and important destinations understandable without relying on Lighthouse output.",
    boundary:
      "Do not claim search ranking, indexing, traffic, or crawler behaviour that was not directly observed.",
  }),
]);

const CHECK_BY_ID = new Map(BROWSER_REVIEW_CHECKS.map((check) => [check.id, check]));
const SEVERITIES = Object.freeze(["high", "medium", "low"]);
const MAX_HISTORY = 8;

function boundedString(value, field, maximum, code = "INVALID_BROWSER_REVIEW") {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new AuditError(code, `${field} must contain 1 to ${maximum} characters.`);
  }
  return value.replace(/\r\n/g, "\n").trim();
}

function boundedId(value, field = "auditId") {
  return boundedString(value, field, 160);
}

function boundedUniqueStrings(value, field, maximumItems, maximumLength) {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximumItems) {
    throw new AuditError(
      "INVALID_BROWSER_REVIEW",
      `${field} must contain between 1 and ${maximumItems} items.`,
    );
  }
  const items = value.map((item) => boundedString(item, field, maximumLength));
  if (new Set(items).size !== items.length) {
    throw new AuditError("INVALID_BROWSER_REVIEW", `${field} must not contain duplicates.`);
  }
  return items;
}

function missionFocusAreas(mission) {
  return Array.isArray(mission?.focusAreas)
    ? mission.focusAreas.filter((area) => area === "accessibility" || area === "seo")
    : [];
}

export function browserReviewRequired(mission) {
  return mission?.requestedBy === "agent" && missionFocusAreas(mission).length > 0;
}

export function browserReviewChecksForMission(mission) {
  const areas = new Set(missionFocusAreas(mission));
  return BROWSER_REVIEW_CHECKS
    .filter((check) => check.focusAreas.some((area) => areas.has(area)))
    .map((check) => ({ ...check, focusAreas: check.focusAreas.filter((area) => areas.has(area)) }));
}

function requestedCheckSnapshot(check, reviewTarget = "/") {
  const task = check?.schemaVersion === 1 && check?.assignment && check?.responseContract
    ? check
    : projectLegacyBrowserCheck(check, reviewTarget);
  const focusArea = task.focusArea === "seo" ? "seo" : task.focusArea === "reliability"
    ? "reliability"
    : task.focusArea === "performance" ? "performance" : "accessibility";
  const viewport = task.viewport === "mobile" ? "mobile" : "desktop";
  const occurrences = Array.isArray(task.trigger?.occurrences)
    ? task.trigger.occurrences.slice(0, 8).map((item) => ({
        findingId: item?.findingId ? boundedString(item.findingId, "task.trigger.occurrences.findingId", 160) : null,
        strategy: ["mobile", "desktop", "document"].includes(item?.strategy) ? item.strategy : viewport,
        selector: item?.selector ? boundedString(item.selector, "task.trigger.occurrences.selector", 200) : null,
        evidence: boundedString(item?.evidence ?? "Retained provider symptom.", "task.trigger.occurrences.evidence", 600),
      }))
    : [];
  return {
    schemaVersion: 1,
    id: boundedString(task.id, "task.id", 80),
    kind: ["provider-confirmation", "coverage-gap", "safe-journey", "verification-replay"].includes(task.kind)
      ? task.kind
      : "coverage-gap",
    label: boundedString(task.label, "task.label", 120),
    focusArea,
    focusAreas: Array.isArray(task.focusAreas) && task.focusAreas.length
      ? task.focusAreas.filter((area) => ["accessibility", "seo", "reliability", "performance"].includes(area))
      : [focusArea],
    viewport,
    target: {
      path: boundedString(task.target?.path ?? "/", "task.target.path", 256),
      viewport,
      affectedViewports: Array.isArray(task.target?.affectedViewports)
        ? [...new Set(task.target.affectedViewports.filter((item) => ["mobile", "desktop", "document"].includes(item)))].slice(0, 3)
        : [viewport],
    },
    trigger: {
      provider: boundedString(task.trigger?.provider ?? "Frontmend", "task.trigger.provider", 120),
      auditId: boundedString(task.trigger?.auditId ?? task.id, "task.trigger.auditId", 160),
      findingId: task.trigger?.findingId ? boundedString(task.trigger.findingId, "task.trigger.findingId", 160) : null,
      ruleId: task.trigger?.ruleId ? boundedString(task.trigger.ruleId, "task.trigger.ruleId", 120) : null,
      selector: task.trigger?.selector ? boundedString(task.trigger.selector, "task.trigger.selector", 200) : null,
      retainedEvidence: boundedString(task.trigger?.retainedEvidence ?? "Retained browser coverage gap.", "task.trigger.retainedEvidence", 600),
      occurrences,
    },
    assignment: {
      goal: boundedString(task.assignment?.goal, "task.assignment.goal", 300),
      instructions: boundedString(task.assignment?.instructions, "task.assignment.instructions", 900),
      boundary: boundedString(task.assignment?.boundary, "task.assignment.boundary", 900),
      completionCriteria: boundedString(task.assignment?.completionCriteria, "task.assignment.completionCriteria", 600),
    },
    responseContract: {
      outcomes: ["passed", "issue", "blocked"],
      observationPrompt: boundedString(task.responseContract?.observationPrompt, "task.responseContract.observationPrompt", 600),
      findingsAllowed: task.responseContract?.findingsAllowed !== false,
      blockerReasons: [...BROWSER_REVIEW_BLOCKER_REASONS],
    },
    instruction: boundedString(task.assignment?.instructions ?? task.instruction, "task.instruction", 900),
    boundary: boundedString(task.assignment?.boundary ?? task.boundary, "task.boundary", 900),
  };
}

function verificationBaselineSnapshot(value) {
  if (!value?.findingId || !value?.title || !value?.evidence || !value?.source) return null;
  return {
    findingId: boundedId(value.findingId, "verificationBaseline.findingId"),
    title: boundedString(value.title, "verificationBaseline.title", 240),
    category: boundedString(value.category ?? "Accessibility", "verificationBaseline.category", 80),
    focusArea: value.focusArea === "seo" ? "seo" : "accessibility",
    selector: boundedString(value.selector ?? "Rendered page", "verificationBaseline.selector", 200),
    evidence: boundedString(value.evidence, "verificationBaseline.evidence", 600),
    repair: boundedString(value.repair ?? "Recheck the original rendered issue.", "verificationBaseline.repair", 600),
    source: {
      provider: boundedString(value.source.provider, "verificationBaseline.source.provider", 120),
      auditId: boundedString(value.source.auditId, "verificationBaseline.source.auditId", 160),
      strategy: boundedString(value.source.strategy, "verificationBaseline.source.strategy", 40),
    },
    browserReviewEvidence: value.browserReviewEvidence?.reviewId
      ? {
          reviewId: boundedId(value.browserReviewEvidence.reviewId, "verificationBaseline.browserReviewEvidence.reviewId"),
          checkId: boundedString(value.browserReviewEvidence.checkId, "verificationBaseline.browserReviewEvidence.checkId", 80),
          checkLabel: boundedString(value.browserReviewEvidence.checkLabel, "verificationBaseline.browserReviewEvidence.checkLabel", 120),
          provenance: "agent-reported-browser",
          reportedAt: value.browserReviewEvidence.reportedAt,
        }
      : null,
  };
}

function resultSnapshot(result) {
  return {
    checkId: result.checkId,
    outcome: result.outcome,
    summary: result.summary,
    observations: [...(result.observations ?? [])],
    findings: (result.findings ?? []).map((finding) => ({
      ...finding,
      focusAreas: [...(finding.focusAreas ?? [])],
      source: { ...(finding.source ?? {}) },
      browserReviewEvidence: { ...(finding.browserReviewEvidence ?? {}) },
      diagnosticEvidence: finding.diagnosticEvidence
        ? {
            ...finding.diagnosticEvidence,
            items: (finding.diagnosticEvidence.items ?? []).map((item) => ({ ...item })),
            missing: [...(finding.diagnosticEvidence.missing ?? [])],
          }
        : null,
    })),
    blockerReason: result.blockerReason ?? null,
    source: result.source,
    sourceChangedByFrontmend: false,
    agentReported: result.agentReported,
    revision: result.revision,
    reportedAt: result.reportedAt,
    taskTrigger: result.taskTrigger
      ? {
          provider: result.taskTrigger.provider,
          auditId: result.taskTrigger.auditId,
          findingId: result.taskTrigger.findingId ?? null,
          ruleId: result.taskTrigger.ruleId ?? null,
          selector: result.taskTrigger.selector ?? null,
          occurrences: (result.taskTrigger.occurrences ?? []).map((item) => ({ ...item })),
        }
      : null,
  };
}

export function browserReviewFindings(review) {
  return (review?.results ?? [])
    .filter((result) => result?.outcome === "issue")
    .flatMap((result) => (result.findings ?? []).map((finding) => ({
      ...finding,
      focusAreas: [...(finding.focusAreas ?? [])],
      source: { ...(finding.source ?? {}) },
      browserReviewEvidence: { ...(finding.browserReviewEvidence ?? {}) },
      diagnosticEvidence: finding.diagnosticEvidence
        ? {
            ...finding.diagnosticEvidence,
            items: (finding.diagnosticEvidence.items ?? []).map((item) => ({ ...item })),
            missing: [...(finding.diagnosticEvidence.missing ?? [])],
          }
        : null,
    })));
}

export function browserReviewState(review) {
  if (!review?.id) {
    return {
      status: "not-opened",
      complete: false,
      requestedCheckCount: 0,
      completedCheckCount: 0,
      issueCount: 0,
      blockedCheckCount: 0,
      nextCheck: null,
    };
  }
  const results = Array.isArray(review.results) ? review.results : [];
  const resultByCheck = new Map(results.map((result) => [result.checkId, result]));
  const requestedChecks = Array.isArray(review.requestedChecks) ? review.requestedChecks : [];
  const blocked = requestedChecks.find((check) => resultByCheck.get(check.id)?.outcome === "blocked");
  const pending = requestedChecks.find((check) => !resultByCheck.has(check.id));
  const nextCheck = blocked ?? pending ?? null;
  const completedCheckCount = results.filter((result) => ["passed", "issue"].includes(result.outcome)).length;
  const blockedCheckCount = results.filter((result) => result.outcome === "blocked").length;
  const issueCount = review.purpose === "verification"
    ? results.filter((result) => result.outcome === "issue").length
    : browserReviewFindings(review).length;
  const complete = requestedChecks.length > 0 && completedCheckCount === requestedChecks.length;
  return {
    status: complete ? "complete" : blocked ? "blocked" : "in-progress",
    complete,
    requestedCheckCount: requestedChecks.length,
    completedCheckCount,
    issueCount,
    blockedCheckCount,
    nextCheck: nextCheck ? requestedCheckSnapshot(nextCheck, review.target) : null,
  };
}

export function browserReviewSnapshot(review) {
  if (!review?.id || ![1, 2].includes(review.schemaVersion)) {
    throw new AuditError("BROWSER_REVIEW_NOT_FOUND", "That browser review does not exist.");
  }
  const target = boundedString(review.target, "target", 2_048);
  const sourceTasks = review.schemaVersion === 1
    ? (review.requestedChecks ?? [])
    : (review.tasks ?? review.requestedChecks ?? []);
  const tasks = sourceTasks.map((check) => requestedCheckSnapshot(check, target));
  const snapshot = {
    schemaVersion: 2,
    taskSchemaVersion: 1,
    migratedFromSchemaVersion: review.schemaVersion === 1 ? 1 : null,
    id: boundedId(review.id, "browserReview.id"),
    auditId: boundedId(review.auditId),
    purpose: review.purpose === "verification" ? "verification" : "assessment",
    target,
    verificationBaseline: review.purpose === "verification"
      ? verificationBaselineSnapshot(review.verificationBaseline)
      : null,
    requestedFocusAreas: missionFocusAreas({ focusAreas: review.requestedFocusAreas }),
    tasks,
    requestedChecks: tasks,
    results: (review.results ?? []).map(resultSnapshot),
    history: (review.history ?? []).slice(-MAX_HISTORY).map(resultSnapshot),
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
  };
  return {
    ...snapshot,
    findings: browserReviewFindings(snapshot),
    state: browserReviewState(snapshot),
    authority: {
      provenance: "agent-reported-browser",
      sourceContentsReceived: false,
      repair: "separate-diagnosis-and-review",
      deployment: "site-owner",
      claim: snapshot.purpose === "verification"
        ? "The replay result is agent-reported browser evidence for the exact retained issue. Frontmend keeps it separate from provider measurement and never infers implementation or deployment from it."
        : "Browser review observations complement provider measurement; they do not prove repository ownership, implementation, deployment, or resolution.",
    },
  };
}

export function createBrowserReviewMission({
  auditId,
  mission,
  report = null,
  documentProfile = report?.documentProfile ?? null,
  target,
  now = Date.now(),
}) {
  if (!browserReviewRequired(mission)) {
    throw new AuditError(
      "BROWSER_REVIEW_NOT_REQUIRED",
      "This assessment does not require an agent-contributed accessibility or SEO browser review.",
    );
  }
  const tasks = compileBrowserInvestigations({ report, documentProfile, mission, target });
  return browserReviewSnapshot({
    schemaVersion: 2,
    id: crypto.randomUUID(),
    auditId: boundedId(auditId),
    purpose: "assessment",
    target: boundedString(target, "target", 2_048),
    requestedFocusAreas: missionFocusAreas(mission),
    tasks,
    results: [],
    history: [],
    createdAt: now,
    updatedAt: now,
  });
}

export function createBrowserVerificationReview({ auditId, verification, target, now = Date.now() }) {
  const baseline = verificationBaselineSnapshot(verification?.browserReplay?.baseline);
  if (!verification?.browserReplay?.required || !baseline) {
    throw new AuditError(
      "BROWSER_REVIEW_NOT_REQUIRED",
      "This verification does not contain a retained browser finding that requires fresh replay.",
    );
  }
  const viewport = baseline.source.strategy === "mobile" ? "mobile" : "desktop";
  const tasks = [{
    schemaVersion: 1,
    id: "fresh-browser-replay",
    kind: "verification-replay",
    label: "Fresh browser replay",
    focusArea: baseline.focusArea,
    focusAreas: [baseline.focusArea],
    viewport,
    target: { path: new URL(target).pathname || "/", viewport, affectedViewports: [viewport] },
    trigger: {
      provider: baseline.source.provider,
      auditId: baseline.source.auditId,
      findingId: baseline.findingId,
      ruleId: baseline.source.auditId,
      selector: baseline.selector,
      retainedEvidence: baseline.evidence,
      occurrences: [{
        findingId: baseline.findingId,
        strategy: baseline.source.strategy,
        selector: baseline.selector,
        evidence: baseline.evidence,
      }],
    },
    assignment: {
      goal: "Replay the exact retained browser issue against the deployed public page.",
      instructions: `Revisit the deployed page at the retained ${viewport} viewport and repeat the exact original ${baseline.browserReviewEvidence?.checkLabel ?? "browser"} check. Compare the retained selector against this bounded baseline symptom: ${baseline.evidence}`,
      boundary: "Report passed only when the exact retained issue is no longer observable, issue when it remains, or blocked with the exact limitation. Do not infer a pass from provider scores, source changes, or deployment claims.",
      completionCriteria: "Return a fresh direct comparison for the retained selector and symptom at the retained viewport.",
    },
    responseContract: {
      outcomes: ["passed", "issue", "blocked"],
      observationPrompt: "Describe only the fresh rendered comparison with the retained symptom.",
      findingsAllowed: false,
      blockerReasons: [...BROWSER_REVIEW_BLOCKER_REASONS],
    },
  }];
  return browserReviewSnapshot({
    schemaVersion: 2,
    id: crypto.randomUUID(),
    auditId: boundedId(auditId),
    purpose: "verification",
    target: boundedString(target, "target", 2_048),
    verificationBaseline: baseline,
    requestedFocusAreas: [baseline.focusArea],
    tasks,
    results: [],
    history: [],
    createdAt: now,
    updatedAt: now,
  });
}

function browserFinding({ review, check, input, finding, index, now }) {
  if (!finding || typeof finding !== "object" || Array.isArray(finding)) {
    throw new AuditError("INVALID_BROWSER_REVIEW", "Each browser finding must be an object.");
  }
  const extra = Object.keys(finding).find(
    (key) => !["title", "severity", "focusArea", "evidence", "suggestedRepair", "element"].includes(key),
  );
  if (extra) throw new AuditError("INVALID_BROWSER_REVIEW", `Unknown browser finding field: ${extra}.`);
  if (!SEVERITIES.includes(finding.severity)) {
    throw new AuditError("INVALID_BROWSER_REVIEW", "finding.severity must be high, medium, or low.");
  }
  if (!check.focusAreas.includes(finding.focusArea)) {
    throw new AuditError(
      "INVALID_BROWSER_REVIEW",
      `finding.focusArea must be one of this check's focus areas: ${check.focusAreas.join(", ")}.`,
    );
  }
  const element = finding.element == null
    ? "Rendered page"
    : boundedString(finding.element, "finding.element", 200);
  const evidence = boundedString(finding.evidence, "finding.evidence", 600);
  return {
    id: `browser:${check.id}:${String(index + 1).padStart(2, "0")}`,
    title: boundedString(finding.title, "finding.title", 240),
    summary: boundedString(input.summary, "summary", 300),
    severity: finding.severity,
    category: finding.focusArea === "seo" ? "SEO" : "Accessibility",
    focusAreas: [finding.focusArea],
    viewport: check.viewport === "mobile" ? "Mobile" : "Desktop",
    selector: element,
    evidence,
    repair: boundedString(finding.suggestedRepair, "finding.suggestedRepair", 600),
    source: {
      provider: "Frontmend browser review",
      auditId: `${check.id}:${String(index + 1).padStart(2, "0")}`,
      strategy: check.viewport,
    },
    browserReviewEvidence: {
      reviewId: review.id,
      checkId: check.id,
      checkLabel: check.label,
      provenance: "agent-reported-browser",
      reportedAt: now,
      trigger: {
        provider: check.trigger.provider,
        auditId: check.trigger.auditId,
        findingId: check.trigger.findingId,
        ruleId: check.trigger.ruleId,
        selector: check.trigger.selector,
        occurrences: check.trigger.occurrences.map((item) => ({ ...item })),
      },
    },
    diagnosticEvidence: {
      kind: "browser-observation",
      completeness: "actionable",
      items: [{ detail: evidence, element }],
      missing: ["repository ownership", "planned verification checks"],
      caveat:
        "This issue was observed and reported through the browser-review mission; it was not generated by Lighthouse and still needs repository mapping before repair.",
    },
  };
}

export function isIdenticalBrowserReviewContribution(reviewValue, input = {}, source = "agent") {
  const review = browserReviewSnapshot(reviewValue);
  const result = review.results.find((item) => item.checkId === input?.checkId);
  if (!result || result.source !== (source === "person" ? "person" : "agent")) return false;
  const normalizeText = (value) => String(value ?? "").trim();
  const submittedFindings = Array.isArray(input.findings)
    ? input.findings.map((finding) => ({
        title: normalizeText(finding?.title),
        severity: finding?.severity,
        focusArea: finding?.focusArea,
        evidence: normalizeText(finding?.evidence),
        suggestedRepair: normalizeText(finding?.suggestedRepair),
        element: normalizeText(finding?.element ?? "Rendered page"),
      }))
    : [];
  const retainedFindings = result.findings.map((finding) => ({
    title: finding.title,
    severity: finding.severity,
    focusArea: finding.focusAreas[0],
    evidence: finding.evidence,
    suggestedRepair: finding.repair,
    element: finding.selector,
  }));
  return result.outcome === input.outcome
    && result.summary === normalizeText(input.summary)
    && JSON.stringify(result.observations) === JSON.stringify(input.observations ?? [])
    && JSON.stringify(retainedFindings) === JSON.stringify(submittedFindings)
    && result.blockerReason === (input.blockerReason ?? null);
}

export function recordBrowserReviewCheck(reviewValue, input = {}, source = "agent", now = Date.now()) {
  const review = browserReviewSnapshot(reviewValue);
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new AuditError("INVALID_BROWSER_REVIEW", "The browser review check must be an object.");
  }
  const extra = Object.keys(input).find(
    (key) => !["checkId", "outcome", "summary", "observations", "findings", "blockerReason"].includes(key),
  );
  if (extra) throw new AuditError("INVALID_BROWSER_REVIEW", `Unknown browser review field: ${extra}.`);
  if (!BROWSER_REVIEW_OUTCOMES.includes(input.outcome)) {
    throw new AuditError("INVALID_BROWSER_REVIEW", "outcome must be passed, issue, or blocked.");
  }
  const state = browserReviewState(review);
  const checkId = boundedString(input.checkId, "checkId", 80);
  if (!state.nextCheck) {
    throw new AuditError("BROWSER_REVIEW_COMPLETE", "Every requested browser review check is already complete.");
  }
  if (checkId !== state.nextCheck.id) {
    throw new AuditError(
      "BROWSER_REVIEW_SEQUENCE",
      `Complete the current ${state.nextCheck.id} browser check before recording another check.`,
    );
  }
  const check = review.requestedChecks.find((item) => item.id === checkId) ?? CHECK_BY_ID.get(checkId);
  if (!check) throw new AuditError("INVALID_BROWSER_REVIEW", "That browser review check is not supported.");
  const summary = boundedString(input.summary, "summary", 300);
  const blocked = input.outcome === "blocked";
  const observations = blocked && input.observations == null
    ? []
    : boundedUniqueStrings(input.observations, "observations", 4, 400);
  let blockerReason = null;
  if (blocked) {
    if (!BROWSER_REVIEW_BLOCKER_REASONS.includes(input.blockerReason)) {
      throw new AuditError(
        "INVALID_BROWSER_REVIEW",
        `blockerReason must be one of: ${BROWSER_REVIEW_BLOCKER_REASONS.join(", ")}.`,
      );
    }
    blockerReason = input.blockerReason;
    if (input.findings != null && input.findings.length) {
      throw new AuditError("INVALID_BROWSER_REVIEW", "A blocked check cannot report browser findings.");
    }
  } else if (input.blockerReason != null) {
    throw new AuditError("INVALID_BROWSER_REVIEW", "blockerReason is accepted only for a blocked check.");
  }
  const rawFindings = input.findings ?? [];
  if (!Array.isArray(rawFindings) || rawFindings.length > 3) {
    throw new AuditError("INVALID_BROWSER_REVIEW", "findings must contain zero to three browser findings.");
  }
  if (review.purpose === "verification" && rawFindings.length) {
    throw new AuditError(
      "INVALID_BROWSER_REVIEW",
      "A verification replay compares the retained finding and must not create a new browser finding.",
    );
  }
  if (review.purpose !== "verification" && input.outcome === "issue" && rawFindings.length < 1) {
    throw new AuditError("INVALID_BROWSER_REVIEW", "An issue outcome must include at least one browser finding.");
  }
  if (input.outcome === "passed" && rawFindings.length) {
    throw new AuditError("INVALID_BROWSER_REVIEW", "A passed check cannot include browser findings.");
  }
  const previous = review.results.find((result) => result.checkId === checkId) ?? null;
  if (previous && previous.outcome !== "blocked") {
    throw new AuditError("BROWSER_REVIEW_CHECK_COMPLETE", "That browser review check is already complete.");
  }
  const result = {
    checkId,
    outcome: input.outcome,
    summary,
    observations,
    findings: rawFindings.map((finding, index) =>
      browserFinding({ review, check, input, finding, index, now })),
    blockerReason,
    source: source === "person" ? "person" : "agent",
    sourceChangedByFrontmend: false,
    agentReported: source !== "person",
    revision: previous ? previous.revision + 1 : 1,
    reportedAt: now,
    taskTrigger: {
      provider: check.trigger.provider,
      auditId: check.trigger.auditId,
      findingId: check.trigger.findingId,
      ruleId: check.trigger.ruleId,
      selector: check.trigger.selector,
      occurrences: check.trigger.occurrences.map((item) => ({ ...item })),
    },
  };
  return browserReviewSnapshot({
    ...review,
    results: [...review.results.filter((item) => item.checkId !== checkId), result],
    history: previous ? [...review.history, previous].slice(-MAX_HISTORY) : review.history,
    updatedAt: now,
  });
}
