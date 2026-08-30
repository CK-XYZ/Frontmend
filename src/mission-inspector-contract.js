const STAGES = Object.freeze([
  "landing",
  "measurement",
  "investigation",
  "diagnosis",
  "human-review",
  "deployment",
  "replay",
  "complete",
]);

const HUMAN_ONLY = Object.freeze([
  "Choose or change the public target and product intent.",
  "Approve a repair or grant a bounded low-risk delegation policy.",
  "Deploy the reviewed change and attest that deployment.",
  "Accept business risk when retained evidence remains blocked or inconclusive.",
]);

function bounded(value, maximum = 600) {
  return String(value ?? "").replace(/\r\n/g, "\n").trim().slice(0, maximum);
}

function activeToolDetails(toolDetails, names) {
  const byName = new Map((Array.isArray(toolDetails) ? toolDetails : []).map((tool) => [tool?.name, tool]));
  return names.slice(0, 21).map((name) => {
    const tool = byName.get(name) ?? {};
    return {
      name: bounded(name, 80),
      title: bounded(tool.title ?? name, 120),
      description: bounded(tool.description ?? "Available in the current authoritative state.", 600),
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
      title: "Start with one public target",
      summary: "Enter a public HTTP or HTTPS URL. An agent can start the same bounded assessment through WebMCP when the browser supports it.",
      why: audit?.status === "failed"
        ? "The prior audit did not produce a completed report, so no evidence-led continuation is valid."
        : audit?.status === "cancelled"
          ? "The prior audit was cancelled and retained no completed evidence to continue."
          : "No audit mission is active yet.",
      mustReturn: ["A normalized public URL", "A durable audit workspace and job ID"],
      unlocks: ["Live mobile, desktop, and document measurement"],
      requiredCapability: "Public URL selection",
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
    ? [...new Set(contextualToolNames.filter((name) => typeof name === "string"))].slice(0, 21)
    : [];
  const projection = stageProjection({ audit, missionState, repairs, browserReview, checkpoint });
  const preferOptionalAdoption = missionState?.browserReview?.adoptionAvailable === true;
  const humanOnly = checkpoint?.authorityBoundary?.humanOnly
    ? checkpoint.authorityBoundary.humanOnly.slice(0, 6).map((item) => bounded(item, 240))
    : [...HUMAN_ONLY];
  return {
    schemaVersion: 1,
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
      totalToolCount: Number.isInteger(webMcp.totalTools) ? webMcp.totalTools : 21,
      errors: Array.isArray(webMcp.errors) ? webMcp.errors.slice(0, 3).map((item) => bounded(item, 300)) : [],
    },
    humanFallback: {
      complete: true,
      message: supported
        ? "The same authoritative service remains available through the human interface."
        : "document.modelContext is unavailable, so no agent tools are active; the complete human workflow remains available.",
    },
  };
}

export const MISSION_INSPECTOR_STAGES = STAGES;
