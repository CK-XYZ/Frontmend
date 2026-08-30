# Build Checklist

## Build Preferences

- **Plan ownership:** Handed off to Codex, grounded in the participant's established product direction and repository evidence.
- **Build mode:** Autonomous. This choice locks when item 1 begins.
- **Comprehension checks:** N/A; the participant requested senior execution rather than tutorial checkpoints.
- **Git:** Commit every completed checklist item as an independently understandable revert point using the existing CK-XYZ identity. Stage only the item scope.
- **Verification:** Yes. Run the named targeted tests for each item, then the full allowed release commands after implementation. Never weaken a test to make a slice pass.
- **Human look-at-it pauses:** None during command-safe implementation. Pause only when verification requires explicit permission to start a server, deploy, alter Cloudflare Access, publish a remote, or perform a fresh external browser session.
- **Check-in cadence:** Speed-run with concise progress updates after each committed slice.
- **Failure policy:** Stop on a real regression, explain the evidence, and adapt this checklist before continuing.

## Wow Moment

A judge writes one ordinary accessibility/SEO audit prompt. Frontmend's contextual WebMCP tools create a visible read-only mission, preserve the requested focus, and refuse to call the job complete while a supported browser/repository diagnosis remains. The contributed diagnosis appears in the same human workspace. Repair tooling only appears after an explicit repair-preparation transition, proving that the person and agent share one durable protocol without giving the agent silent deployment authority.

## Checklist

- [x] **1. Build the pure audit-mission contract**
  Spec ref: `spec.md > Audit Mission Contract`; `spec.md > Derived Mission State`
  What to build: Add `src/audit-mission-contract.js` with strict intent/focus/max validation, bounded snapshots and signatures, focused cross-viewport priority projection, diagnostic evidence states, derived assessment completion, and idempotent/conflicting repair-intent transitions. Add exhaustive native contract tests.
  Acceptance: Assess is the default; raw prompts are never retained; priorities are bounded/deduplicated; a supported undiagnosed symptom keeps assessment incomplete with an exact next action; contributed diagnosis completes its read-only obligation; repair intent freezes one finding and cannot be silently replaced.
  Verify: `bun test tests/audit-mission-contract.test.mjs`

- [x] **2. Persist structured mission goals through audit start and retry**
  Spec ref: `spec.md > HTTP Contract > Start audit`; `spec.md > Data Flow > Natural assessment lifecycle`
  What to build: Extend HTTP transport, application service, Worker admission/start, Durable Object state, audit snapshots, and local runtime to carry the mission. Include its signature in same-URL admission identity and preserve it across retry without changing provider input.
  Acceptance: Same URL plus same mission retains existing deduplication; a materially different goal does not overwrite the first mission; progress/reload/completed snapshots retain the exact bounded goal; human URL-only starts remain broad Assess missions; PageSpeed receives no mission metadata.
  Verify: `bun test tests/audit-service.test.mjs tests/sites-worker.test.mjs tests/audit-mission-contract.test.mjs`

- [x] **3. Add the explicit repair-preparation transition**
  Spec ref: `spec.md > HTTP Contract > Prepare repair intent`; `spec.md > Application Service`
  What to build: Implement the production and local `POST /api/audits/:auditId/mission/prepare-repair` route plus shared transport/service method. Validate completed state and exact retained finding; return the updated mission projection without creating or approving a repair.
  Acceptance: Same-finding repetition is idempotent; different-finding replacement fails closed; incomplete/unknown audits and findings return actionable errors; no delegated allowance is consumed; repair policy, source, implementation, deployment, and verification state remain unchanged.
  Verify: `bun test tests/audit-service.test.mjs tests/sites-worker.test.mjs tests/repair-contract.test.mjs`

- [x] **4. Make WebMCP start and results mission-aware**
  Spec ref: `spec.md > WebMCP Tools > start_site_audit changes`; `spec.md > WebMCP Tools > get_site_audit_results changes`
  What to build: Add optional intent/focus/max fields to `start_site_audit`, persist them through the service, and make `get_site_audit_results` use persisted focus by default. Return typed mission state, per-priority evidence state, assessment completion, exact next actor/tool/input, and a clearly labelled read-only projection override.
  Acceptance: The natural accessibility/SEO call needs no repeated focus on the result call; audit-job completion is distinct from assessment completion; zero matches finish honestly; diagnostic priorities point to exact existing tools; no result claims manual completeness or repair permission.
  Verify: `bun test tests/webmcp.test.mjs tests/audit-mission-contract.test.mjs tests/audit-service.test.mjs`

- [x] **5. Gate repair tools behind the semantic transition**
  Spec ref: `spec.md > WebMCP Tools > New prepare_site_repair tool`; `spec.md > WebMCP Tools > Contextual registration changes`
  What to build: Add `prepare_site_repair` as the seventeenth narrow WebMCP tool and update contextual registration so Assess exposes evidence/diagnosis plus the intent transition, while `stage_site_repair` appears only after Prepare fix and existing diagnostic readiness. Preserve all later repair/verification registrations.
  Acceptance: The transition tool accepts only audit/finding IDs; it cannot accept plan/code/policy/deployment data; `stage_site_repair` is absent before and present after a valid transition; verification audits retain receipt access; unsupported WebMCP still leaves the human UI complete.
  Verify: `bun test tests/webmcp.test.mjs tests/diagnostic-contract.test.mjs tests/repair-contract.test.mjs`

- [x] **6. Add a judge-legible mission summary to progress and results**
  Spec ref: `spec.md > Human UI > Mission summary`; `prd.md > Epic 8: Make the WebMCP differentiation immediately legible`
  What to build: Render one semantic mission summary showing Assessment/Preparing a fix, focus, audit-versus-assessment status, next actor/action, and authority boundary. Reuse the pure derived contract; do not create browser-only state or replace the existing repair rail.
  Acceptance: Agent-started focus is visible during progress and after reload; broad human audits say Full frontend audit; the completed page shows when measurement is done but diagnosis remains; copy states that the agent investigates the repository while the person controls deployment; layout remains accessible and responsive.
  Verify: `bun test tests/audit-service.test.mjs tests/webmcp.test.mjs tests/sites-worker.test.mjs` plus `bun run build`

- [x] **7. Add focused mission priorities and the human repair-intent action**
  Spec ref: `spec.md > Human UI > Focused priority presentation`; `spec.md > Human UI > Prepare repair transition`
  What to build: Add a compact ranked mission-priority view linked to the existing evidence queue, show each diagnostic state, and add the human `Prepare a fix` action using the shared service transition. Update styles and capability copy without duplicating finding details or changing repair policy.
  Acceptance: Selecting a mission priority selects its existing finding; cross-viewport occurrences remain visible; the action explains it records intent but is not approval/deployment; successful transition updates mission state and re-registers contextual tools; 390 px semantics and interaction remain safe by static/build evidence pending authorised browser proof.
  Verify: `bun test tests/webmcp.test.mjs tests/audit-service.test.mjs tests/sites-worker.test.mjs tests/repair-contract.test.mjs` plus `bun run build`

- [x] **8. Harden the full contract and regression suite**
  Spec ref: `spec.md > Tests And Verification`; `spec.md > Security And Privacy`
  What to build: Fill cross-layer coverage for unknown fields, privacy boundaries, admission signatures, retry, reload, stale/conflicting intent, diagnostic completion, contextual tool changes, delegated-auto non-consumption, person-only deployment, and raw prompt/source/absolute-path exclusion. Update expected tool inventories and package test counts truthfully.
  Acceptance: All new PRD acceptance boundaries have direct deterministic coverage; existing cancellation, exploration, repair revision, implementation history, deployment gate, verification comparability, and human fallback contracts remain green.
  Verify: `bun run test`

- [x] **9. Align product, demo, and fresh-session evidence instructions**
  Spec ref: `spec.md > Fresh-Session Evaluation`; `spec.md > Demo And Submission Flow`
  What to build: Update README, demo script, release candidate ledger, and submission-readiness notes with Assess versus Prepare fix, the natural prompt, exact ChatGPT/Chrome steps, the mission-continuity failure condition, temporary Cloudflare Access release gate, and only evidence actually proven at this point.
  Acceptance: Documentation leads with the product value beyond Lighthouse; no build is called deployment; browser proof remains unchecked until run; public-repo/video/access tasks remain explicit; demo spends most time on diagnosis and shared authority rather than audit polling.
  Verify: `rg -n "Assess|Prepare fix|assessmentComplete|ChatGPT|Chrome|Cloudflare Access|Lighthouse" README.md DEMO_SCRIPT.md RELEASE_CANDIDATE.md SUBMISSION_READINESS.md` and `git diff --check`

- [x] **10. Run the command-safe release gate**
  Spec ref: `spec.md > Tests And Verification > Allowed release commands`
  What to build: Run the complete test suite, production build, and Wrangler strict dry run. Record fresh counts, asset/bundle output, exact commit, and the evidence boundary in release documentation. Fix genuine failures without weakening contracts.
  Acceptance: All commands succeed from the current worktree; release ledger distinguishes local tests/build/dry-run from deployment and browser proof; worktree contains only intentional tracked changes before commit.
  Verify: `bun run test`; `bun run build`; `bunx wrangler deploy --dry-run --strict`; `git diff --check`; `git status --short`

- [x] **11. Prepare Devpost handoff**
  Spec ref: `prd.md > Submission Proof Points`; `spec.md > Demo And Submission Flow > Judge self-test`
  What to build: Gather the final product story, exact judge prompt, live URL, public repository link, licence visibility, challenge-period history, fresh ChatGPT/Chrome receipts, screenshots, under-three-minute public YouTube demo, AI/Codex usage, testing instructions, and temporary-access resolution. Draft the Devpost fields only from verified evidence.
  Acceptance: The participant has enough truthful material to run `$prepare-submission`; external gaps remain blockers rather than invented placeholders; no Devpost submission, deployment, server start, Access removal, repository publication, or video upload occurs without its required user action/authorisation.
  Verify: Review the handoff materials against the live Devpost requirements and confirm the next command is `$prepare-submission` only after the actual build and required external proof are ready.

## Sequencing Rationale

- Item 1 removes the riskiest ambiguity before touching transport or UI.
- Items 2–3 establish one production/local source of truth before exposing new tools.
- Items 4–5 make the natural agent flow correct before visual polish.
- Items 6–7 make the same state legible to people and judges.
- Item 8 proves existing authority boundaries survived.
- Items 9–11 turn the working product into reproducible release and submission evidence without conflating external actions with local completion.

## Post-checklist product-strengthening slice

- [x] **12. Add ordered agent browser review beyond provider evidence**
  What was built: A pure browser-review contract, durable Worker/local persistence, two contextual WebMCP tools, focus-aware sequential checks, honest blockers, browser-finding promotion, combined assessment receipts, repository/diagnosis compatibility, and a visible provenance-labelled review card.
  Acceptance: The natural accessibility/SEO prompt cannot finish from provider output alone; the agent receives one exact safe browser task at a time; direct observations and browser issues remain separately attributed; zero-provider-finding runs still receive rendered review; blockers remain resumable; no review contribution grants repair or deployment authority.
  Verify: `bun test tests/browser-review-contract.test.mjs tests/audit-mission-contract.test.mjs tests/assessment-receipt.test.mjs tests/audit-service.test.mjs tests/webmcp.test.mjs tests/sites-worker.test.mjs`; `bun run build`; full release gate before deployment.

- [x] **13. Add exact post-deployment replay for browser findings**
  What was built: Bounded browser evidence retention through repair, one contextual `fresh-browser-replay` after deployment attestation, Durable Object/local parity, claim and receipt gating, pass/issue/blocker comparison semantics, visible baseline/replay state, and portable provenance.
  Acceptance: Fresh provider measurement cannot resolve a browser finding; the exact original observation and viewport drive one agent browser task; pass resolves, issue remains, blocker is resumable; the receipt stays unavailable until a non-blocked comparison completes; no new tool or hidden browser authority is introduced.
  Verify: `bun test tests/browser-review-contract.test.mjs tests/repair-contract.test.mjs tests/audit-service.test.mjs tests/webmcp.test.mjs tests/sites-worker.test.mjs`; `bun run build`; strict no-upload Wrangler release gate.

- [x] **14. Add a reviewed repair-impact and aggregate verification matrix**
  What was built: A pure impact contract persisted inside repair records, exact-rule route derivation, server-issued optional candidate IDs, approval-time matrix stamping, one existing audit job per reviewed route, provider and exact-browser rows, aggregate outcomes and receipts, Worker/local parity, and deterministic legacy projections.
  Acceptance: Only completed retained audits where the exact rule was evaluated can enter scope; root and failed exploration occurrences are automatic; at most three optional candidates are accepted by ID; deployment stays person-owned; an unreviewed matrix cannot start; every row must resolve for the aggregate to resolve; failures remain present and incomplete or incomparable proof remains inconclusive.
  Verify: `bun test tests/verification-impact-contract.test.mjs tests/repair-contract.test.mjs tests/site-exploration-contract.test.mjs tests/route-contract.test.mjs tests/audit-service.test.mjs tests/webmcp.test.mjs tests/sites-worker.test.mjs`; `bun run build`; full release gate before deployment.

- [x] **15. Add a focused human assessment composer**
  What was built: A progressive landing-page composer for zero to three focus areas and a one-to-five mission shortlist, wired through the existing audit mission service. Empty selection preserves the full frontend audit; focus and shortlist survive stable restoration, cancellation, and retry.
  Acceptance: Human and WebMCP starts share the same bounded mission contract; no raw prompt is retained; full evidence remains available behind a focused mission summary; the control is keyboard-native, responsive, and adds no tool, dependency, or parallel state.
  Verify: `bun test tests/audit-service.test.mjs tests/audit-mission-contract.test.mjs`; `bun run build`; fresh visual proof remains a later authorised gate.

- [x] **16. Make optional verification impact reviewable in Human mode**
  What was built: The human repair-staging path now loads exact server-issued audited-route candidates, lets the person select bounded optional targets before drafting, and shows included versus omitted candidate routes in the impact review. Required root and failed routes remain automatic.
  Acceptance: Raw paths and URLs are never accepted; optional selection is limited to the existing three eligible IDs; the matrix is still frozen only at approval; deployment and verification authority remain unchanged; an unavailable candidate read does not remove required retained proof.
  Verify: `bun test tests/audit-service.test.mjs tests/verification-impact-contract.test.mjs`; `bun run build`; full command-safe regression gate before the next application commit.

- [x] **17. Add seamless human-to-agent takeover on the retained audit**
  What was built: Eligible completed person-started Assess missions now expose the existing `open_browser_review` transition in both the visible workspace and contextual WebMCP. Opening it retains the audit ID, mission attribution, provider evidence, and attempt; records bounded adoption provenance; increments the mission revision; and points the fresh checkpoint at the first compiled browser task.
  Acceptance: No duplicate audit or tool is created; focused human missions cannot expand beyond their retained accessibility/SEO scope; broad audits default to bounded accessibility and SEO review; repair-preparation and performance-only missions remain ineligible; repeated open is idempotent; an adopted review must complete before the assessment receipt becomes available again, while an honest blocker keeps the same task resumable; Worker and local runtime return the same shape.
  Verify: `bun test tests/browser-review-contract.test.mjs tests/audit-mission-contract.test.mjs tests/mission-inspector-contract.test.mjs tests/assessment-receipt.test.mjs`; `bun test tests/audit-service.test.mjs tests/webmcp.test.mjs tests/sites-worker.test.mjs`; `bun test`; `bun run build`.

- [x] **18. Complete Human-mode rendered review and untouched-handoff recovery**
  What was built: The current exact task now renders target, trigger, assignment, completion criteria, and authority boundary beside a bounded Human-mode form. Passed, issue, and blocked submissions use the existing person-attributed service and validation; takeover copy changes with actual WebMCP readiness; stale writes refresh the current checkpoint/task without automatic replay; and an untouched optional handoff can be visibly withdrawn through one human-only revisioned transition.
  Acceptance: Human mode can submit passed, issue, or blocked with the same summary, observation, structured-finding, sequencing, provenance, revision, and stale-write rules as WebMCP; issue-only fields stay conditional; WebMCP-ready copy offers agent handoff while unsupported Human mode offers self-completion; untouched withdrawal restores the provider-only assessment without erasing the review record; evidence-bearing and verification reviews cannot withdraw; Worker/local/service/checkpoint/receipt shapes agree; the tool library remains twenty-one.
  Verify: `bun test tests/browser-review-contract.test.mjs tests/audit-mission-contract.test.mjs tests/assessment-receipt.test.mjs tests/mission-inspector-contract.test.mjs`; `bun test tests/audit-service.test.mjs tests/webmcp.test.mjs tests/sites-worker.test.mjs`; `bun test`; `bun run build`; `git diff --check`.

- [x] **19. Complete Human-mode repository diagnosis and honest blocker recovery**
  What to build: Expose the existing bounded diagnostic contribution contract in the visible mission. A person can submit browser observations, repository-relative ownership, planned verification checks, and confidence, or retain one honest diagnostic blocker, through the same checkpointed service used by WebMCP. Capability-aware copy should offer repository-agent handoff when WebMCP is ready and a complete Human-mode path when it is not.
  Acceptance: Person contributions use the same one-to-five observations, one-to-eight repository locations, one-to-eight checks, source-safe path validation, confidence enum, blocker reasons, mission revision, and stale-write rules as agent calls; stale recovery refreshes the current checkpoint and diagnostic mission without replaying a write; person provenance reaches the mission, repair handoff, reconciliation, and receipts unchanged; a blocker remains unresolved and replaceable by later bounded evidence; no tool, dependency, source upload, approval, deployment authority, or parallel state is added.
  Verify: `bun test tests/diagnostic-contract.test.mjs tests/human-diagnostic-ui.test.mjs tests/audit-mission-contract.test.mjs tests/assessment-receipt.test.mjs`; `bun test tests/audit-service.test.mjs tests/webmcp.test.mjs tests/sites-worker.test.mjs`; `bun test`; `bun run build`; `git diff --check`.

- [x] **20. Make every Human mission mutation recover safely from stale sessions**
  What was built: Added one read-only service refresh that reloads the bounded checkpoint plus authoritative audit, repair/policy, diagnosis, browser-review, and exploration snapshots. Remaining person-owned controls now use it on `MISSION_REVISION_STALE`, including repair intent, repair policy, staging, approval, change requests, deployment attestation, exploration, related-route starts, cancellation, and verification. The rejected mutation is never replayed.
  Acceptance: A stale write preserves the newer server state, refreshes every visible mission surface, and tells the person to inspect it before acting again; local approval/deployment confirmations, feedback, and route selections are cleared where reuse could be unsafe; ordinary actionable errors remain unchanged; optional read failures cannot erase successfully refreshed state; existing idempotent retries remain server-owned; no permission, tool, provider, Durable Object, dependency, or parallel state is added.
  Verify: `bun test tests/audit-service.test.mjs tests/human-mission-recovery-ui.test.mjs tests/mission-checkpoint-contract.test.mjs`; `bun test tests/webmcp.test.mjs tests/sites-worker.test.mjs tests/repair-contract.test.mjs`; `bun test`; `bun run build`; `git diff --check`.

- [x] **21. Split deferred mission workspaces out of the initial frontend bundle**
  What was built: The synchronous shell now retains URL intake, stable-audit restoration, active progress, contextual registration, and all twenty-one tool contracts. Explicit React lazy boundaries defer the completed report and mission inspector; the report then loads diagnosis, repair policy, repair workbench, verification, and shared proof surfaces only when their retained state needs them. Accessible loading, failure, and fresh-instance retry states preserve the authoritative audit and never replay a mutation.
  Acceptance: The initial bundle no longer contains completed-workspace UI; a delayed or failed chunk cannot erase the retained audit or broaden authority; retry remounts a fresh lazy component without restarting the audit; Human mode and all twenty-one contextual tools remain unchanged; diagnosis, repair, verification, and inspector surfaces retain their current contracts; the production build emits materially smaller initial JavaScript and records every deferred asset rather than suppressing size warnings.
  Verify: `bun test tests/lazy-workspaces-ui.test.mjs tests/human-browser-review-ui.test.mjs tests/human-diagnostic-ui.test.mjs tests/human-mission-recovery-ui.test.mjs`; `bun test tests/audit-service.test.mjs tests/webmcp.test.mjs tests/sites-worker.test.mjs`; `bun test`; `bun run build`; `git diff --check`.

- [x] **22. Harden the Human mission for keyboard access and 390 px reflow**
  What was built: The shell now exposes one main landmark and a keyboard skip target, moves focus and the document title only at meaningful audit-state boundaries, connects URL errors and live progress to assistive technology, and preserves visible focus across custom radio cards. Dialogs have bounded descriptions, scroll containment, Escape/Tab handling, and focus restoration. The report viewport chooser now follows the complete roving-tab keyboard pattern, and narrow Human controls retain at least 44 px targets with 16 px form text.
  Acceptance: URL intake, progress, restoration, completed evidence, diagnosis, repair, verification, mission inspector, and Human-only fallback remain usable without a pointer or WebMCP; 390 px layouts stack instead of clipping; motion reduction remains honoured; viewport tabs support arrows, Home, and End with matching tabpanel relationships; all twenty-one WebMCP tools and authority boundaries remain unchanged; static/build evidence is not presented as visual or assistive-technology proof.
  Verify: `bun test tests/accessibility-responsive-ui.test.mjs tests/lazy-workspaces-ui.test.mjs tests/human-browser-review-ui.test.mjs tests/human-diagnostic-ui.test.mjs tests/human-mission-recovery-ui.test.mjs`; `bun test`; `bun run build`; `git diff --check`; fresh 390 px, 200% zoom, keyboard, and screen-reader proof remains a later authorised browser gate.

- [x] **23. Add a safe fresh-agent mission handoff**
  What was built: The completed Human workspace can copy a bounded fresh-agent prompt derived from the current mission checkpoint and same-origin stable audit URL. It retains revision, status, required-capability, evidence-source, and human-authority orientation while deliberately omitting the checkpoint's action inputs. The receiving session is required to open the workspace and re-read its current checkpoint and contextual tools before acting; clipboard failure exposes an accessible manual-copy field.
  Acceptance: A copied handoff cannot freeze or replay a stale browser/diagnosis/repair input; arbitrary checkpoint authority fields are bounded and allowlisted; an unsafe origin or invalid revision fails closed; no tool, server mutation, authority, provider, Durable Object, or initial-bundle work is added; the action remains complete in Human mode and stacks safely at 390 px.
  Verify: `bun test tests/mission-handoff-contract.test.mjs tests/mission-handoff-ui.test.mjs tests/mission-checkpoint-contract.test.mjs tests/lazy-workspaces-ui.test.mjs`; `bun test`; `bun run build`; `bunx wrangler deploy --dry-run --strict --config wrangler.jsonc`; `git diff --check`.

- [x] **24. Make shared-audit restoration retry-safe and cross-audit isolated**
  What was built: A failed stable-workspace read now retains `/audits/:id`, exposes an accessible retry state, and performs only another authoritative GET. The shared service rejects a response whose audit ID does not match the request before changing active state. Cached-audit polling pauses, every contextual tool unregisters, and the inspector is disabled until the requested audit has loaded; leaving for a new audit remains an explicit Human action.
  Acceptance: A transient read failure cannot discard the resumable address, reveal a cached audit, continue polling the wrong job, or expose its tools; retry cannot start, cancel, or mutate a mission; failure and recovery update focus and page-title state; Human-only fallback and the twenty-one-tool library remain intact.
  Verify: `bun test tests/audit-restoration-ui.test.mjs tests/lazy-workspaces-ui.test.mjs tests/accessibility-responsive-ui.test.mjs tests/webmcp.test.mjs`; `bun test`; `bun run build`; `bunx wrangler deploy --dry-run --strict --config wrangler.jsonc`; `git diff --check`.

- [x] **25. Keep active-job read interruptions non-terminal**
  What was built: Polling failures now remain a separately announced connection interruption while the last authoritative job state stays intact. Frontmend automatically retries the same GET after three seconds and offers an immediate read-only retry; only a server-returned `failed` or `cancelled` job exposes the existing terminal controls.
  Acceptance: A transient read cannot fabricate provider failure, mutate the retained audit, or expose a fresh-start path; retry calls only `getAudit` for the current ID; automatic retry stops when the component leaves or the job becomes terminal; the warning is announced, responsive at 390 px, and does not remove Human cancellation or contextual WebMCP progress tools.
  Verify: `bun test tests/audit-progress-recovery-ui.test.mjs tests/audit-restoration-ui.test.mjs tests/lazy-workspaces-ui.test.mjs tests/accessibility-responsive-ui.test.mjs`; `bun test`; `bun run build`; `bunx wrangler deploy --dry-run --strict --config wrangler.jsonc`; `git diff --check`.

- [x] **26. Hydrate completed fresh-session workspaces coherently**
  What was built: Stable restoration now reads the completed audit, brackets job plus repair/policy, diagnosis, browser-review, and exploration snapshots with the persisted checkpoint, retries if the mission revision changes, and keeps the restoration/tool gate closed until every read succeeds. Every returned audit-scoped record must match the requested audit identity before publication.
  Acceptance: A fresh completed workspace cannot briefly expose empty mission maps, the wrong inspector step, or an incorrect contextual tool subset; partial reads remain on the recoverable restoration surface; cross-audit job, checkpoint, repair, diagnosis, review, or exploration records fail closed; running audits retain the light single-job restoration path; no mutation or new WebMCP tool is added.
  Verify: `bun test tests/audit-service.test.mjs tests/audit-restoration-ui.test.mjs tests/lazy-workspaces-ui.test.mjs tests/webmcp.test.mjs`; `bun test`; `bun run build`; `bunx wrangler deploy --dry-run --strict --config wrangler.jsonc`; `git diff --check`.

- [x] **27. Recover cross-page exploration status without inventing mission outcomes**
  What was built: The deferred exploration workspace now retains its last authoritative mission when collection or detail reads fail, announces the interruption separately, retries the same read automatically, and offers an immediate read-only retry. The shared service rejects start, collection, root, or detail identities that do not match the requested audit and mission before changing its cache.
  Acceptance: A transient read cannot hide, restart, fail, or replace the retained exploration; manual retry performs no mutation; cross-audit or wrong-mission payloads fail closed; current Human controls, mission authority, local/Worker contracts, and all twenty-one WebMCP tools remain unchanged; the warning and retry remain operable at 390 px.
  Verify: `bun test tests/audit-service.test.mjs tests/site-exploration-recovery-ui.test.mjs tests/site-exploration-contract.test.mjs tests/lazy-workspaces-ui.test.mjs`; `bun test`; `bun run build`; `bunx wrangler deploy --dry-run --strict --config wrangler.jsonc`; `git diff --check`.

- [x] **28. Refresh mounted report mission state coherently**
  What was built: Completed reports now replace three silent independent repair, diagnosis, and browser-review reads with the checkpoint-bracketed mission refresh. A complete-only publication option retains every previously coherent cache when any job, repair/policy, diagnosis, review, or exploration read is unavailable; the report announces the gap, retries automatically, and offers a read-only immediate retry.
  Acceptance: Partial background reads cannot publish a mixed mission revision, erase a retained record, change the inspector/tool state, or replay an action; stale Human-write recovery keeps its deliberately partial safe-refresh behaviour; top-level repair, diagnosis, and browser-review workspaces plus their nested records must match the requested audit; the warning remains accessible and operable at 390 px; Human-only fallback and all twenty-one tools remain intact.
  Verify: `bun test tests/audit-service.test.mjs tests/report-workspace-recovery-ui.test.mjs tests/audit-restoration-ui.test.mjs tests/lazy-workspaces-ui.test.mjs tests/human-mission-recovery-ui.test.mjs`; `bun test`; `bun run build`; `bunx wrangler deploy --dry-run --strict --config wrangler.jsonc`; `git diff --check`.

- [x] **29. Make verification-candidate recovery identity-bound and fail-closed**
  What was built: Candidate projections now identify their root audit and finding across Worker and local runtimes. The shared service rejects a scope for another audit or finding before publication. Human staging clears stale candidates while the exact scope loads, retries only the existing GET automatically or on request, exposes the interruption as an accessible warning, and remains disabled until the current scope is authoritative.
  Acceptance: A transient or mismatched candidate read cannot silently narrow the reviewed verification matrix, reuse another finding's routes, or stage a repair with an empty selection; retry performs no mutation; required retained routes remain server-derived; the control reflows at 390 px; Human-only fallback, local/Worker parity, and all twenty-one tools remain intact.
  Verify: `bun test tests/verification-impact-contract.test.mjs tests/audit-service.test.mjs tests/repair-scope-recovery-ui.test.mjs tests/sites-worker.test.mjs tests/human-mission-recovery-ui.test.mjs tests/lazy-workspaces-ui.test.mjs`; `bun test`; `bun run build`; `bunx wrangler deploy --dry-run --strict --config wrangler.jsonc`; `git diff --check`.

- [ ] **30. Prove the browser-review and replay candidate in fresh supported sessions**
  What remains: Deploy the combined Worker/UI candidate only with explicit authority, then run the exact fresh ChatGPT/Codex and Chrome procedures in `RELEASE_CANDIDATE.md` and capture tool subsets, IDs, visible state, console output, narrow layout, and provenance.
  Acceptance: The agent follows the short natural prompt through real rendered checks without coaching; the page and structured state agree; a browser-only issue or honest blocker is visible; one genuine repaired browser finding reappears as the exact post-deployment replay with receipt gating; no provider-only or build-only evidence is presented as this proof.

## Scope Gut-Check

The original guided scope has grown through bounded product-hardening rounds because Frontmend is an existing production-shaped system with mirrored Worker/local paths and a high evidence standard. The evidence compiler, shared mission contracts, Human parity, loading performance, and accessibility work remain distinct from truthful deployment, browser, and Devpost proof.
