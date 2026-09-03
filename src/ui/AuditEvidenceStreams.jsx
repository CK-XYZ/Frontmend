import { CheckCircle, Circle, Robot, ShieldCheck, Warning } from "@phosphor-icons/react";
import { useId } from "react";
import { formatDuration } from "./use-audit-progress.js";
import { retainedAuditMission } from "./AuditMissionSummary.jsx";

/*
 * The lower half of the live audit card.
 *
 * It used to carry the mission summary - the same three standing facts the run
 * had already stated, set at the same weight as the part that changes, and
 * unchanged from the first second of the audit to the last. Under a bar that
 * could not move for thirty seconds it left the whole screen with nothing
 * happening on it.
 *
 * What is genuinely in motion here is the evidence: two independent sources,
 * requested together, settling at different times, either of which may come
 * back unavailable. That is what this band reports now. The mission facts stay
 * - the run should say what it covers - but as one quiet line under the thing
 * that is actually happening, which is where they belong while measuring.
 */
const FALLBACK_STREAMS = Object.freeze([
  Object.freeze({
    id: "lighthouse",
    label: "Lighthouse mobile and desktop",
    detail: "PageSpeed Insights",
  }),
  Object.freeze({
    id: "document",
    label: "Live HTML document",
    detail: "Response headers, metadata, routes",
  }),
]);

const STREAM_STATE = Object.freeze({
  pending: { label: "Queued", tone: "pending" },
  running: { label: "Measuring", tone: "running" },
  complete: { label: "Retained", tone: "complete" },
  unavailable: { label: "Unavailable", tone: "unavailable" },
});

function streamIcon(status) {
  if (status === "complete") return <CheckCircle size={17} weight="fill" />;
  if (status === "unavailable") return <Warning size={17} weight="fill" />;
  return <Circle size={17} weight={status === "running" ? "bold" : "regular"} />;
}

/*
 * A run with no reported streams still knows one thing for certain: both
 * sources are requested the moment it starts. That is the only status inferred
 * here, and nothing infers a *settled* source - an unreported stream stays
 * unreported rather than being filled in from the percentage.
 */
function resolveStreams(audit) {
  const reported = Array.isArray(audit?.streams) ? audit.streams : null;
  if (reported?.length) return reported;
  const status = audit?.status === "queued" ? "pending" : "running";
  return FALLBACK_STREAMS.map((stream) => ({ ...stream, status, durationMs: null }));
}

function focusLabel(mission) {
  const areas = Array.isArray(mission?.focusAreas) ? mission.focusAreas : [];
  if (!areas.length) return "all supported areas";
  return areas.map((area) => (area === "seo" ? "SEO" : area)).join(", ");
}

export function AuditEvidenceStreams({ audit }) {
  const titleId = useId();
  const mission = retainedAuditMission(audit);
  const streams = resolveStreams(audit);
  const settledCount = streams.filter((stream) =>
    ["complete", "unavailable"].includes(stream.status)).length;

  return (
    <section className="evidence-streams" aria-labelledby={titleId}>
      <div className="evidence-streams-head">
        <h2 id={titleId}>Independent evidence sources</h2>
        <p aria-live="polite" aria-atomic="true">
          {settledCount} of {streams.length} settled
        </p>
      </div>
      <ul className="evidence-stream-list">
        {streams.map((stream) => {
          const state = STREAM_STATE[stream.status] ?? STREAM_STATE.pending;
          const duration = formatDuration(stream.durationMs);
          return (
            <li key={stream.id} className={`evidence-stream ${state.tone}`}>
              <span className="evidence-stream-mark" aria-hidden="true">
                {streamIcon(stream.status)}
              </span>
              <span className="evidence-stream-label">
                <strong>{stream.label}</strong>
                <small>{stream.detail}</small>
              </span>
              <span className="evidence-stream-state">
                {state.label}
                {duration ? <small>{duration}</small> : null}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="evidence-streams-note">
        Each source is measured on its own and reconciled only after both settle. A source that
        fails is reported unavailable; Frontmend never fills its evidence in from the other.
      </p>
      <div className="evidence-streams-mission">
        <p className="evidence-streams-scope">
          <Robot size={15} weight="fill" aria-hidden="true" />
          <span>
            {mission.requestedBy === "agent" ? "Agent-started" : "Person-started"}
            {" · "}
            {mission.scope === "bounded-site" ? "bounded site" : "single page"}
            {" · "}
            {focusLabel(mission)}
          </span>
        </p>
        <p className="evidence-streams-authority">
          <ShieldCheck size={15} weight="duotone" aria-hidden="true" />
          <span>
            Public evidence completes first. Repository diagnosis starts only after you select a
            repair, and approval, deployment, and attestation stay yours.
          </span>
        </p>
      </div>
    </section>
  );
}
