import {
  Browser,
  CheckCircle,
  MagnifyingGlass,
  Pulse,
  Robot,
  ShieldCheck,
  Warning,
} from "@phosphor-icons/react";
import { useId } from "react";
import { createAuditMission, deriveAuditMissionState } from "../audit-mission-contract.js";

function missionActionLabel(state) {
  if (!state.nextAction) {
    if (state.status === "blocked") {
      return "Evidence retained · resume when browser and repository access match";
    }
    return state.assessmentComplete
      ? "No required continuation"
      : "The person chooses the next repair target";
  }
  const labels = {
    check_site_audit_progress: "Agent waits for the live measurement",
    open_diagnostic_mission: "Agent opens the retained issue for diagnosis",
    open_browser_review: "Agent opens the rendered-browser evidence mission",
    record_browser_review_check: "Agent performs the next exact browser check",
    submit_runtime_diagnosis: "Agent contributes browser and repository diagnosis",
    stage_site_repair: "Agent prepares a bounded repair draft",
    get_repair_workspace: "Agent continues the reviewed repair workspace",
  };
  return labels[state.nextAction.tool] ?? `Next: ${state.nextAction.tool.replaceAll("_", " ")}`;
}

function missionFocusLabel(focusAreas) {
  if (!focusAreas.length) return "Full frontend audit";
  return focusAreas
    .map((area) => (area === "seo" ? "SEO" : `${area[0].toUpperCase()}${area.slice(1)}`))
    .join(" + ");
}

export function retainedAuditMission(audit) {
  return audit?.mission ?? createAuditMission(
    {},
    audit?.source === "agent" ? "agent" : "human",
    0,
  );
}

export function AuditMissionSummary({ audit, diagnosticMissions = [], repairs = [], browserReview = null, missionState = null }) {
  const titleId = useId();
  const verification = audit?.report?.verification;
  const replay = verification?.browserReplay;
  if (verification && replay?.required) {
    const replayState = browserReview?.purpose === "verification"
      ? browserReview.state
      : replay;
    const replayComplete = replayState?.status === "complete";
    const replayBlocked = replayState?.status === "blocked";
    const statusLabel = replayComplete
      ? verification.status === "inconclusive"
        ? "Fresh comparison recorded · updating proof"
        : verification.status === "resolved"
        ? "Exact rendered issue passed"
        : "Exact rendered issue still present"
      : replayBlocked
        ? "Fresh browser replay blocked"
        : replayState?.status === "in-progress"
          ? "Fresh browser replay active"
          : "Provider measurement complete · replay waiting";
    return (
      <section className={`audit-mission-summary ${replayComplete ? "complete" : "attention"}`} aria-labelledby={titleId}>
        <div className="audit-mission-identity">
          <p className="kicker">
            <Robot size={14} weight="fill" aria-hidden="true" />
            Verification
            <span>Agent browser replay</span>
          </p>
          <h2 id={titleId}>{verification.findingTitle}</h2>
          <div className="audit-mission-focus" aria-label="Verification evidence">
            <span>{replay.baseline?.focusArea ?? "rendered issue"}</span>
            <span>{replay.baseline?.source?.strategy ?? "retained viewport"}</span>
          </div>
        </div>
        <div className="audit-mission-status">
          <span className="audit-mission-status-icon" aria-hidden="true">
            {replayComplete
              ? verification.status === "resolved"
                ? <CheckCircle size={18} weight="fill" />
                : <Warning size={18} weight="fill" />
              : replayBlocked
                ? <Warning size={18} weight="fill" />
                : <Browser size={18} weight="duotone" />}
          </span>
          <div>
            <strong>{statusLabel}</strong>
            <small>{replayComplete ? "Verification receipt unlocked" : "Agent owns the exact fresh comparison"}</small>
          </div>
        </div>
        <p className="audit-mission-authority">
          <ShieldCheck size={17} weight="duotone" aria-hidden="true" />
          <span>
            <strong>Claim lock</strong>
            Provider measurement and the retained browser observation stay separate. Frontmend issues
            a resolution claim only after the exact rendered comparison is recorded.
          </span>
        </p>
      </section>
    );
  }
  const retainedMission = retainedAuditMission(audit);
  const state = missionState ?? deriveAuditMissionState({
    report: audit?.report ?? null,
    mission: retainedMission,
    diagnosticMissions,
    repairs,
  });
  const focusLabel = missionFocusLabel(state.requestedFocusAreas);
  const statusLabel = !state.auditComplete
    ? "Measurement in progress"
    : state.status === "blocked"
      ? "Assessment blocked · evidence retained"
      : state.assessmentComplete
        ? "Assessment complete"
        : state.browserReview?.required && state.browserReview.status !== "complete"
          ? "Measurement complete · browser review active"
          : "Measurement complete · diagnosis active";
  const tone = state.assessmentComplete ? "complete" : state.auditComplete ? "attention" : "running";

  return (
    <section className={`audit-mission-summary ${tone}`} aria-labelledby={titleId}>
      <div className="audit-mission-identity">
        <p className="kicker">
          <Robot size={14} weight="fill" aria-hidden="true" />
          {state.intent === "prepare-fix" ? "Preparing a fix" : "Assessment"}
          <span>{retainedMission.requestedBy === "agent" ? "Agent-started" : "Person-started"}</span>
        </p>
        <h2 id={titleId}>{focusLabel}</h2>
        <div className="audit-mission-focus" aria-label="Mission focus">
          {state.requestedFocusAreas.length ? state.requestedFocusAreas.map((area) => (
            <span key={area}>{area === "seo" ? "SEO" : area}</span>
          )) : <span>All supported areas</span>}
        </div>
      </div>
      <div className="audit-mission-status">
        <span className="audit-mission-status-icon" aria-hidden="true">
          {state.assessmentComplete
            ? <CheckCircle size={18} weight="fill" />
            : state.status === "blocked"
              ? <Warning size={18} weight="fill" />
              : state.auditComplete
                ? <MagnifyingGlass size={18} weight="bold" />
                : <Pulse size={18} weight="bold" />}
        </span>
        <div>
          <strong>{statusLabel}</strong>
          <small>{missionActionLabel(state)}</small>
        </div>
      </div>
      <p className="audit-mission-authority">
        <ShieldCheck size={17} weight="duotone" aria-hidden="true" />
        <span>
          <strong>Shared authority</strong>
          Agent investigates browser and repository evidence. You control repair intent, approval,
          deployment, and deployment attestation.
        </span>
      </p>
    </section>
  );
}
