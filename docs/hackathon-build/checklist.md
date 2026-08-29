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

- [ ] **4. Make WebMCP start and results mission-aware**
  Spec ref: `spec.md > WebMCP Tools > start_site_audit changes`; `spec.md > WebMCP Tools > get_site_audit_results changes`
  What to build: Add optional intent/focus/max fields to `start_site_audit`, persist them through the service, and make `get_site_audit_results` use persisted focus by default. Return typed mission state, per-priority evidence state, assessment completion, exact next actor/tool/input, and a clearly labelled read-only projection override.
  Acceptance: The natural accessibility/SEO call needs no repeated focus on the result call; audit-job completion is distinct from assessment completion; zero matches finish honestly; diagnostic priorities point to exact existing tools; no result claims manual completeness or repair permission.
  Verify: `bun test tests/webmcp.test.mjs tests/audit-mission-contract.test.mjs tests/audit-service.test.mjs`

- [ ] **5. Gate repair tools behind the semantic transition**
  Spec ref: `spec.md > WebMCP Tools > New prepare_site_repair tool`; `spec.md > WebMCP Tools > Contextual registration changes`
  What to build: Add `prepare_site_repair` as the seventeenth narrow WebMCP tool and update contextual registration so Assess exposes evidence/diagnosis plus the intent transition, while `stage_site_repair` appears only after Prepare fix and existing diagnostic readiness. Preserve all later repair/verification registrations.
  Acceptance: The transition tool accepts only audit/finding IDs; it cannot accept plan/code/policy/deployment data; `stage_site_repair` is absent before and present after a valid transition; verification audits retain receipt access; unsupported WebMCP still leaves the human UI complete.
  Verify: `bun test tests/webmcp.test.mjs tests/diagnostic-contract.test.mjs tests/repair-contract.test.mjs`

- [ ] **6. Add a judge-legible mission summary to progress and results**
  Spec ref: `spec.md > Human UI > Mission summary`; `prd.md > Epic 8: Make the WebMCP differentiation immediately legible`
  What to build: Render one semantic mission summary showing Assessment/Preparing a fix, focus, audit-versus-assessment status, next actor/action, and authority boundary. Reuse the pure derived contract; do not create browser-only state or replace the existing repair rail.
  Acceptance: Agent-started focus is visible during progress and after reload; broad human audits say Full frontend audit; the completed page shows when measurement is done but diagnosis remains; copy states that the agent investigates the repository while the person controls deployment; layout remains accessible and responsive.
  Verify: `bun test tests/audit-service.test.mjs tests/webmcp.test.mjs tests/sites-worker.test.mjs` plus `bun run build`

- [ ] **7. Add focused mission priorities and the human repair-intent action**
  Spec ref: `spec.md > Human UI > Focused priority presentation`; `spec.md > Human UI > Prepare repair transition`
  What to build: Add a compact ranked mission-priority view linked to the existing evidence queue, show each diagnostic state, and add the human `Prepare a fix` action using the shared service transition. Update styles and capability copy without duplicating finding details or changing repair policy.
  Acceptance: Selecting a mission priority selects its existing finding; cross-viewport occurrences remain visible; the action explains it records intent but is not approval/deployment; successful transition updates mission state and re-registers contextual tools; 390 px semantics and interaction remain safe by static/build evidence pending authorised browser proof.
  Verify: `bun test tests/webmcp.test.mjs tests/audit-service.test.mjs tests/sites-worker.test.mjs tests/repair-contract.test.mjs` plus `bun run build`

- [ ] **8. Harden the full contract and regression suite**
  Spec ref: `spec.md > Tests And Verification`; `spec.md > Security And Privacy`
  What to build: Fill cross-layer coverage for unknown fields, privacy boundaries, admission signatures, retry, reload, stale/conflicting intent, diagnostic completion, contextual tool changes, delegated-auto non-consumption, person-only deployment, and raw prompt/source/absolute-path exclusion. Update expected tool inventories and package test counts truthfully.
  Acceptance: All new PRD acceptance boundaries have direct deterministic coverage; existing cancellation, exploration, repair revision, implementation history, deployment gate, verification comparability, and human fallback contracts remain green.
  Verify: `bun run test`

- [ ] **9. Align product, demo, and fresh-session evidence instructions**
  Spec ref: `spec.md > Fresh-Session Evaluation`; `spec.md > Demo And Submission Flow`
  What to build: Update README, demo script, release candidate ledger, and submission-readiness notes with Assess versus Prepare fix, the natural prompt, exact ChatGPT/Chrome steps, the mission-continuity failure condition, temporary Cloudflare Access release gate, and only evidence actually proven at this point.
  Acceptance: Documentation leads with the product value beyond Lighthouse; no build is called deployment; browser proof remains unchecked until run; public-repo/video/access tasks remain explicit; demo spends most time on diagnosis and shared authority rather than audit polling.
  Verify: `rg -n "Assess|Prepare fix|assessmentComplete|ChatGPT|Chrome|Cloudflare Access|Lighthouse" README.md DEMO_SCRIPT.md RELEASE_CANDIDATE.md SUBMISSION_READINESS.md` and `git diff --check`

- [ ] **10. Run the command-safe release gate**
  Spec ref: `spec.md > Tests And Verification > Allowed release commands`
  What to build: Run the complete test suite, production build, and Wrangler strict dry run. Record fresh counts, asset/bundle output, exact commit, and the evidence boundary in release documentation. Fix genuine failures without weakening contracts.
  Acceptance: All commands succeed from the current worktree; release ledger distinguishes local tests/build/dry-run from deployment and browser proof; worktree contains only intentional tracked changes before commit.
  Verify: `bun run test`; `bun run build`; `bunx wrangler deploy --dry-run --strict`; `git diff --check`; `git status --short`

- [ ] **11. Prepare Devpost handoff**
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

## Scope Gut-Check

Eleven items is the upper end of the guided target but appropriate because Frontmend is an existing production-shaped system with mirrored Worker/local paths and a high evidence standard. The implementation itself remains five product slices; the remaining items are regression hardening, truthful release proof, and mandatory Devpost handoff.
