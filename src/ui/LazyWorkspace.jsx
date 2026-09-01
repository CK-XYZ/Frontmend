import { Component, lazy, Suspense, useMemo, useState } from "react";
import { ThinkingOrb } from "./ThinkingOrb.jsx";
import { useDialogFocus } from "./use-dialog-focus.js";

const RETAINED_STATE_COPY =
  "Your current audit and mission state remain retained while this interface loads.";

class WorkspaceErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidUpdate(previousProps) {
    if (previousProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) return this.props.renderError(this.state.error);
    return this.props.children;
  }
}

function LoadingCopy({ label, titleId, descriptionId }) {
  return (
    <>
      <ThinkingOrb />
      <p className="kicker">Loading workspace</p>
      <h2 id={titleId}>Opening the {label}</h2>
      <p id={descriptionId}>{RETAINED_STATE_COPY}</p>
    </>
  );
}

function ErrorCopy({ label, onRetry, titleId, descriptionId }) {
  return (
    <>
      <p className="kicker">Workspace unavailable</p>
      <h2 id={titleId}>The {label} could not be loaded</h2>
      <p id={descriptionId}>The retained audit was not restarted or changed. Retry this interface when you are ready.</p>
      <button type="button" onClick={onRetry}>Try loading again</button>
    </>
  );
}

function PageLoading({ label }) {
  return (
    <section className="lazy-workspace-state" role="status" aria-live="polite" aria-busy="true">
      <LoadingCopy label={label} />
    </section>
  );
}

function PageError({ label, onRetry }) {
  return (
    <section className="lazy-workspace-state error" role="alert">
      <ErrorCopy label={label} onRetry={onRetry} />
    </section>
  );
}

function InlineLoading({ label }) {
  return (
    <div className="lazy-workspace-state inline" role="status" aria-live="polite" aria-busy="true">
      <LoadingCopy label={label} />
    </div>
  );
}

function InlineError({ label, onRetry }) {
  return (
    <div className="lazy-workspace-state inline error" role="alert">
      <ErrorCopy label={label} onRetry={onRetry} />
    </div>
  );
}

/*
 * The dialog loading state is the orb on its own.
 *
 * A lazy chunk arrives in a few hundred milliseconds, so the full card — kicker,
 * headline, paragraph, close button — was furniture that appeared and vanished
 * before anyone could read it, and it read as a heavier wait than the wait
 * actually is. What is left is the orb over a dimmed page, fading in late enough
 * that a fast load shows nothing at all. The copy still exists for assistive
 * technology, and Escape or a click outside still closes it.
 *
 * Failure keeps the whole card: an error has something to say, and the reader
 * has a decision to make.
 */
function DialogLoading({ label, onExit, restoreFocusRef }) {
  const dialogRef = useDialogFocus(onExit, restoreFocusRef);
  return (
    <div className="modal-backdrop lazy-workspace-orb-backdrop" role="presentation" onMouseDown={onExit}>
      <section
        ref={dialogRef}
        tabIndex="-1"
        className="lazy-workspace-orb"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lazy-workspace-state-title"
        aria-describedby="lazy-workspace-state-description"
        aria-live="polite"
        aria-busy="true"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <ThinkingOrb />
        <p className="sr-only" id="lazy-workspace-state-title">Opening the {label}</p>
        <p className="sr-only" id="lazy-workspace-state-description">{RETAINED_STATE_COPY}</p>
      </section>
    </div>
  );
}

function DialogError({ label, onRetry, onExit, restoreFocusRef }) {
  const dialogRef = useDialogFocus(onExit, restoreFocusRef);
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onExit}>
      <section
        ref={dialogRef}
        tabIndex="-1"
        className="lazy-workspace-state dialog error"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lazy-workspace-state-title"
        aria-describedby="lazy-workspace-state-description"
        aria-live="assertive"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <ErrorCopy
          label={label}
          onRetry={onRetry}
          titleId="lazy-workspace-state-title"
          descriptionId="lazy-workspace-state-description"
        />
        <button className="lazy-workspace-close" type="button" onClick={onExit}>Close</button>
      </section>
    </div>
  );
}

export function LazyWorkspace({
  load,
  label,
  resetKey,
  componentProps,
  variant = "page",
  onExit = () => {},
  restoreFocusRef = null,
}) {
  const [loadAttempt, setLoadAttempt] = useState(0);
  const LazyComponent = useMemo(() => lazy(load), [load, loadAttempt, resetKey]);
  const retry = () => setLoadAttempt((attempt) => attempt + 1);
  const boundaryKey = `${resetKey}:${loadAttempt}`;
  const resolvedComponentProps = restoreFocusRef
    ? { ...componentProps, restoreFocusRef }
    : componentProps;
  const loading = variant === "dialog"
    ? <DialogLoading label={label} onExit={onExit} restoreFocusRef={restoreFocusRef} />
    : variant === "inline"
      ? <InlineLoading label={label} />
      : <PageLoading label={label} />;
  const renderError = () => variant === "dialog"
    ? <DialogError label={label} onRetry={retry} onExit={onExit} restoreFocusRef={restoreFocusRef} />
    : variant === "inline"
      ? <InlineError label={label} onRetry={retry} />
      : <PageError label={label} onRetry={retry} />;

  return (
    <WorkspaceErrorBoundary key={boundaryKey} resetKey={boundaryKey} renderError={renderError}>
      <Suspense fallback={loading}>
        <LazyComponent {...resolvedComponentProps} />
      </Suspense>
    </WorkspaceErrorBoundary>
  );
}
