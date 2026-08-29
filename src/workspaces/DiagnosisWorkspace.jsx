import {
  Check,
  FileCode,
  MagnifyingGlass,
  Pulse,
  Robot,
  ShieldCheck,
  Warning,
  X,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { AuditError, auditService } from "../audit-service.js";
import { diagnosticEvidenceChain } from "../diagnostic-contract.js";
import { humanMissionMutationFailure } from "../ui/human-mission-recovery.js";

function DiagnosticEvidenceChain({ mission }) {
  const chain = mission?.evidenceChain ?? diagnosticEvidenceChain(mission);
  const detail = (stage) => {
    if (stage.id === "measurement") {
      return `${stage.itemCount} bounded provider item${stage.itemCount === 1 ? "" : "s"} · ${stage.provenance}`;
    }
    if (stage.state !== "contributed") {
      return stage.id === "browser"
        ? "Reproduce the measured symptom in a real browser"
        : stage.id === "repository"
          ? "Map the runtime owner to repository-relative source"
          : "Name the checks that would prove the implementation";
    }
    return `${stage.itemCount} bounded ${stage.id === "browser" ? "observation" : stage.id === "repository" ? "source location" : "check"}${stage.itemCount === 1 ? "" : "s"} · ${stage.provenance}`;
  };
  return (
    <section className="diagnostic-evidence-chain" aria-label="Diagnostic evidence chain">
      <div className="diagnostic-chain-heading">
        <div>
          <p className="kicker">Evidence chain</p>
          <strong>Measurement stays separate from contributed diagnosis</strong>
        </div>
        <span>{chain.status === "ready-for-repair" ? "Evidence ready" : chain.status === "blocked" ? "Blocked honestly" : "Contribution required"}</span>
      </div>
      <ol>
        {chain.stages.map((stage, index) => (
          <li key={stage.id} className={`diagnostic-stage ${stage.state}`}>
            <span className="diagnostic-stage-marker" aria-hidden="true">
              {stage.state === "required" ? index + 1 : <Check size={12} weight="bold" />}
            </span>
            <div>
              <strong>{stage.label}</strong>
              <small>{detail(stage)}</small>
            </div>
            <em>{stage.state === "required" ? "Required" : stage.state === "retained" ? "Measured" : "Contributed"}</em>
          </li>
        ))}
      </ol>
      <small>{chain.authority.claim}</small>
    </section>
  );
}

function diagnosticBlockerReasonLabel(reason) {
  const labels = {
    "browser-unavailable": "Browser unavailable",
    "repository-unavailable": "Repository unavailable",
    "not-reproduced": "Symptom not reproduced",
    "wrong-repository": "Repository does not match runtime",
    "conflicting-runtime": "Runtime evidence conflicts",
  };
  return labels[reason] ?? "Diagnostic evidence unavailable";
}

function emptyDiagnosticObservation() {
  return { kind: "interaction", detail: "" };
}

function emptyDiagnosticSourceLocation() {
  return { file: "", line: "", symbol: "", reason: "" };
}

function HumanDiagnosticContribution({ auditId, mission, webMcpReady }) {
  const [mode, setMode] = useState("evidence");
  const [summary, setSummary] = useState("");
  const [reproduction, setReproduction] = useState("");
  const [observations, setObservations] = useState([emptyDiagnosticObservation()]);
  const [sourceLocations, setSourceLocations] = useState([emptyDiagnosticSourceLocation()]);
  const [verificationChecks, setVerificationChecks] = useState([""]);
  const [confidence, setConfidence] = useState("medium");
  const [blockerReason, setBlockerReason] = useState("browser-unavailable");
  const [blockerSummary, setBlockerSummary] = useState("");
  const [expanded, setExpanded] = useState(!webMcpReady);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    setMode("evidence");
    setSummary("");
    setReproduction("");
    setObservations([emptyDiagnosticObservation()]);
    setSourceLocations([emptyDiagnosticSourceLocation()]);
    setVerificationChecks([""]);
    setConfidence("medium");
    setBlockerReason("browser-unavailable");
    setBlockerSummary("");
    setNotice("");
  }, [mission.id]);

  const refreshAfterStale = async () => {
    await auditService.refreshMissionWorkspace(auditId);
  };
  const updateObservation = (index, field, value) => {
    setObservations((current) => current.map((item, itemIndex) => itemIndex === index
      ? { ...item, [field]: value }
      : item));
  };
  const updateSourceLocation = (index, field, value) => {
    setSourceLocations((current) => current.map((item, itemIndex) => itemIndex === index
      ? { ...item, [field]: value }
      : item));
  };
  const updateCheck = (index, value) => {
    setVerificationChecks((current) => current.map((item, itemIndex) => itemIndex === index ? value : item));
  };
  const handleStale = async () => {
    try {
      await refreshAfterStale();
      setNotice("Mission changed in another session. The current diagnosis was refreshed; inspect it before resubmitting.");
    } catch {
      setNotice("Mission changed in another session. Refresh this audit before resubmitting.");
    }
  };
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    try {
      if (mode === "blocker") {
        await auditService.recordDiagnosticBlocker(
          auditId,
          mission.id,
          { reason: blockerReason, summary: blockerSummary.trim() },
          "person",
        );
        setNotice("Diagnostic blocker recorded. The measured finding remains unresolved and can resume with real evidence later.");
      } else {
        await auditService.submitDiagnosticEvidence(
          auditId,
          mission.id,
          {
            summary: summary.trim(),
            reproduction: reproduction.trim(),
            observations: observations.map((item) => ({
              kind: item.kind,
              detail: item.detail.trim(),
            })),
            sourceLocations: sourceLocations.map((item) => ({
              file: item.file.trim(),
              ...(item.line.trim() ? { line: Number(item.line) } : {}),
              ...(item.symbol.trim() ? { symbol: item.symbol.trim() } : {}),
              reason: item.reason.trim(),
            })),
            verificationChecks: verificationChecks.map((item) => item.trim()),
            confidence,
          },
          "person",
        );
        setNotice("Repository diagnosis recorded with person provenance. Repair authority remains separate.");
      }
    } catch (cause) {
      if (cause?.code === "MISSION_REVISION_STALE") {
        await handleStale();
      } else {
        setNotice(cause instanceof AuditError ? cause.message : "This diagnostic contribution could not be recorded.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <details
      className="human-diagnostic-contribution"
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>
        <span>
          {webMcpReady ? <Robot size={17} weight="fill" aria-hidden="true" /> : <FileCode size={17} weight="duotone" aria-hidden="true" />}
          <strong>{webMcpReady ? "Contribute yourself or hand off" : "Complete repository diagnosis yourself"}</strong>
        </span>
        <small>Same contract · person provenance · source-safe</small>
      </summary>
      <form onSubmit={submit}>
        <div className="human-diagnostic-capability" role="note">
          <MagnifyingGlass size={18} weight="duotone" aria-hidden="true" />
          <p>
            {webMcpReady
              ? <>A repository-aware agent can call <code>submit_runtime_diagnosis</code>. If you have matching browser and repository access, you can return the same bounded evidence here.</>
              : <>WebMCP is not ready in this browser. Human mode still accepts the complete bounded diagnosis or an honest blocker through the shared mission.</>}
          </p>
        </div>

        <fieldset className="human-diagnostic-mode">
          <legend>What can you return now?</legend>
          <label className={mode === "evidence" ? "selected" : ""}>
            <input
              type="radio"
              name={`diagnostic-mode-${mission.id}`}
              value="evidence"
              checked={mode === "evidence"}
              onChange={() => setMode("evidence")}
            />
            <span>Bounded diagnosis</span>
            <small>Browser facts, repository ownership, and planned checks</small>
          </label>
          <label className={mode === "blocker" ? "selected" : ""}>
            <input
              type="radio"
              name={`diagnostic-mode-${mission.id}`}
              value="blocker"
              checked={mode === "blocker"}
              onChange={() => setMode("blocker")}
            />
            <span>Honest blocker</span>
            <small>Keep the measured symptom unresolved and resumable</small>
          </label>
        </fieldset>

        {mode === "blocker" ? (
          <div className="human-diagnostic-blocker-fields">
            <label className="human-review-field">
              <span>Exact blocker</span>
              <select value={blockerReason} onChange={(event) => setBlockerReason(event.target.value)}>
                <option value="browser-unavailable">Browser unavailable</option>
                <option value="repository-unavailable">Repository unavailable</option>
                <option value="not-reproduced">Symptom not reproduced</option>
                <option value="wrong-repository">Repository does not match runtime</option>
                <option value="conflicting-runtime">Runtime evidence conflicts</option>
              </select>
            </label>
            <label className="human-review-field">
              <span>Blocker summary <small>{blockerSummary.length}/300</small></span>
              <textarea
                value={blockerSummary}
                onChange={(event) => setBlockerSummary(event.target.value)}
                maxLength={300}
                rows={3}
                required
                placeholder="Name what is unavailable or does not match without guessing the cause."
              />
            </label>
          </div>
        ) : (
          <>
            <div className="human-diagnostic-summary-grid">
              <label className="human-review-field">
                <span>Causal summary <small>{summary.length}/300</small></span>
                <textarea
                  value={summary}
                  onChange={(event) => setSummary(event.target.value)}
                  maxLength={300}
                  rows={3}
                  required
                  placeholder="Explain the supported cause without claiming independent verification."
                />
              </label>
              <label className="human-review-field">
                <span>Exact reproduction <small>{reproduction.length}/600</small></span>
                <textarea
                  value={reproduction}
                  onChange={(event) => setReproduction(event.target.value)}
                  maxLength={600}
                  rows={3}
                  required
                  placeholder="Record the public route, safe steps, and direct outcome."
                />
              </label>
            </div>

            <fieldset className="human-diagnostic-list">
              <legend>Browser observations <small>1–5 required</small></legend>
              {observations.map((observation, index) => (
                <div className="human-diagnostic-observation" key={`${mission.id}-diagnostic-observation-${index}`}>
                  <select
                    value={observation.kind}
                    onChange={(event) => updateObservation(index, "kind", event.target.value)}
                    aria-label={`Observation ${index + 1} kind`}
                  >
                    <option value="console">Console</option>
                    <option value="network">Network</option>
                    <option value="interaction">Interaction</option>
                    <option value="performance">Performance</option>
                    <option value="accessibility">Accessibility</option>
                  </select>
                  <textarea
                    value={observation.detail}
                    onChange={(event) => updateObservation(index, "detail", event.target.value)}
                    maxLength={400}
                    rows={2}
                    required
                    aria-label={`Observation ${index + 1} detail`}
                    placeholder="One direct, non-sensitive browser fact."
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
              {observations.length < 5 ? (
                <button type="button" onClick={() => setObservations((current) => [...current, emptyDiagnosticObservation()])}>
                  Add browser observation
                </button>
              ) : null}
            </fieldset>

            <fieldset className="human-diagnostic-list">
              <legend>Repository ownership <small>1–8 relative locations required</small></legend>
              {sourceLocations.map((location, index) => (
                <section className="human-diagnostic-source" key={`${mission.id}-diagnostic-source-${index}`}>
                  <header>
                    <strong>Location {index + 1}</strong>
                    {sourceLocations.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => setSourceLocations((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                      >
                        Remove
                      </button>
                    ) : null}
                  </header>
                  <div className="human-diagnostic-source-fields">
                    <label>
                      <span>Repository-relative file</span>
                      <input
                        value={location.file}
                        onChange={(event) => updateSourceLocation(index, "file", event.target.value)}
                        maxLength={200}
                        required
                        placeholder="src/components/Header.jsx"
                      />
                    </label>
                    <label>
                      <span>Line <small>optional</small></span>
                      <input
                        type="number"
                        min="1"
                        max="10000000"
                        step="1"
                        value={location.line}
                        onChange={(event) => updateSourceLocation(index, "line", event.target.value)}
                      />
                    </label>
                    <label>
                      <span>Symbol <small>optional</small></span>
                      <input
                        value={location.symbol}
                        onChange={(event) => updateSourceLocation(index, "symbol", event.target.value)}
                        maxLength={120}
                      />
                    </label>
                  </div>
                  <label>
                    <span>Ownership reason <small>{location.reason.length}/300</small></span>
                    <textarea
                      value={location.reason}
                      onChange={(event) => updateSourceLocation(index, "reason", event.target.value)}
                      maxLength={300}
                      rows={2}
                      required
                      placeholder="Explain why this file or symbol owns the observed runtime behaviour."
                    />
                  </label>
                </section>
              ))}
              {sourceLocations.length < 8 ? (
                <button type="button" onClick={() => setSourceLocations((current) => [...current, emptyDiagnosticSourceLocation()])}>
                  Add repository location
                </button>
              ) : null}
            </fieldset>

            <fieldset className="human-diagnostic-list">
              <legend>Planned verification checks <small>1–8 required</small></legend>
              {verificationChecks.map((check, index) => (
                <div className="human-diagnostic-check" key={`${mission.id}-diagnostic-check-${index}`}>
                  <input
                    value={check}
                    onChange={(event) => updateCheck(index, event.target.value)}
                    maxLength={120}
                    required
                    aria-label={`Verification check ${index + 1}`}
                    placeholder="e.g. bun test or keyboard navigation at 390 px"
                  />
                  {verificationChecks.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => setVerificationChecks((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                      aria-label={`Remove verification check ${index + 1}`}
                    >
                      <X size={14} weight="bold" aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              ))}
              {verificationChecks.length < 8 ? (
                <button type="button" onClick={() => setVerificationChecks((current) => [...current, ""])}>
                  Add planned check
                </button>
              ) : null}
            </fieldset>

            <label className="human-review-field human-diagnostic-confidence">
              <span>Evidence confidence</span>
              <select value={confidence} onChange={(event) => setConfidence(event.target.value)}>
                <option value="low">Low — ownership remains tentative</option>
                <option value="medium">Medium — evidence is consistent but bounded</option>
                <option value="high">High — reproduction and ownership directly align</option>
              </select>
            </label>

            <p className="human-diagnostic-privacy">
              <ShieldCheck size={16} weight="duotone" aria-hidden="true" />
              Relative paths and bounded observations only. Do not paste source, patches, credentials, environment values, absolute paths, or private browser data.
            </p>
          </>
        )}

        <div className="human-review-submit">
          <p>
            <ShieldCheck size={15} weight="duotone" aria-hidden="true" />
            {mode === "blocker"
              ? "A blocker preserves the measured symptom and unlocks no repair or receipt."
              : "This remains person-reported diagnosis; approval, deployment, and fresh proof stay separate."}
          </p>
          <button type="submit" disabled={busy}>
            {busy ? "Recording…" : mode === "blocker" ? "Record honest blocker" : "Record bounded diagnosis"}
          </button>
        </div>
        {notice ? <p className="human-review-notice" role="status">{notice}</p> : null}
      </form>
    </details>
  );
}

function DiagnosticMissionCard({ auditId, finding, mission, webMcp }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!finding?.diagnosticEvidence) return null;
  const ready = mission?.state?.state === "ready-for-repair";
  const blocked = mission?.state?.state === "blocked";
  const webMcpReady = webMcp?.supported === true && webMcp?.status === "ready";
  const openMission = async () => {
    setBusy(true);
    setError("");
    try {
      await auditService.openDiagnosticMission(auditId, finding.id);
    } catch (cause) {
      const failure = await humanMissionMutationFailure(
        cause,
        auditId,
        "The diagnostic mission could not be opened.",
      );
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={`diagnostic-mission ${ready ? "ready" : blocked ? "blocked" : ""}`} aria-label="Diagnostic mission">
      <header>
        <span aria-hidden="true">{blocked ? <Warning size={20} weight="duotone" /> : <MagnifyingGlass size={20} weight="duotone" />}</span>
        <div>
          <p className="kicker">Measured symptom → owned cause</p>
          <strong>{ready ? "Diagnosis ready for a repair proposal" : blocked ? "Diagnosis paused without inventing evidence" : "Add browser and repository diagnosis"}</strong>
          <p>Lighthouse remains the sensor. The diagnosis is separate, labelled evidence contributed by a person or agent.</p>
        </div>
        <span className="diagnostic-mission-state">{ready ? "Ready" : blocked ? "Blocked" : mission ? "In progress" : "Not opened"}</span>
      </header>
      {mission ? (
        <>
          <DiagnosticEvidenceChain mission={mission} />
          {mission.blocker ? (
            <div className="diagnostic-blocker" role="status">
              <Warning size={19} weight="fill" aria-hidden="true" />
              <div>
                <strong>{diagnosticBlockerReasonLabel(mission.blocker.reason)}</strong>
                <p>{mission.blocker.summary}</p>
                <small>{mission.blocker.agentReported ? "Agent-reported" : "Person-reported"} · measured evidence is still unresolved</small>
              </div>
            </div>
          ) : null}
          {!mission.diagnosis ? (
            <ol className="diagnostic-investigations">
              {mission.requiredInvestigations.map((item) => <li key={item}>{item}</li>)}
            </ol>
          ) : null}
          {mission.diagnosis ? (
            <div className="diagnostic-diagnosis">
              <div>
                <strong>{mission.diagnosis.summary}</strong>
                <span>{mission.diagnosis.agentReported ? "Agent-reported" : "Person-reported"} · {mission.diagnosis.confidence} confidence</span>
              </div>
              <p><strong>Reproduction:</strong> {mission.diagnosis.reproduction}</p>
              <div className="diagnostic-contribution-grid">
                <section>
                  <small>Browser observations</small>
                  <ul>
                    {mission.diagnosis.observations.map((observation) => (
                      <li key={`${observation.kind}-${observation.detail}`}>
                        <span>{observation.kind}</span>
                        {observation.detail}
                      </li>
                    ))}
                  </ul>
                </section>
                <section>
                  <small>Repository ownership</small>
                  <ul>
                    {mission.diagnosis.sourceLocations.map((location) => (
                      <li key={`${location.file}-${location.line ?? "file"}`}>
                        <code>{location.file}{location.line ? `:${location.line}` : ""}</code>
                        {location.reason}
                      </li>
                    ))}
                  </ul>
                </section>
                <section>
                  <small>Planned checks</small>
                  <ul>
                    {mission.diagnosis.verificationChecks.map((check) => <li key={check}><code>{check}</code></li>)}
                  </ul>
                </section>
              </div>
            </div>
          ) : !mission.blocker ? (
            <p className="diagnostic-mission-note">
              {webMcpReady
                ? <>A connected coding agent can reproduce the issue, inspect repository ownership, and call <code>submit_runtime_diagnosis</code>. The same bounded contribution is available in Human mode.</>
                : <>WebMCP is unavailable here, so the complete person-attributed diagnosis remains available below. Manual repair drafting stays locked until the evidence is ready.</>}
            </p>
          ) : (
            <p className="diagnostic-mission-note blocked">
              Frontmend will not offer repair staging or a completed assessment receipt from this blocker. A capable agent or person can replace it later with bounded evidence.
            </p>
          )}
          {!mission.diagnosis ? (
            <HumanDiagnosticContribution
              auditId={auditId}
              mission={mission}
              webMcpReady={webMcpReady}
            />
          ) : null}
        </>
      ) : (
        <button type="button" className="repair-button" onClick={openMission} disabled={busy}>
          <MagnifyingGlass size={17} weight="bold" />
          {busy ? "Opening…" : "Open diagnostic mission"}
        </button>
      )}
      {error ? <p className="repair-error" role="alert">{error}</p> : null}
    </section>
  );
}

export function DiagnosticEvidenceCard({ evidence }) {
  if (!evidence?.kind || evidence.provenance !== "measured-lighthouse") return null;
  const actionable = evidence.completeness === "actionable";
  return (
    <section className={`diagnostic-evidence ${actionable ? "actionable" : "partial"}`} aria-labelledby="diagnostic-evidence-title">
      <div className="diagnostic-evidence-heading">
        <span aria-hidden="true"><Pulse size={19} weight="duotone" /></span>
        <div>
          <p className="kicker">Measured diagnostic evidence</p>
          <strong id="diagnostic-evidence-title">
            {evidence.kind === "console-errors"
              ? "Console entries"
              : evidence.kind === "contrast-nodes"
                ? "Affected contrast nodes"
                : "Main-thread attribution"}
          </strong>
        </div>
        <em>{actionable ? "Actionable" : "Evidence gap"}</em>
      </div>
      {evidence.kind === "console-errors" ? (
        <ol>
          {(evidence.entries ?? []).map((entry, index) => (
            <li key={`${entry.sourceUrl ?? entry.source ?? "console"}-${entry.lineNumber ?? index}`}>
              <strong>{entry.description}</strong>
              <code>{entry.sourceUrl ?? entry.source ?? "Source unavailable"}</code>
              {Number.isFinite(entry.lineNumber) ? <small>Line {entry.lineNumber}{Number.isFinite(entry.columnNumber) ? `:${entry.columnNumber}` : ""}</small> : null}
            </li>
          ))}
        </ol>
      ) : null}
      {evidence.kind === "contrast-nodes" ? (
        <ol>
          {(evidence.nodes ?? []).map((node, index) => (
            <li key={`${node.selector}-${index}`}>
              <strong><code>{node.selector}</code></strong>
              {Number.isFinite(node.observedRatio) ? (
                <span>{node.observedRatio}:1 measured{Number.isFinite(node.expectedRatio) ? ` · ${node.expectedRatio}:1 required` : ""}</span>
              ) : null}
              {node.explanation ? <small>{node.explanation}</small> : null}
              {node.snippet ? <code>{node.snippet}</code> : null}
            </li>
          ))}
        </ol>
      ) : null}
      {evidence.kind === "main-thread-blocking" ? (
        <>
          <p className="diagnostic-metric"><strong>{evidence.totalBlockingTimeMs ?? "—"} ms</strong><span>Total blocking time</span></p>
          <ol>
            {(evidence.longTasks ?? []).map((task, index) => (
              <li key={`${task.sourceUrl ?? "task"}-${task.startTimeMs ?? index}`}>
                <strong>{task.durationMs} ms long task</strong>
                <code>{task.sourceUrl ?? "Source unavailable"}</code>
                {Number.isFinite(task.startTimeMs) ? <small>Started at {task.startTimeMs} ms</small> : null}
              </li>
            ))}
          </ol>
        </>
      ) : null}
      {evidence.missing?.length ? (
        <p className="diagnostic-gap"><Warning size={15} weight="fill" aria-hidden="true" /> Missing: {evidence.missing.join(", ")}</p>
      ) : null}
      {evidence.omitted ? <small>{evidence.omitted} additional diagnostic item{evidence.omitted === 1 ? "" : "s"} omitted.</small> : null}
      <p className="diagnostic-caveat">{evidence.caveat}</p>
    </section>
  );
}

export default function DiagnosisWorkspace({ mode, evidence, auditId, finding, mission, webMcp }) {
  if (mode === "evidence") return <DiagnosticEvidenceCard evidence={evidence} />;
  return <DiagnosticMissionCard auditId={auditId} finding={finding} mission={mission} webMcp={webMcp} />;
}
