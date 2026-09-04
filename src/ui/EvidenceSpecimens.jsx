import { ArrowRight, Check, Warning } from "@phosphor-icons/react";

/**
 * Illustrative evidence specimens for the marketing surfaces.
 *
 * These render an example frontend, not a measured page. Every specimen is
 * decorative: the meaningful stage copy lives in the surrounding list, and the
 * They show the evidence-to-agent handoff without implying that Frontmend has
 * inspected a repository, changed source, approved work, or deployed a site.
 */

const SPECIMEN_TITLE = "We design thoughtful digital experiences";
const SPECIMEN_COPY = "We help teams turn complex problems into clear, human-centered solutions.";
const SPECIMEN_COPY_ALT = "Craft simple & ethical software experiences.";

const DIAGNOSIS_LINES = [
  { number: "01", code: "rule  color-contrast" },
  { number: "02", code: "target  .hero__title", active: true },
  { number: "03", code: "route  /" },
  { number: "04", code: "viewport  mobile + desktop" },
  { number: "05", code: "ratio  2.75:1" },
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
        <span className="specimen-review-title">Coding-agent brief</span>
        <span className="specimen-code-text">01 · Fix text contrast</span>
        <span className="specimen-code-text">rule · color-contrast</span>
        <span className="specimen-code-text is-added">target · .hero__title</span>
        <span className="specimen-code-text">route · / · mobile</span>
      </span>
      <span className="specimen-review-rationale">
        <span className="specimen-review-title">Done when</span>
        <span>Foreground and background reach at least 4.5:1.</span>
        <span className="specimen-review-actions">
          <span className="specimen-pill">Evidence attached</span>
          <span className="specimen-pill is-primary">Ready for Codex</span>
        </span>
      </span>
      <span className="specimen-review-seal">
        <ArrowRight size={12} weight="bold" />
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
