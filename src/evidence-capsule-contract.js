import {
  AGENT_CAPABILITIES,
  requiredCapabilitiesForBrowserTask,
} from "./agent-capability-contract.js";
import { compileBrowserInvestigations } from "./browser-investigation-compiler.js";
import { AuditError } from "./url-policy.js";

function bounded(value, maximum = 600) {
  return String(value ?? "").replace(/\r\n/g, "\n").trim().slice(0, maximum);
}

function routePath(value) {
  try {
    const url = new URL(value);
    return `${url.pathname || "/"}${url.search}`.slice(0, 256);
  } catch {
    const retained = bounded(value, 256);
    return retained.startsWith("/") ? retained : "/";
  }
}

function taskForFinding(tasks, finding, priority) {
  const findingId = finding?.id ?? priority?.findingId;
  const sourceRule = finding?.source?.auditId ?? priority?.source?.auditId;
  return tasks.find((task) =>
    task?.trigger?.findingId === findingId
    || task?.trigger?.ruleId === sourceRule
    || task?.trigger?.auditId === sourceRule
    || task?.trigger?.occurrences?.some((item) => item.findingId === findingId),
  ) ?? null;
}

function fallbackTask(finding, route, viewport) {
  const selector = bounded(finding?.selector, 200) || "the relevant page landmark";
  const task = {
    schemaVersion: 1,
    id: `observe-${bounded(finding?.source?.auditId ?? finding?.id, 64) || "priority"}`,
    label: `Observe ${bounded(finding?.title, 120) || "retained priority"}`,
    viewport,
    target: { path: route, viewport, affectedViewports: [viewport] },
    assignment: {
      goal: `Check the retained ${bounded(finding?.title, 180) || "frontend"} observation in the rendered page.`,
      instructions: `Open ${route} at the ${viewport} viewport, inspect ${selector}, and report only what is directly observable for this retained priority.`,
      completionCriteria: "Return the inspected viewport and target with a direct pass, issue, or honest blocker.",
    },
  };
  // A mobile or tablet fallback cannot be observed with visual browser access
  // alone, so derive the requirement from the viewport the task actually names.
  return { ...task, requiredCapabilities: requiredCapabilitiesForBrowserTask(task) };
}

function observationCapabilities(task) {
  const required = new Set(requiredCapabilitiesForBrowserTask(task));
  if (Array.isArray(task?.requiredCapabilities)) {
    for (const capability of task.requiredCapabilities) required.add(capability);
  }
  return AGENT_CAPABILITIES.filter((capability) => required.has(capability));
}

function screenshotFor({ report, finding, priority, task }) {
  const preferred = [
    finding?.source?.strategy,
    ...(priority?.affectedStrategies ?? []),
    task?.target?.viewport,
  ].filter(Boolean);
  const viewports = Array.isArray(report?.viewports) ? report.viewports : [];
  const viewport = preferred
    .map((id) => viewports.find((item) => item?.id === id || item?.strategy === id))
    .find(Boolean)
    ?? viewports.find((item) => item?.evidenceUrl)
    ?? viewports[0]
    ?? null;
  const id = bounded(viewport?.id ?? viewport?.strategy ?? finding?.source?.strategy ?? task?.viewport ?? "document", 40);
  return {
    status: viewport?.evidenceUrl ? "retained" : "not-captured",
    url: viewport?.evidenceUrl ? bounded(viewport.evidenceUrl, 2_048) : null,
    source: viewport?.evidenceUrl ? "lighthouse-audit-capture" : "no-provider-image",
    viewport: {
      id,
      label: bounded(viewport?.label ?? finding?.viewport ?? id, 120),
      detail: bounded(viewport?.detail ?? "", 120) || null,
    },
  };
}

function evidenceTimestamp(report, finding) {
  const browserTimestamp = finding?.browserReviewEvidence?.reportedAt;
  if (Number.isFinite(browserTimestamp) && browserTimestamp >= 0) return Math.round(browserTimestamp);
  if (Number.isFinite(report?.completedAt) && report.completedAt >= 0) return Math.round(report.completedAt);
  return null;
}

export function createEvidenceCapsules({ audit, report, missionState, findings, browserReview = null } = {}) {
  if (!audit?.id || !report || !missionState || !Array.isArray(findings)) {
    throw new AuditError("EVIDENCE_NOT_FOUND", "A completed retained mission is required to create evidence capsules.");
  }
  const auditRevision = Number.isInteger(audit.missionRevision) && audit.missionRevision > 0
    ? audit.missionRevision
    : Number.isInteger(audit.missionCheckpoint?.missionRevision) ? audit.missionCheckpoint.missionRevision : 1;
  const retainedTasks = browserReview?.tasks?.length
    ? browserReview.tasks
    : browserReview?.requestedChecks?.length
      ? browserReview.requestedChecks
      : compileBrowserInvestigations({
          report,
          documentProfile: report.documentProfile,
          mission: audit.mission,
          target: report.finalUrl ?? report.url ?? audit.url,
        });

  return (missionState.priorities ?? []).map((priority) => {
    const finding = findings.find((item) => item?.id === priority.findingId);
    if (!finding) {
      throw new AuditError("EVIDENCE_NOT_FOUND", "A ranked priority no longer has retained finding evidence.");
    }
    const initialRoute = finding.route?.path
      ?? routePath(report.finalUrl ?? report.url ?? audit.url);
    const retainedTask = taskForFinding(retainedTasks, finding, priority);
    const task = retainedTask ?? fallbackTask(
      finding,
      initialRoute,
      ["mobile", "tablet"].includes(finding.source?.strategy) ? finding.source.strategy : "desktop",
    );
    const route = bounded(task?.target?.path ?? initialRoute, 256) || "/";
    const selector = bounded(
      finding.selector ?? task?.trigger?.selector ?? task?.trigger?.occurrences?.find((item) => item.selector)?.selector,
      200,
    );
    const documentTarget = !selector || selector.toLowerCase() === "document";
    const screenshot = screenshotFor({ report, finding, priority, task });
    const provider = bounded(finding.source?.provider ?? priority.source?.provider ?? "Frontmend retained evidence", 120);
    const evidenceProvenance = priority.evidenceProvenance
      ?? (finding.browserReviewEvidence?.provenance || "measured-provider");
    const retainedInstructions = bounded(task.assignment?.instructions ?? task.instruction, 760);
    const exactTarget = documentTarget ? "the document landmark" : `selector ${selector}`;
    return {
      schemaVersion: 1,
      capsuleId: `${bounded(audit.id, 80)}:r${auditRevision}:${bounded(finding.id, 160)}`,
      auditId: bounded(audit.id, 80),
      findingId: bounded(finding.id, 160),
      priorityRank: priority.rank,
      title: bounded(finding.title, 240),
      auditRevision,
      timestamp: evidenceTimestamp(report, finding),
      revisionBinding: {
        auditRevision,
        claim: "This capsule describes retained evidence at this exact audit revision; re-read it after any mission change.",
      },
      screenshot,
      target: {
        route,
        selector: documentTarget ? null : selector,
        landmark: documentTarget ? "document" : null,
      },
      evidence: {
        observation: bounded(finding.evidence ?? task?.trigger?.retainedEvidence, 600),
        provenance: bounded(evidenceProvenance, 80),
        source: {
          provider,
          auditId: bounded(finding.source?.auditId ?? priority.source?.auditId ?? finding.id, 160),
          strategy: bounded(finding.source?.strategy ?? screenshot.viewport.id, 40),
        },
      },
      observationTask: {
        id: bounded(task.id, 80),
        label: bounded(task.label, 120),
        viewport: bounded(task.target?.viewport ?? task.viewport ?? screenshot.viewport.id, 40),
        instructions: bounded(
          `${retainedInstructions} Exact target: ${exactTarget} on route ${route}.`,
          900,
        ),
        completionCriteria: bounded(task.assignment?.completionCriteria, 600),
        requiredCapabilities: observationCapabilities(task),
      },
      boundary: "Retained provider or attributed browser evidence only. The capsule is not a fresh capture, repository diagnosis, deployment receipt, or resolution proof.",
    };
  });
}

export function getActiveEvidenceCapsule(input = {}) {
  const capsules = createEvidenceCapsules(input);
  if (!capsules.length) {
    throw new AuditError("EVIDENCE_NOT_FOUND", "This mission has no ranked evidence capsule.");
  }
  if (!input.findingId) return capsules[0];
  const capsule = capsules.find((item) => item.findingId === input.findingId);
  if (!capsule) {
    throw new AuditError("EVIDENCE_NOT_FOUND", "The active finding is not a retained mission priority.");
  }
  return capsule;
}
