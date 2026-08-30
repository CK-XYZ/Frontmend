import {
  ArrowRight,
  CheckCircle,
  DownloadSimple,
  Info,
  Pulse,
  Robot,
  Warning,
} from "@phosphor-icons/react";
import { auditService } from "../audit-service.js";
import { RepositoryPlanCard, RuleScopeReceipt } from "./MissionProofComponents.jsx";

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

function VerificationBanner({ verification }) {
  if (!verification) return null;
  const scopeSources = Array.isArray(verification.findingScope?.sources)
    ? verification.findingScope.sources
    : verification.findingSource
      ? [verification.findingSource]
      : [];
  const scoped = scopeSources.length > 1;
  const browserGuardrails = verification.browserGuardrails ?? [];
  const browserReplays = verification.browserReplays?.length
    ? verification.browserReplays
    : verification.browserReplay?.required ? [verification.browserReplay] : [];
  const replayPending = browserReplays.some((replay) => replay.status !== "complete")
    || browserGuardrails.some((guardrail) => guardrail.status !== "complete");
  const browserReplay = browserReplays.length > 0 || browserGuardrails.length > 0;
  const labels = {
    resolved: browserReplay
      ? "Exact rendered issue passed"
      : scoped
        ? "Every captured rule occurrence passed"
        : "Original rule explicitly passed",
    "still-present": browserReplay
      ? "Exact rendered issue still present"
      : scoped
        ? "A captured rule occurrence still fails"
        : "Original finding still present",
    regression: "A retained regression guardrail failed",
    inconclusive: replayPending
      ? "Fresh browser comparison required"
      : scoped
        ? "Rule-scope comparison is inconclusive"
        : "Comparison is inconclusive",
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
          ) : verification.status === "still-present" || verification.status === "regression" ? (
            <Warning size={23} weight="fill" />
          ) : (
            <Info size={23} weight="fill" />
          )}
        </span>
        <div>
          <p className="kicker">{browserReplay ? "Provider + browser proof" : "Before / after proof"}</p>
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
      {browserReplays.length ? (
        <section className="verification-replay-group" aria-labelledby="verification-replay-title">
          <div>
            <p className="kicker">Exact rendered comparison{browserReplays.length === 1 ? "" : "s"}</p>
            <strong id="verification-replay-title">
              {browserReplays.length === 1 ? browserReplays[0].baseline?.title : `${browserReplays.length} retained browser findings`}
            </strong>
            {browserReplays.length > 1 ? <p>Each retained browser symptom must receive its own fresh direct replay.</p> : null}
          </div>
          {browserReplays.map((replay) => (
            <article key={replay.baseline?.findingId} className={`verification-replay-evidence replay-${replay.status}`}>
              <div>
                <strong>{replay.baseline?.title}</strong>
                <p>{replay.baseline?.evidence}</p>
              </div>
              <dl>
                <div><dt>State</dt><dd>{replay.status?.replaceAll("-", " ")}</dd></div>
                <div><dt>Viewport</dt><dd>{replay.baseline?.source?.strategy}</dd></div>
                <div><dt>Outcome</dt><dd>{replay.outcome ?? "Waiting"}</dd></div>
              </dl>
              {replay.summary ? <p>{replay.summary}</p> : null}
            </article>
          ))}
        </section>
      ) : null}
      {browserGuardrails.length ? (
        <section className="verification-browser-guardrails" aria-labelledby="verification-browser-guardrails-title">
          <div>
            <p className="kicker">Retained browser guardrails</p>
            <strong id="verification-browser-guardrails-title">Journey and reflow checks require exact replay</strong>
            <p>A passed assessment check is not assumed safe after repair. Each retained behaviour is observed again at its original viewport.</p>
          </div>
          <ol>
            {browserGuardrails.map((guardrail) => (
              <li key={guardrail.checkId} data-status={guardrail.outcome ?? guardrail.status}>
                <div>
                  <strong>{guardrail.label}</strong>
                  <span>{guardrail.focusArea} · {guardrail.viewport}</span>
                </div>
                <em>{guardrail.outcome ?? guardrail.status?.replaceAll("-", " ")}</em>
                {guardrail.summary ? <p>{guardrail.summary}</p> : null}
              </li>
            ))}
          </ol>
        </section>
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
      {proof?.current?.auditId && !replayPending ? (
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

export default function VerificationWorkspace({ verification }) {
  return <VerificationBanner verification={verification} />;
}
