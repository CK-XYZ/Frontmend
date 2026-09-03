import { useEffect, useRef, useState } from "react";

/*
 * Watching a run that reports in steps.
 *
 * The server moves the number only when something real happens, and the two
 * evidence sources it waits on settle tens of seconds apart. Between the live
 * document landing and Lighthouse returning there is one long stretch with no
 * new checkpoint to report, and a bar pinned to the last one sat still through
 * most of the audit. It looked broken. It was accurate.
 *
 * So the surface eases *between* checkpoints instead of jumping at them. The
 * easing is asymptotic: it approaches the next real checkpoint and never
 * arrives, so the bar always has somewhere to go and never claims a step the
 * run has not taken. Two properties make that honest rather than decorative:
 *
 *   - it never passes the next checkpoint, so no reported stage is ever
 *     overstated, and
 *   - it never moves backwards, so a later checkpoint absorbs the estimate
 *     rather than contradicting it.
 *
 * The percentage was never the trustworthy part of this screen anyway. Elapsed
 * time and the per-source stream states are, and both come back from the
 * server; this hook only keeps the bar from lying by standing still.
 */
const CHECKPOINTS = Object.freeze([0, 6, 12, 16, 34, 74, 86, 92, 100]);
const TICK_MS = 240;
const TERMINAL = Object.freeze(["complete", "failed", "cancelled"]);

/* Approach ~85% of a gap over the stretch that gap usually covers. */
function timeConstantMs(gap) {
  return 1_500 + gap * 350;
}

function nextCheckpoint(value) {
  return CHECKPOINTS.find((checkpoint) => checkpoint > value + 0.001) ?? 99;
}

function reportedProgress(audit) {
  const value = Number(audit?.progress);
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
}

export function useAuditProgress(audit) {
  const auditKey = `${audit?.id ?? ""}:${audit?.attempt ?? 1}`;
  const status = audit?.status ?? "queued";
  const reported = reportedProgress(audit);
  const settled = TERMINAL.includes(status);
  const startedAt = Number.isInteger(audit?.startedAt) ? audit.startedAt : null;
  const serverNow = Number.isInteger(audit?.now) ? audit.now : null;

  const anchorRef = useRef({ key: auditKey, value: reported, at: Date.now() });
  /*
   * The two clocks are not the same clock. Reading elapsed time off the
   * server's own `now` removes the skew instead of assuming it away.
   */
  const skewRef = useRef(0);
  const [state, setState] = useState(() => ({ progress: reported, elapsedMs: 0 }));

  if (anchorRef.current.key !== auditKey) {
    anchorRef.current = { key: auditKey, value: reported, at: Date.now() };
  }
  if (startedAt !== null && serverNow !== null) {
    skewRef.current = serverNow - Date.now();
  }

  useEffect(() => {
    const anchor = anchorRef.current;
    if (reported > anchor.value) {
      anchorRef.current = { key: auditKey, value: reported, at: Date.now() };
    }
  }, [auditKey, reported]);

  useEffect(() => {
    const elapsedFrom = (now) =>
      startedAt === null ? 0 : Math.max(0, now + skewRef.current - startedAt);

    if (settled) {
      setState({
        progress: status === "complete" ? 100 : Math.max(reported, 0),
        elapsedMs: elapsedFrom(Date.now()),
      });
      return undefined;
    }

    const tick = () => {
      const now = Date.now();
      const { value, at } = anchorRef.current;
      const ceiling = nextCheckpoint(value);
      const gap = Math.max(0, ceiling - value);
      const eased = gap === 0
        ? value
        : value + gap * (1 - Math.exp(-(now - at) / timeConstantMs(gap)));
      setState((current) => ({
        progress: Math.max(current.progress, Math.min(eased, ceiling - 0.4)),
        elapsedMs: elapsedFrom(now),
      }));
    };

    tick();
    const timer = window.setInterval(tick, TICK_MS);
    return () => window.clearInterval(timer);
  }, [auditKey, settled, status, reported, startedAt]);

  return {
    progress: Math.round(state.progress),
    elapsedMs: state.elapsedMs,
    hasElapsed: startedAt !== null,
  };
}

export function formatElapsed(elapsedMs) {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1_000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}m ${String(totalSeconds % 60).padStart(2, "0")}s`;
}

export function formatDuration(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs < 0) return null;
  if (durationMs < 1_000) return `${Math.max(1, Math.round(durationMs))}ms`;
  if (durationMs < 10_000) return `${(durationMs / 1_000).toFixed(1)}s`;
  return formatElapsed(durationMs);
}
