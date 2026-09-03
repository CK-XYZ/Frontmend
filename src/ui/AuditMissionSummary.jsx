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
      if (state.siteScope?.blockedReason) return state.siteScope.blockedReason;
      if (state.assessmentComplete && state.repairReadiness?.status === "blocked") {
        return "Final report retained · repair preparation can resume when access matches";
      }
      return "Evidence retained · resume when the required browser access matches";
    }
    if (state.assessmentComplete && state.repairReadiness?.status === "not-started") {
      return "Final report ready · choose a priority only if you want to prepare a fix";
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
    start_site_exploration: "Agent starts the server-issued retained route audits",
    get_site_exploration: "Agent waits for bounded-site route evidence",
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
  const replays = verification?.browserReplays?.length
    ? verification.browserReplays
    : replay?.required ? [replay] : [];
  const guardrails = verification?.browserGuardrails ?? [];
  const browserVerificationRequired = replays.length > 0 || guardrails.length > 0;
  if (verification && browserVerificationRequired) {
    const verificationChecks = [
      ...replays,
      ...guardrails,
    ];
    const fallbackState = {
      status: verificationChecks.every((check) => check.status === "complete")
        ? "complete"
        : verificationChecks.some((check) => check.status === "blocked")
          ? "blocked"
          : verificationChecks.some((check) => check.status === "in-progress")
            ? "in-progress"
            : "not-opened",
    };
    const replayState = browserReview?.purpose === "verification"
      ? browserReview.state
      : fallbackState;
    const replayComplete = replayState?.status === "complete";
    const replayBlocked = replayState?.status === "blocked";
    const statusLabel = replayComplete
      ? verification.status === "inconclusive"
        ? "Fresh comparison recorded · updating proof"
        : verification.status === "resolved"
          ? "Required rendered checks passed"
          : verification.status === "regression"
            ? "A retained browser guardrail regressed"
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
            <span>Agent browser verification</span>
          </p>
          <h2 id={titleId}>{verification.findingTitle}</h2>
          <div className="audit-mission-focus" aria-label="Verification evidence">
            <span>{replay?.baseline?.focusArea ?? guardrails[0]?.focusArea ?? "rendered guardrail"}</span>
            <span>{replay?.baseline?.source?.strategy ?? guardrails[0]?.viewport ?? "retained viewport"}</span>
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
            <small>{replayComplete ? "Verification receipt unlocked" : "Agent owns the required fresh browser comparisons"}</small>
          </div>
        </div>
        <p className="audit-mission-authority">
          <ShieldCheck size={17} weight="duotone" aria-hidden="true" />
          <span>
            <strong>Claim lock</strong>
            Provider measurement and retained browser observations stay separate. Frontmend issues
            a resolution claim only after every exact replay and browser guardrail is recorded.
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
  const measurementComplete = state.measurementComplete ?? state.auditComplete;
  const focusLabel = missionFocusLabel(state.requestedFocusAreas);
  const statusLabel = !measurementComplete
    ? "Measurement in progress"
    : !state.assessmentComplete && state.status === "blocked"
      ? "Assessment blocked · evidence retained"
      : state.assessmentComplete && state.repairReadiness?.status === "not-started"
        ? "Audit complete · repair diagnosis not started"
      : state.assessmentComplete && state.repairReadiness?.status === "blocked"
        ? "Audit complete · repair diagnosis blocked"
      : state.assessmentComplete && ["diagnosis-required", "diagnosis-in-progress"].includes(state.repairReadiness?.status)
        ? "Audit complete · repair diagnosis active"
      : state.assessmentComplete
        ? "Audit complete"
        : state.rankingStatus === "provisional"
          ? "Measurement complete · ranking provisional"
        : state.browserReview?.required && state.browserReview.status !== "complete"
          ? "Measurement complete · browser review active"
          : "Measurement complete · diagnosis active";
  const tone = state.assessmentComplete && state.repairReadiness?.status !== "blocked"
    ? "complete"
    : measurementComplete ? "attention" : "running";

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
          <span>{retainedMission.scope === "bounded-site" ? "bounded site" : "page"}</span>
          {state.requestedFocusAreas.length ? state.requestedFocusAreas.map((area) => (
            <span key={area}>{area === "seo" ? "SEO" : area}</span>
          )) : <span>All supported areas</span>}
        </div>
      </div>
      <div className="audit-mission-status">
        <span className="audit-mission-status-icon" aria-hidden="true">
          {state.assessmentComplete && state.repairReadiness?.status !== "blocked"
            ? <CheckCircle size={18} weight="fill" />
            : state.status === "blocked"
              ? <Warning size={18} weight="fill" />
              : measurementComplete
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
          Agent completes public evidence first. Repository diagnosis starts only after you select a
          repair; you still control approval, deployment, and deployment attestation.
        </span>
      </p>
    </section>
  );
}
