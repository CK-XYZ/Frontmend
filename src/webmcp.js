import { AuditError } from "./audit-service.js";
import {
  createRepositoryFixBrief,
  repairMissionState,
  verificationReceiptMarkdown,
} from "./repair-contract.js";

const emptySchema = { type: "object", properties: {}, additionalProperties: false };

function objectInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new AuditError("INVALID_INPUT", "Tool input must be an object.");
  }
  return input;
}

function noExtra(input, allowed) {
  const extra = Object.keys(input).find((key) => !allowed.includes(key));
  if (extra) throw new AuditError("INVALID_INPUT", `Unknown field: ${extra}.`);
}

function requiredString(value, field, maximum = 2048) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new AuditError("INVALID_INPUT", `${field} must contain 1 to ${maximum} characters.`);
  }
  return value;
}

function optionalString(value, field, maximum) {
  if (value === undefined) return undefined;
  return requiredString(value, field, maximum);
}

function observedPaths(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) {
    throw new AuditError("INVALID_INPUT", "paths must contain between 1 and 3 observed routes.");
  }
  return value.map((path) => requiredString(path, "path", 256));
}

function auditIdForTool(service, value) {
  if (value !== undefined) return requiredString(value, "auditId", 80);
  const activeAuditId = service?.getActiveAudit?.()?.id;
  if (typeof activeAuditId === "string" && activeAuditId) return activeAuditId;
  throw new AuditError(
    "AUDIT_CONTEXT_REQUIRED",
    "Provide auditId or open the audit workspace that this action should use.",
  );
}

async function safely(operation) {
  try {
    return { ok: true, data: await operation() };
  } catch (error) {
    if (error instanceof AuditError) {
      return {
        ok: false,
        error: { code: error.code, message: error.message, recoverable: error.recoverable !== false },
      };
    }
    return {
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "Frontmend could not complete the operation.",
        recoverable: false,
      },
    };
  }
}

function tool(definition) {
  return {
    name: definition.name,
    title: definition.title,
    description: definition.description,
    inputSchema: definition.inputSchema,
    annotations: definition.annotations,
    execute: (input) => safely(() => definition.run(input)),
  };
}

function registrationErrorMessage(error) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    if (typeof error.message === "string") return error.message;
    try {
      return JSON.stringify(error);
    } catch {
      return "Unknown registration error.";
    }
  }
  return String(error);
}

export function contextualFrontmendToolNames(service) {
  const audit = service?.getActiveAudit?.();
  if (!audit || ["failed", "cancelled"].includes(audit.status)) return ["start_site_audit"];
  if (audit.status !== "complete") {
    return ["check_site_audit_progress", "cancel_site_audit"];
  }

  const available = new Set(["get_site_audit_results"]);
  const findings = audit.report?.findings ?? [];
  const routes = audit.report?.documentProfile?.routes ?? [];
  const repairs = service?.getRepairs?.(audit.id) ?? [];
  const explorations = service?.getSiteExplorations?.(audit.id) ?? [];

  if (audit.report?.verification) available.add("get_verification_receipt");
  if (routes.length) {
    available.add("start_related_page_audit");
    available.add("start_site_exploration");
  }
  if (explorations.length) available.add("get_site_exploration");
  if (findings.length) {
    available.add("get_repository_fix_brief");
    available.add("stage_site_repair");
    available.add("get_repair_workspace");
  }
  if (repairs.some((repair) => repair.status === "changes-requested")) {
    available.add("revise_site_repair");
  }
  if (
    repairs.some(
      (repair) => repair.status === "approved" && !Number.isFinite(repair.deploymentAttestedAt),
    )
  ) {
    available.add("record_repository_implementation");
  }
  if (
    repairs.some(
      (repair) =>
        repair.status === "approved" && Number.isFinite(repair.deploymentAttestedAt),
    )
  ) {
    available.add("start_repair_verification");
  }

  return createFrontmendTools(service)
    .map((toolDefinition) => toolDefinition.name)
    .filter((name) => available.has(name));
}

export function createFrontmendTools(service) {
  const tools = [
    tool({
      name: "start_site_audit",
      title: "Start site audit",
      description:
        "Start a Frontmend audit for a public HTTP or HTTPS website. Returns an audit ID and stable workspace path without navigating during the tool call. Follow that path after the call, then use the contextual capability Frontmend exposes next: progress while running or results after completion.",
      inputSchema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            minLength: 1,
            maxLength: 2048,
            description: "Public website URL to audit, with or without an HTTPS scheme.",
          },
        },
        required: ["url"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      async run(input) {
        const value = objectInput(input);
        noExtra(value, ["url"]);
        if (typeof value.url !== "string") {
          throw new AuditError("INVALID_INPUT", "url must be a string.");
        }
        const audit = await service.startAudit({ url: value.url, source: "agent" });
        return { ...audit, workspacePath: `/audits/${encodeURIComponent(audit.id)}` };
      },
    }),
    tool({
      name: "check_site_audit_progress",
      title: "Check site audit progress",
      description:
        "Read the authoritative status, phase, and percentage for a Frontmend audit. Omit auditId to use the visible audit. This does not start or mutate an audit.",
      inputSchema: {
        type: "object",
        properties: {
          auditId: { type: "string", minLength: 1, description: "Optional audit ID; defaults to the visible audit." },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      async run(input) {
        const value = objectInput(input);
        noExtra(value, ["auditId"]);
        const audit = await service.getAudit(auditIdForTool(service, value.auditId));
        return {
          auditId: audit.id,
          attempt: Number.isFinite(audit.attempt) ? audit.attempt : 1,
          workspacePath: `/audits/${encodeURIComponent(audit.id)}`,
          url: audit.url,
          status: audit.status,
          phase: audit.phase,
          phaseLabel: audit.phaseLabel,
          progress: audit.progress,
        };
      },
    }),
    tool({
      name: "cancel_site_audit",
      title: "Cancel site audit",
      description:
        "Cancel the visible queued or running Frontmend audit and persist that terminal state. Omit auditId to use the visible audit. Repeating this operation is safe, and it never changes the target site.",
      inputSchema: {
        type: "object",
        properties: {
          auditId: { type: "string", minLength: 1, description: "Optional audit ID; defaults to the visible audit." },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async run(input) {
        const value = objectInput(input);
        noExtra(value, ["auditId"]);
        const audit = await service.cancelAudit(auditIdForTool(service, value.auditId));
        return {
          auditId: audit.id,
          attempt: Number.isFinite(audit.attempt) ? audit.attempt : 1,
          status: audit.status,
          workspacePath: `/audits/${encodeURIComponent(audit.id)}`,
          message:
            audit.status === "cancelled"
              ? "The audit is cancelled. No result was produced."
              : `The audit was already ${audit.status}.`,
        };
      },
    }),
    tool({
      name: "get_site_audit_results",
      title: "Get site audit results",
      description:
        "Return the completed Frontmend report with safe counts and structured findings. Omit auditId to use the visible audit. Frontmend registers this capability only when that visible audit is complete.",
      inputSchema: {
        ...emptySchema,
        properties: {
          auditId: { type: "string", minLength: 1, description: "Optional completed audit ID; defaults to the visible audit." },
        },
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      async run(input) {
        const value = objectInput(input);
        noExtra(value, ["auditId"]);
        return service.getResults(auditIdForTool(service, value.auditId));
      },
    }),
    tool({
      name: "get_repository_fix_brief",
      title: "Prepare repository fix brief",
      description:
        "Translate one completed Frontmend finding into a bounded, source-safe implementation contract for a coding agent with repository access. It returns measured evidence, repository search hints, acceptance criteria, and authority boundaries. It does not inspect files, upload source, stage a repair, change the repository, or deploy the target.",
      inputSchema: {
        type: "object",
        properties: {
          auditId: { type: "string", minLength: 1, description: "Optional completed audit ID; defaults to the visible audit." },
          findingId: { type: "string", minLength: 1, maxLength: 160, description: "Exact finding ID from the completed report." },
        },
        required: ["findingId"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      async run(input) {
        const value = objectInput(input);
        noExtra(value, ["auditId", "findingId"]);
        const auditId = auditIdForTool(service, value.auditId);
        const findingId = requiredString(value.findingId, "findingId", 160);
        const report = await service.getResults(auditId);
        return createRepositoryFixBrief(report, findingId);
      },
    }),
    tool({
      name: "start_related_page_audit",
      title: "Audit an observed route",
      description:
        "Start a new live audit for one same-site path observed in the visible completed report. Use an exact path from documentProfile.routes. This does not navigate during the tool call or claim that the route has already been inspected.",
      inputSchema: {
        type: "object",
        properties: {
          auditId: { type: "string", minLength: 1, description: "Optional completed audit ID; defaults to the visible audit." },
          path: { type: "string", minLength: 1, maxLength: 256, description: "Exact same-site path from documentProfile.routes." },
        },
        required: ["path"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      async run(input) {
        const value = objectInput(input);
        noExtra(value, ["auditId", "path"]);
        const baselineAuditId = auditIdForTool(service, value.auditId);
        const audit = await service.startRelatedAudit(
          baselineAuditId,
          requiredString(value.path, "path", 256),
          "agent",
        );
        return {
          ...audit,
          baselineAuditId,
          observedPath: value.path,
          rootAuditId: audit.exploration?.rootAuditId ?? baselineAuditId,
          parentAuditId: audit.exploration?.parentAuditId ?? baselineAuditId,
          routeDepth: audit.exploration?.depth ?? 1,
          routeTrail: audit.exploration?.trail ?? [],
          workspacePath: `/audits/${encodeURIComponent(audit.id)}`,
        };
      },
    }),
    tool({
      name: "start_site_exploration",
      title: "Explore selected site routes",
      description:
        "Start a bounded multi-page exploration for one to three exact same-site paths observed in the completed root audit. Each path becomes a separate live audit under one durable exploration ID; this is not an exhaustive crawl.",
      inputSchema: {
        type: "object",
        properties: {
          auditId: { type: "string", minLength: 1, description: "Optional completed root audit ID; defaults to the visible audit." },
          paths: {
            type: "array",
            minItems: 1,
            maxItems: 3,
            uniqueItems: true,
            items: { type: "string", minLength: 1, maxLength: 256 },
            description: "One to three exact paths from documentProfile.routes.",
          },
        },
        required: ["paths"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      async run(input) {
        const value = objectInput(input);
        noExtra(value, ["auditId", "paths"]);
        const rootAuditId = auditIdForTool(service, value.auditId);
        const exploration = await service.startSiteExploration(
          rootAuditId,
          observedPaths(value.paths),
          "agent",
        );
        return {
          ...exploration,
          explorationId: exploration.id,
          workspacePath: `/audits/${encodeURIComponent(rootAuditId)}`,
          statusPath: `/api/audits/${encodeURIComponent(rootAuditId)}/explorations/${encodeURIComponent(exploration.id)}`,
        };
      },
    }),
    tool({
      name: "get_site_exploration",
      title: "Read site exploration",
      description:
        "Read progress or aggregated cross-page evidence for a durable site exploration. Omit missionId to use the most recent exploration attached to the visible root audit.",
      inputSchema: {
        type: "object",
        properties: {
          auditId: { type: "string", minLength: 1, description: "Optional root audit ID; defaults to the visible audit." },
          missionId: { type: "string", minLength: 1, description: "Optional exploration ID; defaults to the most recent visible exploration." },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      async run(input) {
        const value = objectInput(input);
        noExtra(value, ["auditId", "missionId"]);
        const rootAuditId = auditIdForTool(service, value.auditId);
        const missionId = value.missionId
          ? requiredString(value.missionId, "missionId", 80)
          : service.getSiteExplorations(rootAuditId)[0]?.id;
        if (!missionId) {
          throw new AuditError(
            "EXPLORATION_CONTEXT_REQUIRED",
            "Provide missionId or start a site exploration from this audit first.",
          );
        }
        const exploration = await service.getSiteExploration(rootAuditId, missionId);
        return {
          ...exploration,
          reportPath: `/api/audits/${encodeURIComponent(rootAuditId)}/explorations/${encodeURIComponent(missionId)}/report`,
        };
      },
    }),
    tool({
      name: "get_verification_receipt",
      title: "Get verification receipt",
      description:
        "Return a portable Markdown evidence receipt for a completed repair verification, including exact-rule outcome, before/after metrics, and bounded audit lineage. Omit auditId to use the visible verification audit. This does not change or deploy the target site.",
      inputSchema: {
        ...emptySchema,
        properties: {
          auditId: { type: "string", minLength: 1, description: "Optional verification audit ID; defaults to the visible audit." },
        },
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      async run(input) {
        const value = objectInput(input);
        noExtra(value, ["auditId"]);
        const auditId = auditIdForTool(service, value.auditId);
        const report = await service.getResults(auditId);
        return {
          auditId,
          status: report.verification?.status,
          format: "text/markdown",
          downloadPath: `/api/audits/${encodeURIComponent(auditId)}/receipt`,
          receipt: verificationReceiptMarkdown(report),
        };
      },
    }),
    tool({
      name: "stage_site_repair",
      title: "Stage site repair",
      description:
        "Stage a bounded repair proposal for one completed audit finding. Omit auditId to use the visible audit. This creates a visible draft for human review; it never changes the target site or approves the draft.",
      inputSchema: {
        type: "object",
        properties: {
          auditId: { type: "string", minLength: 1, description: "Optional completed audit ID; defaults to the visible audit." },
          findingId: { type: "string", minLength: 1, description: "Finding ID from the completed report." },
          summary: { type: "string", minLength: 1, maxLength: 300, description: "Concise implementation rationale." },
          patchType: {
            type: "string",
            enum: ["html", "css", "javascript", "headers", "configuration", "guidance"],
            description: "Kind of source change being proposed.",
          },
          patch: { type: "string", minLength: 1, maxLength: 1200, description: "Reviewable code or implementation guidance." },
          verificationPlan: { type: "string", minLength: 1, maxLength: 500, description: "How to prove the finding changed after deployment." },
          risk: { type: "string", enum: ["low", "medium", "high"], description: "Implementation risk requiring review." },
        },
        required: ["findingId"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      async run(input) {
        const value = objectInput(input);
        noExtra(value, ["auditId", "findingId", "summary", "patchType", "patch", "verificationPlan", "risk"]);
        const auditId = auditIdForTool(service, value.auditId);
        const findingId = requiredString(value.findingId, "findingId", 160);
        const patchTypes = ["html", "css", "javascript", "headers", "configuration", "guidance"];
        const risks = ["low", "medium", "high"];
        if (value.patchType !== undefined && !patchTypes.includes(value.patchType)) {
          throw new AuditError("INVALID_INPUT", "patchType is not supported.");
        }
        if (value.risk !== undefined && !risks.includes(value.risk)) {
          throw new AuditError("INVALID_INPUT", "risk is not supported.");
        }
        const repair = await service.stageRepair(auditId, {
          findingId,
          source: "agent",
          summary: optionalString(value.summary, "summary", 300),
          patchType: value.patchType,
          patch: optionalString(value.patch, "patch", 1200),
          verificationPlan: optionalString(value.verificationPlan, "verificationPlan", 500),
          risk: value.risk,
        });
        return {
          auditId,
          repairId: repair.id,
          findingId: repair.findingId,
          status: repair.status,
          revision: repair.revision ?? 1,
          summary: repair.summary,
          patchType: repair.patchType,
          risk: repair.risk,
          requiresHumanReview: true,
          mission: repair.mission ?? repairMissionState(repair),
          nextAction: "Ask the person to review and approve the visible draft in Frontmend.",
        };
      },
    }),
    tool({
      name: "revise_site_repair",
      title: "Revise site repair",
      description:
        "Submit a complete revised repair proposal only after a person requested changes in the visible Frontmend review interface. Omit auditId to use the visible audit. This cannot approve the revision, attest deployment, or change the target site.",
      inputSchema: {
        type: "object",
        properties: {
          auditId: { type: "string", minLength: 1, description: "Optional completed audit ID; defaults to the visible audit." },
          repairId: { type: "string", minLength: 1, description: "Repair ID with a pending human change request." },
          summary: { type: "string", minLength: 1, maxLength: 300, description: "Revised implementation rationale addressing the feedback." },
          patchType: {
            type: "string",
            enum: ["html", "css", "javascript", "headers", "configuration", "guidance"],
            description: "Kind of source change in the revised proposal.",
          },
          patch: { type: "string", minLength: 1, maxLength: 1200, description: "Complete revised code or implementation guidance." },
          verificationPlan: { type: "string", minLength: 1, maxLength: 500, description: "Revised plan for proving the exact finding changed." },
          risk: { type: "string", enum: ["low", "medium", "high"], description: "Reassessed implementation risk." },
        },
        required: ["repairId", "summary", "patchType", "patch", "verificationPlan", "risk"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      async run(input) {
        const value = objectInput(input);
        noExtra(value, ["auditId", "repairId", "summary", "patchType", "patch", "verificationPlan", "risk"]);
        const patchTypes = ["html", "css", "javascript", "headers", "configuration", "guidance"];
        const risks = ["low", "medium", "high"];
        if (!patchTypes.includes(value.patchType)) {
          throw new AuditError("INVALID_INPUT", "patchType is not supported.");
        }
        if (!risks.includes(value.risk)) {
          throw new AuditError("INVALID_INPUT", "risk is not supported.");
        }
        const auditId = auditIdForTool(service, value.auditId);
        const repairId = requiredString(value.repairId, "repairId", 80);
        const repair = await service.reviseRepair(auditId, repairId, {
          summary: requiredString(value.summary, "summary", 300),
          patchType: value.patchType,
          patch: requiredString(value.patch, "patch", 1200),
          verificationPlan: requiredString(value.verificationPlan, "verificationPlan", 500),
          risk: value.risk,
        });
        return {
          auditId,
          repairId: repair.id,
          findingId: repair.findingId,
          status: repair.status,
          revision: repair.revision,
          summary: repair.summary,
          patchType: repair.patchType,
          risk: repair.risk,
          requiresHumanReview: true,
          mission: repair.mission ?? repairMissionState(repair),
          nextAction: "Ask the person to review the revised proposal in Frontmend.",
        };
      },
    }),
    tool({
      name: "get_repair_workspace",
      title: "Get repair workspace",
      description:
        "Read repair drafts, human-review status, and the external deployment handoff for a completed audit. Omit auditId to use the visible audit. This does not stage, approve, attest deployment, export, or verify a repair.",
      inputSchema: {
        type: "object",
        properties: {
          auditId: { type: "string", minLength: 1, description: "Optional completed audit ID; defaults to the visible audit." },
          repairId: { type: "string", minLength: 1, description: "Optional repair ID to inspect in detail." },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      async run(input) {
        const value = objectInput(input);
        noExtra(value, ["auditId", "repairId"]);
        const auditId = auditIdForTool(service, value.auditId);
        const repairId = optionalString(value.repairId, "repairId", 80);
        const workspace = await service.listRepairs(auditId);
        const repairs = repairId
          ? workspace.repairs.filter((repair) => repair.id === repairId)
          : workspace.repairs;
        if (repairId && !repairs.length) {
          throw new AuditError("REPAIR_NOT_FOUND", "That repair draft does not exist.");
        }
        return {
          auditId,
          repairs: repairs.map((repair) => ({
            id: repair.id,
            findingId: repair.findingId,
            findingTitle: repair.findingTitle,
            status: repair.status,
            revision: repair.revision ?? 1,
            source: repair.source,
            summary: repair.summary,
            patchType: repair.patchType,
            patch: repairId ? repair.patch.slice(0, 900) : undefined,
            patchTruncated: repairId ? repair.patch.length > 900 : undefined,
            verificationPlan: repairId ? repair.verificationPlan : undefined,
            risk: repair.risk,
            requiresHumanReview: repair.requiresHumanReview,
            reviewedAt: repair.reviewedAt,
            implementationReceipt: repair.implementationReceipt
              ? {
                  revision: repair.implementationReceipt.revision ?? 1,
                  summary: repair.implementationReceipt.summary,
                  files: repair.implementationReceipt.files,
                  checks: repair.implementationReceipt.checks,
                  commitSha: repair.implementationReceipt.commitSha,
                  source: repair.implementationReceipt.source,
                  reportedAt: repair.implementationReceipt.reportedAt,
                  sourceChangedByFrontmend: false,
                }
              : null,
            implementationHistory: (repair.implementationHistory ?? []).slice(-5).map((receipt) => ({
              revision: receipt.revision ?? 1,
              summary: receipt.summary,
              files: receipt.files,
              checks: receipt.checks,
              commitSha: receipt.commitSha,
              source: receipt.source,
              reportedAt: receipt.reportedAt,
              sourceChangedByFrontmend: false,
            })),
            deploymentAttestedAt: repair.deploymentAttestedAt,
            changeRequest: repair.changeRequest
              ? {
                  feedback: repair.changeRequest.feedback,
                  requestedAt: repair.changeRequest.requestedAt,
                }
              : null,
            revisionHistory: (repair.revisionHistory ?? []).slice(-5).map((revision) => ({
              revision: revision.revision,
              summary: revision.summary,
              source: revision.source,
              createdAt: revision.createdAt,
              changeRequest: revision.changeRequest
                ? {
                    feedback: revision.changeRequest.feedback,
                    requestedAt: revision.changeRequest.requestedAt,
                  }
                : null,
            })),
            mission: repair.mission ?? repairMissionState(repair),
          })),
        };
      },
    }),
    tool({
      name: "record_repository_implementation",
      title: "Record repository implementation",
      description:
        "Record a bounded receipt after a coding agent implements a human-approved repair in the repository. It accepts only repository-relative filenames, check outcomes, and an optional Git object ID. This does not inspect or upload source, change files, approve the repair, attest deployment, or claim the public result is fixed.",
      inputSchema: {
        type: "object",
        properties: {
          auditId: { type: "string", minLength: 1, description: "Optional completed audit ID; defaults to the visible audit." },
          repairId: { type: "string", minLength: 1, description: "Human-approved repair ID." },
          summary: { type: "string", minLength: 1, maxLength: 300, description: "What the coding agent changed." },
          files: {
            type: "array",
            minItems: 1,
            maxItems: 8,
            uniqueItems: true,
            items: { type: "string", minLength: 1, maxLength: 200 },
            description: "Repository-relative changed file paths only; no source contents or absolute paths.",
          },
          checks: {
            type: "array",
            minItems: 1,
            maxItems: 8,
            items: {
              type: "object",
              properties: {
                name: { type: "string", minLength: 1, maxLength: 120 },
                status: { type: "string", enum: ["passed", "failed", "not-run"] },
              },
              required: ["name", "status"],
              additionalProperties: false,
            },
          },
          commitSha: { type: "string", minLength: 7, maxLength: 64, pattern: "^[0-9a-fA-F]+$" },
        },
        required: ["repairId", "summary", "files", "checks"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async run(input) {
        const value = objectInput(input);
        noExtra(value, ["auditId", "repairId", "summary", "files", "checks", "commitSha"]);
        const auditId = auditIdForTool(service, value.auditId);
        const repair = await service.recordImplementation(
          auditId,
          requiredString(value.repairId, "repairId", 80),
          {
            summary: requiredString(value.summary, "summary", 300),
            files: value.files,
            checks: value.checks,
            commitSha: optionalString(value.commitSha, "commitSha", 64),
          },
        );
        return {
          auditId,
          repairId: repair.id,
          status: repair.status,
          implementationReceipt: repair.implementationReceipt,
          mission: repair.mission ?? repairMissionState(repair),
          nextAction: "The site owner may now review the receipt, deploy externally, and attest that handoff in the visible UI.",
        };
      },
    }),
    tool({
      name: "start_repair_verification",
      title: "Start repair verification",
      description:
        "Start a fresh live audit only after a person approved the repair and attested in the visible UI that it was deployed externally. Omit auditId to use the visible baseline audit. It never changes the target site or navigates during the tool call. Follow the returned workspace path, poll its audit ID, and inspect the comparison result when complete.",
      inputSchema: {
        type: "object",
        properties: {
          auditId: { type: "string", minLength: 1, description: "Optional baseline audit ID; defaults to the visible audit." },
          repairId: { type: "string", minLength: 1, description: "Human-approved repair draft ID." },
        },
        required: ["repairId"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      async run(input) {
        const value = objectInput(input);
        noExtra(value, ["auditId", "repairId"]);
        const audit = await service.startVerification(
          auditIdForTool(service, value.auditId),
          requiredString(value.repairId, "repairId", 80),
        );
        return { ...audit, workspacePath: `/audits/${encodeURIComponent(audit.id)}` };
      },
    }),
  ];
  return tools.map((definition) => {
    const execute = definition.execute;
    return {
      ...definition,
      async execute(input) {
        let activityId = null;
        try {
          activityId = service.beginAgentActivity?.({
            tool: definition.name,
            title: definition.title,
          }) ?? null;
        } catch {
          activityId = null;
        }
        const result = await execute(input);
        if (activityId) {
          const data = result?.data;
          try {
            service.finishAgentActivity?.(activityId, {
              status: result?.ok ? "succeeded" : "failed",
              auditId: data?.auditId ?? data?.id,
              repairId: data?.repairId,
              errorCode: result?.error?.code,
            });
          } catch {
            // Activity telemetry never changes the semantic tool result.
          }
        }
        return result;
      },
    };
  });
}

export function getModelContext(target = globalThis.document) {
  const candidate = target?.modelContext;
  return typeof candidate?.registerTool === "function" ? candidate : null;
}

export function registerFrontmendTools({ service, target, onStatus, toolNames }) {
  const modelContext = getModelContext(target);
  const allTools = createFrontmendTools(service);
  const requestedNames = toolNames ? new Set(toolNames) : null;
  const tools = requestedNames
    ? allTools.filter((definition) => requestedNames.has(definition.name))
    : allTools;
  const statusBase = {
    supported: Boolean(modelContext),
    totalTools: allTools.length,
    activeTools: tools.length,
  };
  if (!modelContext) {
    onStatus?.({ ...statusBase, status: "unsupported", toolNames: [], errors: [] });
    const dispose = () => {};
    dispose.ready = Promise.resolve();
    return dispose;
  }

  const controller = new AbortController();
  const registered = [];
  const errors = [];
  onStatus?.({ ...statusBase, status: "registering", toolNames: [], errors: [] });

  // Defer the first registration by one microtask so React Strict Mode can run
  // its development-only setup/cleanup probe without leaving duplicate tools.
  const ready = Promise.resolve().then(async () => {
    if (controller.signal.aborted) return;

    for (const definition of tools) {
      if (controller.signal.aborted) return;
      try {
        await modelContext.registerTool(definition, { signal: controller.signal });
        if (controller.signal.aborted) return;
        registered.push(definition.name);
      } catch (error) {
        if (controller.signal.aborted) return;
        errors.push(`${definition.name}: ${registrationErrorMessage(error)}`);
      }
    }

    if (controller.signal.aborted) return;
    onStatus?.({
      ...statusBase,
      status: errors.length ? "error" : "ready",
      toolNames: registered,
      errors,
    });
  });

  const dispose = () => controller.abort();
  dispose.ready = ready;
  return dispose;
}
