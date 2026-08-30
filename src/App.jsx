import {
  ArrowLeft,
  ArrowRight,
  Browser,
  Check,
  CheckCircle,
  DeviceMobile,
  Info,
  MagnifyingGlass,
  Pulse,
  Robot,
  ShieldCheck,
  Sparkle,
  Warning,
  Wrench,
  X,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AuditError, auditService } from "./audit-service.js";
import { AUDIT_FOCUS_AREAS, createAuditMission } from "./audit-mission-contract.js";
import { AuditMissionSummary } from "./ui/AuditMissionSummary.jsx";
import { humanMissionMutationFailure } from "./ui/human-mission-recovery.js";
import { LazyWorkspace } from "./ui/LazyWorkspace.jsx";
import { useDialogFocus } from "./ui/use-dialog-focus.js";
import {
  contextualFrontmendToolNames,
  registerFrontmendTools,
} from "./webmcp.js";

const LANDING_SIGNALS = [
  { label: "Live measurement", detail: "Mobile + desktop", state: "warn", icon: DeviceMobile },
  { label: "Agent browser", detail: "Rendered checks", state: "neutral", icon: Robot },
  { label: "Fresh proof", detail: "Before + after", state: "good", icon: CheckCircle },
];
const HOW_IT_WORKS_STEPS = [
  {
    label: "01",
    title: "Measure the live URL",
    detail: "Retain mobile, desktop, and document evidence with its provider and limits attached.",
  },
  {
    label: "02",
    title: "Inspect what automation misses",
    detail: "WebMCP gives the agent one exact rendered-browser check at a time, then maps real issues to repository ownership.",
  },
  {
    label: "03",
    title: "Review the fix, then prove it",
    detail: "The site owner controls approval and deployment; Frontmend reruns the exact rule and exports the fresh receipt.",
  },
];
const AUDIT_FOCUS_COPY = Object.freeze({
  accessibility: { label: "Accessibility", detail: "Semantics, names, contrast" },
  seo: { label: "SEO", detail: "Discovery and page signals" },
  performance: { label: "Performance", detail: "Loading and main-thread cost" },
  security: { label: "Security", detail: "Public response safeguards" },
  reliability: { label: "Reliability", detail: "Runtime and delivery failures" },
});
const HUMAN_AUDIT_FOCUS_OPTIONS = AUDIT_FOCUS_AREAS.map((id) => ({
  id,
  ...AUDIT_FOCUS_COPY[id],
}));
const WEBMCP_TOOL_COUNT = 21;
const loadReportWorkspace = () => import("./workspaces/ReportWorkspace.jsx");
const loadWebMcpCapabilitySheet = () => import("./workspaces/WebMcpCapabilitySheet.jsx");

function auditIdFromPathname(pathname) {
  const match = pathname.match(
    /^\/audits\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/?$/i,
  );
  return match?.[1] ?? null;
}

function auditWorkspacePath(auditId) {
  return `/audits/${encodeURIComponent(auditId)}`;
}

function staticRouteFromPathname(pathname) {
  const route = pathname.replace(/\/+$/, "") || "/";
  return route === "/how-it-works" ? "how-it-works" : null;
}

function Brand({ onClick }) {
  return (
    <button className="brand" type="button" aria-label="Frontmend home" onClick={onClick}>
      <span className="brand-symbol" aria-hidden="true">
        <Wrench size={17} weight="bold" />
      </span>
      <span>Frontmend</span>
    </button>
  );
}

function WebMcpStatus({ status, expanded, restoring, onClick, buttonRef }) {
  const ready = status.status === "ready";
  const failed = status.status === "error";
  const activeCount = status.activeTools ?? status.toolNames.length;
  const totalCount = status.totalTools ?? WEBMCP_TOOL_COUNT;
  const label = restoring
    ? "WebMCP · restoring"
    : ready
      ? `WebMCP · ${status.toolNames.length} active`
      : status.status === "registering"
        ? "WebMCP · syncing"
        : failed
          ? `WebMCP · ${status.toolNames.length}/${activeCount} active`
          : "Human mode";
  const accessibleLabel = restoring
    ? "WebMCP tools paused while Frontmend restores authoritative audit state"
    : ready
      ? `WebMCP ready with ${status.toolNames.length} contextual tools active from a library of ${totalCount}`
      : failed
        ? `WebMCP registration incomplete: ${status.toolNames.length} of ${activeCount} contextual tools available`
        : status.status === "registering"
          ? "Synchronizing contextual WebMCP tools"
          : "WebMCP unavailable; human mode active";

  return (
    <button
      ref={buttonRef}
      type="button"
      className={`webmcp-status ${ready && !restoring ? "ready" : ""} ${failed && !restoring ? "error" : ""}`}
      title={
        restoring
          ? "Contextual tools resume after authoritative state is restored."
          : status.errors?.join("\n") || undefined
      }
      aria-label={accessibleLabel}
      aria-expanded={restoring ? false : expanded}
      aria-controls="webmcp-mission-inspector"
      aria-haspopup="dialog"
      disabled={restoring}
      onClick={onClick}
    >
      <span className="status-dot" aria-hidden="true" />
      <span role="status" aria-live="polite">{label}</span>
    </button>
  );
}

function AgentActivityDrawer({ activities, onClose, onClear }) {
  const dialogRef = useDialogFocus(onClose);
  return (
    <div className="agent-activity-backdrop" role="presentation" onMouseDown={onClose}>
      <aside
        ref={dialogRef}
        id="agent-activity-drawer"
        tabIndex="-1"
        className="agent-activity-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-activity-title"
        aria-describedby="agent-activity-boundary"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="agent-activity-heading">
          <div>
            <p className="kicker">Browser agent</p>
            <h2 id="agent-activity-title">WebMCP activity</h2>
          </div>
          <button type="button" aria-label="Close agent activity" onClick={onClose}>
            <X size={18} weight="bold" />
          </button>
        </div>
        <p className="agent-activity-boundary" id="agent-activity-boundary">
          Semantic actions only. Tool inputs, URLs, patches, prompts, and secrets are not logged here.
        </p>
        {activities.length ? (
          <ol className="agent-activity-list">
            {activities.map((activity) => (
              <li key={activity.id} className={`agent-activity-${activity.status}`}>
                <span className="agent-activity-icon" aria-hidden="true">
                  {activity.status === "succeeded" ? (
                    <Check size={13} weight="bold" />
                  ) : activity.status === "failed" ? (
                    <Warning size={13} weight="fill" />
                  ) : (
                    <Pulse size={13} weight="bold" />
                  )}
                </span>
                <div>
                  <strong>{activity.title}</strong>
                  <code>{activity.tool}</code>
                  <small>
                    {activity.status}
                    {activity.auditId ? ` · audit ${activity.auditId.slice(0, 8)}` : ""}
                    {activity.repairId ? ` · repair ${activity.repairId.slice(0, 8)}` : ""}
                    {activity.errorCode ? ` · ${activity.errorCode}` : ""}
                  </small>
                </div>
                <time dateTime={new Date(activity.startedAt).toISOString()}>
                  {new Date(activity.startedAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </time>
              </li>
            ))}
          </ol>
        ) : (
          <div className="agent-activity-empty">
            <Robot size={25} weight="duotone" aria-hidden="true" />
            <strong>No agent actions yet</strong>
            <p>When a browser agent uses a Frontmend tool, its lifecycle will appear here.</p>
          </div>
        )}
        {activities.length ? (
          <button className="clear-agent-activity" type="button" onClick={onClear}>
            Clear session activity
          </button>
        ) : null}
      </aside>
    </div>
  );
}

function HowItWorks({ onClose }) {
  const dialogRef = useDialogFocus(onClose);
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        id="how-it-works-dialog"
        tabIndex="-1"
        className="how-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="how-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="icon-button close-button" type="button" onClick={onClose} aria-label="Close">
          <X size={18} weight="bold" />
        </button>
        <p className="kicker">The Frontmend loop</p>
        <h2 id="how-title">Measure. Inspect. Prove it held.</h2>
        <ol className="how-list">
          {HOW_IT_WORKS_STEPS.map((step) => (
            <li key={step.label}>
              <span>{step.label}</span>
              <div>
                <strong>{step.title}</strong>
                <p>{step.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function HowItWorksPage() {
  return (
    <section className="how-page" aria-labelledby="how-page-title">
      <div className="how-page-card">
        <div className="how-page-heading">
          <div>
            <p className="kicker">The Frontmend loop</p>
            <h1 id="how-page-title">Measure. Inspect. Prove it held.</h1>
          </div>
          <p>
            Frontmend keeps provider, browser, repository, and verification evidence separate,
            so every next step says what is known and what still needs proof.
          </p>
        </div>
        <ol className="how-list how-page-list">
          {HOW_IT_WORKS_STEPS.map((step) => (
            <li key={step.label}>
              <span>{step.label}</span>
              <div>
                <strong>{step.title}</strong>
                <p>{step.detail}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="how-page-boundary">
          <ShieldCheck size={23} weight="duotone" aria-hidden="true" />
          <p>
            <strong>The authority boundary stays visible.</strong>
            Agents can measure, investigate, and prepare reviewable work. A person retains repair
            intent, approval, deployment, and deployment attestation.
          </p>
        </div>
        <a className="how-page-cta" href="/">
          Start a site audit
          <ArrowRight size={18} weight="bold" aria-hidden="true" />
        </a>
      </div>
    </section>
  );
}

function Landing({
  value,
  setValue,
  onSubmit,
  error,
  inputRef,
  isSubmitting,
  focusAreas,
  maxPriorities,
  onToggleFocus,
  onMaxPrioritiesChange,
}) {
  const focusSummary = focusAreas.length
    ? focusAreas.map((area) => AUDIT_FOCUS_COPY[area]?.label ?? area).join(" + ")
    : "Full frontend audit";
  return (
    <section className="landing" aria-labelledby="landing-title">
      <div className="landing-copy">
        <p className="kicker">Provider evidence + agent-observed browser review</p>
        <h1 id="landing-title">Where does your site break?</h1>
        <p className="landing-intro">
          Paste a public URL. Frontmend combines live measurement with rendered-browser evidence,
          then carries the strongest accessibility and SEO issues into reviewable fixes and fresh proof.
        </p>

        <form className="site-search" onSubmit={onSubmit} noValidate>
          <Browser size={23} weight="regular" aria-hidden="true" />
          <label className="sr-only" htmlFor="site-url">
            Public website URL
          </label>
          <input
            ref={inputRef}
            id="site-url"
            inputMode="url"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="removemyexif.com"
            autoComplete="url"
            spellCheck="false"
            aria-invalid={Boolean(error)}
            aria-describedby="site-url-message"
          />
          <button
            className="search-submit"
            type="submit"
            aria-label={isSubmitting ? "Starting website audit" : "Audit this website"}
            disabled={isSubmitting}
          >
            <ArrowRight size={23} weight="bold" />
          </button>
        </form>

        <details className="audit-composer">
          <summary>
            <span>
              <strong>Shape this assessment</strong>
              <small>Optional · the full evidence record stays available</small>
            </span>
            <em>{focusSummary} · top {maxPriorities}</em>
          </summary>
          <div className="audit-composer-body">
            <fieldset>
              <legend>
                Focus areas
                <small>Choose up to three</small>
              </legend>
              <div className="audit-focus-options">
                {HUMAN_AUDIT_FOCUS_OPTIONS.map((option) => {
                  const selected = focusAreas.includes(option.id);
                  const unavailable = !selected && focusAreas.length >= 3;
                  return (
                    <label key={option.id} data-selected={selected ? "true" : "false"}>
                      <input
                        type="checkbox"
                        value={option.id}
                        checked={selected}
                        disabled={unavailable || isSubmitting}
                        onChange={() => onToggleFocus(option.id)}
                      />
                      <span>
                        <strong>{option.label}</strong>
                        <small>{option.detail}</small>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <label className="priority-limit" htmlFor="priority-limit">
              <span>
                <strong>Mission shortlist</strong>
                <small>Rank this many priorities for the shared workspace</small>
              </span>
              <select
                id="priority-limit"
                value={maxPriorities}
                disabled={isSubmitting}
                onChange={(event) => onMaxPrioritiesChange(Number(event.target.value))}
              >
                {[1, 2, 3, 4, 5].map((count) => (
                  <option value={count} key={count}>Top {count}</option>
                ))}
              </select>
            </label>
          </div>
        </details>

        <div className="example-row">
          <button
            type="button"
            className="example-chip"
            onClick={() => setValue("removemyexif.com")}
          >
            <Sparkle size={14} weight="fill" aria-hidden="true" />
            Try removemyexif.com
          </button>
          <span className="privacy-note">
            <ShieldCheck size={14} weight="duotone" aria-hidden="true" />
            Public pages only
          </span>
          <a className="guide-link" href="/how-it-works">
            <Info size={14} weight="bold" aria-hidden="true" />
            How Frontmend works
          </a>
        </div>

        <p
          id="site-url-message"
          className={`search-message ${error ? "error" : ""}`}
          role={error ? "alert" : "status"}
          aria-live={error ? "assertive" : "polite"}
          aria-atomic="true"
        >
          {error ||
            (isSubmitting ? "Starting the live audit…" : "No account needed for the first audit.")}
        </p>
      </div>

      <ul className="signal-stage" aria-label="Frontmend audit capabilities">
        {LANDING_SIGNALS.map((signal, index) => {
          const Icon = signal.icon;
          return (
            <li className={`signal-card signal-${index + 1}`} key={signal.label}>
              <span className={`signal-icon ${signal.state}`}>
                <Icon size={18} weight="duotone" aria-hidden="true" />
              </span>
              <span>
                <strong>{signal.label}</strong>
                <small>{signal.detail}</small>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function AuditProgress({
  audit,
  onCancelAudit,
  onLeave,
  onRetry,
  onRetryStatus,
  isRetrying,
  isRefreshingStatus,
  isCancelling,
  cancelError,
  pollError,
}) {
  const stages = [
    { id: "capture", label: "Capture", icon: Browser },
    { id: "inspect", label: "Inspect", icon: MagnifyingGlass },
    { id: "verify", label: "Verify", icon: CheckCircle },
  ];
  const phaseIndex = Math.max(0, stages.findIndex((stage) => stage.id === audit.phase));

  if (["failed", "cancelled"].includes(audit.status)) {
    const cancelled = audit.status === "cancelled";
    return (
      <section className="progress-view" aria-labelledby="progress-title">
        <button className="back-button" type="button" onClick={onLeave}>
          <ArrowLeft size={17} weight="bold" />
          New audit
        </button>
        <div className="progress-card audit-failure">
          <div className="audit-orbit" aria-hidden="true">
            <Warning size={31} weight="duotone" />
          </div>
          <p className="kicker">Live audit stopped · attempt {audit.attempt ?? 1}</p>
          <h1 id="progress-title">
            {cancelled ? "Audit cancelled" : "The evidence provider could not finish"}
          </h1>
          <p className="audit-url">{audit.url}</p>
          <p className="failure-message">
            {cancelled
              ? "The provider request was stopped and no audit result was produced."
              : audit.error?.message ?? "Try this public URL again shortly."}
          </p>
          <div className="failure-actions">
            <button className="retry-audit" type="button" onClick={onRetry} disabled={isRetrying}>
              <Pulse size={17} weight="bold" />
              {isRetrying ? "Starting fresh attempt…" : "Try this URL again"}
            </button>
            <button className="back-button" type="button" onClick={onLeave} disabled={isRetrying}>
              <ArrowLeft size={17} weight="bold" />
              Use another URL
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="progress-view" aria-labelledby="progress-title" aria-busy="true">
      <button className="back-button" type="button" onClick={onCancelAudit} disabled={isCancelling}>
        <ArrowLeft size={17} weight="bold" />
        {isCancelling ? "Cancelling…" : "Cancel audit"}
      </button>
      <div className="progress-card">
        <div className="audit-orbit" aria-hidden="true">
          <Pulse size={31} weight="duotone" />
        </div>
        <p className="kicker" role="status" aria-live="polite" aria-atomic="true">
          Live audit · attempt {audit.attempt ?? 1} · {audit.progress}%
        </p>
        <h1 id="progress-title">{audit.phaseLabel}</h1>
        <p className="audit-url">{audit.url}</p>
        <AuditMissionSummary audit={audit} />
        <div
          className="progress-track"
          role="progressbar"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow={audit.progress}
          aria-valuetext={`${audit.progress}% complete — ${audit.phaseLabel}`}
          aria-label="Live audit progress"
        >
          <span style={{ width: `${audit.progress}%` }} />
        </div>
        <ol className="progress-stages">
          {stages.map((stage, index) => {
            const Icon = stage.icon;
            const complete = phaseIndex > index;
            const active = phaseIndex === index;
            return (
              <li
                key={stage.id}
                className={complete ? "complete" : active ? "active" : ""}
                aria-current={active ? "step" : undefined}
              >
                <span aria-hidden="true">{complete ? <Check size={16} weight="bold" /> : <Icon size={17} />}</span>
                <span className="sr-only">{complete ? "Completed" : active ? "Current" : "Upcoming"}: </span>
                {stage.label}
              </li>
            );
          })}
        </ol>
        <p className="audit-engine-note">
          Live PageSpeed Insights job · Lighthouse mobile and desktop evidence
        </p>
        {pollError ? (
          <div className="audit-poll-warning" role="alert" aria-busy={isRefreshingStatus}>
            <Warning size={20} weight="duotone" aria-hidden="true" />
            <div>
              <strong>Live status is temporarily unavailable</strong>
              <p>{pollError}</p>
              <small>
                The retained job has not been marked failed. Frontmend will keep trying; retrying
                now only reads the existing job.
              </small>
            </div>
            <button type="button" onClick={onRetryStatus} disabled={isRefreshingStatus}>
              <Pulse size={16} weight="bold" aria-hidden="true" />
              {isRefreshingStatus ? "Reading status…" : "Retry status now"}
            </button>
          </div>
        ) : null}
        {cancelError ? <p className="failure-message" role="alert">{cancelError}</p> : null}
      </div>
    </section>
  );
}

function RestoringAudit({ error, isRestoring, onCancel, onRetry }) {
  const failed = Boolean(error);
  return (
    <section className="progress-view" aria-labelledby="restore-title">
      <button className="back-button" type="button" onClick={onCancel}>
        <ArrowLeft size={17} weight="bold" />
        Start a new audit
      </button>
      <div
        className={`progress-card ${failed ? "audit-failure restoration-failure" : ""}`}
        role={failed ? "alert" : "status"}
        aria-live={failed ? "assertive" : "polite"}
        aria-busy={isRestoring}
      >
        <div className="audit-orbit" aria-hidden="true">
          {failed ? <Warning size={31} weight="duotone" /> : <Pulse size={31} weight="duotone" />}
        </div>
        <p className="kicker">{failed ? "Shared audit unavailable" : "Shared audit"}</p>
        <h1 id="restore-title">
          {failed ? "This workspace could not be restored" : "Restoring the live workspace"}
        </h1>
        {failed ? (
          <>
            <p className="failure-message">{error}</p>
            <p className="restoration-note">
              The stable audit address remains in your browser. Retrying only reads the existing
              authoritative job; it does not restart the audit or replay a mission action.
            </p>
            <div className="failure-actions">
              <button className="retry-audit" type="button" onClick={onRetry} disabled={isRestoring}>
                <Pulse size={17} weight="bold" />
                {isRestoring ? "Reading workspace…" : "Try restoring again"}
              </button>
            </div>
          </>
        ) : (
          <p className="audit-url">Reading authoritative job and mission state…</p>
        )}
      </div>
    </section>
  );
}

export function App() {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [audit, setAudit] = useState(() => auditService.getActiveAudit());
  const [focusAreas, setFocusAreas] = useState(
    () => auditService.getActiveAudit()?.mission?.focusAreas ?? [],
  );
  const [maxPriorities, setMaxPriorities] = useState(
    () => auditService.getActiveAudit()?.mission?.maxPriorities ?? 3,
  );
  const [showHow, setShowHow] = useState(false);
  const [showWebMcp, setShowWebMcp] = useState(false);
  const [showAgentActivity, setShowAgentActivity] = useState(false);
  const [staticRoute, setStaticRoute] = useState(
    () => staticRouteFromPathname(window.location.pathname),
  );
  const [agentActivities, setAgentActivities] = useState(() => auditService.getAgentActivities());
  const [isStarting, setIsStarting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const [pollError, setPollError] = useState("");
  const [pollAttempt, setPollAttempt] = useState(0);
  const [isRefreshingStatus, setIsRefreshingStatus] = useState(false);
  const [restorationAuditId, setRestorationAuditId] = useState(() => {
    const requestedAuditId = auditIdFromPathname(window.location.pathname);
    return requestedAuditId && auditService.getActiveAudit()?.id !== requestedAuditId
      ? requestedAuditId
      : "";
  });
  const [restorationAttempt, setRestorationAttempt] = useState(0);
  const [restorationError, setRestorationError] = useState("");
  const [isRestoring, setIsRestoring] = useState(() => Boolean(restorationAuditId));
  const [webMcp, setWebMcp] = useState({
    supported: false,
    status: "unsupported",
    toolNames: [],
    errors: [],
  });
  const inputRef = useRef(null);
  const mainContentRef = useRef(null);
  const webMcpTriggerRef = useRef(null);
  const webMcpToolNames = restorationAuditId ? [] : contextualFrontmendToolNames(auditService);
  const webMcpContextKey = webMcpToolNames.join("|");


  useEffect(() => {
    const dispose = registerFrontmendTools({
      service: auditService,
      target: document,
      onStatus: setWebMcp,
      toolNames: webMcpToolNames,
    });
    return dispose;
  }, [webMcpContextKey]);

  useEffect(
    () =>
      auditService.subscribe(() => {
        setAudit(auditService.getActiveAudit());
        setAgentActivities(auditService.getAgentActivities());
      }),
    [],
  );

  useEffect(() => {
    if (!restorationAuditId) return undefined;
    let active = true;
    setIsRestoring(true);
    setRestorationError("");
    void auditService
      .restoreAuditWorkspace(restorationAuditId)
      .then(({ audit: next }) => {
        if (!active) return;
        setAudit(next);
        setUrl(next.url);
        setFocusAreas(next.mission?.focusAreas ?? []);
        setMaxPriorities(next.mission?.maxPriorities ?? 3);
        setError("");
        setPollError("");
        setRestorationAuditId("");
      })
      .catch((cause) => {
        if (!active) return;
        setRestorationError(
          cause instanceof AuditError ? cause.message : "That shared audit could not be restored.",
        );
      })
      .finally(() => {
        if (active) setIsRestoring(false);
      });
    return () => {
      active = false;
    };
  }, [restorationAuditId, restorationAttempt]);

  useEffect(() => {
    if (restorationAuditId || !audit || ["complete", "failed", "cancelled"].includes(audit.status)) {
      return undefined;
    }
    let cancelled = false;
    let timer;
    const poll = async () => {
      setIsRefreshingStatus(true);
      try {
        const next = await auditService.getAudit(audit.id);
        if (cancelled) return;
        setAudit(next);
        setPollError("");
        if (!["complete", "failed", "cancelled"].includes(next.status)) {
          timer = window.setTimeout(poll, 1_500);
        }
      } catch (cause) {
        if (cancelled) return;
        setPollError(
          cause instanceof AuditError
            ? cause.message
            : "Frontmend lost contact with the live audit service. The audit may still be running.",
        );
        timer = window.setTimeout(poll, 3_000);
      } finally {
        if (!cancelled) setIsRefreshingStatus(false);
      }
    };
    timer = window.setTimeout(poll, 600);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      setIsRefreshingStatus(false);
    };
  }, [audit?.id, audit?.status, restorationAuditId, pollAttempt]);

  const mode = useMemo(() => {
    if (staticRoute === "how-it-works") return "guide";
    if (restorationAuditId) return "restore";
    if (!audit) return "landing";
    return audit.status === "complete" ? "report" : "progress";
  }, [audit, restorationAuditId, staticRoute]);
  const focusState = mode === "restore"
    ? `${mode}:${restorationError ? "error" : "loading"}`
    : mode === "progress" && ["failed", "cancelled"].includes(audit?.status)
      ? `${mode}:${audit.status}`
      : mode;
  const previousFocusStateRef = useRef(focusState);

  useEffect(() => {
    const previous = previousFocusStateRef.current;
    previousFocusStateRef.current = focusState;
    if (previous === focusState || mode === "landing") return undefined;
    const frame = window.requestAnimationFrame(() => mainContentRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [focusState, mode]);

  useEffect(() => {
    document.title = mode === "landing"
      ? "Frontmend — Find what broke. Prove the fix."
      : mode === "guide"
        ? "How Frontmend works — Frontmend"
        : mode === "restore"
          ? restorationError
            ? "Could not restore audit — Frontmend"
            : "Restoring audit — Frontmend"
          : mode === "report"
            ? "Audit results — Frontmend"
            : audit?.status === "failed"
              ? "Audit failed — Frontmend"
              : audit?.status === "cancelled"
                ? "Audit cancelled — Frontmend"
                : `${audit?.phaseLabel ?? "Audit in progress"} — Frontmend`;
  }, [audit?.phaseLabel, audit?.status, mode, restorationError]);

  const reset = () => {
    auditService.reset();
    setAudit(null);
    setUrl("");
    setFocusAreas([]);
    setMaxPriorities(3);
    setError("");
    setIsStarting(false);
    setIsCancelling(false);
    setCancelError("");
    setPollError("");
    setPollAttempt(0);
    setIsRefreshingStatus(false);
    setRestorationAuditId("");
    setRestorationAttempt(0);
    setRestorationError("");
    setIsRestoring(false);
    setStaticRoute(null);
    window.history.replaceState(null, "", "/");
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  const retryRestoration = () => {
    if (!restorationAuditId || isRestoring) return;
    setRestorationError("");
    setIsRestoring(true);
    setRestorationAttempt((attempt) => attempt + 1);
  };

  const retryAuditStatus = () => {
    if (!audit?.id || isRefreshingStatus) return;
    setIsRefreshingStatus(true);
    setPollAttempt((attempt) => attempt + 1);
  };

  const start = async (event) => {
    event?.preventDefault();
    setIsStarting(true);
    try {
      const next = await auditService.startAudit({
        url,
        source: "human",
        mission: { intent: "assess", focusAreas, maxPriorities },
      });
      setUrl(next.url);
      setAudit(next);
      setError("");
      setCancelError("");
      setPollError("");
      window.history.replaceState(null, "", auditWorkspacePath(next.id));
    } catch (cause) {
      setError(cause instanceof AuditError ? cause.message : "Frontmend could not start the audit.");
      inputRef.current?.focus();
    } finally {
      setIsStarting(false);
    }
  };

  const retry = async () => {
    if (!audit?.url) return;
    setIsStarting(true);
    try {
      const retainedMission = audit.mission ?? createAuditMission({}, audit.source, Date.now());
      const next = await auditService.startAudit({
        url: audit.url,
        source: retainedMission.requestedBy,
        mission: {
          intent: retainedMission.intent,
          focusAreas: retainedMission.focusAreas,
          maxPriorities: retainedMission.maxPriorities,
        },
      });
      setUrl(next.url);
      setAudit(next);
      setFocusAreas(next.mission?.focusAreas ?? retainedMission.focusAreas);
      setMaxPriorities(next.mission?.maxPriorities ?? retainedMission.maxPriorities);
      setError("");
      setCancelError("");
      setPollError("");
      window.history.replaceState(null, "", auditWorkspacePath(next.id));
    } catch (cause) {
      setAudit((current) => ({
        ...current,
        status: "failed",
        phase: "failed",
        phaseLabel: "Live audit failed",
        error: {
          code: cause instanceof AuditError ? cause.code : "AUDIT_REQUEST_FAILED",
          message:
            cause instanceof AuditError
              ? cause.message
              : "Frontmend could not start a fresh audit attempt.",
          recoverable: true,
        },
      }));
    } finally {
      setIsStarting(false);
    }
  };

  const cancelAudit = async () => {
    if (!audit?.id || ["complete", "failed", "cancelled"].includes(audit.status)) return;
    const cancelledUrl = audit.url;
    setIsCancelling(true);
    setCancelError("");
    try {
      const next = await auditService.cancelAudit(audit.id);
      if (next.status !== "cancelled") {
        setAudit(next);
        return;
      }
      auditService.reset();
      setAudit(null);
      setUrl(cancelledUrl);
      setFocusAreas(audit.mission?.focusAreas ?? []);
      setMaxPriorities(audit.mission?.maxPriorities ?? 3);
      setError("");
      window.history.replaceState(null, "", "/");
      window.requestAnimationFrame(() => inputRef.current?.focus());
    } catch (cause) {
      const failure = await humanMissionMutationFailure(
        cause,
        audit.id,
        "Frontmend could not cancel this audit. The job may still be running.",
      );
      setCancelError(failure.message);
    } finally {
      setIsCancelling(false);
    }
  };

  const verifyRepair = async (repair) => {
    const baselineAuditId = audit?.report?.auditId;
    if (!baselineAuditId) {
      throw new AuditError("AUDIT_NOT_READY", "The baseline audit is unavailable.");
    }
    const next = await auditService.startVerification(baselineAuditId, repair.id);
    setAudit(next);
    window.history.replaceState(null, "", auditWorkspacePath(next.id));
  };

  const auditRelatedRoute = async (path) => {
    const baselineAuditId = audit?.report?.auditId;
    if (!baselineAuditId) {
      throw new AuditError("AUDIT_NOT_READY", "The completed audit is unavailable.");
    }
    const next = await auditService.startRelatedAudit(baselineAuditId, path, "human");
    setUrl(next.url);
    setAudit(next);
    setError("");
    window.history.replaceState(null, "", auditWorkspacePath(next.id));
  };

  return (
    <div className={`app-shell ${mode}`}>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <header className="site-header">
        <Brand onClick={reset} />
        <div className="header-actions">
          <WebMcpStatus
            buttonRef={webMcpTriggerRef}
            status={webMcp}
            expanded={showWebMcp}
            restoring={Boolean(restorationAuditId)}
            onClick={() => setShowWebMcp(true)}
          />
          <button
            className="agent-activity-trigger"
            type="button"
            aria-expanded={showAgentActivity}
            aria-controls="agent-activity-drawer"
            aria-haspopup="dialog"
            onClick={() => setShowAgentActivity(true)}
          >
            <Robot size={16} weight="bold" aria-hidden="true" />
            Agent log
            {agentActivities.length ? <span>{agentActivities.length}</span> : null}
          </button>
          <button
            className="text-button"
            type="button"
            aria-controls="how-it-works-dialog"
            aria-haspopup="dialog"
            onClick={() => setShowHow(true)}
          >
            <Info size={17} weight="bold" aria-hidden="true" />
            How it works
          </button>
        </div>
      </header>

      <main id="main-content" className="main-content" ref={mainContentRef} tabIndex="-1">
        {mode === "guide" ? <HowItWorksPage /> : null}
        {mode === "landing" ? (
          <Landing
          value={url}
          setValue={(value) => {
            setUrl(value);
            setError("");
          }}
          onSubmit={start}
          error={error}
          inputRef={inputRef}
          isSubmitting={isStarting}
          focusAreas={focusAreas}
          maxPriorities={maxPriorities}
          onToggleFocus={(area) => {
            setFocusAreas((current) => current.includes(area)
              ? current.filter((candidate) => candidate !== area)
              : current.length < 3
                ? [...current, area]
                : current);
          }}
          onMaxPrioritiesChange={setMaxPriorities}
          />
        ) : null}
        {mode === "progress" ? (
          <AuditProgress
          audit={audit}
          onCancelAudit={cancelAudit}
          onLeave={reset}
          onRetry={retry}
          onRetryStatus={retryAuditStatus}
          isRetrying={isStarting}
          isRefreshingStatus={isRefreshingStatus}
          isCancelling={isCancelling}
          cancelError={cancelError}
          pollError={pollError}
          />
        ) : null}
        {mode === "restore" ? (
          <RestoringAudit
            error={restorationError}
            isRestoring={isRestoring}
            onCancel={reset}
            onRetry={retryRestoration}
          />
        ) : null}
        {mode === "report" ? (
          <LazyWorkspace
          load={loadReportWorkspace}
          label="completed audit workspace"
          resetKey={`${audit.id}:${audit.missionRevision ?? 1}`}
          componentProps={{
            audit,
            webMcp,
            onReset: reset,
            onVerify: verifyRepair,
            onAuditRoute: auditRelatedRoute,
          }}
          />
        ) : null}
      </main>

      <footer className="site-footer">
        <span>Find what broke. Prove the fix.</span>
        <span>Frontmend · Live audit engine</span>
      </footer>

      {showHow ? <HowItWorks onClose={() => setShowHow(false)} /> : null}
      {showWebMcp ? (
        <LazyWorkspace
          load={loadWebMcpCapabilitySheet}
          label="WebMCP mission inspector"
          resetKey={`${audit?.id ?? "landing"}:${audit?.missionRevision ?? 1}:${webMcp.status}`}
          variant="dialog"
          onExit={() => setShowWebMcp(false)}
          restoreFocusRef={webMcpTriggerRef}
          componentProps={{
            audit,
            webMcp,
            onClose: () => setShowWebMcp(false),
          }}
        />
      ) : null}
      {showAgentActivity ? (
        <AgentActivityDrawer
          activities={agentActivities}
          onClose={() => setShowAgentActivity(false)}
          onClear={() => auditService.clearAgentActivities()}
        />
      ) : null}
    </div>
  );
}
