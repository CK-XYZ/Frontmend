import {
  ArrowRight,
  CheckCircle,
  ClipboardText,
  Pulse,
  Robot,
  Stamp,
  X,
} from "@phosphor-icons/react";
import { auditService } from "../audit-service.js";
import { deriveAuditMissionState } from "../audit-mission-contract.js";
import { createMissionInspector } from "../mission-inspector-contract.js";
import { createFrontmendTools } from "../webmcp.js";
import { useDialogFocus } from "../ui/use-dialog-focus.js";

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
        <button className="icon-button close-button" type="button" onClick={onClose} aria-label="Close mission inspector">
          <X size={18} weight="bold" />
        </button>
        <div className="webmcp-sheet-heading">
          <span className={`webmcp-sheet-signal ${supported ? "ready" : ""}`} aria-hidden="true">
            <Robot size={21} weight="duotone" />
          </span>
          <div>
            <p className="kicker">Contextual WebMCP</p>
            <h2 id="webmcp-sheet-title">Mission inspector</h2>
          </div>
        </div>
        <p className="webmcp-sheet-lead" id="webmcp-sheet-description">
          This inspector explains the current shared mission, the evidence that must return, and the actions that remain person-owned.
        </p>
        <div className="mission-inspector-stage">
          <span>{inspector.stage.replaceAll("-", " ")}</span>
          <strong>{questions.whatHappensNow.actor}</strong>
        </div>
        <section className="mission-inspector-now" aria-labelledby="mission-inspector-now-title">
          <span aria-hidden="true"><Pulse size={20} weight="duotone" /></span>
          <div>
            <p className="kicker">What happens now</p>
            <h3 id="mission-inspector-now-title">{questions.whatHappensNow.title}</h3>
            <p>{questions.whatHappensNow.summary}</p>
            {questions.whatHappensNow.requiredCapability ? (
              <small>Required capability · {questions.whatHappensNow.requiredCapability}</small>
            ) : null}
          </div>
        </section>

        <div className="mission-inspector-why">
          <strong>Why now</strong>
          <p>{questions.whyNow}</p>
        </div>

        <div className="mission-inspector-columns">
          <section>
            <ClipboardText size={18} weight="duotone" aria-hidden="true" />
            <div>
              <strong>What must return</strong>
              {questions.whatMustReturn.length ? (
                <ul>{questions.whatMustReturn.map((item) => <li key={item}>{item}</li>)}</ul>
              ) : <p>No further evidence is required.</p>}
            </div>
          </section>
          <section>
            <ArrowRight size={18} weight="bold" aria-hidden="true" />
            <div>
              <strong>What it unlocks</strong>
              <ul>{questions.whatItUnlocks.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
          </section>
        </div>

        <div className="webmcp-human-boundary">
          <Stamp size={20} weight="duotone" aria-hidden="true" />
          <div>
            <strong>What remains human-only</strong>
            <ul>{questions.whatRemainsHumanOnly.map((item) => <li key={item}>{item}</li>)}</ul>
          </div>
        </div>

        <details className="webmcp-tool-disclosure">
          <summary>
            Tool contracts
            <span>{activeTools.length} active · {inspector.registration.totalToolCount} bounded</span>
          </summary>
          {activeTools.length ? (
            <ol className="webmcp-capability-list">
              {activeTools.map((tool) => (
                <li key={tool.name}>
                  <CheckCircle size={18} weight="fill" aria-hidden="true" />
                  <div>
                    <strong>{tool.title}</strong>
                    <p>{tool.description}</p>
                    <code>{tool.name}</code>
                    <details className="webmcp-schema-disclosure">
                      <summary>Input schema</summary>
                      <pre>{JSON.stringify(tool.inputSchema, null, 2)}</pre>
                    </details>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <div className="webmcp-capability-empty">
              <Pulse size={20} weight="duotone" aria-hidden="true" />
              <span>{syncing ? "Capability sync in progress" : "No agent tool contracts are active"}</span>
            </div>
          )}
        </details>
        <p className="webmcp-library-note">{inspector.humanFallback.message}</p>
      </section>
    </div>
  );
}
