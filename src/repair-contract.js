import { AuditError } from "./url-policy.js";
import { createBuildDescriptor } from "./protocol-contract.js";
import {
  reviewRepairVerificationImpact,
  selectRepairVerificationTargets,
  verificationCandidateProjection,
} from "./verification-impact-contract.js";
import {
  archiveCandidateReviewForNewImplementation,
  candidateCorrectionPacket,
  candidateReviewSnapshot,
  candidateReviewStatus,
} from "./candidate-review-contract.js";

export const PATCH_TYPES = Object.freeze([
  "html",
  "css",
  "javascript",
  "headers",
  "configuration",
  "guidance",
]);
export const REPAIR_RISKS = Object.freeze(["low", "medium", "high"]);
const MAX_LINEAGE_ENTRIES = 8;
const MAX_REPAIR_REVISIONS = 5;
const MAX_IMPLEMENTATION_RECEIPTS = 5;
const IMPLEMENTATION_CHECK_STATUSES = Object.freeze(["passed", "failed", "not-run"]);
const AUTO_APPROVAL_LIMIT = 3;
const AUTO_APPROVED_PATCH_TYPES = Object.freeze(["html", "css"]);

export function repairPolicySnapshot(policy = null) {
  const auto = policy?.mode === "auto-low-risk";
  return {
    version: 1,
    mode: auto ? "auto-low-risk" : "review",
    grantedBy: auto ? "person" : null,
    enabledAt: auto && Number.isFinite(policy?.enabledAt) ? policy.enabledAt : null,
    remainingAutoApprovals: auto && Number.isInteger(policy?.remainingAutoApprovals)
      ? Math.max(0, Math.min(AUTO_APPROVAL_LIMIT, policy.remainingAutoApprovals))
      : 0,
    riskCeiling: auto ? "low" : null,
    allowedPatchTypes: auto ? [...AUTO_APPROVED_PATCH_TYPES] : [],
    requiresRepositoryPlan: auto,
    deploymentAttestation: "person-only",
  };
}

export function createRepairPolicy(input = {}, now = Date.now()) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new AuditError("INVALID_REPAIR_POLICY", "The repair policy must be an object.");
  }
  const extra = Object.keys(input).find((key) => key !== "mode");
  if (extra || !["review", "auto-low-risk"].includes(input.mode)) {
    throw new AuditError(
      "INVALID_REPAIR_POLICY",
      "mode must be review or auto-low-risk and no other policy fields are accepted.",
    );
  }
  if (input.mode === "review") return repairPolicySnapshot();
  return repairPolicySnapshot({
    mode: "auto-low-risk",
    enabledAt: now,
    remainingAutoApprovals: AUTO_APPROVAL_LIMIT,
  });
}

export function applyRepairPolicy(repair, policy, now = Date.now()) {
  const currentPolicy = repairPolicySnapshot(policy);
  const reasons = [];
  if (currentPolicy.mode !== "auto-low-risk") reasons.push("auto mode is not enabled");
  if (currentPolicy.remainingAutoApprovals < 1) reasons.push("the auto-approval allowance is exhausted");
  if (repair?.source !== "agent") reasons.push("the proposal was not submitted by an agent");
  if ((repair?.findingIds?.length ?? 1) > 1) {
    reasons.push("multi-finding packages require explicit review");
  }
  if (repair?.risk !== "low") reasons.push("only low-risk proposals are eligible");
  if (!AUTO_APPROVED_PATCH_TYPES.includes(repair?.patchType)) {
    reasons.push("only HTML and CSS proposals are eligible");
  }
  if (!repair?.repositoryPlan?.files?.length || !repair?.repositoryPlan?.checks?.length) {
    reasons.push("an agent-authored repository plan is required");
  }
  if (reasons.length) {
    return {
      repair: {
        ...repair,
        automation: {
          eligible: false,
          evaluatedAt: now,
          reasons,
          policyMode: currentPolicy.mode,
        },
      },
      policy: currentPolicy,
    };
  }
  return {
    repair: {
      ...repair,
      verificationImpact: repair.verificationImpact
        ? reviewRepairVerificationImpact(
            repair.verificationImpact,
            "delegated-auto-policy",
            now,
          )
        : null,
      status: "approved",
      requiresHumanReview: false,
      reviewedAt: now,
      approval: {
        mode: "delegated-auto",
        grantedBy: "person",
        policyEnabledAt: currentPolicy.enabledAt,
        approvedAt: now,
      },
      automation: {
        eligible: true,
        evaluatedAt: now,
        reasons: [],
        policyMode: currentPolicy.mode,
      },
    },
    policy: {
      ...currentPolicy,
      remainingAutoApprovals: currentPolicy.remainingAutoApprovals - 1,
    },
  };
}

function boundedString(value, field, maximum, { required = true } = {}) {
  if (typeof value !== "string") {
    if (!required && value == null) return "";
    throw new AuditError("INVALID_REPAIR", `${field} must be a string.`);
  }
  const result = value.replace(/\r\n/g, "\n").trim();
  if ((required && !result) || result.length > maximum) {
    throw new AuditError(
      "INVALID_REPAIR",
      `${field} must contain ${required ? `1 to ${maximum}` : `at most ${maximum}`} characters.`,
    );
  }
  return result;
}

function repositoryRelativePath(value, errorCode = "INVALID_IMPLEMENTATION_RECEIPT") {
  const path = boundedString(value, "file path", 200).replace(/\\/g, "/");
  const segments = path.split("/");
  if (
    path.startsWith("/") ||
    /^[a-z]:\//i.test(path) ||
    path.includes(":") ||
    segments.some((segment) => !segment || segment === "." || segment === "..") ||
    /[\u0000-\u001f\u007f]/.test(path)
  ) {
    throw new AuditError(
      errorCode,
      "files must contain repository-relative paths without parent traversal.",
    );
  }
  return path;
}

function boundedUniqueList(
  value,
  field,
  maximum,
  normalize,
  errorCode = "INVALID_IMPLEMENTATION_RECEIPT",
) {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum) {
    throw new AuditError(
      errorCode,
      `${field} must contain between 1 and ${maximum} items.`,
    );
  }
  const result = value.map(normalize);
  if (new Set(result.map((item) => JSON.stringify(item))).size !== result.length) {
    throw new AuditError(errorCode, `${field} must not contain duplicates.`);
  }
  return result;
}

function repositoryPlanForProposal(input, existing = null, source = "agent") {
  const hasFiles = input.repositoryFiles !== undefined;
  const hasChecks = input.repositoryChecks !== undefined;
  if (!hasFiles && !hasChecks) {
    return existing
      ? {
          files: [...existing.files],
          checks: [...existing.checks],
          source: "agent",
          sourceChangedByFrontmend: false,
        }
      : null;
  }
  if (source !== "agent") {
    throw new AuditError(
      "INVALID_REPAIR",
      "Repository files and checks may be attached only by a coding agent with repository access.",
    );
  }
  const files = boundedUniqueList(
    hasFiles ? input.repositoryFiles : existing?.files,
    "repositoryFiles",
    8,
    (value) => repositoryRelativePath(value, "INVALID_REPAIR"),
    "INVALID_REPAIR",
  );
  const checks = boundedUniqueList(
    hasChecks ? input.repositoryChecks : existing?.checks,
    "repositoryChecks",
    8,
    (value) => boundedString(value, "repository check", 120),
    "INVALID_REPAIR",
  );
  return {
    files,
    checks,
    source: "agent",
    sourceChangedByFrontmend: false,
  };
}

const CSP_DIRECTIVES = Object.freeze([
  "script-src",
  "style-src",
  "img-src",
  "font-src",
  "frame-src",
  "media-src",
]);

function safeCspOrigins(context) {
  if (context?.type !== "csp-resource-inventory" || !Array.isArray(context.directives)) return [];
  let remaining = 18;
  const result = [];
  for (const directive of CSP_DIRECTIVES) {
    const record = context.directives.find((item) => item?.directive === directive);
    if (!record || !Array.isArray(record.origins) || remaining <= 0) continue;
    const origins = [];
    for (const value of record.origins) {
      if (remaining <= 0 || typeof value !== "string") break;
      try {
        const parsed = new URL(value);
        if (!["http:", "https:"].includes(parsed.protocol) || parsed.origin !== value) continue;
        origins.push(value);
        remaining -= 1;
      } catch {
        // Ignore malformed provider context instead of emitting it into a header proposal.
      }
    }
    if (origins.length) result.push({ directive, origins });
  }
  return result;
}

function cspTemplateForFinding(finding) {
  const context = finding?.repairContext;
  const observed = safeCspOrigins(context);
  const inlineScripts = Number.isFinite(context?.inline?.scripts)
    ? Math.max(0, Math.round(context.inline.scripts))
    : 0;
  const inlineStyles = Number.isFinite(context?.inline?.styles)
    ? Math.max(0, Math.round(context.inline.styles))
    : 0;
  const notes = [
    "# Candidate derived from fetched HTML only. Start in Report-Only and observe real user journeys.",
  ];
  if (inlineScripts || inlineStyles) {
    notes.push(
      `# Inline evidence: ${inlineScripts} script block${inlineScripts === 1 ? "" : "s"}, ${inlineStyles} style block/attribute${inlineStyles === 1 ? "" : "s"}. Use nonces or hashes before enforcement.`,
    );
  }
  const directives = [
    "default-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    ...observed.map(({ directive, origins }) => `${directive} 'self' ${origins.join(" ")}`),
  ];
  return {
    patchType: "headers",
    risk: "high",
    patch: `${notes.join("\n")}\nContent-Security-Policy-Report-Only: ${directives.join("; ")}`,
    verificationPlan:
      "Deploy in Report-Only mode, exercise critical user journeys, collect policy violations, add only confirmed runtime origins plus nonces or hashes, then enforce the policy and rerun the exact live response-header check.",
  };
}

function templateForFinding(finding) {
  const rule = finding?.source?.auditId ?? "";
  const templates = {
    "content-security-policy": {
      ...cspTemplateForFinding(finding),
    },
    nosniff: {
      patchType: "headers",
      risk: "low",
      patch: "X-Content-Type-Options: nosniff",
      verificationPlan:
        "Deploy the response header, request the public document again, and require the nosniff check to pass.",
    },
    "html-lang": {
      patchType: "html",
      risk: "low",
      patch: '<html lang="[language-code]">',
      verificationPlan:
        "Replace the placeholder with the page language, deploy, and require the document-language check to pass.",
    },
    "document-title": {
      patchType: "html",
      risk: "low",
      patch: "<title>[concise page-specific title]</title>",
      verificationPlan:
        "Replace the placeholder with an accurate title, deploy, and require the document-title check to pass.",
    },
    viewport: {
      patchType: "html",
      risk: "low",
      patch: '<meta name="viewport" content="width=device-width, initial-scale=1">',
      verificationPlan:
        "Add the declaration to the document head, deploy, and rerun the mobile viewport check.",
    },
    "image-alt": {
      patchType: "html",
      risk: "medium",
      patch:
        '<!-- Use accurate text for meaningful images; decorative images use alt="". -->\n<img src="…" alt="[describe this image purpose]">',
      verificationPlan:
        "Review every affected image in context, deploy accurate alternatives, and rerun the image-alt check.",
    },
    "main-landmark": {
      patchType: "html",
      risk: "low",
      patch: "<main>\n  <!-- primary page content -->\n</main>",
      verificationPlan:
        "Wrap only the primary content, deploy, and require exactly one useful main landmark in the next audit.",
    },
    "missing-h1": {
      patchType: "html",
      risk: "low",
      patch: "<h1>[primary page heading]</h1>",
      verificationPlan:
        "Add a visible page-level heading that matches the content, deploy, and rerun the document outline check.",
    },
  };
  return templates[rule] ?? {
    patchType: "guidance",
    risk: finding?.severity === "high" ? "medium" : "low",
    patch: finding?.repair ?? "Review and implement the measured repair in the site source.",
    verificationPlan:
      "Deploy the reviewed change, then rerun the same public URL and compare the original measured rule under equivalent audit conditions.",
  };
}

function briefText(value, maximum = 300) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maximum) : "";
}

function publicPathFromUrl(value) {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.pathname : null;
  } catch {
    return null;
  }
}

function diagnosticEvidenceSnapshot(value) {
  if (!value || value.provenance !== "measured-lighthouse") return null;
  const base = {
    version: 1,
    kind: briefText(value.kind, 80),
    provenance: "measured-lighthouse",
    completeness: value.completeness === "actionable" ? "actionable" : "partial",
    missing: Array.isArray(value.missing)
      ? value.missing.slice(0, 5).map((item) => briefText(item, 100)).filter(Boolean)
      : [],
    omitted: Number.isFinite(value.omitted) ? Math.max(0, Math.min(1000, Math.round(value.omitted))) : 0,
    caveat: briefText(value.caveat, 360),
  };
  if (base.kind === "console-errors") {
    return {
      ...base,
      entries: (Array.isArray(value.entries) ? value.entries : []).slice(0, 5).map((entry) => ({
        description: briefText(entry?.description, 320),
        source: briefText(entry?.source, 80) || null,
        sourceUrl: briefText(entry?.sourceUrl, 240) || null,
        lineNumber: Number.isFinite(entry?.lineNumber) ? entry.lineNumber : null,
        columnNumber: Number.isFinite(entry?.columnNumber) ? entry.columnNumber : null,
      })),
    };
  }
  if (base.kind === "contrast-nodes") {
    return {
      ...base,
      nodes: (Array.isArray(value.nodes) ? value.nodes : []).slice(0, 5).map((node) => ({
        selector: briefText(node?.selector, 160),
        nodeLabel: briefText(node?.nodeLabel, 160) || null,
        snippet: briefText(node?.snippet, 260) || null,
        explanation: briefText(node?.explanation, 360) || null,
        observedRatio: Number.isFinite(node?.observedRatio) ? node.observedRatio : null,
        expectedRatio: Number.isFinite(node?.expectedRatio) ? node.expectedRatio : null,
      })),
    };
  }
  if (base.kind === "main-thread-blocking") {
    return {
      ...base,
      totalBlockingTimeMs: Number.isFinite(value.totalBlockingTimeMs) ? value.totalBlockingTimeMs : null,
      longTasks: (Array.isArray(value.longTasks) ? value.longTasks : []).slice(0, 5).map((task) => ({
        durationMs: Number.isFinite(task?.durationMs) ? task.durationMs : null,
        startTimeMs: Number.isFinite(task?.startTimeMs) ? task.startTimeMs : null,
        sourceUrl: briefText(task?.sourceUrl, 240) || null,
      })),
    };
  }
  return null;
}

function repositorySourceHints(patchType) {
  const hints = {
    headers: [
      "Framework or edge response-header configuration",
      "Middleware that owns document responses",
      "Hosting configuration applied to the audited route",
    ],
    configuration: [
      "Framework configuration",
      "Build or deployment configuration",
      "Environment-specific configuration affecting the public route",
    ],
    html: [
      "Root document or application shell",
      "Route-level layout or metadata component",
      "Shared template that renders the measured element",
    ],
    css: [
      "Component styles for the measured selector",
      "Shared design tokens or theme variables",
      "Responsive styles active for the measured viewport",
    ],
    javascript: [
      "Component or route logic that owns the measured interaction",
      "Client initialization and error handling",
      "Third-party integration boundary involved in the evidence",
    ],
    guidance: [
      "Repository code that owns the measured public behaviour",
      "Existing tests for the affected route or rule",
      "Deployment configuration needed to expose the change publicly",
    ],
  };
  return hints[patchType] ?? hints.guidance;
}

export function createRepositoryFixBrief(
  report,
  findingId,
  findingCandidates = report?.findings,
  verificationImpact = null,
  diagnosticMissions = [],
) {
  if (!report || typeof report !== "object") {
    throw new AuditError("AUDIT_REPORT_UNAVAILABLE", "A completed audit report is required.");
  }
  const retainedFindings = Array.isArray(findingCandidates) ? findingCandidates : [];
  const finding = retainedFindings.length
    ? retainedFindings.find((candidate) => candidate?.id === findingId)
    : null;
  if (!finding) throw new AuditError("FINDING_NOT_FOUND", "That audit finding does not exist.");
  const template = templateForFinding(finding);
  const source = finding.source ?? {};
  const finalUrl = briefText(report.finalUrl ?? report.url, 2_048);
  const sameRule = (candidate) =>
    candidate?.source?.provider === source.provider &&
    candidate?.source?.auditId === source.auditId;
  const matchingFindings = retainedFindings.filter(sameRule);
  const allOccurrences = matchingFindings.flatMap((candidate) =>
    Array.isArray(candidate?.occurrences) && candidate.occurrences.length
      ? candidate.occurrences.map((occurrence) => ({
          occurrenceId: briefText(occurrence.occurrenceId, 80) || null,
          findingId: briefText(candidate.id, 160),
          sourceFindingId: briefText(occurrence.sourceFindingId, 160) || null,
          auditId: briefText(occurrence.auditId, 160) || null,
          path: briefText(occurrence.path, 256) || "/",
          url: briefText(occurrence.url, 2_048) || null,
          strategy: briefText(occurrence.strategy, 40),
          viewport: briefText(occurrence.viewport ?? occurrence.strategy, 100),
          selector: briefText(occurrence.selector, 200) || null,
          measured: briefText(occurrence.evidence, 300),
          severity: briefText(candidate.severity, 20),
          evidenceIds: Array.isArray(occurrence.evidenceIds)
            ? occurrence.evidenceIds.slice(0, 4).map((item) => briefText(item, 240))
            : [],
          diagnostics: diagnosticEvidenceSnapshot(candidate.diagnosticEvidence),
        }))
      : [{
          occurrenceId: null,
          findingId: briefText(candidate.id, 160),
          sourceFindingId: null,
          auditId: briefText(candidate.route?.auditId, 160) || briefText(report.auditId, 160),
          path: briefText(candidate.route?.path, 256) || publicPathFromUrl(finalUrl),
          url: briefText(candidate.route?.url, 2_048) || finalUrl,
          strategy: briefText(candidate.source?.strategy, 40),
          viewport: briefText(candidate.viewport, 100),
          selector: briefText(candidate.selector, 200) || null,
          measured: briefText(candidate.evidence, 300),
          severity: briefText(candidate.severity, 20),
          evidenceIds: [],
          diagnostics: diagnosticEvidenceSnapshot(candidate.diagnosticEvidence),
        }]);
  const uniqueOccurrences = allOccurrences.filter((occurrence, index, values) =>
    values.findIndex((candidate) =>
      (occurrence.occurrenceId && candidate.occurrenceId === occurrence.occurrenceId)
      || (!occurrence.occurrenceId
        && candidate.auditId === occurrence.auditId
        && candidate.sourceFindingId === occurrence.sourceFindingId
        && candidate.strategy === occurrence.strategy
        && candidate.selector === occurrence.selector)) === index);
  const occurrences = uniqueOccurrences.slice(0, 8);
  const diagnosis = diagnosticMissions.find((mission) => mission?.findingId === finding.id) ?? null;
  const contributedDiagnosis = diagnosticMissionSnapshotForArtifact(diagnosis);
  const routes = uniqueOccurrences
    .filter((occurrence) => occurrence.path)
    .filter((occurrence, index, values) =>
      values.findIndex((candidate) => candidate.auditId === occurrence.auditId && candidate.path === occurrence.path) === index)
    .slice(0, 4)
    .map((occurrence) => ({
      auditId: occurrence.auditId,
      path: occurrence.path,
      url: occurrence.url,
    }));
  const failedStrategies = [
    ...new Set([
      ...(Array.isArray(report.ruleOutcomes)
        ? report.ruleOutcomes
            .filter((outcome) => outcome?.status === "failed" && sameRule(outcome))
            .map((outcome) => briefText(outcome.source?.strategy, 40))
        : []),
      ...occurrences.map((occurrence) => occurrence.strategy),
    ].filter(Boolean)),
  ].slice(0, 4);
  const strategyAcceptance = failedStrategies.length > 1
    ? `The exact ${briefText(source.auditId || finding.id, 160)} rule must no longer fail for every failing measured strategy: ${failedStrategies.join(" and ")}.`
    : `The exact ${briefText(source.auditId || finding.id, 160)} rule must no longer fail for ${briefText(failedStrategies[0] || source.strategy || "the measured evidence mode", 80)}.`;

  return {
    schemaVersion: 2,
    auditId: briefText(report.auditId, 80),
    findingId: briefText(finding.id, 160),
    target: {
      url: briefText(report.url, 2_048),
      finalUrl,
      publicPath: publicPathFromUrl(finalUrl),
      routes,
    },
    evidence: {
      title: briefText(finding.title, 240),
      severity: briefText(finding.severity, 20),
      category: briefText(finding.category, 80),
      selector: briefText(finding.selector, 160),
      measured: briefText(finding.evidence, 300),
      provider: briefText(source.provider, 120),
      ruleId: briefText(source.auditId, 160),
      strategy: briefText(source.strategy, 40),
      engineMode: briefText(report.engine?.mode, 80),
      lighthouseVersion: briefText(report.engine?.lighthouseVersion, 40) || null,
      diagnostics: diagnosticEvidenceSnapshot(finding.diagnosticEvidence),
      occurrenceCount: Math.max(
        uniqueOccurrences.length,
        finding.aggregateEvidence?.occurrenceCount ?? 0,
        matchingFindings.length,
        failedStrategies.length,
      ),
      occurrencesOmitted: Math.max(
        0,
        Math.max(
          uniqueOccurrences.length,
          finding.aggregateEvidence?.occurrenceCount ?? 0,
          matchingFindings.length,
          failedStrategies.length,
        ) - occurrences.length,
      ),
      failingStrategies: failedStrategies,
      occurrences,
    },
    repositoryHandoff: {
      patchType: template.patchType,
      risk: template.risk,
      inspectFor: repositorySourceHints(template.patchType),
      contributedDiagnosis: contributedDiagnosis
        ? {
            missionId: contributedDiagnosis.id,
            provenance: contributedDiagnosis.diagnosis.agentReported
              ? "agent-reported-repository"
              : "person-reported-repository",
            summary: contributedDiagnosis.diagnosis.summary,
            reproduction: contributedDiagnosis.diagnosis.reproduction,
            observations: contributedDiagnosis.diagnosis.observations,
            sourceLocations: contributedDiagnosis.diagnosis.sourceLocations,
            verificationChecks: contributedDiagnosis.diagnosis.verificationChecks,
            confidence: contributedDiagnosis.diagnosis.confidence,
          }
        : null,
      suggestedChange: briefText(template.patch, 1_200),
      verificationPlan: briefText(template.verificationPlan, 700),
      acceptanceCriteria: [
        strategyAcceptance,
        "Repository tests and the production build must pass without weakening unrelated checks.",
        "Replay the packaged finding against an optional candidate origin before deployment when browser access is available.",
        "A fresh Frontmend audit must observe the public deployment before resolution is claimed.",
      ],
    },
    candidateReview: {
      recommended: true,
      sequence: [
        "record_repository_implementation",
        "open_candidate_review",
        "record_candidate_review_check",
        "get_candidate_review",
      ],
      inputBoundary: "Supply an origin only. Frontmend maps retained server-issued paths onto it and never navigates or fetches the candidate.",
      evidenceBoundary: "Candidate replay is recommended preflight only; a fresh public Frontmend verification is still required before resolution can be claimed.",
    },
    verificationCandidates: verificationCandidateProjection(verificationImpact),
    authority: {
      sourceAccess: "coding-agent-only",
      frontmendChangedTarget: false,
      requiresHumanReview: true,
      deploymentAuthority: "site-owner",
      privacy:
        "Keep absolute paths, credentials, environment values, customer data, and unrelated source out of Frontmend repair fields.",
    },
  };
}

function sameRuleSource(left, right) {
  return Boolean(
    left &&
      right &&
      left.provider === right.provider &&
      left.auditId === right.auditId,
  );
}

function boundedFindingSource(source) {
  if (!source?.provider || !source?.auditId || !source?.strategy) return null;
  return {
    provider: briefText(source.provider, 120),
    auditId: briefText(source.auditId, 160),
    strategy: briefText(source.strategy, 40),
  };
}

function findingScopeSources(scope, fallbackSource) {
  const candidates = [
    fallbackSource,
    ...(Array.isArray(scope?.sources) ? scope.sources : []),
  ];
  const sources = [];
  for (const candidate of candidates) {
    const bounded = boundedFindingSource(candidate);
    if (bounded && !sources.some((source) => sameFindingSource(source, bounded))) {
      sources.push(bounded);
    }
  }
  return sources.slice(0, 4);
}

function repairFindingScope(report, finding) {
  const primary = boundedFindingSource(finding?.source);
  const retainedOccurrences = Array.isArray(finding?.occurrences)
    ? finding.occurrences.slice(0, 8)
    : [];
  const failedSources = Array.isArray(report?.ruleOutcomes)
    ? report.ruleOutcomes
        .filter(
          (outcome) =>
            outcome?.status === "failed" && sameRuleSource(outcome?.source, primary),
        )
        .map((outcome) => outcome.source)
    : [];
  const occurrenceSources = retainedOccurrences.map((occurrence) => ({
    provider: occurrence?.source?.provider ?? primary?.provider,
    auditId: occurrence?.source?.auditId ?? primary?.auditId,
    strategy: occurrence?.source?.strategy ?? occurrence?.strategy ?? primary?.strategy,
  }));
  const allSources = [];
  for (const candidate of [primary, ...failedSources, ...occurrenceSources]) {
    const bounded = boundedFindingSource(candidate);
    if (bounded && !allSources.some((source) => sameFindingSource(source, bounded))) {
      allSources.push(bounded);
    }
  }
  const routes = retainedOccurrences
    .filter((occurrence) => occurrence?.auditId || occurrence?.path)
    .filter((occurrence, index, values) => values.findIndex((candidate) =>
      candidate?.auditId === occurrence?.auditId && candidate?.path === occurrence?.path) === index)
    .slice(0, 4)
    .map((occurrence) => ({
      auditId: briefText(occurrence.auditId, 160) || null,
      path: briefText(occurrence.path, 256) || "/",
      url: briefText(occurrence.url, 2_048) || null,
    }));
  const rootAffected = retainedOccurrences.length
    ? retainedOccurrences.some((occurrence) => occurrence?.auditId === report?.auditId)
    : true;
  return {
    focusAreas: Array.isArray(finding?.focusAreas)
      ? [...new Set(finding.focusAreas.filter((area) => typeof area === "string"))].slice(0, 3)
      : [],
    occurrenceCount: Math.max(
      retainedOccurrences.length,
      finding?.aggregateEvidence?.occurrenceCount ?? 0,
      allSources.length,
    ),
    occurrencesOmitted: Math.max(0, retainedOccurrences.length - routes.length),
    sources: allSources.slice(0, 4),
    routes,
    rootAffected,
  };
}

function browserFindingEvidenceSnapshot(finding) {
  if (
    finding?.source?.provider !== "Frontmend browser review" ||
    !finding?.browserReviewEvidence?.reviewId
  ) return null;
  const focusArea = finding.focusArea === "seo" || finding.focusAreas?.includes("seo") || finding.category === "SEO"
    ? "seo"
    : "accessibility";
  return {
    findingId: briefText(finding.id ?? finding.findingId, 160),
    title: briefText(finding.title, 240),
    category: briefText(finding.category, 80) || (focusArea === "seo" ? "SEO" : "Accessibility"),
    focusArea,
    selector: briefText(finding.selector, 200) || "Rendered page",
    evidence: briefText(finding.evidence, 600),
    repair: briefText(finding.repair, 600) || "Recheck the original rendered issue.",
    source: boundedFindingSource(finding.source),
    browserReviewEvidence: {
      reviewId: briefText(finding.browserReviewEvidence.reviewId, 160),
      checkId: briefText(finding.browserReviewEvidence.checkId, 80),
      checkLabel: briefText(finding.browserReviewEvidence.checkLabel, 120),
      provenance: ["agent-reported-browser", "person-reported-browser", "mixed-attributed-browser"].includes(
        finding.browserReviewEvidence.provenance,
      )
        ? finding.browserReviewEvidence.provenance
        : "agent-reported-browser",
      reportedAt: Number.isFinite(finding.browserReviewEvidence.reportedAt)
        ? finding.browserReviewEvidence.reportedAt
        : null,
    },
  };
}

function repairPackageFindings(finding, findings) {
  const values = Array.isArray(findings) && findings.length ? findings : [finding];
  if (values.length < 1 || values.length > 3 || values.some((item) => !item?.id)) {
    throw new AuditError("INVALID_REPAIR", "A repair package must contain between one and three retained findings.");
  }
  const ids = values.map((item) => item.id);
  if (new Set(ids).size !== ids.length) {
    throw new AuditError("INVALID_REPAIR", "A repair package cannot contain duplicate findings.");
  }
  if (finding?.id && ids[0] !== finding.id) {
    throw new AuditError("INVALID_REPAIR", "The primary finding must remain first in the repair package.");
  }
  return values;
}

function packageDefaults(findings) {
  const templates = findings.map(templateForFinding);
  const riskOrder = { low: 0, medium: 1, high: 2 };
  const patchTypes = [...new Set(templates.map((template) => template.patchType))];
  return {
    summary: findings.length === 1
      ? findings[0].repair
      : `Address ${findings.length} retained findings in one reviewed repository change: ${findings.map((item) => item.title).join("; ")}`,
    patchType: patchTypes.length === 1 ? patchTypes[0] : "guidance",
    patch: findings.length === 1
      ? templates[0].patch
      : findings.map((item, index) => `${index + 1}. ${item.title}: ${templates[index].patch}`).join("\n"),
    verificationPlan: findings.length === 1
      ? templates[0].verificationPlan
      : `Rerun every reviewed exact-rule row for: ${findings.map((item) => item.title).join("; ")}. Confirm retained provider and browser guardrails before claiming resolution.`,
    risk: templates.reduce(
      (highest, template) => riskOrder[template.risk] > riskOrder[highest] ? template.risk : highest,
      "low",
    ),
  };
}

function repairPackageItem(report, finding, diagnosticMissions) {
  const diagnosticMission = (diagnosticMissions ?? []).find((mission) => mission?.findingId === finding.id) ?? null;
  return {
    findingId: finding.id,
    title: briefText(finding.title, 240),
    severity: briefText(finding.severity, 20),
    category: briefText(finding.category, 80),
    source: boundedFindingSource(finding.source),
    retainedSymptom: {
      title: briefText(finding.title, 240),
      category: briefText(finding.category, 80),
      focusAreas: Array.isArray(finding.focusAreas)
        ? [...new Set(finding.focusAreas.filter((area) => typeof area === "string"))].slice(0, 4)
        : [],
      viewport: briefText(finding.viewport, 100),
      selector: briefText(finding.selector, 200) || "main landmark",
      measured: briefText(finding.evidence, 600),
      suggestedRepair: briefText(finding.repair, 600),
    },
    evidence: browserFindingEvidenceSnapshot(finding),
    scope: repairFindingScope(report, finding),
    diagnosticMission: diagnosticMissionSnapshotForArtifact(diagnosticMission),
  };
}

export function createRepairDraft({
  repairId = crypto.randomUUID(),
  auditId,
  finding,
  findings = null,
  diagnosticMissions = [],
  report = null,
  input = {},
  source = "human",
  verificationImpact = null,
  now = Date.now(),
}) {
  if (!finding?.id) throw new AuditError("FINDING_NOT_FOUND", "That audit finding does not exist.");
  const extra = Object.keys(input).find(
    (key) => ![
      "findingId",
      "findingIds",
      "summary",
      "patchType",
      "patch",
      "verificationPlan",
      "risk",
      "repositoryFiles",
      "repositoryChecks",
      "verificationTargetIds",
    ].includes(key),
  );
  if (extra) throw new AuditError("INVALID_REPAIR", `Unknown repair field: ${extra}.`);
  const retainedFindings = repairPackageFindings(finding, findings);
  const requestedFindingIds = input.findingIds ?? retainedFindings.map((item) => item.id);
  if (
    !Array.isArray(requestedFindingIds)
    || JSON.stringify(requestedFindingIds) !== JSON.stringify(retainedFindings.map((item) => item.id))
  ) {
    throw new AuditError("INVALID_REPAIR", "findingIds must exactly match the frozen repair preparation order.");
  }
  const packageItems = retainedFindings.map((item) => repairPackageItem(report, item, diagnosticMissions));
  const defaults = packageDefaults(retainedFindings);
  const patchType = input.patchType ?? defaults.patchType;
  const risk = input.risk ?? defaults.risk;
  if (!PATCH_TYPES.includes(patchType)) {
    throw new AuditError("INVALID_REPAIR", "patchType is not supported.");
  }
  if (!REPAIR_RISKS.includes(risk)) {
    throw new AuditError("INVALID_REPAIR", "risk is not supported.");
  }
  return {
    id: repairId,
    auditId,
    findingId: finding.id,
    findingIds: retainedFindings.map((item) => item.id),
    findingCount: retainedFindings.length,
    findingTitle: finding.title,
    findingSource: finding.source ?? null,
    findingEvidence: browserFindingEvidenceSnapshot(finding),
    findingScope: repairFindingScope(report, finding),
    findingScopes: packageItems.map((item) => ({
      findingId: item.findingId,
      source: item.source,
      scope: item.scope,
    })),
    findingPackage: {
      schemaVersion: 1,
      primaryFindingId: finding.id,
      items: packageItems,
    },
    diagnosticMissions: packageItems
      .map((item) => item.diagnosticMission)
      .filter(Boolean),
    diagnosticMission: packageItems[0]?.diagnosticMission ?? null,
    status: "draft",
    source: source === "agent" ? "agent" : "human",
    summary: boundedString(input.summary ?? defaults.summary, "summary", 300),
    patchType,
    patch: boundedString(input.patch ?? defaults.patch, "patch", 3_000),
    verificationPlan: boundedString(
      input.verificationPlan ?? defaults.verificationPlan,
      "verificationPlan",
      700,
    ),
    risk,
    repositoryPlan: repositoryPlanForProposal(input, null, source),
    requiresHumanReview: true,
    createdAt: now,
    updatedAt: now,
    revision: 1,
    revisionHistory: [],
    changeRequest: null,
    reviewedAt: null,
    implementationReceipt: null,
    implementationHistory: [],
    candidateReview: null,
    candidateReviewHistory: [],
    deploymentAttestedAt: null,
    approval: null,
    automation: null,
    verificationImpact: verificationImpact
      ? selectRepairVerificationTargets(
          verificationImpact,
          input.verificationTargetIds ?? verificationImpact.selectedTargetIds ?? [],
          1,
        )
      : null,
    verificationRun: null,
  };
}

export function requestRepairChanges(repair, feedback, now = Date.now()) {
  if (!repair?.id) throw new AuditError("REPAIR_NOT_FOUND", "That repair draft does not exist.");
  if (repair.status === "changes-requested") {
    throw new AuditError("CHANGES_ALREADY_REQUESTED", "Changes have already been requested for this repair.");
  }
  const archivedCandidate = archiveCandidateReviewForNewImplementation(repair);
  return {
    ...repair,
    status: "changes-requested",
    changeRequest: {
      feedback: boundedString(feedback, "feedback", 600),
      requestedAt: now,
    },
    reviewedAt: null,
    implementationReceipt: null,
    implementationHistory: [],
    ...archivedCandidate,
    deploymentAttestedAt: null,
    approval: null,
    automation: null,
    verificationImpact: repair.verificationImpact
      ? selectRepairVerificationTargets(
          repair.verificationImpact,
          repair.verificationImpact.selectedTargetIds ?? [],
          Number.isFinite(repair.revision) ? repair.revision : 1,
        )
      : null,
    verificationRun: null,
    updatedAt: now,
  };
}

export function reviseRepairDraft(repair, input = {}, source = "agent", now = Date.now()) {
  if (!repair?.id) throw new AuditError("REPAIR_NOT_FOUND", "That repair draft does not exist.");
  if (repair.status !== "changes-requested" || !repair.changeRequest?.feedback) {
    throw new AuditError(
      "REVISION_NOT_REQUESTED",
      "A person must request changes in the visible review interface before this repair can be revised.",
    );
  }
  const allowed = [
    "summary",
    "patchType",
    "patch",
    "verificationPlan",
    "risk",
    "repositoryFiles",
    "repositoryChecks",
    "verificationTargetIds",
  ];
  const extra = Object.keys(input).find((key) => !allowed.includes(key));
  if (extra) throw new AuditError("INVALID_REPAIR", `Unknown repair field: ${extra}.`);
  if (!Object.keys(input).length) {
    throw new AuditError("INVALID_REPAIR", "A revision must change at least one proposal field.");
  }
  const patchType = input.patchType ?? repair.patchType;
  const risk = input.risk ?? repair.risk;
  if (!PATCH_TYPES.includes(patchType)) {
    throw new AuditError("INVALID_REPAIR", "patchType is not supported.");
  }
  if (!REPAIR_RISKS.includes(risk)) {
    throw new AuditError("INVALID_REPAIR", "risk is not supported.");
  }
  const next = {
    summary: boundedString(input.summary ?? repair.summary, "summary", 300),
    patchType,
    patch: boundedString(input.patch ?? repair.patch, "patch", 3_000),
    verificationPlan: boundedString(
      input.verificationPlan ?? repair.verificationPlan,
      "verificationPlan",
      700,
    ),
    risk,
    repositoryPlan: repositoryPlanForProposal(input, repair.repositoryPlan, source),
  };
  const nextRevision = (Number.isFinite(repair.revision) ? repair.revision : 1) + 1;
  const nextImpact = repair.verificationImpact
    ? selectRepairVerificationTargets(
        repair.verificationImpact,
        input.verificationTargetIds ?? repair.verificationImpact.selectedTargetIds ?? [],
        nextRevision,
      )
    : null;
  const proposalChanged = ["summary", "patchType", "patch", "verificationPlan", "risk"]
    .some((key) => next[key] !== repair[key]);
  const repositoryPlanChanged = JSON.stringify(next.repositoryPlan) !== JSON.stringify(repair.repositoryPlan ?? null);
  const impactChanged = JSON.stringify(nextImpact?.selectedTargetIds ?? []) !==
    JSON.stringify(repair.verificationImpact?.selectedTargetIds ?? []);
  if (!proposalChanged && !repositoryPlanChanged && !impactChanged) {
    throw new AuditError("INVALID_REPAIR", "The revised proposal must differ from the current version.");
  }
  const previous = {
    revision: Number.isFinite(repair.revision) ? repair.revision : 1,
    summary: repair.summary,
    patchType: repair.patchType,
    patch: repair.patch,
    verificationPlan: repair.verificationPlan,
    risk: repair.risk,
    repositoryPlan: repair.repositoryPlan
      ? {
          files: [...repair.repositoryPlan.files],
          checks: [...repair.repositoryPlan.checks],
          source: "agent",
          sourceChangedByFrontmend: false,
        }
      : null,
    source: repair.source,
    createdAt: repair.updatedAt ?? repair.createdAt,
    changeRequest: repair.changeRequest,
  };
  const archivedCandidate = archiveCandidateReviewForNewImplementation(repair);
  return {
    ...repair,
    ...next,
    status: "draft",
    source: source === "agent" ? "agent" : "human",
    revision: nextRevision,
    revisionHistory: [...(Array.isArray(repair.revisionHistory) ? repair.revisionHistory : []), previous]
      .slice(-MAX_REPAIR_REVISIONS),
    changeRequest: null,
    reviewedAt: null,
    implementationReceipt: null,
    implementationHistory: [],
    ...archivedCandidate,
    deploymentAttestedAt: null,
    approval: null,
    automation: null,
    verificationImpact: nextImpact,
    verificationRun: null,
    updatedAt: now,
  };
}

export function recordRepositoryImplementation(repair, input = {}, now = Date.now()) {
  if (!repair?.id) throw new AuditError("REPAIR_NOT_FOUND", "That repair draft does not exist.");
  if (repair.status !== "approved") {
    throw new AuditError(
      "REPAIR_NOT_APPROVED",
      "A person must approve the repair plan before repository implementation can be reported.",
    );
  }
  if (Number.isFinite(repair.deploymentAttestedAt)) {
    throw new AuditError(
      "DEPLOYMENT_ALREADY_ATTESTED",
      "Repository implementation must be reported before the site owner attests deployment.",
    );
  }
  const allowed = ["summary", "files", "checks", "commitSha"];
  const extra = Object.keys(input).find((key) => !allowed.includes(key));
  if (extra) {
    throw new AuditError("INVALID_IMPLEMENTATION_RECEIPT", `Unknown implementation field: ${extra}.`);
  }
  const files = boundedUniqueList(input.files, "files", 8, (value) => repositoryRelativePath(value));
  const checks = boundedUniqueList(input.checks, "checks", 8, (check) => {
    if (!check || typeof check !== "object" || Array.isArray(check)) {
      throw new AuditError("INVALID_IMPLEMENTATION_RECEIPT", "Each check must be an object.");
    }
    const unknown = Object.keys(check).find((key) => !["name", "status"].includes(key));
    if (unknown || !IMPLEMENTATION_CHECK_STATUSES.includes(check.status)) {
      throw new AuditError(
        "INVALID_IMPLEMENTATION_RECEIPT",
        "Each check must contain only name and a passed, failed, or not-run status.",
      );
    }
    return {
      name: boundedString(check.name, "check name", 120),
      status: check.status,
    };
  });
  const commitSha = input.commitSha == null ? null : boundedString(input.commitSha, "commitSha", 64);
  if (commitSha !== null && !/^[0-9a-f]{7,64}$/i.test(commitSha)) {
    throw new AuditError(
      "INVALID_IMPLEMENTATION_RECEIPT",
      "commitSha must be a 7 to 64 character hexadecimal Git object ID.",
    );
  }
  const previousReceipt = repair.implementationReceipt?.agentReported
    ? repair.implementationReceipt
    : null;
  const previousHistory = Array.isArray(repair.implementationHistory)
    ? repair.implementationHistory
    : [];
  const archivedCandidate = archiveCandidateReviewForNewImplementation(repair);
  return {
    ...repair,
    ...archivedCandidate,
    implementationReceipt: {
      revision: Number.isFinite(previousReceipt?.revision) ? previousReceipt.revision + 1 : 1,
      summary: boundedString(input.summary, "summary", 300),
      files,
      checks,
      commitSha,
      source: "agent",
      reportedAt: now,
      agentReported: true,
      sourceChangedByFrontmend: false,
    },
    implementationHistory: previousReceipt
      ? [...previousHistory, previousReceipt].slice(-MAX_IMPLEMENTATION_RECEIPTS)
      : previousHistory.slice(-MAX_IMPLEMENTATION_RECEIPTS),
    updatedAt: now,
  };
}

function implementationReceiptSnapshot(receipt) {
  if (!receipt?.agentReported) return null;
  return {
    revision: Number.isFinite(receipt.revision) ? receipt.revision : 1,
    summary: receipt.summary,
    files: Array.isArray(receipt.files) ? receipt.files.map((file) => file) : [],
    checks: Array.isArray(receipt.checks)
      ? receipt.checks.map((check) => ({ name: check.name, status: check.status }))
      : [],
    commitSha: receipt.commitSha ?? null,
    source: "agent",
    reportedAt: receipt.reportedAt,
    agentReported: true,
    sourceChangedByFrontmend: false,
  };
}

function repositoryPlanSnapshot(plan) {
  if (!plan?.files?.length || !plan?.checks?.length || plan.source !== "agent") return null;
  return {
    files: plan.files.slice(0, 8).map((file) => file),
    checks: plan.checks.slice(0, 8).map((check) => check),
    source: "agent",
    sourceChangedByFrontmend: false,
  };
}

function diagnosticMissionSnapshotForArtifact(mission) {
  if (!mission?.id || !mission?.diagnosis) return null;
  return {
    id: mission.id,
    findingId: mission.findingId,
    measuredEvidence: mission.measuredEvidence ? { ...mission.measuredEvidence } : null,
    diagnosis: {
      ...mission.diagnosis,
      observations: (mission.diagnosis.observations ?? []).map((item) => ({ ...item })),
      sourceLocations: (mission.diagnosis.sourceLocations ?? []).map((item) => ({ ...item })),
      verificationChecks: [...(mission.diagnosis.verificationChecks ?? [])],
    },
    state: mission.state ? { ...mission.state } : null,
  };
}

function approvalSnapshot(repair) {
  if (repair?.approval?.mode === "delegated-auto") {
    return {
      mode: "delegated-auto",
      grantedBy: "person",
      policyEnabledAt: repair.approval.policyEnabledAt,
      approvedAt: repair.approval.approvedAt ?? repair.reviewedAt,
    };
  }
  if (repair?.status === "approved") {
    return {
      mode: "explicit-review",
      grantedBy: "person",
      policyEnabledAt: null,
      approvedAt: repair?.approval?.approvedAt ?? repair.reviewedAt,
    };
  }
  return null;
}

function implementationEvidenceState(repair) {
  const receipt = repair?.implementationReceipt;
  if (!receipt?.agentReported) return "none";
  const checks = Array.isArray(receipt.checks) ? receipt.checks : [];
  if (checks.some((check) => check?.status === "failed")) return "checks-failed";
  if (!checks.length || checks.some((check) => check?.status !== "passed")) {
    return "checks-incomplete";
  }
  return "checks-passed";
}

export function repairMissionContinuation(repair) {
  if (!repair?.id) return null;
  if (repair.status === "changes-requested") {
    return {
      status: "action-available",
      nextActor: "agent",
      nextAction: {
        tool: "revise_site_repair",
        input: { repairId: repair.id },
        reason: "Inspect the retained change request, revise the repository proposal, and return it for person review.",
      },
    };
  }
  if (repair.status !== "approved") {
    return { status: "awaiting-human-review", nextActor: "person", nextAction: null };
  }

  const aggregate = repair.aggregateVerification ?? null;
  if (aggregate?.receiptAvailable === true) {
    return { status: "complete", nextActor: null, nextAction: null };
  }
  if (repair.verificationRun?.id) {
    return {
      status: "in-progress",
      nextActor: "agent",
      nextAction: {
        tool: "get_verification_receipt",
        input: { repairId: repair.id },
        reason: "Read the reviewed verification matrix until every fresh evidence row reaches a terminal outcome.",
      },
    };
  }
  if (Number.isFinite(repair.deploymentAttestedAt)) {
    return {
      status: "action-available",
      nextActor: "agent",
      nextAction: {
        tool: "start_repair_verification",
        input: { repairId: repair.id },
        reason: "The reviewed deployment is attested, so start the exact fresh verification matrix.",
      },
    };
  }

  const candidate = repair?.candidateReview
    ? candidateReviewSnapshot(repair.candidateReview, repair.candidateReviewHistory)
    : null;
  if (candidate?.status === "issues-found") {
    return {
      status: "action-available",
      nextActor: "agent",
      nextAction: {
        tool: "record_repository_implementation",
        input: { repairId: repair.id },
        reason: "The candidate build still shows a retained symptom or regression. Use the revision-bound correction packet, change only the approved repository scope, rerun its checks, and record a newer implementation receipt.",
      },
    };
  }
  if (candidate?.status === "in-progress" && candidate.nextTask) {
    return {
      status: "in-progress",
      nextActor: "agent",
      nextAction: {
        tool: "record_candidate_review_check",
        input: {
          repairId: repair.id,
          reviewId: candidate.id,
          checkId: candidate.nextTask.id,
        },
        reason: "Use visual browser controls on the exact candidate target and record only the current retained comparison.",
      },
    };
  }

  if (implementationEvidenceState(repair) === "checks-passed") {
    return { status: "awaiting-external-deployment", nextActor: "person", nextAction: null };
  }
  return {
    status: "action-available",
    nextActor: "agent",
    nextAction: {
      tool: "record_repository_implementation",
      input: { repairId: repair.id },
      reason: repair.implementationReceipt
        ? "Correct the reviewed implementation, rerun its checks, and replace the incomplete or failed repository receipt."
        : "Implement the approved repository plan, run its checks, and record the bounded implementation receipt.",
    },
  };
}

export function repairMissionState(repair) {
  const hasDraft = Boolean(repair?.id);
  const approved = repair?.status === "approved";
  const delegatedApproval = approved && repair?.approval?.mode === "delegated-auto";
  const changesRequested = repair?.status === "changes-requested";
  const implementationEvidence = implementationEvidenceState(repair);
  const implemented = approved && implementationEvidence === "checks-passed";
  const implementationNeedsAttention = approved && ["checks-failed", "checks-incomplete"].includes(
    implementationEvidence,
  );
  const deploymentAttested = approved && Number.isFinite(repair?.deploymentAttestedAt);
  const candidateStatus = candidateReviewStatus(repair?.candidateReview);
  const correctionPacket = candidateCorrectionPacket(repair);
  const steps = [
    { id: "measure", label: "Measure", owner: "Frontmend", status: "complete" },
    {
      id: "draft",
      label: "Draft",
      owner: "Person or agent",
      status: changesRequested ? "current" : hasDraft ? "complete" : "current",
    },
    {
      id: "review",
      label: delegatedApproval ? "Delegated review" : "Review",
      owner: delegatedApproval ? "Person policy" : "Person",
      detail: delegatedApproval ? "Auto-authorised by a prior human grant" : undefined,
      status: approved ? "complete" : changesRequested ? "blocked" : hasDraft ? "current" : "blocked",
    },
    {
      id: "implement",
      label: "Implement",
      owner: "Coding agent",
      detail: correctionPacket
        ? "Candidate correction required"
        : implementationEvidence === "checks-passed"
        ? "Agent checks passed"
        : implementationEvidence === "checks-failed"
          ? "Agent checks failed"
          : implementationEvidence === "checks-incomplete"
            ? "Agent checks incomplete"
            : "Coding agent · optional receipt",
      status: correctionPacket
        ? "attention"
        : implemented ? "complete" : implementationNeedsAttention ? "attention" : approved ? "available" : "blocked",
    },
    {
      id: "candidate",
      label: "Candidate review",
      owner: "Person or coding agent",
      detail: candidateStatus === "checks-passed"
        ? "Checks passed · production unverified"
        : candidateStatus === "issues-found"
          ? "Candidate issues found"
          : candidateStatus === "blocked"
            ? "Candidate browser blocked"
            : candidateStatus === "in-progress"
              ? "Candidate checks unfinished"
              : "Optional preflight",
      status: candidateStatus === "checks-passed"
        ? "complete"
        : ["issues-found", "blocked"].includes(candidateStatus)
          ? "attention"
          : candidateStatus === "in-progress"
            ? "current"
            : implemented && !deploymentAttested ? "available" : "blocked",
    },
    {
      id: "deploy",
      label: "Deploy",
      owner: "Site owner",
      status: deploymentAttested ? "attested" : approved ? "current" : "blocked",
    },
    {
      id: "verify",
      label: "Verify",
      owner: "Frontmend",
      status: deploymentAttested ? "available" : "blocked",
    },
  ];
  const nextActions = !hasDraft
    ? [{ id: "stage_repair", actor: "person-or-agent" }]
    : changesRequested
      ? [{ id: "revise_repair", actor: "agent" }]
    : !approved
      ? [{ id: "review_in_ui", actor: "person" }]
      : !deploymentAttested
        ? [
          {
            id: "record_repository_implementation",
            actor: "agent",
            ...(correctionPacket ? {} : { optional: true }),
          },
          ...(implemented
            ? [{ id: candidateStatus === "not-started" ? "open_candidate_review" : "get_candidate_review", actor: "person-or-agent", optional: true }]
            : []),
          { id: "export_reviewed_plan", actor: "person" },
          { id: "deploy_externally", actor: "site-owner" },
          { id: "attest_deployment_in_ui", actor: "site-owner" },
        ]
        : [
          { id: "export_reviewed_plan", actor: "person" },
          { id: "start_verification", actor: "person-or-agent" },
        ];
  return {
    state: !hasDraft
      ? "not-started"
      : changesRequested
        ? "changes-requested"
      : approved
        ? deploymentAttested
          ? "ready-for-verification"
          : correctionPacket
            ? "candidate-attention"
          : implementationNeedsAttention
            ? "implementation-attention"
            : "awaiting-external-deployment"
        : "awaiting-human-review",
    steps,
    nextActions,
    targetMutation: "external-only",
    implementationEvidence,
    candidateReview: repair?.candidateReview
      ? candidateReviewSnapshot(repair.candidateReview, repair.candidateReviewHistory)
      : null,
    candidateReviewStatus: candidateStatus,
    candidateCorrectionPacket: correctionPacket,
    deploymentEvidence: deploymentAttested ? "site-owner-attestation" : "none",
    approvalEvidence: delegatedApproval
      ? "prior-human-auto-policy"
      : approved
        ? "explicit-human-review"
        : "none",
    continuation: repairMissionContinuation(repair),
  };
}

export function repairWithMission(repair) {
  return { ...repair, mission: repairMissionState(repair) };
}

export function validateRepairId(value) {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw new AuditError("REPAIR_NOT_FOUND", "That repair draft does not exist.");
  }
  return value;
}

function reportMetric(value) {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : null;
}

function outcomeForSource(report, source) {
  return report?.ruleOutcomes?.find(
    (outcome) =>
      outcome.source?.provider === source?.provider &&
      outcome.source?.auditId === source?.auditId &&
      outcome.source?.strategy === source?.strategy,
  )?.status ?? "missing";
}

function aggregateRuleOutcome(outcomes) {
  if (!outcomes.length || outcomes.some((outcome) => outcome === "missing")) return "missing";
  if (outcomes.some((outcome) => outcome === "failed")) return "failed";
  if (outcomes.every((outcome) => outcome === "passed")) return "passed";
  if (outcomes.every((outcome) => outcome === "not-applicable")) return "not-applicable";
  return "not-evaluated";
}

function sameFindingSource(left, right) {
  return Boolean(
    left &&
      right &&
      left.provider === right.provider &&
      left.auditId === right.auditId &&
      left.strategy === right.strategy,
  );
}

function reportSnapshot(report, source, findingScope = null) {
  const scopeSources = findingScopeSources(findingScope, source);
  const scopeRuleOutcomes = scopeSources.map((candidate) => ({
    source: candidate,
    status: outcomeForSource(report, candidate),
  }));
  return {
    auditId: report?.auditId ?? null,
    completedAt: reportMetric(report?.completedAt),
    score: reportMetric(report?.score),
    findingCount: reportMetric(report?.findingCount),
    checks: {
      passed: reportMetric(report?.checks?.passed),
      warnings: reportMetric(report?.checks?.warnings),
      failed: reportMetric(report?.checks?.failed),
    },
    exactRuleOutcome: aggregateRuleOutcome(scopeRuleOutcomes.map((outcome) => outcome.status)),
    scopeRuleOutcomes,
  };
}

function lineageEntry(
  snapshot,
  attempt,
  status = "baseline",
  evidenceSignature = null,
  metricComparableToBaseline = attempt === 0 ? true : null,
) {
  return {
    auditId: snapshot.auditId,
    completedAt: snapshot.completedAt,
    score: snapshot.score,
    findingCount: snapshot.findingCount,
    checksPassed: snapshot.checks?.passed ?? null,
    exactRuleOutcome: snapshot.exactRuleOutcome,
    evidenceSignature,
    metricComparableToBaseline,
    attempt,
    status,
  };
}

function findingScopeKey(scope, fallbackSource) {
  return findingScopeSources(scope, fallbackSource)
    .map((source) => `${source.provider}\n${source.auditId}\n${source.strategy}`)
    .sort()
    .join("\n---\n");
}

function startingLineage(report, source, findingScope) {
  const previous = report?.verification?.lineage;
  if (
    sameFindingSource(report?.verification?.findingSource, source) &&
    findingScopeKey(report?.verification?.findingScope, report?.verification?.findingSource) ===
      findingScopeKey(findingScope, source) &&
    previous?.rootAuditId &&
    Array.isArray(previous.entries) &&
    previous.entries.length
  ) {
    return {
      rootAuditId: previous.rootAuditId,
      findingSource: source,
      findingScope,
      attemptCount: reportMetric(previous.attemptCount) ?? previous.entries.length - 1,
      omitted: reportMetric(previous.omitted) ?? 0,
      entries: previous.entries.slice(0, MAX_LINEAGE_ENTRIES),
    };
  }
  const snapshot = reportSnapshot(report, source, findingScope);
  return {
    rootAuditId: snapshot.auditId,
    findingSource: source,
    findingScope,
    attemptCount: 0,
    omitted: 0,
    entries: [lineageEntry(snapshot, 0, "baseline", reportEvidenceSignature(report), true)],
  };
}

function appendLineage(lineage, snapshot, status, evidenceSignature, metricComparableToBaseline) {
  const attemptCount = (reportMetric(lineage?.attemptCount) ?? 0) + 1;
  const entries = [
    ...(Array.isArray(lineage?.entries) ? lineage.entries : []),
    lineageEntry(
      snapshot,
      attemptCount,
      status,
      evidenceSignature,
      metricComparableToBaseline,
    ),
  ];
  const boundedEntries = entries.length <= MAX_LINEAGE_ENTRIES
    ? entries
    : [entries[0], ...entries.slice(-(MAX_LINEAGE_ENTRIES - 1))];
  return {
    rootAuditId: lineage?.rootAuditId ?? boundedEntries[0]?.auditId ?? snapshot.auditId,
    findingSource: lineage?.findingSource,
    findingScope: lineage?.findingScope,
    attemptCount,
    omitted: Math.max(0, attemptCount + 1 - boundedEntries.length),
    entries: boundedEntries,
  };
}

function reportEvidenceSignature(report) {
  const engine = report?.engine ?? {};
  return {
    mode: briefText(engine.mode, 80) || null,
    provider: briefText(engine.provider, 160) || null,
    ruleSetVersion: Number.isFinite(engine.ruleSetVersion) ? engine.ruleSetVersion : null,
    lighthouseVersion: briefText(engine.lighthouseVersion, 40) || null,
    measuredStrategies: [...new Set(
      (Array.isArray(report?.viewports) ? report.viewports : [])
        .map((viewport) => briefText(viewport?.id, 40))
        .filter(Boolean),
    )].sort(),
    scoreBasis: briefText(report?.scoreBasis, 80) || null,
    documentSupplement: report?.documentSupplement
      ? {
          evaluatedRuleCount: reportMetric(report.documentSupplement.evaluatedRuleCount),
          overlappingRulesOmitted: reportMetric(report.documentSupplement.overlappingRulesOmitted),
        }
      : null,
  };
}

function sameEvidenceSignature(left, right) {
  return Boolean(
    left &&
      right &&
      left.mode === right.mode &&
      left.provider === right.provider &&
      left.ruleSetVersion === right.ruleSetVersion &&
      left.lighthouseVersion === right.lighthouseVersion &&
      left.scoreBasis === right.scoreBasis &&
      JSON.stringify(left.measuredStrategies ?? []) === JSON.stringify(right.measuredStrategies ?? []) &&
      JSON.stringify(left.documentSupplement ?? null) === JSON.stringify(right.documentSupplement ?? null),
  );
}

function engineUsesLighthouse(engine) {
  return typeof engine?.mode === "string" && engine.mode.includes("lighthouse");
}

function engineUsesDocument(engine) {
  return ["live-document", "hybrid-lighthouse-document", "live-lighthouse-document"].includes(engine?.mode);
}

function exactRuleComparison({ source, baselineEngine, measuredEngine, measuredRuleOutcome }) {
  if (!source) return { comparable: false, reason: "exact-rule-not-evaluated" };
  if (baselineEngine?.ruleSetVersion !== measuredEngine?.ruleSetVersion) {
    return { comparable: false, reason: "rule-set-changed" };
  }
  if (source.provider === "Lighthouse") {
    if (measuredRuleOutcome === "missing") {
      return { comparable: false, reason: "exact-lighthouse-rule-not-evaluated" };
    }
    if (!engineUsesLighthouse(baselineEngine) || !engineUsesLighthouse(measuredEngine)) {
      return { comparable: false, reason: "lighthouse-evidence-unavailable" };
    }
    if (
      !baselineEngine?.lighthouseVersion ||
      measuredEngine?.lighthouseVersion !== baselineEngine.lighthouseVersion
    ) {
      return { comparable: false, reason: "lighthouse-version-changed" };
    }
    return { comparable: true, reason: "exact-lighthouse-rule" };
  }
  if (source.provider === "Frontmend document audit") {
    return engineUsesDocument(baselineEngine) && engineUsesDocument(measuredEngine)
      ? { comparable: true, reason: "exact-document-rule" }
      : { comparable: false, reason: "document-evidence-unavailable" };
  }
  const comparable = Boolean(
    baselineEngine?.mode &&
      measuredEngine?.mode === baselineEngine.mode &&
      measuredEngine?.provider === baselineEngine.provider,
  );
  return { comparable, reason: comparable ? "exact-provider-rule" : "evidence-engine-changed" };
}

function inconclusiveComparisonMessage(reason) {
  const messages = {
    "exact-lighthouse-rule-not-evaluated":
      "The fresh audit did not evaluate the exact original Lighthouse rule and strategy, so Frontmend cannot claim it was resolved.",
    "lighthouse-version-changed":
      "The Lighthouse version changed between audits, so Frontmend cannot make a like-for-like rule claim.",
    "rule-set-changed":
      "The Frontmend rule set changed between audits, so Frontmend cannot make a like-for-like rule claim.",
    "lighthouse-evidence-unavailable":
      "Comparable Lighthouse evidence was unavailable in the fresh audit.",
    "document-evidence-unavailable":
      "Comparable fetched-document evidence was unavailable in the fresh audit.",
  };
  return messages[reason]
    ?? "The fresh audit used different rule evidence, so Frontmend cannot make a like-for-like repair claim.";
}

export function createVerificationContext(report, repair) {
  if (!report?.auditId || !repair?.id || !repair?.findingSource) {
    throw new AuditError("INVALID_REPAIR", "The verification context is incomplete.");
  }
  if (repair.status !== "approved") {
    throw new AuditError("REPAIR_NOT_APPROVED", "Approve this repair draft before verification.");
  }
  if (!Number.isFinite(repair.deploymentAttestedAt)) {
    throw new AuditError(
      "DEPLOYMENT_NOT_ATTESTED",
      "A person must confirm the reviewed change was deployed before verification.",
    );
  }
  const findingScope = {
    occurrenceCount: Number.isFinite(repair.findingScope?.occurrenceCount)
      ? Math.max(1, Math.round(repair.findingScope.occurrenceCount))
      : 1,
    occurrencesOmitted: Number.isFinite(repair.findingScope?.occurrencesOmitted)
      ? Math.max(0, Math.round(repair.findingScope.occurrencesOmitted))
      : 0,
    sources: findingScopeSources(repair.findingScope, repair.findingSource),
  };
  const browserReplayBaseline = browserFindingEvidenceSnapshot(repair.findingEvidence);
  const baseline = reportSnapshot(report, repair.findingSource, findingScope);
  const lineage = startingLineage(report, repair.findingSource, findingScope);
  if (browserReplayBaseline) {
    baseline.exactRuleOutcome = "failed";
    baseline.scopeRuleOutcomes = findingScope.sources.map((source) => ({ source, status: "failed" }));
    if (lineage.entries?.[0]) lineage.entries[0].exactRuleOutcome = "failed";
  }
  return {
    url: report.finalUrl ?? report.url,
    baselineAuditId: report.auditId,
    repairId: repair.id,
    repairRevision: Number.isFinite(repair.revision) ? repair.revision : 1,
    findingId: repair.findingId,
    findingIds: Array.isArray(repair.findingIds) && repair.findingIds.length
      ? [...repair.findingIds]
      : [repair.findingId],
    findingTitle: repair.findingTitle,
    findingPackage: repair.findingPackage ? JSON.parse(JSON.stringify(repair.findingPackage)) : null,
    findingSource: repair.findingSource,
    findingScope,
    baselineEngine: report.engine,
    baselineEvidence: reportEvidenceSignature(report),
    baseline,
    lineage,
    browserReplay: browserReplayBaseline
      ? {
          required: true,
          status: "not-opened",
          baseline: browserReplayBaseline,
        }
      : null,
    repositoryPlan: repositoryPlanSnapshot(repair.repositoryPlan),
    diagnosticMission: diagnosticMissionSnapshotForArtifact(repair.diagnosticMission),
    diagnosticMissions: (repair.diagnosticMissions ?? [])
      .map(diagnosticMissionSnapshotForArtifact)
      .filter(Boolean),
    approval: approvalSnapshot(repair),
    implementationReceipt: implementationReceiptSnapshot(repair.implementationReceipt),
    deploymentAttestedAt: repair.deploymentAttestedAt,
  };
}

function metricDelta(current, baseline) {
  return Number.isFinite(current) && Number.isFinite(baseline) ? current - baseline : null;
}

function browserReplayComparison(replay, review, index = 0) {
  const baseline = replay?.baseline;
  if (!replay?.required || !baseline) return null;
  if (!review || review.purpose !== "verification") {
    return {
      comparable: false,
      reason: "browser-replay-required",
      outcome: "not-comparable",
      replay: { required: true, status: "not-opened", baseline },
    };
  }
  const checkId = index === 0 ? "fresh-browser-replay" : `fresh-browser-replay-${index + 1}`;
  const result = review.results?.find((item) =>
    item.taskTrigger?.findingId === baseline.findingId || item.checkId === checkId) ?? null;
  const reviewStatus = review.state?.status ?? "in-progress";
  if (!result || result.outcome === "blocked") {
    const status = result?.outcome === "blocked" ? "blocked" : reviewStatus;
    return {
      comparable: false,
      reason: status === "blocked" ? "browser-replay-blocked" : "browser-replay-in-progress",
      outcome: "not-comparable",
      replay: {
        required: true,
        status,
        baseline,
        reviewId: review.id,
        outcome: result?.outcome ?? null,
        summary: result?.summary ?? null,
        observations: [...(result?.observations ?? [])],
        blockerReason: result?.blockerReason ?? null,
        reportedAt: result?.reportedAt ?? null,
        provenance: result?.source === "person" ? "person-reported-browser" : "agent-reported-browser",
      },
    };
  }
  const outcome = result.outcome === "passed" ? "passed" : "failed";
  return {
    comparable: true,
    reason: "exact-browser-replay",
    outcome,
    replay: {
      required: true,
      status: "complete",
      baseline,
      reviewId: review.id,
      outcome: result.outcome,
      summary: result.summary,
      observations: [...(result.observations ?? [])],
      blockerReason: null,
      reportedAt: result.reportedAt,
      provenance: result.source === "person" ? "person-reported-browser" : "agent-reported-browser",
    },
  };
}

function browserGuardrailComparisons(verification, review) {
  return (Array.isArray(verification?.browserGuardrails) ? verification.browserGuardrails : [])
    .slice(0, 2)
    .map((baseline) => {
      const result = review?.purpose === "verification"
        ? review.results?.find((item) => item.taskTrigger?.auditId === baseline.checkId)
        : null;
      const status = !result
        ? review ? "in-progress" : "not-opened"
        : result.outcome === "blocked" ? "blocked" : "complete";
      return {
        required: true,
        checkId: briefText(baseline.checkId, 80),
        label: briefText(baseline.label, 120),
        focusArea: briefText(baseline.focusArea, 40),
        viewport: briefText(baseline.viewport, 40),
        status,
        outcome: result?.outcome ?? null,
        summary: result?.summary ? briefText(result.summary, 300) : null,
        observations: (result?.observations ?? []).slice(0, 4).map((item) => briefText(item, 400)),
        blockerReason: result?.blockerReason ?? null,
        reportedAt: Number.isFinite(result?.reportedAt) ? result.reportedAt : null,
        provenance: result
          ? result.source === "person" ? "person-reported-browser" : "agent-reported-browser"
          : null,
      };
    });
}

export function compareVerification(report, verification, now = Date.now(), browserReview = null) {
  const source = verification?.findingSource;
  const findingScope = {
    occurrenceCount: Number.isFinite(verification?.findingScope?.occurrenceCount)
      ? Math.max(1, Math.round(verification.findingScope.occurrenceCount))
      : 1,
    occurrencesOmitted: Number.isFinite(verification?.findingScope?.occurrencesOmitted)
      ? Math.max(0, Math.round(verification.findingScope.occurrencesOmitted))
      : 0,
    sources: findingScopeSources(verification?.findingScope, source),
  };
  const baselineEngine = verification?.baselineEngine;
  const measuredEngine = report?.engine;
  const replayInputs = Array.isArray(verification?.browserReplays) && verification.browserReplays.length
    ? verification.browserReplays
    : verification?.browserReplay
      ? [verification.browserReplay]
      : [];
  const browserReplayComparisons = replayInputs
    .slice(0, 3)
    .map((replay, index) => browserReplayComparison(replay, browserReview, index))
    .filter(Boolean);
  const browserReplay = browserReplayComparisons[0] ?? null;
  const browserGuardrails = browserGuardrailComparisons(verification, browserReview);
  const primaryIsBrowserFinding = source?.provider === "Frontmend browser review";
  const scopeOutcomes = primaryIsBrowserFinding && browserReplay
    ? findingScope.sources.map((candidate) => ({
        source: candidate,
        outcome: browserReplay.outcome,
        comparable: browserReplay.comparable,
        comparisonReason: browserReplay.reason,
      }))
    : findingScope.sources.map((candidate) => {
        const outcome = outcomeForSource(report, candidate);
        const comparison = exactRuleComparison({
          source: candidate,
          baselineEngine,
          measuredEngine,
          measuredRuleOutcome: outcome,
        });
        return {
          source: candidate,
          outcome: comparison.comparable ? outcome : "not-comparable",
          comparable: comparison.comparable,
          comparisonReason: comparison.reason,
        };
      });
  const comparable = scopeOutcomes.length > 0 && scopeOutcomes.every((outcome) => outcome.comparable);
  const measuredEvidence = reportEvidenceSignature(report);
  const metricComparable = sameEvidenceSignature(
    verification?.baselineEvidence,
    measuredEvidence,
  );
  const ruleOutcome = comparable
    ? aggregateRuleOutcome(scopeOutcomes.map((outcome) => outcome.outcome))
    : "not-comparable";
  const exactStatus = !comparable
    ? "inconclusive"
    : ruleOutcome === "failed"
      ? "still-present"
      : ruleOutcome === "passed"
        ? "resolved"
        : "inconclusive";
  const guardrailsComplete = browserGuardrails.every((guardrail) => guardrail.status === "complete");
  const guardrailRegression = browserGuardrails.some((guardrail) => guardrail.outcome === "issue");
  const replaysComplete = browserReplayComparisons.every((comparison) => comparison.comparable);
  const replayStillPresent = browserReplayComparisons.some((comparison) => comparison.outcome === "failed");
  const status = exactStatus === "still-present" || replayStillPresent
    ? "still-present"
    : guardrailRegression
      ? "regression"
      : guardrailsComplete && replaysComplete
        ? exactStatus
        : "inconclusive";
  const baseline = verification.baseline ?? reportSnapshot(null, source, findingScope);
  const current = reportSnapshot(report, source, findingScope);
  if (browserReplay) current.exactRuleOutcome = ruleOutcome;
  const lineage = appendLineage(
    verification.lineage ?? {
      rootAuditId: baseline.auditId,
      findingSource: source,
      findingScope,
      attemptCount: 0,
      omitted: 0,
      entries: [lineageEntry(baseline, 0, "baseline", verification?.baselineEvidence ?? null, true)],
    },
    current,
    status,
    measuredEvidence,
    metricComparable,
  );
  return {
    baselineAuditId: verification.baselineAuditId,
    repairId: verification.repairId,
    repairRevision: verification.repairRevision,
    findingId: verification.findingId,
    findingIds: Array.isArray(verification.findingIds) && verification.findingIds.length
      ? [...verification.findingIds]
      : [verification.findingId],
    findingTitle: verification.findingTitle,
    findingPackage: verification.findingPackage ?? null,
    findingSource: source,
    findingScope,
    scopeOutcomes,
    repositoryPlan: repositoryPlanSnapshot(verification.repositoryPlan),
    diagnosticMission: diagnosticMissionSnapshotForArtifact(verification.diagnosticMission),
    diagnosticMissions: (verification.diagnosticMissions ?? [])
      .map(diagnosticMissionSnapshotForArtifact)
      .filter(Boolean),
    approval: verification.approval ?? null,
    implementationReceipt: implementationReceiptSnapshot(verification.implementationReceipt),
    aggregateMatrix: verification.aggregateMatrix ?? null,
    browserReplay: browserReplay?.replay ?? null,
    browserReplays: browserReplayComparisons.map((comparison) => comparison.replay),
    browserGuardrails,
    deploymentAttestedAt: verification.deploymentAttestedAt,
    status,
    comparable,
    ruleOutcome,
    baselineEngine: baselineEngine?.mode,
    measuredEngine: report.engine.mode,
    baselineEvidence: verification?.baselineEvidence ?? null,
    measuredEvidence,
    metricComparable,
    comparisonReason: comparable
      ? scopeOutcomes.length > 1
        ? "all-scoped-rules-comparable"
        : scopeOutcomes[0]?.comparisonReason
      : scopeOutcomes.find((outcome) => !outcome.comparable)?.comparisonReason ?? "exact-rule-not-evaluated",
    completedAt: now,
    proof: {
      baseline,
      current,
      deltas: {
        score: metricComparable ? metricDelta(current.score, baseline.score) : null,
        checksPassed: metricComparable
          ? metricDelta(current.checks.passed, baseline.checks?.passed)
          : null,
        findings: metricComparable
          ? metricDelta(current.findingCount, baseline.findingCount)
          : null,
      },
    },
    lineage,
    message:
      status === "resolved"
        ? browserReplay
          ? "The exact retained browser issue was not observed in a fresh agent replay after deployment."
          : metricComparable
          ? findingScope.sources.length > 1
            ? "Every captured rule occurrence explicitly passed in fresh evidence with like-for-like report metrics."
            : "The exact original rule explicitly passed in fresh evidence with like-for-like report metrics."
          : findingScope.sources.length > 1
            ? "Every captured rule occurrence explicitly passed, but whole-report metrics are not like for like."
            : "The exact original rule explicitly passed, but whole-report metrics are not like for like."
        : status === "still-present"
          ? browserReplay
            ? "The exact retained browser issue was observed again in a fresh agent replay after deployment."
            : metricComparable
            ? findingScope.sources.length > 1
              ? "At least one captured rule occurrence failed again in fresh evidence with like-for-like report metrics."
              : "The exact original rule explicitly failed again in fresh evidence with like-for-like report metrics."
            : findingScope.sources.length > 1
              ? "At least one captured rule occurrence failed again, but whole-report metrics are not like for like."
              : "The exact original rule explicitly failed again, but whole-report metrics are not like for like."
          : status === "regression"
            ? "The repaired rule passed, but a retained browser journey or reflow guardrail regressed in fresh evidence."
          : browserReplayComparisons.some((comparison) => !comparison.comparable)
            ? "Provider measurement is complete, but every retained browser issue still needs its exact fresh replay before resolution can be claimed."
          : browserGuardrails.some((guardrail) => guardrail.status !== "complete")
            ? "Provider measurement is complete, but retained browser guardrails still need fresh direct comparisons before resolution can be claimed."
          : comparable
            ? "The fresh audit did not affirmatively pass every captured rule occurrence, so Frontmend cannot claim it was resolved across the repair scope."
            : browserReplay?.reason === "browser-replay-required"
              ? "Provider measurement is complete, but the exact retained browser issue still needs a fresh agent replay before Frontmend can issue a verification receipt."
              : browserReplay?.reason === "browser-replay-in-progress"
                ? "The fresh browser replay is in progress; Frontmend is withholding a resolution claim until the exact retained check is recorded."
                : browserReplay?.reason === "browser-replay-blocked"
                  ? "The fresh browser replay is honestly blocked, so Frontmend cannot claim the retained browser issue was resolved."
                  : inconclusiveComparisonMessage(
                scopeOutcomes.find((outcome) => !outcome.comparable)?.comparisonReason,
              ),
  };
}

export function repairExportMarkdown({ report, repair }) {
  if (repair?.status !== "approved") {
    throw new AuditError("REPAIR_NOT_APPROVED", "Approve this repair draft before exporting it.");
  }
  const scopeSources = findingScopeSources(repair.findingScope, repair.findingSource);
  const occurrenceCount = Number.isFinite(repair.findingScope?.occurrenceCount)
    ? Math.max(scopeSources.length, Math.round(repair.findingScope.occurrenceCount))
    : scopeSources.length;
  const occurrencesOmitted = Number.isFinite(repair.findingScope?.occurrencesOmitted)
    ? Math.max(0, Math.round(repair.findingScope.occurrencesOmitted))
    : 0;
  const packageItems = repair.findingPackage?.items?.length
    ? repair.findingPackage.items
    : [{
        findingId: repair.findingId,
        title: repair.findingTitle,
        severity: null,
        source: repair.findingSource,
        scope: repair.findingScope,
        diagnosticMission: repair.diagnosticMission,
      }];
  const packageDiagnoses = packageItems
    .map((item) => item.diagnosticMission)
    .filter((mission) => mission?.diagnosis);
  const lines = [
    `# Frontmend repair: ${packageItems.length > 1 ? `${packageItems.length}-finding package` : repair.findingTitle}`,
    "",
    `- Site: ${report.finalUrl ?? report.url}`,
    `- Baseline audit: ${report.auditId}`,
    `- Primary finding: ${repair.findingId}`,
    `- Package findings: ${packageItems.length}`,
    `- Repair revision: ${Number.isFinite(repair.revision) ? repair.revision : 1}`,
    `- Patch type: ${repair.patchType}`,
    `- Risk: ${repair.risk}`,
    `- Captured rule occurrences: ${occurrenceCount}`,
    `- Occurrences omitted by bound: ${occurrencesOmitted}`,
    `- Approval: ${repair.approval?.mode === "delegated-auto" ? "delegated auto mode under a prior human grant" : "explicit human review"}`,
    `- Approval recorded: ${new Date(repair.reviewedAt).toISOString()}`,
    `- Deployment handoff: ${Number.isFinite(repair.deploymentAttestedAt) ? `site owner attested ${new Date(repair.deploymentAttestedAt).toISOString()}` : "not yet attested"}`,
    "",
    ...(packageItems.length > 1
      ? [
          "## Frozen repair package",
          "",
          "| Finding | Severity | Provider | Rule |",
          "| --- | --- | --- | --- |",
          ...packageItems.map((item) =>
            `| ${receiptText(item.title, 240)}<br><code>${receiptText(item.findingId, 160)}</code> | ${receiptText(item.severity, 20)} | ${receiptText(item.source?.provider, 120)} | ${receiptText(item.source?.auditId, 160)} |`,
          ),
          "",
          "> Package membership was frozen at explicit preparation. One approval and one implementation receipt cover this exact set; verification remains finding-specific.",
          "",
        ]
      : []),
    "## Captured repair scope",
    "",
    "| Provider | Rule | Strategy |",
    "| --- | --- | --- |",
    ...scopeSources.map((source) =>
      `| ${receiptText(source.provider, 120)} | ${receiptText(source.auditId, 160)} | ${receiptText(source.strategy, 40)} |`,
    ),
    "",
    "> Every listed occurrence must explicitly pass in a fresh audit before Frontmend can mark this repair resolved.",
    "",
    ...(repair.repositoryPlan
      ? [
          "## Repository plan",
          "",
          `- Planned files: ${repair.repositoryPlan.files.map((file) => `\`${receiptText(file, 200)}\``).join(", ")}`,
          `- Planned checks: ${repair.repositoryPlan.checks.map((check) => receiptText(check, 120)).join("; ")}`,
          "",
          "> Coding-agent plan metadata only. Frontmend did not inspect these files, receive their contents, or run these checks.",
          "",
        ]
      : []),
    ...(packageDiagnoses.length
      ? [
          "## Diagnostic provenance",
          "",
          ...packageDiagnoses.flatMap((mission, index) => [
            ...(packageDiagnoses.length > 1 ? [`### ${index + 1}. ${receiptText(mission.findingTitle ?? mission.findingId, 240)}`, ""] : []),
            `- Finding: ${receiptText(mission.findingId, 160)}`,
            `- Measured symptom: ${receiptText(mission.measuredEvidence?.kind, 80)} (${receiptText(mission.measuredEvidence?.provenance, 80)})`,
            `- Contributed by: ${mission.diagnosis.agentReported ? "coding agent" : "person"} at ${new Date(mission.diagnosis.reportedAt).toISOString()}`,
            `- Confidence: ${receiptText(mission.diagnosis.confidence, 20)}`,
            `- Diagnosis: ${receiptText(mission.diagnosis.summary, 300)}`,
            `- Reproduction: ${receiptText(mission.diagnosis.reproduction, 600)}`,
            `- Source locations: ${mission.diagnosis.sourceLocations.map((location) => `\`${receiptText(location.file, 200)}${location.line ? `:${location.line}` : ""}\``).join(", ")}`,
            `- Planned checks: ${mission.diagnosis.verificationChecks.map((check) => receiptText(check, 120)).join("; ")}`,
            "",
          ]),
          "> Lighthouse evidence and contributed diagnosis remain separately attributed. Frontmend did not inspect repository source or independently prove the diagnosis.",
          "",
        ]
      : []),
    "## Repair summary",
    "",
    repair.summary,
    "",
    "## Proposed patch",
    "",
    "```",
    repair.patch,
    "```",
    "",
    "## Verification plan",
    "",
    repair.verificationPlan,
    "",
    ...(repair.implementationReceipt
      ? [
          "## Repository implementation receipt",
          "",
          `- Receipt revision: ${Number.isFinite(repair.implementationReceipt.revision) ? repair.implementationReceipt.revision : 1}`,
          `- Previous receipts retained: ${Array.isArray(repair.implementationHistory) ? repair.implementationHistory.length : 0}`,
          `- Reported by: coding agent at ${new Date(repair.implementationReceipt.reportedAt).toISOString()}`,
          `- Summary: ${receiptText(repair.implementationReceipt.summary, 300)}`,
          `- Files: ${repair.implementationReceipt.files.map((file) => `\`${receiptText(file, 200)}\``).join(", ")}`,
          `- Checks: ${repair.implementationReceipt.checks.map((check) => `${receiptText(check.name, 120)} — ${receiptText(check.status, 20)}`).join("; ")}`,
          `- Git object: ${receiptText(repair.implementationReceipt.commitSha, 64)}`,
          "",
          "> This receipt is agent-reported repository metadata. Frontmend did not inspect or change source, run these checks, or deploy the site.",
          "",
        ]
      : []),
    ...(repair.candidateReview
      ? (() => {
          const candidate = candidateReviewSnapshot(
            repair.candidateReview,
            repair.candidateReviewHistory,
          );
          const correction = candidateCorrectionPacket(repair);
          return [
            "## Candidate browser review",
            "",
            `- Candidate origin: ${receiptText(candidate.candidateOrigin, 2_048)}`,
            `- Repair revision: ${artifactMetric(candidate.repairRevision)}`,
            `- Implementation receipt revision: ${artifactMetric(candidate.implementationReceiptRevision)}`,
            `- Status: ${receiptText(candidate.status, 40)}`,
            `- Checks recorded: ${artifactMetric(candidate.state?.completedCheckCount)} of ${artifactMetric(candidate.state?.requestedCheckCount)}`,
            `- Previous candidate iterations retained: ${candidate.historySummary.length}`,
            "",
            ...(candidate.results ?? []).map((result) =>
              `- ${receiptText(result.checkId, 80)} — ${receiptText(result.outcome, 20)} — ${receiptText(result.summary, 300)} (${receiptText(result.source === "agent" ? "coding agent" : "person", 40)})`,
            ),
            "",
            ...(correction
              ? [
                  "### Candidate correction packet",
                  "",
                  `- Bound to candidate review: ${receiptText(correction.revisionBinding.candidateReviewId, 160)}`,
                  `- Approved files: ${correction.approvedRepositoryScope.files.length ? correction.approvedRepositoryScope.files.map((file) => `\`${receiptText(file, 200)}\``).join(", ") : "existing reviewed scope"}`,
                  `- Required checks: ${correction.approvedRepositoryScope.checks.length ? correction.approvedRepositoryScope.checks.map((check) => receiptText(check, 120)).join("; ") : "existing reviewed checks"}`,
                  ...correction.issues.flatMap((issue) => [
                    `- ${receiptText(issue.label, 120)} at \`${receiptText(issue.target.path, 256)}\` · ${receiptText(issue.target.viewport, 20)} · \`${receiptText(issue.target.selectorOrLandmark, 200)}\``,
                    `  - Retained baseline: ${receiptText(issue.retainedSymptom.evidence, 600)}`,
                    `  - Candidate observation: ${receiptText(issue.candidateObservation.summary, 300)} (${receiptText(issue.candidateObservation.source, 20)})`,
                    `  - Accept when: ${receiptText(issue.acceptanceCriteria, 600)}`,
                  ]),
                  "",
                  "> The correction packet narrows the next coding iteration. It does not inspect source, create a new finding, prove deployment, or resolve the public claim.",
                  "",
                ]
              : []),
            "> Candidate-browser observations are optional pre-production evidence only. They are not a provider audit, deployment attestation, production verification, or resolution claim.",
            "",
          ];
        })()
      : []),
    "> This artifact is a reviewed proposal. It does not claim the target site was changed or the finding was resolved.",
    "",
  ];
  return lines.join("\n");
}

function receiptText(value, maximum = 240) {
  return String(value ?? "—")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\|/g, "\\|")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum) || "—";
}

function signedMetric(value) {
  return Number.isFinite(value) ? `${value > 0 ? "+" : ""}${value}` : "—";
}

function artifactMetric(value) {
  return Number.isFinite(value) ? value : "—";
}

function diagnosticMarkdownLines(diagnostics) {
  if (!diagnostics) return [];
  const lines = [
    `Measured diagnostics: ${receiptText(diagnostics.kind, 80)} · ${receiptText(diagnostics.completeness, 40)}`,
  ];
  if (diagnostics.kind === "console-errors") {
    for (const entry of diagnostics.entries ?? []) {
      const location = [entry.sourceUrl, entry.lineNumber, entry.columnNumber]
        .filter((value) => value !== null && value !== "")
        .join(":");
      lines.push(`- Console: ${receiptText(entry.description, 320)}${location ? ` — ${receiptText(location, 300)}` : ""}`);
    }
  }
  if (diagnostics.kind === "contrast-nodes") {
    for (const node of diagnostics.nodes ?? []) {
      const ratio = Number.isFinite(node.observedRatio)
        ? ` · ${node.observedRatio}:1 observed${Number.isFinite(node.expectedRatio) ? ` / ${node.expectedRatio}:1 expected` : ""}`
        : "";
      lines.push(`- Contrast: ${receiptText(node.selector, 160)}${ratio}${node.explanation ? ` — ${receiptText(node.explanation, 360)}` : ""}`);
    }
  }
  if (diagnostics.kind === "main-thread-blocking") {
    lines.push(`- Total blocking time: ${artifactMetric(diagnostics.totalBlockingTimeMs)} ms`);
    for (const task of diagnostics.longTasks ?? []) {
      lines.push(`- Long task: ${artifactMetric(task.durationMs)} ms${task.sourceUrl ? ` — ${receiptText(task.sourceUrl, 240)}` : " — source unavailable"}`);
    }
  }
  if (diagnostics.missing?.length) {
    lines.push(`- Missing evidence: ${diagnostics.missing.map((item) => receiptText(item, 100)).join(", ")}`);
  }
  if (diagnostics.omitted) lines.push(`- Diagnostic items omitted by bound: ${diagnostics.omitted}`);
  if (diagnostics.caveat) lines.push(`- Boundary: ${receiptText(diagnostics.caveat, 360)}`);
  return [...lines, ""];
}

function reportTimestamp(value) {
  if (!Number.isFinite(value)) return "—";
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? "—" : timestamp.toISOString();
}

export function auditReportMarkdown(report) {
  if (!report?.auditId || !report?.engine?.mode || !report?.engine?.provider) {
    throw new AuditError(
      "AUDIT_REPORT_UNAVAILABLE",
      "An audit report is available only after a completed audit.",
    );
  }

  const retainedFindings = Array.isArray(report.findings) ? report.findings : [];
  const findings = retainedFindings.slice(0, 20);
  const providerFindingOmitted = Number.isFinite(report.findingsOmitted)
    ? Math.max(0, Math.round(report.findingsOmitted))
    : Math.max(0, (Number.isFinite(report.findingCount) ? report.findingCount : retainedFindings.length) - retainedFindings.length);
  const findingOmitted =
    providerFindingOmitted + Math.max(0, retainedFindings.length - findings.length);
  const outcomes = Array.isArray(report.ruleOutcomes) ? report.ruleOutcomes.slice(0, 64) : [];
  const outcomeOmitted = Math.max(0, (Array.isArray(report.ruleOutcomes) ? report.ruleOutcomes.length : 0) - outcomes.length);
  const viewports = Array.isArray(report.viewports) ? report.viewports.slice(0, 8) : [];
  const viewportFailures = Array.isArray(report.viewportFailures)
    ? report.viewportFailures.slice(0, 2)
    : [];
  const isDocumentAudit = report.engine.mode === "live-document";
  const boundary = isDocumentAudit
    ? "This run inspected the fetched HTML document and public response headers. It did not execute page scripts, exercise user journeys, capture screenshots, or measure rendered viewport behavior."
    : report.engine.mode === "live-lighthouse-document"
      ? "This run combined mobile and desktop Lighthouse lab evidence with fetched HTML, public response headers, metadata, and bounded route discovery. Document evidence did not execute scripts or prove every user journey."
    : report.engine.mode === "live-lighthouse"
      ? "This run used Lighthouse lab evidence for the listed emulated strategies. It does not prove every device, user journey, network condition, or production state."
      : report.engine.mode === "hybrid-lighthouse-document"
        ? "This run retained Lighthouse lab evidence only for the measured strategies and supplemented unavailable viewport evidence with fetched HTML and public response headers. Document evidence did not execute scripts or measure rendered behavior."
        : report.engine.mode === "live-lighthouse-partial"
          ? "This run retained Lighthouse lab evidence only for the measured strategies. Unavailable strategies were not inferred or replaced with fabricated viewport results."
          : "This report records only the public evidence observed by the named audit engine and does not extend beyond those measurements.";

  const lines = [
    "# Frontmend audit report",
    "",
    "> Evidence artifact only. Frontmend does not claim it deployed, changed, or gained source access to the target site.",
    "",
    `- Target: ${receiptText(report.url, 2_048)}`,
    `- Final URL: ${receiptText(report.finalUrl ?? report.url, 2_048)}`,
    `- Audit ID: \`${receiptText(report.auditId, 80)}\``,
    `- Completed: ${reportTimestamp(report.completedAt)}`,
    `- Evidence mode: ${receiptText(report.engine.mode)}`,
    `- Provider: ${receiptText(report.engine.provider)}`,
    `- Rule set: ${artifactMetric(report.engine.ruleSetVersion)}`,
    ...(report.engine.lighthouseVersion
      ? [`- Lighthouse: ${receiptText(report.engine.lighthouseVersion, 80)}`]
      : []),
    `- Provider notice: ${receiptText(report.engine.notice, 500)}`,
    ...(report.coverage
      ? [
          `- Coverage: ${receiptText(report.coverage.level, 80)}`,
          `- Lighthouse source: ${receiptText(report.coverage.sources?.lighthouse?.status, 40)}`,
          `- Document source: ${receiptText(report.coverage.sources?.document?.status, 40)}`,
          `- Observed route candidates: ${artifactMetric(report.coverage.routeCandidateCount)}`,
        ]
      : []),
    "",
    "## Summary",
    "",
    "| Score | Checks passed | Warnings | Failed | Findings | Viewports measured |",
    "| ---: | ---: | ---: | ---: | ---: | ---: |",
    `| ${artifactMetric(report.score)} | ${artifactMetric(report.checks?.passed)} | ${artifactMetric(report.checks?.warnings)} | ${artifactMetric(report.checks?.failed)} | ${artifactMetric(report.findingCount)} | ${artifactMetric(report.viewportCount)} |`,
  ];

  if (Array.isArray(report.sourceFailures) && report.sourceFailures.length) {
    lines.push(
      "## Unavailable evidence sources",
      "",
      ...report.sourceFailures.slice(0, 3).map(
        (failure) => `- ${receiptText(failure.source, 40)} · ${receiptText(failure.code, 80)}: ${receiptText(failure.message, 240)}`,
      ),
      "",
    );
  }

  if (report.exploration?.parentAuditId && Number.isFinite(report.exploration.depth)) {
    const trail = Array.isArray(report.exploration.trail)
      ? report.exploration.trail.slice(0, 5)
      : [];
    lines.push(
      "",
      "## Route journey",
      "",
      "> Provenance only. This trail records linked public audits; it does not claim navigation coverage beyond each fetched document.",
      "",
      `- Root audit: ${receiptText(report.exploration.rootAuditId, 80)}`,
      `- Parent audit: ${receiptText(report.exploration.parentAuditId, 80)}`,
      `- Route depth: ${Math.max(1, Math.min(5, Math.round(report.exploration.depth)))}`,
      `- Observed path: ${receiptText(report.exploration.observedPath, 256)}`,
    );
    if (trail.length) {
      lines.push(
        "",
        "### Linked ancestors",
        "",
        ...trail.map(
          (entry, index) =>
            `- ${index === 0 ? "Root" : `Hop ${index}`}: ${receiptText(entry?.path, 256)} — audit ${receiptText(entry?.auditId, 80)}`,
        ),
      );
    }
  }

  if (viewports.length) {
    lines.push(
      "",
      "### Recorded strategies",
      "",
      ...viewports.map((viewport) =>
        `- ${receiptText(viewport?.label ?? viewport?.id, 120)} — ${receiptText(viewport?.detail, 160)}`,
      ),
    );
  }

  if (viewportFailures.length) {
    lines.push(
      "",
      "### Unavailable strategies",
      "",
      ...viewportFailures.map((failure) =>
        `- ${receiptText(failure?.label ?? failure?.id, 120)} — ${receiptText(failure?.code, 80)}: ${receiptText(failure?.message, 240)}`,
      ),
    );
  }

  if (report.documentSupplement) {
    lines.push(
      "",
      "### Hybrid document supplement",
      "",
      `- Non-overlapping document rules added: ${artifactMetric(report.documentSupplement.evaluatedRuleCount)}`,
      `- Overlapping document rules omitted from totals: ${artifactMetric(report.documentSupplement.overlappingRulesOmitted)}`,
      `- Boundary: ${receiptText(report.documentSupplement.caveat, 360)}`,
    );
  }

  const profile = report.documentProfile?.type === "live-document-profile"
    ? report.documentProfile
    : null;
  if (profile) {
    const origins = Array.isArray(profile.externalOrigins)
      ? profile.externalOrigins.slice(0, 12)
      : [];
    const routes = Array.isArray(profile.routes) ? profile.routes.slice(0, 8) : [];
    lines.push(
      "",
      "## Live document profile",
      "",
      "| HTML read | Scripts | Stylesheets | Images | Links | External origins |",
      "| ---: | ---: | ---: | ---: | ---: | ---: |",
      `| ${artifactMetric(profile.htmlBytes)} bytes | ${artifactMetric(profile.elements?.scripts)} | ${artifactMetric(profile.elements?.stylesheets)} | ${artifactMetric(profile.elements?.images)} | ${artifactMetric(profile.elements?.links)} | ${origins.length} |`,
      "",
      `- Content type: ${receiptText(profile.headers?.contentType, 160)}`,
      `- Content Security Policy: ${profile.headers?.contentSecurityPolicy ? "observed" : "not observed"}`,
      `- X-Content-Type-Options nosniff: ${profile.headers?.nosniff ? "observed" : "not observed"}`,
      `- Inline scripts: ${artifactMetric(profile.inline?.scripts)}`,
      `- Inline styles: ${artifactMetric(profile.inline?.styles)}`,
    );
    if (origins.length) {
      lines.push(
        "",
        "### External origins observed in markup",
        "",
        ...origins.map((origin) => `- ${receiptText(origin, 2_048)}`),
      );
    }
    if (Number.isFinite(profile.externalOriginsOmitted) && profile.externalOriginsOmitted > 0) {
      lines.push(
        "",
        `_${profile.externalOriginsOmitted} additional origin reference${profile.externalOriginsOmitted === 1 ? " was" : "s were"} omitted from this bounded profile._`,
      );
    }
    if (routes.length) {
      lines.push(
        "",
        "### Same-site routes observed in markup",
        "",
        ...routes.map((path) => `- ${receiptText(path, 256)}`),
      );
    }
    if (Number.isFinite(profile.routesOmitted) && profile.routesOmitted > 0) {
      lines.push(
        "",
        `_${profile.routesOmitted} additional route${profile.routesOmitted === 1 ? " was" : "s were"} omitted from this bounded profile._`,
      );
    }
    if (routes.length && profile.routesCaveat) {
      lines.push("", receiptText(profile.routesCaveat, 500));
    }
    lines.push("", receiptText(profile.caveat, 500));
  }

  lines.push("", "## Findings", "");
  if (!findings.length) {
    lines.push("No findings were emitted by this audit run.");
  } else {
    findings.forEach((finding, index) => {
      lines.push(
        `### ${index + 1}. ${receiptText(finding?.title, 180)}`,
        "",
        `- Severity: ${receiptText(finding?.severity, 40)}`,
        `- Category: ${receiptText(finding?.category, 80)}`,
        `- Provider: ${receiptText(finding?.source?.provider, 120)}`,
        `- Rule: ${receiptText(finding?.source?.auditId ?? finding?.id, 120)}`,
        `- Strategy: ${receiptText(finding?.source?.strategy ?? finding?.viewport, 120)}`,
        "",
        `Evidence: ${receiptText(finding?.evidence ?? finding?.summary, 600)}`,
        "",
        ...diagnosticMarkdownLines(diagnosticEvidenceSnapshot(finding?.diagnosticEvidence)),
        `Suggested repair: ${receiptText(finding?.repair, 700)}`,
        "",
      );
    });
  }
  if (findingOmitted) lines.push(`_${findingOmitted} additional finding${findingOmitted === 1 ? " was" : "s were"} omitted from this bounded export._`, "");

  lines.push("## Rule outcomes", "");
  if (!outcomes.length) {
    lines.push("No explicit rule outcomes were recorded for this run.", "");
  } else {
    lines.push(
      "| Provider | Rule | Strategy | Outcome |",
      "| --- | --- | --- | --- |",
      ...outcomes.map((outcome) =>
        `| ${receiptText(outcome?.source?.provider, 120)} | ${receiptText(outcome?.source?.auditId, 120)} | ${receiptText(outcome?.source?.strategy, 120)} | ${receiptText(outcome?.status, 40)} |`,
      ),
      "",
    );
  }
  if (outcomeOmitted) lines.push(`_${outcomeOmitted} additional rule outcome${outcomeOmitted === 1 ? " was" : "s were"} omitted from this bounded export._`, "");

  lines.push(
    "## Evidence boundary",
    "",
    boundary,
    "",
    "The findings and suggested repairs are decision support based on public observations. A person must review, implement, deploy, and independently verify any change through the site's normal workflow.",
    "",
  );
  return lines.join("\n");
}

export function verificationReceiptMarkdown(report) {
  const verification = report?.verification;
  const proof = verification?.proof;
  if (!verification || !proof?.baseline?.auditId || !proof?.current?.auditId) {
    throw new AuditError(
      "VERIFICATION_RECEIPT_UNAVAILABLE",
      "A verification receipt is available only after a completed repair verification.",
    );
  }
  const browserReplays = Array.isArray(verification.browserReplays) && verification.browserReplays.length
    ? verification.browserReplays
    : verification.browserReplay?.required
      ? [verification.browserReplay]
      : [];
  if (browserReplays.some((replay) => replay?.required && replay.status !== "complete")) {
    throw new AuditError(
      "VERIFICATION_RECEIPT_UNAVAILABLE",
      "Complete every exact fresh browser replay before exporting a verification receipt.",
    );
  }
  if ((verification.browserGuardrails ?? []).some((guardrail) => guardrail.status !== "complete")) {
    throw new AuditError(
      "VERIFICATION_RECEIPT_UNAVAILABLE",
      "Complete every retained browser guardrail before exporting a verification receipt.",
    );
  }
  const metricComparable = verification.metricComparable === true;
  const scopeSources = findingScopeSources(verification.findingScope, verification.findingSource);
  const occurrenceCount = Number.isFinite(verification.findingScope?.occurrenceCount)
    ? Math.max(scopeSources.length, Math.round(verification.findingScope.occurrenceCount))
    : scopeSources.length;
  const occurrencesOmitted = Number.isFinite(verification.findingScope?.occurrencesOmitted)
    ? Math.max(0, Math.round(verification.findingScope.occurrencesOmitted))
    : 0;
  const scopeOutcomes = Array.isArray(verification.scopeOutcomes)
    ? verification.scopeOutcomes.slice(0, 4)
    : scopeSources.map((source) => ({
        source,
        outcome: verification.ruleOutcome,
        comparable: verification.comparable,
        comparisonReason: verification.comparisonReason,
      }));
  const build = createBuildDescriptor();
  const lines = [
    "# Frontmend verification receipt",
    "",
    "> Evidence artifact only. Frontmend does not claim it deployed or changed the target site.",
    "",
    `- Target: ${receiptText(report.finalUrl ?? report.url, 2_048)}`,
    `- Result: ${receiptText(verification.status)}`,
    `- Finding: ${receiptText(verification.findingTitle)}`,
    `- Repair revision: ${Number.isFinite(verification.repairRevision) ? verification.repairRevision : 1}`,
    `- Exact rule: ${receiptText(verification.findingSource?.auditId ?? verification.findingId)}`,
    `- Exact rule outcome: ${receiptText(verification.ruleOutcome)}`,
    `- Exact rule comparison: ${verification.comparable ? "like for like" : "not comparable"}`,
    `- Captured rule occurrences: ${occurrenceCount}`,
    `- Occurrences omitted by bound: ${occurrencesOmitted}`,
    `- Summary metric comparison: ${metricComparable ? "like for like" : "not comparable; deltas withheld"}`,
    `- Comparison reason: ${receiptText(verification.comparisonReason, 120)}`,
    `- Repair approval: ${verification.approval?.mode === "delegated-auto" ? "delegated auto mode under a prior human grant" : "explicit human review"}`,
    `- Repository implementation: ${verification.implementationReceipt ? `agent-reported receipt revision ${verification.implementationReceipt.revision ?? 1}` : "not recorded (optional)"}`,
    `- Deployment attested by site owner: ${Number.isFinite(verification.deploymentAttestedAt) ? new Date(verification.deploymentAttestedAt).toISOString() : "—"}`,
    `- Completed: ${Number.isFinite(verification.completedAt) ? new Date(verification.completedAt).toISOString() : "—"}`,
    `- Frontmend build: ${build.commit ? `\`${build.commit}\`` : "unidentified"}`,
    `- Protocol: v${build.protocolVersion}; tool library v${build.toolLibraryVersion}; ${build.toolCount} contracts`,
    "",
    "## Rule-scope outcomes",
    "",
    "| Provider | Rule | Strategy | Comparable | Outcome |",
    "| --- | --- | --- | --- | --- |",
    ...scopeOutcomes.map((outcome) =>
      `| ${receiptText(outcome?.source?.provider, 120)} | ${receiptText(outcome?.source?.auditId, 160)} | ${receiptText(outcome?.source?.strategy, 40)} | ${outcome?.comparable ? "Yes" : "No"} | ${receiptText(outcome?.outcome ?? "missing", 40)} |`,
    ),
    "",
    "> Resolution requires an explicit pass for every captured occurrence. A passing strategy cannot hide a sibling failure or missing comparison.",
    "",
    ...(browserReplays.length
      ? [
          `## Fresh browser replay${browserReplays.length === 1 ? "" : "s"}`,
          "",
          ...browserReplays.flatMap((replay, index) => [
            ...(browserReplays.length > 1 ? [`### ${index + 1}. ${receiptText(replay.baseline?.title, 240)}`, ""] : []),
            `- Finding: ${receiptText(replay.baseline?.findingId, 160)}`,
            `- Baseline observation: ${receiptText(replay.baseline?.evidence, 600)}`,
            `- Retained element: ${receiptText(replay.baseline?.selector, 200)}`,
            `- Replay outcome: ${receiptText(replay.outcome, 40)}`,
            `- Agent summary: ${receiptText(replay.summary, 300)}`,
            ...((replay.observations ?? []).slice(0, 4).map(
              (observation) => `- Observed: ${receiptText(observation, 400)}`,
            )),
            `- Provenance: ${receiptText(replay.provenance, 80)}`,
            `- Reported: ${Number.isFinite(replay.reportedAt) ? new Date(replay.reportedAt).toISOString() : "—"}`,
            "",
          ]),
          "> This exact rendered comparison is agent-reported browser evidence and remains separate from provider measurement.",
          "",
        ]
      : []),
    ...((verification.browserGuardrails ?? []).length
      ? [
          "## Browser regression guardrails",
          "",
          "| Check | Viewport | Status | Outcome |",
          "| --- | --- | --- | --- |",
          ...verification.browserGuardrails.map((guardrail) =>
            `| ${receiptText(guardrail.label, 120)} | ${receiptText(guardrail.viewport, 40)} | ${receiptText(guardrail.status, 40)} | ${receiptText(guardrail.outcome ?? "—", 40)} |`,
          ),
          "",
          "> These fresh browser comparisons preserve retained journey and reflow checks separately from provider rule evidence.",
          "",
        ]
      : []),
    "## Before and after",
    "",
    "| Metric | Baseline | Fresh audit | Delta |",
    "| --- | ---: | ---: | ---: |",
    `| Score | ${proof.baseline.score ?? "—"} | ${proof.current.score ?? "—"} | ${signedMetric(metricComparable ? proof.deltas?.score : null)} |`,
    `| Checks passed | ${proof.baseline.checks?.passed ?? "—"} | ${proof.current.checks?.passed ?? "—"} | ${signedMetric(metricComparable ? proof.deltas?.checksPassed : null)} |`,
    `| Findings | ${proof.baseline.findingCount ?? "—"} | ${proof.current.findingCount ?? "—"} | ${signedMetric(metricComparable ? proof.deltas?.findings : null)} |`,
    "",
    `Baseline audit: \`${receiptText(proof.baseline.auditId, 80)}\`  `,
    `Fresh audit: \`${receiptText(proof.current.auditId, 80)}\``,
  ];
  const implementation = verification.implementationReceipt;
  const repositoryPlan = verification.repositoryPlan;
  const diagnosticMission = verification.diagnosticMission;
  if (diagnosticMission?.diagnosis) {
    lines.push(
      "",
      "## Diagnostic provenance",
      "",
      "> The public symptom was measured; the causal diagnosis below is separately attributed and was not independently proven by Frontmend.",
      "",
      `- Measured symptom: ${receiptText(diagnosticMission.measuredEvidence?.kind, 80)} (${receiptText(diagnosticMission.measuredEvidence?.provenance, 80)})`,
      `- Diagnosis source: ${diagnosticMission.diagnosis.agentReported ? "coding agent" : "person"}`,
      `- Diagnosis: ${receiptText(diagnosticMission.diagnosis.summary, 300)}`,
      `- Source locations: ${diagnosticMission.diagnosis.sourceLocations.map((location) => `\`${receiptText(location.file, 200)}${location.line ? `:${location.line}` : ""}\``).join(", ")}`,
      `- Planned checks: ${diagnosticMission.diagnosis.verificationChecks.map((check) => receiptText(check, 120)).join("; ")}`,
    );
  }
  if (repositoryPlan) {
    lines.push(
      "",
      "## Reviewed repository plan",
      "",
      "> Coding-agent plan metadata frozen before implementation. Frontmend did not inspect these files, receive their contents, or run these checks.",
      "",
      `- Planned files: ${repositoryPlan.files.map((file) => `\`${receiptText(file, 200)}\``).join(", ")}`,
      `- Planned checks: ${repositoryPlan.checks.map((check) => receiptText(check, 120)).join("; ")}`,
    );
  }
  if (implementation) {
    lines.push(
      "",
      "## Repository implementation provenance",
      "",
      "> Agent-reported repository metadata. Frontmend did not inspect the source, execute these checks, or deploy this Git object.",
      "",
      `- Receipt revision: ${Number.isFinite(implementation.revision) ? implementation.revision : 1}`,
      `- Reported: ${Number.isFinite(implementation.reportedAt) ? new Date(implementation.reportedAt).toISOString() : "—"}`,
      `- Summary: ${receiptText(implementation.summary, 300)}`,
      `- Files: ${implementation.files?.length ? implementation.files.map((file) => `\`${receiptText(file, 200)}\``).join(", ") : "—"}`,
      `- Checks: ${implementation.checks?.length ? implementation.checks.map((check) => `${receiptText(check.name, 120)} — ${receiptText(check.status, 20)}`).join("; ") : "—"}`,
      `- Git object: ${receiptText(implementation.commitSha, 64)}`,
    );
  }
  const entries = verification.lineage?.entries?.slice(0, MAX_LINEAGE_ENTRIES) ?? [];
  if (entries.length) {
    lines.push(
      "",
      "## Evidence trail",
      "",
      "| Attempt | Audit | Result | Metric coverage | Score | Passed | Findings |",
      "| --- | --- | --- | --- | ---: | ---: | ---: |",
      ...entries.map((entry) =>
        `| ${entry.attempt === 0 ? "Baseline" : `Attempt ${entry.attempt}`} | \`${receiptText(entry.auditId, 80)}\` | ${receiptText(entry.status)} | ${entry.attempt === 0 ? "Reference" : entry.metricComparableToBaseline === true ? "Like for like" : entry.metricComparableToBaseline === false ? "Changed; deltas withheld" : "Not recorded"} | ${entry.score ?? "—"} | ${entry.checksPassed ?? "—"} | ${entry.findingCount ?? "—"} |`,
      ),
    );
  }
  lines.push(
    "",
    "## Boundary",
    "",
    `The repair plan was human-reviewed inside Frontmend. Deployment remains the site owner's external responsibility. This receipt records only the public evidence observed by the named audits.${metricComparable ? "" : " Summary metric deltas are withheld because audit coverage changed."}`,
    "",
  );
  return lines.join("\n");
}
