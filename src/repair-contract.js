import { AuditError } from "./url-policy.js";

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

function repositoryRelativePath(value) {
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
      "INVALID_IMPLEMENTATION_RECEIPT",
      "files must contain repository-relative paths without parent traversal.",
    );
  }
  return path;
}

function boundedUniqueList(value, field, maximum, normalize) {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum) {
    throw new AuditError(
      "INVALID_IMPLEMENTATION_RECEIPT",
      `${field} must contain between 1 and ${maximum} items.`,
    );
  }
  const result = value.map(normalize);
  if (new Set(result.map((item) => JSON.stringify(item))).size !== result.length) {
    throw new AuditError("INVALID_IMPLEMENTATION_RECEIPT", `${field} must not contain duplicates.`);
  }
  return result;
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

export function createRepositoryFixBrief(report, findingId) {
  if (!report || typeof report !== "object") {
    throw new AuditError("AUDIT_REPORT_UNAVAILABLE", "A completed audit report is required.");
  }
  const finding = Array.isArray(report.findings)
    ? report.findings.find((candidate) => candidate?.id === findingId)
    : null;
  if (!finding) throw new AuditError("FINDING_NOT_FOUND", "That audit finding does not exist.");
  const template = templateForFinding(finding);
  const source = finding.source ?? {};
  const finalUrl = briefText(report.finalUrl ?? report.url, 2_048);
  const sameRule = (candidate) =>
    candidate?.source?.provider === source.provider &&
    candidate?.source?.auditId === source.auditId;
  const matchingFindings = report.findings.filter(sameRule);
  const occurrences = matchingFindings.slice(0, 4).map((candidate) => ({
    findingId: briefText(candidate.id, 160),
    strategy: briefText(candidate.source?.strategy, 40),
    viewport: briefText(candidate.viewport, 100),
    selector: briefText(candidate.selector, 160),
    measured: briefText(candidate.evidence, 300),
    severity: briefText(candidate.severity, 20),
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
      occurrenceCount: Math.max(matchingFindings.length, failedStrategies.length),
      occurrencesOmitted: Math.max(
        0,
        Math.max(matchingFindings.length, failedStrategies.length) - occurrences.length,
      ),
      failingStrategies: failedStrategies,
      occurrences,
    },
    repositoryHandoff: {
      patchType: template.patchType,
      risk: template.risk,
      inspectFor: repositorySourceHints(template.patchType),
      suggestedChange: briefText(template.patch, 1_200),
      verificationPlan: briefText(template.verificationPlan, 700),
      acceptanceCriteria: [
        strategyAcceptance,
        "Repository tests and the production build must pass without weakening unrelated checks.",
        "A fresh Frontmend audit must observe the public deployment before resolution is claimed.",
      ],
    },
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

export function createRepairDraft({ auditId, finding, input = {}, source = "human", now = Date.now() }) {
  if (!finding?.id) throw new AuditError("FINDING_NOT_FOUND", "That audit finding does not exist.");
  const extra = Object.keys(input).find(
    (key) => !["findingId", "summary", "patchType", "patch", "verificationPlan", "risk"].includes(key),
  );
  if (extra) throw new AuditError("INVALID_REPAIR", `Unknown repair field: ${extra}.`);
  const defaults = templateForFinding(finding);
  const patchType = input.patchType ?? defaults.patchType;
  const risk = input.risk ?? defaults.risk;
  if (!PATCH_TYPES.includes(patchType)) {
    throw new AuditError("INVALID_REPAIR", "patchType is not supported.");
  }
  if (!REPAIR_RISKS.includes(risk)) {
    throw new AuditError("INVALID_REPAIR", "risk is not supported.");
  }
  return {
    id: crypto.randomUUID(),
    auditId,
    findingId: finding.id,
    findingTitle: finding.title,
    findingSource: finding.source ?? null,
    status: "draft",
    source: source === "agent" ? "agent" : "human",
    summary: boundedString(input.summary ?? finding.repair, "summary", 300),
    patchType,
    patch: boundedString(input.patch ?? defaults.patch, "patch", 3_000),
    verificationPlan: boundedString(
      input.verificationPlan ?? defaults.verificationPlan,
      "verificationPlan",
      700,
    ),
    risk,
    requiresHumanReview: true,
    createdAt: now,
    updatedAt: now,
    revision: 1,
    revisionHistory: [],
    changeRequest: null,
    reviewedAt: null,
    implementationReceipt: null,
    implementationHistory: [],
    deploymentAttestedAt: null,
  };
}

export function requestRepairChanges(repair, feedback, now = Date.now()) {
  if (!repair?.id) throw new AuditError("REPAIR_NOT_FOUND", "That repair draft does not exist.");
  if (repair.status === "changes-requested") {
    throw new AuditError("CHANGES_ALREADY_REQUESTED", "Changes have already been requested for this repair.");
  }
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
    deploymentAttestedAt: null,
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
  const allowed = ["summary", "patchType", "patch", "verificationPlan", "risk"];
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
  };
  if (allowed.every((key) => next[key] === repair[key])) {
    throw new AuditError("INVALID_REPAIR", "The revised proposal must differ from the current version.");
  }
  const previous = {
    revision: Number.isFinite(repair.revision) ? repair.revision : 1,
    summary: repair.summary,
    patchType: repair.patchType,
    patch: repair.patch,
    verificationPlan: repair.verificationPlan,
    risk: repair.risk,
    source: repair.source,
    createdAt: repair.updatedAt ?? repair.createdAt,
    changeRequest: repair.changeRequest,
  };
  return {
    ...repair,
    ...next,
    status: "draft",
    source: source === "agent" ? "agent" : "human",
    revision: previous.revision + 1,
    revisionHistory: [...(Array.isArray(repair.revisionHistory) ? repair.revisionHistory : []), previous]
      .slice(-MAX_REPAIR_REVISIONS),
    changeRequest: null,
    reviewedAt: null,
    implementationReceipt: null,
    implementationHistory: [],
    deploymentAttestedAt: null,
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
  const files = boundedUniqueList(input.files, "files", 8, repositoryRelativePath);
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
  return {
    ...repair,
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

export function repairMissionState(repair) {
  const hasDraft = Boolean(repair?.id);
  const approved = repair?.status === "approved";
  const changesRequested = repair?.status === "changes-requested";
  const implementationEvidence = implementationEvidenceState(repair);
  const implemented = approved && implementationEvidence === "checks-passed";
  const implementationNeedsAttention = approved && ["checks-failed", "checks-incomplete"].includes(
    implementationEvidence,
  );
  const deploymentAttested = approved && Number.isFinite(repair?.deploymentAttestedAt);
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
      label: "Review",
      owner: "Person",
      status: approved ? "complete" : changesRequested ? "blocked" : hasDraft ? "current" : "blocked",
    },
    {
      id: "implement",
      label: "Implement",
      owner: "Coding agent",
      detail: implementationEvidence === "checks-passed"
        ? "Agent checks passed"
        : implementationEvidence === "checks-failed"
          ? "Agent checks failed"
          : implementationEvidence === "checks-incomplete"
            ? "Agent checks incomplete"
            : "Coding agent · optional receipt",
      status: implemented ? "complete" : implementationNeedsAttention ? "attention" : approved ? "available" : "blocked",
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
          { id: "record_repository_implementation", actor: "agent", optional: true },
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
          : implementationNeedsAttention
            ? "implementation-attention"
            : "awaiting-external-deployment"
        : "awaiting-human-review",
    steps,
    nextActions,
    targetMutation: "external-only",
    implementationEvidence,
    deploymentEvidence: deploymentAttested ? "site-owner-attestation" : "none",
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

function sameFindingSource(left, right) {
  return Boolean(
    left &&
      right &&
      left.provider === right.provider &&
      left.auditId === right.auditId &&
      left.strategy === right.strategy,
  );
}

function reportSnapshot(report, source) {
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
    exactRuleOutcome: outcomeForSource(report, source),
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

function startingLineage(report, source) {
  const previous = report?.verification?.lineage;
  if (
    sameFindingSource(report?.verification?.findingSource, source) &&
    previous?.rootAuditId &&
    Array.isArray(previous.entries) &&
    previous.entries.length
  ) {
    return {
      rootAuditId: previous.rootAuditId,
      findingSource: source,
      attemptCount: reportMetric(previous.attemptCount) ?? previous.entries.length - 1,
      omitted: reportMetric(previous.omitted) ?? 0,
      entries: previous.entries.slice(0, MAX_LINEAGE_ENTRIES),
    };
  }
  const snapshot = reportSnapshot(report, source);
  return {
    rootAuditId: snapshot.auditId,
    findingSource: source,
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
  return ["live-document", "hybrid-lighthouse-document"].includes(engine?.mode);
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
  return {
    url: report.finalUrl ?? report.url,
    baselineAuditId: report.auditId,
    repairId: repair.id,
    repairRevision: Number.isFinite(repair.revision) ? repair.revision : 1,
    findingId: repair.findingId,
    findingTitle: repair.findingTitle,
    findingSource: repair.findingSource,
    baselineEngine: report.engine,
    baselineEvidence: reportEvidenceSignature(report),
    baseline: reportSnapshot(report, repair.findingSource),
    lineage: startingLineage(report, repair.findingSource),
    implementationReceipt: implementationReceiptSnapshot(repair.implementationReceipt),
    deploymentAttestedAt: repair.deploymentAttestedAt,
  };
}

function metricDelta(current, baseline) {
  return Number.isFinite(current) && Number.isFinite(baseline) ? current - baseline : null;
}

export function compareVerification(report, verification, now = Date.now()) {
  const source = verification?.findingSource;
  const baselineEngine = verification?.baselineEngine;
  const measuredEngine = report?.engine;
  const measuredRuleOutcome = outcomeForSource(report, source);
  const ruleComparison = exactRuleComparison({
    source,
    baselineEngine,
    measuredEngine,
    measuredRuleOutcome,
  });
  const comparable = ruleComparison.comparable;
  const measuredEvidence = reportEvidenceSignature(report);
  const metricComparable = sameEvidenceSignature(
    verification?.baselineEvidence,
    measuredEvidence,
  );
  const ruleOutcome = comparable ? measuredRuleOutcome : "not-comparable";
  const status = !comparable
    ? "inconclusive"
    : ruleOutcome === "failed"
      ? "still-present"
      : ruleOutcome === "passed"
        ? "resolved"
        : "inconclusive";
  const baseline = verification.baseline ?? reportSnapshot(null, source);
  const current = reportSnapshot(report, source);
  const lineage = appendLineage(
    verification.lineage ?? {
      rootAuditId: baseline.auditId,
      findingSource: source,
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
    findingTitle: verification.findingTitle,
    findingSource: source,
    implementationReceipt: implementationReceiptSnapshot(verification.implementationReceipt),
    deploymentAttestedAt: verification.deploymentAttestedAt,
    status,
    comparable,
    ruleOutcome,
    baselineEngine: baselineEngine?.mode,
    measuredEngine: report.engine.mode,
    baselineEvidence: verification?.baselineEvidence ?? null,
    measuredEvidence,
    metricComparable,
    comparisonReason: ruleComparison.reason,
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
        ? metricComparable
          ? "The exact original rule explicitly passed in fresh evidence with like-for-like report metrics."
          : "The exact original rule explicitly passed, but whole-report metrics are not like for like."
        : status === "still-present"
          ? metricComparable
            ? "The exact original rule explicitly failed again in fresh evidence with like-for-like report metrics."
            : "The exact original rule explicitly failed again, but whole-report metrics are not like for like."
          : comparable
            ? "The fresh audit did not affirmatively evaluate the exact original rule, so Frontmend cannot claim it was resolved."
            : inconclusiveComparisonMessage(ruleComparison.reason),
  };
}

export function repairExportMarkdown({ report, repair }) {
  if (repair?.status !== "approved") {
    throw new AuditError("REPAIR_NOT_APPROVED", "Approve this repair draft before exporting it.");
  }
  const lines = [
    `# Frontmend repair: ${repair.findingTitle}`,
    "",
    `- Site: ${report.finalUrl ?? report.url}`,
    `- Baseline audit: ${report.auditId}`,
    `- Finding: ${repair.findingId}`,
    `- Repair revision: ${Number.isFinite(repair.revision) ? repair.revision : 1}`,
    `- Patch type: ${repair.patchType}`,
    `- Risk: ${repair.risk}`,
    `- Human reviewed: ${new Date(repair.reviewedAt).toISOString()}`,
    `- Deployment handoff: ${Number.isFinite(repair.deploymentAttestedAt) ? `site owner attested ${new Date(repair.deploymentAttestedAt).toISOString()}` : "not yet attested"}`,
    "",
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
    "",
    "## Summary",
    "",
    "| Score | Checks passed | Warnings | Failed | Findings | Viewports measured |",
    "| ---: | ---: | ---: | ---: | ---: | ---: |",
    `| ${artifactMetric(report.score)} | ${artifactMetric(report.checks?.passed)} | ${artifactMetric(report.checks?.warnings)} | ${artifactMetric(report.checks?.failed)} | ${artifactMetric(report.findingCount)} | ${artifactMetric(report.viewportCount)} |`,
  ];

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
  const metricComparable = verification.metricComparable === true;
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
    `- Summary metric comparison: ${metricComparable ? "like for like" : "not comparable; deltas withheld"}`,
    `- Comparison reason: ${receiptText(verification.comparisonReason, 120)}`,
    `- Repository implementation: ${verification.implementationReceipt ? `agent-reported receipt revision ${verification.implementationReceipt.revision ?? 1}` : "not recorded (optional)"}`,
    `- Deployment attested by site owner: ${Number.isFinite(verification.deploymentAttestedAt) ? new Date(verification.deploymentAttestedAt).toISOString() : "—"}`,
    `- Completed: ${Number.isFinite(verification.completedAt) ? new Date(verification.completedAt).toISOString() : "—"}`,
    "",
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
