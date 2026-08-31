import { useEffect, useRef } from "react";

/** Longest a section may stay concealed waiting for a scroll that never comes. */
const REVEAL_SAFETY_MS = 6000;

/**
 * Presentational scroll reveal for the marketing sections.
 *
 * Concealing content is only ever safe if every path back out of it is
 * covered, so this refuses to conceal anything unless it can see a real
 * viewport and the section is genuinely below the fold, and it still keeps a
 * timer as a last resort. A section is never left invisible because an
 * observer did not fire, the viewport reported no height, the page was opened
 * at an anchor, or the effect never ran at all.
 */
export function useRevealOnScroll() {
  const ref = useRef(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return undefined;
    if (typeof IntersectionObserver !== "function") return undefined;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return undefined;

    // No trustworthy viewport (hidden pane, zero-height host, some capture
    // modes) means no reliable intersection callback. Leave it revealed.
    const viewport = window.innerHeight || 0;
    if (viewport < 200) return undefined;

    // Already on screen, or scrolled past: nothing to reveal.
    if (root.getBoundingClientRect().top < viewport * 0.9) return undefined;

    root.dataset.reveal = "out";
    const reveal = () => {
      root.dataset.reveal = "in";
    };

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        reveal();
        observer.disconnect();
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.05 },
    );
    observer.observe(root);
    const safety = window.setTimeout(reveal, REVEAL_SAFETY_MS);

    return () => {
      observer.disconnect();
      window.clearTimeout(safety);
    };
  }, []);

  return ref;
}
