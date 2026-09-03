import { CaretRight, X } from "@phosphor-icons/react";
import { auditService } from "../audit-service.js";
import { deriveAuditMissionState } from "../audit-mission-contract.js";
import { createMissionInspector } from "../mission-inspector-contract.js";
import { createFrontmendTools } from "../webmcp.js";
import { useDialogFocus } from "../ui/use-dialog-focus.js";

function registrationLabel(status) {
  if (!status.supported) return "Human mode";
  if (status.status === "ready") return "WebMCP ready";
  if (status.status === "registering") return "Syncing";
  if (status.status === "error") return "WebMCP partial";
  return "Human mode";
}

const STAGE_LABELS = Object.freeze({
  landing: "Ready to begin",
  measurement: "Audit running",
  investigation: "Browser review",
  diagnosis: "Diagnosis",
  "human-review": "Your review",
  deployment: "Deployment",
  replay: "Verification",
  complete: "Audit complete",
});

/** Hairline record rows. Used everywhere a list of facts appears. */
function RecordList({ items, empty }) {
  if (!items.length) return <p className="inspector-empty">{empty}</p>;
  return (
    <ul className="inspector-record">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

export default function WebMcpCapabilitySheet({ audit, webMcp, onClose, restoreFocusRef }) {
  const status = webMcp;
  const repairs = audit?.id ? auditService.getRepairs(audit.id) : [];
  const browserReview = audit?.id ? auditService.getBrowserReview(audit.id) : null;
  const missionState = audit?.status === "complete" && audit.report && audit.mission
    ? deriveAuditMissionState({
        report: audit.report,
        mission: audit.mission,
        diagnosticMissions: auditService.getDiagnosticMissions(audit.id),
        repairs,
        browserReview,
        explorations: auditService.getSiteExplorations(audit.id),
      })
    : null;
  const inspector = createMissionInspector({
    audit,
    missionState,
    repairs,
    browserReview,
    checkpoint: audit?.id ? auditService.getMissionCheckpoint(audit.id) : null,
    contextualToolNames: webMcp.toolNames,
    toolDetails: createFrontmendTools(auditService),
    webMcp,
  });
  const dialogRef = useDialogFocus(onClose, restoreFocusRef);
  const supported = status.supported;
  const questions = inspector.questions;
  const activeTools = inspector.activeTools;
  const syncing = inspector.registration.status === "registering";
  const stageLabel = STAGE_LABELS[inspector.stage] ?? "Current audit";
  const availableActionLabel = activeTools.length
    ? `${activeTools.length} agent ${activeTools.length === 1 ? "action" : "actions"} available on this screen`
    : syncing
      ? "Agent actions are syncing"
      : "Use the controls on this screen";
  const explainer = supported
    ? "WebMCP lets a compatible AI agent use the actions on this page as tools. You ask in plain language; Frontmend runs the audit and keeps the evidence and your decision points visible."
    : "WebMCP is the browser feature that lets a compatible AI agent use the actions on this page as tools. It is not available here, but you can still use every Frontmend workflow yourself.";

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        id="webmcp-mission-inspector"
        tabIndex="-1"
        className="webmcp-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="webmcp-sheet-title"
        aria-describedby="webmcp-sheet-description"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="inspector-head">
          <div className="inspector-head-line">
            <h2 id="webmcp-sheet-title">Use Frontmend with an AI agent</h2>
            <span
              className={`inspector-status ${supported ? "is-ready" : "is-human"}`}
              data-state={inspector.registration.status}
            >
              <span className="inspector-status-dot" aria-hidden="true" />
              {registrationLabel(status)}
            </span>
          </div>
          <button
            className="inspector-close"
            type="button"
            onClick={onClose}
            aria-label="Close agent access"
          >
            <X size={17} weight="bold" />
          </button>
        </header>

        <div className="inspector-intro">
          <p className="inspector-lede" id="webmcp-sheet-description">{explainer}</p>
          <p className="inspector-state">
            <span>{stageLabel}</span>
            <span>{availableActionLabel}</span>
          </p>
        </div>

        <section className="inspector-now" aria-labelledby="mission-inspector-now-title">
          <p className="inspector-label">Available now</p>
          <h3 id="mission-inspector-now-title">{questions.whatHappensNow.title}</h3>
          <p className="inspector-prose">{questions.whatHappensNow.summary}</p>
          <p className="inspector-why">{questions.whyNow}</p>
          {questions.whatHappensNow.requiredCapability ? (
            <p className="inspector-capability">
              <span>Needs</span>
              <code>{questions.whatHappensNow.requiredCapability}</code>
            </p>
          ) : null}
          {supported && inspector.stage === "landing" ? (
            <div className="inspector-example">
              <span>Try asking your agent</span>
              <code>Use Frontmend to audit example.com for accessibility and SEO.</code>
            </div>
          ) : null}
        </section>

        {/*
          The authority split is the product's whole thesis, so it is the shape
          of the sheet rather than one more labelled band. It mirrors the
          landing page's ledger: agent on the left, person on the right, and
          lime marks the side only a person owns.
        */}
        <div className="inspector-authority">
          <section aria-labelledby="mission-inspector-agent-title">
            <p className="inspector-label" id="mission-inspector-agent-title">
              What the agent can do
            </p>
            <p className="inspector-sublabel">Returns</p>
            <RecordList
              items={questions.whatMustReturn}
              empty="No further evidence is required."
            />
            <p className="inspector-sublabel">Then unlocks</p>
            <RecordList items={questions.whatItUnlocks} empty="Nothing further is unlocked." />
          </section>
          <section className="is-human" aria-labelledby="mission-inspector-human-title">
            <p className="inspector-label" id="mission-inspector-human-title">
              What stays with you
            </p>
            <RecordList
              items={questions.whatRemainsHumanOnly}
              empty="No person-owned action is outstanding."
            />
          </section>
        </div>

        <details className="inspector-disclosure">
          <summary>
            <CaretRight size={13} weight="bold" aria-hidden="true" />
            Technical details
            <span>
              {activeTools.length} {activeTools.length === 1 ? "action" : "actions"} on this screen
            </span>
          </summary>
          <div className="inspector-technical-intro">
            <p>
              These are the exact actions Frontmend currently exposes to a compatible agent. The
              list changes as the audit moves forward.
            </p>
            <p className="inspector-technical-meta">
              {inspector.registration.totalToolCount} total actions · protocol v{inspector.protocol.protocolVersion} · build {inspector.protocol.displayCommit}
            </p>
          </div>
          {activeTools.length ? (
            <ol className="inspector-tools">
              {activeTools.map((tool) => (
                <li key={tool.name}>
                  <p className="inspector-tool-name">
                    <strong>{tool.title}</strong>
                    <code>{tool.name}</code>
                  </p>
                  <p className="inspector-prose">{tool.description}</p>
                  <details className="inspector-schema">
                    <summary>Input schema</summary>
                    <pre>{JSON.stringify(tool.inputSchema, null, 2)}</pre>
                  </details>
                </li>
              ))}
            </ol>
          ) : (
            <p className="inspector-empty">
              {syncing ? "Capability sync in progress." : "No agent tool contracts are active."}
            </p>
          )}
        </details>

        <p className="inspector-foot">{inspector.humanFallback.message}</p>
      </section>
    </div>
  );
}
