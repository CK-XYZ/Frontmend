import { Check, LockSimple, Warning } from "@phosphor-icons/react";

/**
 * Illustrative evidence specimens for the marketing surfaces.
 *
 * These render an example frontend, not a measured page. Every specimen is
 * decorative: the meaningful stage copy lives in the surrounding list, and the
 * "Request changes" / "Approve repair" affordances are inert spans so the
 * landing page never implies that Frontmend can approve or deploy anything.
 */

const SPECIMEN_TITLE = "We design thoughtful digital experiences";
const SPECIMEN_COPY = "We help teams turn complex problems into clear, human-centered solutions.";
const SPECIMEN_COPY_ALT = "Craft simple & ethical software experiences.";

const DIAGNOSIS_LINES = [
  { number: "40", code: "" },
  { number: "41", code: ".hero__title {" },
  { number: "42", code: "  color: #6b7280;", active: true },
  { number: "43", code: "  font-size: 28px;" },
  { number: "44", code: "  line-height: 1.2;" },
  { number: "", code: "}" },
];

function SpecimenChrome() {
  return (
    <span className="specimen-chrome">
      <span className="specimen-chrome-mark">studio</span>
      <span className="specimen-chrome-nav">Work</span>
    </span>
  );
}

export function SiteSpecimen({ state = "unresolved", split = false }) {
  return (
    <span className={`specimen-site is-${state}`}>
      <SpecimenChrome />
      <span className="specimen-site-body">
        <span className="specimen-site-title">{SPECIMEN_TITLE}</span>
        <span className="specimen-site-copy">
          <span>{SPECIMEN_COPY}</span>
          {split ? <span>{SPECIMEN_COPY_ALT}</span> : null}
        </span>
      </span>
      {state === "unresolved" ? (
        <span className="specimen-flag">
          <Warning size={13} weight="fill" />
        </span>
      ) : null}
    </span>
  );
}

export function SelectionSpecimen() {
  return (
    <span className="specimen-site is-inspecting">
      <SpecimenChrome />
      <span className="specimen-site-body">
        <span className="specimen-selection">
          <span className="specimen-site-title">{SPECIMEN_TITLE}</span>
          <span className="specimen-selection-tag">.hero__title</span>
        </span>
      </span>
    </span>
  );
}

export function DiagnosisSpecimen() {
  return (
    <span className="specimen-code">
      {DIAGNOSIS_LINES.map((line, index) => (
        <span
          className={`specimen-code-line${line.active ? " is-active" : ""}`}
          key={`${line.number}-${index}`}
        >
          <span className="specimen-code-number">{line.number}</span>
          <span className="specimen-code-text">{line.code}</span>
        </span>
      ))}
    </span>
  );
}

export function ReviewSpecimen() {
  return (
    <span className="specimen-review">
      <span className="specimen-review-diff">
        <span className="specimen-review-title">Proposed repair</span>
        <span className="specimen-code-text">.hero__title {"{"}</span>
        <span className="specimen-code-text is-removed">- color: #6b7280;</span>
        <span className="specimen-code-text is-added">+ color: #111827;</span>
        <span className="specimen-code-text">{"}"}</span>
      </span>
      <span className="specimen-review-rationale">
        <span className="specimen-review-title">Rationale:</span>
        <span>Meets WCAG AA for body text on this background.</span>
        <span className="specimen-review-actions">
          <span className="specimen-pill">Request changes</span>
          <span className="specimen-pill is-primary">Approve repair</span>
        </span>
      </span>
      <span className="specimen-review-seal">
        <LockSimple size={12} weight="fill" />
      </span>
    </span>
  );
}

export function VerifiedSpecimen() {
  return (
    <span className="specimen-site is-resolved">
      <SpecimenChrome />
      <span className="specimen-site-body">
        <span className="specimen-site-title">{SPECIMEN_TITLE}</span>
        <span className="specimen-site-copy">
          <span>{SPECIMEN_COPY}</span>
        </span>
      </span>
      <span className="specimen-seal">
        <Check size={12} weight="bold" />
      </span>
    </span>
  );
}
