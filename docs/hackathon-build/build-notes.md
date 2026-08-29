# Hackathon Build Notes

## 2026-08-29 — Guided build onboarding

- Entered the optional guided build path after the official rules and organiser resources were reviewed.
- Derived the learner and product baseline from the existing repository, release ledgers, current source, and commit history rather than asking the participant to restate known context.
- Active shaping: the participant pushed back on redundant onboarding—“you've helped dev it through, you should know” and “guided help is good but don't force yourself into the box.” Downstream stages must use the guide as scaffolding, not ceremony.
- Confirmed product direction: strengthen Frontmend's actual human-agent audit, repository handoff, controlled implementation, and verification loop against the four live judging criteria.
- Confirmed temporary infrastructure note: the current Cloudflare Access restriction is temporary; judge access remains a release gate, not a core product requirement.
- Deepening rounds: onboarding essentials were answered from established project evidence; redundant sharpening and aesthetic interview rounds were intentionally omitted at the participant's direction.

## 2026-08-29 — Scope

- Scoped from the working product, release ledger, judge-flow audit, live criteria, and the participant's instruction to avoid ceremonial re-interviewing.
- Central cut: do not expand Lighthouse breadth. Strengthen the natural-request continuation from measurement into diagnosis, repository handoff, controlled implementation, deployment attestation, and fresh verification.
- Positioning decision: Frontmend is a durable shared mission protocol, not a Lighthouse wrapper and not an autonomous code/deployment agent.
- Demo decision: lead with the natural accessibility/SEO prompt, then spend the majority of the demo on the differentiated post-measurement workflow.
- Release note: Cloudflare Access is temporary; judge accessibility is a release gate.
- Deepening rounds: zero. The participant explicitly asked the guide to use established context and not force the project into its interview structure.

## 2026-08-29 — PRD

- Expanded the scope into user-facing mission behaviour and testable acceptance criteria without selecting implementation details.
- Key product decision: “audit” defaults to a read-only Assess mission. Browser and repository diagnosis may continue the assessment, but repair staging requires a separate, attributable person request.
- Key authority decision: delegated auto mode affects approval only; it cannot create repair intent, consume grants during assessment, deploy, or attest deployment.
- Key success gate: a fresh session that completes Lighthouse but stops before a supported read-only diagnosis fails the mission-continuity evaluation.
- Existing audit, repair, implementation, deployment, and verification boundaries remain product requirements rather than being replaced by a new autonomous layer.
- Deepening rounds: zero additional interview rounds. The source, scope, prior active-shaping direction, and existing verified product behaviour resolved the required user and edge-case decisions.

## 2026-08-29 — Technical spec

- Mapped the PRD onto the current React/application-service/Worker Durable Object architecture after inspecting the current source and contracts.
- Architecture decision: add one pure audit-mission contract and persist only structured goal metadata on the existing audit job; derive continuation from current diagnostic and repair records.
- Workflow decision: add one explicit `prepare_site_repair` transition so Assess does not expose repair staging and delegated auto mode cannot silently broaden intent.
- Deduplication decision: same URL plus same structured mission may reuse a job; a materially different mission signature cannot overwrite the first goal.
- Privacy decision: never store the raw natural-language prompt; retain only bounded intent, focus areas, maximum priorities, attribution, and selected repair finding.
- Time-budget decision: no new dependency, provider, Durable Object class, database, crawler, or agent runtime.
- Deepening rounds: zero additional interview rounds. Repository and PRD evidence resolved stack, deployment, data-flow, risk, and file-boundary decisions.

## 2026-08-29 — Build checklist

- Plan ownership inferred as handed off from the participant's repeated request to keep building and prior instruction that guided help should not become a box.
- Build mode locked to autonomous, with each completed item committed separately using CK-XYZ.
- Verification uses targeted automated checks per slice and the full release gate at item 10. Human visual/browser pauses are deferred until a server or external session is explicitly authorised.
- Wow moment is participant-derived: a natural audit prompt becomes a visible read-only browser/repository assessment, and repair tools appear only after explicit intent.
- Checklist contains eleven sequenced items: five core contract/service/WebMCP slices, two human-experience slices, regression hardening, evidence documentation, command-safe release verification, and final Devpost handoff.
- Deepening rounds: zero. Autonomous handoff path used the mandatory final gut-check; scope is deliberately at the upper item limit because production/local parity and submission evidence are separate gates.

## 2026-08-29 — Build item 1

- Added the dependency-free audit mission contract with strict bounded inputs and no prompt storage.
- Mission signatures ignore timestamps, attribution, and focus ordering while retaining the semantic goal used for audit admission.
- Focused priorities now have stable cross-viewport deduplication and explicit measured, recommended, in-progress, or contributed diagnostic evidence state.
- Derived assessment completion distinguishes a finished measurement job from unfinished browser/repository diagnosis.
- Repair preparation is immutable per selected finding, idempotent for repetition, and carries no deployment authority.
- Verification: `bun test tests/audit-mission-contract.test.mjs` — 7 passed, 0 failed.

## 2026-08-29 — Build item 2

- Application and HTTP service layers validate mission goals before transport and transmit only intent, focus, and maximum—not timestamps, prompts, or local metadata.
- Production admission hashes the normalised mission signature with the URL, so reordered equivalent focus reuses a job while materially different focus receives a separate stable audit ID.
- Durable Object and local snapshots retain the bounded mission through queued, running, complete, failed, cancelled, reload, and stable-ID retry states.
- Retry preserves the original mission attribution and timestamp instead of silently rewriting it.
- PageSpeed requests receive no mission, focus, maximum, or intent parameters.
- Verification: `bun test tests/audit-service.test.mjs tests/sites-worker.test.mjs tests/audit-mission-contract.test.mjs` — 51 passed, 0 failed.

## 2026-08-29 — Build item 3

- Added the shared `prepareRepair` transport/service operation and production/local `POST /api/audits/:auditId/mission/prepare-repair` route.
- The authoritative job requires a completed retained report, an exact finding, bounded source attribution, and one immutable selection.
- Responses contain the updated audit snapshot, persisted mission, and derived next action; application state remembers the result for UI and WebMCP subscribers.
- Repeated same-finding calls are idempotent; incomplete jobs, unknown findings, unknown fields, and attempts to swap findings fail closed.
- Tests prove the transition creates no repair, grants no approval, leaves deployment authority false, and does not consume or rewrite repair policy allowance.
- Verification: `bun test tests/audit-service.test.mjs tests/sites-worker.test.mjs tests/repair-contract.test.mjs tests/audit-mission-contract.test.mjs` — 77 passed, 0 failed.

## 2026-08-29 — Build item 4

- `start_site_audit` now accepts bounded intent, focus areas, and maximum priorities, returns the persisted mission, and names the exact progress action.
- Natural audit requests default to read-only Assess; the tool description explicitly requires continuing beyond completed Lighthouse measurement while supported diagnosis remains.
- `get_site_audit_results` uses persisted focus by default, returns typed `missionState`, per-priority evidence state, distinct audit/assessment completion, and exact next tool/input.
- Optional focus/maximum overrides are labelled `read-only-override` and leave the persisted mission unchanged.
- Service state preserves the original mission when a legacy or partial transport snapshot omits it.
- Verification: `bun test tests/webmcp.test.mjs tests/audit-mission-contract.test.mjs tests/audit-service.test.mjs` — 42 passed, 0 failed.

## 2026-08-29 — Build item 5

- Added `prepare_site_repair` as the seventeenth bounded tool. Its only payload is audit/finding identity, and its result states that intent was recorded without approval, implementation, or deployment.
- Completed Assess context exposes results, evidence, applicable diagnosis/exploration, and repair preparation; it no longer registers repair staging by default.
- `stage_site_repair` appears only when the exact retained finding has explicit repair preparation and any required diagnostic mission is ready.
- Existing repair revision, implementation, verification, and verification-receipt tools continue to follow their authoritative retained states.
- Visible capability copy reports a contextual subset from a seventeen-tool library, including the new intent boundary.
- Verification: `bun test tests/webmcp.test.mjs tests/diagnostic-contract.test.mjs tests/repair-contract.test.mjs` — 44 passed, 0 failed.

## 2026-08-29 — Build item 6

- Added a single responsive `AuditMissionSummary` to running and completed workspaces; it derives from the persisted audit plus existing diagnostic/repair caches rather than adding browser-only mission state.
- The summary makes Assessment versus Preparing a fix, retained focus, job-versus-assessment completion, next actor/action, and agent/person attribution immediately visible.
- Authority copy states that the agent investigates browser/repository evidence while the person controls repair intent, approval, deployment, and deployment attestation.
- Broad human audits display Full frontend audit; legacy retained audits receive a display-only broad fallback without rewriting server state.
- React best-practices guidance influenced the pure prop-derived component and reuse of the existing subscription rather than a second subscription/state machine.
- Verification: `bun test tests/audit-service.test.mjs tests/webmcp.test.mjs tests/sites-worker.test.mjs` — 69 passed, 0 failed; `bun run build` succeeded with the Sites package prepared.

## 2026-08-29 — Build item 7

- Added a compact ranked mission-priority view above the complete evidence queue. Selecting a priority selects its existing finding rather than creating a parallel issue model.
- Each priority preserves its cross-viewport strategy occurrences and shows whether its evidence is ready, requires repository/browser diagnosis, or is outside the current focus.
- Added the human `Prepare a fix` action through the shared application-service transition. The UI explains that this freezes one target and creates no approval, implementation, auto-policy allowance, or deployment authority.
- The repair workspace remains hidden until the exact priority has explicit repair intent and any required diagnostic mission is complete.
- Production and local authoritative runtimes now reject direct repair staging without the retained mission transition, while existing idempotent repair replays remain valid.
- Responsive rules collapse priorities, evidence metadata, and the preparation action to a single column at narrow widths; interactive 390 px browser proof remains pending an authorised server session.
- Verification: `bun test tests/webmcp.test.mjs tests/audit-service.test.mjs tests/sites-worker.test.mjs tests/repair-contract.test.mjs` — 90 passed, 0 failed; `bun run build` succeeded with the Sites package prepared.

## 2026-08-29 — Build item 8

- Added direct service coverage proving retained mission focus survives partial transport snapshots and restores into a fresh service session with the same assessment state.
- Added a real shared-service WebMCP transition test: completed Assess context exposes preparation but not staging, `prepare_site_repair` records intent, subscribers are notified, and the contextual set then exposes staging.
- The complete seventeen-tool inventory is now asserted to contain no agent approval, repair-policy mutation, deployment, or deployment-attestation capability.
- Local-runtime parity now rejects repair staging before preparation, rejects a raw `prompt` field at the transition boundary, permits the same bounded human draft after preparation, and leaves repair policy allowance unchanged.
- Existing pure and integration coverage continues to prove semantic admission signatures, same-ID retry attribution, stale/conflicting intent rejection, diagnostic completion, raw prompt exclusion, source-content rejection, repository-relative paths, human deployment attestation, and honest verification.
- Updated the documented tool inventory and full-suite count from fresh output rather than historical estimates.
- Verification: `bun run test` — 124 passed, 0 failed; the packaging contract rebuilt the current Vite/Sites artifact during the run.

## 2026-08-29 — Build item 9

- README now opens the real Codex workflow with the natural one-line accessibility/SEO prompt, explains Assess versus Prepare a fix, and leads with diagnosis and shared authority rather than a Lighthouse score tour.
- Recut the under-three-minute demo around four judge-visible moments: retained mission focus, measurement-versus-assessment continuation, repository-aware diagnosis, and an explicit human transition into repair.
- The demo spends only a short interval on audit polling and makes a fake resolution, agent deployment, source upload, or premature repair transition an explicit failed take.
- Fresh ChatGPT steps now test the natural focused request, empty result continuation, no-more-than-three priorities, honest repository-access blocking, and a separate natural preparation request.
- Fresh Codex steps test the strongest repository-native path: browser reproduction, repository ownership, bounded diagnosis, explicit preparation, reviewed implementation, and the person-only deployment gate.
- Fresh Chrome Inspector steps now test Assess focus and `assessmentComplete`, then call `prepare_site_repair` before expecting any eligible staging capability; Chrome-only evidence must not invent repository diagnosis.
- Temporary Cloudflare Access **Only CK** is recorded as a release blocker rather than free judging access. Older deployed Lighthouse and WebMCP receipts remain labelled historical and cannot prove the newer local mission candidate.
- Verification: the required cross-document `rg` query returned Assess, Prepare a fix, `assessmentComplete`, ChatGPT, Chrome, Cloudflare Access, and Lighthouse coverage; `git diff --check` passed.
