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
