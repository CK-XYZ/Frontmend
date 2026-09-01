import { useId } from "react";

function readableStatus(value) {
  return typeof value === "string" ? value.replaceAll("-", " ") : "unavailable";
}

function evidenceSources(report) {
  if (Array.isArray(report.coverage?.adapters) && report.coverage.adapters.length) {
    return report.coverage.adapters.slice(0, 4).map((adapter) => ({
      id: adapter.adapterId,
      label: adapter.provider,
      status: adapter.status,
    }));
  }
  return [
    {
      id: "lighthouse",
      label: "Lighthouse viewports",
      status: report.coverage?.sources?.lighthouse?.status ?? "unavailable",
    },
    {
      id: "document",
      label: "Live document",
      status: report.coverage?.sources?.document?.status ?? "unavailable",
    },
  ];
}

function requestedCoverage(state) {
  if (!state.siteScope?.requested) {
    return {
      label: "This public page",
      status: "page scope",
    };
  }
  const requested = state.siteScope.pagesRequested || state.siteScope.routeCandidates?.length || 0;
  const completed = state.siteScope.pagesComplete ?? 0;
  return {
    label: `Bounded site · up to ${state.siteScope.routeLimit} routes`,
    status: requested
      ? `${completed} of ${requested} retained route audits complete`
      : readableStatus(state.siteScope.status),
  };
}

export function EvidenceOverview({ report, missionState }) {
  const titleId = useId();
  const coverage = requestedCoverage(missionState);
  const sources = evidenceSources(report);
  const score = Number.isFinite(report.score) ? report.score : null;
  const sourceFailures = Array.isArray(report.sourceFailures) ? report.sourceFailures : [];

  return (
    <section className="evidence-overview" aria-labelledby={titleId}>
      <div className="evidence-overview-heading">
        <div>
          <p className="kicker">Evidence at a glance</p>
          <h2 id={titleId}>What Frontmend measured—and what remains</h2>
        </div>
        <span>{readableStatus(report.coverage?.level ?? "legacy evidence")}</span>
      </div>
      <div className="evidence-overview-grid">
        <article className="evidence-overview-coverage">
          <span>Requested coverage</span>
          <strong>{coverage.label}</strong>
          <small>Coverage state · {coverage.status}</small>
        </article>
        <article className="evidence-overview-sources">
          <span>Evidence sources</span>
          <ul>
            {sources.map((source) => (
              <li key={source.id}>
                <strong>{source.label}</strong>
                <em className={`source-${source.status}`}>{readableStatus(source.status)}</em>
              </li>
            ))}
          </ul>
        </article>
        <article className="evidence-overview-score" aria-label={`Measured score ${score ?? "unavailable"}${score === null ? "" : " out of 100"}`}>
          <span>Measured score</span>
          <strong>{score ?? "—"}{score === null ? null : <small>/100</small>}</strong>
          <small>Supporting signal, not mission completion</small>
        </article>
        <article className="evidence-overview-priorities">
          <span>Priority queue</span>
          <strong>{missionState.priorityCount}</strong>
          <small>{missionState.priorityCount === 1 ? "Ranked evidence priority" : "Ranked evidence priorities"}</small>
        </article>
      </div>
      {sourceFailures.length ? (
        <ul className="evidence-overview-failures" aria-label="Unavailable evidence sources">
          {sourceFailures.map((failure) => (
            <li key={`${failure.source}-${failure.code}`}>
              <strong>{failure.source}</strong>
              <code>{failure.code}</code>
              <span>{failure.message}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="evidence-overview-boundary">
          Source completion describes measured page evidence. Rendered journeys, repository diagnosis,
          human approval and fresh verification remain separate mission checkpoints.
        </p>
      )}
    </section>
  );
}
