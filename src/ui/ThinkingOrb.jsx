/*
 * Thinking orb — one small indicator for work that is genuinely pending.
 *
 * The shape is borrowed from the canvas "thinking orbs" vocabulary
 * (github.com/Jakubantalik/thinking-orbs) and rebuilt as static SVG driven by
 * CSS: a dotted globe turning behind two meridians that sweep edge-on and back,
 * so it reads as a rotating sphere rather than an arc chasing its own tail.
 * No canvas, no dependency, and nothing to pause when the tab is hidden.
 *
 * Decorative by contract: the meaning lives in the adjacent status text, so the
 * orb itself is hidden from assistive technology. Size and colour come from
 * `--orb-size` and `--orb-tint` on any ancestor.
 */
export function ThinkingOrb({ className = "" }) {
  return (
    <span className={className ? `thinking-orb ${className}` : "thinking-orb"} aria-hidden="true">
      <svg viewBox="0 0 48 48" focusable="false">
        <circle className="thinking-orb-globe" cx="24" cy="24" r="18" />
        <ellipse className="thinking-orb-meridian" cx="24" cy="24" rx="18" ry="18" />
        <ellipse className="thinking-orb-meridian trailing" cx="24" cy="24" rx="18" ry="18" />
        <circle className="thinking-orb-core" cx="24" cy="24" r="3.4" />
      </svg>
    </span>
  );
}
