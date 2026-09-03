import {
  createBuildDescriptor,
  FRONTMEND_TOOL_COUNT,
  shortBuildCommit,
} from "./protocol-contract.js";
import { candidateReviewSnapshot } from "./candidate-review-contract.js";

const STAGES = Object.freeze([
  "landing",
  "measurement",
  "investigation",
  "diagnosis",
  "human-review",
  "implementation",
  "deployment",
  "replay",
  "complete",
]);

const HUMAN_ONLY = Object.freeze([
  "Choose the website and audit focus.",
  "Approve a repair or limited delegation.",
  "Deploy the reviewed change and accept any remaining risk.",
]);

const TOOL_DISPLAY_COPY = Object.freeze({
  start_site_audit: "Starts a saved audit for the public website and focus areas you choose.",
  check_site_audit_progress: "Checks the current audit phase, progress, and any blocker.",
  cancel_site_audit: "Stops the current audit without treating incomplete evidence as final.",
  get_mission_summary: "Reads the audit state, top priorities, blockers, and next available action.",
  declare_agent_capabilities: "Declares what the current agent says it can perform so Frontmend assigns only matching work.",
  get_site_audit_results: "Reads the completed findings, evidence, and audit sources.",
  get_active_evidence_capsule: "Reads the screenshot, target, evidence, and exact task for the finding selected on this page.",
  get_evidence_chain: "Reads one finding from observation through diagnosis, repair, and verification.",
  open_browser_review: "Opens the next check that needs direct browser inspection.",
  record_browser_review_check: "Adds a focused browser observation to the current review task.",
  get_assessment_receipt: "Creates a portable record of the completed assessment and its evidence.",
  get_repository_fix_brief: "Prepares a code-focused brief for one saved finding.",
  start_related_page_audit: "Audits a same-site page discovered from the current website.",
  open_diagnostic_mission: "Opens a focused diagnosis task for one saved finding.",
  submit_runtime_diagnosis: "Records code ownership, reproduction steps, and planned checks.",
  record_diagnostic_blocker: "Records an honest blocker when diagnosis cannot be completed safely.",
  start_site_exploration: "Starts a limited exploration of selected pages on the same website.",
  get_site_exploration: "Reads the current page exploration and its saved evidence.",
  get_verification_receipt: "Reads the final repair-verification result and its sources.",
  prepare_site_repair: "Moves the audit into repair preparation after you ask.",
  stage_site_repair: "Creates a reviewable repair plan for the selected finding.",
  revise_site_repair: "Revises the repair plan against your requested changes.",
  get_repair_workspace: "Reads the current repair plan, review state, and evidence.",
  record_repository_implementation: "Records code changes without claiming they were deployed.",
  open_candidate_review: "Opens the first exact browser comparison for a localhost or public-preview candidate.",
  record_candidate_review_check: "Records one attributed candidate comparison and returns issues to the coding loop.",
  get_candidate_review: "Reads the current candidate iteration, correction evidence, and prior attempts.",
  start_repair_verification: "Starts fresh public verification after deployment is confirmed.",
});

function bounded(value, maximum = 600) {
  return String(value ?? "").replace(/\r\n/g, "\n").trim().slice(0, maximum);
}

function activeToolDetails(toolDetails, names) {
  const byName = new Map((Array.isArray(toolDetails) ? toolDetails : []).map((tool) => [tool?.name, tool]));
  return names.slice(0, FRONTMEND_TOOL_COUNT).map((name) => {
    const tool = byName.get(name) ?? {};
    return {
      name: bounded(name, 80),
      title: bounded(tool.title ?? name, 120),
      description: bounded(
        TOOL_DISPLAY_COPY[name] ?? tool.description ?? "Available at this point in the audit.",
        240,
      ),
      inputSchema: tool.inputSchema && typeof tool.inputSchema === "object"
        ? JSON.parse(JSON.stringify(tool.inputSchema))
        : { type: "object", properties: {}, additionalProperties: false },
    };
  });
}

function currentRepair(repairs) {
  return [...(Array.isArray(repairs) ? repairs : [])]
    .sort((left, right) => (right?.updatedAt ?? right?.createdAt ?? 0) - (left?.updatedAt ?? left?.createdAt ?? 0))[0] ?? null;
}

function stageProjection({ audit, missionState, repairs, browserReview, checkpoint }) {
  const repair = currentRepair(repairs);
  const checkpointAction = checkpoint?.action ?? null;
  const checkpointCriteria = Array.isArray(checkpoint?.completionCriteria)
    ? checkpoint.completionCriteria.map((item) => bounded(item, 240))
    : [];

  if (!audit || ["failed", "cancelled"].includes(audit.status)) {
    return {
      stage: "landing",
      actor: "Person or agent",
      title: "Audit a public website",
      summary: "Paste a public website URL here, or ask a compatible agent to start the same audit for you.",
      why: audit?.status === "failed"
        ? "The previous audit did not finish, so a new audit is needed before Frontmend can continue."
        : audit?.status === "cancelled"
          ? "The previous audit was cancelled before it produced complete evidence."
          : "No audit is running yet.",
      mustReturn: ["A validated website address", "A saved audit you can return to"],
      unlocks: ["Live checks for mobile, desktop, and page structure"],
      requiredCapability: "A public website URL",
      action: checkpointAction ?? { tool: "start_site_audit", input: {} },
    };
  }

  if (audit.status !== "complete") {
    return {
      stage: "measurement",
      actor: "Frontmend audit engine",
      title: "Wait for retained measurement",
      summary: "The asynchronous job is measuring the public page. Only progress reading or cancellation is valid while evidence is incomplete.",
      why: bounded(audit.phaseLabel ?? "The current audit job has not reached a terminal measurement state.", 300),
      mustReturn: checkpointCriteria.length ? checkpointCriteria : ["A completed report or an actionable terminal error", "Provider and document provenance"],
      unlocks: ["Evidence-led browser investigation or focused result review"],
      requiredCapability: "Progress polling",
      action: checkpointAction ?? { tool: "check_site_audit_progress", input: {} },
    };
  }

  const replay = audit.report?.verification?.browserReplay;
  const replays = audit.report?.verification?.browserReplays?.length
    ? audit.report.verification.browserReplays
    : replay?.required ? [replay] : [];
  const browserGuardrails = audit.report?.verification?.browserGuardrails ?? [];
  const browserVerificationPending = replays.some((item) => item.status !== "complete")
    || browserGuardrails.some((guardrail) => guardrail.status !== "complete");
  if (browserVerificationPending) {
    const opened = Boolean(browserReview);
    const exactReplayRequired = replays.length > 0;
    return {
      stage: "replay",
      actor: "Browser-capable agent",
      title: opened ? "Complete the retained browser comparisons" : "Open the browser verification review",
      summary: exactReplayRequired
        ? "Fresh provider measurement cannot resolve the retained browser issue or prove that important rendered behaviours still hold. Each exact replay and guardrail must be compared directly after deployment."
        : "Fresh provider measurement cannot prove that retained journeys and reflow behaviours still hold. Each browser guardrail must be repeated directly after deployment.",
      why: "The reviewed repair reached post-deployment verification and still lacks one or more required direct browser comparisons.",
      mustReturn: checkpointCriteria.length ? checkpointCriteria : ["passed, issue, or an honest blocker for every retained check", "Bounded observations for each exact replay or guardrail"],
      unlocks: ["A resolved, still-present, or inconclusive verification outcome", "A portable verification receipt when proof is complete"],
      requiredCapability: "Rendered-browser verification",
      action: checkpointAction ?? {
        tool: opened ? "record_browser_review_check" : "open_browser_review",
        input: opened ? { reviewId: browserReview.id, checkId: browserReview.state?.nextCheck?.id } : {},
      },
    };
  }

  if (missionState?.browserReview?.required && missionState.browserReview.status !== "complete") {
    const opened = Boolean(browserReview);
    return {
      stage: "investigation",
      actor: "Browser-capable agent",
      title: opened ? "Perform the current evidence-led browser task" : "Open the compiled browser investigation",
      summary: opened
        ? "Inspect only the current retained assignment and contribute direct observations through its bounded response contract."
        : "Frontmend has retained provider evidence and is ready to expose the highest-value rendered-browser task.",
      why: missionState.nextAction?.reason
        ?? "The requested accessibility or SEO focus needs rendered evidence that provider measurement cannot supply.",
      mustReturn: checkpointCriteria.length ? checkpointCriteria : ["passed, issue, or an honest blocker", "One to four bounded direct observations", "Structured findings only when an issue is observed"],
      unlocks: ["The next sequential browser task", "Evidence reconciliation and repository diagnosis when needed"],
      requiredCapability: "Rendered-browser inspection",
      action: checkpointAction ?? missionState.nextAction,
    };
  }

  if (missionState?.browserReview?.adoptionAvailable) {
    return {
      stage: "investigation",
      actor: "Person or browser-capable agent",
      title: "Continue this person-started audit with an agent",
      summary: "The retained assessment can gain rendered-browser evidence without starting another audit or changing its original person attribution.",
      why: "Provider measurement is retained and the current Assess mission has accessibility or SEO scope that a capable agent can investigate directly.",
      mustReturn: ["The same audit ID", "One versioned rendered-browser task", "No repair or deployment authority"],
      unlocks: ["Sequential direct browser observations", "Reconciled provider and browser evidence in this workspace"],
      requiredCapability: "Rendered-browser inspection",
      action: { tool: "open_browser_review", input: {} },
    };
  }

  if (missionState?.browserReview?.status === "withdrawn") {
    return {
      stage: "human-review",
      actor: "Person",
      title: "Review the provider evidence after the untouched handoff",
      summary: "The optional rendered-review handoff was withdrawn before any browser evidence was recorded. Its visible record remains, while the original completed assessment is provider-only again.",
      why: "No browser result was contributed, so there is no rendered evidence to reconcile or complete.",
      mustReturn: checkpointCriteria.length ? checkpointCriteria : ["A person-selected next action or an exported provider-only assessment"],
      unlocks: ["A new product decision without implying browser proof"],
      requiredCapability: "Human result review",
      action: checkpointAction ?? { tool: "get_site_audit_results", input: {} },
    };
  }

  if (["open_diagnostic_mission", "submit_runtime_diagnosis", "record_diagnostic_blocker"].includes(missionState?.nextAction?.tool)) {
    return {
      stage: "diagnosis",
      actor: "Repository-capable agent",
      title: missionState.nextAction.tool === "open_diagnostic_mission"
        ? "Open the bounded evidence diagnosis"
        : "Contribute browser and repository diagnosis",
      summary: "Keep the measured symptom, browser observation, repository ownership, and planned checks as separate attributed records.",
      why: missionState.nextAction.reason,
      mustReturn: checkpointCriteria.length ? checkpointCriteria : ["A bounded reproduction", "Repository-relative ownership locations", "Local and fresh verification checks"],
      unlocks: ["A repair-ready evidence chain", "Repair staging only after explicit preparation intent"],
      requiredCapability: "Repository diagnosis",
      action: checkpointAction ?? missionState.nextAction,
    };
  }

  const candidate = repair?.candidateReview?.id
    ? candidateReviewSnapshot(repair.candidateReview, repair.candidateReviewHistory)
    : null;
  if (
    repair?.status === "approved"
    && !Number.isFinite(repair.deploymentAttestedAt)
    && (candidate?.status === "issues-found" || checkpointAction?.tool === "record_repository_implementation")
  ) {
    const correctingCandidate = candidate?.status === "issues-found";
    return {
      stage: "implementation",
      actor: "Repository-capable coding agent",
      title: correctingCandidate ? "Correct the candidate issue" : "Implement the reviewed repository plan",
      summary: correctingCandidate
        ? "Frontmend linked the direct candidate observation back to the retained baseline and frozen repository scope. The next implementation receipt must describe the correction and rerun the reviewed checks."
        : "The person approved a bounded plan. The coding agent may implement only that reviewed repository scope and report its checks without uploading source.",
      why: checkpointAction?.reason
        ?? "Repository implementation is the next authorised agent-owned transition.",
      mustReturn: checkpointCriteria.length
        ? checkpointCriteria
        : ["Repository-relative changed files", "Every reviewed check with a truthful outcome", "An optional Git object ID"],
      unlocks: correctingCandidate
        ? ["A new candidate iteration bound to the newer implementation receipt"]
        : ["Optional exact candidate-browser preflight", "Person-owned external deployment"],
      requiredCapability: "Repository implementation and terminal execution",
      action: checkpointAction ?? { tool: "record_repository_implementation", input: { repairId: repair.id } },
    };
  }

  if (
    repair?.status === "approved"
    && !Number.isFinite(repair.deploymentAttestedAt)
    && candidate?.status === "in-progress"
  ) {
    return {
      stage: "replay",
      actor: "Browser-capable coding agent",
      title: "Replay the current candidate check",
      summary: "Inspect the exact candidate route, viewport, and retained symptom. The first observed issue stops this iteration and returns the mission to repository implementation.",
      why: checkpointAction?.reason ?? "The optional candidate preflight was opened and has an unfinished exact comparison.",
      mustReturn: checkpointCriteria.length
        ? checkpointCriteria
        : ["passed, issue, or an honest blocker", "One to four bounded direct candidate observations"],
      unlocks: ["The next retained candidate guardrail", "An exact correction packet when an issue is observed"],
      requiredCapability: "Rendered-browser candidate review",
      action: checkpointAction ?? candidate.nextAction,
    };
  }

  if (repair?.status === "approved" && !Number.isFinite(repair.deploymentAttestedAt)) {
    return {
      stage: "deployment",
      actor: "Site owner",
      title: "Deploy the reviewed change externally",
      summary: "The plan is authorised, but Frontmend cannot deploy it or attest deployment. Optional repository implementation evidence remains separately labelled.",
      why: "Approval is complete and fresh public verification is locked until a person records the deployment handoff.",
      mustReturn: checkpointCriteria.length ? checkpointCriteria : ["The reviewed revision deployed to the retained public target", "A site-owner deployment attestation"],
      unlocks: ["Fresh provider verification", "Exact browser replay when the baseline finding was browser-observed"],
      requiredCapability: "External deployment",
      action: checkpointAction,
    };
  }

  if (repair?.status === "approved" && Number.isFinite(repair.deploymentAttestedAt)) {
    return {
      stage: "replay",
      actor: "Person or agent",
      title: "Start fresh repair verification",
      summary: "The site owner attested deployment. Frontmend can now start fresh public evidence for the retained repair scope.",
      why: "Deployment authority has been recorded but no fresh proof has resolved the public claim.",
      mustReturn: checkpointCriteria.length ? checkpointCriteria : ["Fresh exact-rule outcomes", "Complete comparable coverage or an explicit inconclusive result"],
      unlocks: ["A resolved, still-present, or inconclusive verification result"],
      requiredCapability: "Fresh public verification",
      action: checkpointAction ?? { tool: "start_repair_verification", input: { repairId: repair.id } },
    };
  }

  if (repair || missionState?.nextAction?.tool === "stage_site_repair" || missionState?.assessmentComplete) {
    return {
      stage: "human-review",
      actor: repair?.status === "changes-requested" ? "Repository-capable agent" : "Person",
      title: repair?.status === "changes-requested"
        ? "Revise the repair against the person's request"
        : repair?.status === "draft"
          ? "Review the bounded repair plan"
          : missionState?.nextAction?.tool === "stage_site_repair"
            ? "Prepare the selected repair mission"
            : "Choose whether to prepare a retained priority",
      summary: repair?.status === "draft"
        ? "The proposal is visible for approval or requested changes. It is not implementation or deployment proof."
        : "Assessment evidence is complete enough for a person to choose a repair target without granting hidden authority.",
      why: missionState?.nextAction?.reason
        ?? "The evidence phase is complete and the next consequential transition belongs to a person.",
      mustReturn: checkpointCriteria.length ? checkpointCriteria : repair?.status === "changes-requested"
        ? ["A revised bounded plan answering the recorded request"]
        : ["An explicit selected finding", "A reviewed approval, requested change, or no-action decision"],
      unlocks: ["A reviewed repair workspace", "Optional bounded repository implementation", "Person-owned deployment"],
      requiredCapability: repair?.status === "changes-requested" ? "Repository revision" : "Human review",
      action: checkpointAction ?? missionState?.nextAction,
    };
  }

  return {
    stage: "complete",
    actor: "Person",
    title: "Review the completed evidence",
    summary: "No required agent continuation is active. The person can inspect or export the retained assessment without implying a repair or deployment.",
    why: "The authoritative mission has no outstanding required action.",
    mustReturn: checkpointCriteria,
    unlocks: ["A person-selected next product decision"],
    requiredCapability: null,
    action: checkpointAction,
  };
}

export function createMissionInspector({
  audit = null,
  missionState = null,
  repairs = [],
  browserReview = null,
  contextualToolNames = [],
  toolDetails = [],
  checkpoint = null,
  webMcp = {},
} = {}) {
  const supported = webMcp.supported === true;
  const names = Array.isArray(contextualToolNames)
    ? [...new Set(contextualToolNames.filter((name) => typeof name === "string"))].slice(0, FRONTMEND_TOOL_COUNT)
    : [];
  const projection = stageProjection({ audit, missionState, repairs, browserReview, checkpoint });
  const preferOptionalAdoption = missionState?.browserReview?.adoptionAvailable === true;
  const humanOnly = checkpoint?.authorityBoundary?.humanOnly
    ? checkpoint.authorityBoundary.humanOnly.slice(0, 6).map((item) => bounded(item, 240))
    : [...HUMAN_ONLY];
  const build = createBuildDescriptor();
  return {
    schemaVersion: 1,
    protocol: {
      ...build,
      displayCommit: shortBuildCommit(build),
      missionRevision: Number.isInteger(checkpoint?.missionRevision)
        ? checkpoint.missionRevision
        : Number.isInteger(audit?.missionRevision) ? audit.missionRevision : 0,
    },
    stage: STAGES.includes(projection.stage) ? projection.stage : "complete",
    mode: supported ? "webmcp" : "human",
    questions: {
      whatHappensNow: {
        title: projection.title,
        actor: projection.actor,
        summary: projection.summary,
        requiredCapability: preferOptionalAdoption
          ? projection.requiredCapability
          : checkpoint?.requiredCapability ?? projection.requiredCapability,
        action: preferOptionalAdoption
          ? projection.action ?? null
          : checkpoint?.action ?? projection.action ?? null,
      },
      whyNow: projection.why,
      whatMustReturn: projection.mustReturn,
      whatItUnlocks: projection.unlocks,
      whatRemainsHumanOnly: humanOnly,
    },
    activeTools: activeToolDetails(toolDetails, names),
    registration: {
      status: bounded(webMcp.status ?? (supported ? "ready" : "unsupported"), 40),
      activeToolCount: names.length,
      totalToolCount: Number.isInteger(webMcp.totalTools) ? webMcp.totalTools : FRONTMEND_TOOL_COUNT,
      errors: Array.isArray(webMcp.errors) ? webMcp.errors.slice(0, 3).map((item) => bounded(item, 300)) : [],
    },
    humanFallback: {
      complete: true,
      message: supported
        ? "Prefer clicking? Every step still works through Frontmend's regular interface."
        : "WebMCP is not available in this browser, but every Frontmend workflow still works here.",
    },
  };
}

export const MISSION_INSPECTOR_STAGES = STAGES;
