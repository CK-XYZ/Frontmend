# Evidence-Driven WebMCP Product Plan

## Purpose

Strengthen Frontmend's core product so it cannot reasonably be described as “Lighthouse plus an agent checklist.” The next phase should make WebMCP the protocol that turns incomplete public evidence into exact external-agent investigations, reconciles what different evidence sources say, carries a bounded repair through human authority, and proves the relevant public behaviour afterward.

This is a product-development plan. Demo editing, submission video production, public-repository publication, and Devpost form work are not part of these slices.

## Current Baseline

The current local candidate already has:

- asynchronous public PageSpeed/Lighthouse measurement with a bounded document fallback;
- persisted audit missions and stable workspace paths;
- contextual WebMCP registration across audit, browser review, diagnosis, repair, implementation, deployment attestation, and verification;
- ordered agent browser review with pass, issue, and honest blocker outcomes;
- separately attributed provider, browser, repository, implementation, deployment, and verification evidence;
- human review or bounded low-risk delegated authorisation;
- exact post-deployment replay for browser-observed findings;
- 21 bounded tools, shared human/WebMCP services, Worker/local-runtime parity, and deterministic contract coverage.

The main remaining weakness is that assessment browser checks are still selected from a small static catalogue. They are focus-aware, but not yet compiled from the actual provider finding, selector, viewport, route, evidence gap, or desired acceptance condition. That makes the mechanism useful but still easier than it should be to dismiss as a generic checklist wrapped around Lighthouse.

## Product Thesis

Frontmend should behave as an evidence-driven mission compiler:

```text
Public provider and document evidence
  -> exact investigation tasks for an external browser agent
  -> retained browser observations or honest blockers
  -> explicit reconciliation without merging evidence sources
  -> repository ownership and bounded repair mission
  -> human-reviewed impact scope
  -> fresh provider measurement and exact browser replay
  -> portable proof receipt
```

WebMCP is essential because the page owns the durable mission and evidence rules while the external agent owns capabilities Frontmend deliberately does not embed: rendered-browser control, repository inspection, implementation, and fresh-session continuation.

## Product Principles

1. **Compile work from evidence.** Do not give the agent a generic checklist when a retained finding can produce a more exact task.
2. **Keep evidence sources separate.** Provider output, browser observations, repository diagnosis, implementation claims, deployment attestation, and verification must never overwrite one another.
3. **Use categorical states, not invented confidence scores.** Prefer `browser-confirmed`, `provider-browser-conflict`, or `diagnosis-required` over false numerical certainty.
4. **One next action at a time.** The page should expose the smallest valid contextual action and explain why it is active.
5. **No hidden agent.** Frontmend does not become an LLM wrapper or embedded browser automation service.
6. **Human authority remains explicit.** Investigation is read-only. Repair intent, policy, approval, deployment, and deployment attestation retain their existing boundaries.
7. **Bound the impact radius.** Routes, viewports, findings, files, and checks must come from retained evidence or a reviewed agent proposal, never an arbitrary crawl.
8. **Fresh sessions must be safe.** A new capable agent should resume the mission from durable state without relying on chat history or guessing.
9. **Do not inflate the tool count for presentation.** Extend the semantics of existing tools unless a new transition is genuinely distinct.
10. **Human mode remains complete.** `document.modelContext` may improve collaboration but must never be required to use the product.

## Target Experience

A developer asks a coding agent:

> Please use Frontmend to audit my site for accessibility and SEO issues.

Frontmend measures the public page. Instead of returning only scores or a generic manual-review instruction, it compiles the most valuable unresolved investigation from the actual evidence. The task names the retained route, viewport, element or rule, why provider evidence is insufficient, what the browser agent must inspect, what it may safely interact with, and what observation will complete the step.

The agent performs the exact check using its own browser capability and returns bounded observations. Frontmend preserves the provider and browser records separately, classifies their relationship, and decides whether the assessment can finish, needs repository diagnosis, or can be prepared for repair. A later fresh session can reopen the stable workspace and receive the same authoritative next action. If a repair affects multiple retained routes or strategies, the verification plan shows that impact scope before approval and proves each required target afterward.

## Architecture Extension

```text
Audit report + document profile + mission
  -> compileBrowserInvestigations()
       -> ordered evidence-led tasks
       -> bounded generic coverage only where evidence is silent

Provider findings + browser review + diagnostic missions
  -> reconcileAssessmentEvidence()
       -> categorical evidence relationship per priority
       -> exact unresolved requirement
       -> next actor and next contextual action

Mission state + contextual tool inventory
  -> createMissionCheckpoint()
       -> stable workspace path
       -> mission revision
       -> required capability
       -> exact next action and reason

Authorised repair + retained occurrences + observed routes + reviewed agent scope
  -> deriveVerificationImpactMatrix()
       -> bounded routes, viewports, rules, and browser replays
       -> claim lock until every required cell is resolved or explicitly inconclusive
```

These are pure shared contracts. React, WebMCP, the audit service, the local parity runtime, and the Worker consume the same serialisable projections.

## Slice 1 — Finding-Aware Browser Investigation Compiler

### Goal

Replace the static assessment checklist as the primary path with deterministic tasks compiled from retained evidence. Preserve a small generic fallback only for requested focus areas where provider/document evidence is silent.

### Proposed files

- Add `src/browser-investigation-compiler.js`.
- Update `src/browser-review-contract.js` to persist compiled task snapshots.
- Update `src/audit-mission-contract.js` only where derived next-action state needs the richer task projection.
- Update `src/webmcp.js` so the existing `open_browser_review` and `record_browser_review_check` tools expose and accept the compiled task contract.
- Update `worker/index.js`, `worker/local-runtime.js`, and `src/audit-service.js` only for shared persistence/transport parity.
- Add `tests/browser-investigation-compiler.test.mjs` and extend the existing browser-review, service, Worker, and WebMCP suites.

### Task shape

```js
{
  schemaVersion: 1,
  id: "...",
  kind: "provider-confirmation" | "coverage-gap" | "safe-journey" | "verification-replay",
  focusArea: "accessibility" | "seo",
  target: {
    path: "/...",
    viewport: "mobile" | "desktop"
  },
  trigger: {
    provider: "PageSpeed Insights" | "Frontmend document inspection" | "Frontmend",
    auditId: "...",
    findingId: "..." | null,
    ruleId: "..." | null,
    selector: "..." | null,
    retainedEvidence: "..."
  },
  assignment: {
    goal: "...",
    instructions: "...",
    boundary: "...",
    completionCriteria: "..."
  },
  responseContract: {
    outcomes: ["passed", "issue", "blocked"],
    observationPrompt: "...",
    findingsAllowed: true,
    blockerReasons: ["..."]
  }
}
```

### Compilation rules

1. Prefer retained high-severity findings with exact route, strategy, selector, or diagnostic need.
2. Collapse duplicate provider rules into one investigation while retaining every affected strategy and occurrence.
3. Create tasks only where rendered-browser evidence can add information. Do not ask an agent to repeat a provider fact verbatim.
4. Generate a direct confirmation task when a selector and viewport are retained.
5. Generate a bounded diagnostic observation task for supported symptoms such as console errors, contrast, hidden or clipped controls, heading/landmark ambiguity, accessible-name failures, navigation discovery, and unsafe responsive reflow.
6. For console evidence, accept only bounded first-party observations. Never retain full logs, tokens, query strings, private data, or unrelated third-party payloads.
7. When no provider finding covers a requested focus area, add only the minimum generic coverage needed to inspect rendered structure, a safe primary journey, responsive reflow, or search discovery.
8. Keep tasks sequential. A blocked task remains current and replaceable by a later capable session.
9. Snapshot every compiled task so later provider changes cannot silently rewrite an active mission.
10. Retain the current post-deployment `fresh-browser-replay` semantics exactly.

### Acceptance criteria

- A contrast finding with a retained selector produces a selector- and viewport-specific assignment.
- A console-error symptom produces a bounded fresh-load observation task rather than a request to infer source ownership.
- Cross-viewport duplicates produce one task with explicit affected strategies.
- A zero-provider-finding accessibility/SEO mission still receives bounded rendered coverage.
- Unsupported or low-value provider rules do not create busywork.
- Provider text is treated as untrusted input, bounded, and never allowed to alter authority or task schemas.
- The existing 21-tool library is sufficient.
- Worker and local runtime return byte-equivalent JSON shapes for the same fixture.
- Human mode continues to show and complete the same task through the shared service.

### Verification

```powershell
bun test tests/browser-investigation-compiler.test.mjs tests/browser-review-contract.test.mjs tests/audit-mission-contract.test.mjs
bun test tests/audit-service.test.mjs tests/webmcp.test.mjs tests/sites-worker.test.mjs
bun run build
```

### Commit boundary

`feat: compile evidence-led browser investigations`

## Slice 2 — Evidence Reconciliation Contract

### Goal

Make the relationship between provider, browser, and repository evidence explicit without flattening them into one score or claiming certainty Frontmend does not possess.

### Proposed files

- Add `src/evidence-reconciliation-contract.js`.
- Update `src/audit-mission-contract.js` to use reconciliation results for priority and completion state.
- Update assessment receipt generation to include the categorical relationship and unresolved requirement.
- Update `src/App.jsx` and `src/styles.css` with a compact evidence-chain presentation.
- Extend service, Worker, WebMCP, assessment receipt, and mission contract tests.

### Priority relationship states

- `provider-only` — measured failure retained; no browser observation yet.
- `browser-confirmed` — direct browser observation agrees with the retained provider symptom.
- `browser-only` — direct rendered issue has no matching provider finding.
- `provider-browser-conflict` — the retained sources disagree or observed scope differs.
- `diagnosis-required` — the symptom is established but cause/ownership is not.
- `diagnosis-contributed` — bounded repository evidence and planned checks were supplied.
- `verification-required` — a repair was implemented or deployed but the public claim is not freshly proven.
- `verified-resolved`, `verified-still-present`, or `verification-inconclusive` — final proof states retaining source boundaries.

### Reconciliation rules

1. Never replace a provider result with an agent observation or vice versa.
2. Match only on explicit retained identity: route, focus area, rule/finding lineage, viewport, and element where available.
3. A browser pass against a broad check does not erase a specific provider failure.
4. A browser issue may strengthen prioritisation but remains labelled agent-reported.
5. A conflict is a useful state. It must recommend the exact next investigation instead of averaging evidence.
6. Repository diagnosis may explain ownership but cannot convert an observation into independent measurement.
7. Only fresh verification may produce a resolution state.

### Acceptance criteria

- Every ranked priority has exactly one relationship state and a plain-language reason.
- Provider/browser disagreement keeps the assessment resumable and claim-safe.
- Browser-only issues enter repair preparation without being relabelled as Lighthouse findings.
- Receipts render sources side by side and retain their individual timestamps and provenance.
- No numerical confidence score is invented.
- The human UI and `get_site_audit_results` return the same relationship state.

### Verification

```powershell
bun test tests/evidence-reconciliation-contract.test.mjs tests/audit-mission-contract.test.mjs tests/assessment-receipt.test.mjs
bun test tests/audit-service.test.mjs tests/webmcp.test.mjs tests/sites-worker.test.mjs
bun run build
```

### Commit boundary

`feat: reconcile provider and browser evidence`

## Slice 3 — WebMCP Mission Inspector

### Goal

Turn the capability sheet from a tool inventory into an explanation of the live human-agent protocol. Keep tool names available as secondary developer detail.

### Primary questions answered

1. **What happens now?** The current agent or person action in plain language.
2. **Why now?** The retained evidence/state that makes the action valid.
3. **What must come back?** The bounded response contract.
4. **What does it unlock?** The next mission transition, without promising success.
5. **What remains human-only?** Repair intent, approval/policy, deployment, or attestation as applicable.

### Proposed implementation

- Add a pure `missionInspectorProjection()` to the mission contract or a small adjacent module.
- Rework `WebMcpCapabilitySheet` in `src/App.jsx` around the five questions above.
- Show the contextual tool list in a collapsed or secondary section.
- Reuse existing Phosphor icons and Frontmend design tokens.
- Preserve the current focus trap, Escape handling, close-button focus restoration, dialog semantics, and Human mode fallback.
- Update landing signals only enough to make the agent handoff discoverable; do not turn the landing page into a feature inventory.

### Example states

- Landing: “An agent can start the same public audit as this form.”
- Provider running: “Measurement is running; only progress or cancellation is valid.”
- Investigation waiting: “Provider evidence is complete; the agent owns one exact rendered check.”
- Repository diagnosis waiting: “The issue is established; repository ownership remains unverified.”
- Human review waiting: “The plan is visible; only the person or their prior bounded policy may authorise it.”
- Deployment waiting: “Implementation was reported; the site owner still owns deployment and attestation.”
- Replay waiting: “Fresh provider measurement finished; the exact retained browser comparison is still required.”

### Acceptance criteria

- A non-technical user can explain the current agent task without reading a tool name.
- The panel explains why tools appeared or disappeared.
- Tool names and schemas remain discoverable for developers and judges.
- The visible next actor/action agrees with contextual registration and structured results.
- Human mode remains fully functional and does not imply degraded auditing.
- The panel works at 390 px without horizontal overflow or clipped controls.
- Keyboard focus is trapped, Escape closes, and focus returns to the trigger.

### Verification

```powershell
bun test tests/audit-mission-contract.test.mjs tests/webmcp.test.mjs tests/audit-service.test.mjs
bun run build
```

Fresh visual and keyboard verification requires explicit permission to run or deploy the current candidate.

### Commit boundary

`feat: turn WebMCP status into a mission inspector`

## Slice 4 — Fresh-Session Mission Checkpoints

### Goal

Make session independence a first-class product feature. A new agent should resume from the page's authoritative state rather than reconstruct the workflow from earlier chat history.

### Checkpoint shape

```js
{
  schemaVersion: 1,
  auditId: "...",
  workspacePath: "/audits/...",
  missionRevision: 7,
  status: "action-available" | "in-progress" | "blocked" | "complete",
  nextActor: "agent" | "person" | null,
  requiredCapability: "browser" | "repository" | "human-review" | "deployment" | null,
  action: {
    tool: "...",
    input: { "...": "..." },
    reason: "..."
  },
  completionCriteria: ["..."],
  retainedEvidenceSummary: ["..."],
  authorityBoundary: {
    humanOnly: ["..."],
    agentMay: "...",
    claim: "..."
  }
}
```

### Proposed implementation

- Derive checkpoints from existing authoritative records; do not add a second persisted state machine.
- Return the checkpoint from `get_site_audit_results` and relevant mutation responses.
- Show it in the mission inspector and visible audit summary.
- Include a mission revision in mutation inputs where stale work could otherwise be accepted.
- Reject stale contributions with an actionable `MISSION_REVISION_STALE` error containing the current safe checkpoint.
- Keep raw prompts, chat history, source contents, absolute paths, and private browser data out of checkpoints.

### Acceptance criteria

- A fresh supported session opening the stable workspace receives the exact current task without prior conversation context.
- A blocked browser or repository task stays resumable.
- A stale session cannot overwrite a newer contribution.
- Retrying an idempotent contribution at the current revision remains safe.
- Checkpoints describe required capability without asserting that the current agent possesses it.
- Human-only states never expose a tool that lets the agent bypass the person.

### Verification

```powershell
bun test tests/audit-mission-contract.test.mjs tests/browser-review-contract.test.mjs tests/diagnostic-contract.test.mjs
bun test tests/audit-service.test.mjs tests/webmcp.test.mjs tests/sites-worker.test.mjs
bun run build
```

### Commit boundary

`feat: persist resumable mission checkpoints`

## Slice 5 — Reviewed Repair Impact And Verification Matrix

### Goal

Prove a repair across the bounded routes, viewports, rules, and rendered checks it may affect instead of treating the original page as the entire impact radius.

### Scope sources

- every retained occurrence of the selected finding;
- measured mobile/desktop/document strategies;
- same-site routes already observed by the retained audit;
- recurring findings from an existing bounded site exploration;
- repository-relative ownership and planned checks contributed by the agent;
- an optional bounded agent proposal for additional verification targets, restricted to retained same-site routes and reviewed before authorisation.

### Verification matrix shape

```js
{
  schemaVersion: 1,
  repairId: "...",
  rows: [
    {
      targetId: "...",
      path: "/...",
      strategy: "mobile" | "desktop" | "document" | "browser",
      proofKind: "provider-rule" | "browser-replay",
      baseline: { "...": "..." },
      status: "waiting" | "running" | "resolved" | "still-present" | "inconclusive"
    }
  ],
  reviewedBy: "person" | "delegated-auto-policy",
  reviewedAt: 1720000000000
}
```

### Rules

1. Default to the exact retained occurrence set; additional scope must have a retained evidence reason.
2. Never accept arbitrary external origins or an open-ended crawl.
3. Auto mode may accept additional scope only when it remains within the existing low-risk policy and observed same-site routes.
4. Deployment remains person-owned regardless of impact scope.
5. Every required matrix cell must resolve, remain present, or be explicitly inconclusive. Missing cells cannot produce a resolved receipt.
6. Summary deltas remain separate from exact rule/browser proof.
7. Reuse existing related-audit, site-exploration, repair, and verification contracts where possible.

### Acceptance criteria

- A shared mobile/desktop rule verifies every retained occurrence.
- A browser-observed issue produces the existing exact replay cell.
- A reviewed related route may be added only when it was observed by the retained audit boundary.
- A failure on any required target prevents an overall resolved claim.
- Partial provider coverage produces an explicit inconclusive matrix rather than a false pass.
- The visible matrix and portable receipt use the same server-derived state.

### Verification

```powershell
bun test tests/repair-contract.test.mjs tests/site-exploration-contract.test.mjs tests/route-contract.test.mjs
bun test tests/audit-service.test.mjs tests/webmcp.test.mjs tests/sites-worker.test.mjs
bun run build
```

### Commit boundary

`feat: verify reviewed repair impact scope`

## Freeform Product Round — Human Mission Parity And Review Depth

The evidence-driven contracts exposed two human-product gaps worth resolving before release work. First, WebMCP could start a focused mission while the visible URL intake could only start a broad audit. Second, the server issued bounded optional verification routes to agents, but the human staging path could not inspect or select them before reviewing the matrix.

### Focused human assessment intake

- Keep the URL-first landing and broad audit as the zero-configuration default.
- Add a progressive native disclosure for zero to three supported focus areas and a one-to-five mission shortlist.
- Send the selection through the existing `createAuditMission()` and application service path with `requestedBy: human`.
- Preserve the selection through cancellation, retry, restoration, and the stable workspace.
- Clarify that focus ranks the mission shortlist while the complete evidence record remains available.

### Human-reviewed optional verification routes

- Read candidates only from the existing server-authoritative verification-candidate endpoint after repair intent and diagnosis are ready.
- Let a person select at most the existing three server-issued IDs before staging a human repair draft.
- Keep root and retained failed routes automatic and keep approval as the point where the matrix is frozen.
- Show every eligible candidate on the draft/review surface as included or not selected, with its retained path, evaluated strategies, and evidence reason.
- If the read-only candidate projection is unavailable, retain required verification scope and do not invent a route.

These changes add no tool, dependency, Durable Object, browser automation, authority, or second mission state. They deepen the human-facing product around contracts already available to agents.

## Freeform Product Round — Seamless Human-To-Agent Takeover

A person who already measured a site should not need to restart that audit merely because a browser-capable agent becomes available later. Eligible completed human **Assess** missions therefore adopt the existing browser-review transition instead of creating a new job or tool.

- Keep the original audit ID, attempt, person mission attribution, completed provider report, and human-only authority boundary.
- Offer takeover only for broad Assess missions or retained accessibility/SEO focus. Performance-only and repair-preparation missions remain ineligible.
- Let broad missions choose one or two rendered-review areas from accessibility and SEO; focused missions must retain their exact existing rendered scope.
- Record bounded adoption provenance (`human-to-agent`, original actor, opener, timestamp, same-audit, no restart) inside the existing browser-review record.
- Increment the authoritative mission revision only when the review is first opened. Reopening the singleton is idempotent even when the caller still holds the pre-open revision.
- Once adopted, treat the rendered review as required until every compiled task completes. An honest blocker keeps the current task resumable, and a previously available assessment receipt stays withheld throughout that continuation.
- Expose the same transition through the visible Human-mode handoff, mission inspector, checkpoint, HTTP/service adapters, and contextual `open_browser_review` tool. Keep the library at twenty-one tools.
- Preserve Worker/local payload parity and do not add browser automation, deployment authority, repair authority, or a parallel mission state.

## Freeform Product Round — Complete Human Rendered Review

The retained task must remain useful when WebMCP is unavailable or when the person prefers to perform the rendered inspection directly. Human mode therefore exposes the same exact assignment and response contract through the shared application service rather than treating agent handoff as the only completion path.

- Render the current target, retained trigger, instructions, completion criteria, and authority boundary before collecting a result.
- Accept passed, issue, or blocked with the same bounded summary, observations, conditional structured findings, blocker reasons, sequencing, and validation as WebMCP.
- Attribute person-recorded browser evidence through reconciliation, diagnosis, repair baselines, verification replay, mission state, and portable receipts without relabelling it as agent evidence.
- Offer agent handoff only when WebMCP registration is ready; otherwise explain and open the complete Human-mode path.
- Refresh the authoritative checkpoint and current review after `MISSION_REVISION_STALE`, but require the person to inspect the refreshed task before resubmitting.
- Let a person withdraw only an untouched optional human-to-agent assessment handoff. Retain the withdrawn record with no evidence provenance; once any result exists, require completion or an honest blocker.
- Preserve the twenty-one-tool library, Worker/local parity, person-owned deployment, and the absence of embedded browser automation.

## Freeform Product Round — Complete Human Repository Diagnosis

Rendered evidence can now be completed without WebMCP, but a supported diagnostic mission still asks the visible person to wait for `submit_runtime_diagnosis`. Complete Human mode by rendering that existing bounded contract through the same application service.

- Let a person contribute the same causal summary, reproduction, one to five typed observations, one to eight repository-relative ownership locations, one to eight planned checks, and bounded confidence used by the agent tool.
- Offer the same honest blocker reasons when matching browser or repository evidence is unavailable; never turn the blocker into dismissal, completion, or repair permission.
- Attribute both evidence and blockers as person-reported through reconciliation, repair provenance, checkpoints, and portable receipts.
- When WebMCP is ready, explain that a repository-aware agent can take the task; when it is unavailable, keep the full form usable instead of presenting a dead end.
- On `MISSION_REVISION_STALE`, reload the authoritative checkpoint and diagnostic workspace, then require the person to inspect the refreshed state before submitting again.
- Reuse the current diagnostic mission, service, HTTP routes, validation, and revision rules. Add no tool, dependency, source upload, approval authority, deployment authority, or parallel mission state.

## Freeform Product Round — Human Mission Conflict Recovery

Mission revisions already reject stale writes, but a generic error can leave a person looking at obsolete review or deployment state. Make concurrency recovery a complete Human-mode behaviour rather than a transport detail.

- Add one read-only application-service refresh for the current checkpoint and all authoritative mission snapshots already owned by the audit job.
- On `MISSION_REVISION_STALE`, refresh audit, repair/policy, diagnosis, browser-review, and exploration state, then require the person to inspect the new mission before taking another action.
- Apply the recovery path to repair intent, policy changes, staging, approval, change requests, deployment attestation, exploration, related-route starts, cancellation, and verification.
- Clear local confirmations, feedback, and route selections when keeping them could accidentally authorise or submit against a different revision.
- Never automatically replay a rejected mutation. Idempotency remains an authoritative server decision, not a UI retry heuristic.
- Keep ordinary structured errors unchanged and tolerate optional snapshot-read failures without erasing successfully refreshed state.
- Add no WebMCP tool, permission, provider, dependency, Durable Object, or parallel mission state.

## Freeform Product Round — Deferred Mission Workspaces

The completed mission experience has grown into a capable review surface, but that code currently ships before a person has even submitted a URL. Split by user-visible phase so the first interaction remains small while every later workspace preserves the same durable state and authority.

- Keep landing, public-URL validation, stable-audit restoration, and active audit progress in the synchronous shell.
- Lazy-load the completed report and the WebMCP mission inspector. Split diagnosis, repair, and verification presentation into deferred workspace modules instead of hiding the current monolith behind a no-op wrapper.
- Use one accessible loading/error boundary contract. A retry creates a fresh lazy component instance while retaining the current audit and mission revision; it never restarts a job or replays a mutation.
- Keep Human mode complete and preserve all twenty-one contextual WebMCP tools, schemas, registration rules, shared services, and authority boundaries.
- Compare the production assets with the retained 546.44 kB raw / 147.66 kB gzip initial JavaScript baseline. Record all new chunks and retain any genuine warning.
- Add no dependency, provider, Durable Object, browser automation, deployment authority, or parallel mission state.

## Freeform Product Round — Focused Accessibility And Responsive Hardening

The mission surfaces now have enough depth that keyboard order, state announcements, and narrow-screen legibility are product requirements rather than finish-line polish. Harden the existing direction without redesigning the workflow or changing its authority.

- Give the application one main landmark and a first-focus skip target while keeping the global header and footer outside that landmark.
- Move focus and the page title only when the user crosses a meaningful landing, restoration, progress, terminal-failure, or report boundary; do not steal focus during ordinary polling.
- Associate URL validation with its input, expose progress value and phase text, and make stage state textual rather than colour/icon-only.
- Retain the existing dialog focus trap, Escape handling, and focus restoration while adding descriptions, body-scroll containment, dynamic viewport height, and a focusable fallback.
- Complete the viewport chooser as a roving-tab pattern with arrow, Home, and End navigation plus one labelled tabpanel.
- Make hidden radio-card focus visible, raise dense Human/inspector metadata to readable sizes, preserve reduced motion, and retain at least 44 px controls plus 16 px form text at the 390 px breakpoint.
- Preserve Human-only fallback, the twenty-one-tool library, contextual registration, shared services, persisted missions, and every person-owned approval/deployment boundary.
- Treat source, test, and production-build evidence as structural proof only. Fresh 390 px, 200% zoom, keyboard, high-contrast, and screen-reader evidence remains a separate browser gate.

## Freeform Product Round — Safe Fresh-Agent Handoff

The persisted checkpoint makes a fresh session resumable, but a plain shared URL does not explain that old chat actions and revisions must be discarded. Add one Human-mode handoff that turns the existing durable contract into a safe, copyable continuation without freezing mutable tool input.

- Derive the handoff from the current checkpoint and same-origin stable audit URL through one pure bounded projection.
- Include revision, status, required capability, evidence-source separation, and the human-only boundary as orientation at copy time.
- Do not copy the checkpoint's action input, browser task IDs, repair IDs, or any raw prompt, source, private browser data, or absolute path.
- Require the receiving session to open the workspace and re-read its current checkpoint plus contextual tool set; live state always supersedes copied orientation.
- Provide an accessible manual-copy field when clipboard access is unavailable and retain the existing 390 px wrapping behaviour.
- Keep the compiler and presentation inside the deferred report path so URL intake and active audit progress do not pay for it.
- Add no WebMCP tool, server mutation, permission, provider, Durable Object, deployment authority, or parallel mission state.

## Freeform Product Round — Retry-Safe Fresh-Session Restoration

The handoff is only durable if a temporary read failure cannot destroy its stable address or fall through to unrelated cached state. Harden the synchronous restoration shell as an authority boundary, not merely a loading screen.

- Retain the requested audit ID and `/audits/:id` URL after a failed authoritative read.
- Reject a returned audit whose identity does not exactly match the requested workspace before it can become active.
- Offer an accessible retry that repeats only the existing audit GET and never starts, cancels, or mutates a mission.
- Keep restoration mode active across failure so a cached audit cannot become visible under the requested address.
- Pause cached-audit polling and register no contextual tools until the requested audit is authoritative.
- Disable the mission inspector while its projection would otherwise be based on unrelated cached state.
- Make leaving for a new audit an explicit Human action that clears the retained request.
- Preserve the twenty-one-tool library, Human-only fallback, initial-bundle boundary, and every approval and deployment boundary.

## Freeform Product Round — Non-Terminal Active-Status Recovery

The job is server-authoritative, so losing one progress response cannot truthfully become a provider failure. Separate observation availability from job outcome throughout the synchronous progress shell.

- Retain the last authoritative job state when a polling read fails.
- Announce the connection interruption without changing status, phase, progress, error provenance, or mission state.
- Retry the same audit GET automatically with a bounded delay and expose one immediate read-only retry.
- Never surface the fresh-attempt mutation unless the job itself returns an authoritative terminal failure.
- Cancel timers and ignore late reads when the visible audit, restoration boundary, or component lifecycle changes.
- Preserve Human cancellation, contextual progress tools, the twenty-one-tool library, and every authority boundary.

## Freeform Product Round — Coherent Fresh-Session Hydration

A completed top-level job is not enough to expose a mission: its auxiliary records determine the next actor, exact tool subset, repair authority, and verification state. Restore them as one revision-stable read boundary.

- Keep the stable restoration gate active after the top-level completed job is found.
- Bracket audit, repair/policy, diagnosis, browser-review, and exploration reads with the persisted checkpoint.
- Retry the bounded read when mission revision changes during hydration.
- Require each returned job, checkpoint, repair, diagnosis, browser review, and exploration to identify the requested audit.
- Treat any unavailable or mismatched mission record as recoverable incomplete restoration, not an empty workspace.
- Register no contextual tools and expose no mission inspector until the coherent snapshot is authoritative.
- Preserve the light single-job path for running audits, Human-only fallback, and the twenty-one-tool library.

## Freeform Product Round — Truthful Cross-Page Exploration Recovery

An exploration mission remains authoritative even when its next browser read fails. Treat collection and detail availability separately from the durable mission outcome.

- Retain the last confirmed exploration and never convert a rejected read into `failed`, `partial`, or `complete` state.
- Announce the read interruption separately, retry the same collection or mission detail automatically, and expose one immediate read-only retry.
- Validate the requested root audit on exploration start, collection, and detail responses, plus the requested mission ID on detail responses, before changing the shared cache.
- Reject cross-audit or wrong-mission responses without clearing the retained mission or publishing the foreign payload.
- Preserve the existing Human start action, contextual exploration tools, mission revision behaviour, Worker/local runtime contract, and twenty-one-tool library.
- Keep the recovery control accessible and reflow-safe at 390 px.

## Freeform Product Round — Coherent Mounted-Report Refresh

A restored report can become inconsistent again if each auxiliary workspace publishes independently. Reuse the authoritative checkpoint boundary after mount rather than treating repair, diagnosis, and browser review as unrelated reads.

- Replace independent background reads with one checkpoint-bracketed mission refresh covering job, repair/policy, diagnosis, browser review, and exploration state.
- Add a complete-only publication mode that leaves the last coherent cache untouched whenever one read is unavailable or the client generation changes.
- Retain the existing partial safe-refresh mode for stale Human-write recovery, where available current records are intentionally useful and the action is never replayed.
- Validate both top-level and nested audit identities for repair, diagnosis, and browser-review workspaces before publication.
- Announce background refresh failures without hiding the report, retry automatically after a bounded delay, and provide one immediate read-only retry.
- Preserve Human-only fallback, contextual registration, every authority boundary, and the twenty-one-tool library.

## Freeform Product Round — Fail-Closed Verification-Scope Recovery

A reviewed verification matrix cannot be truthful if a transient candidate read silently becomes an empty optional scope. Treat candidate availability as a staging prerequisite rather than a permissive enhancement.

- Make the server projection identify the root audit and retained finding, with deterministic read-time fallback for older impact records.
- Reject a candidate response for another audit or finding before changing shared client state.
- Clear stale candidate choices whenever the repair intent changes or the exact scope is reloaded.
- Announce unavailable scope separately, retry only the read after a bounded delay, and offer one immediate read-only retry.
- Keep repair staging disabled until the current candidate projection is authoritative; never convert read failure into an empty reviewed selection.
- Preserve automatic required routes, Human-only fallback, Worker/local parity, all authority boundaries, and the twenty-one-tool library.

## Freeform Product Round — Authority-Bound Continuation Responses

A correctly addressed request is not enough if its returned record can be cached under another workspace. Validate the response side of every continuation before it influences mission state.

- Validate direct results, checkpoints, and aggregate verification proof against the requested audit and repair.
- Validate browser-review, diagnostic, and repair mutations against both their audit and retained record ID where one already exists.
- Validate related-route continuations against the requested parent audit and exact observed path.
- Validate verification starts against the baseline audit, retained repair, primary verification assignment, and parent checkpoint.
- Bind finding-led diagnosis and repair, rendered-review focus and check acknowledgement, and repair-policy changes to the exact requested finding, focus set, check ID, or policy mode.
- Keep delayed responses identity-checked even when a reset generation means they can no longer publish.
- Make Worker and local related-route payloads return the same parent mission checkpoint and make aggregate proof self-identifying.
- Reject mismatches before changing the active audit, checkpoint, repair, diagnosis, review, or exploration cache; preserve existing safe error propagation and never replay a mutation.

## Freeform Product Round — Checkpoint-Complete Mission Publication

Identity-bound responses can still regress the visible mission if a continuation omits its authoritative checkpoint. Make the checkpoint mandatory anywhere a completed read or accepted mutation can publish mission state.

- Require every state-changing continuation response and direct results read to carry the current bounded mission checkpoint; starting a new audit remains the only mutation exemption.
- Validate checkpoint identity and revision before publishing the returned report, review, diagnosis, repair, policy, exploration, cancellation, route, or verification record.
- Reject missing, malformed, foreign, or older checkpoints with the existing safe response boundary, leaving all previously retained cache entries untouched.
- Preserve the current mission-revision comparison, generation gate, stale-write recovery, and idempotent mutation semantics; never replay a rejected action.
- Prove that Worker and local repair, diagnosis, browser-review, and exploration reads expose the same current checkpoint.
- Preserve Human-only fallback, every authority boundary, the existing providers and Durable Objects, and the twenty-one-tool library.

## Freeform Product Round — Atomic Fresh-Read Checkpoint Handoff

A valid direct workspace read can reveal a newer mission revision than the currently retained page. Publish that checkpoint with its associated state so the inspector and next write cannot remain one turn behind.

- Atomically adopt the authoritative checkpoint with direct repair, diagnosis, browser-review, exploration, verification-candidate, and aggregate-verification reads.
- Emit one coherent shared-service publication containing both the new revision and its associated workspace state; never expose the newer record under the older checkpoint.
- Apply the existing generation gate so a delayed read cannot advance a replacement workspace after reset.
- Return the adopted checkpoint from repository fix briefs and repair workspaces so the next WebMCP mutation can supply the exact expected revision.
- Build repository fix briefs from report and verification-scope reads only when their checkpoints agree; fail with a bounded current checkpoint when the mission changes between reads.
- Preserve Human-only fallback, contextual registration, every authority boundary, Worker/local payload parity, and the twenty-one-tool library.

## Freeform Product Round — Revision-Coherent Agent Evidence Reads

Agent result projections combine the report with browser, diagnosis, repair, and exploration records. Refresh that compound view under one authoritative checkpoint before deriving priorities, receipts, or repository work.

- Add one shared coherent-results service boundary over the existing checkpoint-bracketed restoration contract; do not create another cache or state machine.
- Require the completed audit plus repair/policy, diagnosis, browser-review, and exploration snapshots to share one audit ID and mission revision before returning the report.
- Use the coherent boundary for `get_site_audit_results`, assessment receipts, repository fix briefs, and single-audit verification receipts.
- Fail closed when any required mission read is unavailable or keeps changing; retain the previously coherent state and return the bounded current checkpoint.
- Keep compatibility for isolated tool-test services that do not implement the full application service, while the production shared service always takes the coherent path.
- Preserve Human-only fallback, contextual registration, every evidence/authority boundary, and the twenty-one-tool library.

## Freeform Product Round — Automatic Cross-Revision Workspace Reconciliation

A direct workspace read can reveal an externally advanced mission before its sibling caches have been refreshed. Treat that revision crossing as a full restoration boundary so Human state and contextual WebMCP registration never observe a partial mission.

- Detect a direct completed-results, repair, diagnosis, browser-review, exploration collection/detail, verification-candidate, or aggregate-verification response whose checkpoint is newer than the retained audit.
- Reuse the existing complete-only checkpoint-bracketed refresh to reconcile the audit, repairs/policy, diagnosis, browser review, and explorations before publishing any of the newer mission.
- Publish the reconciled mission once; retain lightweight one-family publication for direct reads at the already retained revision.
- Fail with `MISSION_WORKSPACE_INCOMPLETE` and the bounded current checkpoint when any sibling record is unavailable, retaining the prior coherent mission.
- Keep reset generation gating so a late direct read cannot revive or advance a replacement workspace.
- Prove that contextual tools move directly from the old coherent subset to the new coherent subset without an intermediate registration.
- Preserve Human-only fallback, Worker/local parity, every evidence and authority boundary, and the twenty-one-tool library.

## Freeform Product Round — Atomic Compound Mission Publication

Some accepted operations carry more than one authoritative record. Retain the complete accepted response before notifying Human UI and contextual WebMCP subscribers so one logical operation cannot expose transient tool states.

- Publish repair preparation once with its updated mission and authoritative checkpoint.
- Publish related-route and verification starts once, after the parent checkpoint and child active workspace are both retained.
- Publish a verification browser contribution once, after both the review result and refreshed verification report are ready.
- Require the replay review and refreshed result to share one revision; return `MISSION_REFRESH_UNSTABLE` without changing local caches when they do not.
- Leave ordinary one-record mission mutations and the separately visible agent-activity ledger unchanged.
- Preserve Human-only fallback, Worker/local parity, every authority boundary, and the twenty-one-tool library.

## Delivery Order

- [x] **1. Finding-aware browser investigation compiler** — completed and verified locally on 30 August 2026
- [x] **2. Evidence reconciliation contract** — completed and verified locally on 30 August 2026
- [x] **3. WebMCP mission inspector** — implemented and statically verified on 30 August 2026; fresh visual/keyboard proof remains separate
- [x] **4. Fresh-session mission checkpoints** — completed and verified locally on 30 August 2026
- [x] **5. Reviewed repair impact and verification matrix** — completed and verified locally on 30 August 2026
- [x] **6. Full command-safe regression and release gate** — 193/193 tests, production build, and strict no-upload Wrangler dry run passed from application commit `3022965` on 30 August 2026
- [x] **7. Focused human assessment composer** — implemented and locally verified on 30 August 2026; fresh visual proof remains separate
- [x] **8. Human-reviewed optional verification routes** — implemented and locally verified on 30 August 2026
- [x] **9. Seamless human-to-agent takeover** — implemented and locally verified on 30 August 2026; the same audit now resumes into rendered investigation
- [x] **10. Complete Human rendered review and untouched-handoff recovery** — implemented and locally verified on 30 August 2026; person provenance, stale recovery, visible withdrawal, and Worker/local parity are covered without adding a tool
- [x] **11. Complete Human repository diagnosis and honest blocker recovery** — implemented and locally verified on 30 August 2026; the shared service now accepts complete person-attributed evidence or a resumable blocker with stale-session refresh
- [x] **12. Human mission conflict recovery across person-owned controls** — implemented and locally verified on 30 August 2026; stale writes refresh the bounded workspace, clear unsafe local authority state, and are never replayed automatically
- [x] **13. Deferred report, diagnosis, repair, verification, and mission-inspector workspaces** — implemented and locally verified on 30 August 2026; initial JavaScript fell 24.62% raw and 21.22% gzip without changing the twenty-one-tool library
- [x] **14. Focused accessibility and responsive hardening** — implemented and locally verified on 30 August 2026; 234/234 tests pass and the twenty-one-tool library is unchanged
- [x] **15. Safe fresh-agent mission handoff** — implemented and locally verified on 30 August 2026; copied orientation cannot replay mutable checkpoint input and the initial JavaScript bundle remains at 414.22 kB raw
- [x] **16. Retry-safe, cross-audit-isolated fresh-session restoration** — implemented and locally verified on 30 August 2026; failed reads retain the stable URL, mismatched responses cannot become active, cached contextual tools are absent, and retry performs only the authoritative GET
- [x] **17. Non-terminal active-status recovery** — implemented and locally verified on 30 August 2026; interrupted polling preserves authoritative job state and retries only the existing read
- [x] **18. Coherent fresh-session mission hydration** — implemented and locally verified on 30 August 2026; completed workspaces expose tools only after all audit-scoped records share revision and identity
- [x] **19. Truthful cross-page exploration recovery** — implemented and locally verified on 30 August 2026; interrupted reads preserve the retained mission and mismatched payloads fail before caching
- [x] **20. Coherent mounted-report mission refresh** — implemented and locally verified on 30 August 2026; partial background reads retain the last complete mission snapshot and expose a read-only retry
- [x] **21. Fail-closed verification-scope recovery** — implemented and locally verified on 30 August 2026; candidate reads are audit/finding-bound and repair staging waits for the exact current scope
- [x] **22. Authority-bound continuation responses** — implemented and locally verified on 30 August 2026; every retained response is identity- and intent-checked before shared state changes and Worker/local route checkpoints now agree
- [x] **23. Checkpoint-complete mission publication** — implemented and locally verified on 30 August 2026; missing or regressive checkpoints fail before shared state changes and Worker/local workspace reads expose the authoritative revision
- [x] **24. Atomic fresh-read checkpoint handoff** — implemented and locally verified on 30 August 2026; direct workspace reads publish one coherent revision and WebMCP read-to-write handoffs return that checkpoint
- [x] **25. Revision-coherent agent evidence reads** — implemented and locally verified on 30 August 2026; compound WebMCP results, receipts, and repository briefs now derive from one checkpoint-bracketed workspace
- [x] **26. Automatic cross-revision workspace reconciliation** — implemented and locally verified on 30 August 2026; every newer direct mission read reconciles all contextual caches before one shared publication
- [x] **27. Atomic compound mission publication** — implemented and locally verified on 30 August 2026; preparation, route starts, verification starts, and replay now publish one complete shared-service state
- [x] **28. Compound repair-response integrity** — implemented and locally verified on 30 August 2026; contradictory repair missions or revision stamps now fail closed before shared Human/WebMCP publication
- [ ] **29. Fresh current-candidate browser proof after explicit deployment/server authority**

Slices 1 and 2 are the highest-value core work. Slice 3 makes that intelligence legible. Slice 4 turns durability across agent sessions into a product capability. Slice 5 expands fresh proof from one target to a reviewed impact radius without becoming an arbitrary crawler. The freeform parity round makes mission-shaping and reviewed route scope first-class in Human mode; the takeover round lets a later capable agent continue that retained human work; and the complete Human rendered-review, repository-diagnosis, conflict-recovery, deferred-workspace, accessibility, fail-closed scope-recovery, authority-bound continuation, checkpoint-complete publication, atomic read-handoff, revision-coherent agent-read, cross-revision reconciliation, atomic compound-publication, and compound-response-integrity rounds ensure that collaboration remains useful, quick to enter, and structurally operable without WebMCP before release production begins.

## Full Regression Gate

After the application slices are complete:

```powershell
bun test
bun run build
bunx wrangler deploy --dry-run --strict --config wrangler.jsonc
git diff --check
git status --short
```

Record exact test counts, asset names, bundle sizes, Wrangler bindings, and the application commit in the release ledger. A successful test, build, or dry run is packaging evidence only. It is not deployment, supported-browser proof, visual QA, or live WebMCP verification.

## Explicit Non-Goals

- No embedded chatbot or generic AI assistant.
- No hidden browser automation inside Frontmend.
- No repository upload, source storage, patch storage, or absolute-path retention.
- No agent-created approval policy.
- No agent deployment or deployment attestation.
- No arbitrary crawler or unbounded route discovery.
- No scraping private/authenticated pages.
- No invented confidence percentages or merged “AI score.”
- No tool-count inflation as a judging tactic.
- No demo/video work until the core slices and fresh product evidence justify it.

## Stop Conditions

Pause and adapt the plan if any slice:

- weakens human-mode functionality when WebMCP is absent;
- allows provider text or agent observations to alter authority;
- accepts source contents, patches, secrets, private browser data, or absolute paths;
- introduces a second mission state machine that can drift from existing audit/repair records;
- lets a generic browser pass erase a specific provider failure;
- lets a blocker, missing route, missing viewport, or stale contribution unlock a receipt;
- requires starting a development/preview server, deploying, pushing, publishing a remote, or changing Cloudflare Access without explicit permission.

## Definition Of Product Completion For This Phase

This phase is complete when a natural accessibility/SEO request produces evidence-specific browser work, every retained priority explains how its evidence sources relate, the live panel explains the current agent turn and human boundary, a fresh session can safely resume the exact mission, and verification covers the reviewed impact scope without overstating incomplete evidence.

Only after those behaviours pass deterministic tests, production build, strict Wrangler dry run, and authorised fresh-browser proof should Frontmend move from core product development into final submission production.
