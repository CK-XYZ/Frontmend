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
  assert.match(dialogFocus, /document\.body\.style\.overflow = "hidden"/);
  assert.match(dialogFocus, /document\.body\.style\.overflow = previousBodyOverflow/);
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
  assert.match(landingStyles, /\.app-shell\.landing \.audit-composer\s*\{[^}]*background: #0b0e12;/s);
  assert.match(landingStyles, /\.app-shell\.landing \.audit-composer-body\s*\{[^}]*background: var\(--fm-paper\);/s);
  assert.match(landingStyles, /\.app-shell\.landing \.audit-focus-options label\s*\{[^}]*min-height: 54px;/s);
});
