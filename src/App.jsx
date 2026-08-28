import {
  ArrowLeft,
  ArrowRight,
  ArrowsOutSimple,
  Browser,
  Check,
  CheckCircle,
  ClipboardText,
  Code,
  Desktop,
  DeviceMobile,
  DownloadSimple,
  FileCode,
  Info,
  LinkSimple,
  MagnifyingGlass,
  Monitor,
  Pulse,
  Robot,
  ShieldCheck,
  Sparkle,
  Stamp,
  TestTube,
  Warning,
  Wrench,
  X,
} from "@phosphor-icons/react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AuditError, auditService } from "./audit-service.js";
import { repairMissionState } from "./repair-contract.js";
import { contextualFrontmendToolNames, registerFrontmendTools } from "./webmcp.js";

const VIEWPORTS = [
  { id: "desktop", label: "Desktop", detail: "1440 px", icon: Desktop },
  { id: "tablet", label: "Tablet", detail: "768 px", icon: Monitor },
  { id: "mobile", label: "Mobile", detail: "390 px", icon: DeviceMobile },
];

const LANDING_SIGNALS = [
  { label: "Responsive", detail: "Mobile + desktop", state: "warn", icon: DeviceMobile },
  { label: "Accessibility", detail: "Evidence attached", state: "neutral", icon: ShieldCheck },
  { label: "Verification", detail: "Before and after", state: "good", icon: CheckCircle },
];
const WEBMCP_TOOL_COUNT = 14;
const WEBMCP_TOOL_COPY = {
  start_site_audit: ["Start a site audit", "Open a real asynchronous audit for a public URL."],
  check_site_audit_progress: ["Check audit progress", "Read the live phase and completion percentage."],
  cancel_site_audit: ["Cancel a site audit", "Stop the live job and persist a truthful terminal state."],
  get_site_audit_results: ["Read audit evidence", "Inspect the bounded findings and measured rule outcomes."],
  get_repository_fix_brief: ["Prepare a repository fix brief", "Turn one live finding into source-safe evidence and acceptance criteria for a coding agent."],
  record_repository_implementation: ["Record repository implementation", "Attach bounded file and check evidence after an approved repair is implemented by a coding agent."],
  start_related_page_audit: ["Audit an observed route", "Start a new audit from a same-site path found in this evidence."],
  start_site_exploration: ["Explore selected routes", "Run one to three observed pages as a durable cross-page mission."],
  get_site_exploration: ["Read site exploration", "Inspect mission progress and recurring evidence across selected pages."],
  get_verification_receipt: ["Read verification proof", "Retrieve the portable before-and-after receipt."],
  stage_site_repair: ["Submit a repository mission", "Share a bounded plan with the person or use their scoped auto grant."],
  revise_site_repair: ["Revise a repair", "Respond to the specific change request left by a person."],
  get_repair_workspace: ["Inspect repair state", "Read proposal versions, ownership, and allowed next actions."],
  start_repair_verification: ["Verify a deployed repair", "Run fresh evidence after recorded authorisation and human deployment attestation."],
};

function auditIdFromPathname(pathname) {
  const match = pathname.match(
    /^\/audits\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/?$/i,
  );
  return match?.[1] ?? null;
}

function auditWorkspacePath(auditId) {
  return `/audits/${encodeURIComponent(auditId)}`;
}

function useDialogFocus(onClose) {
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog) return undefined;

    const focusableSelector =
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusables = () => [...dialog.querySelectorAll(focusableSelector)];
    const focusFrame = window.requestAnimationFrame(() => focusables()[0]?.focus());
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (!items.length) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items.at(-1);
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      if (previousFocus?.isConnected) window.requestAnimationFrame(() => previousFocus.focus());
    };
  }, []);

  return dialogRef;
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

function WebMcpStatus({ status, expanded, onClick }) {
  const ready = status.status === "ready";
  const failed = status.status === "error";
  const activeCount = status.activeTools ?? status.toolNames.length;
  const totalCount = status.totalTools ?? WEBMCP_TOOL_COUNT;
  const label = ready
    ? `WebMCP · ${status.toolNames.length} active`
    : status.status === "registering"
      ? "WebMCP · syncing"
      : failed
        ? `WebMCP · ${status.toolNames.length}/${activeCount} active`
        : "Human mode";
  const accessibleLabel = ready
    ? `WebMCP ready with ${status.toolNames.length} contextual tools active from a library of ${totalCount}`
    : failed
      ? `WebMCP registration incomplete: ${status.toolNames.length} of ${activeCount} contextual tools available`
      : status.status === "registering"
        ? "Synchronizing contextual WebMCP tools"
        : "WebMCP unavailable; human mode active";

  return (
    <button
      type="button"
      className={`webmcp-status ${ready ? "ready" : ""} ${failed ? "error" : ""}`}
      title={status.errors?.join("\n") || undefined}
      aria-label={accessibleLabel}
      aria-expanded={expanded}
      onClick={onClick}
    >
      <span className="status-dot" aria-hidden="true" />
      <span role="status" aria-live="polite">{label}</span>
    </button>
  );
}

function WebMcpCapabilitySheet({ status, onClose }) {
  const dialogRef = useDialogFocus(onClose);
  const supported = status.supported;
  const activeTools = status.toolNames ?? [];
  const syncing = status.status === "registering";
  const lead = !supported
    ? "This browser has not exposed document.modelContext. The complete human workflow remains available."
    : syncing
      ? "Frontmend is synchronizing the agent capabilities for this visible state."
      : activeTools.includes("check_site_audit_progress")
        ? "A live audit is running, so progress is the only valid agent action right now."
        : activeTools.includes("start_site_audit")
          ? "No audit is active. An agent can start the same workflow as the URL form."
          : "The audit is complete. Only actions supported by its evidence and review state are active.";

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        className="webmcp-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="webmcp-sheet-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="icon-button close-button" type="button" onClick={onClose} aria-label="Close">
          <X size={18} weight="bold" />
        </button>
        <div className="webmcp-sheet-heading">
          <span className={`webmcp-sheet-signal ${supported ? "ready" : ""}`} aria-hidden="true">
            <Robot size={21} weight="duotone" />
          </span>
          <div>
            <p className="kicker">Contextual WebMCP</p>
            <h2 id="webmcp-sheet-title">What agents can do now</h2>
          </div>
        </div>
        <p className="webmcp-sheet-lead">{lead}</p>

        {activeTools.length ? (
          <ol className="webmcp-capability-list">
            {activeTools.map((name) => {
              const [title, description] = WEBMCP_TOOL_COPY[name] ?? [name, "Available in the current state."];
              return (
                <li key={name}>
                  <CheckCircle size={18} weight="fill" aria-hidden="true" />
                  <div>
                    <strong>{title}</strong>
                    <p>{description}</p>
                    <code>{name}</code>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <div className="webmcp-capability-empty">
            <Pulse size={20} weight="duotone" aria-hidden="true" />
            <span>{syncing ? "Capability sync in progress" : "No agent capabilities are active"}</span>
          </div>
        )}

        <div className="webmcp-human-boundary">
          <Stamp size={20} weight="duotone" aria-hidden="true" />
          <div>
            <strong>Human authority stays visible</strong>
            <p>Agents cannot grant themselves approval or attest deployment. A person may review each plan or visibly delegate a bounded low-risk policy; Frontmend records which authority advanced the mission.</p>
          </div>
        </div>
        <p className="webmcp-library-note">
          {activeTools.length} active now · {status.totalTools ?? WEBMCP_TOOL_COUNT} in the bounded library
        </p>
      </section>
    </div>
  );
}

function AgentActivityDrawer({ activities, onClose, onClear }) {
  const dialogRef = useDialogFocus(onClose);
  return (
    <div className="agent-activity-backdrop" role="presentation" onMouseDown={onClose}>
      <aside
        ref={dialogRef}
        className="agent-activity-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-activity-title"
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
        <p className="agent-activity-boundary">
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
        <h2 id="how-title">Inspect. Repair. Prove it held.</h2>
        <ol className="how-list">
          <li>
            <span>01</span>
            <div>
              <strong>Audit the live URL</strong>
              <p>Measure public browser evidence, or clearly label the bounded document fallback.</p>
            </div>
          </li>
          <li>
            <span>02</span>
            <div>
              <strong>Stage a reviewable repair</strong>
              <p>Keep source evidence, proposal versions, ownership, and human feedback together.</p>
            </div>
          </li>
          <li>
            <span>03</span>
            <div>
              <strong>Deploy elsewhere, then prove it</strong>
              <p>The site owner deploys the approved change; Frontmend reruns the exact rule and exports the receipt.</p>
            </div>
          </li>
        </ol>
      </section>
    </div>
  );
}

function Landing({ value, setValue, onSubmit, error, inputRef, isSubmitting }) {
  return (
    <section className="landing" aria-labelledby="landing-title">
      <div className="landing-copy">
        <p className="kicker">A repair bench for the open web</p>
        <h1 id="landing-title">Where does your site break?</h1>
        <p className="landing-intro">
          Paste a public URL. Frontmend finds frontend failures, attaches the evidence, and helps
          people and agents prove the repair.
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
          />
          <button
            className="search-submit"
            type="submit"
            aria-label="Audit this website"
            disabled={isSubmitting}
          >
            <ArrowRight size={23} weight="bold" />
          </button>
        </form>

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
        </div>

        <p className={`search-message ${error ? "error" : ""}`} aria-live="polite">
          {error ||
            (isSubmitting ? "Starting the live audit…" : "No account needed for the first audit.")}
        </p>
      </div>

      <div className="signal-stage" aria-label="Frontmend audit capabilities">
        {LANDING_SIGNALS.map((signal, index) => {
          const Icon = signal.icon;
          return (
            <article className={`signal-card signal-${index + 1}`} key={signal.label}>
              <span className={`signal-icon ${signal.state}`}>
                <Icon size={18} weight="duotone" aria-hidden="true" />
              </span>
              <span>
                <strong>{signal.label}</strong>
                <small>{signal.detail}</small>
              </span>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function AuditProgress({ audit, onCancelAudit, onLeave, onRetry, isRetrying, isCancelling, cancelError }) {
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
    <section className="progress-view" aria-labelledby="progress-title">
      <button className="back-button" type="button" onClick={onCancelAudit} disabled={isCancelling}>
        <ArrowLeft size={17} weight="bold" />
        {isCancelling ? "Cancelling…" : "Cancel audit"}
      </button>
      <div className="progress-card">
        <div className="audit-orbit" aria-hidden="true">
          <Pulse size={31} weight="duotone" />
        </div>
        <p className="kicker">Live audit · attempt {audit.attempt ?? 1} · {audit.progress}%</p>
        <h1 id="progress-title">{audit.phaseLabel}</h1>
        <p className="audit-url">{audit.url}</p>
        <div
          className="progress-track"
          role="progressbar"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow={audit.progress}
        >
          <span style={{ width: `${audit.progress}%` }} />
        </div>
        <ol className="progress-stages">
          {stages.map((stage, index) => {
            const Icon = stage.icon;
            const complete = phaseIndex > index;
            const active = phaseIndex === index;
            return (
              <li key={stage.id} className={complete ? "complete" : active ? "active" : ""}>
                <span>{complete ? <Check size={16} weight="bold" /> : <Icon size={17} />}</span>
                {stage.label}
              </li>
            );
          })}
        </ol>
        <p className="audit-engine-note">
          Live PageSpeed Insights job · Lighthouse mobile and desktop evidence
        </p>
        {cancelError ? <p className="failure-message" role="alert">{cancelError}</p> : null}
      </div>
    </section>
  );
}

function RestoringAudit({ onCancel }) {
  return (
    <section className="progress-view" aria-labelledby="restore-title">
      <button className="back-button" type="button" onClick={onCancel}>
        <ArrowLeft size={17} weight="bold" />
        Return home
      </button>
      <div className="progress-card">
        <div className="audit-orbit" aria-hidden="true">
          <Pulse size={31} weight="duotone" />
        </div>
        <p className="kicker">Shared audit</p>
        <h1 id="restore-title">Restoring the live workspace</h1>
        <p className="audit-url">Reading authoritative state from the audit job…</p>
      </div>
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

function BrowserPreview({ url, viewport, selectedFinding, documentProfile }) {
  const isDocumentEvidence = viewport.id === "document";
  return (
    <div className={`browser-preview viewport-${viewport.id}`}>
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

function ProofMetric({ label, baseline, current, delta, lowerIsBetter = false }) {
  const valuesAvailable = Number.isFinite(baseline) && Number.isFinite(current);
  const comparable = valuesAvailable && Number.isFinite(delta);
  const improved = comparable && delta !== 0 && (lowerIsBetter ? delta < 0 : delta > 0);
  const regressed = comparable && delta !== 0 && !improved;
  const deltaText = !comparable
    ? "Not like for like"
    : delta === 0
      ? "No change"
      : `${delta > 0 ? "+" : ""}${delta}`;
  return (
    <article className="proof-metric">
      <span>{label}</span>
      <div aria-label={`${label}: ${baseline ?? "unavailable"} before, ${current ?? "unavailable"} after`}>
        <strong>{baseline ?? "—"}</strong>
        <ArrowRight size={15} weight="bold" aria-hidden="true" />
        <strong>{current ?? "—"}</strong>
      </div>
      <em className={improved ? "improved" : regressed ? "regressed" : comparable ? "unchanged" : "unavailable"}>
        {deltaText}
      </em>
    </article>
  );
}

function EvidenceTrail({ lineage }) {
  if (!lineage?.entries?.length) return null;
  const statusLabels = {
    baseline: "Measured baseline",
    resolved: "Rule passed",
    "still-present": "Rule still failing",
    inconclusive: "Inconclusive",
  };
  const coverageLabel = (entry) => {
    if (entry.attempt === 0) return "Reference coverage";
    if (entry.metricComparableToBaseline === true) return "Comparable coverage";
    if (entry.metricComparableToBaseline === false) return "Coverage changed · deltas withheld";
    return "Coverage not recorded";
  };
  return (
    <section className="evidence-trail" aria-labelledby="evidence-trail-title">
      <div className="evidence-trail-heading">
        <div>
          <p className="kicker">Audit lineage</p>
          <h3 id="evidence-trail-title">Evidence trail</h3>
        </div>
        <span>
          {lineage.attemptCount} verification{lineage.attemptCount === 1 ? "" : "s"}
        </span>
      </div>
      {lineage.omitted > 0 ? (
        <p className="evidence-trail-omitted">
          Root preserved · {lineage.omitted} older attempt{lineage.omitted === 1 ? "" : "s"} compacted
        </p>
      ) : null}
      <ol className="evidence-trail-list">
        {lineage.entries.map((entry) => (
          <li key={`${entry.auditId}-${entry.attempt}`} className={`trail-${entry.status}`}>
            <span className="trail-marker" aria-hidden="true">
              {entry.status === "resolved" ? (
                <CheckCircle size={16} weight="fill" />
              ) : entry.status === "still-present" ? (
                <Warning size={16} weight="fill" />
              ) : entry.status === "inconclusive" ? (
                <Info size={16} weight="fill" />
              ) : (
                <Pulse size={16} weight="bold" />
              )}
            </span>
            <div className="trail-card">
              <div>
                <strong>{entry.attempt === 0 ? "Baseline" : `Attempt ${entry.attempt}`}</strong>
                <code>{entry.auditId?.slice(0, 8) ?? "unknown"}</code>
              </div>
              <span>{statusLabels[entry.status] ?? "Measured"}</span>
              <small>
                {entry.score ?? "—"} score · {entry.checksPassed ?? "—"} passed · {entry.findingCount ?? "—"} findings
              </small>
              <small className={entry.metricComparableToBaseline === false ? "trail-coverage-changed" : "trail-coverage"}>
                {coverageLabel(entry)}
              </small>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function RepairMissionRail({ repair }) {
  const mission = repair?.mission ?? repairMissionState(repair);
  const stateLabels = {
    "not-started": "Ready to scope",
    "awaiting-human-review": "Human decision required",
    "changes-requested": "Agent revision required",
    "implementation-attention": "Repository checks need attention",
    "awaiting-external-deployment": "Waiting for site owner",
    "ready-for-verification": "Ready to verify",
  };
  return (
    <section className="repair-mission" aria-label="Repair mission progress">
      <div className="repair-mission-heading">
        <div>
          <p className="kicker">Repair mission</p>
          <strong>{stateLabels[mission.state] ?? "In progress"}</strong>
        </div>
        <span>
          <ArrowsOutSimple size={13} weight="bold" aria-hidden="true" />
          Target changes stay external
        </span>
      </div>
      <ol>
        {mission.steps.map((step, index) => (
          <li key={step.id} className={`mission-${step.status}`}>
            <span className="mission-marker" aria-hidden="true">
              {["complete", "attested"].includes(step.status) ? (
                <Check size={12} weight="bold" />
              ) : step.status === "attention" ? (
                <Warning size={12} weight="fill" />
              ) : index + 1}
            </span>
            <div>
              <strong>{step.label}</strong>
              <small>{step.detail ?? step.owner}</small>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function VerificationBanner({ verification }) {
  if (!verification) return null;
  const scopeSources = Array.isArray(verification.findingScope?.sources)
    ? verification.findingScope.sources
    : verification.findingSource
      ? [verification.findingSource]
      : [];
  const scoped = scopeSources.length > 1;
  const labels = {
    resolved: scoped ? "Every captured rule occurrence passed" : "Original rule explicitly passed",
    "still-present": scoped ? "A captured rule occurrence still fails" : "Original finding still present",
    inconclusive: scoped ? "Rule-scope comparison is inconclusive" : "Comparison is inconclusive",
  };
  const outcomeLabels = {
    passed: "Passed",
    failed: "Failed",
    "not-applicable": "Not applicable",
    "not-evaluated": "Not evaluated",
    missing: "No explicit outcome",
    "not-comparable": "Not comparable",
  };
  const proof = verification.proof;
  const implementation = verification.implementationReceipt;
  const hasBaseline = Boolean(proof?.baseline?.auditId);
  return (
    <section
      className={`verification-banner verification-${verification.status}`}
      aria-labelledby="verification-title"
    >
      <div className="verification-summary">
        <span className="verification-icon" aria-hidden="true">
          {verification.status === "resolved" ? (
            <CheckCircle size={23} weight="fill" />
          ) : verification.status === "still-present" ? (
            <Warning size={23} weight="fill" />
          ) : (
            <Info size={23} weight="fill" />
          )}
        </span>
        <div>
          <p className="kicker">Before / after proof</p>
          <h2 id="verification-title">{labels[verification.status]}</h2>
          <p>{verification.message}</p>
        </div>
      </div>
      <dl>
        <div>
          <dt>Finding</dt>
          <dd>{verification.findingTitle}</dd>
        </div>
        <div>
          <dt>{scoped ? "Rule-scope evidence" : "Exact rule evidence"}</dt>
          <dd>{verification.comparable ? "Like for like" : `Not comparable · ${verification.comparisonReason ?? "evidence changed"}`}</dd>
        </div>
        <div>
          <dt>Summary metrics</dt>
          <dd>{verification.metricComparable ? "Like for like" : "Trend withheld · audit coverage changed"}</dd>
        </div>
        <div>
          <dt>{scoped ? "Aggregate rule outcome" : "Exact rule outcome"}</dt>
          <dd>{outcomeLabels[verification.ruleOutcome] ?? "Unknown"}</dd>
        </div>
        <div>
          <dt>Repository handoff</dt>
          <dd>{implementation ? `Agent receipt r${implementation.revision ?? 1} carried forward` : "Not recorded · optional"}</dd>
        </div>
        <div>
          <dt>Deployment handoff</dt>
          <dd>
            {Number.isFinite(verification.deploymentAttestedAt)
              ? `Owner attested ${new Date(verification.deploymentAttestedAt).toLocaleString()}`
              : "Not recorded"}
          </dd>
        </div>
        <div>
          <dt>Repair revision</dt>
          <dd>{verification.repairRevision ?? 1}</dd>
        </div>
      </dl>
      {scopeSources.length ? (
        <RuleScopeReceipt
          scope={verification.findingScope}
          fallbackSource={verification.findingSource}
          outcomes={verification.scopeOutcomes}
          outcomeLabels={outcomeLabels}
          mode="verification"
        />
      ) : null}
      <RepositoryPlanCard plan={verification.repositoryPlan} />
      {implementation ? (
        <section className="implementation-receipt verification-implementation" aria-labelledby="verification-implementation-title">
          <div className="implementation-receipt-heading">
            <span aria-hidden="true"><Robot size={20} weight="duotone" /></span>
            <div>
              <p className="kicker">Repository provenance</p>
              <strong id="verification-implementation-title">Implementation receipt carried into proof</strong>
              <p>Revision {implementation.revision ?? 1} · {implementation.summary}</p>
            </div>
          </div>
          <dl>
            <div>
              <dt>Files</dt>
              <dd>{implementation.files?.join(", ") || "Not recorded"}</dd>
            </div>
            <div>
              <dt>Agent-reported checks</dt>
              <dd>
                {implementation.checks?.length
                  ? implementation.checks.map((check) => `${check.name}: ${check.status}`).join(" · ")
                  : "Not recorded"}
              </dd>
            </div>
            {implementation.commitSha ? (
              <div>
                <dt>Git object</dt>
                <dd><code>{implementation.commitSha}</code></dd>
              </div>
            ) : null}
          </dl>
          <small>
            Agent-reported metadata only · Frontmend did not inspect source, run repository checks, or deploy this Git object
          </small>
        </section>
      ) : null}
      {hasBaseline ? (
        <div className="proof-receipt">
          <div className="proof-receipt-heading">
            <div>
              <span>Baseline</span>
              <code>{proof.baseline.auditId.slice(0, 8)}</code>
            </div>
            <span className="proof-rule">
              {scoped
                ? `${scopeSources.length} captured occurrences`
                : verification.findingSource?.auditId ?? verification.findingId}
              <ArrowRight size={14} weight="bold" aria-hidden="true" />
              {outcomeLabels[verification.ruleOutcome] ?? "Unknown"}
            </span>
            <div>
              <span>Fresh audit</span>
              <code>{proof.current.auditId?.slice(0, 8) ?? "pending"}</code>
            </div>
          </div>
          <div className="proof-metrics" aria-label="Before and after audit metrics">
            <ProofMetric
              label="Score"
              baseline={proof.baseline.score}
              current={proof.current.score}
              delta={proof.deltas.score}
            />
            <ProofMetric
              label="Checks passed"
              baseline={proof.baseline.checks?.passed}
              current={proof.current.checks?.passed}
              delta={proof.deltas.checksPassed}
            />
            <ProofMetric
              label="Findings"
              baseline={proof.baseline.findingCount}
              current={proof.current.findingCount}
              delta={proof.deltas.findings}
              lowerIsBetter
            />
          </div>
        </div>
      ) : null}
      <EvidenceTrail lineage={verification.lineage} />
      {proof?.current?.auditId ? (
        <div className="proof-actions">
          <a href={auditService.getVerificationReceiptUrl(proof.current.auditId)} download>
            <DownloadSimple size={15} weight="bold" aria-hidden="true" />
            Export verification receipt
          </a>
          <span>Portable Markdown · bounded public evidence</span>
        </div>
      ) : null}
    </section>
  );
}

function RuleScopeReceipt({ scope, fallbackSource, outcomes = [], outcomeLabels = {}, mode }) {
  const sources = Array.isArray(scope?.sources) && scope.sources.length
    ? scope.sources
    : fallbackSource
      ? [fallbackSource]
      : [];
  if (!sources.length) return null;
  const occurrenceCount = Number.isFinite(scope?.occurrenceCount)
    ? Math.max(sources.length, scope.occurrenceCount)
    : sources.length;
  const omitted = Number.isFinite(scope?.occurrencesOmitted)
    ? Math.max(0, scope.occurrencesOmitted)
    : 0;
  const outcomeFor = (source) => outcomes.find((candidate) =>
    candidate?.source?.provider === source.provider &&
    candidate?.source?.auditId === source.auditId &&
    candidate?.source?.strategy === source.strategy,
  );
  return (
    <section className={`rule-scope-receipt rule-scope-${mode}`} aria-label="Captured repair rule scope">
      <header>
        <div>
          <p className="kicker">Frozen rule scope</p>
          <strong>{occurrenceCount} measured occurrence{occurrenceCount === 1 ? "" : "s"}</strong>
        </div>
        <span>{mode === "verification" ? "Fresh outcomes" : "All must pass"}</span>
      </header>
      <ol>
        {sources.map((source) => {
          const result = outcomeFor(source);
          const outcome = result?.outcome ?? result?.status;
          return (
            <li key={`${source.provider}-${source.auditId}-${source.strategy}`}>
              <span>{source.strategy}</span>
              <code title={`${source.provider} · ${source.auditId}`}>{source.provider} · {source.auditId}</code>
              <strong className={`scope-outcome scope-outcome-${outcome ?? "required"}`}>
                {mode === "verification"
                  ? outcomeLabels[outcome] ?? "No explicit outcome"
                  : "Required"}
              </strong>
            </li>
          );
        })}
      </ol>
      <p>
        {mode === "verification"
          ? "Resolution requires an explicit pass for every listed strategy."
          : "This scope is carried into verification; one passing strategy cannot hide another failure."}
        {omitted ? ` ${omitted} additional occurrence${omitted === 1 ? " was" : "s were"} omitted by the evidence bound.` : ""}
      </p>
    </section>
  );
}

function RepairRevisionTrail({ repair }) {
  const history = Array.isArray(repair?.revisionHistory) ? repair.revisionHistory : [];
  if (!history.length) return null;
  return (
    <section className="repair-revision-trail" aria-labelledby="repair-revision-title">
      <div>
        <p className="kicker">Proposal provenance</p>
        <strong id="repair-revision-title">Revision trail</strong>
        <span>{history.length + 1} versions</span>
      </div>
      <ol>
        {history.map((revision) => (
          <li key={revision.revision}>
            <span>Revision {revision.revision}</span>
            <strong>{revision.summary}</strong>
            {revision.repositoryPlan?.files?.length ? (
              <small>{revision.repositoryPlan.files.length} planned repository file{revision.repositoryPlan.files.length === 1 ? "" : "s"}</small>
            ) : null}
            {revision.changeRequest?.feedback ? <small>{revision.changeRequest.feedback}</small> : null}
          </li>
        ))}
        <li className="current">
          <span>Revision {repair.revision ?? history.length + 1}</span>
          <strong>{repair.summary}</strong>
          <small>Current proposal · awaiting human decision</small>
        </li>
      </ol>
    </section>
  );
}

function RepositoryPlanCard({ plan }) {
  const titleId = useId();
  if (!plan?.files?.length || !plan?.checks?.length) return null;
  return (
    <section className="repository-plan" aria-labelledby={titleId}>
      <div className="repository-plan-heading">
        <span aria-hidden="true"><FileCode size={20} weight="duotone" /></span>
        <div>
          <p className="kicker">Coding-agent plan</p>
          <strong id={titleId}>Repository ownership before approval</strong>
          <p>Relative paths and planned checks only · no source contents received</p>
        </div>
      </div>
      <div className="repository-plan-columns">
        <div>
          <span>Planned files</span>
          <ul>
            {plan.files.map((file) => <li key={file}><code>{file}</code></li>)}
          </ul>
        </div>
        <div>
          <span>Planned checks</span>
          <ul>
            {plan.checks.map((check) => <li key={check}>{check}</li>)}
          </ul>
        </div>
      </div>
      <small>Agent-reported plan metadata · Frontmend did not inspect the repository or authorise implementation</small>
    </section>
  );
}

function RepairWorkbench({ auditId, finding, repair, onRepairChange, onVerify }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [deploymentConfirmed, setDeploymentConfirmed] = useState(false);
  const [revisionFeedback, setRevisionFeedback] = useState("");

  useEffect(() => {
    setReviewConfirmed(false);
    setDeploymentConfirmed(false);
    setRevisionFeedback("");
  }, [repair?.id, repair?.revision, repair?.status]);

  if (!finding) return null;

  const stage = async () => {
    setBusy("stage");
    setError("");
    try {
      onRepairChange(
        await auditService.stageRepair(auditId, {
          findingId: finding.id,
          source: "human",
        }),
      );
    } catch (cause) {
      setError(cause instanceof AuditError ? cause.message : "The repair draft could not be staged.");
    } finally {
      setBusy("");
    }
  };

  const approve = async () => {
    setBusy("approve");
    setError("");
    try {
      onRepairChange(await auditService.approveRepair(auditId, repair.id));
    } catch (cause) {
      setError(cause instanceof AuditError ? cause.message : "The repair draft could not be approved.");
    } finally {
      setBusy("");
    }
  };

  const requestChanges = async () => {
    setBusy("changes");
    setError("");
    try {
      onRepairChange(
        await auditService.requestRepairChanges(auditId, repair.id, revisionFeedback),
      );
    } catch (cause) {
      setError(cause instanceof AuditError ? cause.message : "The change request could not be recorded.");
    } finally {
      setBusy("");
    }
  };

  const verify = async () => {
    setBusy("verify");
    setError("");
    try {
      await onVerify(repair);
    } catch (cause) {
      setError(cause instanceof AuditError ? cause.message : "The verification audit could not start.");
      setBusy("");
    }
  };

  const attestDeployment = async () => {
    setBusy("deployment");
    setError("");
    try {
      onRepairChange(await auditService.attestDeployment(auditId, repair.id));
      setDeploymentConfirmed(false);
    } catch (cause) {
      setError(cause instanceof AuditError ? cause.message : "The deployment handoff could not be recorded.");
    } finally {
      setBusy("");
    }
  };

  if (!repair) {
    return (
      <section className="repair-workbench repair-empty" aria-label="Repair workspace">
        <RepairMissionRail repair={null} />
        <span className="repair-workbench-icon" aria-hidden="true">
          <Wrench size={21} weight="duotone" />
        </span>
        <div>
          <p className="kicker">Repair workspace</p>
          <h3>Turn this finding into a reviewable change.</h3>
          <p>
            Frontmend will stage a bounded starting point. An agent can propose a richer draft through
            WebMCP; approval stays in this visible review interface.
          </p>
        </div>
        <button type="button" className="repair-button" onClick={stage} disabled={Boolean(busy)}>
          <ClipboardText size={17} weight="bold" />
          {busy === "stage" ? "Staging…" : "Stage repair draft"}
        </button>
        {error ? <p className="repair-error" role="alert">{error}</p> : null}
      </section>
    );
  }

  const approved = repair.status === "approved";
  const autoApproved = approved && repair.approval?.mode === "delegated-auto";
  const changesRequested = repair.status === "changes-requested";
  const deploymentAttested = approved && Number.isFinite(repair.deploymentAttestedAt);
  return (
    <section
      className={`repair-workbench ${approved ? "approved" : changesRequested ? "changes-requested" : ""}`}
      aria-label="Repair workspace"
    >
      <RepairMissionRail repair={repair} />
      <div className="repair-workbench-heading">
        <div>
          <p className="kicker">
            {changesRequested
              ? "Changes requested · awaiting agent revision"
              : approved
                ? autoApproved
                  ? "Auto-authorised by your policy"
                  : "Human-approved repair"
                : "Draft · awaiting human review"}
          </p>
          <h3>{repair.summary}</h3>
        </div>
        <div className="repair-heading-meta">
          <span>Revision {repair.revision ?? 1}</span>
          <span className={`repair-risk risk-${repair.risk}`}>{repair.risk} risk</span>
        </div>
      </div>
      <RuleScopeReceipt
        scope={repair.findingScope}
        fallbackSource={repair.findingSource}
        mode="repair"
      />
      <RepositoryPlanCard plan={repair.repositoryPlan} />
      {autoApproved ? (
        <div className="delegated-approval-receipt" role="status">
          <ShieldCheck size={19} weight="fill" aria-hidden="true" />
          <div>
            <strong>Scoped human delegation applied</strong>
            <p>
              This agent-authored low-risk {repair.patchType} plan met the audit policy: repository files and checks were supplied.
              Frontmend did not approve deployment and cannot attest that the public site changed.
            </p>
          </div>
        </div>
      ) : null}
      <div className="patch-preview">
        <div>
          <Code size={16} weight="bold" aria-hidden="true" />
          <span>{repair.patchType}</span>
          <small>
            Revision {repair.revision ?? 1} · {repair.source === "agent" ? "Agent proposed" : "Frontmend draft"}
          </small>
        </div>
        <pre><code>{repair.patch}</code></pre>
      </div>
      <RepairRevisionTrail repair={repair} />
      <div className="verification-plan">
        <TestTube size={19} weight="duotone" aria-hidden="true" />
        <div>
          <strong>Verification plan</strong>
          <p>{repair.verificationPlan}</p>
        </div>
      </div>
      {repair.implementationReceipt ? (
        <section className="implementation-receipt" aria-labelledby="implementation-receipt-title">
          <div className="implementation-receipt-heading">
            <span aria-hidden="true"><Robot size={20} weight="duotone" /></span>
            <div>
              <p className="kicker">Coding-agent receipt</p>
              <strong id="implementation-receipt-title">Repository implementation reported</strong>
              <p>
                Revision {repair.implementationReceipt.revision ?? 1} · {repair.implementationReceipt.summary}
              </p>
            </div>
          </div>
          <dl>
            <div>
              <dt>Files</dt>
              <dd>{repair.implementationReceipt.files.join(", ")}</dd>
            </div>
            <div>
              <dt>Checks</dt>
              <dd>
                {repair.implementationReceipt.checks
                  .map((check) => `${check.name}: ${check.status}`)
                  .join(" · ")}
              </dd>
            </div>
            {repair.implementationReceipt.commitSha ? (
              <div>
                <dt>Git object</dt>
                <dd><code>{repair.implementationReceipt.commitSha}</code></dd>
              </div>
            ) : null}
          </dl>
          {repair.implementationHistory?.length ? (
            <details className="implementation-history">
              <summary>
                {repair.implementationHistory.length} previous implementation receipt
                {repair.implementationHistory.length === 1 ? "" : "s"}
              </summary>
              <ol>
                {repair.implementationHistory.map((receipt) => (
                  <li key={`${receipt.revision ?? 1}-${receipt.reportedAt}`}>
                    <strong>Revision {receipt.revision ?? 1}</strong>
                    <span>{receipt.summary}</span>
                    <small>
                      {receipt.checks.map((check) => `${check.name}: ${check.status}`).join(" · ")}
                    </small>
                  </li>
                ))}
              </ol>
            </details>
          ) : null}
          <small>
            Agent-reported repository metadata only · Frontmend did not inspect or change source · public result not yet verified
          </small>
        </section>
      ) : approved && !deploymentAttested ? (
        <p className="implementation-receipt-empty">
          A coding agent can optionally attach repository-relative files and check outcomes before deployment.
        </p>
      ) : null}
      {changesRequested ? (
        <div className="change-requested-card" role="status">
          <span aria-hidden="true"><Robot size={20} weight="duotone" /></span>
          <div>
            <p className="kicker">Human feedback for the next revision</p>
            <strong>{repair.changeRequest?.feedback}</strong>
            <small>
              Requested {Number.isFinite(repair.changeRequest?.requestedAt)
                ? new Date(repair.changeRequest.requestedAt).toLocaleString()
                : "just now"}. The agent can revise this proposal through WebMCP; approval remains unavailable until then.
            </small>
          </div>
        </div>
      ) : !approved ? (
        <div className="repair-review-callout">
          <div className="repair-review-copy">
            <p>Approval is deliberately absent from WebMCP and never applies anything to the target site.</p>
            <label className="repair-confirmation">
              <input
                type="checkbox"
                checked={reviewConfirmed}
                onChange={(event) => setReviewConfirmed(event.target.checked)}
              />
              <span>I reviewed the proposal, risk, and verification plan.</span>
            </label>
            <label className="repair-feedback">
              <span>Revision feedback</span>
              <textarea
                value={revisionFeedback}
                maxLength={600}
                rows={3}
                placeholder="Describe the specific change the next proposal must make."
                onChange={(event) => setRevisionFeedback(event.target.value)}
              />
              <small>{revisionFeedback.length}/600 · sent to the shared agent workspace</small>
            </label>
          </div>
          <div className="repair-review-actions">
            <button
              type="button"
              className="request-changes"
              onClick={requestChanges}
              disabled={Boolean(busy) || !revisionFeedback.trim()}
            >
              <Robot size={17} weight="bold" />
              {busy === "changes" ? "Sending…" : "Request agent revision"}
            </button>
            <button
              type="button"
              className="approve-repair"
              onClick={approve}
              disabled={Boolean(busy) || !reviewConfirmed}
            >
              <Stamp size={17} weight="bold" />
              {busy === "approve" ? "Approving…" : "Approve repair plan"}
            </button>
          </div>
        </div>
      ) : !deploymentAttested ? (
        <div className="deployment-gate">
          <div className="deployment-gate-copy">
            <p className="kicker">External deployment handoff</p>
            <strong>Apply the reviewed change through your normal site workflow.</strong>
            <p>
              Frontmend has not changed or inspected your source. Verification unlocks only after a
              person reports that the reviewed change is live and ready to measure.
            </p>
            <label className="repair-confirmation">
              <input
                type="checkbox"
                checked={deploymentConfirmed}
                onChange={(event) => setDeploymentConfirmed(event.target.checked)}
              />
              <span>I deployed this reviewed change and want Frontmend to audit the public site.</span>
            </label>
          </div>
          <div className="deployment-gate-actions">
            <a
              className="export-repair"
              href={auditService.getRepairExportUrl(auditId, repair.id)}
              download
            >
              <DownloadSimple size={17} weight="bold" />
              Export reviewed plan
            </a>
            <button
              type="button"
              className="attest-deployment"
              onClick={attestDeployment}
              disabled={Boolean(busy) || !deploymentConfirmed}
            >
              <CheckCircle size={17} weight="bold" />
              {busy === "deployment" ? "Recording…" : "Confirm deployment handoff"}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="deployment-attested" role="status">
            <CheckCircle size={18} weight="fill" aria-hidden="true" />
            <div>
              <strong>Deployment reported by site owner</strong>
              <span>
                {new Date(repair.deploymentAttestedAt).toLocaleString()} · Frontmend has not yet
                verified the public result.
              </span>
            </div>
          </div>
        <div className="repair-actions">
          <a
            className="export-repair"
            href={auditService.getRepairExportUrl(auditId, repair.id)}
            download
          >
            <DownloadSimple size={17} weight="bold" />
            Export reviewed plan
          </a>
          <button type="button" className="verify-repair" onClick={verify} disabled={Boolean(busy)}>
            <TestTube size={17} weight="bold" />
            {busy === "verify" ? "Starting…" : "Verify live site"}
          </button>
        </div>
        </>
      )}
      {error ? <p className="repair-error" role="alert">{error}</p> : null}
    </section>
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

function ObservedRoutes({ profile, onAuditRoute }) {
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
      setError(
        cause instanceof AuditError
          ? cause.message
          : "Frontmend could not start an audit for that observed route.",
      );
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

function RepairPolicyControl({ auditId, policy, onPolicyChange }) {
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const auto = policy?.mode === "auto-low-risk";

  const update = async (mode) => {
    setBusy(mode);
    setError("");
    try {
      const next = await auditService.setRepairPolicy(auditId, mode);
      onPolicyChange(next);
      setConfirmed(false);
    } catch (cause) {
      setError(cause instanceof AuditError ? cause.message : "The repair policy could not be updated.");
    } finally {
      setBusy("");
    }
  };

  return (
    <section className={`repair-policy ${auto ? "auto" : "review"}`} aria-labelledby="repair-policy-title">
      <div className="repair-policy-heading">
        <span aria-hidden="true"><Robot size={22} weight="duotone" /></span>
        <div>
          <p className="kicker">Human-agent operating policy</p>
          <h2 id="repair-policy-title">Choose how repository missions enter implementation</h2>
          <p>This grant belongs to this audit workspace and is persisted with its repair state.</p>
        </div>
      </div>
      <div className="repair-policy-options">
        <button
          type="button"
          className={!auto ? "active" : ""}
          aria-pressed={!auto}
          disabled={Boolean(busy)}
          onClick={() => update("review")}
        >
          <strong>Review each plan</strong>
          <span>Every agent proposal waits for your visible approval.</span>
        </button>
        <button
          type="button"
          className={auto ? "active" : ""}
          aria-pressed={auto}
          disabled={Boolean(busy) || (!auto && !confirmed)}
          onClick={() => update("auto-low-risk")}
        >
          <strong>{busy === "auto-low-risk" ? "Enabling…" : "Delegated auto mode"}</strong>
          <span>Auto-authorise up to three eligible low-risk HTML or CSS plans.</span>
        </button>
      </div>
      {!auto ? (
        <label className="repair-policy-confirmation">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          <span>
            I authorise agent-submitted low-risk HTML or CSS plans that name repository files and checks.
          </span>
        </label>
      ) : (
        <div className="repair-policy-receipt" role="status">
          <ShieldCheck size={18} weight="fill" aria-hidden="true" />
          <span>
            {policy.remainingAutoApprovals} delegated approval{policy.remainingAutoApprovals === 1 ? "" : "s"} remain.
            JavaScript, headers, configuration, medium/high risk, deployment and deployment attestation stay gated.
          </span>
        </div>
      )}
      {error ? <p className="repair-error" role="alert">{error}</p> : null}
    </section>
  );
}

function SiteExploration({ report }) {
  const routes = Array.isArray(report.documentProfile?.routes) ? report.documentProfile.routes : [];
  const [selected, setSelected] = useState([]);
  const [explorations, setExplorations] = useState(() =>
    auditService.getSiteExplorations(report.auditId),
  );
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState("");
  const current = explorations[0] ?? null;

  useEffect(() => {
    let active = true;
    let timer;
    const sync = () => {
      if (active) setExplorations([...auditService.getSiteExplorations(report.auditId)]);
    };
    const unsubscribe = auditService.subscribe(sync);
    const poll = async () => {
      const mission = auditService.getSiteExplorations(report.auditId)[0];
      if (mission && ["queued", "running"].includes(mission.status)) {
        await auditService.getSiteExploration(report.auditId, mission.id).catch(() => {});
      }
      if (active) timer = window.setTimeout(poll, 900);
    };
    void auditService.listSiteExplorations(report.auditId).then(sync).catch(() => {});
    timer = window.setTimeout(poll, 900);
    return () => {
      active = false;
      unsubscribe();
      window.clearTimeout(timer);
    };
  }, [report.auditId]);

  if (!routes.length) return null;

  const togglePath = (path) => {
    setError("");
    setSelected((items) => {
      if (items.includes(path)) return items.filter((item) => item !== path);
      return items.length < 3 ? [...items, path] : items;
    });
  };

  const start = async () => {
    if (!selected.length) return;
    setIsStarting(true);
    setError("");
    try {
      await auditService.startSiteExploration(report.auditId, selected, "human");
      setSelected([]);
    } catch (cause) {
      setError(
        cause instanceof AuditError
          ? cause.message
          : "Frontmend could not start this site exploration.",
      );
    } finally {
      setIsStarting(false);
    }
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
        {routes.map((path) => {
          const active = selected.includes(path);
          const unavailable = !active && selected.length >= 3;
          return (
            <button
              type="button"
              key={path}
              aria-pressed={active}
              disabled={unavailable || isStarting}
              onClick={() => togglePath(path)}
            >
              <span aria-hidden="true">{active ? <Check size={13} weight="bold" /> : null}</span>
              <code>{path}</code>
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
                  <span>{issue.occurrenceCount} page{issue.occurrenceCount === 1 ? "" : "s"}</span>
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

function ReportWorkspace({ audit, onReset, onVerify, onAuditRoute }) {
  const report = audit.report;
  const isDocumentAudit = report.engine.mode === "live-document";
  const isHybridAudit = report.engine.mode === "hybrid-lighthouse-document";
  const isPartialLighthouse = report.engine.mode === "live-lighthouse-partial";
  const evidenceLabel = isDocumentAudit
    ? "live document evidence"
    : isHybridAudit
      ? "partial Lighthouse + document evidence"
      : isPartialLighthouse
        ? "partial Lighthouse evidence"
        : "live Lighthouse evidence";
  const viewportFailures = Array.isArray(report.viewportFailures) ? report.viewportFailures : [];
  const viewports = report.viewports?.length ? report.viewports : VIEWPORTS;
  const [viewportId, setViewportId] = useState(
    viewports.find((item) => item.id === "mobile")?.id ?? viewports[0]?.id,
  );
  const [selectedFindingId, setSelectedFindingId] = useState(report.findings[0]?.id ?? null);
  const [repairs, setRepairs] = useState(() => auditService.getRepairs(report.auditId));
  const [repairPolicy, setRepairPolicy] = useState(() => auditService.getRepairPolicy(report.auditId));
  const [shareState, setShareState] = useState("idle");
  const shareInputRef = useRef(null);
  const shareUrl = new URL(auditWorkspacePath(report.auditId), window.location.origin).href;
  const viewport = viewports.find((item) => item.id === viewportId) ?? viewports[0];
  const selectedFinding =
    report.findings.find((finding) => finding.id === selectedFindingId) ?? report.findings[0];
  const selectedFindingScope = selectedFinding
    ? report.findings.filter(
        (finding) =>
          finding.source?.provider === selectedFinding.source?.provider &&
          finding.source?.auditId === selectedFinding.source?.auditId,
      )
    : [];
  const selectedRepair = repairs.find((repair) => repair.findingId === selectedFinding?.id) ?? null;
  const omittedFindingCount = Math.max(
    0,
    Number.isFinite(report.findingsOmitted)
      ? report.findingsOmitted
      : (report.findingCount ?? report.findings.length) - report.findings.length,
  );

  useEffect(() => {
    let active = true;
    const refresh = () => {
      if (active) {
        setRepairs([...auditService.getRepairs(report.auditId)]);
        setRepairPolicy(auditService.getRepairPolicy(report.auditId));
      }
    };
    const unsubscribe = auditService.subscribe(refresh);
    void auditService.listRepairs(report.auditId).then(refresh).catch(() => {});
    return () => {
      active = false;
      unsubscribe();
    };
  }, [report.auditId]);

  const rememberRepair = (repair) => {
    setRepairs((current) => [...current.filter((item) => item.id !== repair.id), repair]);
    setRepairPolicy(auditService.getRepairPolicy(report.auditId));
  };

  const copyShareLink = async () => {
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

  return (
    <section className="report-view" aria-labelledby="report-title">
      <div className="report-heading">
        <div>
          <div className="report-nav-actions">
            <button className="back-button" type="button" onClick={onReset}>
              <ArrowLeft size={17} weight="bold" />
              New audit
            </button>
            {report.exploration?.parentAuditId ? (
              <a
                className="share-audit"
                href={auditWorkspacePath(report.exploration.parentAuditId)}
              >
                <ArrowLeft size={16} weight="bold" aria-hidden="true" />
                Parent audit
              </a>
            ) : null}
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
                  : "Share audit"}
            </button>
            <a
              className="share-audit"
              href={auditService.getAuditReportUrl(report.auditId)}
              download
            >
              <DownloadSimple size={16} weight="bold" aria-hidden="true" />
              Export report
            </a>
          </div>
          <p className="kicker">
            Audit complete · {evidenceLabel}
          </p>
          <h1 id="report-title">{report.hostname}</h1>
        </div>
        <div
          className="score-card"
          aria-label={`${isDocumentAudit ? "Document coverage" : "Measured frontend health"} score ${report.score} out of 100`}
        >
          <strong>{report.score}</strong>
          <span>{isDocumentAudit ? "Coverage" : "Health"}</span>
        </div>
      </div>

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

      <div className="summary-row" aria-label="Audit summary">
        <div>
          <span className="metric-good">{report.checks.passed}</span>
          <small>Checks passed</small>
        </div>
        <div>
          <span>{report.findingCount}</span>
          <small>Findings</small>
        </div>
        <div>
          <span>{report.viewportCount}</span>
          <small>Viewports measured</small>
        </div>
        <p>{report.engine.notice}</p>
      </div>

      {viewportFailures.length ? (
        <section className="viewport-failures" aria-labelledby="viewport-failures-title">
          <Warning size={19} weight="fill" aria-hidden="true" />
          <div>
            <strong id="viewport-failures-title">Partial viewport evidence retained</strong>
            <p>
              Frontmend kept every successful measurement instead of discarding the run. Unavailable
              strategies remain explicit and can be retried without turning them into inferred results.
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
                {report.documentSupplement.evaluatedRuleCount} non-overlapping document rules added · {report.documentSupplement.overlappingRulesOmitted} overlapping rules omitted from totals. Document evidence does not replace the unavailable viewport.
              </small>
            ) : null}
          </div>
        </section>
      ) : null}

      <VerificationBanner verification={report.verification} />

      {report.findings.length ? (
        <RepairPolicyControl
          auditId={report.auditId}
          policy={repairPolicy}
          onPolicyChange={setRepairPolicy}
        />
      ) : null}

      <RouteJourney
        exploration={report.exploration}
        currentPath={new URL(report.finalUrl ?? report.url).pathname}
      />

      <ObservedRoutes profile={report.documentProfile} onAuditRoute={onAuditRoute} />

      <SiteExploration report={report} />

      <div className="workspace-grid">
        <div className="preview-column">
          <div className="viewport-tabs" role="tablist" aria-label="Preview viewport">
            {viewports.map((item) => {
              const Icon = item.icon
                ?? (item.id === "mobile" ? DeviceMobile : item.id === "document" ? Browser : Desktop);
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={item.id === viewportId}
                  className={item.id === viewportId ? "active" : ""}
                  onClick={() => setViewportId(item.id)}
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
          />

          {selectedFinding ? (
            <article className="finding-detail">
              <div className="finding-detail-heading">
                <span className={`severity-badge ${selectedFinding.severity}`}>
                  <SeverityIcon severity={selectedFinding.severity} />
                  {selectedFinding.severity}
                </span>
                <span>{selectedFinding.viewport}</span>
              </div>
              <h2>{selectedFinding.title}</h2>
              <p>{selectedFinding.summary}</p>
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
                  <dt>Evidence</dt>
                  <dd>{selectedFinding.evidence}</dd>
                </div>
                <div>
                  <dt>Suggested repair</dt>
                  <dd>{selectedFinding.repair}</dd>
                </div>
              </dl>
              <CspResourceInventory context={selectedFinding.repairContext} />
            </article>
          ) : null}
          <RepairWorkbench
            auditId={report.auditId}
            finding={selectedFinding}
            repair={selectedRepair}
            onRepairChange={rememberRepair}
            onVerify={onVerify}
          />
        </div>

        <aside className="findings-panel" aria-label="Audit findings">
          <div className="findings-heading">
            <div>
              <p className="kicker">Evidence queue</p>
              <h2>What needs attention</h2>
            </div>
            <span>{report.findingCount}</span>
          </div>
          <div className="finding-list">
            {report.findings.map((finding, index) => (
              <button
                type="button"
                key={finding.id}
                className={finding.id === selectedFindingId ? "selected" : ""}
                onClick={() => {
                  setSelectedFindingId(finding.id);
                  if (finding.source?.strategy) setViewportId(finding.source.strategy);
                }}
              >
                <span className={`finding-index ${finding.severity}`}>{index + 1}</span>
                <span className="finding-copy">
                  <small>{finding.category}</small>
                  <strong>{finding.title}</strong>
                  <em>{finding.selector}</em>
                </span>
                <ArrowRight size={16} weight="bold" aria-hidden="true" />
              </button>
            ))}
            {!report.findings.length ? (
              <p className="empty-findings">No material failures were found in this audit slice.</p>
            ) : null}
          </div>
          {omittedFindingCount > 0 ? (
            <p className="findings-omitted" role="note">
              Showing the {report.findings.length} highest-priority findings. {omittedFindingCount} additional
              measured failure{omittedFindingCount === 1 ? " remains" : "s remain"} in the explicit
              rule-outcome record and export.
            </p>
          ) : null}
          <div className="agent-handoff">
            <Sparkle size={18} weight="fill" aria-hidden="true" />
            <p>
              {repairPolicy.mode === "auto-low-risk"
                ? "An agent can inspect the repository and submit an eligible low-risk mission under your recorded auto grant. Deployment remains yours."
                : "An agent can inspect the repository and submit a repair mission through WebMCP. You approve it in this shared workspace."}
            </p>
          </div>
        </aside>
      </div>
    </section>
  );
}

export function App() {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [audit, setAudit] = useState(() => auditService.getActiveAudit());
  const [showHow, setShowHow] = useState(false);
  const [showWebMcp, setShowWebMcp] = useState(false);
  const [showAgentActivity, setShowAgentActivity] = useState(false);
  const [agentActivities, setAgentActivities] = useState(() => auditService.getAgentActivities());
  const [isStarting, setIsStarting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const [isRestoring, setIsRestoring] = useState(false);
  const [webMcp, setWebMcp] = useState({
    supported: false,
    status: "unsupported",
    toolNames: [],
    errors: [],
  });
  const inputRef = useRef(null);
  const webMcpToolNames = contextualFrontmendToolNames(auditService);
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
    const auditId = auditIdFromPathname(window.location.pathname);
    if (!auditId || auditService.getActiveAudit()?.id === auditId) return undefined;
    let active = true;
    setIsRestoring(true);
    void auditService
      .getAudit(auditId)
      .then((next) => {
        if (!active) return;
        setAudit(next);
        setUrl(next.url);
      })
      .catch((cause) => {
        if (!active) return;
        window.history.replaceState(null, "", "/");
        setError(cause instanceof AuditError ? cause.message : "That shared audit could not be restored.");
      })
      .finally(() => {
        if (active) setIsRestoring(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!audit || ["complete", "failed", "cancelled"].includes(audit.status)) return undefined;
    let cancelled = false;
    let timer;
    const poll = async () => {
      try {
        const next = await auditService.getAudit(audit.id);
        if (cancelled) return;
        setAudit(next);
        if (!["complete", "failed", "cancelled"].includes(next.status)) {
          timer = window.setTimeout(poll, 1_500);
        }
      } catch (cause) {
        if (cancelled) return;
        setAudit({
          ...audit,
          status: "failed",
          phase: "failed",
          phaseLabel: "Live audit failed",
          error: {
            code: cause instanceof AuditError ? cause.code : "AUDIT_REQUEST_FAILED",
            message:
              cause instanceof AuditError
                ? cause.message
                : "Frontmend lost contact with the live audit service.",
          },
        });
      }
    };
    timer = window.setTimeout(poll, 600);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [audit?.id, audit?.status]);

  const mode = useMemo(() => {
    if (isRestoring) return "restore";
    if (!audit) return "landing";
    return audit.status === "complete" ? "report" : "progress";
  }, [audit, isRestoring]);

  const reset = () => {
    auditService.reset();
    setAudit(null);
    setUrl("");
    setError("");
    setIsStarting(false);
    setIsCancelling(false);
    setCancelError("");
    setIsRestoring(false);
    window.history.replaceState(null, "", "/");
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  const start = async (event) => {
    event?.preventDefault();
    setIsStarting(true);
    try {
      const next = await auditService.startAudit({ url, source: "human" });
      setUrl(next.url);
      setAudit(next);
      setError("");
      setCancelError("");
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
      const next = await auditService.startAudit({ url: audit.url, source: "human" });
      setUrl(next.url);
      setAudit(next);
      setError("");
      setCancelError("");
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
      setError("");
      window.history.replaceState(null, "", "/");
      window.requestAnimationFrame(() => inputRef.current?.focus());
    } catch (cause) {
      setCancelError(
        cause instanceof AuditError
          ? cause.message
          : "Frontmend could not cancel this audit. The job may still be running.",
      );
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
    <main className={`app-shell ${mode}`}>
      <header className="site-header">
        <Brand onClick={reset} />
        <div className="header-actions">
          <WebMcpStatus
            status={webMcp}
            expanded={showWebMcp}
            onClick={() => setShowWebMcp(true)}
          />
          <button
            className="agent-activity-trigger"
            type="button"
            aria-expanded={showAgentActivity}
            onClick={() => setShowAgentActivity(true)}
          >
            <Robot size={16} weight="bold" />
            Agent log
            {agentActivities.length ? <span>{agentActivities.length}</span> : null}
          </button>
          <button className="text-button" type="button" onClick={() => setShowHow(true)}>
            <Info size={17} weight="bold" />
            How it works
          </button>
        </div>
      </header>

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
        />
      ) : null}
      {mode === "progress" ? (
        <AuditProgress
          audit={audit}
          onCancelAudit={cancelAudit}
          onLeave={reset}
          onRetry={retry}
          isRetrying={isStarting}
          isCancelling={isCancelling}
          cancelError={cancelError}
        />
      ) : null}
      {mode === "restore" ? <RestoringAudit onCancel={reset} /> : null}
      {mode === "report" ? (
        <ReportWorkspace
          audit={audit}
          onReset={reset}
          onVerify={verifyRepair}
          onAuditRoute={auditRelatedRoute}
        />
      ) : null}

      <footer className="site-footer">
        <span>Find what broke. Prove the fix.</span>
        <span>Frontmend · Live audit engine</span>
      </footer>

      {showHow ? <HowItWorks onClose={() => setShowHow(false)} /> : null}
      {showWebMcp ? (
        <WebMcpCapabilitySheet status={webMcp} onClose={() => setShowWebMcp(false)} />
      ) : null}
      {showAgentActivity ? (
        <AgentActivityDrawer
          activities={agentActivities}
          onClose={() => setShowAgentActivity(false)}
          onClear={() => auditService.clearAgentActivities()}
        />
      ) : null}
    </main>
  );
}
