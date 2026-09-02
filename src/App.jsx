import {
  ArrowLeft,
  ArrowRight,
  Browser,
  Check,
  CheckCircle,
  Crosshair,
  FileCode,
  Gauge,
  Info,
  MagnifyingGlass,
  Pulse,
  Robot,
  SealCheck,
  ShieldCheck,
  Signature,
  Sparkle,
  Warning,
  X,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AuditError, auditService } from "./audit-service.js";
import {
  DiagnosisSpecimen,
  ReviewSpecimen,
  SelectionSpecimen,
  SiteSpecimen,
  VerifiedSpecimen,
} from "./ui/EvidenceSpecimens.jsx";
import { AUDIT_FOCUS_AREAS, createAuditMission } from "./audit-mission-contract.js";
import { ThinkingOrb } from "./ui/ThinkingOrb.jsx";
import { AuditMissionSummary } from "./ui/AuditMissionSummary.jsx";
import { humanMissionMutationFailure } from "./ui/human-mission-recovery.js";
import { LazyWorkspace } from "./ui/LazyWorkspace.jsx";
import { useDialogFocus } from "./ui/use-dialog-focus.js";
import { useRevealOnScroll } from "./ui/use-reveal-on-scroll.js";
import {
  contextualFrontmendToolNames,
  registerFrontmendTools,
} from "./webmcp.js";
import { FRONTMEND_TOOL_COUNT } from "./protocol-contract.js";

const HERO_SPECIMENS = [
  {
    id: "measured",
    index: "01",
    label: "Measured",
    facts: [{ text: "Insufficient text contrast" }, { text: "Mobile + desktop" }],
  },
  {
    id: "investigation",
    index: "02",
    label: "Browser investigation",
    facts: [{ text: ".hero__title", mono: true }, { text: "390 × 844", mono: true }],
  },
  {
    id: "diagnosis",
    index: "03",
    label: "Repository diagnosis",
    facts: [{ text: "src/styles.css:42", mono: true }, { text: "No source upload" }],
  },
  {
    id: "review",
    index: "04",
    label: "Human review",
    facts: [{ text: "Awaiting explicit approval" }],
  },
  {
    id: "verification",
    index: "05",
    label: "Fresh verification",
    facts: [{ text: "Root + retained route" }, { text: "Regression guardrails passed" }],
  },
];
const EVIDENCE_LOOP_STAGES = [
  {
    id: "measured",
    index: "01",
    label: "Measured",
    Icon: Gauge,
    summary:
      "A public measurement opens the mission. The rule that failed is named, with the viewports it was observed at and the provider that observed it.",
    record: [
      { term: "Finding", value: "Insufficient text contrast" },
      { term: "Observed at", value: "Mobile + desktop" },
      { term: "Source", value: "Lighthouse evidence" },
    ],
  },
  {
    id: "investigation",
    index: "02",
    label: "Browser investigation",
    Icon: Crosshair,
    summary:
      "A rendered browser check finds what static analysis cannot: the exact element, at the exact viewport, as a visitor actually sees it.",
    record: [
      { term: "Target", value: ".hero__title" },
      { term: "Viewport", value: "390 × 844" },
      { term: "Method", value: "Rendered observation" },
    ],
  },
  {
    id: "diagnosis",
    index: "03",
    label: "Repository diagnosis",
    Icon: FileCode,
    summary:
      "The finding is mapped to the declaration that causes it. Ownership stays bounded to what the public page and a connected agent can account for.",
    record: [
      { term: "Location", value: "src/styles.css:42" },
      { term: "Input", value: "No source upload" },
      { term: "Scope", value: "Bounded ownership" },
    ],
  },
  {
    id: "review",
    index: "04",
    label: "Human review",
    Icon: Signature,
    summary:
      "The repair is a proposal with its rationale attached. It waits here until a person decides — an agent cannot move it forward.",
    record: [
      { term: "State", value: "Awaiting explicit approval" },
      { term: "Authority", value: "Agent cannot approve" },
      { term: "Rationale", value: "Meets WCAG AA on this background" },
    ],
  },
  {
    id: "verification",
    index: "05",
    label: "Fresh verification",
    Icon: SealCheck,
    summary:
      "Only a fresh measurement closes the loop. The exact rule that failed is rerun, and the receipt links the audit IDs to the outcome.",
    record: [
      { term: "Rechecked", value: "Root + retained route" },
      { term: "Outcome", value: "Exact rule resolved" },
      { term: "Guardrails", value: "Regression guardrails passed" },
    ],
  },
];
const EVIDENCE_LOOP_MOVES = [
  {
    index: "01",
    title: "Measure the live URL",
    lede: "Public evidence starts the mission.",
    detail:
      "Frontmend retains mobile, desktop, and document evidence with its provider and limits attached, so every later step can say where a claim came from.",
    marks: ["Public pages only", "Provider and fallback stay visible", "No account for the first audit"],
  },
  {
    index: "02",
    title: "Investigate what automation misses",
    lede: "Rendered context and bounded diagnosis stay attached.",
    detail:
      "A browser agent takes one exact rendered check at a time through WebMCP, then maps a real issue to repository ownership. The same bounded task is available in Human mode.",
    marks: ["One check at a time", "Rendered, not inferred", "No source upload"],
  },
  {
    index: "03",
    title: "Review the fix, then prove it",
    lede: "A human approves. Fresh measurement closes the loop.",
    detail:
      "The site owner controls approval and deployment. Frontmend reruns the exact rule that failed and exports the receipt linking audit IDs, rule outcome, and metric deltas.",
    marks: ["Explicit approval", "Exact-rule recheck", "Exportable receipt"],
  },
];
const AGENT_CAPABILITIES = [
  "Start an audit from a public URL",
  "Take one bounded rendered-browser check at a time",
  "Map a finding to repository ownership",
  "Draft a repair and the rationale behind it",
  "Request a fresh measurement after a deployment",
];
const HUMAN_ONLY_AUTHORITY = [
  "Decide what the repair should be",
  "Approve a proposed repair",
  "Deploy it to the live site",
  "Attest that it actually shipped",
];
/*
 * One illustrative receipt per audit focus area. Every rule id is a real
 * Lighthouse audit, and the accessibility ratios are the true WCAG figures for
 * the two colours in the repair diff shown elsewhere on the page
 * (#6b7280 -> #111827 on --fm-paper). Illustrations, not measurements.
 */
const CLOSING_PROOFS = [
  {
    id: "accessibility",
    area: "Accessibility",
    rule: "color-contrast",
    target: ".hero__title",
    rechecked: "Root + retained route",
    before: { value: "4.19:1", note: "failed" },
    after: { value: "15.3:1", note: "passes AA" },
  },
  {
    id: "seo",
    area: "SEO",
    rule: "meta-description",
    target: "<head>",
    rechecked: "Root + retained route",
    before: { value: "absent", note: "no summary" },
    after: { value: "148 ch", note: "within range" },
  },
  {
    id: "performance",
    area: "Performance",
    rule: "largest-contentful-paint",
    target: "/hero-poster.jpg",
    rechecked: "Mobile + desktop",
    before: { value: "4.8 s", note: "poor" },
    after: { value: "2.1 s", note: "good" },
  },
  {
    id: "security",
    area: "Security",
    rule: "csp-xss",
    target: "Response headers",
    rechecked: "Root + retained route",
    before: { value: "absent", note: "no policy" },
    after: { value: "enforced", note: "9 directives" },
  },
  {
    id: "reliability",
    area: "Reliability",
    rule: "errors-in-console",
    target: "Rendered page",
    rechecked: "Mobile + desktop",
    before: { value: "3", note: "console errors" },
    after: { value: "0", note: "clean" },
  },
];
const LANDING_FAQ = [
  {
    question: "Does Frontmend change my website?",
    answer:
      "No. It measures public pages and drafts a repair for you to review. A person approves, deploys, and attests the deployment — Frontmend never edits or ships the site it audited.",
  },
  {
    question: "Do I need to upload my source code?",
    answer:
      "No. Diagnosis is bounded to what the public page reveals plus the repository ownership a connected agent reports. There is no source upload step and no repository access.",
  },
  {
    question: "What does it actually measure?",
    answer:
      "Accessibility, SEO, performance, security, and reliability. Frontmend uses PageSpeed Insights and Lighthouse when the provider is available, and falls back to a bounded live-document read when it is not. The evidence mode and its limits stay visible on every finding.",
  },
  {
    question: "What can it reach?",
    answer:
      "Public pages only. Credentials, private and loopback networks, metadata endpoints, unsafe schemes, and redirects that cross into blocked targets are all rejected on the server, and time, byte, and rate limits apply before any URL is accepted.",
  },
  {
    question: "What is WebMCP doing here?",
    answer:
      "A browser agent can drive the same audit through structured tools that call the same validated services the human interface uses. WebMCP is a control surface, not the engine — and the complete workflow stays usable when document.modelContext is unavailable.",
  },
  {
    question: "How do I know the fix held?",
    answer:
      "Verification reruns the exact rule that failed against a fresh measurement, across the root and any retained route. Frontmend only reports a finding as resolved when a comparable fresh audit no longer observes that rule.",
  },
];
/*
 * The three handoffs, as shown in the how-it-works dialog and on /how-it-works.
 * `marks` are the standing constraints of each handoff, not measurements: they
 * restate the same boundaries the landing page and the audit services enforce.
 */
const HOW_IT_WORKS_STEPS = [
  {
    label: "01",
    title: "Measure the live URL",
    Icon: Gauge,
    detail: "Retain mobile, desktop, and document evidence with its provider and limits attached.",
    marks: ["Public pages only", "Provider and fallback stay visible", "No account for the first audit"],
  },
  {
    label: "02",
    title: "Inspect what automation misses",
    Icon: Crosshair,
    detail: "WebMCP gives the agent one exact rendered-browser check at a time, then maps real issues to repository ownership.",
    marks: ["One bounded check at a time", "Rendered, not inferred", "No source upload"],
  },
  {
    label: "03",
    title: "Review the fix, then prove it",
    Icon: SealCheck,
    detail: "The site owner controls approval and deployment; Frontmend reruns the exact rule and exports the fresh receipt.",
    marks: ["Explicit human approval", "Exact-rule recheck", "Exportable receipt"],
  },
];
const HOW_IT_WORKS_BOUNDS = [
  { term: "Reach", value: "Public pages" },
  { term: "Source access", value: "None" },
  { term: "Approval", value: "Person-owned" },
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
const DEFAULT_HUMAN_AUDIT_FOCUS_AREAS = Object.freeze([...AUDIT_FOCUS_AREAS]);
const WEBMCP_TOOL_COUNT = FRONTMEND_TOOL_COUNT;
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
      <span className="brand-icon" aria-hidden="true">
        <img
          src="/assets/images/icon_logo.png"
          alt=""
          width="1254"
          height="1254"
          draggable="false"
        />
      </span>
      <span className="brand-wordmark" aria-hidden="true">
        <img
          src="/assets/images/full_logo.png"
          alt=""
          width="2172"
          height="724"
          draggable="false"
        />
      </span>
    </button>
  );
}

/*
 * `restoring` withholds the contextual tools, and it stays true after a
 * restoration fails - the tools really are still paused, because there is no
 * authoritative workspace to scope them to. But "restoring" describes work in
 * progress, and on a dead audit address no work is happening or ever will. The
 * state is the same; the word for it is not.
 */
function WebMcpStatus({ status, expanded, restoring, restoreFailed, onClick, buttonRef }) {
  const ready = status.status === "ready";
  const failed = status.status === "error";
  const activeCount = status.activeTools ?? status.toolNames.length;
  const totalCount = status.totalTools ?? WEBMCP_TOOL_COUNT;
  const label = restoring
    ? restoreFailed
      ? "WebMCP · paused"
      : "WebMCP · restoring"
    : ready
      ? "WebMCP ready"
      : status.status === "registering"
        ? "WebMCP · syncing"
        : failed
          ? `WebMCP · ${status.toolNames.length}/${activeCount} active`
          : "Human mode";
  const accessibleLabel = restoring
    ? restoreFailed
      ? "WebMCP tools stay paused until an audit workspace is restored or a new audit starts"
      : "WebMCP tools paused while Frontmend restores authoritative audit state"
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
          ? restoreFailed
            ? "Contextual tools resume once an audit workspace is restored, or when a new audit starts."
            : "Contextual tools resume after authoritative state is restored."
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

function AgentActivityDrawer({ activities, onClose }) {
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
        {/*
         * The panel is titled with the name of the control that opens it. It
         * used to read "WebMCP activity" under a "Browser agent" kicker, while
         * the header button said "Agent log" and the close button said "agent
         * activity" - four names for one feature, and the visitor arrived at a
         * panel that did not admit to being the thing they clicked.
         *
         * No kicker. A small uppercase label pairing a protocol name with a
         * scope is decoration, and everything it would have said - where the
         * entries come from, how far back they go - the boundary note below
         * says in a sentence.
         */}
        <div className="agent-activity-heading">
          <h2 id="agent-activity-title">Agent log</h2>
          <button type="button" aria-label="Close agent log" onClick={onClose}>
            <X size={18} weight="bold" />
          </button>
        </div>
        <p className="agent-activity-boundary" id="agent-activity-boundary">
          <ShieldCheck size={15} weight="duotone" aria-hidden="true" />
          <span>
            Semantic actions only. Tool inputs, URLs, patches, prompts, and secrets are not logged
            here. The last 20 completed actions are retained with this audit.
          </span>
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
                    {Number.isInteger(activity.missionRevisionBefore) && Number.isInteger(activity.missionRevisionAfter)
                      ? ` · revision ${activity.missionRevisionBefore}→${activity.missionRevisionAfter}`
                      : ""}
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
      </aside>
    </div>
  );
}

/*
 * How it works.
 *
 * This is a marketing surface, not a workspace one: it explains the same loop
 * the landing page argues for, and it is usually the first thing a visitor
 * clicks. So it is built in the cobalt system (see design.md section 8) and it
 * demonstrates the loop rather than describing it - a real tablist over the
 * three handoffs, driving the same illustrative specimens the landing uses.
 *
 * It advances itself, 4s a handoff, and wraps, with no transport controls: the
 * walkthrough is the point of the dialog, and a play button next to it was
 * chrome around a thing that should just run.
 *
 * That is a continuous auto-update, so the mechanism WCAG 2.2.2 asks for still
 * has to exist - it is the rail itself. Touching it at all, by click, arrow key
 * or Tab, stops the advance for good, because the visitor has taken over and
 * the panel must not move under them again. It never starts under
 * prefers-reduced-motion, read as live state so a preference changed
 * mid-session is obeyed. The mission inspector is still the reference for
 * workspace dialogs.
 */
const HOW_IT_WORKS_DWELL = 4000;

function HowItWorksDemo({ stage }) {
  if (stage === "01") return <SiteSpecimen state="unresolved" split />;
  if (stage === "02") return <SelectionSpecimen />;
  return <VerifiedSpecimen />;
}

/*
 * The instrument layer over the specimen.
 *
 * The specimen alone is a picture of a website; what the visitor came to see is
 * Frontmend working on one. This layer adds the observation - capture brackets,
 * a readout of what this handoff is looking at, and a sequence per step: a
 * measuring sweep that ends in a finding, a cursor that lands on the element
 * under inspection, and the same sweep run a second time as a before/after
 * reveal.
 *
 * That last one is why the sweep belongs to two steps, moving identically in
 * both. On 03 the unresolved specimen is stacked over the resolved one and
 * clipped to the sweep's leading edge, so the line does not describe the repair
 * - it carries it. Behind the line the burnt panel, the dim title and the
 * finding flag are already the paper, the ink and the seal. Both layers are the
 * same illustrative specimens the landing uses for before and after.
 *
 * The transients render only when motion is allowed. Their finished state is
 * absence, and the motion contract forbids parking anything at opacity 0
 * outside a keyframe, so under prefers-reduced-motion they are simply not in
 * the DOM and the exhibit stands as a complete, still composition.
 *
 * Every readout describes the illustration, never a measurement: the frame is
 * aria-hidden and the visible caption below it says so.
 */
const HOW_IT_WORKS_READOUTS = {
  "01": "contrast · mobile + desktop",
  "02": "rendered · 390 × 844",
  "03": "re-run · contrast AA",
};

function HowItWorksInstruments({ stage, still }) {
  return (
    <span className="loop-demo-layer" aria-hidden="true">
      {!still && stage === "03" ? (
        <span className="loop-demo-before">
          <SiteSpecimen state="unresolved" />
        </span>
      ) : null}
      {!still && (stage === "01" || stage === "03") ? <span className="loop-demo-scan" /> : null}
      {!still && stage === "02" ? (
        <span className="loop-demo-cursor">
          <svg viewBox="0 0 24 24" focusable="false">
            <circle cx="12" cy="12" r="5" />
            <path d="M12 0v6M12 18v6M0 12h6M18 12h6" />
          </svg>
        </span>
      ) : null}
      {!still && stage === "03" ? <span className="loop-demo-pulse" /> : null}
      <span className="loop-demo-readout">{HOW_IT_WORKS_READOUTS[stage]}</span>
    </span>
  );
}

function HowItWorks({ onClose }) {
  const dialogRef = useDialogFocus(onClose);
  const tabRefs = useRef({});
  const [activeLabel, setActiveLabel] = useState(HOW_IT_WORKS_STEPS[0].label);
  const [playing, setPlaying] = useState(true);
  const [stillPreferred, setStillPreferred] = useState(false);
  const [tabHidden, setTabHidden] = useState(false);
  const activeIndex = Math.max(
    0,
    HOW_IT_WORKS_STEPS.findIndex((step) => step.label === activeLabel),
  );
  const active = HOW_IT_WORKS_STEPS[activeIndex];

  /*
   * Reduced motion stops the walkthrough rather than the dialog. It is read as
   * live state, not once, so a visitor who changes the preference mid-session
   * is obeyed; pressing play afterwards is a request and overrides it.
   */
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return undefined;
    const sync = () => {
      setStillPreferred(query.matches);
      if (query.matches) setPlaying(false);
    };
    sync();
    query.addEventListener?.("change", sync);
    return () => query.removeEventListener?.("change", sync);
  }, []);

  /*
   * A backgrounded tab advances nothing. Browsers already throttle the timer and
   * stop compositing the animations, but the walkthrough is the one thing here
   * that runs forever, so it should cost nothing at all while unwatched rather
   * than nearly nothing. Coming back re-arms a whole dwell.
   */
  useEffect(() => {
    const sync = () => setTabHidden(document.hidden);
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  // One timer, re-armed by the handoff it lands on, so the loop wraps.
  useEffect(() => {
    if (!playing || tabHidden) return undefined;
    const timer = window.setTimeout(() => {
      const next = HOW_IT_WORKS_STEPS[(activeIndex + 1) % HOW_IT_WORKS_STEPS.length];
      setActiveLabel(next.label);
    }, HOW_IT_WORKS_DWELL);
    return () => window.clearTimeout(timer);
  }, [playing, tabHidden, activeIndex]);

  const moveTo = (index, { focus = true } = {}) => {
    const total = HOW_IT_WORKS_STEPS.length;
    const next = HOW_IT_WORKS_STEPS[(index + total) % total];
    setPlaying(false);
    setActiveLabel(next.label);
    if (focus) tabRefs.current[next.label]?.focus();
  };

  const onKeyDown = (event) => {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      moveTo(activeIndex + 1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      moveTo(activeIndex - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      moveTo(0);
    } else if (event.key === "End") {
      event.preventDefault();
      moveTo(HOW_IT_WORKS_STEPS.length - 1);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        id="how-it-works-dialog"
        tabIndex="-1"
        className="loop-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="how-title"
        aria-describedby="how-description"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          className="loop-dialog-close"
          type="button"
          onClick={onClose}
          aria-label="Close how it works"
        >
          <X size={18} weight="bold" />
        </button>

        <header className="loop-dialog-head">
          <div>
            <p className="loop-dialog-kicker">The Frontmend loop</p>
            <h2 id="how-title">Measure. Inspect. Prove it held.</h2>
          </div>
          <p id="how-description">
            Three handoffs, each keeping its evidence separate — so every step states what is
            known, who established it, and what still needs proof.
          </p>
        </header>

        <dl className="loop-dialog-bounds">
          {HOW_IT_WORKS_BOUNDS.map((bound) => (
            <div key={bound.term}>
              <dt>{bound.term}</dt>
              <dd>{bound.value}</dd>
            </div>
          ))}
        </dl>

        <div
          className="loop-dialog-rail"
          role="tablist"
          aria-label="The three evidence handoffs"
          onKeyDown={onKeyDown}
          /*
           * Tabbing into the rail pauses too. Someone reading with a keyboard
           * or a screen reader should not have the panel move out from under
           * them, and reaching the rail is the moment they have taken over.
           */
          onFocus={() => setPlaying(false)}
        >
          {HOW_IT_WORKS_STEPS.map(({ label, title, Icon }, index) => {
            const selected = label === activeLabel;
            return (
              <button
                key={label}
                ref={(node) => {
                  tabRefs.current[label] = node;
                }}
                type="button"
                role="tab"
                id={`how-tab-${label}`}
                className="loop-dialog-tab"
                data-step={label}
                data-state={index < activeIndex ? "done" : selected ? "current" : "upcoming"}
                aria-selected={selected}
                aria-controls="how-panel"
                tabIndex={selected ? 0 : -1}
                onClick={() => moveTo(index, { focus: false })}
              >
                <span className="loop-dialog-mark" aria-hidden="true">
                  <Icon size={19} weight="bold" />
                </span>
                <span className="loop-dialog-index">Step {label}</span>
                <span className="loop-dialog-tab-title">{title}</span>
              </button>
            );
          })}
        </div>

        <div
          className="loop-dialog-panel"
          id="how-panel"
          role="tabpanel"
          aria-labelledby={`how-tab-${active.label}`}
          key={active.label}
          tabIndex={-1}
        >
          <div className="loop-dialog-detail">
            <h3>{active.title}</h3>
            <p>{active.detail}</p>
            {/*
             * The marks are standing constraints, not measurements, and three
             * bare rows did not say so. The label names them, and it rhymes
             * with the bounds strip above — the same claim, narrowed to one
             * handoff.
             */}
            <p className="loop-dialog-marks-label">What holds at this step</p>
            <ul className="loop-dialog-marks">
              {active.marks.map((mark) => (
                <li key={mark}>{mark}</li>
              ))}
            </ul>
          </div>
          {/*
           * The caption is visible, not sr-only. The specimen is a convincing
           * little website, and an unlabelled one sitting inside a product
           * dialog invites the reading that Frontmend measured somebody's page.
           * Everyone gets the disclaimer, not only screen reader users.
           */}
          <figure className="loop-dialog-exhibit">
            {/*
             * The capture brackets sit outside the frame, not on the specimen.
             * Inside, they fought the flag and the seal for the same corner, and
             * they belong to Frontmend rather than to the website being shown —
             * registration marks around the exhibit, in our own space.
             */}
            <div className="loop-dialog-exhibit-stage">
              <div className="loop-dialog-exhibit-frame" data-stage={active.label} aria-hidden="true">
                <HowItWorksDemo stage={active.label} />
                <HowItWorksInstruments stage={active.label} still={stillPreferred} />
              </div>
              <span className="loop-demo-corners" aria-hidden="true">
                <span />
                <span />
                <span />
                <span />
              </span>
            </div>
            <figcaption className="loop-dialog-exhibit-note">
              Illustration of one example contrast issue at this handoff — not a measurement of a
              real website.
            </figcaption>
          </figure>
        </div>

        <footer className="loop-dialog-foot">
          <p className="loop-dialog-authority">
            <ShieldCheck size={20} weight="duotone" aria-hidden="true" />
            Agents measure, investigate, and prepare reviewable work. A person keeps repair intent,
            approval, deployment, and the attestation that it shipped.
          </p>
          <a className="loop-dialog-link" href="/how-it-works">
            Full walkthrough
            <ArrowRight size={15} weight="bold" aria-hidden="true" />
          </a>
        </footer>
      </section>
    </div>
  );
}

/*
 * /how-it-works.
 *
 * The crawlable long-form counterpart to the loop dialog, in the same cobalt
 * marketing system. Where the dialog shows one handoff at a time and plays
 * itself through, the page shows all three at once with room for the full
 * argument - a page has no interaction budget to spend.
 *
 * Bands alternate cobalt and cream, as every long marketing surface must.
 */
const GUIDE_MOVE_SPECIMENS = [SiteSpecimen, SelectionSpecimen, ReviewSpecimen];
/* The same three marks the loop dialog uses, so the page reads as its long form. */
const GUIDE_MOVE_ICONS = [Gauge, Crosshair, SealCheck];

function HowItWorksPage() {
  return (
    <>
      <section className="guide-hero" aria-labelledby="how-page-title">
        <div className="evidence-loop-shell">
          <p className="section-kicker">The Frontmend loop</p>
          <h1 id="how-page-title" className="guide-hero-title">
            Measure. Inspect.<span className="editorial-break"> </span>Prove it held.
          </h1>
          <p className="guide-hero-lede">
            Frontmend keeps provider, browser, repository, and verification evidence separate, so
            every next step says what is known, who established it, and what still needs proof.
          </p>
          <dl className="guide-bounds">
            {HOW_IT_WORKS_BOUNDS.map((bound) => (
              <div key={bound.term}>
                <dt>{bound.term}</dt>
                <dd>{bound.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="guide-moves" aria-labelledby="guide-moves-title">
        <div className="evidence-loop-shell">
          <h2 id="guide-moves-title" className="sr-only">The three handoffs</h2>
          <ol className="guide-move-list">
            {EVIDENCE_LOOP_MOVES.map((move, index) => {
              const Specimen = GUIDE_MOVE_SPECIMENS[index];
              const Icon = GUIDE_MOVE_ICONS[index];
              return (
                <li className="guide-move" key={move.index}>
                  <p className="guide-move-mark" aria-hidden="true">
                    <Icon size={20} weight="bold" />
                  </p>
                  <div className="guide-move-body">
                    <p className="guide-move-index">{move.index}</p>
                    <h3>{move.title}</h3>
                    <p className="guide-move-lede">{move.lede}</p>
                    <p className="guide-move-detail">{move.detail}</p>
                    <ul className="guide-move-marks">
                      {move.marks.map((mark) => (
                        <li key={mark}>{mark}</li>
                      ))}
                    </ul>
                  </div>
                  <figure className="guide-move-exhibit">
                    <div className="loop-dialog-exhibit-frame" aria-hidden="true">
                      {index === 0 ? <Specimen state="unresolved" split /> : <Specimen />}
                    </div>
                    <figcaption className="sr-only">
                      An illustration of one example contrast issue at this handoff. It is not a
                      measurement of a real website.
                    </figcaption>
                  </figure>
                </li>
              );
            })}
          </ol>
        </div>
      </section>

      <section className="ledger" aria-labelledby="guide-ledger-title">
        <div className="evidence-loop-shell">
          <div className="ledger-head">
            <div>
              <p className="section-kicker">The authority boundary</p>
              <h2 id="guide-ledger-title" className="section-title">
                An agent can do the work.<span className="editorial-break"> </span>
                Only a person can approve it.
              </h2>
            </div>
            <p className="ledger-note">
              Frontmend exposes the same validated services to a browser agent and to you. The line
              between preparing work and authorising it never moves.
            </p>
          </div>
          <div className="ledger-columns">
            <div className="ledger-column" data-side="agent">
              <h3>
                <Robot size={17} weight="bold" aria-hidden="true" />
                An agent may
              </h3>
              <ul>
                {AGENT_CAPABILITIES.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div className="ledger-column" data-side="human">
              <h3>
                <ShieldCheck size={17} weight="bold" aria-hidden="true" />
                Only a person may
              </h3>
              <ul>
                {HUMAN_ONLY_AUTHORITY.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
          <p className="ledger-fallback">
            The complete workflow stays usable when <code>document.modelContext</code> is
            unavailable.
          </p>
        </div>
      </section>

      <section className="guide-closing" aria-labelledby="guide-closing-title">
        <div className="evidence-loop-shell">
          <div className="guide-closing-card">
            <div>
              <p className="section-kicker">Close the loop</p>
              <h2 id="guide-closing-title" className="guide-closing-title">
                Start with one public URL.
              </h2>
              <p>
                No account for the first audit. Frontmend measures the public page, prepares a
                reviewable repair, and reruns the exact rule once you have deployed it.
              </p>
              <a className="guide-closing-cta" href="/">
                Start a site audit
                <ArrowRight size={17} weight="bold" aria-hidden="true" />
              </a>
            </div>
            <figure className="guide-closing-exhibit">
              <div className="loop-dialog-exhibit-frame" aria-hidden="true">
                <VerifiedSpecimen />
              </div>
              <figcaption className="sr-only">
                An illustration of the same example page after a verified repair. It is not a
                measurement of a real website.
              </figcaption>
            </figure>
          </div>
        </div>
      </section>
    </>
  );
}

function EvidenceSpecimen({ stage }) {
  if (stage === "measured") return <SiteSpecimen state="unresolved" split />;
  if (stage === "investigation") return <SelectionSpecimen />;
  if (stage === "diagnosis") return <DiagnosisSpecimen />;
  if (stage === "review") return <ReviewSpecimen />;
  return <VerifiedSpecimen />;
}

function EvidenceLoop() {
  const [activeId, setActiveId] = useState(EVIDENCE_LOOP_STAGES[0].id);
  const tabRefs = useRef({});
  const activeIndex = Math.max(
    0,
    EVIDENCE_LOOP_STAGES.findIndex((stage) => stage.id === activeId),
  );
  const active = EVIDENCE_LOOP_STAGES[activeIndex];

  const moveTo = (index) => {
    const next = EVIDENCE_LOOP_STAGES[(index + EVIDENCE_LOOP_STAGES.length) % EVIDENCE_LOOP_STAGES.length];
    setActiveId(next.id);
    tabRefs.current[next.id]?.focus();
  };

  const onKeyDown = (event) => {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      moveTo(activeIndex + 1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      moveTo(activeIndex - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      moveTo(0);
    } else if (event.key === "End") {
      event.preventDefault();
      moveTo(EVIDENCE_LOOP_STAGES.length - 1);
    }
  };

  return (
    <section className="evidence-loop" id="evidence-loop" aria-labelledby="evidence-loop-title">
      <div className="evidence-loop-intro">
        <div className="evidence-loop-shell">
          <svg
            className="evidence-loop-thread"
            viewBox="0 0 100 100"
            fill="none"
            aria-hidden="true"
            focusable="false"
          >
            <path
              d="M92 0 V54 Q92 68 78 68 H22 Q8 68 8 82 V100"
              stroke="currentColor"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          <p className="evidence-loop-kicker">The evidence loop</p>
          <h2 id="evidence-loop-title" className="evidence-loop-title">
            One issue. Five accountable handoffs.
          </h2>
          <p className="evidence-loop-lede">
            The finding never loses its source, owner, approval state, or proof. Step through the
            same contrast issue as it changes hands.
          </p>
          <a className="evidence-loop-link" href="/how-it-works">
            Follow one contrast issue
            <ArrowRight size={17} weight="bold" aria-hidden="true" />
          </a>
        </div>
      </div>

      <div className="evidence-loop-field">
        <div className="evidence-loop-shell">
          <div
            className="stage-rail"
            role="tablist"
            aria-label="The five evidence handoffs"
            aria-orientation="horizontal"
            onKeyDown={onKeyDown}
          >
            <span className="stage-rail-track" aria-hidden="true">
              <span
                className="stage-rail-fill"
                style={{
                  "--rail-fill": `${(activeIndex / (EVIDENCE_LOOP_STAGES.length - 1)) * 100}%`,
                }}
              />
            </span>
            {EVIDENCE_LOOP_STAGES.map((stage, index) => {
              const selected = stage.id === activeId;
              return (
                <button
                  key={stage.id}
                  ref={(node) => {
                    tabRefs.current[stage.id] = node;
                  }}
                  type="button"
                  role="tab"
                  id={`stage-tab-${stage.id}`}
                  className="stage-tab"
                  data-stage={stage.id}
                  data-state={index < activeIndex ? "done" : selected ? "current" : "upcoming"}
                  aria-selected={selected}
                  aria-controls="stage-panel"
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setActiveId(stage.id)}
                >
                  <span className="stage-tab-mark" aria-hidden="true">
                    <stage.Icon size={19} weight="bold" />
                  </span>
                  <span className="stage-tab-index" aria-hidden="true">{stage.index}</span>
                  <span className="stage-tab-label">{stage.label}</span>
                </button>
              );
            })}
          </div>

          <div
            className="stage-panel"
            id="stage-panel"
            role="tabpanel"
            aria-labelledby={`stage-tab-${active.id}`}
            data-stage={active.id}
            key={active.id}
            tabIndex={-1}
          >
            <div className="stage-detail">
              <p className="stage-detail-index" aria-hidden="true">{active.index}</p>
              <h3 className="stage-detail-title">{active.label}</h3>
              <p className="stage-detail-summary">{active.summary}</p>
              <dl className="stage-detail-facts">
                {active.record.map((entry) => (
                  <div key={entry.term}>
                    <dt>{entry.term}</dt>
                    <dd>{entry.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <figure className="stage-exhibit">
              <div className="stage-exhibit-frame" aria-hidden="true">
                <EvidenceSpecimen stage={active.id} />
              </div>
              <figcaption>
                Illustration of one example contrast issue at this handoff. It is not a measurement
                of a real website.
              </figcaption>
            </figure>
          </div>

          <p className="evidence-loop-boundary">
            Agents cannot approve repairs or attest deployment.
          </p>
        </div>
      </div>
    </section>
  );
}

function EvidenceMoves() {
  const revealRef = useRevealOnScroll();
  return (
    <section className="moves" aria-labelledby="moves-title" ref={revealRef}>
      <div className="evidence-loop-shell">
        <p className="section-kicker">Three moves</p>
        <h2 id="moves-title" className="section-title">
          Measure it. Investigate it. Prove it held.
        </h2>
        <ol className="moves-list">
          {EVIDENCE_LOOP_MOVES.map((move) => (
            <li className="move" key={move.index} data-reveal-item>
              <p className="move-index" aria-hidden="true">{move.index}</p>
              <div className="move-body">
                <h3>{move.title}</h3>
                <p className="move-lede">{move.lede}</p>
                <p className="move-detail">{move.detail}</p>
              </div>
              <ul className="move-marks">
                {move.marks.map((mark) => (
                  <li key={mark}>{mark}</li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function AuthorityLedger() {
  const revealRef = useRevealOnScroll();
  return (
    <section className="ledger" aria-labelledby="ledger-title" ref={revealRef}>
      <div className="evidence-loop-shell">
        <div className="ledger-head">
          <div>
            <p className="section-kicker">The authority boundary</p>
            <h2 id="ledger-title" className="section-title">
              An agent can do the work.<span className="editorial-break"> </span>
              Only a person can approve it.
            </h2>
          </div>
          <p className="ledger-note">
            Frontmend exposes the same validated services to a browser agent and to you. The line
            between preparing work and authorising it never moves.
          </p>
        </div>
        <div className="ledger-columns">
          <div className="ledger-column" data-side="agent">
            <h3>
              <Robot size={17} weight="bold" aria-hidden="true" />
              An agent may
            </h3>
            <ul>
              {AGENT_CAPABILITIES.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div className="ledger-column" data-side="human">
            <h3>
              <ShieldCheck size={17} weight="bold" aria-hidden="true" />
              Only a person may
            </h3>
            <ul>
              {HUMAN_ONLY_AUTHORITY.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
        <p className="ledger-fallback">
          The complete workflow stays usable when <code>document.modelContext</code> is unavailable.
        </p>
      </div>
    </section>
  );
}

function LandingFaq() {
  const revealRef = useRevealOnScroll();
  return (
    <section className="faq" aria-labelledby="faq-title" ref={revealRef}>
      <div className="evidence-loop-shell">
        <div className="faq-head">
          <p className="section-kicker">Before you start</p>
          <h2 id="faq-title" className="section-title">
            What Frontmend does, and what it will not do.
          </h2>
        </div>
        <div className="faq-list">
          {LANDING_FAQ.map((entry) => (
            <details className="faq-entry" key={entry.question}>
              <summary>
                <span>{entry.question}</span>
                <span className="faq-marker" aria-hidden="true" />
              </summary>
              <div className="faq-answer">
                <p>{entry.answer}</p>
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/*
 * A revolving set of illustrative receipts, one per audit focus area, so the
 * closing mark shows breadth rather than a single example.
 *
 * Rotation is genuinely optional: it never starts under reduced motion, pauses
 * on hover and focus, stops for good once a control is used, and ships a real
 * pause button so the motion can always be stopped (WCAG 2.2.2). Only the
 * active card is exposed to assistive technology, so the rotation never
 * announces itself.
 */
/*
 * A hand of five illustrative receipts, one per audit focus area, that sweeps:
 * each card lifts to the front in turn.
 *
 * The sweep never starts under reduced motion, and it pauses while the pointer
 * or keyboard focus is anywhere in the closing card. There is deliberately no
 * pause control — see DESIGN.md for the tradeoff that carries.
 */
const FAN_SPAN = 2;
/*
 * The sweep's cadence, split so the intent stays readable: a card animates for
 * FAN_TRANSITION_MS, then holds at centre for FAN_REST_MS before the next
 * advance. FAN_TRANSITION_MS must track the .closing-proof-card transition in
 * landing.css - if that changes and this does not, the rest shortens silently.
 */
const FAN_TRANSITION_MS = 620;
const FAN_REST_MS = 2000;

/** Signed slot for a card, wrapped so the deck reads as a loop. */
function fanOffset(position, index, total) {
  let offset = position - index;
  if (offset > FAN_SPAN) offset -= total;
  if (offset < -FAN_SPAN) offset += total;
  return offset;
}

function ClosingProofs({ held }) {
  // `jump` is the one card that teleports from the far left slot to the far
  // right on each advance. It renders without a transition in the same commit
  // as its new slot, so it never flies back across the deck.
  const [fan, setFan] = useState({ index: 0, jump: -1 });

  useEffect(() => {
    if (held) return undefined;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (reduced?.matches) return undefined;
    const total = CLOSING_PROOFS.length;
    const timer = window.setInterval(() => {
      setFan(({ index }) => {
        const next = (index + 1) % total;
        return { index: next, jump: (next + FAN_SPAN) % total };
      });
    }, FAN_TRANSITION_MS + FAN_REST_MS);
    const stop = () => {
      if (reduced.matches) window.clearInterval(timer);
    };
    reduced?.addEventListener?.("change", stop);
    return () => {
      window.clearInterval(timer);
      reduced?.removeEventListener?.("change", stop);
    };
  }, [held]);

  return (
    <>
      <div className="closing-proof" aria-hidden="true">
        <div className="closing-proof-stage">
          {CLOSING_PROOFS.map((proof, position) => {
            const offset = fanOffset(position, fan.index, CLOSING_PROOFS.length);
            return (
              <div
                className="closing-proof-card"
                key={proof.id}
                data-active={offset === 0 ? "true" : "false"}
                data-jump={position === fan.jump ? "true" : undefined}
                style={{ "--fan-offset": offset, "--fan-abs": Math.abs(offset) }}
              >
                <p className="closing-proof-head">
                  {proof.area}
                  <span className="closing-proof-seal">
                    <SealCheck size={14} weight="fill" />
                  </span>
                </p>
                <div className="closing-proof-delta">
                  <span className="is-before">
                    <strong>{proof.before.value}</strong>
                    <small>{proof.before.note}</small>
                  </span>
                  <ArrowRight size={15} weight="bold" />
                  <span className="is-after">
                    <strong>{proof.after.value}</strong>
                    <small>{proof.after.note}</small>
                  </span>
                </div>
                <dl className="closing-proof-rows">
                  <div>
                    <dt>Rule</dt>
                    <dd>{proof.rule}</dd>
                  </div>
                  <div>
                    <dt>Target</dt>
                    <dd>{proof.target}</dd>
                  </div>
                  <div>
                    <dt>Rechecked</dt>
                    <dd>{proof.rechecked}</dd>
                  </div>
                </dl>
              </div>
            );
          })}
        </div>
      </div>
      <p className="sr-only">
        Illustrative verification receipts, one for each area Frontmend audits: accessibility, SEO,
        performance, security, and reliability. They are examples of the record a closed repair loop
        produces, not measurements of a real website.
      </p>
    </>
  );
}

function ClosingCta({ onStart }) {
  const revealRef = useRevealOnScroll();
  const [held, setHeld] = useState(false);
  return (
    <section className="closing" aria-labelledby="closing-title" ref={revealRef}>
      <div className="evidence-loop-shell">
        <div
          className="closing-card"
          onMouseEnter={() => setHeld(true)}
          onMouseLeave={() => setHeld(false)}
          onFocusCapture={() => setHeld(true)}
          onBlurCapture={() => setHeld(false)}
        >
          <ClosingProofs held={held} />
          <h2 id="closing-title" className="closing-title">
            Start with one public URL.
          </h2>
          <p className="closing-lede">
            No login, no source upload, no agreement to change anything. Measure the page, see what
            the evidence says, and decide from there.
          </p>
          <button type="button" className="closing-action" onClick={onStart}>
            Start site audit
            <ArrowRight size={18} weight="bold" aria-hidden="true" />
          </button>
          <p className="closing-note">Public pages only · Human approval stays required</p>
        </div>
      </div>
    </section>
  );
}

/*
 * The marketing footer, shared by the landing and /how-it-works. Its two
 * in-page anchors only resolve on the landing itself, so off-route they are
 * rewritten to point back at the landing's copy of the same target.
 */
function LandingFooter({ onHome, onLanding = true }) {
  const landingAnchor = (fragment) => (onLanding ? fragment : `/${fragment}`);
  return (
    <footer className="site-footer landing-footer">
      <div className="landing-footer-main">
        <div className="landing-footer-identity">
          <p className="landing-footer-statement">Evidence that survives the handoff.</p>
          <p className="landing-footer-summary">
            Frontmend carries one public finding through browser investigation, repository
            diagnosis, human review, and fresh verification.
          </p>
        </div>

        <nav className="landing-footer-links" aria-label="Footer">
          <div className="landing-footer-column">
            <p className="landing-footer-label">Explore</p>
            <a href={landingAnchor("#evidence-loop")}>Evidence loop</a>
            <a href="/how-it-works">How it works</a>
            <a className="landing-footer-primary-link" href={landingAnchor("#site-url")}>
              Start a site audit
            </a>
          </div>
          <div className="landing-footer-column landing-footer-principles">
            <p className="landing-footer-label">Operating model</p>
            <span>Public pages only</span>
            <span>No source upload</span>
            <span>Human approval required</span>
          </div>
        </nav>
      </div>

      <div className="landing-footer-base">
        <Brand onClick={onHome} />
        <a
          className="landing-footer-maker"
          href="https://knightware.xyz/?utm_source=frontmend"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Knightware — opens in a new tab"
        >
          <img src="/assets/images/knightware.png" alt="Knightware" />
        </a>
      </div>
    </footer>
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
  scope,
  onToggleFocus,
  onMaxPrioritiesChange,
  onScopeChange,
}) {
  const focusSummary = focusAreas.length
    ? focusAreas.map((area) => AUDIT_FOCUS_COPY[area]?.label ?? area).join(" + ")
    : "Full frontend audit";
  // The closing call to action returns to the one real form rather than
  // rendering a second one, so there is only ever one URL field and one
  // submission path.
  const focusAuditField = () => {
    const field = inputRef?.current;
    if (!field) return;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    field.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "center" });
    field.focus({ preventScroll: true });
  };
  return (
    <>
      <section className="hero" aria-labelledby="landing-title">
        <div className="hero-inner">
          <div className="hero-copy">
            <h1 id="landing-title" className="hero-title">
              From audit finding<span className="editorial-break"> </span>to verified fix.
            </h1>
            <p className="hero-lede">
              Measure the public site. Investigate what automation misses.
              <span className="editorial-break"> </span>
              Review the repair. Prove the deployed outcome.
            </p>

            <form className="site-search" onSubmit={onSubmit} noValidate>
              <div className="site-search-field">
                <label htmlFor="site-url">Public site URL</label>
                <input
                  ref={inputRef}
                  id="site-url"
                  inputMode="url"
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  placeholder="https://example.com"
                  autoComplete="url"
                  spellCheck="false"
                  aria-invalid={Boolean(error)}
                  aria-describedby="site-url-message"
                />
              </div>
              <button className="search-submit" type="submit" disabled={isSubmitting}>
                Start site audit
                <ArrowRight size={19} weight="bold" aria-hidden="true" />
              </button>
            </form>

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

            <p className="hero-trust">No login · Public pages only · Human approval stays required</p>

            <details className="audit-composer">
              <summary>
                <span>
                  <strong>Shape this assessment</strong>
                  <small>Optional · the full evidence record stays available</small>
                </span>
                <em>{focusSummary} · {scope === "bounded-site" ? "bounded site" : "page"} · top {maxPriorities}</em>
              </summary>
              <div className="audit-composer-body">
                <fieldset>
                  <legend>
                    Focus areas
                    <small>Choose the areas to prioritise</small>
                  </legend>
                  <div className="audit-focus-options">
                    {HUMAN_AUDIT_FOCUS_OPTIONS.map((option) => {
                      const selected = focusAreas.includes(option.id);
                      return (
                        <label key={option.id} data-selected={selected ? "true" : "false"}>
                          <input
                            type="checkbox"
                            value={option.id}
                            checked={selected}
                            disabled={isSubmitting}
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
                <label className="priority-limit" htmlFor="audit-scope">
                  <span>
                    <strong>Assessment scope</strong>
                    <small>Bounded site retains up to three observed same-site routes</small>
                  </span>
                  <select
                    id="audit-scope"
                    value={scope}
                    disabled={isSubmitting}
                    onChange={(event) => onScopeChange(event.target.value)}
                  >
                    <option value="page">This page</option>
                    <option value="bounded-site">Bounded site</option>
                  </select>
                </label>
              </div>
            </details>

            <div className="hero-actions">
              <a className="hero-loop-link" href="#evidence-loop">
                See how the evidence loop works
                <ArrowRight size={17} weight="bold" aria-hidden="true" />
              </a>
              <button
                type="button"
                className="hero-example"
                onClick={() => setValue("removemyexif.com")}
              >
                <Sparkle size={13} weight="fill" aria-hidden="true" />
                Try removemyexif.com
              </button>
            </div>
          </div>

          <figure className="specimen-stack" aria-labelledby="specimen-stack-caption">
            <figcaption className="sr-only" id="specimen-stack-caption">
              Illustration of one example contrast issue moving through the five Frontmend evidence
              stages. It is not a measurement of a real website.
            </figcaption>
            <span className="specimen-thread" aria-hidden="true" />
            <ol className="specimen-list">
              {HERO_SPECIMENS.map((specimen) => (
                <li className="specimen" key={specimen.id} data-stage={specimen.id}>
                  <span className="specimen-accent" aria-hidden="true" />
                  <div className="specimen-label">
                    <p className="specimen-name">
                      <span className="specimen-index" aria-hidden="true">{specimen.index}</span>
                      {specimen.label}
                    </p>
                    {specimen.facts.map((fact) => (
                      <p key={fact.text} className={fact.mono ? "is-code" : undefined}>
                        {fact.text}
                      </p>
                    ))}
                  </div>
                  <div className="specimen-visual" aria-hidden="true">
                    <EvidenceSpecimen stage={specimen.id} />
                  </div>
                </li>
              ))}
            </ol>
          </figure>
        </div>
      </section>

      <EvidenceLoop />
      <EvidenceMoves />
      <AuthorityLedger />
      <LandingFaq />
      <ClosingCta onStart={focusAuditField} />
    </>
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
      {/*
       * One card, two grounds: the cobalt hero carries everything that is
       * moving - the orb, the phase, the thread, the stage marks - and the warm
       * half below carries the standing facts of the assessment. They used to
       * be stacked in one warm card with no hierarchy between the part that
       * changes every few seconds and the part that does not change at all.
       */}
      <div className="progress-card">
        <div className="progress-hero">
          {/*
           * The orb, not the old pulsing tile. Its loop is the sanctioned one
           * (DESIGN.md section 6): work is genuinely in flight here, and it
           * stops when the audit does. It also moves the animation inside the
           * reduced-motion opt-in, which `audit-pulse` never was.
           */}
          <ThinkingOrb />
          <p className="kicker" role="status" aria-live="polite" aria-atomic="true">
            Live audit · attempt {audit.attempt ?? 1} · {audit.progress}%
          </p>
          <h1 id="progress-title">{audit.phaseLabel}</h1>
          <p className="audit-url">{audit.url}</p>
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
                  <span aria-hidden="true">
                    {complete ? <Check size={16} weight="bold" /> : <Icon size={17} />}
                  </span>
                  <span className="sr-only">
                    {complete ? "Completed" : active ? "Current" : "Upcoming"}:{" "}
                  </span>
                  {stage.label}
                </li>
              );
            })}
          </ol>
          <p className="audit-engine-note">
            Live PageSpeed Insights job · Lighthouse mobile and desktop evidence
          </p>
        </div>
        <div className="progress-evidence">
          <AuditMissionSummary audit={audit} />
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
      </div>
    </section>
  );
}

/*
 * Restoring a shared audit address.
 *
 * Two failures live here, and they are not the same failure. A missing audit is
 * terminal - the job is gone or the address was never one Frontmend issued, and
 * no amount of retrying conjures it - so that branch withdraws the retry
 * button. Offering an action that provably cannot succeed is worse than
 * offering none, and the page used to offer it as the only thing on screen.
 * Everything else that fails here is a read that can be read again.
 */
const RESTORE_NOT_FOUND = "AUDIT_NOT_FOUND";

function RestoringAudit({ error, errorCode, isRestoring, onCancel, onRetry }) {
  const failed = Boolean(error);
  const gone = failed && errorCode === RESTORE_NOT_FOUND;
  return (
    <section className="progress-view" aria-labelledby="restore-title">
      {/*
       * Nothing to go back to when the audit is gone: the card owns the only
       * move, and the brand mark is still a way home.
       */}
      {gone ? null : (
        <button className="back-button" type="button" onClick={onCancel}>
          <ArrowLeft size={17} weight="bold" />
          Start a new audit
        </button>
      )}
      <div
        className={`progress-card ${failed ? "audit-failure restoration-failure" : ""}`}
        role={failed ? "alert" : "status"}
        aria-live={failed ? "assertive" : "polite"}
        aria-busy={isRestoring}
      >
        <div className="audit-orbit" aria-hidden="true">
          {failed ? <Warning size={31} weight="duotone" /> : <Pulse size={31} weight="duotone" />}
        </div>
        {/* The failure headline already says this; a label above it says it twice. */}
        {failed ? null : <p className="kicker">Shared audit</p>}
        <h1 id="restore-title">
          {gone
            ? "Nothing to restore at this address"
            : failed
              ? "This workspace could not be restored"
              : "Restoring the live workspace"}
        </h1>
        {failed ? (
          <>
            {/*
             * The retention window is the useful fact, and the page never said
             * it: JOB_RETENTION_MS is 24h from the moment an audit reaches a
             * terminal state, after which the job deletes itself. A dead link
             * has two causes and this covers both without guessing which.
             */}
            <p className="failure-message">
              {gone
                ? "Frontmend keeps a finished audit for 24 hours and then deletes it. Either this one is past that window, or the address was never one Frontmend issued."
                : error}
            </p>
            {gone ? null : (
              <p className="restoration-note">
                The stable audit address remains in your browser. Retrying only reads the existing
                authoritative job; it does not restart the audit or replay a mission action.
              </p>
            )}
            <div className="failure-actions">
              {gone ? null : (
                <button className="retry-audit" type="button" onClick={onRetry} disabled={isRestoring}>
                  <Pulse size={17} weight="bold" />
                  {isRestoring ? "Reading workspace…" : "Try restoring again"}
                </button>
              )}
              <button
                className={gone ? "retry-audit" : "back-button"}
                type="button"
                onClick={onCancel}
                disabled={isRestoring}
              >
                {gone ? null : <ArrowLeft size={17} weight="bold" />}
                Start a new audit
                {gone ? <ArrowRight size={16} weight="bold" /> : null}
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
    () => auditService.getActiveAudit()?.mission?.focusAreas ?? DEFAULT_HUMAN_AUDIT_FOCUS_AREAS,
  );
  const [maxPriorities, setMaxPriorities] = useState(
    () => auditService.getActiveAudit()?.mission?.maxPriorities ?? 3,
  );
  const [scope, setScope] = useState(
    () => auditService.getActiveAudit()?.mission?.scope ?? "page",
  );
  const [showHow, setShowHow] = useState(false);
  const [showWebMcp, setShowWebMcp] = useState(false);
  const [showAgentActivity, setShowAgentActivity] = useState(false);
  const [isHeaderCondensed, setIsHeaderCondensed] = useState(false);
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
  /*
   * Kept beside the message because the message alone cannot say whether
   * retrying is worth offering. Only AUDIT_NOT_FOUND is terminal; AuditError's
   * `recoverable` flag defaults to true and means something else entirely.
   */
  const [restorationErrorCode, setRestorationErrorCode] = useState("");
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
    setRestorationErrorCode("");
    void auditService
      .restoreAuditWorkspace(restorationAuditId)
      .then(({ audit: next }) => {
        if (!active) return;
        setAudit(next);
        setUrl(next.url);
        setFocusAreas(next.mission?.focusAreas ?? []);
        setMaxPriorities(next.mission?.maxPriorities ?? 3);
        setScope(next.mission?.scope ?? "page");
        setError("");
        setPollError("");
        setRestorationAuditId("");
      })
      .catch((cause) => {
        if (!active) return;
        setRestorationError(
          cause instanceof AuditError ? cause.message : "That shared audit could not be restored.",
        );
        setRestorationErrorCode(cause instanceof AuditError ? cause.code : "");
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
    if (mode !== "landing") {
      setIsHeaderCondensed(false);
      return undefined;
    }

    let frame = 0;
    const updateHeader = () => {
      frame = 0;
      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      setIsHeaderCondensed((current) => (current ? scrollTop > 36 : scrollTop > 96));
    };
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(updateHeader);
    };

    updateHeader();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [mode]);

  useEffect(() => {
    document.title = mode === "landing"
      ? "Frontmend — Find what broke. Prove the fix."
      : mode === "guide"
        ? "How Frontmend works — Frontmend"
        : mode === "restore"
          ? restorationErrorCode === RESTORE_NOT_FOUND
            ? "Audit not found — Frontmend"
            : restorationError
              ? "Could not restore audit — Frontmend"
              : "Restoring audit — Frontmend"
          : mode === "report"
            ? "Audit results — Frontmend"
            : audit?.status === "failed"
              ? "Audit failed — Frontmend"
              : audit?.status === "cancelled"
                ? "Audit cancelled — Frontmend"
                : `${audit?.phaseLabel ?? "Audit in progress"} — Frontmend`;
  }, [audit?.phaseLabel, audit?.status, mode, restorationError, restorationErrorCode]);

  const reset = () => {
    auditService.reset();
    setAudit(null);
    setUrl("");
    setFocusAreas(DEFAULT_HUMAN_AUDIT_FOCUS_AREAS);
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
    setRestorationErrorCode("");
    setIsRestoring(false);
    setStaticRoute(null);
    window.history.replaceState(null, "", "/");
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  const retryRestoration = () => {
    if (!restorationAuditId || isRestoring) return;
    setRestorationError("");
    setRestorationErrorCode("");
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
        mission: { intent: "assess", focusAreas, maxPriorities, scope, routeLimit: 3 },
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
          scope: retainedMission.scope,
          routeLimit: retainedMission.routeLimit,
        },
      });
      setUrl(next.url);
      setAudit(next);
      setFocusAreas(next.mission?.focusAreas ?? retainedMission.focusAreas);
      setMaxPriorities(next.mission?.maxPriorities ?? retainedMission.maxPriorities);
      setScope(next.mission?.scope ?? retainedMission.scope);
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
      setScope(audit.mission?.scope ?? "page");
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
      <header className={`site-header${mode === "landing" && isHeaderCondensed ? " is-condensed" : ""}`}>
        <Brand onClick={reset} />
        <div className="header-actions">
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
          <WebMcpStatus
            buttonRef={webMcpTriggerRef}
            status={webMcp}
            expanded={showWebMcp}
            restoring={Boolean(restorationAuditId)}
            restoreFailed={Boolean(restorationError)}
            onClick={() => setShowWebMcp(true)}
          />
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
          scope={scope}
          onToggleFocus={(area) => {
            setFocusAreas((current) => current.includes(area)
              ? current.filter((candidate) => candidate !== area)
              : [...current, area]);
          }}
          onMaxPrioritiesChange={setMaxPriorities}
          onScopeChange={setScope}
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
            errorCode={restorationErrorCode}
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

      {/*
       * No footer on the restored-audit route. It is a strapline and a product
       * name pinned to the bottom corners of a page whose whole job is one card
       * and one decision, and on the art they are two more things to read past.
       * Both states go without it, so nothing appears when the restore resolves.
       */}
      {mode === "landing" || mode === "guide" ? (
        <LandingFooter onHome={reset} onLanding={mode === "landing"} />
      ) : mode === "restore" ? null : (
        <footer className="site-footer">
          <span>Find what broke. Prove the fix.</span>
          <span>Frontmend · Live audit engine</span>
        </footer>
      )}

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
        />
      ) : null}
    </div>
  );
}
