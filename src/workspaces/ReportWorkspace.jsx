import {
  ArrowLeft,
  ArrowRight,
  ArrowsOutSimple,
  Browser,
  Check,
  CheckCircle,
  ClipboardText,
  Desktop,
  DeviceMobile,
  DotsThree,
  DownloadSimple,
  Info,
  LinkSimple,
  MagnifyingGlass,
  Monitor,
  PaperPlaneTilt,
  Pulse,
  Robot,
  ShieldCheck,
  Sparkle,
  Warning,
  Wrench,
  X,
} from "@phosphor-icons/react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AuditError, auditService } from "../audit-service.js";
import { assessmentFindings, deriveAuditMissionState } from "../audit-mission-contract.js";
import { createSiteRouteCandidates } from "../site-exploration-contract.js";
import { observedRouteRecords } from "../route-contract.js";
import { findingRequiresDiagnosticMission } from "../diagnostic-contract.js";
import { agentCapabilityRows } from "../agent-capability-contract.js";
import { createEvidenceCapsules } from "../evidence-capsule-contract.js";
import { createFreshAgentHandoff } from "../mission-handoff-contract.js";
import { AuditMissionSummary, retainedAuditMission } from "../ui/AuditMissionSummary.jsx";
import { EvidenceOverview } from "../ui/EvidenceOverview.jsx";
import { humanMissionMutationFailure } from "../ui/human-mission-recovery.js";
import { LazyWorkspace } from "../ui/LazyWorkspace.jsx";

const loadDiagnosisWorkspace = () => import("./DiagnosisWorkspace.jsx");
const loadRepairPolicyWorkspace = () => import("./RepairPolicyWorkspace.jsx");
const loadRepairWorkspace = () => import("./RepairWorkspace.jsx");
const loadVerificationWorkspace = () => import("./VerificationWorkspace.jsx");

function auditWorkspacePath(auditId) {
  return `/audits/${encodeURIComponent(auditId)}`;
}

const VIEWPORTS = [
  { id: "desktop", label: "Desktop", detail: "1440 px", icon: Desktop },
  { id: "tablet", label: "Tablet", detail: "768 px", icon: Monitor },
  { id: "mobile", label: "Mobile", detail: "390 px", icon: DeviceMobile },
];

function emptyBrowserFinding(focusArea = "accessibility") {
  return {
    title: "",
    severity: "medium",
    focusArea,
    evidence: "",
    suggestedRepair: "",
    element: "",
  };
}

function HumanBrowserReviewForm({ auditId, review, reviewState, webMcpReady, onChanged }) {
  const check = reviewState?.nextCheck;
  const [outcome, setOutcome] = useState("passed");
  const [summary, setSummary] = useState("");
  const [observations, setObservations] = useState([""]);
  const [blockerReason, setBlockerReason] = useState("browser-unavailable");
  const [findings, setFindings] = useState(() => [emptyBrowserFinding(check?.focusAreas?.[0])]);
  const [expanded, setExpanded] = useState(!webMcpReady);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    setOutcome("passed");
    setSummary("");
    setObservations([""]);
    setBlockerReason("browser-unavailable");
    setFindings([emptyBrowserFinding(check?.focusAreas?.[0])]);
    setNotice("");
  }, [check?.id]);

  if (!check) return null;
  const findingsAllowed = check.responseContract?.findingsAllowed !== false;
  const refreshAfterStale = async () => {
    await auditService.refreshMissionWorkspace(auditId);
    const currentReview = auditService.getBrowserReview(auditId);
    if (currentReview) onChanged(currentReview);
  };
  const updateObservation = (index, value) => {
    setObservations((current) => current.map((item, itemIndex) => itemIndex === index ? value : item));
  };
  const updateFinding = (index, field, value) => {
    setFindings((current) => current.map((item, itemIndex) => itemIndex === index
      ? { ...item, [field]: value }
      : item));
  };
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    try {
      const retainedObservations = observations.map((item) => item.trim()).filter(Boolean);
      const input = {
        checkId: check.id,
        outcome,
        summary: summary.trim(),
        ...(retainedObservations.length || outcome !== "blocked"
          ? { observations: retainedObservations }
          : {}),
        ...(outcome === "blocked" ? { blockerReason } : {}),
        ...(outcome === "issue" && findingsAllowed
          ? {
              findings: findings.map((finding) => ({
                title: finding.title.trim(),
                severity: finding.severity,
                focusArea: finding.focusArea,
                evidence: finding.evidence.trim(),
                suggestedRepair: finding.suggestedRepair.trim(),
                ...(finding.element.trim() ? { element: finding.element.trim() } : {}),
              })),
            }
          : {}),
      };
      const updated = await auditService.recordBrowserReviewCheck(
        auditId,
        review.id,
        input,
        "person",
      );
      onChanged(updated);
      setNotice(updated.state?.complete
        ? "Rendered review complete. The assessment now reflects your separately attributed evidence."
        : "Check recorded. The next exact rendered task is ready.");
    } catch (cause) {
      if (cause?.code === "MISSION_REVISION_STALE") {
        try {
          await refreshAfterStale();
          setNotice("Mission changed in another session. The current task was refreshed; review it before resubmitting.");
        } catch {
          setNotice("Mission changed in another session. Refresh this audit before resubmitting.");
        }
      } else {
        setNotice(cause instanceof AuditError ? cause.message : "This rendered check could not be recorded.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <details
      className="human-browser-review"
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>
        <span>
          <Browser size={17} weight="duotone" aria-hidden="true" />
          <strong>{webMcpReady ? "Complete this check yourself" : "Complete rendered review yourself"}</strong>
        </span>
        <small>Same validation · person provenance · no deployment authority</small>
      </summary>
      <form onSubmit={submit}>
        <fieldset className="human-review-outcomes">
          <legend>What did this exact check show?</legend>
          {["passed", "issue", "blocked"].map((value) => (
            <label key={value} className={outcome === value ? "selected" : ""}>
              <input
                type="radio"
                name={`browser-outcome-${review.id}`}
                value={value}
                checked={outcome === value}
                onChange={() => setOutcome(value)}
              />
              <span>{value === "passed" ? "Passed" : value === "issue" ? "Issue found" : "Blocked"}</span>
            </label>
          ))}
        </fieldset>

        <label className="human-review-field">
          <span>Result summary <small>{summary.length}/300</small></span>
          <textarea
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            maxLength={300}
            rows={3}
            required
            placeholder="State only what you observed for this exact task."
          />
        </label>

        <fieldset className="human-review-list">
          <legend>
            Observations
            <small>{outcome === "blocked" ? "optional when blocked" : "1–4 required"}</small>
          </legend>
          {observations.map((observation, index) => (
            <div key={`${check.id}-observation-${index}`}>
              <textarea
                value={observation}
                onChange={(event) => updateObservation(index, event.target.value)}
                maxLength={400}
                rows={2}
                required={outcome !== "blocked" && index === 0}
                aria-label={`Observation ${index + 1}`}
                placeholder="Describe one rendered fact."
              />
              {observations.length > 1 ? (
                <button
                  type="button"
                  onClick={() => setObservations((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                  aria-label={`Remove observation ${index + 1}`}
                >
                  <X size={14} weight="bold" aria-hidden="true" />
                </button>
              ) : null}
            </div>
          ))}
          {observations.length < 4 ? (
            <button type="button" onClick={() => setObservations((current) => [...current, ""])}>
              Add observation
            </button>
          ) : null}
        </fieldset>

        {outcome === "blocked" ? (
          <label className="human-review-field">
            <span>Exact blocker</span>
            <select value={blockerReason} onChange={(event) => setBlockerReason(event.target.value)}>
              <option value="browser-unavailable">Browser unavailable</option>
              <option value="interaction-unsafe">Interaction would be unsafe</option>
              <option value="authentication-required">Authentication required</option>
              <option value="unsupported-capability">Capability unsupported</option>
              <option value="target-changed">Target changed</option>
            </select>
          </label>
        ) : null}

        {outcome === "issue" && findingsAllowed ? (
          <fieldset className="human-review-findings">
            <legend>
              Structured issue details
              <small>1–3 findings</small>
            </legend>
            {findings.map((finding, index) => (
              <section key={`${check.id}-finding-${index}`}>
                <header>
                  <strong>Finding {index + 1}</strong>
                  {findings.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => setFindings((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                    >
                      Remove
                    </button>
                  ) : null}
                </header>
                <label>
                  <span>Title</span>
                  <input
                    value={finding.title}
                    onChange={(event) => updateFinding(index, "title", event.target.value)}
                    maxLength={240}
                    required
                  />
                </label>
                <div className="human-review-finding-pair">
                  <label>
                    <span>Severity</span>
                    <select value={finding.severity} onChange={(event) => updateFinding(index, "severity", event.target.value)}>
                      <option value="high">High</option>
                      <option value="medium">Medium</option>
                      <option value="low">Low</option>
                    </select>
                  </label>
                  <label>
                    <span>Focus</span>
                    <select value={finding.focusArea} onChange={(event) => updateFinding(index, "focusArea", event.target.value)}>
                      {check.focusAreas.map((area) => <option key={area} value={area}>{area === "seo" ? "SEO" : area}</option>)}
                    </select>
                  </label>
                </div>
                <label>
                  <span>Observed evidence</span>
                  <textarea
                    value={finding.evidence}
                    onChange={(event) => updateFinding(index, "evidence", event.target.value)}
                    maxLength={600}
                    rows={2}
                    required
                  />
                </label>
                <label>
                  <span>Suggested repair</span>
                  <textarea
                    value={finding.suggestedRepair}
                    onChange={(event) => updateFinding(index, "suggestedRepair", event.target.value)}
                    maxLength={600}
                    rows={2}
                    required
                  />
                </label>
                <label>
                  <span>Element or selector <small>optional</small></span>
                  <input
                    value={finding.element}
                    onChange={(event) => updateFinding(index, "element", event.target.value)}
                    maxLength={200}
                    placeholder="e.g. header nav or button.primary"
                  />
                </label>
              </section>
            ))}
            {findings.length < 3 ? (
              <button
                type="button"
                onClick={() => setFindings((current) => [
                  ...current,
                  emptyBrowserFinding(check.focusAreas[0]),
                ])}
              >
                Add another finding
              </button>
            ) : null}
          </fieldset>
        ) : null}

        {outcome === "issue" && !findingsAllowed ? (
          <p className="human-review-contract-note">
            This is an exact verification replay. “Issue found” means the retained symptom is still present; it does not create a new finding.
          </p>
        ) : null}

        <div className="human-review-submit">
          <p>
            <ShieldCheck size={15} weight="duotone" aria-hidden="true" />
            Your evidence is marked person-reported and stays separate from provider measurement.
          </p>
          <button type="submit" disabled={busy}>
            {busy ? "Recording…" : "Record this exact check"}
          </button>
        </div>
        {notice ? <p className="human-review-notice" role="status">{notice}</p> : null}
      </form>
    </details>
  );
}

function BrowserReviewMission({ auditId, state, review, verification = null, webMcp, onChanged }) {
  const titleId = useId();
  const [opening, setOpening] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [confirmWithdrawal, setConfirmWithdrawal] = useState(false);
  const [actionNotice, setActionNotice] = useState("");
  const replay = verification?.browserReplay;
  const replays = verification?.browserReplays?.length
    ? verification.browserReplays
    : replay?.required ? [replay] : [];
  const verificationGuardrails = verification?.browserGuardrails ?? [];
  const exactReplay = replays.length > 0;
  const verificationReplay = exactReplay || verificationGuardrails.length > 0;
  const verificationChecks = [
    ...replays,
    ...verificationGuardrails,
  ];
  const completedVerificationChecks = verificationChecks.filter((check) => check.status === "complete").length;
  const verificationFallbackState = {
    required: verificationReplay,
    status: verificationChecks.length && completedVerificationChecks === verificationChecks.length
      ? "complete"
      : verificationChecks.some((check) => check.status === "blocked")
        ? "blocked"
        : verificationChecks.some((check) => check.status === "in-progress")
          ? "in-progress"
          : "not-opened",
    requestedCheckCount: verificationChecks.length,
    completedCheckCount: completedVerificationChecks,
  };
  const webMcpReady = webMcp?.supported === true && webMcp?.status === "ready";
  const reviewState = verificationReplay
    ? review?.purpose === "verification"
      ? { required: true, ...review.state }
      : verificationFallbackState
    : state?.browserReview;
  if (!reviewState?.required && reviewState?.status !== "withdrawn") return null;
  const adoptedFromHumanMission = !verificationReplay && (
    reviewState.adoptedFromHumanMission || review?.adoption?.mode === "human-to-agent"
  );
  const resultByCheck = new Map((review?.results ?? []).map((result) => [result.checkId, result]));
  const complete = reviewState.status === "complete";
  const blocked = reviewState.status === "blocked";
  const withdrawn = reviewState.status === "withdrawn";
  const statusLabel = complete
    ? verificationReplay
      ? review?.results?.some((result) => result.outcome === "issue")
        ? "Rendered regression observed"
        : "Rendered comparisons passed"
      : "Browser contribution complete"
    : withdrawn
      ? "Handoff withdrawn · no evidence"
    : blocked
      ? "Browser check blocked honestly"
      : reviewState.status === "not-opened"
        ? "Waiting for the agent"
        : "Rendered review in progress";
  const refreshAfterStale = async () => {
    await auditService.refreshMissionWorkspace(auditId);
    const currentReview = auditService.getBrowserReview(auditId);
    if (currentReview) onChanged(currentReview);
  };
  const openHumanReview = async () => {
    setOpening(true);
    setActionNotice("");
    try {
      const opened = await auditService.openBrowserReview(auditId, {
        source: "person",
        focusAreas: state.requestedFocusAreas,
      });
      onChanged(opened);
    } catch (cause) {
      if (cause?.code === "MISSION_REVISION_STALE") {
        try {
          await refreshAfterStale();
          setActionNotice("Mission changed in another session. The current review was refreshed.");
        } catch {
          setActionNotice("Mission changed in another session. Refresh this audit before continuing.");
        }
      } else {
        setActionNotice(cause instanceof AuditError ? cause.message : "The rendered review could not be opened.");
      }
    } finally {
      setOpening(false);
    }
  };
  const withdrawHandoff = async () => {
    setWithdrawing(true);
    setActionNotice("");
    try {
      const updated = await auditService.withdrawBrowserReview(auditId, review.id);
      onChanged(updated);
      setConfirmWithdrawal(false);
    } catch (cause) {
      if (cause?.code === "MISSION_REVISION_STALE") {
        try {
          await refreshAfterStale();
          setActionNotice("Mission changed in another session. The current review was refreshed; check it before withdrawing.");
        } catch {
          setActionNotice("Mission changed in another session. Refresh this audit before continuing.");
        }
      } else {
        setActionNotice(cause instanceof AuditError ? cause.message : "This handoff could not be withdrawn.");
      }
    } finally {
      setWithdrawing(false);
    }
  };

  return (
    <section className={`browser-review-mission ${withdrawn ? "withdrawn" : complete ? "complete" : blocked ? "blocked" : "active"}`} aria-labelledby={titleId}>
      <header>
        <span aria-hidden="true"><Browser size={20} weight="duotone" /></span>
        <div>
          <p className="kicker">
            {verificationReplay
              ? "Fresh browser replay · shared evidence contract"
              : adoptedFromHumanMission
                ? "Optional rendered review · same audit"
                : "Rendered review · not Lighthouse"}
          </p>
          <h2 id={titleId}>
            {verificationReplay
              ? exactReplay
                ? "Recheck the retained rendered evidence"
                : "Recheck retained browser guardrails"
              : adoptedFromHumanMission
                ? withdrawn
                  ? "Person-started evidence remains provider-only"
                  : "Person-started evidence, extended in the browser"
                : "Rendered evidence, one check at a time"}
          </h2>
          <p>
            {verificationReplay
              ? "Frontmend preserved the original browser evidence and now asks for fresh, like-for-like comparisons after deployment, including every retained journey or reflow guardrail."
              : adoptedFromHumanMission
                ? withdrawn
                  ? "The person ended this untouched handoff before any rendered evidence was recorded. Frontmend retained the record and restored the original completed assessment."
                  : "The original person attribution, audit ID, and provider evidence remain unchanged while a person or agent contributes a bounded rendered-browser layer."
                : "Frontmend asks for the actual page to be inspected in a browser, then keeps those observations separate from provider measurement."}
          </p>
        </div>
        <div className="browser-review-state">
          <strong>{statusLabel}</strong>
          <span>{reviewState.completedCheckCount ?? 0} / {reviewState.requestedCheckCount || (verificationReplay ? verificationChecks.length : "—")} checks</span>
        </div>
      </header>

      {withdrawn ? (
        <div className="browser-review-withdrawn" role="status">
          <CheckCircle size={20} weight="duotone" aria-hidden="true" />
          <div>
            <strong>Optional handoff ended before evidence</strong>
            <p>No browser result was deleted or treated as proof. The visible record remains attached to this audit at revision {auditService.getMissionCheckpoint(auditId)?.missionRevision ?? "—"}.</p>
          </div>
        </div>
      ) : reviewState.status === "not-opened" ? (
        <div className="browser-review-next" role="status">
          {webMcpReady ? <Robot size={18} weight="fill" aria-hidden="true" /> : <Browser size={18} weight="duotone" aria-hidden="true" />}
          <div>
            <strong>{verificationReplay ? `Fresh provider evidence is ready. ${verificationChecks.length} rendered ${verificationChecks.length === 1 ? "comparison remains" : "comparisons remain"}.` : "Provider evidence is ready. Rendered review is next."}</strong>
            <p>{webMcpReady ? <>An agent can call <code>open_browser_review</code>, or you can complete the same task yourself.</> : <>WebMCP is not ready in this browser. Open the bounded task here and complete it yourself.</>} The {verificationReplay ? "verification receipt" : "completed assessment"} stays locked until every required browser check is recorded.</p>
            {!review ? (
              <button type="button" onClick={openHumanReview} disabled={opening}>
                <Browser size={15} weight="duotone" aria-hidden="true" />
                {opening ? "Opening…" : "Open rendered review"}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {!withdrawn && reviewState.withdrawalAvailable ? (
        <div className="browser-review-withdrawal">
          <div>
            <strong>No browser evidence has been recorded</strong>
            <p>You can end this optional handoff and restore the provider-only assessment. The withdrawn record stays visible.</p>
          </div>
          {confirmWithdrawal ? (
            <div>
              <button type="button" onClick={() => setConfirmWithdrawal(false)} disabled={withdrawing}>Keep review</button>
              <button type="button" className="confirm" onClick={withdrawHandoff} disabled={withdrawing}>
                {withdrawing ? "Withdrawing…" : "Confirm withdrawal"}
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmWithdrawal(true)}>Withdraw untouched handoff</button>
          )}
        </div>
      ) : null}

      {exactReplay && replay?.baseline ? (
        <div className="browser-replay-baseline">
          <span>Original observation</span>
          <strong>{replay.baseline.title}</strong>
          <p>{replay.baseline.evidence}</p>
          <code>{replay.baseline.selector} · {replay.baseline.source?.strategy}</code>
        </div>
      ) : null}

      {!withdrawn && review?.requestedChecks?.length ? (
        <ol className="browser-review-checks">
          {review.requestedChecks.map((check, index) => {
            const result = resultByCheck.get(check.id);
            const isCurrent = reviewState.nextCheck?.id === check.id;
            const outcome = result?.outcome ?? (isCurrent ? "current" : "pending");
            return (
              <li key={check.id} className={outcome}>
                <span className="browser-review-number" aria-hidden="true">
                  {result?.outcome === "passed"
                    ? <Check size={14} weight="bold" />
                    : result?.outcome === "issue" || result?.outcome === "blocked"
                      ? <Warning size={14} weight="fill" />
                      : index + 1}
                </span>
                <div>
                  <div className="browser-review-check-heading">
                    <strong>{check.label}</strong>
                    <span>{result ? result.outcome : isCurrent ? "Current browser task" : "Queued"}</span>
                  </div>
                  <p>{result?.summary ?? (isCurrent ? check.instruction : "This check unlocks after the prior browser task is recorded.")}</p>
                  {result?.observations?.length ? (
                    <ul>
                      {result.observations.map((observation) => <li key={observation}>{observation}</li>)}
                    </ul>
                  ) : null}
                  {result?.blockerReason ? <small>Blocker: {result.blockerReason.replaceAll("-", " ")}</small> : null}
                </div>
              </li>
            );
          })}
        </ol>
      ) : null}

      {!withdrawn && reviewState.nextCheck && review ? (
        <section className="browser-review-assignment" aria-label="Current exact browser task">
          <header>
            <div>
              <span>Current exact task</span>
              <strong>{reviewState.nextCheck.label}</strong>
            </div>
            <div>
              <code>{reviewState.nextCheck.target.path}</code>
              <span>{reviewState.nextCheck.target.viewport} viewport</span>
            </div>
          </header>
          <div>
            <article>
              <span>Why now</span>
              <p>{reviewState.nextCheck.trigger.retainedEvidence}</p>
            </article>
            <article>
              <span>What to do</span>
              <strong>{reviewState.nextCheck.assignment.goal}</strong>
              <p>{reviewState.nextCheck.assignment.instructions}</p>
            </article>
            <article>
              <span>What must return</span>
              <p>{reviewState.nextCheck.assignment.completionCriteria}</p>
            </article>
          </div>
          <footer>
            <ShieldCheck size={15} weight="duotone" aria-hidden="true" />
            <span>{reviewState.nextCheck.assignment.boundary}</span>
          </footer>
        </section>
      ) : null}

      {!withdrawn && reviewState.nextCheck && review ? (
        <HumanBrowserReviewForm
          auditId={auditId}
          review={review}
          reviewState={reviewState}
          webMcpReady={webMcpReady}
          onChanged={onChanged}
        />
      ) : null}

      {actionNotice ? <p className="browser-review-action-notice" role="status">{actionNotice}</p> : null}

      <footer>
        <ShieldCheck size={16} weight="duotone" aria-hidden="true" />
        <span>
          <strong>{withdrawn ? "No browser evidence recorded" : verificationReplay ? "Fresh comparisons · separate provenance" : `${reviewState.issueCount} browser-observed ${reviewState.issueCount === 1 ? "issue" : "issues"}`}</strong>
          {withdrawn
            ? "The optional handoff is retained for history but contributes no evidence and grants no authority."
            : verificationReplay
            ? "Each exact replay or guardrail must be observed directly. An issue can keep the original finding present or prove a regression; a blocker keeps the receipt locked and the task resumable."
            : "Person- or agent-reported browser facts can become ranked priorities, but still require repository mapping before repair and never prove deployment or resolution."}
        </span>
      </footer>
    </section>
  );
}

function AgentTakeover({ auditId, state, webMcp, onOpened }) {
  const titleId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!state?.browserReview?.adoptionAvailable) return null;
  const retainedAreas = (state.requestedFocusAreas ?? []).filter(
    (area) => area === "accessibility" || area === "seo",
  );
  const reviewAreas = retainedAreas.length ? retainedAreas : ["accessibility", "seo"];
  const webMcpReady = webMcp?.supported === true && webMcp?.status === "ready";

  const openHandoff = async () => {
    setBusy(true);
    setError("");
    try {
      const review = await auditService.openBrowserReview(auditId, {
        source: "person",
        focusAreas: reviewAreas,
      });
      onOpened(review);
    } catch (cause) {
      const failure = await humanMissionMutationFailure(
        cause,
        auditId,
        "The shared browser handoff could not be opened.",
      );
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="agent-takeover" aria-labelledby={titleId}>
      <span className="agent-takeover-icon" aria-hidden="true">
        <ArrowsOutSimple size={20} weight="duotone" />
      </span>
      <div>
        <p className="kicker">Same audit · optional rendered review</p>
        <h2 id={titleId}>{webMcpReady ? "Continue the audit with an agent" : "Complete rendered review yourself"}</h2>
        <p>
          {webMcpReady
            ? "Hand off to agent without starting over. It can complete the same bounded rendered checks against this retained evidence."
            : "WebMCP is not ready in this browser, so Human mode can open and complete the same bounded rendered tasks directly."}
          {" "}Frontmend keeps the current audit ID, provider evidence, focus, and person attribution.
        </p>
        <div className="agent-takeover-scope" aria-label="Agent takeover scope">
          {reviewAreas.map((area) => <span key={area}>{area === "seo" ? "SEO" : area}</span>)}
          <small>No repair, approval, source, or deployment authority is added.</small>
        </div>
      </div>
      <button type="button" onClick={openHandoff} disabled={busy}>
        {webMcpReady ? <Robot size={17} weight="bold" aria-hidden="true" /> : <Browser size={17} weight="duotone" aria-hidden="true" />}
        {busy ? "Opening review…" : webMcpReady ? "Continue with agent" : "Open rendered review"}
      </button>
      <small className="agent-takeover-boundary">
        Once opened, the receipt stays locked until the rendered checks complete. Before any evidence, you may visibly withdraw the optional handoff; after evidence, complete it or retain an honest blocker.
      </small>
      {error ? <p className="repair-error" role="alert">{error}</p> : null}
    </section>
  );
}

function BrowserFindingProvenance({ finding }) {
  const evidence = finding?.browserReviewEvidence;
  if (!evidence) return null;
  return (
    <section className="browser-finding-provenance" aria-label="Browser review provenance">
      <Browser size={18} weight="duotone" aria-hidden="true" />
      <div>
        <strong>{evidence.provenance === "person-reported-browser" ? "Person-observed browser finding" : "Agent-observed browser finding"}</strong>
        <p>
          Contributed through {evidence.checkLabel ?? evidence.checkId}. This is rendered-browser
          evidence, not a Lighthouse finding or repository diagnosis.
        </p>
      </div>
      <span>{evidence.provenance === "person-reported-browser" ? "Person-reported" : "Agent-reported"}</span>
    </section>
  );
}

function missionEvidenceLabel(value) {
  const labels = {
    "measured-evidence-sufficient": "Measured evidence ready",
    "diagnosis-recommended": "Diagnosis needed",
    "diagnosis-in-progress": "Diagnosis in progress",
    "diagnosis-contributed": "Diagnosis contributed",
    "diagnosis-blocked": "Diagnosis blocked",
    "unsupported-continuation": "No supported continuation",
  };
  return labels[value] ?? "Evidence retained";
}

function AgentCapabilityHandshake({ declaration, checkpoint, webMcp }) {
  const rows = agentCapabilityRows(declaration);
  const negotiation = checkpoint?.capabilityNegotiation ?? null;
  const declarationReady = Boolean(declaration);
  return (
    <section className="agent-capability-handshake" aria-label="Agent capability handshake">
      <header>
        <div>
          <p className="kicker">Division of labour</p>
          <h3>{declarationReady ? "Agent capability handshake" : "Capability handshake pending"}</h3>
        </div>
        <span className={declarationReady ? "declared" : "pending"}>
          {declarationReady ? "Agent-declared · not verified" : webMcp?.supported ? "Awaiting declaration" : "No agent connected"}
        </span>
      </header>
      <ul>
        {rows.map((row) => (
          <li key={row.id} className={declarationReady && row.declared ? "available" : "unavailable"}>
            <span aria-hidden="true">{declarationReady ? row.declared ? "✓" : "—" : "·"}</span>
            <strong>{row.label}</strong>
            <small>{declarationReady ? row.declared ? "Declared available" : "Declared unavailable" : "Not declared"}</small>
          </li>
        ))}
      </ul>
      <footer>
        <p>
          {negotiation?.status === "human-handoff-required"
            ? "The next task needs a capability this agent did not declare, so Frontmend assigned no agent action and kept Human mode available."
            : negotiation?.status === "matched"
              ? "The next task matches this declaration and is compiled for the agent."
              : declarationReady
                ? "Frontmend will compare each future task with this declaration before assigning it."
                : "A compatible agent calls declare_agent_capabilities once, with an explicit true or false for every capability."}
        </p>
        <small>
          Self-report only · revision {checkpoint?.missionRevision ?? "—"} · never grants credentials, repair approval, or deployment authority
        </small>
      </footer>
    </section>
  );
}

function evidenceCapsuleTime(value) {
  if (!Number.isFinite(value)) return "Timestamp unavailable";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function EvidenceCapsuleCard({ capsule }) {
  if (!capsule) return null;
  const targetLabel = capsule.target.selector
    ? `Selector · ${capsule.target.selector}`
    : `Landmark · ${capsule.target.landmark}`;
  return (
    <section className="evidence-capsule" aria-label={`Evidence capsule for ${capsule.title}`}>
      <header>
        <div>
          <p className="kicker">Evidence capsule</p>
          <strong>Priority {capsule.priorityRank} · revision-bound</strong>
        </div>
        <span>Audit r{capsule.auditRevision}</span>
      </header>
      <div className="evidence-capsule-grid">
        <figure className={capsule.screenshot.url ? "has-capture" : "no-capture"}>
          {capsule.screenshot.url ? (
            <img
              src={capsule.screenshot.url}
              alt={`${capsule.screenshot.viewport.label} Lighthouse evidence for ${capsule.title}`}
            />
          ) : (
            <div>
              <Browser size={26} weight="duotone" aria-hidden="true" />
              <span>No provider screenshot captured</span>
            </div>
          )}
          <figcaption>
            <strong>{capsule.screenshot.viewport.label}</strong>
            <span>{capsule.screenshot.source === "lighthouse-audit-capture" ? "Retained Lighthouse capture" : "Evidence remains text-only"}</span>
          </figcaption>
        </figure>
        <div className="evidence-capsule-record">
          <dl>
            <div><dt>Route</dt><dd><code>{capsule.target.route}</code></dd></div>
            <div><dt>Target</dt><dd><code title={targetLabel}>{targetLabel}</code></dd></div>
            <div><dt>Source</dt><dd>{capsule.evidence.source.provider} · {capsule.evidence.source.strategy}</dd></div>
            <div><dt>Observed</dt><dd>{evidenceCapsuleTime(capsule.timestamp)}</dd></div>
          </dl>
          <p>{capsule.evidence.observation}</p>
        </div>
      </div>
      <div className="evidence-capsule-task">
        <span>Exact observation task</span>
        <strong>{capsule.observationTask.label}</strong>
        <p>{capsule.observationTask.instructions}</p>
        <small>
          {capsule.observationTask.viewport} · {capsule.observationTask.requiredCapabilities.join(" + ")}
        </small>
      </div>
      <footer>
        <code>get_active_evidence_capsule</code>
        <span>Reads this selected context without copying an audit or finding ID.</span>
      </footer>
    </section>
  );
}

function evidenceRelationshipLabel(value) {
  const labels = {
    "verified-resolved": "Verified resolved",
    "verified-still-present": "Verified still present",
    "verification-inconclusive": "Verification inconclusive",
    "verification-required": "Verification required",
    "provider-browser-conflict": "Provider/browser conflict",
    "diagnosis-contributed": "Diagnosis contributed",
    "diagnosis-required": "Diagnosis required",
    "browser-confirmed": "Browser confirmed",
    "browser-only": "Browser only",
    "provider-only": "Provider only",
  };
  return labels[value] ?? "Evidence retained";
}

function MissionPriorities({ state, selectedFindingId, onSelect, detailId }) {
  const titleId = useId();
  const rankingLabel = state.rankingStatus === "provisional"
    ? state.pendingRoutes > 0
      ? `${state.pendingRoutes} route${state.pendingRoutes === 1 ? "" : "s"} pending`
      : "Finalising"
    : state.assessmentComplete
      ? "Final"
      : state.status === "blocked"
        ? "Blocked"
        : "Active";
  return (
    <section className="mission-priorities" aria-labelledby={titleId}>
      <header>
        <div>
          <p className="kicker">Mission priorities</p>
          <h3 id={titleId}>
            {state.priorityCount
              ? `${state.priorityCount} ranked ${state.priorityCount === 1 ? "priority" : "priorities"}`
              : "No matching failed rules"}
          </h3>
        </div>
        <span>{rankingLabel}</span>
      </header>
      {state.priorities.length ? (
        <ol>
          {state.priorities.map((priority) => (
            <li key={priority.findingId}>
              <button
                type="button"
                className={priority.findingId === selectedFindingId ? "selected" : ""}
                aria-pressed={priority.findingId === selectedFindingId}
                aria-controls={detailId}
                onClick={() => onSelect(priority.findingId)}
              >
                <span className="mission-priority-rank">{priority.rank}</span>
                <span className="mission-priority-copy">
                  <strong>{priority.title}</strong>
                  <small>
                    {priority.evidenceProvenance === "agent-reported-browser"
                      ? "agent browser"
                      : priority.evidenceProvenance === "person-reported-browser"
                        ? "person browser"
                      : priority.affectedStrategies.length
                      ? priority.affectedStrategies.join(" + ")
                      : "document"}
                    {priority.occurrenceCount > 1 ? ` · ${priority.occurrenceCount} occurrences` : ""}
                  </small>
                  <span className="evidence-relationship-copy">
                    <b>{evidenceRelationshipLabel(priority.relationship)}</b>
                    {priority.relationshipReason}
                  </span>
                </span>
                <em className={`evidence-state ${priority.evidenceState}`}>
                  {missionEvidenceLabel(priority.evidenceState)}
                </em>
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p>
          The requested focus has no supported failed rule in this run. Scores remain automated
          evidence, not a complete manual audit.
        </p>
      )}
      <small className="mission-priorities-boundary">
        {state.priorityRanking?.reason ?? "Ranked by the retained mission."} The complete bounded
        evidence queue remains below.
      </small>
    </section>
  );
}

function PrepareRepairIntent({ auditId, priority, priorities, mission, preparedFindingTitle }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [packageIds, setPackageIds] = useState(() => priority ? [priority.findingId] : []);
  const selectedPriorityId = priority?.findingId ?? null;
  const preparedFindingId = mission.repairPreparation?.findingId ?? null;
  const preparedFindingIds = mission.repairPreparation?.findingIds ?? (preparedFindingId ? [preparedFindingId] : []);
  const selectedIsPrepared = preparedFindingIds.includes(selectedPriorityId);
  const retainedPriorities = priorities ?? (priority ? [priority] : []);
  useEffect(() => {
    if (!preparedFindingId && selectedPriorityId) setPackageIds([selectedPriorityId]);
  }, [preparedFindingId, selectedPriorityId]);
  if (!priority) return null;
  const prepare = async () => {
    setBusy(true);
    setError("");
    try {
      const retainedIds = packageIds.includes(priority.findingId)
        ? [priority.findingId, ...packageIds.filter((id) => id !== priority.findingId)]
        : [priority.findingId];
      await auditService.prepareRepair(auditId, retainedIds[0], "human", undefined, retainedIds);
    } catch (cause) {
      const failure = await humanMissionMutationFailure(
        cause,
        auditId,
        "Repair intent could not be recorded.",
      );
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`prepare-repair-intent ${selectedIsPrepared ? "prepared" : ""}`} aria-label="Prepare repair intent">
      <span aria-hidden="true"><Wrench size={20} weight="duotone" /></span>
      <div>
        <p className="kicker">Human intent gate</p>
        <strong>
          {selectedIsPrepared
            ? preparedFindingIds.length > 1
              ? `This finding is in a ${preparedFindingIds.length}-finding package`
              : "This finding is being prepared"
            : preparedFindingId
              ? `Already preparing ${preparedFindingTitle ?? "another finding"}`
              : "Want an implementation-ready fix?"}
        </strong>
        <p>
          {selectedIsPrepared
            ? "The agent may prepare one bounded package draft when every required diagnosis is ready. Approval and deployment remain separate."
            : preparedFindingId
              ? "One audit mission freezes one exact repair package. Start a new assessment to choose a different scope."
              : "Prepare a fix records this priority and up to two related priorities as one immutable package. It does not approve code, change auto mode, or deploy anything."}
        </p>
      </div>
      {!preparedFindingId && retainedPriorities.length > 1 ? (
        <fieldset className="repair-package-picker">
          <legend>Optional cohesive package</legend>
          {retainedPriorities.map((candidate) => {
            const primary = candidate.findingId === priority.findingId;
            const checked = primary || packageIds.includes(candidate.findingId);
            return (
              <label key={candidate.findingId}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={primary || busy || (!checked && packageIds.length >= 3)}
                  onChange={() => setPackageIds((current) => checked
                    ? current.filter((id) => id !== candidate.findingId)
                    : [...current, candidate.findingId].slice(0, 3))}
                />
                <span>{candidate.title}</span>
                <small>{primary ? "Primary" : candidate.relationship?.replaceAll("-", " ")}</small>
              </label>
            );
          })}
          <small>Choose only findings owned by one repository change. Package scope freezes when intent is recorded.</small>
        </fieldset>
      ) : null}
      {!preparedFindingId ? (
        <button type="button" onClick={prepare} disabled={busy}>
          <ClipboardText size={17} weight="bold" />
          {busy ? "Recording…" : "Prepare a fix"}
        </button>
      ) : null}
      {error ? <p className="repair-error" role="alert">{error}</p> : null}
    </section>
  );
}

function formatProfileBytes(value) {
  if (!Number.isFinite(value)) return "—";
  return value < 1_024 ? `${value} B` : `${Math.max(1, Math.round(value / 1_024))} KB`;
}

function DocumentProfile({ url, profile }) {
  if (!profile) {
    return (
      <section className="document-evidence document-evidence-legacy" aria-label={`Live document evidence for ${url}`}>
        <Browser size={42} weight="duotone" aria-hidden="true" />
        <strong>Live HTML inspected</strong>
        <span>Document structure and response headers were read from this public URL.</span>
      </section>
    );
  }
  const metrics = [
    ["HTML read", formatProfileBytes(profile?.htmlBytes)],
    ["Scripts", profile?.elements?.scripts ?? "—"],
    ["Stylesheets", profile?.elements?.stylesheets ?? "—"],
    ["Images", profile?.elements?.images ?? "—"],
    ["Links", profile?.elements?.links ?? "—"],
    ["External origins", profile?.externalOrigins?.length ?? "—"],
  ];
  return (
    <section className="document-evidence" aria-label={`Live document profile for ${url}`}>
      <div className="document-profile-heading">
        <Browser size={36} weight="duotone" aria-hidden="true" />
        <div>
          <strong>Live document profile</strong>
          <span>Bounded HTML structure and response headers from this public URL.</span>
        </div>
      </div>
      <dl className="document-profile-metrics">
        {metrics.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="document-profile-signals" aria-label="Observed response headers">
        <span className={profile?.headers?.contentSecurityPolicy ? "observed" : "missing"}>
          CSP {profile?.headers?.contentSecurityPolicy ? "observed" : "missing"}
        </span>
        <span className={profile?.headers?.nosniff ? "observed" : "missing"}>
          nosniff {profile?.headers?.nosniff ? "observed" : "missing"}
        </span>
        {Number.isFinite(profile?.inline?.scripts) ? (
          <span>{profile.inline.scripts} inline script{profile.inline.scripts === 1 ? "" : "s"}</span>
        ) : null}
      </div>
      <p>{profile?.caveat ?? "No screenshot or viewport measurement is claimed for this fallback."}</p>
    </section>
  );
}

function BrowserPreview({ url, viewport, selectedFinding, documentProfile, panelId, labelledBy }) {
  const isDocumentEvidence = viewport.id === "document";
  return (
    <div
      className={`browser-preview viewport-${viewport.id}`}
      id={panelId}
      role="tabpanel"
      aria-labelledby={labelledBy}
      tabIndex="0"
    >
      <div className="browser-toolbar">
        <span className="traffic-lights" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="browser-address">{url}</span>
        <ArrowsOutSimple size={16} aria-hidden="true" />
      </div>
      <div className="frame-stage">
        {viewport.evidenceUrl ? (
          <img
            className="captured-evidence"
            src={viewport.evidenceUrl}
            alt={`${viewport.label} Lighthouse capture of ${url}`}
          />
        ) : isDocumentEvidence ? (
          <DocumentProfile url={url} profile={documentProfile} />
        ) : (
          <iframe title={`Live ${viewport.label} preview of ${url}`} src={url} sandbox="" />
        )}
        <div className="frame-notice">
          {viewport.evidenceUrl ? "Measured capture" : isDocumentEvidence ? "Document evidence" : "Live embed"}
          <span>
            {viewport.evidenceUrl
              ? "Captured during this Lighthouse run."
              : isDocumentEvidence
                ? "No screenshot or viewport measurement is claimed for this fallback."
              : "Target framing policies may block this preview."}
          </span>
        </div>
        {selectedFinding ? (
          <div className={`issue-marker marker-${selectedFinding.severity}`} aria-hidden="true">
            <span>1</span>
            {selectedFinding.category}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SeverityIcon({ severity }) {
  return severity === "high" ? (
    <Warning size={17} weight="fill" aria-hidden="true" />
  ) : (
    <Info size={17} weight="fill" aria-hidden="true" />
  );
}

function CspResourceInventory({ context }) {
  if (context?.type !== "csp-resource-inventory") return null;
  const directives = Array.isArray(context.directives) ? context.directives : [];
  const inlineScripts = Number.isFinite(context.inline?.scripts) ? context.inline.scripts : 0;
  const inlineStyles = Number.isFinite(context.inline?.styles) ? context.inline.styles : 0;
  return (
    <section className="csp-inventory" aria-labelledby="csp-inventory-title">
      <div className="csp-inventory-heading">
        <span aria-hidden="true"><ShieldCheck size={18} weight="duotone" /></span>
        <div>
          <p className="kicker">Observed policy inputs</p>
          <strong id="csp-inventory-title">Resource-origin inventory</strong>
        </div>
        <em>Static HTML</em>
      </div>
      {directives.length ? (
        <dl>
          {directives.map((record) => (
            <div key={record.directive}>
              <dt>{record.directive}</dt>
              <dd>
                {record.origins.map((origin) => <code key={origin}>{origin}</code>)}
                {record.omitted ? <small>+{record.omitted} more</small> : null}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="csp-inventory-empty">No external HTTP origins were present in the fetched markup.</p>
      )}
      <div className="csp-inline-summary">
        <span>{inlineScripts} inline script{inlineScripts === 1 ? "" : "s"}</span>
        <span>{inlineStyles} inline style block/attribute{inlineStyles === 1 ? "" : "s"}</span>
      </div>
      <p className="csp-caveat">{context.caveat}</p>
    </section>
  );
}

function ObservedRoutes({ auditId, profile, onAuditRoute }) {
  const routes = Array.isArray(profile?.routes) ? profile.routes : [];
  const [busyPath, setBusyPath] = useState("");
  const [error, setError] = useState("");
  if (!routes.length) return null;

  const startRoute = async (path) => {
    setBusyPath(path);
    setError("");
    try {
      await onAuditRoute(path);
    } catch (cause) {
      const failure = await humanMissionMutationFailure(
        cause,
        auditId,
        "Frontmend could not start an audit for that observed route.",
      );
      setError(failure.message);
      setBusyPath("");
    }
  };

  return (
    <section className="observed-routes" aria-labelledby="observed-routes-title">
      <div className="observed-routes-heading">
        <span aria-hidden="true"><LinkSimple size={19} weight="duotone" /></span>
        <div>
          <p className="kicker">Site exploration</p>
          <h2 id="observed-routes-title">Routes observed on this page</h2>
          <p>Continue from public, same-site links in the measured document.</p>
        </div>
      </div>
      <div className="observed-route-list">
        {routes.map((path) => (
          <button
            type="button"
            key={path}
            onClick={() => startRoute(path)}
            disabled={Boolean(busyPath)}
            aria-label={`Audit observed route ${path}`}
          >
            <code>{path}</code>
            <span>{busyPath === path ? "Starting…" : "Audit route"}</span>
            <ArrowRight size={15} weight="bold" aria-hidden="true" />
          </button>
        ))}
      </div>
      <p className="observed-routes-note">
        {profile.routesCaveat}
        {profile.routesOmitted > 0
          ? ` ${profile.routesOmitted} additional route${profile.routesOmitted === 1 ? " was" : "s were"} omitted.`
          : ""}
      </p>
      {error ? <p className="repair-error" role="alert">{error}</p> : null}
    </section>
  );
}

function RouteJourney({ exploration, currentPath }) {
  if (!exploration?.parentAuditId || !Number.isFinite(exploration.depth)) return null;
  const trail = Array.isArray(exploration.trail) ? exploration.trail.slice(0, 5) : [];

  return (
    <section className="route-journey" aria-labelledby="route-journey-title">
      <div className="route-journey-copy">
        <span aria-hidden="true"><Browser size={20} weight="duotone" /></span>
        <div>
          <p className="kicker">Route journey · depth {exploration.depth}</p>
          <h2 id="route-journey-title">How this page was reached</h2>
          <p>Each hop was started from a same-site path observed by the completed parent audit.</p>
        </div>
      </div>
      <ol className="route-journey-trail" aria-label="Audit route lineage">
        {trail.map((entry, index) => (
          <li key={`${entry.auditId}-${index}`}>
            <a href={auditWorkspacePath(entry.auditId)} title={`Open parent audit ${entry.auditId}`}>
              <span>{index === 0 ? "Root" : `Hop ${index}`}</span>
              <code>{entry.path}</code>
            </a>
            <ArrowRight size={14} weight="bold" aria-hidden="true" />
          </li>
        ))}
        <li className="current" aria-current="page">
          <span>Current</span>
          <code>{exploration.observedPath ?? currentPath}</code>
        </li>
      </ol>
      <p className="route-journey-boundary">
        Provenance only: the trail records linked public audits, not navigation coverage beyond each fetched document.
      </p>
    </section>
  );
}

function distinctIssuePageCount(issue) {
  if (Number.isInteger(issue?.distinctPageCount)) return issue.distinctPageCount;
  return new Set((issue?.occurrences ?? []).map((occurrence) => occurrence.auditId || occurrence.path)).size;
}

function SiteExploration({ report, mission }) {
  const candidates = createSiteRouteCandidates(report).slice(0, mission.routeLimit);
  const [selected, setSelected] = useState([]);
  const [explorations, setExplorations] = useState(() =>
    auditService.getSiteExplorations(report.auditId),
  );
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState("");
  const [readError, setReadError] = useState("");
  const [isRefreshingStatus, setIsRefreshingStatus] = useState(false);
  const [pollAttempt, setPollAttempt] = useState(0);
  const current = explorations[0] ?? null;

  useEffect(() => {
    let active = true;
    let timer;
    let collectionLoaded = false;
    const sync = () => {
      if (active) setExplorations([...auditService.getSiteExplorations(report.auditId)]);
    };
    const unsubscribe = auditService.subscribe(sync);
    const poll = async () => {
      if (!active) return;
      setIsRefreshingStatus(true);
      try {
        if (!collectionLoaded) {
          await auditService.listSiteExplorations(report.auditId);
          collectionLoaded = true;
        } else {
          const mission = auditService.getSiteExplorations(report.auditId)[0];
          if (mission && ["queued", "running"].includes(mission.status)) {
            await auditService.getSiteExploration(report.auditId, mission.id);
          }
        }
        if (!active) return;
        sync();
        setReadError("");
        timer = window.setTimeout(poll, 900);
      } catch (cause) {
        if (!active) return;
        setReadError(
          cause instanceof AuditError
            ? cause.message
            : "Frontmend could not refresh this exploration status.",
        );
        timer = window.setTimeout(poll, 3_000);
      } finally {
        if (active) setIsRefreshingStatus(false);
      }
    };
    void poll();
    return () => {
      active = false;
      unsubscribe();
      window.clearTimeout(timer);
    };
  }, [pollAttempt, report.auditId]);

  if (!candidates.length) return null;

  const toggleCandidate = (candidateId) => {
    setError("");
    setSelected((items) => {
      if (items.includes(candidateId)) return items.filter((item) => item !== candidateId);
      return items.length < mission.routeLimit ? [...items, candidateId] : items;
    });
  };

  const start = async () => {
    if (!selected.length) return;
    setIsStarting(true);
    setError("");
    try {
      await auditService.startSiteExploration(
        report.auditId,
        { routeCandidateIds: selected },
        "human",
      );
      setSelected([]);
      setReadError("");
      setPollAttempt((attempt) => attempt + 1);
    } catch (cause) {
      const failure = await humanMissionMutationFailure(
        cause,
        report.auditId,
        "Frontmend could not start this site exploration.",
      );
      if (failure.stale) setSelected([]);
      setError(failure.message);
    } finally {
      setIsStarting(false);
    }
  };

  const retryStatus = () => {
    if (isRefreshingStatus) return;
    setPollAttempt((attempt) => attempt + 1);
  };

  const terminal = current && ["complete", "partial", "failed"].includes(current.status);

  return (
    <section className="site-exploration" aria-labelledby="site-exploration-title">
      <div className="site-exploration-intro">
        <div className="site-exploration-heading">
          <span aria-hidden="true"><MagnifyingGlass size={20} weight="duotone" /></span>
          <div>
            <p className="kicker">Cross-page evidence</p>
            <h2 id="site-exploration-title">Explore a small part of this site</h2>
            <p>Select up to three observed routes. Frontmend audits each page separately and groups recurring issues.</p>
          </div>
        </div>
        <div className="site-exploration-guardrails" aria-label="Exploration guardrails">
          <span>1–3 routes</span>
          <span>Server validated</span>
          <span>Not a full crawl</span>
        </div>
      </div>

      <div className="site-route-picker" aria-label="Select routes for site exploration">
        {candidates.map((candidate) => {
          const active = selected.includes(candidate.id);
          const unavailable = !active && selected.length >= mission.routeLimit;
          return (
            <button
              type="button"
              key={candidate.id}
              aria-pressed={active}
              disabled={unavailable || isStarting}
              onClick={() => toggleCandidate(candidate.id)}
            >
              <span aria-hidden="true">{active ? <Check size={13} weight="bold" /> : null}</span>
              <code>{candidate.path}</code>
              <small>{candidate.source === "observed-document-route" ? "document" : "rendered + server checked"}</small>
            </button>
          );
        })}
      </div>
      <div className="site-exploration-actions">
        <button type="button" onClick={start} disabled={!selected.length || isStarting}>
          <Pulse size={16} weight="duotone" aria-hidden="true" />
          {isStarting
            ? "Starting mission…"
            : selected.length
              ? `Explore ${selected.length} selected route${selected.length === 1 ? "" : "s"}`
              : "Select routes to explore"}
        </button>
        <p>Every page keeps its own audit ID and evidence boundary.</p>
      </div>
      {error ? <p className="repair-error" role="alert">{error}</p> : null}
      {readError ? (
        <div className="site-exploration-read-warning" role="alert">
          <Warning size={18} weight="fill" aria-hidden="true" />
          <div>
            <strong>Exploration status temporarily unavailable</strong>
            <p>
              {readError}{" "}
              {current
                ? "The last confirmed mission remains visible and has not been marked failed."
                : "No mission was created or marked failed by this read error."}
            </p>
            <small>Frontmend retries automatically. Retry status now only reads the retained exploration.</small>
          </div>
          <button type="button" onClick={retryStatus} disabled={isRefreshingStatus}>
            {isRefreshingStatus ? "Refreshing…" : "Retry status now"}
          </button>
        </div>
      ) : null}

      {current ? (
        <article className={`site-mission site-mission-${current.status}`} aria-live="polite">
          <header>
            <div>
              <p className="kicker">Latest mission · {current.status}</p>
              <h3>{current.status === "complete" ? "Cross-page evidence ready" : "Selected pages are being audited"}</h3>
            </div>
            <strong>{current.progress}%</strong>
          </header>
          <progress
            className="site-mission-progress"
            max="100"
            value={current.progress}
            aria-label={`Exploration ${current.progress}% complete`}
          />
          <div className="site-mission-metrics">
            <span><strong>{current.summary.pagesComplete}</strong>/{current.summary.pagesRequested}<small>Pages complete</small></span>
            <span><strong>{current.summary.totalFindings}</strong><small>Findings observed</small></span>
            <span><strong>{current.summary.recurringIssues}</strong><small>Recurring issues</small></span>
          </div>
          <div className="site-mission-pages">
            {current.pages.map((page) => (
              <a key={page.position} href={page.workspacePath ?? undefined} aria-disabled={!page.workspacePath}>
                <span>{page.status}</span>
                <code>{page.path}</code>
                <small>{page.score === null ? `${page.progress}%` : `Score ${page.score}`}</small>
              </a>
            ))}
          </div>
          {current.issues.length ? (
            <div className="cross-page-issues">
              <p className="kicker">Cross-page patterns</p>
              {current.issues.slice(0, 5).map((issue) => (
                <div key={`${issue.provider}-${issue.ruleId}-${issue.title}`}>
                  <span>
                    {issue.occurrenceCount} occurrence{issue.occurrenceCount === 1 ? "" : "s"}
                    {" · "}
                    {distinctIssuePageCount(issue)} page{distinctIssuePageCount(issue) === 1 ? "" : "s"}
                  </span>
                  <strong>{issue.title}</strong>
                  <small>{issue.provider} · {issue.ruleId}</small>
                </div>
              ))}
            </div>
          ) : null}
          <footer>
            <p>{current.caveat}</p>
            {terminal ? (
              <a href={auditService.getSiteExplorationReportUrl(report.auditId, current.id)} download>
                <DownloadSimple size={15} weight="bold" aria-hidden="true" />
                Export exploration
              </a>
            ) : null}
          </footer>
        </article>
      ) : null}
    </section>
  );
}

function caseSourceStatus(report, pattern, fallback = "unavailable") {
  const adapters = Array.isArray(report.coverage?.adapters) ? report.coverage.adapters : [];
  const adapter = adapters.find((item) => pattern.test(`${item.adapterId ?? ""} ${item.provider ?? ""}`));
  return adapter?.status ?? fallback;
}

function caseStatusLabel(value) {
  if (typeof value !== "string" || !value) return "Unavailable";
  const label = value.replaceAll("-", " ");
  return `${label[0].toUpperCase()}${label.slice(1)}`;
}

function CaseSectionMarker({ number, label }) {
  return (
    <p className="case-section-marker" aria-hidden="true">
      <span>{number}</span>
      {label}
    </p>
  );
}

function CaseFileIndex({ report, mission }) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  const documentStatus = caseSourceStatus(
    report,
    /document/i,
    report.coverage?.sources?.document?.status,
  );
  const lighthouseStatus = caseSourceStatus(
    report,
    /lighthouse|pagespeed/i,
    report.coverage?.sources?.lighthouse?.status,
  );
  const contents = [
    ["01", "Mission", "case-mission"],
    ["02", "Evidence", "case-evidence"],
    ["03", "Summary", "case-summary"],
    ["04", "Finding", "case-finding"],
    ["05", "Next step", "case-next-step"],
  ];

  return (
    <aside className="case-file-index" aria-label="Audit case index" data-expanded={expanded ? "true" : "false"}>
      <button
        className="case-file-index-toggle"
        type="button"
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setExpanded((current) => !current)}
      >
        <span>
          <strong>Case index</strong>
          <small>{report.auditId.slice(0, 8).toUpperCase()} · 5 sections</small>
        </span>
        <ArrowRight size={16} weight="bold" aria-hidden="true" />
      </button>
      <div className="case-file-index-content" id={contentId}>
        <p className="kicker">Case index</p>
        <dl>
          <div>
            <dt>Audit</dt>
            <dd>{report.auditId.slice(0, 8).toUpperCase()}</dd>
          </div>
          <div>
            <dt>Type</dt>
            <dd>{mission.requestedFocusAreas?.length ? "Focused assessment" : "Full frontend audit"}</dd>
          </div>
          <div>
            <dt>Initiated by</dt>
            <dd>{mission.requestedBy === "agent" ? "Agent-started" : "Person-started"}</dd>
          </div>
          <div>
            <dt>Scope</dt>
            <dd>{mission.scope === "bounded-site" ? "Bounded site" : "This public page"}</dd>
          </div>
        </dl>
        <nav aria-label="Case file contents">
          <p className="kicker">Contents</p>
          {contents.map(([number, label, id]) => (
            <a key={id} href={`#${id}`}>
              <span>{number}</span>
              {label}
            </a>
          ))}
        </nav>
      </div>
    </aside>
  );
}

export default function ReportWorkspace({ audit, webMcp, onReset, onVerify, onAuditRoute }) {
  const report = audit.report;
  const isDocumentAudit = report.engine.mode === "live-document";
  const isHybridAudit = report.engine.mode === "hybrid-lighthouse-document";
  const isCombinedAudit = report.engine.mode === "live-lighthouse-document";
  const isDocumentUnavailable = report.engine.mode === "live-lighthouse-document-unavailable";
  const isPartialLighthouse = report.engine.mode === "live-lighthouse-partial";
  const evidenceLabel = isDocumentAudit
    ? "live document evidence"
    : isCombinedAudit
      ? "Lighthouse + document evidence"
    : isHybridAudit
      ? "partial Lighthouse + document evidence"
      : isDocumentUnavailable
        ? "Lighthouse evidence · document unavailable"
      : isPartialLighthouse
        ? "partial Lighthouse evidence"
        : "live Lighthouse evidence";
  const viewportFailures = Array.isArray(report.viewportFailures) ? report.viewportFailures : [];
  const viewports = report.viewports?.length ? report.viewports : VIEWPORTS;
  const [viewportId, setViewportId] = useState(
    viewports.find((item) => item.id === "mobile")?.id ?? viewports[0]?.id,
  );
  const viewportPanelId = useId();
  const viewportTabIdPrefix = useId();
  const findingDetailId = useId();
  const findingDetailTitleId = useId();
  const [repairs, setRepairs] = useState(() => auditService.getRepairs(report.auditId));
  const [diagnosticMissions, setDiagnosticMissions] = useState(() => auditService.getDiagnosticMissions(report.auditId));
  const [browserReview, setBrowserReview] = useState(() => auditService.getBrowserReview(report.auditId));
  const [siteExplorations, setSiteExplorations] = useState(() => auditService.getSiteExplorations(report.auditId));
  const [repairPolicy, setRepairPolicy] = useState(() => auditService.getRepairPolicy(report.auditId));
  const [agentCapabilities, setAgentCapabilities] = useState(() => auditService.getAgentCapabilities(report.auditId));
  const restoredWorkspacePartial = audit.missionWorkspace?.status === "partial";
  const [workspaceReadError, setWorkspaceReadError] = useState(
    restoredWorkspacePartial
      ? "The persisted audit evidence was restored, but not every mission record could be read coherently."
      : "",
  );
  const [workspaceUnavailable, setWorkspaceUnavailable] = useState(
    restoredWorkspacePartial ? [...(audit.missionWorkspace?.unavailable ?? [])] : [],
  );
  const [isRefreshingWorkspace, setIsRefreshingWorkspace] = useState(false);
  const [workspaceRefreshAttempt, setWorkspaceRefreshAttempt] = useState(0);
  const mission = retainedAuditMission(audit);
  const missionState = deriveAuditMissionState({
    report,
    mission,
    diagnosticMissions,
    repairs,
    browserReview,
    explorations: siteExplorations,
  });
  const findings = useMemo(
    () => assessmentFindings(report, browserReview, siteExplorations),
    [report, browserReview, siteExplorations],
  );
  const missionPriorityFindings = missionState.priorities
    .map((priority) => findings.find((finding) => finding.id === priority.findingId))
    .filter(Boolean);
  const displayedFindings = missionPriorityFindings;
  const retainedObservationCount = Number.isFinite(missionState.matchingFindingCount)
    ? missionState.matchingFindingCount
    : findings.length;
  const [selectedFindingId, setSelectedFindingId] = useState(
    () => displayedFindings[0]?.id ?? null,
  );
  const [shareState, setShareState] = useState("idle");
  const shareInputRef = useRef(null);
  const [handoffState, setHandoffState] = useState("idle");
  const handoffInputRef = useRef(null);
  const shareUrl = new URL(auditWorkspacePath(report.auditId), window.location.origin).href;
  const missionCheckpoint = auditService.getMissionCheckpoint(report.auditId);
  const agentHandoff = missionCheckpoint
    ? createFreshAgentHandoff(missionCheckpoint, window.location.origin)
    : null;
  const viewport = viewports.find((item) => item.id === viewportId) ?? viewports[0];
  const selectedFinding =
    findings.find((finding) => finding.id === selectedFindingId) ?? findings[0];
  const selectedFindingScope = selectedFinding
    ? findings.filter(
        (finding) =>
          finding.source?.provider === selectedFinding.source?.provider &&
          finding.source?.auditId === selectedFinding.source?.auditId,
      )
    : [];
  const selectedRepair = repairs.find((repair) => (repair.findingIds ?? [repair.findingId]).includes(selectedFinding?.id)) ?? null;
  const selectedDiagnosticMission = diagnosticMissions.find((mission) => mission.findingId === selectedFinding?.id) ?? null;
  const selectedPriority = missionState.priorities.find(
    (priority) => priority.findingId === selectedFinding?.id,
  ) ?? null;
  const evidenceCapsules = useMemo(() => createEvidenceCapsules({
    audit,
    report,
    missionState,
    findings,
    browserReview,
  }), [audit, report, missionState, findings, browserReview]);
  const selectedEvidenceCapsule = evidenceCapsules.find(
    (capsule) => capsule.findingId === selectedFinding?.id,
  ) ?? null;
  const preparedFindingId = mission.repairPreparation?.findingId ?? null;
  const preparedFindingIds = mission.repairPreparation?.findingIds ?? (preparedFindingId ? [preparedFindingId] : []);
  const preparedFinding = findings.find((finding) => finding.id === preparedFindingId) ?? null;
  const preparedFindings = preparedFindingIds.map((id) => findings.find((finding) => finding.id === id)).filter(Boolean);
  const selectedRepairPrepared = preparedFindingIds.includes(selectedFinding?.id);
  const selectedDiagnosticReady = selectedRepairPrepared
    ? mission.repairPreparation?.requestedBy === "agent"
      ? preparedFindings.every((finding) =>
          diagnosticMissions.find((item) => item.findingId === finding.id)?.state?.state === "ready-for-repair")
      : preparedFindings.every((finding) => !findingRequiresDiagnosticMission(finding)
        || diagnosticMissions.find((item) => item.findingId === finding.id)?.state?.state === "ready-for-repair")
    : selectedFinding
      ? !findingRequiresDiagnosticMission(selectedFinding) || selectedDiagnosticMission?.state?.state === "ready-for-repair"
      : false;
  const agentRepositoryTracePending = Boolean(
    selectedRepairPrepared
    && mission.repairPreparation?.requestedBy === "agent"
    && !selectedDiagnosticReady,
  );
  const repairReadyPriorities = missionState.priorities.filter((priority) =>
    findings.some((item) => item.id === priority.findingId));
  const omittedFindingCount = Math.max(
    0,
    Number.isFinite(report.findingsOmitted)
      ? report.findingsOmitted
      : (report.findingCount ?? report.findings.length) - report.findings.length,
  );
  const summaryHeadline = displayedFindings.length === 0
    ? "No mission priority needs attention."
    : `${displayedFindings.length} mission ${displayedFindings.length === 1 ? "priority" : "priorities"} from ${retainedObservationCount} retained ${retainedObservationCount === 1 ? "observation" : "observations"}.`;
  const assessmentStatusLabel = missionState.assessmentComplete
    ? "Evidence final"
    : missionState.status === "blocked"
      ? "Assessment blocked · evidence retained"
      : "Assessment in progress";

  useEffect(() => {
    let active = true;
    let retryTimer;
    const refresh = () => {
      if (active) {
        setRepairs([...auditService.getRepairs(report.auditId)]);
        setDiagnosticMissions([...auditService.getDiagnosticMissions(report.auditId)]);
        setBrowserReview(auditService.getBrowserReview(report.auditId));
        setSiteExplorations([...auditService.getSiteExplorations(report.auditId)]);
        setRepairPolicy(auditService.getRepairPolicy(report.auditId));
        setAgentCapabilities(auditService.getAgentCapabilities(report.auditId));
      }
    };
    const unsubscribe = auditService.subscribe(refresh);
    const readWorkspace = async () => {
      if (!active) return;
      setIsRefreshingWorkspace(true);
      try {
        const result = await auditService.refreshMissionWorkspace(report.auditId, {
          publishOnlyWhenComplete: true,
        });
        if (!active) return;
        if (result.published !== true) {
          setWorkspaceUnavailable(result.unavailable ?? []);
          setWorkspaceReadError(
            result.unavailable?.length
              ? "Frontmend could not refresh every retained mission record."
              : "The mission workspace changed before its refresh could be published.",
          );
          retryTimer = window.setTimeout(readWorkspace, 3_000);
          return;
        }
        refresh();
        setWorkspaceUnavailable([]);
        setWorkspaceReadError("");
      } catch (cause) {
        if (!active) return;
        setWorkspaceUnavailable(
          cause instanceof AuditError && Array.isArray(cause.details?.requirements)
            ? cause.details.requirements.map((requirement) => requirement.artifact).filter(Boolean)
            : [],
        );
        setWorkspaceReadError(
          cause instanceof AuditError
            ? cause.message
            : "Frontmend could not refresh the retained mission details.",
        );
        retryTimer = window.setTimeout(readWorkspace, 3_000);
      } finally {
        if (active) setIsRefreshingWorkspace(false);
      }
    };
    void readWorkspace();
    return () => {
      active = false;
      unsubscribe();
      window.clearTimeout(retryTimer);
    };
  }, [report.auditId, workspaceRefreshAttempt]);

  useEffect(() => {
    if (displayedFindings.length && !displayedFindings.some((finding) => finding.id === selectedFindingId)) {
      setSelectedFindingId(displayedFindings[0].id);
    }
  }, [displayedFindings, selectedFindingId]);

  useEffect(() => {
    if (!selectedPriority?.findingId) return;
    auditService.setActiveEvidenceFinding(report.auditId, selectedPriority.findingId);
  }, [report.auditId, selectedPriority?.findingId]);

  const rememberRepair = (repair) => {
    setRepairs((current) => [...current.filter((item) => item.id !== repair.id), repair]);
    setRepairPolicy(auditService.getRepairPolicy(report.auditId));
  };

  const retryMissionWorkspace = () => {
    if (isRefreshingWorkspace) return;
    setWorkspaceRefreshAttempt((attempt) => attempt + 1);
  };

  const selectFinding = (findingId) => {
    const finding = findings.find((item) => item.id === findingId);
    if (!finding) return;
    setSelectedFindingId(finding.id);
    if (missionState.priorities.some((priority) => priority.findingId === finding.id)) {
      auditService.setActiveEvidenceFinding(report.auditId, finding.id);
    }
    if (finding.source?.strategy) setViewportId(finding.source.strategy);
  };
  const selectViewportFromKeyboard = (event, index) => {
    const lastIndex = viewports.length - 1;
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? lastIndex
        : event.key === "ArrowRight" || event.key === "ArrowDown"
          ? (index + 1) % viewports.length
          : event.key === "ArrowLeft" || event.key === "ArrowUp"
            ? (index - 1 + viewports.length) % viewports.length
            : null;
    if (nextIndex === null) return;
    event.preventDefault();
    setViewportId(viewports[nextIndex].id);
    const tabs = event.currentTarget.parentElement?.querySelectorAll('[role="tab"]');
    window.requestAnimationFrame(() => tabs?.[nextIndex]?.focus());
  };

  const copyShareLink = async () => {
    setHandoffState("idle");
    try {
      if (typeof navigator.clipboard?.writeText !== "function") throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(shareUrl);
      setShareState("copied");
      window.setTimeout(() => setShareState("idle"), 1_600);
    } catch {
      setShareState("manual");
      window.requestAnimationFrame(() => {
        shareInputRef.current?.focus();
        shareInputRef.current?.select();
      });
    }
  };

  const copyAgentHandoff = async () => {
    if (!agentHandoff) return;
    setShareState("idle");
    try {
      if (typeof navigator.clipboard?.writeText !== "function") throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(agentHandoff.prompt);
      setHandoffState("copied");
      window.setTimeout(() => setHandoffState("idle"), 1_600);
    } catch {
      setHandoffState("manual");
      window.requestAnimationFrame(() => {
        handoffInputRef.current?.focus();
        handoffInputRef.current?.select();
      });
    }
  };

  return (
    <section className="report-view" aria-labelledby="report-title">
      <div className="report-heading">
        <div className="report-heading-copy">
          <p className="report-case-label">Audit case file</p>
          <h1 id="report-title">{report.hostname}</h1>
          <p className="report-heading-state">
            <CheckCircle size={18} weight="fill" aria-hidden="true" />
            {assessmentStatusLabel}
          </p>
          <p className="report-heading-evidence">
            {report.verification ? "Fresh verification measurement" : "Measurement retained"} · {evidenceLabel}
          </p>
        </div>
        <div className="report-nav-actions">
          <button className="back-button" type="button" onClick={onReset}>
            <ArrowLeft size={17} weight="bold" />
            New audit
          </button>
          <button className="share-audit" type="button" onClick={copyShareLink}>
            {shareState === "copied" ? (
              <Check size={16} weight="bold" />
            ) : (
              <LinkSimple size={16} weight="bold" />
            )}
            {shareState === "copied"
              ? "Link copied"
              : shareState === "manual"
                ? "Link shown"
                : "Share"}
          </button>
          <a
            className="share-audit"
            href={auditService.getAuditReportUrl(report.auditId)}
            download
          >
            <DownloadSimple size={16} weight="bold" aria-hidden="true" />
            Export
          </a>
          <details className="report-more-actions">
            <summary className="share-audit">
              <DotsThree size={17} weight="bold" aria-hidden="true" />
              More
            </summary>
            <div>
              {report.exploration?.parentAuditId ? (
                <a href={auditWorkspacePath(report.exploration.parentAuditId)}>
                  <ArrowLeft size={16} weight="bold" aria-hidden="true" />
                  Parent audit
                </a>
              ) : null}
              {agentHandoff ? (
                <button type="button" onClick={copyAgentHandoff}>
                  {handoffState === "copied" ? (
                    <Check size={16} weight="bold" aria-hidden="true" />
                  ) : (
                    <PaperPlaneTilt size={16} weight="bold" aria-hidden="true" />
                  )}
                  {handoffState === "copied"
                    ? "Handoff copied"
                    : handoffState === "manual"
                      ? "Handoff shown"
                      : "Copy agent handoff"}
                </button>
              ) : null}
              {!report.verification && missionState.assessmentComplete ? (
                <a
                  href={auditService.getAssessmentReceiptUrl(report.auditId)}
                  download
                >
                  <ClipboardText size={16} weight="bold" aria-hidden="true" />
                  Export assessment
                </a>
              ) : null}
            </div>
          </details>
        </div>
      </div>

      {workspaceReadError ? (
        <div className="mission-workspace-read-warning" role="alert">
          <Warning size={19} weight="fill" aria-hidden="true" />
          <div>
            <strong>{restoredWorkspacePartial ? "Evidence restored · mission actions paused" : "Mission details temporarily unavailable"}</strong>
            <p>
              {workspaceReadError}
              {workspaceUnavailable.length
                ? ` Waiting for ${workspaceUnavailable.map((item) => item === "browserReview"
                  ? "browser review"
                  : item === "diagnostics"
                    ? "diagnosis"
                    : item === "repairs"
                      ? "repairs and policy"
                      : item).join(", ")}.`
                : ""}
            </p>
            <small>
              {restoredWorkspacePartial
                ? "This persisted report remains readable in a fail-closed mode. Frontmend retries automatically; no mission action is replayed or allowed until every record is coherent."
                : "The last coherent mission remains visible. Frontmend retries automatically and never replays an action."}
            </small>
          </div>
          <button type="button" onClick={retryMissionWorkspace} disabled={isRefreshingWorkspace}>
            {isRefreshingWorkspace ? "Refreshing…" : "Retry mission details"}
          </button>
        </div>
      ) : null}

      {shareState === "manual" ? (
        <div className="manual-share" role="status">
          <label htmlFor="manual-share-url">Stable audit link</label>
          <div>
            <input
              ref={shareInputRef}
              id="manual-share-url"
              value={shareUrl}
              readOnly
              onFocus={(event) => event.currentTarget.select()}
            />
            <button
              type="button"
              aria-label="Close stable audit link"
              onClick={() => setShareState("idle")}
            >
              <X size={15} weight="bold" />
            </button>
          </div>
          <small>Clipboard access is unavailable. Copy this reloadable workspace URL manually.</small>
        </div>
      ) : null}

      {handoffState === "manual" && agentHandoff ? (
        <div className="manual-share manual-agent-handoff" role="status">
          <label htmlFor="manual-agent-handoff">Fresh-agent mission handoff</label>
          <div>
            <textarea
              ref={handoffInputRef}
              id="manual-agent-handoff"
              value={agentHandoff.prompt}
              readOnly
              rows={9}
              onFocus={(event) => event.currentTarget.select()}
            />
            <button
              type="button"
              aria-label="Close fresh-agent mission handoff"
              onClick={() => setHandoffState("idle")}
            >
              <X size={15} weight="bold" />
            </button>
          </div>
          <small>
            Clipboard access is unavailable. Copy this bounded prompt manually; the receiving agent must
            open the stable workspace and read its latest checkpoint before acting.
          </small>
        </div>
      ) : null}

      <div className="case-file-layout">
        <CaseFileIndex report={report} mission={mission} />

        <div className="case-file-document">
          <section className="case-file-section" id="case-mission" aria-labelledby="case-mission-title">
            <CaseSectionMarker number="01" label="Mission" />
            <h2 id="case-mission-title">What was measured</h2>
            {/*
             * Plain facts about what happened, not a statement about the
             * integrity of the method. The evidence table below shows
             * "Unavailable" where a source failed; that demonstrates the
             * separation this paragraph used to assert, and a reader trusts the
             * showing far more than the telling.
             */}
            <p className="case-file-lede">
              Frontmend read the public page at {report.hostname}. It did not sign in, run your code, or
              read your repository.
            </p>
            {!missionState.assessmentComplete ? (
              <AuditMissionSummary
                audit={audit}
                diagnosticMissions={diagnosticMissions}
                repairs={repairs}
                browserReview={browserReview}
                missionState={missionState}
              />
            ) : null}
            <AgentCapabilityHandshake
              declaration={agentCapabilities}
              checkpoint={missionCheckpoint}
              webMcp={webMcp}
            />
          </section>

          <section className="case-file-section" id="case-evidence" aria-label="Evidence">
            <CaseSectionMarker number="02" label="Evidence" />
            <EvidenceOverview report={report} missionState={missionState} />
            {missionState.browserReview.adoptionAvailable || !missionState.assessmentComplete ? (
              <div className="case-required-continuation">
                <AgentTakeover
                  auditId={report.auditId}
                  state={missionState}
                  webMcp={webMcp}
                  onOpened={setBrowserReview}
                />
                {!missionState.assessmentComplete ? (
                  <BrowserReviewMission
                    auditId={report.auditId}
                    state={missionState}
                    review={browserReview}
                    verification={report.verification}
                    webMcp={webMcp}
                    onChanged={setBrowserReview}
                  />
                ) : null}
              </div>
            ) : null}
          </section>

          <section className="case-file-section case-file-summary" id="case-summary" aria-labelledby="case-summary-title">
            <CaseSectionMarker number="03" label="Summary" />
            <h2 id="case-summary-title">{summaryHeadline}</h2>
            <p className="case-summary-note">
              {report.checks.passed} of {report.checks.passed + report.findingCount} checks passed.
            </p>
            {!missionState.assessmentComplete ? (
              <div className="summary-row" aria-label="Audit summary">
                <div>
                  <span className="metric-good">{report.checks.passed}</span>
                  <small>Checks passed</small>
                </div>
                <div>
                  <span>{retainedObservationCount}</span>
                  <small>Retained observations</small>
                </div>
                <div>
                  <span>{report.viewportCount}</span>
                  <small>Viewports measured</small>
                </div>
                <p>{report.engine.notice}</p>
              </div>
            ) : null}
            {viewportFailures.length ? (
              <section className="viewport-failures" aria-labelledby="viewport-failures-title">
                <Warning size={19} weight="fill" aria-hidden="true" />
                <div>
                  <strong id="viewport-failures-title">Partial viewport evidence retained</strong>
                  <p>
                    Some viewport measurements did not complete. The ones that did are listed below, and the
                    rest can be retried.
                  </p>
                  <ul>
                    {viewportFailures.map((failure) => (
                      <li key={failure.id}>
                        <span>{failure.label}</span>
                        <code>{failure.code}</code>
                        <small>{failure.message}</small>
                      </li>
                    ))}
                  </ul>
                  {report.documentSupplement ? (
                    <small className="document-supplement-note">
                      {report.documentSupplement.evaluatedRuleCount} non-overlapping document rules added · {report.documentSupplement.overlappingRulesOmitted} overlapping rules omitted from totals. Document evidence does not replace viewport or rendered-browser evidence.
                    </small>
                  ) : null}
                </div>
              </section>
            ) : null}
          </section>

          {report.verification ? (
            <div className="case-file-verification">
              <LazyWorkspace
                load={loadVerificationWorkspace}
                label="verification evidence workspace"
                resetKey={`${report.auditId}:verification:${audit.missionRevision ?? 1}`}
                componentProps={{ verification: report.verification }}
              />
            </div>
          ) : null}

          <section className="case-file-section case-file-finding" id="case-finding" aria-labelledby="case-finding-title">
            <CaseSectionMarker number="04" label="Finding" />
            <h2 id="case-finding-title">What needs attention</h2>
            <div className="workspace-grid">
              <aside className={`findings-panel ${displayedFindings.length === 1 ? "single-finding" : ""}`} aria-label="Audit mission priorities">
                <div className="findings-heading">
                  <div>
                    <p className="kicker">Mission priorities</p>
                    <h3>{displayedFindings.length === 1 ? "1 recommended priority" : `${displayedFindings.length} mission priorities`}</h3>
                    <small>{retainedObservationCount} retained observations grouped by rule and evidence source</small>
                  </div>
                  <span>{displayedFindings.length}/{retainedObservationCount}</span>
                </div>
                <div className="finding-list">
                  {displayedFindings.map((finding, index) => {
                    const priority = missionState.priorities.find((item) => item.findingId === finding.id);
                    const occurrenceCount = priority?.occurrenceCount ?? 1;
                    return (
                      <button
                        type="button"
                        key={finding.id}
                        className={finding.id === selectedFindingId ? "selected" : ""}
                        aria-pressed={finding.id === selectedFindingId}
                        aria-controls={findingDetailId}
                        onClick={() => selectFinding(finding.id)}
                      >
                        <span className={`finding-index ${finding.severity}`}>{priority?.rank ?? index + 1}</span>
                        <span className="finding-copy">
                          <small>{index === 0 ? "Recommended first" : `Priority ${priority?.rank ?? index + 1}`} · {finding.category}</small>
                          <strong>{finding.title}</strong>
                          <em>
                            {occurrenceCount} {occurrenceCount === 1 ? "observation" : "grouped observations"}
                            {priority?.affectedStrategies?.length ? ` · ${priority.affectedStrategies.join(" + ")}` : ""}
                          </em>
                        </span>
                        <ArrowRight size={16} weight="bold" aria-hidden="true" />
                      </button>
                    );
                  })}
                  {!displayedFindings.length ? (
                    <p className="empty-findings">
                      {missionState.browserReview.required && missionState.browserReview.status !== "complete"
                        ? "No provider failure matched this focus. The rendered-browser review is still active."
                        : "No material failures were found in this completed assessment slice."}
                    </p>
                  ) : null}
                </div>
                {omittedFindingCount > 0 ? (
                  <p className="findings-omitted" role="note">
                    Showing the {report.findings.length} highest-priority findings. {omittedFindingCount} additional
                    measured failure{omittedFindingCount === 1 ? " remains" : "s remain"} in the explicit
                    rule-outcome record and export.
                  </p>
                ) : null}
                {missionState.priorities.length ? (
                  <details className="case-priority-details">
                    <summary>Why this order</summary>
                    <MissionPriorities
                      state={missionState}
                      selectedFindingId={selectedFindingId}
                      onSelect={selectFinding}
                      detailId={findingDetailId}
                    />
                  </details>
                ) : null}
              </aside>

              <div className="preview-column">
                {selectedFinding ? (
                  <article
                    className="finding-detail"
                    id={findingDetailId}
                    aria-labelledby={findingDetailTitleId}
                    aria-live="polite"
                  >
                    <div className="finding-detail-heading">
                      <span className={`severity-badge ${selectedFinding.severity}`}>
                        <SeverityIcon severity={selectedFinding.severity} />
                        {selectedFinding.severity} · {selectedFinding.category} · {selectedFinding.viewport}
                      </span>
                    </div>
                    <h2 id={findingDetailTitleId}>{selectedFinding.title}</h2>
                    <p>{selectedFinding.summary}</p>
                    <EvidenceCapsuleCard capsule={selectedEvidenceCapsule} />
                    {selectedFinding && selectedRepairPrepared && (
                      selectedDiagnosticMission
                      || findingRequiresDiagnosticMission(selectedFinding)
                      || mission.repairPreparation?.requestedBy === "agent"
                    ) ? (
                      <LazyWorkspace
                        load={loadDiagnosisWorkspace}
                        label="repository diagnosis workspace"
                        resetKey={`${report.auditId}:diagnosis:${selectedFinding.id}:${audit.missionRevision ?? 1}`}
                        variant="inline"
                        componentProps={{
                          mode: "mission",
                          auditId: report.auditId,
                          finding: selectedFinding,
                          mission: selectedDiagnosticMission,
                          webMcp,
                        }}
                      />
                    ) : null}
                    {selectedFindingScope.length > 1 ? (
                      <section className="finding-scope" aria-label="Cross-viewport finding scope">
                        <div>
                          <span>Repair scope</span>
                          <strong>{selectedFindingScope.length} measured occurrences</strong>
                        </div>
                        <ul>
                          {selectedFindingScope.map((occurrence) => (
                            <li key={occurrence.id}>
                              <span>{occurrence.viewport}</span>
                              <code title={occurrence.selector}>{occurrence.selector}</code>
                            </li>
                          ))}
                        </ul>
                        <p>One repository change may own several failures; verify every listed strategy.</p>
                      </section>
                    ) : null}
                    <dl>
                      <div>
                        <dt>Evidence retained</dt>
                        <dd>{selectedFinding.evidence}</dd>
                      </div>
                      <div>
                        <dt>Suggested repair</dt>
                        <dd>{selectedFinding.repair}</dd>
                      </div>
                    </dl>
                    <BrowserFindingProvenance finding={selectedFinding} />
                    {selectedFinding.diagnosticEvidence ? (
                      <details className="case-diagnostic-evidence">
                        <summary>
                          <span>Inspect measured evidence</span>
                          <small>Selectors, snippets, and raw measurements</small>
                        </summary>
                        <LazyWorkspace
                          load={loadDiagnosisWorkspace}
                          label="diagnostic evidence workspace"
                          resetKey={`${report.auditId}:evidence:${selectedFinding.id}`}
                          variant="inline"
                          componentProps={{ mode: "evidence", evidence: selectedFinding.diagnosticEvidence }}
                        />
                      </details>
                    ) : null}
                    <CspResourceInventory context={selectedFinding.repairContext} />
                  </article>
                ) : null}
                <details className="case-preview-disclosure">
                  <summary>
                    <span>Inspect page evidence</span>
                    <small>Open the retained document or viewport view</small>
                  </summary>
                  <div>
                    <div className="viewport-tabs" role="tablist" aria-label="Preview viewport">
                      {viewports.map((item, index) => {
                        const Icon = item.icon
                          ?? (item.id === "mobile" ? DeviceMobile : item.id === "document" ? Browser : Desktop);
                        const tabId = `${viewportTabIdPrefix}-${item.id}`;
                        return (
                          <button
                            key={item.id}
                            id={tabId}
                            type="button"
                            role="tab"
                            aria-selected={item.id === viewportId}
                            aria-controls={viewportPanelId}
                            tabIndex={item.id === viewportId ? 0 : -1}
                            className={item.id === viewportId ? "active" : ""}
                            onClick={() => setViewportId(item.id)}
                            onKeyDown={(event) => selectViewportFromKeyboard(event, index)}
                          >
                            <Icon size={17} aria-hidden="true" />
                            <span>{item.label}</span>
                            <small>{item.detail}</small>
                          </button>
                        );
                      })}
                    </div>
                    <BrowserPreview
                      url={report.finalUrl ?? report.url}
                      viewport={viewport}
                      selectedFinding={selectedFinding}
                      documentProfile={report.documentProfile}
                      panelId={viewportPanelId}
                      labelledBy={`${viewportTabIdPrefix}-${viewport.id}`}
                    />
                  </div>
                </details>
              </div>
            </div>
          </section>

          <section className="case-file-section case-file-next-step" id="case-next-step" aria-labelledby="case-next-step-title">
            <CaseSectionMarker number="05" label="Next step" />
            <h2 id="case-next-step-title">
              {selectedFinding
                ? !missionState.assessmentComplete
                  ? "Finish the evidence first"
                  : agentRepositoryTracePending
                    ? "Map the repair to source"
                    : selectedRepairPrepared
                      ? "Prepare a fix"
                      : "Choose whether to repair"
                : "No repair action is required"}
            </h2>
            <p className="case-file-lede">
              {selectedFinding
                ? !missionState.assessmentComplete
                  ? `${missionState.priorityRanking?.reason ?? "The retained assessment is still collecting evidence."} Repair selection stays locked until the ranking is final.`
                  : agentRepositoryTracePending
                    ? "Repair intent is recorded, but the coding agent must now contribute the exact browser reproduction, repository-relative source locations, and checks it actually obtained. No generic patch is staged from guessed ownership."
                    : selectedRepairPrepared
                      ? "Frontmend can record a bounded repair proposal for review. Preparation is not approval, implementation, deployment, or proof that the issue is resolved."
                      : "The audit and ranking are final. Selecting Prepare a fix starts a separate repair phase; only then may Frontmend ask a coding agent for repository-relative diagnosis."
                : "The retained assessment has no ranked repair target. You can still export the evidence or continue with an optional rendered review."}
            </p>
            {selectedFinding && missionState.assessmentComplete ? (
              <PrepareRepairIntent
                auditId={report.auditId}
                priority={selectedPriority}
                priorities={repairReadyPriorities}
                mission={mission}
                preparedFindingTitle={preparedFinding?.title}
              />
            ) : null}
            {(selectedRepairPrepared || selectedRepair) ? (
              <LazyWorkspace
                load={loadRepairWorkspace}
                label="repair and verification workspace"
                resetKey={`${report.auditId}:repair:${selectedFinding?.id ?? "none"}:${audit.missionRevision ?? 1}`}
                variant="inline"
                componentProps={{
                  auditId: report.auditId,
                  finding: selectedRepairPrepared ? preparedFindings[0] : selectedFinding,
                  findings: selectedRepairPrepared ? preparedFindings : [selectedFinding].filter(Boolean),
                  repair: selectedRepair,
                  repairPrepared: selectedRepairPrepared,
                  diagnosticReady: selectedDiagnosticReady,
                  onRepairChange: rememberRepair,
                  onVerify,
                }}
              />
            ) : null}
          </section>

          <details className="case-file-continuation" open={!missionState.assessmentComplete}>
            <summary>
              <span>Continue this audit</span>
              <small>Browser handoff, review policy, observed routes, site exploration, and exports</small>
            </summary>
            <div>
              {missionState.assessmentComplete ? (
                <BrowserReviewMission
                  auditId={report.auditId}
                  state={missionState}
                  review={browserReview}
                  verification={report.verification}
                  webMcp={webMcp}
                  onChanged={setBrowserReview}
                />
              ) : null}
              {findings.length && (repairReadyPriorities.length || preparedFindingIds.length || repairs.length) ? (
                <LazyWorkspace
                  load={loadRepairPolicyWorkspace}
                  label="repair policy workspace"
                  resetKey={`${report.auditId}:policy:${audit.missionRevision ?? 1}`}
                  variant="inline"
                  componentProps={{
                    auditId: report.auditId,
                    policy: repairPolicy,
                    onPolicyChange: setRepairPolicy,
                  }}
                />
              ) : null}
              <RouteJourney
                exploration={report.exploration}
                currentPath={new URL(report.finalUrl ?? report.url).pathname}
              />
              <ObservedRoutes
                auditId={report.auditId}
                profile={report.documentProfile}
                onAuditRoute={onAuditRoute}
              />
              <SiteExploration report={report} mission={mission} />
            </div>
          </details>

          <p className="case-file-authority">
            <ShieldCheck size={18} weight="duotone" aria-hidden="true" />
            <span>Agent may investigate and prepare. <strong>Only a person may approve or deploy.</strong></span>
          </p>
        </div>
      </div>
    </section>
  );
}
