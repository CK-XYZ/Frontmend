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
  if (status.status === "error") return "Partial";
  return "Human mode";
}

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
            <p className="inspector-kicker">Contextual WebMCP</p>
            <span
              className={`inspector-status ${supported ? "is-ready" : "is-human"}`}
              data-state={inspector.registration.status}
            >
              <span className="inspector-status-dot" aria-hidden="true" />
              {registrationLabel(status)}
            </span>
          </div>
          <h2 id="webmcp-sheet-title">Mission inspector</h2>
          <p id="webmcp-sheet-description">
            The current shared mission, the evidence that must return, and the actions that stay
            person-owned.
          </p>
          <button
            className="inspector-close"
            type="button"
            onClick={onClose}
            aria-label="Close mission inspector"
          >
            <X size={17} weight="bold" />
          </button>
        </header>

        <dl className="inspector-meta">
          <div>
            <dt>Stage</dt>
            <dd>{inspector.stage.replaceAll("-", " ")}</dd>
          </div>
          <div>
            <dt>Operator</dt>
            <dd>{questions.whatHappensNow.actor}</dd>
          </div>
          <div>
            <dt>Contracts</dt>
            <dd>
              {activeTools.length} active · {inspector.registration.totalToolCount} bounded
            </dd>
          </div>
        </dl>

        <section className="inspector-block is-now" aria-labelledby="mission-inspector-now-title">
          <p className="inspector-label">What happens now</p>
          <h3 id="mission-inspector-now-title">{questions.whatHappensNow.title}</h3>
          <p className="inspector-prose">{questions.whatHappensNow.summary}</p>
          {questions.whatHappensNow.requiredCapability ? (
            <p className="inspector-capability">
              <span>Required capability</span>
              <code>{questions.whatHappensNow.requiredCapability}</code>
            </p>
          ) : null}
        </section>

        <section className="inspector-block" aria-labelledby="mission-inspector-why-title">
          <p className="inspector-label" id="mission-inspector-why-title">Why now</p>
          <p className="inspector-prose">{questions.whyNow}</p>
        </section>

        <div className="inspector-split">
          <section aria-labelledby="mission-inspector-return-title">
            <p className="inspector-label" id="mission-inspector-return-title">What must return</p>
            <RecordList
              items={questions.whatMustReturn}
              empty="No further evidence is required."
            />
          </section>
          <section aria-labelledby="mission-inspector-unlocks-title">
            <p className="inspector-label" id="mission-inspector-unlocks-title">What it unlocks</p>
            <RecordList items={questions.whatItUnlocks} empty="Nothing further is unlocked." />
          </section>
        </div>

        <section className="inspector-block is-human" aria-labelledby="mission-inspector-human-title">
          <p className="inspector-label" id="mission-inspector-human-title">
            What remains human-only
          </p>
          <RecordList
            items={questions.whatRemainsHumanOnly}
            empty="No person-owned action is outstanding."
          />
        </section>

        <details className="inspector-disclosure">
          <summary>
            <CaretRight size={13} weight="bold" aria-hidden="true" />
            Tool contracts
            <span>
              {activeTools.length} active · {inspector.registration.totalToolCount} bounded
            </span>
          </summary>
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
