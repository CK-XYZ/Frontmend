import { AuditError } from "./url-policy.js";
import {
  browserReviewSnapshot,
  isIdenticalBrowserReviewContribution,
  recordBrowserReviewCheck,
} from "./browser-review-contract.js";
import { requiredCapabilitiesForBrowserTask } from "./agent-capability-contract.js";
import { isPublicResolvedAddress } from "./public-destination-contract.js";

const MAX_CANDIDATE_CHECKS = 5;
const MAX_CANDIDATE_HISTORY = 3;
const PUBLIC_HOST_SUFFIX_BLOCKLIST = Object.freeze([
  ".internal",
  ".intranet",
  ".lan",
  ".local",
  ".localhost",
  ".localdomain",
  ".home",
]);

function invalidOrigin(message) {
  throw new AuditError("INVALID_CANDIDATE_ORIGIN", message);
}

export function normalizeCandidateOrigin(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 2_048) {
    invalidOrigin("candidateOrigin must contain 1 to 2048 characters.");
  }
  const input = value.trim();
  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    invalidOrigin("candidateOrigin must be a valid HTTP or HTTPS origin.");
  }
  if (parsed.username || parsed.password) {
    invalidOrigin("candidateOrigin cannot include credentials.");
  }
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    invalidOrigin("candidateOrigin must be an origin only, without a path, query string, or fragment.");
  }
  if (!/^https?:\/\//i.test(input) || !["http:", "https:"].includes(parsed.protocol)) {
    invalidOrigin("candidateOrigin must use HTTP or HTTPS.");
  }
  const authority = input.slice(input.indexOf("//") + 2).replace(/\/$/, "");
  if (authority.endsWith(":")) invalidOrigin("candidateOrigin contains a malformed port.");

  const hostname = parsed.hostname.toLowerCase();
  const loopback = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  if (loopback) return parsed.origin;
  if (parsed.protocol !== "https:") {
    invalidOrigin("Public candidate origins must use HTTPS; HTTP is allowed only for loopback development.");
  }
  const ipv6 = hostname.startsWith("[");
  if (
    (!hostname.includes(".") && !ipv6)
    || PUBLIC_HOST_SUFFIX_BLOCKLIST.some((suffix) => hostname.endsWith(suffix))
  ) {
    invalidOrigin("Private-network and single-label candidate hosts are not allowed.");
  }
  const ipLiteral = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || ipv6;
  if (ipLiteral && !isPublicResolvedAddress(hostname)) {
    invalidOrigin("Private, loopback, link-local, documentation, benchmark, and multicast candidate addresses are not allowed.");
  }
  return parsed.origin;
}

function bounded(value, maximum, fallback) {
  const text = String(value ?? fallback ?? "").replace(/\r\n/g, "\n").trim();
  return text.slice(0, maximum) || String(fallback ?? "").slice(0, maximum);
}

function candidatePath(value) {
  const path = bounded(value, 256, "/");
  return /^\/(?!\/)[^?#]{0,255}$/.test(path) ? path : "/";
}

function pathForFinding(repair, findingId) {
  const rows = repair?.verificationImpact?.matrix?.rows
    ?? repair?.verificationImpact?.previewRows
    ?? [];
  return candidatePath(rows.find((row) =>
    ["provider-rule", "browser-replay"].includes(row?.proofKind)
    && (row?.findingId === findingId || row?.findingIds?.includes(findingId)))?.path
    ?? repair?.verificationImpact?.targets?.find((target) => target?.root)?.path
    ?? "/");
}

function focusAreaFor(item) {
  const areas = item?.retainedSymptom?.focusAreas ?? item?.scope?.focusAreas ?? [];
  if (areas.includes("reliability") || item?.source?.auditId === "errors-in-console") return "reliability";
  if (areas.includes("performance")) return "performance";
  if (areas.includes("seo")) return "seo";
  return "accessibility";
}

function candidateReplayTask(repair, item, index) {
  const symptom = item?.retainedSymptom ?? {};
  const focusArea = focusAreaFor(item);
  const viewport = item?.source?.strategy === "mobile" ? "mobile" : "desktop";
  const path = pathForFinding(repair, item.findingId);
  const selector = bounded(symptom.selector ?? item?.evidence?.selector, 200, "main landmark");
  const evidence = bounded(
    symptom.measured ?? item?.evidence?.evidence,
    600,
    `The retained ${item?.source?.auditId ?? item?.findingId} finding was present in the approved baseline.`,
  );
  const task = {
    schemaVersion: 1,
    id: `candidate-replay-${index + 1}`,
    kind: "candidate-replay",
    label: `Candidate replay · ${bounded(item?.title, 100, item?.findingId)}`,
    focusArea,
    focusAreas: [focusArea],
    viewport,
    target: { path, viewport, affectedViewports: [viewport] },
    trigger: {
      provider: bounded(item?.source?.provider, 120, "Frontmend retained evidence"),
      auditId: bounded(item?.source?.auditId, 160, item?.findingId),
      findingId: bounded(item?.findingId, 160, `finding-${index + 1}`),
      ruleId: bounded(item?.source?.auditId, 120, item?.findingId),
      selector,
      retainedEvidence: evidence,
      occurrences: [{
        findingId: bounded(item?.findingId, 160, `finding-${index + 1}`),
        strategy: item?.source?.strategy ?? viewport,
        selector,
        evidence,
      }],
    },
    assignment: {
      goal: "Replay the exact retained symptom against the candidate build before deployment.",
      instructions: `Open the candidate route at the retained ${viewport} viewport. Inspect ${selector} and compare it directly with this baseline symptom: ${evidence}`,
      boundary: "Candidate browser evidence only. Do not run a provider audit, inspect repository source, deploy the site, create a new finding, or claim production resolution.",
      completionCriteria: `Return passed only when the retained ${bounded(item?.source?.auditId, 120, "finding")} symptom is no longer observable at this viewport; otherwise return issue or an exact blocker.`,
    },
    responseContract: {
      outcomes: ["passed", "issue", "blocked"],
      observationPrompt: "Describe only the direct candidate-browser comparison with the retained symptom.",
      findingsAllowed: false,
    },
  };
  return { ...task, requiredCapabilities: requiredCapabilitiesForBrowserTask(task) };
}

function candidateGuardrailTask(row, index) {
  const baseline = row?.baseline ?? {};
  const viewport = baseline.viewport === "mobile" ? "mobile" : "desktop";
  const focusArea = ["seo", "reliability", "performance"].includes(baseline.focusArea)
    ? baseline.focusArea
    : "accessibility";
  const task = {
    schemaVersion: 1,
    id: `candidate-guardrail-${index + 1}`,
    kind: "candidate-guardrail",
    label: `Candidate guardrail · ${bounded(baseline.label, 96, row?.source?.auditId ?? "retained browser check")}`,
    focusArea,
    focusAreas: [focusArea],
    viewport,
    target: {
      path: candidatePath(row?.path ?? baseline.target?.path),
      viewport,
      affectedViewports: [viewport],
    },
    trigger: {
      provider: "Frontmend browser review",
      auditId: bounded(baseline.checkId ?? row?.source?.auditId, 160, `candidate-guardrail-${index + 1}`),
      findingId: null,
      ruleId: bounded(baseline.checkId ?? row?.source?.auditId, 120, `candidate-guardrail-${index + 1}`),
      selector: null,
      retainedEvidence: bounded(baseline.summary, 600, "The retained browser guardrail passed before the repair."),
      occurrences: [],
    },
    assignment: {
      goal: `Confirm the retained ${bounded(baseline.label, 100, "browser")} guardrail still passes in the candidate build.`,
      instructions: bounded(
        baseline.assignment?.instructions,
        900,
        `Repeat the retained browser guardrail at the ${viewport} viewport on the candidate route.`,
      ),
      boundary: "Candidate browser evidence only. Do not infer production behaviour, deploy, inspect source, or create a new finding.",
      completionCriteria: bounded(
        baseline.assignment?.completionCriteria,
        600,
        "Return passed only when the retained journey or reflow guardrail still holds; otherwise return issue or an exact blocker.",
      ),
    },
    responseContract: {
      outcomes: ["passed", "issue", "blocked"],
      observationPrompt: "Describe only the direct candidate-browser comparison with the retained guardrail.",
      findingsAllowed: false,
    },
  };
  return { ...task, requiredCapabilities: requiredCapabilitiesForBrowserTask(task) };
}

function compileCandidateTasks(repair) {
  const items = repair?.findingPackage?.items?.length
    ? repair.findingPackage.items.slice(0, 3)
    : [{
        findingId: repair?.findingId,
        title: repair?.findingTitle,
        source: repair?.findingSource,
        scope: repair?.findingScope,
        retainedSymptom: repair?.retainedSymptom ?? repair?.findingEvidence,
        evidence: repair?.findingEvidence,
      }];
  const exact = items.map((item, index) => candidateReplayTask(repair, item, index));
  const rows = repair?.verificationImpact?.matrix?.rows
    ?? repair?.verificationImpact?.previewRows
    ?? [];
  const guardrails = rows
    .filter((row) => row?.proofKind === "browser-guardrail")
    .slice(0, 2)
    .map(candidateGuardrailTask);
  return [...exact, ...guardrails].slice(0, MAX_CANDIDATE_CHECKS);
}

function implementationChecksPassed(repair) {
  const checks = repair?.implementationReceipt?.checks;
  return Boolean(
    repair?.implementationReceipt?.agentReported
    && Array.isArray(checks)
    && checks.length
    && checks.every((check) => check?.status === "passed"),
  );
}

function candidateTuple(review, repair, origin) {
  return review?.repairRevision === (repair?.revision ?? 1)
    && review?.implementationReceiptRevision === repair?.implementationReceipt?.revision
    && review?.candidateOrigin === origin;
}

export function candidateReviewStatus(review) {
  if (!review?.id) return "not-started";
  const snapshot = browserReviewSnapshot(review);
  if (snapshot.state.status === "blocked") return "blocked";
  if (snapshot.results.some((result) => result.outcome === "issue")) return "issues-found";
  if (!snapshot.state.complete) return "in-progress";
  return "checks-passed";
}

export function candidateBrowserTarget(review, task = review?.state?.nextCheck) {
  if (!review?.candidateOrigin || !task?.target?.path) return null;
  return new URL(task.target.path, `${review.candidateOrigin}/`).href;
}

export function candidateReviewSnapshot(review, history = []) {
  if (!review?.id) return null;
  const snapshot = browserReviewSnapshot(review);
  const status = candidateReviewStatus(snapshot);
  const correctionRequired = status === "issues-found";
  const nextTask = correctionRequired ? null : snapshot.state.nextCheck;
  return {
    ...snapshot,
    status,
    correctionRequired,
    nextTask,
    browserTargetUrl: candidateBrowserTarget(snapshot, nextTask),
    requiredCapabilities: [...(nextTask?.requiredCapabilities ?? [])],
    evidenceBoundary: "Candidate evidence is attributed pre-production browser observation only. It is not a provider audit, deployment attestation, production verification, or resolution claim.",
    historySummary: (Array.isArray(history) ? history : []).slice(-MAX_CANDIDATE_HISTORY).map((item) => ({
      id: item.id,
      repairRevision: item.repairRevision,
      implementationReceiptRevision: item.implementationReceiptRevision,
      candidateOrigin: item.candidateOrigin,
      status: candidateReviewStatus(item),
      completedCheckCount: item.state?.completedCheckCount ?? browserReviewSnapshot(item).state.completedCheckCount,
      requestedCheckCount: item.state?.requestedCheckCount ?? browserReviewSnapshot(item).state.requestedCheckCount,
      updatedAt: item.updatedAt,
      issueSummaries: browserReviewSnapshot(item).results
        .filter((result) => result.outcome === "issue")
        .slice(0, 3)
        .map((result) => bounded(result.summary, 300)),
    })),
    nextAction: correctionRequired
      ? { tool: "record_repository_implementation", reason: "Correct the candidate issue within the approved repository scope, rerun the retained checks, and record a new implementation receipt." }
      : nextTask
      ? { tool: "record_candidate_review_check", checkId: nextTask.id }
      : null,
  };
}

function candidateIssuePacket(review, result) {
  const task = review.tasks.find((item) => item.id === result.checkId);
  if (!task) return null;
  return {
    checkId: result.checkId,
    label: bounded(task.label, 120, result.checkId),
    kind: task.kind,
    browserTargetUrl: candidateBrowserTarget(review, task),
    target: {
      path: candidatePath(task.target?.path),
      viewport: task.viewport === "mobile" ? "mobile" : "desktop",
      selectorOrLandmark: bounded(task.trigger?.selector, 200, "Retained landmark or journey"),
    },
    retainedSymptom: {
      findingId: task.trigger?.findingId ?? null,
      provider: bounded(task.trigger?.provider, 120, "Frontmend retained evidence"),
      ruleId: bounded(task.trigger?.ruleId, 120, task.trigger?.auditId ?? result.checkId),
      evidence: bounded(task.trigger?.retainedEvidence, 600, "The retained baseline symptom requires an exact candidate replay."),
    },
    candidateObservation: {
      summary: bounded(result.summary, 300),
      observations: (result.observations ?? []).slice(0, 4).map((item) => bounded(item, 400)),
      source: result.source === "person" ? "person" : "agent",
      sourceChangedByFrontmend: false,
      reportedAt: result.reportedAt,
    },
    acceptanceCriteria: bounded(task.assignment?.completionCriteria, 600),
    requiredCapabilities: [...(task.requiredCapabilities ?? [])],
  };
}

export function candidateCorrectionPacket(repair) {
  if (!repair?.candidateReview?.id) return null;
  const review = candidateReviewSnapshot(repair.candidateReview, repair.candidateReviewHistory);
  if (review.status !== "issues-found") return null;
  const issues = review.results
    .filter((result) => result.outcome === "issue")
    .map((result) => candidateIssuePacket(review, result))
    .filter(Boolean)
    .slice(0, MAX_CANDIDATE_CHECKS);
  if (!issues.length) return null;
  return {
    schemaVersion: 1,
    auditId: repair.auditId,
    repairId: repair.id,
    revisionBinding: {
      repairRevision: review.repairRevision,
      implementationReceiptRevision: review.implementationReceiptRevision,
      candidateReviewId: review.id,
    },
    candidateOrigin: review.candidateOrigin,
    iteration: Math.min(MAX_CANDIDATE_HISTORY + 1, (repair.candidateReviewHistory?.length ?? 0) + 1),
    issues,
    approvedRepositoryScope: {
      files: (repair.repositoryPlan?.files ?? []).slice(0, 8),
      checks: (repair.repositoryPlan?.checks ?? []).slice(0, 8),
      source: repair.repositoryPlan?.source === "agent" ? "agent" : "reviewed-repair",
      sourceChangedByFrontmend: false,
    },
    previousImplementation: repair.implementationReceipt?.agentReported
      ? {
          revision: repair.implementationReceipt.revision ?? 1,
          files: (repair.implementationReceipt.files ?? []).slice(0, 8),
          checks: (repair.implementationReceipt.checks ?? []).slice(0, 8).map((check) => ({ ...check })),
          commitSha: repair.implementationReceipt.commitSha ?? null,
          source: "agent",
          sourceChangedByFrontmend: false,
        }
      : null,
    nextAction: {
      tool: "record_repository_implementation",
      input: { repairId: repair.id },
      reason: "Correct only the observed candidate issue within the approved repository scope, rerun the reviewed checks, and record a newer implementation receipt.",
    },
    evidenceBoundary: "This packet links retained baseline evidence to attributed candidate-browser observations. It is not source inspection, a new finding, deployment evidence, production verification, or a resolution claim.",
  };
}

export function openCandidateReview(repair, input = {}, source = "agent", now = Date.now()) {
  if (!repair?.id) throw new AuditError("REPAIR_NOT_FOUND", "That repair draft does not exist.");
  if (repair.status !== "approved") {
    throw new AuditError("REPAIR_NOT_APPROVED", "Approve the repair before opening candidate browser review.");
  }
  if (!implementationChecksPassed(repair)) {
    throw new AuditError(
      "IMPLEMENTATION_CHECKS_REQUIRED",
      "Record a latest repository implementation receipt whose checks all passed before opening candidate review.",
    );
  }
  if (Number.isFinite(repair.deploymentAttestedAt)) {
    throw new AuditError(
      "CANDIDATE_REVIEW_PREDEPLOYMENT_ONLY",
      "Candidate review is a pre-deployment check; use the existing fresh public verification flow after deployment.",
    );
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new AuditError("INVALID_CANDIDATE_REVIEW", "Candidate review input must be an object.");
  }
  const extra = Object.keys(input).find((key) => key !== "candidateOrigin");
  if (extra) throw new AuditError("INVALID_CANDIDATE_REVIEW", `Unknown candidate review field: ${extra}.`);
  if (!['agent', 'person'].includes(source)) {
    throw new AuditError("INVALID_CANDIDATE_REVIEW", "Candidate review must identify an agent or person source.");
  }
  const candidateOrigin = normalizeCandidateOrigin(input.candidateOrigin);
  if (candidateTuple(repair.candidateReview, repair, candidateOrigin)) return repair;
  if (
    repair.candidateReview?.id
    && repair.candidateReview.repairRevision === (repair.revision ?? 1)
    && repair.candidateReview.implementationReceiptRevision === repair.implementationReceipt?.revision
  ) {
    throw new AuditError(
      "CANDIDATE_REVIEW_EXISTS",
      "This implementation revision already has a candidate review. Record a newer implementation receipt before reviewing a different candidate origin.",
    );
  }
  const tasks = compileCandidateTasks(repair);
  if (!tasks.length) {
    throw new AuditError("CANDIDATE_REVIEW_NOT_REQUIRED", "No retained browser checks are available for this repair.");
  }
  return {
    ...repair,
    candidateReview: browserReviewSnapshot({
      schemaVersion: 2,
      id: crypto.randomUUID(),
      auditId: repair.auditId,
      purpose: "candidate",
      target: candidateOrigin,
      candidateOrigin,
      repairId: repair.id,
      repairRevision: repair.revision ?? 1,
      implementationReceiptRevision: repair.implementationReceipt.revision,
      openedBy: source,
      requestedFocusAreas: [...new Set(tasks.map((task) => task.focusArea))],
      tasks,
      results: [],
      history: [],
      createdAt: now,
      updatedAt: now,
    }),
    candidateReviewHistory: [
      ...(repair.candidateReviewHistory ?? []),
      ...(repair.candidateReview?.id ? [repair.candidateReview] : []),
    ].slice(-MAX_CANDIDATE_HISTORY),
    updatedAt: now,
  };
}

export function isIdenticalCandidateReviewContribution(repair, reviewId, input, source = "agent") {
  return repair?.candidateReview?.id === reviewId
    && isIdenticalBrowserReviewContribution(repair.candidateReview, input, source);
}

export function recordCandidateReviewCheck(repair, reviewId, input = {}, source = "agent", now = Date.now()) {
  if (!repair?.candidateReview || repair.candidateReview.id !== reviewId) {
    throw new AuditError("CANDIDATE_REVIEW_NOT_FOUND", "That candidate browser review does not exist.");
  }
  if (
    repair.candidateReview.repairRevision !== (repair.revision ?? 1)
    || repair.candidateReview.implementationReceiptRevision !== repair.implementationReceipt?.revision
  ) {
    throw new AuditError(
      "CANDIDATE_REVIEW_STALE",
      "This candidate review belongs to an older repair or implementation revision. Open a new review.",
    );
  }
  if (
    repair.candidateReview.results?.some((result) => result.outcome === "issue")
    && !isIdenticalBrowserReviewContribution(repair.candidateReview, input, source)
  ) {
    throw new AuditError(
      "CANDIDATE_CORRECTION_REQUIRED",
      "This candidate iteration found an issue. Correct it, record a newer implementation receipt, and open the next candidate review.",
    );
  }
  return {
    ...repair,
    candidateReview: recordBrowserReviewCheck(repair.candidateReview, input, source, now),
    updatedAt: now,
  };
}

export function archiveCandidateReviewForNewImplementation(repair) {
  if (!repair?.candidateReview?.id) {
    return {
      candidateReview: null,
      candidateReviewHistory: (repair?.candidateReviewHistory ?? []).slice(-MAX_CANDIDATE_HISTORY),
    };
  }
  return {
    candidateReview: null,
    candidateReviewHistory: [
      ...(repair.candidateReviewHistory ?? []),
      repair.candidateReview,
    ].slice(-MAX_CANDIDATE_HISTORY),
  };
}

export const candidateReviewLimits = Object.freeze({
  maxChecks: MAX_CANDIDATE_CHECKS,
  maxHistory: MAX_CANDIDATE_HISTORY,
});
