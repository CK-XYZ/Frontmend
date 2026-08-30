import {
  ArrowsOutSimple,
  Check,
  CheckCircle,
  ClipboardText,
  Code,
  DownloadSimple,
  Robot,
  ShieldCheck,
  Stamp,
  TestTube,
  Warning,
  Wrench,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { AuditError, auditService } from "../audit-service.js";
import { repairMissionState } from "../repair-contract.js";
import { humanMissionMutationFailure } from "../ui/human-mission-recovery.js";
import DiagnosticProvenanceCard from "./DiagnosticProvenanceCard.jsx";
import { RepositoryPlanCard, RuleScopeReceipt } from "./MissionProofComponents.jsx";

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

function RepairImpactMatrix({ repair }) {
  const impact = repair?.verificationImpact;
  if (!impact) return null;
  const aggregate = repair.aggregateVerification;
  const rows = aggregate?.rows ?? impact.matrix?.rows ?? impact.previewRows ?? [];
  const routeCount = new Set(rows.map((row) => row.targetId)).size;
  const status = aggregate?.status ?? (impact.status === "reviewed" ? "reviewed" : "awaiting review");
  const selectedTargetIds = new Set(impact.selectedTargetIds ?? []);
  const proofLabels = {
    "provider-rule": "Exact provider rule",
    "provider-guardrail": "Provider guardrail",
    "new-findings-guardrail": "New high/medium findings",
    "browser-replay": "Browser replay",
    "browser-guardrail": "Browser guardrail",
  };
  return (
    <section className="repair-impact-matrix" aria-labelledby={`repair-impact-${repair.id}`}>
      <header>
        <span aria-hidden="true"><TestTube size={20} weight="duotone" /></span>
        <div>
          <p className="kicker">Reviewed repair impact</p>
          <strong id={`repair-impact-${repair.id}`}>
            {routeCount} audited route{routeCount === 1 ? "" : "s"} · {rows.length} proof row{rows.length === 1 ? "" : "s"}
          </strong>
        </div>
        <em data-status={status}>{status}</em>
      </header>
      <div className="repair-impact-table" role="table" aria-label="Repair verification matrix">
        <div className="repair-impact-row repair-impact-head" role="row">
          <span role="columnheader">Route</span>
          <span role="columnheader">Proof</span>
          <span role="columnheader">Strategy</span>
          <span role="columnheader">Status</span>
        </div>
        {rows.map((row) => (
          <div className="repair-impact-row" role="row" key={row.id}>
            <code role="cell">{row.path}</code>
            <span role="cell">{proofLabels[row.proofKind] ?? "Bounded evidence"}</span>
            <span role="cell">{row.strategy}</span>
            <strong role="cell" data-status={row.status}>{row.status}</strong>
          </div>
        ))}
      </div>
      {impact.candidates?.length ? (
        <details className="repair-impact-candidates">
          <summary>
            {impact.candidates.length} optional audited route{impact.candidates.length === 1 ? "" : "s"} considered
          </summary>
          <ul>
            {impact.candidates.map((candidate) => (
              <li key={candidate.id} data-selected={selectedTargetIds.has(candidate.id) ? "true" : "false"}>
                <span>
                  <code>{candidate.path}</code>
                  <small>{candidate.strategies.join(" + ")} · {candidate.reason}</small>
                </span>
                <strong>{selectedTargetIds.has(candidate.id) ? "Included" : "Not selected"}</strong>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <small>
        Scope is frozen at approval. A failed exact row stays present; a failed guardrail is a regression; missing, blocked, or incomparable evidence stays inconclusive. Deployment remains person-owned.
      </small>
    </section>
  );
}

function RepairWorkbench({
  auditId,
  finding,
  findings = [],
  repair,
  repairPrepared,
  diagnosticReady,
  onRepairChange,
  onVerify,
}) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [deploymentConfirmed, setDeploymentConfirmed] = useState(false);
  const [revisionFeedback, setRevisionFeedback] = useState("");
  const [verificationScope, setVerificationScope] = useState(null);
  const [verificationTargetIds, setVerificationTargetIds] = useState([]);
  const [verificationScopeStatus, setVerificationScopeStatus] = useState("idle");
  const [verificationScopeError, setVerificationScopeError] = useState("");
  const [scopeRefreshRevision, setScopeRefreshRevision] = useState(0);
  const packageFindings = findings.length ? findings : finding ? [finding] : [];
  const packageFindingIds = packageFindings.map((item) => item.id);

  useEffect(() => {
    setReviewConfirmed(false);
    setDeploymentConfirmed(false);
    setRevisionFeedback("");
  }, [repair?.id, repair?.revision, repair?.status]);

  useEffect(() => {
    if (repair || !repairPrepared || !diagnosticReady || !finding?.id) {
      setVerificationScope(null);
      setVerificationTargetIds([]);
      setVerificationScopeStatus("idle");
      setVerificationScopeError("");
      return undefined;
    }
    let active = true;
    let retryTimer;
    setVerificationScope(null);
    setVerificationTargetIds([]);
    setVerificationScopeStatus("loading");
    setVerificationScopeError("");
    void auditService.getVerificationCandidates(auditId, finding.id, packageFindingIds)
      .then((scope) => {
        if (!active) return;
        setVerificationScope(scope);
        setVerificationTargetIds(scope.selectedTargetIds ?? []);
        setVerificationScopeStatus("ready");
        setVerificationScopeError("");
      })
      .catch((cause) => {
        if (!active) return;
        setVerificationScope(null);
        setVerificationTargetIds([]);
        setVerificationScopeStatus("unavailable");
        setVerificationScopeError(
          cause instanceof AuditError
            ? cause.message
            : "Frontmend could not read the current verification candidates.",
        );
        retryTimer = window.setTimeout(() => {
          if (active) setScopeRefreshRevision((revision) => revision + 1);
        }, 3_000);
      });
    return () => {
      active = false;
      window.clearTimeout(retryTimer);
    };
  }, [auditId, diagnosticReady, finding?.id, packageFindingIds.join("|"), repair, repairPrepared, scopeRefreshRevision]);

  if (!finding) return null;

  const handleMutationFailure = async (cause, fallbackMessage) => {
    const failure = await humanMissionMutationFailure(cause, auditId, fallbackMessage);
    if (failure.stale) {
      setReviewConfirmed(false);
      setDeploymentConfirmed(false);
      setRevisionFeedback("");
      setVerificationScope(null);
      setVerificationTargetIds([]);
      setVerificationScopeStatus("idle");
      setScopeRefreshRevision((revision) => revision + 1);
    }
    setError(failure.message);
  };

  const stage = async () => {
    if (verificationScopeStatus !== "ready" || !verificationScope) {
      setError("Wait for the current verification scope before staging this repair.");
      return;
    }
    setBusy("stage");
    setError("");
    try {
      onRepairChange(
        await auditService.stageRepair(auditId, {
          findingId: finding.id,
          findingIds: packageFindingIds,
          source: "human",
          verificationTargetIds,
        }),
      );
    } catch (cause) {
      await handleMutationFailure(cause, "The repair draft could not be staged.");
    } finally {
      setBusy("");
    }
  };

  const retryVerificationScope = () => {
    if (verificationScopeStatus === "loading") return;
    setScopeRefreshRevision((revision) => revision + 1);
  };

  const approve = async () => {
    setBusy("approve");
    setError("");
    try {
      onRepairChange(await auditService.approveRepair(auditId, repair.id));
    } catch (cause) {
      await handleMutationFailure(cause, "The repair draft could not be approved.");
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
      await handleMutationFailure(cause, "The change request could not be recorded.");
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
      await handleMutationFailure(cause, "The verification audit could not start.");
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
      await handleMutationFailure(cause, "The deployment handoff could not be recorded.");
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
          <h3>
            {repairPrepared
              ? diagnosticReady
                ? "Turn this finding into a reviewable change."
                : "Finish the diagnosis before drafting a change."
              : "Repair drafting waits for explicit intent."}
          </h3>
          <p>
            {repairPrepared
              ? diagnosticReady
                ? "Frontmend will stage a bounded starting point. An agent can propose a richer draft through WebMCP; approval stays in this visible review interface."
                : "The measured symptom still needs browser reproduction and repository ownership. Repair tooling unlocks when that evidence is contributed."
              : "Use Prepare a fix on the selected mission priority first. That records the target without approving code or changing your repair policy."}
          </p>
        </div>
        {repairPrepared && diagnosticReady ? (
          <fieldset className="verification-scope-picker">
            <legend>Verification impact before review</legend>
            <p>
              Root and failed audited routes are included automatically. Add only completed routes where this exact rule was evaluated.
            </p>
            {verificationScopeStatus === "loading" ? (
              <small role="status">Checking the retained audit evidence for eligible routes…</small>
            ) : null}
            {verificationScopeStatus === "unavailable" ? (
              <div className="verification-scope-warning" role="alert">
                <Warning size={17} weight="fill" aria-hidden="true" />
                <div>
                  <strong>Verification scope temporarily unavailable</strong>
                  <p>{verificationScopeError}</p>
                  <small>
                    No repair can be staged until this read succeeds. Frontmend retries automatically and does not change the repair.
                  </small>
                </div>
                <button type="button" onClick={retryVerificationScope}>
                  Retry scope now
                </button>
              </div>
            ) : null}
            {verificationScopeStatus === "ready" && !verificationScope?.candidates?.length ? (
              <small role="status">No additional audited route evaluated this exact rule.</small>
            ) : null}
            {verificationScope?.candidates?.length ? (
              <div className="verification-scope-options">
                {verificationScope.candidates.map((candidate) => {
                  const selected = verificationTargetIds.includes(candidate.id);
                  return (
                    <label key={candidate.id} data-selected={selected ? "true" : "false"}>
                      <input
                        type="checkbox"
                        checked={selected}
                        disabled={Boolean(busy)}
                        onChange={() => setVerificationTargetIds((current) => selected
                          ? current.filter((id) => id !== candidate.id)
                          : [...current, candidate.id].slice(0, verificationScope.limit ?? 3))}
                      />
                      <span>
                        <code>{candidate.path}</code>
                        <small>{candidate.strategies.join(" + ")} · {candidate.reason}</small>
                      </span>
                    </label>
                  );
                })}
              </div>
            ) : null}
            <small>Selection is frozen into the matrix only when the repair is approved.</small>
          </fieldset>
        ) : null}
        {repairPrepared && diagnosticReady ? (
          <button
            type="button"
            className="repair-button"
            onClick={stage}
            disabled={Boolean(busy) || verificationScopeStatus !== "ready"}
          >
            <ClipboardText size={17} weight="bold" />
            {busy === "stage"
              ? "Staging…"
              : verificationScopeStatus === "ready"
                ? "Stage repair draft"
                : "Waiting for verification scope"}
          </button>
        ) : null}
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
      {(repair.findingPackage?.items?.length ?? repair.findingIds?.length ?? 1) > 1 ? (
        <section className="repair-package-summary" aria-labelledby={`repair-package-${repair.id}`}>
          <div>
            <p className="kicker">Cohesive repair package</p>
            <strong id={`repair-package-${repair.id}`}>{repair.findingIds.length} frozen findings · one reviewed change</strong>
          </div>
          <ol>
            {(repair.findingPackage?.items ?? []).map((item, index) => (
              <li key={item.findingId}>
                <span>{index + 1}</span>
                <div>
                  <strong>{item.title}</strong>
                  <small>{item.category} · {item.source?.auditId ?? item.findingId}</small>
                </div>
                <em>{index === 0 ? "Primary" : item.diagnosticMission ? "Diagnosed" : "Retained"}</em>
              </li>
            ))}
          </ol>
          <small>Package membership is immutable. One approval covers this proposal only; deployment and every verification row remain separate.</small>
        </section>
      ) : null}
      <RuleScopeReceipt
        scope={repair.findingScope}
        fallbackSource={repair.findingSource}
        mode="repair"
      />
      <RepositoryPlanCard plan={repair.repositoryPlan} />
      <DiagnosticProvenanceCard mission={repair.diagnosticMission} />
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
      <RepairImpactMatrix repair={repair} />
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

export default function RepairWorkspace(props) {
  return <RepairWorkbench {...props} />;
}
