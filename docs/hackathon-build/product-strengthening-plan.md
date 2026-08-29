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
  nextAction: {
    tool: "...",
    input: { "...": "..." },
    reason: "...",
    completionCriteria: "..."
  },
  retainedEvidenceSummary: ["..."],
  authorityBoundary: "..."
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

## Delivery Order

- [x] **1. Finding-aware browser investigation compiler** — completed and verified locally on 30 August 2026
- [ ] **2. Evidence reconciliation contract**
- [ ] **3. WebMCP mission inspector**
- [ ] **4. Fresh-session mission checkpoints**
- [ ] **5. Reviewed repair impact and verification matrix**
- [ ] **6. Full command-safe regression and release gate**
- [ ] **7. Fresh current-candidate browser proof after explicit deployment/server authority**

Slices 1 and 2 are the highest-value core work. Slice 3 makes that intelligence legible. Slice 4 turns durability across agent sessions into a product capability. Slice 5 expands fresh proof from one target to a reviewed impact radius without becoming an arbitrary crawler.

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
