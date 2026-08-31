import { useEffect, useRef } from "react";

/*
 * One reference-counted body-scroll lock, shared by every dialog.
 *
 * Each dialog used to snapshot and restore document.body.style.overflow on its
 * own. That corrupts as soon as two of them overlap, and two of them always do:
 * LazyWorkspace wraps WebMcpCapabilitySheet and both call this hook. Child
 * effects run before parent effects, so the parent snapshotted the child's
 * "hidden" — and cleanup runs child-first, so the parent restored "hidden"
 * after the child had already cleared it. Body scroll then stayed locked for
 * the rest of the session, on every route.
 *
 * Only the outermost lock captures the previous value, and only the last
 * release restores it.
 */
let scrollLockCount = 0;
let scrollLockPrevious = "";

function lockBodyScroll() {
  if (scrollLockCount === 0) scrollLockPrevious = document.body.style.overflow;
  scrollLockCount += 1;
  document.body.style.overflow = "hidden";
}

function releaseBodyScroll() {
  scrollLockCount = Math.max(0, scrollLockCount - 1);
  if (scrollLockCount > 0) return;
  document.body.style.overflow = scrollLockPrevious;
  scrollLockPrevious = "";
}

export function useDialogFocus(onClose, restoreFocusRef = null) {
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog) return undefined;

    const focusableSelector =
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusables = () => [...dialog.querySelectorAll(focusableSelector)];
    lockBodyScroll();
    const focusFrame = window.requestAnimationFrame(() => (focusables()[0] ?? dialog).focus());
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (!items.length) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items.at(-1);
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      releaseBodyScroll();
      const focusToRestore = restoreFocusRef?.current ?? previousFocus;
      if (focusToRestore?.isConnected) window.requestAnimationFrame(() => focusToRestore.focus());
    };
  }, []);

  return dialogRef;
}
