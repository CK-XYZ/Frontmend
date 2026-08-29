import { FileCode } from "@phosphor-icons/react";
import { useId } from "react";

export function RuleScopeReceipt({ scope, fallbackSource, outcomes = [], outcomeLabels = {}, mode }) {
  const sources = Array.isArray(scope?.sources) && scope.sources.length
    ? scope.sources
    : fallbackSource
      ? [fallbackSource]
      : [];
  if (!sources.length) return null;
  const browserScope = sources.every((source) => source.provider === "Frontmend browser review");
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
          <strong>{occurrenceCount} {browserScope ? "retained" : "measured"} occurrence{occurrenceCount === 1 ? "" : "s"}</strong>
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
          ? browserScope
            ? "Resolution requires an explicit fresh browser pass for the retained rendered issue."
            : "Resolution requires an explicit pass for every listed strategy."
          : "This scope is carried into verification; one passing strategy cannot hide another failure."}
        {omitted ? ` ${omitted} additional occurrence${omitted === 1 ? " was" : "s were"} omitted by the evidence bound.` : ""}
      </p>
    </section>
  );
}

export function RepositoryPlanCard({ plan }) {
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
