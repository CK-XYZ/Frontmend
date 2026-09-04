import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle,
  ClipboardText,
  Code,
  DownloadSimple,
  LinkSimple,
  Robot,
  X,
} from "@phosphor-icons/react";
import { useMemo, useRef, useState } from "react";
import { auditService } from "../audit-service.js";
import { deriveAuditMissionState } from "../audit-mission-contract.js";
import {
  codingAgentBriefText,
  createCodingAgentBrief,
} from "../coding-agent-brief-contract.js";
import { retainedAuditMission } from "../ui/AuditMissionSummary.jsx";

function auditWorkspacePath(auditId) {
  return `/audits/${encodeURIComponent(auditId)}`;
}

function evidenceLabel(report) {
  const labels = {
    "live-document": "Live document audit",
    "live-lighthouse-document": "Lighthouse + document audit",
    "hybrid-lighthouse-document": "Partial Lighthouse + document audit",
    "live-lighthouse-document-unavailable": "Lighthouse audit · document unavailable",
    "live-lighthouse-partial": "Partial Lighthouse audit",
  };
  return labels[report?.engine?.mode] ?? "Live Lighthouse audit";
}

function label(value) {
  return String(value ?? "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function countLabel(value, singular, plural = `${singular}s`) {
  return `${value} ${value === 1 ? singular : plural}`;
}

function EvidenceDetails({ recommendation }) {
  return (
    <details className="recommendation-evidence">
      <summary>
        <span>Exact audit evidence</span>
        <ArrowRight size={15} weight="bold" aria-hidden="true" />
      </summary>
      <div>
        <dl className="recommendation-source">
          <div>
            <dt>Source</dt>
            <dd>{recommendation.source.provider}</dd>
          </div>
          <div>
            <dt>Rule</dt>
            <dd><code>{recommendation.source.ruleId}</code></dd>
          </div>
          <div>
            <dt>Observed</dt>
            <dd>{countLabel(recommendation.affected.occurrenceCount, "occurrence")}</dd>
          </div>
        </dl>
        <ul className="recommendation-targets">
          {recommendation.targets.map((target, index) => (
            <li key={`${target.route}:${target.viewport}:${target.selector ?? "target"}:${index}`}>
              <p>
                <code>{target.route}</code>
                <span>{label(target.viewport)}</span>
                {target.selector ? <code>{target.selector}</code> : null}
              </p>
              <span>{target.evidence}</span>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

function Recommendation({ recommendation }) {
  return (
    <article className="audit-recommendation" data-severity={recommendation.severity}>
      <p className="recommendation-rank" aria-hidden="true">
        {String(recommendation.rank).padStart(2, "0")}
      </p>
      <div className="recommendation-body">
        <header>
          <div className="recommendation-labels">
            <span>{label(recommendation.category)}</span>
            <span data-severity={recommendation.severity}>{recommendation.severity}</span>
          </div>
          <h2>{recommendation.title}</h2>
        </header>

        <p className="recommendation-evidence-summary">{recommendation.evidence}</p>

        <div className="recommendation-action">
          <p>Recommended change</p>
          <strong>{recommendation.recommendation}</strong>
        </div>

        <div className="recommendation-context" aria-label="Affected context">
          {recommendation.affected.routes.length ? (
            <p><span>Routes</span>{recommendation.affected.routes.map((route) => <code key={route}>{route}</code>)}</p>
          ) : null}
          {recommendation.affected.viewports.length ? (
            <p><span>Viewports</span>{recommendation.affected.viewports.map((viewport) => <em key={viewport}>{label(viewport)}</em>)}</p>
          ) : null}
          {recommendation.affected.selectors.length ? (
            <p><span>Targets</span>{recommendation.affected.selectors.map((selector) => <code key={selector}>{selector}</code>)}</p>
          ) : null}
        </div>

        <div className="recommendation-acceptance">
          <p>Done when</p>
          <ul>
            {recommendation.acceptanceCriteria.map((criterion) => (
              <li key={criterion}>
                <Check size={15} weight="bold" aria-hidden="true" />
                <span>{criterion}</span>
              </li>
            ))}
          </ul>
        </div>

        <EvidenceDetails recommendation={recommendation} />
      </div>
    </article>
  );
}

export default function AuditRecommendationsWorkspace({ audit, webMcp, onReset }) {
  const report = audit.report;
  const mission = retainedAuditMission(audit);
  const browserReview = auditService.getBrowserReview(report.auditId);
  const explorations = auditService.getSiteExplorations(report.auditId);
  const missionState = deriveAuditMissionState({
    report,
    mission,
    diagnosticMissions: auditService.getDiagnosticMissions(report.auditId),
    repairs: auditService.getRepairs(report.auditId),
    browserReview,
    explorations,
  });
  const brief = useMemo(
    () => createCodingAgentBrief({
      report,
      priorities: missionState.priorities,
      mission,
    }),
    [report, missionState.priorities, mission],
  );
  const briefText = useMemo(() => codingAgentBriefText(brief), [brief]);
  const [shareState, setShareState] = useState("idle");
  const [briefState, setBriefState] = useState("idle");
  const manualInputRef = useRef(null);
  const shareUrl = new URL(auditWorkspacePath(report.auditId), window.location.origin).href;
  const observationCount = Number.isFinite(missionState.matchingFindingCount)
    ? missionState.matchingFindingCount
    : report.findingCount ?? report.findings?.length ?? 0;
  const viewportCount = report.viewports?.length ?? 0;
  const recommendationCount = brief.recommendations.length;

  const copy = async (value, kind) => {
    setShareState("idle");
    setBriefState("idle");
    try {
      if (typeof navigator.clipboard?.writeText !== "function") throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(value);
      if (kind === "brief") setBriefState("copied");
      else setShareState("copied");
      window.setTimeout(() => {
        setShareState("idle");
        setBriefState("idle");
      }, 1_600);
    } catch {
      if (kind === "brief") setBriefState("manual");
      else setShareState("manual");
      window.requestAnimationFrame(() => {
        manualInputRef.current?.focus();
        manualInputRef.current?.select();
      });
    }
  };

  const manualValue = briefState === "manual" ? briefText : shareUrl;

  return (
    <section className="report-view recommendations-workspace" aria-labelledby="report-title">
      <header className="report-heading recommendations-heading">
        <div className="report-heading-copy">
          <p className="report-case-label">Frontend audit complete</p>
          <h1 id="report-title">{report.hostname}</h1>
          <p className="report-heading-state">
            <CheckCircle size={18} weight="fill" aria-hidden="true" />
            Recommendations ready
          </p>
          <p className="report-heading-evidence">{evidenceLabel(report)} · public evidence retained</p>
        </div>
        <nav className="report-nav-actions" aria-label="Audit actions">
          <button className="back-button" type="button" onClick={onReset}>
            <ArrowLeft size={17} weight="bold" aria-hidden="true" />
            New audit
          </button>
          <button className="share-audit" type="button" onClick={() => copy(shareUrl, "share")}>
            {shareState === "copied"
              ? <Check size={16} weight="bold" aria-hidden="true" />
              : <LinkSimple size={16} weight="bold" aria-hidden="true" />}
            {shareState === "copied" ? "Link copied" : "Share"}
          </button>
          <a className="share-audit" href={auditService.getAuditReportUrl(report.auditId)} download>
            <DownloadSimple size={16} weight="bold" aria-hidden="true" />
            Export
          </a>
        </nav>
      </header>

      {briefState === "manual" || shareState === "manual" ? (
        <div className="manual-share recommendations-manual-copy" role="status">
          <label htmlFor="recommendations-manual-copy">
            {briefState === "manual" ? "Coding-agent brief" : "Stable audit link"}
          </label>
          <div>
            <textarea
              ref={manualInputRef}
              id="recommendations-manual-copy"
              value={manualValue}
              readOnly
              rows={briefState === "manual" ? 10 : 2}
              onFocus={(event) => event.currentTarget.select()}
            />
            <button
              type="button"
              aria-label="Close manual copy field"
              onClick={() => {
                setBriefState("idle");
                setShareState("idle");
              }}
            >
              <X size={15} weight="bold" aria-hidden="true" />
            </button>
          </div>
          <small>Clipboard access is unavailable. Copy this text manually.</small>
        </div>
      ) : null}

      <div className="recommendations-document">
        <section className="recommendations-intro" aria-labelledby="recommendations-title">
          <p className="recommendations-kicker">The useful bit</p>
          <h2 id="recommendations-title">
            {recommendationCount
              ? `${countLabel(recommendationCount, "fix")} worth making.`
              : "No high-signal fix was retained."}
          </h2>
          <p>
            {recommendationCount
              ? "A readable shortlist for you, with the exact evidence your coding agent needs to investigate and fix the implementation."
              : "The requested automated checks did not retain an actionable failure. This is not a complete manual audit."}
          </p>
          <dl className="recommendations-run-facts">
            <div>
              <dt>Signals retained</dt>
              <dd>{observationCount}</dd>
            </div>
            <div>
              <dt>Viewports measured</dt>
              <dd>{viewportCount || "Document"}</dd>
            </div>
            <div>
              <dt>Audit source</dt>
              <dd>{evidenceLabel(report)}</dd>
            </div>
          </dl>
        </section>

        {recommendationCount ? (
          <section className="recommendations-list" aria-label="Ranked recommendations">
            {brief.recommendations.map((recommendation) => (
              <Recommendation key={recommendation.findingId} recommendation={recommendation} />
            ))}
          </section>
        ) : null}

        <section className="coding-agent-handoff" aria-labelledby="coding-agent-handoff-title">
          <div className="coding-agent-handoff-mark" aria-hidden="true">
            <Robot size={27} weight="duotone" />
          </div>
          <div>
            <p className="recommendations-kicker">Continue in your codebase</p>
            <h2 id="coding-agent-handoff-title">Give the evidence to your coding agent.</h2>
            <p>
              The brief contains the ranked recommendations, exact rules, retained routes,
              selectors, viewports, and acceptance criteria. The agent can inspect and change the
              repository with its normal tools—Frontmend does not sit in the middle of that work.
            </p>
            <ol>
              <li><Code size={16} weight="bold" aria-hidden="true" />Inspect and fix the repository</li>
              <li><Check size={16} weight="bold" aria-hidden="true" />Run the project&apos;s real checks</li>
              <li><ClipboardText size={16} weight="bold" aria-hidden="true" />Re-audit after deployment</li>
            </ol>
          </div>
          <button type="button" onClick={() => copy(briefText, "brief")} disabled={!recommendationCount}>
            {briefState === "copied"
              ? <Check size={17} weight="bold" aria-hidden="true" />
              : <ClipboardText size={17} weight="bold" aria-hidden="true" />}
            {briefState === "copied" ? "Brief copied" : "Copy coding-agent brief"}
          </button>
          <small>
            Frontmend audited the public site. It has not inspected your source, changed code,
            deployed anything, or proved these issues resolved.
          </small>
        </section>

        <footer className="recommendations-footer-note">
          <span>Audit {report.auditId.slice(0, 8).toUpperCase()}</span>
          <span>{webMcp?.supported ? "WebMCP agent handoff available" : "Complete human interface"}</span>
        </footer>
      </div>
    </section>
  );
}
