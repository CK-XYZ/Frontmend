import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const dialogFocus = readFileSync(new URL("../src/ui/use-dialog-focus.js", import.meta.url), "utf8");
const lazyWorkspace = readFileSync(new URL("../src/ui/LazyWorkspace.jsx", import.meta.url), "utf8");
const report = readFileSync(new URL("../src/workspaces/ReportWorkspace.jsx", import.meta.url), "utf8");
const inspector = readFileSync(new URL("../src/workspaces/WebMcpCapabilitySheet.jsx", import.meta.url), "utf8");
const missionSummary = readFileSync(new URL("../src/ui/AuditMissionSummary.jsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const landingStyles = readFileSync(new URL("../src/landing.css", import.meta.url), "utf8");

test("uses one main landmark, a keyboard skip target, and deliberate focus restoration", () => {
  assert.match(app, /<div className=\{`app-shell \$\{mode\}`\}>/);
  assert.match(app, /<a className="skip-link" href="#main-content">Skip to main content<\/a>/);
  assert.match(app, /<main id="main-content" className="main-content" ref=\{mainContentRef\} tabIndex="-1">/);
  assert.match(app, /mainContentRef\.current\?\.focus\(\)/);
  assert.match(app, /document\.title = mode === "landing"/);
  assert.doesNotMatch(app, /<main className=\{`app-shell/);
});

test("connects URL errors and audit progress to assistive technology", () => {
  assert.match(app, /aria-invalid=\{Boolean\(error\)\}/);
  assert.match(app, /aria-describedby="site-url-message"/);
  assert.match(app, /role=\{error \? "alert" : "status"\}/);
  assert.match(app, /aria-valuetext=\{`\$\{audit\.progress\}% complete — \$\{audit\.phaseLabel\}`\}/);
  assert.match(app, /aria-label="Live audit progress"/);
  assert.match(app, /aria-current=\{active \? "step" : undefined\}/);
  assert.match(app, /"Completed" : active \? "Current" : "Upcoming"/);
});

test("keeps modal focus, descriptions, scroll containment, and restoration bounded", () => {
  // Scroll containment is now the shared reference-counted lock below, not a
  // per-dialog snapshot: two overlapping dialogs corrupted the restore.
  assert.match(dialogFocus, /document\.body\.style\.overflow = "hidden"/);
  assert.match(dialogFocus, /document\.body\.style\.overflow = scrollLockPrevious/);
  assert.match(dialogFocus, /\(focusables\(\)\[0\] \?\? dialog\)\.focus\(\)/);
  assert.match(dialogFocus, /focusToRestore\?\.isConnected/);
  assert.match(dialogFocus, /restoreFocusRef\?\.current \?\? previousFocus/);
  assert.match(app, /const webMcpTriggerRef = useRef\(null\)/);
  assert.match(app, /buttonRef=\{webMcpTriggerRef\}/);
  assert.match(app, /restoreFocusRef=\{webMcpTriggerRef\}/);
  assert.match(lazyWorkspace, /useDialogFocus\(onExit, restoreFocusRef\)/);
  assert.match(inspector, /useDialogFocus\(onClose, restoreFocusRef\)/);
  assert.match(lazyWorkspace, /aria-describedby="lazy-workspace-state-description"/);
  assert.match(inspector, /id="webmcp-mission-inspector"/);
  assert.match(inspector, /aria-describedby="webmcp-sheet-description"/);
  assert.match(inspector, /Use Frontmend with an AI agent/);
  assert.match(inspector, /WebMCP lets a compatible AI agent use the actions on this page as tools/);
  assert.match(inspector, /Try asking your agent/);
  assert.match(inspector, /Technical details/);
  assert.match(inspector, /agent \$\{activeTools\.length === 1 \? "action" : "actions"\} available on this screen/);
  assert.doesNotMatch(inspector, /\{activeTools\.length\} of \{inspector\.registration\.totalToolCount\} contracts/);
  assert.doesNotMatch(inspector, />Mission inspector</);
  assert.doesNotMatch(inspector, /Tool contracts/);
});

test("describes the Agent log as durable audit metadata without a misleading local clear", () => {
  assert.match(app, /The last 20 completed actions are retained with this audit/);
  assert.match(app, /revision \$\{activity\.missionRevisionBefore\}→\$\{activity\.missionRevisionAfter\}/);
  assert.match(app, /agentActivities\.length \|\| !\["landing", "guide"\]\.includes\(mode\)/);
  assert.doesNotMatch(app, /stay in memory for this session/);
  assert.doesNotMatch(app, />\s*Clear log\s*</);
});

test("keeps the agent path legible on the compact landing header", () => {
  assert.match(app, /const compactLabel = [\s\S]*?"Agent ready"/);
  assert.match(app, /className="webmcp-status-compact" aria-hidden="true"/);
  assert.match(app, /Agents automate the evidence loop\. You choose what ships\./);
  assert.match(app, /Use Frontmend to audit my deployed site for accessibility and SEO/);
  assert.match(landingStyles, /\.app-shell\.landing \.webmcp-status-compact\s*\{[^}]*display: inline;/s);
  assert.match(landingStyles, /\.hero-agent-prompt\s*\{[^}]*grid-template-columns:/s);
});

test("uses concise visible progress without discarding the detailed status", () => {
  assert.match(app, /inspect: "Inspecting live evidence"/);
  assert.match(app, /<h1 id="progress-title">\{visiblePhaseLabel\}<\/h1>/);
  assert.match(app, /Your audit keeps running if you leave/);
  assert.match(app, /aria-valuetext=\{`\$\{audit\.progress\}% complete — \$\{audit\.phaseLabel\}`\}/);
});

test("describes diagnosis against retained evidence without inventing a measured provider issue", () => {
  assert.match(missionSummary, /open_diagnostic_mission: "Agent opens the retained issue for diagnosis"/);
  assert.doesNotMatch(missionSummary, /open_diagnostic_mission: "Agent opens the measured issue for diagnosis"/);
});

test("implements a complete keyboard-operated viewport tab pattern", () => {
  assert.match(report, /role="tablist"/);
  assert.match(report, /role="tab"/);
  assert.match(report, /aria-selected=\{item\.id === viewportId\}/);
  assert.match(report, /aria-controls=\{viewportPanelId\}/);
  assert.match(report, /tabIndex=\{item\.id === viewportId \? 0 : -1\}/);
  assert.match(report, /event\.key === "Home"/);
  assert.match(report, /event\.key === "End"/);
  assert.match(report, /event\.key === "ArrowRight" \|\| event\.key === "ArrowDown"/);
  assert.match(report, /event\.key === "ArrowLeft" \|\| event\.key === "ArrowUp"/);
  assert.match(report, /role="tabpanel"/);
  assert.match(report, /aria-labelledby=\{labelledBy\}/);
});

/*
 * The loop dialog advances itself and wraps, which is a continuous auto-update.
 * It carries no transport controls, so the mechanism WCAG 2.2.2 asks for is the
 * rail: touching it stops the advance for good. That, the reduced-motion
 * opt-out, and the still visitor's DOM are locked here rather than left to
 * review - each is invisible until it is missing.
 */
test("keeps the self-advancing walkthrough stoppable", () => {
  assert.match(app, /const HOW_IT_WORKS_DWELL = \d+;/);
  // Taking over the rail - by click, by arrow key, or by Tabbing into it.
  assert.match(app, /onFocus=\{\(\) => setPlaying\(false\)\}/);
  assert.match(app, /const moveTo = \(index, \{ focus = true \} = \{\}\) => \{\s*[\s\S]{0,120}?setPlaying\(false\);/);
  assert.match(app, /if \(query\.matches\) setPlaying\(false\);/);
  // An unwatched tab advances nothing.
  assert.match(app, /document\.addEventListener\("visibilitychange", sync\)/);
  assert.match(app, /if \(!playing \|\| tabHidden\) return undefined;/);
  // The exhibit's transients are never in the DOM for a still visitor.
  assert.match(
    app,
    /\{!still && \(stage === "01" \|\| stage === "03"\) \? <span className="loop-demo-scan" \/> : null\}/,
  );
  // No transport controls crept back in.
  assert.doesNotMatch(app, /loop-dialog-play/);
});

test("retains visible focus and 390 px touch and reflow safeguards", () => {
  assert.match(styles, /\.skip-link:focus\s*\{[^}]*transform: translateY\(0\)/s);
  assert.match(styles, /\.webmcp-status:focus-visible\s*\{[^}]*outline: 3px solid/s);
  assert.match(styles, /human-review-outcomes label:has\(input:focus-visible\)/);
  assert.match(styles, /human-diagnostic-mode label:has\(input:focus-visible\)/);
  assert.match(styles, /@media \(max-width: 620px\)\s*\{[\s\S]*min-block-size: 44px/s);
  assert.match(styles, /\.webmcp-status\s*\{[^}]*width: 44px;[^}]*height: 44px;/s);
  assert.match(styles, /human-browser-review textarea,[\s\S]*font-size: 16px;/s);
  assert.match(styles, /max-height: calc\(100dvh - 20px\)/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(landingStyles, /\.hero-loop-link\s*\{[^}]*min-height: 44px;/s);
  assert.match(landingStyles, /\.evidence-loop-link\s*\{[^}]*min-height: 44px;/s);
  assert.match(landingStyles, /\.landing-footer-column a\s*\{[^}]*min-height: 44px;/s);
  assert.match(landingStyles, /\.landing-footer-maker\s*\{[^}]*min-height: 44px;/s);
  assert.match(app, /aria-label="Knightware — opens in a new tab"/);
  // The composer must be deliberately refilled for the landing, not left as a
  // translucent workspace panel floating on cobalt. Handle and tray now share
  // one opaque paper sheet; the value changed, the requirement did not.
  assert.match(landingStyles, /\.app-shell\.landing \.audit-composer\s*\{[^}]*background: var\(--fm-paper\);/s);
  assert.match(landingStyles, /\.app-shell\.landing \.audit-composer > summary\s*\{[^}]*background: var\(--fm-paper\);/s);
  assert.match(landingStyles, /\.app-shell\.landing \.audit-composer-body\s*\{[^}]*background: var\(--fm-paper\);/s);
  assert.doesNotMatch(landingStyles, /\.app-shell\.landing \.audit-composer > summary\s*\{[^}]*border-left:/s);
  assert.match(landingStyles, /\.app-shell\.landing \.audit-focus-options label\s*\{[^}]*min-height: 54px;/s);
});

/*
 * Overlapping dialogs must not corrupt the body-scroll lock.
 *
 * Each dialog used to snapshot and restore document.body.style.overflow on its
 * own. LazyWorkspace wraps WebMcpCapabilitySheet and both call useDialogFocus,
 * so the parent snapshotted the child's "hidden" and restored it after the
 * child had cleared it — leaving every route unscrollable for the rest of the
 * session. The lock is reference counted now; keep it that way.
 */
test("shares one reference-counted body scroll lock across overlapping dialogs", () => {
  assert.match(dialogFocus, /let scrollLockCount = 0;/);
  assert.match(dialogFocus, /if \(scrollLockCount === 0\) scrollLockPrevious = document\.body\.style\.overflow;/);
  assert.match(dialogFocus, /if \(scrollLockCount > 0\) return;/);
  assert.match(dialogFocus, /lockBodyScroll\(\);/);
  assert.match(dialogFocus, /releaseBodyScroll\(\);/);
  // No dialog may snapshot or clear the shared lock on its own again.
  assert.doesNotMatch(dialogFocus, /const previousBodyOverflow/);
  for (const source of [app, lazyWorkspace, inspector]) {
    assert.doesNotMatch(source, /body\.style\.overflow/);
  }
});
