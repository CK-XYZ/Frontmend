# Frontmend Design QA

Source target: the existing OpenUp landing implementation and its documented warm-white, centered, floating-search visual direction.

Implemented states:

- URL-first landing
- Audit progress
- Responsive findings workspace
- How-it-works modal
- Mobile layout rules and reduced-motion handling
- Agent-staged repair review and human approval
- Human feedback, agent revision, and bounded proposal-history states
- Approved export and repair verification result banners
- WebMCP activity drawer with empty, running, succeeded, failed, and clear-session states
- Human-approved external-deployment gate with blocked and site-owner-attested states
- CSP resource-origin evidence card and site-aware Report-Only repair preview
- Completed-audit Markdown export in the primary report navigation
- Live-document profile with bounded markup metrics and response-header signals
- Running-audit cancellation in human and contextual WebMCP surfaces
- Bounded same-site route exploration with human and WebMCP start actions
- Visible route-journey provenance with root/hop/current nodes and parent-audit navigation
- Dark cross-page exploration bench with bounded route selection, live aggregate progress, child-page links, recurring-issue evidence, and export

Static review confirms that the implementation retains the source typography stack, surface palette, capsule proportions, spacing scale, focus treatment, modal language, and responsive breakpoints while replacing the appliance scene with audit-specific interface elements.

The user-provided runtime was inspected in the in-app browser on 27 and 28 August 2026, first on port 5173 and again after the user moved it to port 3434. Verified rendered states include landing, live audit progress and cancellation controls, live document evidence, bounded route exploration, cross-page missions, CSP resource evidence, repair staging, disabled approval before explicit review confirmation, human change requests, agent revisions, human approval, deployment gating, export controls, and repeated verification results. The before/after receipt links audit IDs, exact-rule outcomes, and metric deltas; separate audit and proposal trails preserve their bounded histories. WebMCP now reports the active contextual subset from its twelve-tool library: the landing renders one active start capability, a running page exposes progress plus cancellation, and route-capable completed audits expose applicable result, exploration, and repair capabilities. The same running state renders the human **Cancel audit** action. API audit `7c70fe45` separately proved persisted cancellation and same-ID attempt-2 recovery. The status button opened a polished modal matching discovered tools and explicitly preserved human-only authority. Audit `ad95d84f` rendered eight route actions with 33 omitted, WebMCP started observed route `/tools/remove-pdf-metadata` as audit `7bf9d065`, and the human action started observed route `/tools` as audit `3f3972ab`; both surfaces used the shared service and the browser stayed console-clean. The later real route journey `d7239dd1` → `2856f957` → `31b3edab` → `8265782c` rendered a restrained purple provenance strip with root, two hops, current `/terms`, and a working parent link; the last hop came from genuine WebMCP and matched the exported lineage. Root `2ed1ffcd` then rendered the dark cross-page bench and completed exploration `8bd9c892` across two real child audits; the recurring missing-CSP card, reload, WebMCP aggregate, export, and 390px layout matched. Audit `f61621be`, repair `decdfde4` rendered revision 1, a specific human-feedback state, agent revision 2, reopened approval controls, and a two-card revision trail containing the prior feedback and corrected current header. No server was started or restarted by Codex.

Playwright rendered the landing page and Human mode capability panel at 390×844 with no horizontal overflow and zero console errors. With `prefers-reduced-motion: reduce` emulated, the maximum computed animation and transition durations were both 0.01ms and no element exceeded 1ms. Captures are preserved at `output/playwright/frontmend-mobile-reduced-motion.png` and `output/playwright/frontmend-mobile-human-mode-panel.png`. The added SVG favicon also removed the only previous fresh-load 404.

The clipboard-restricted share state was rendered at desktop and 390×844. The fallback exposes the exact stable workspace URL in a focused, fully selected input; its mobile card sits below the heading with no score-card overlap or horizontal overflow. The full hostname and score remain visible. The result capture is `output/playwright/frontmend-mobile-share-fallback.png`.

Keyboard replays at 390×844 covered all three dialog surfaces. WebMCP capability, Agent log, and How it works each focused the first close control, contained Tab focus, closed through Escape, restored the invoking button, and left the console clean.

The completed report navigation was replayed at 390×844 after adding **Export report**. New audit and Share audit remain on the first row, Export report wraps deliberately to the second, the full hostname and score stay clear, document width remains exactly 390px, and the console has zero errors. The verified capture is `output/playwright/frontmend-mobile-report-export.png`; real audit `d09c07c9` also returned its Markdown artifact with the expected safe download headers.

The in-app browser then rendered the live Document profile for real audit `3e46d0a9`. The six-metric card, security-header chips, evidence caveat, issue marker, and finding queue remained visually distinct inside the existing evidence canvas. DOM inspection confirmed the metrics use semantic terms and definitions inside a named region. This audit did not reuse older narrow-viewport captures as evidence; a fresh mobile screenshot remains a separate visual check.

final result: desktop pass; 390px pass; reduced-motion pass

## 31 August 2026 — landing assessment composer refinement

- Source visual truth: user-supplied 834 × 858 landing composer reference, inspected during the design session and not retained in the public repository.
- Implementation screenshot: fresh 834 × 858 ChromeSight capture from the local design session, not retained in the public repository.
- Viewport and density: source and implementation are both 834 × 858 pixels; implementation capture is 834 × 858 CSS pixels at device scale factor 1.
- State: landing hero, optional assessment composer open, default full-audit focus, no hover or keyboard focus treatment active.

### Full-view comparison

The source showed the open composer as one large cobalt block, visually merging its controls into the hero background. The revised implementation intentionally preserves the hero composition, URL action, typography, spacing, content, and disclosure height while changing only the composer hierarchy: charcoal summary handle, warm paper body, dark selection controls, and an orange provenance rule. No horizontal overflow or clipped control was visible at 834px or 390px.

### Focused-region comparison

The composer was separately captured at desktop width in its open, selected, and closed states. The selected focus-area treatment remains legible without depending on colour alone: checkbox state, lime-tinted fill, darker border, and inset confirmation rule. The closed state remains one compact 54px disclosure row. At 390px, cards stack to one column with their 54px targets intact; the tray continues vertically without widening the page.

### Required fidelity surfaces

- Fonts and typography: existing Geist/display stacks, weights, wrapping, and content are unchanged; charcoal and paper surfaces improve small-copy legibility.
- Spacing and layout rhythm: existing 660px composer width and hero alignment are retained; paper-body padding and 54px option targets create a calmer internal rhythm.
- Colours and tokens: removed the duplicate cobalt surface; reused the existing paper, ink, lime, orange, and bone tokens with accessible foreground separation.
- Image quality and assets: no image or brand asset was added, replaced, resized, or recompressed.
- Copy and content: all labels, options, scope descriptions, and authority language are unchanged.

### Comparison history

1. Initial source — P1: the open composer read as a generic blue dashboard slab and competed with the hero.
2. Revision — replaced the cobalt slab with a charcoal instrument header and warm evidence sheet; strengthened selected, hover, focus, open, and closed states.
3. Post-fix evidence — same-size desktop comparison, focused component captures, and 390 × 844 browser capture found no remaining P0, P1, or P2 issue. Opening and closing the composer under a bounded DevTools session produced no console error, HTTP error, or failed load. Production build, full test suite, and `git diff --check` passed.

### Follow-up polish

No blocking issue remains. A future P3 pass could tune the paper warmth after viewing it on the final deployed background compression, but no further change is warranted from the current local evidence.

final result: passed

## 2 September 2026 — audit report case-file redesign

- Source visual truth: selected option 3, `C:\Users\calvi\.codex\generated_images\01a06221-7a60-7a60-a015-8a2a758868f4\exec-9dd55332-00e9-4908-a4e5-4a3c14ae16a8.png`.
- Implementation route: `http://127.0.0.1:5173/audits/a45e05be-51e7-4993-a239-52a9ef13fdef`.
- Implementation screenshot: fresh ChromeSight full-page capture at 1440 CSS pixels, 1440 × 2572 image pixels, device scale factor 1, captured 2 September 2026 at 13:27:30 local session time. ChromeSight did not expose a local artifact path.
- State: completed public-page assessment with one retained CSP response-header finding; More, page evidence, and continuation disclosures collapsed.

### Full-view comparison

The reference and browser implementation were placed together in the same final comparison input. The implementation matches the selected case-file structure: one cobalt/mineral masthead, hostname and assessment state, a persistent case index, an ordered Mission → Evidence → Summary → Finding → Next step argument, a single orange finding rule, and one restrained human-intent action. The implementation uses Frontmend's exact landing bitgrain asset, so its mineral field is more saturated than the generated concept. Its longer full-page height retains the real evidence-source failure, bounded CSP resource inventory, and explicit authority copy instead of substituting mock data.

The first implementation comparison exposed excess report height and duplicated summary UI. Completed-assessment mission and metric cards were removed, section rhythm was tightened, the one-finding selector was collapsed, and the summary now names the actual response-header gap. The final comparison found no remaining P0, P1, or P2 visual issue.

### Focused and interaction review

- Case-index links update the URL fragment and land with a 112px sticky-header offset.
- More opens a bounded export and handoff menu, then closes without changing route state.
- Inspect page evidence opens the retained document/viewport controls and closes cleanly.
- Continue this audit opens the secondary browser handoff, policy, route, and exploration workflows and closes cleanly.
- The primary Prepare a fix action was not invoked because it records audit intent; its visible enabled state and authority copy were inspected without mutating the assessment.

### Responsive and runtime review

ChromeSight captured fresh mobile (390 × 844), tablet (768 × 1024), desktop (1440 × 1000), and wide (1920 × 1080) viewports. The case index becomes a compact grid below 860px, the hostname stays on one line at 390px, actions form a two-by-two mobile tray, and all report content remains inside the document width. A reduced-motion responsive pass also completed with stable readiness.

The bounded Chrome DevTools evidence session covered clean restoration, repeated responsive captures, disclosure interaction, and the final comparison: 531 responses, zero HTTP errors, zero failed loads, zero console/runtime errors, and zero dropped events. Full tests passed (365/365), contract tests passed (160/160), lint and TypeScript checks passed, production build passed, `git diff --check` passed, and the Wrangler deployment dry run passed. No server was started, and nothing was deployed.

final result: passed

## 4 September 2026 — landing evidence-card scale refinement

- Source visual truth: `C:\Users\calvi\AppData\Local\Temp\codex-clipboard-92b9733a-f6f6-4db2-b760-704f2bb1ece4.png`, 2113 × 1252 pixels, supplied by the product owner as the current landing reference.
- Pre-change implementation: `https://frontmend.dev/`, captured through ChromeSight at 2184 × 1214 CSS pixels and device scale factor 1; capture SHA-256 `ee973249c9d6ec6c5c3985bfbf333aee258012fe35755d747322cc71b34a0925`.
- Revised implementation screenshot: unavailable. The project contract forbids Codex from starting a local development or preview server, and the CSS change has not been deployed.
- State: landing hero at the top of the page, default composer state, no hover or keyboard focus treatment active.

### Full-view comparison

The pre-change live capture confirms the imbalance named in review: the hero copy occupies about 719px while the whole evidence stack occupies about 513px, and the first specimen face is only about 329px wide. The selected reference calls for a stronger right-side evidence run. The source revision changes only the desktop hero track ratio and the label-to-specimen ratio, targeting roughly 400px specimen faces while preserving the URL form, copy hierarchy, continuous thread, and existing tablet/mobile single-column behavior.

### Focused-region comparison

ChromeSight inspected `.hero-inner`, `.hero-copy`, `.specimen-stack`, `.specimen-visual`, and `.specimen-visual > *` on the current deployed page before the edit. A post-edit focused capture cannot be produced until the revised source is served. The absence of that capture blocks visual comparison of card scale, label wrapping, right-edge clearance, and the five-card stack height.

### Required fidelity surfaces

- Fonts and typography: no font, type size, weight, line-height, or copy changed; post-edit wrapping still needs rendered confirmation.
- Spacing and layout rhythm: desktop column and specimen ratios changed; this is the intended refinement and the only visual surface requiring recheck.
- Colours and visual tokens: unchanged.
- Image quality and asset fidelity: existing Frontmend logo and mineral-terrain assets are unchanged.
- Copy and content: unchanged.

### Comparison history

1. Pre-change live evidence — P2: the five specimen faces read as thumbnails beside a much heavier copy/form column.
2. Source fix — changed the wide hero split from `1.4fr / 1fr` to `1.25fr / 1.1fr`, the specimen split from `0.56fr / 1fr` to `0.44fr / 1fr`, and made the same proportional correction at the 1180px breakpoint.
3. Static verification — production build passed; landing accessibility/public-discovery tests passed 15/15; Wrangler dry run and `git diff --check` passed. The complete suite remains at 422/425 because three unrelated in-progress v8/activity-ledger assertions already fail.
4. Post-fix visual evidence — blocked until the user starts the local server or separately authorises deployment of the revised CSS.

### Implementation checklist

- Capture the revised hero at the same 2184 × 1214 viewport in ChromeSight.
- Confirm all five cards remain inside the safe right edge and no label gains an awkward wrap.
- Compare the focused specimen stack to the supplied reference before resuming the Remotion opener.

final result: blocked
