# Technical Spec

## Overview

Implement the PRD by extending Frontmend's existing audit job and diagnostic/repair state—not by introducing a second orchestration system.

Each root audit gains a bounded `mission` snapshot describing the structured user goal. The mission is persisted in the same Worker Durable Object state as the audit, returned in audit snapshots and completed reports, and consumed by both the React UI and WebMCP adapter. A pure shared contract derives focused priorities, mission completion, next actor, and allowed continuation from the audit report plus existing diagnostic and repair state.

The implementation adds one explicit transition from read-only assessment to repair preparation. This transition records intent but does not approve, implement, deploy, or verify anything. Existing repair policy and mission contracts remain authoritative after the transition.

Implements: `prd.md > Mission Intent`, Epics 1–8.

## Constraints And Existing Decisions

- Keep React 19, Vite 6, Bun, Cloudflare Workers, Durable Objects, and the current HTTP application service.
- Add no dependency.
- Preserve URL safety, admission budgets, audit deduplication, retries, cancellation, report schemas, repair policy, implementation receipts, deployment attestation, and verification comparison.
- Keep the complete human audit usable when `document.modelContext` is absent.
- Do not store raw prompts, repository source, absolute paths, credentials, patches, or private browser content in mission metadata.
- Do not start a server, deploy, publish a remote, or remove Cloudflare Access as part of the implementation checklist without separate authorisation.

## Stack

- **Client:** React 19.2 and `@phosphor-icons/react`, bundled by Vite 6.4.
- **Application contract:** framework-free JavaScript modules shared by React and WebMCP.
- **WebMCP:** `document.modelContext.registerTool()` with contextual registration and strict JSON schemas.
- **Server:** Cloudflare Worker plus one audit-gate Durable Object and one audit-job Durable Object per stable job ID.
- **Provider:** PageSpeed Insights/Lighthouse with bounded live-document fallback.
- **Tests:** Node's native test runner, invoked through Bun package scripts.
- **Packaging:** Vite build, Sites/Worker preparation script, and Wrangler strict dry run.

Documentation:

- [WebMCP specification](https://webmachinelearning.github.io/webmcp/)
- [Chrome WebMCP developer documentation](https://developer.chrome.com/docs/ai/webmcp)
- [Chrome WebMCP security guidance](https://developer.chrome.com/docs/ai/webmcp/secure-tools)
- [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/)
- [PageSpeed Insights API](https://developers.google.com/speed/docs/insights/v5/get-started)
- [React](https://react.dev/)
- [Bun](https://bun.sh/docs)
- [Vite](https://vite.dev/guide/)

## Architecture

### Existing architecture retained

```text
Human UI ────────┐
                 ├─ audit service ─ HTTP ─ audit job DO ─ audit provider
WebMCP tools ────┘                         │
                                          ├─ diagnostic missions
                                          ├─ repair policy + repair missions
                                          └─ verification context
```

### Intent-aware extension

```text
Structured user goal
  └─ AuditMission { intent, focusAreas, maxPriorities, requestedBy }
       ├─ persisted with existing audit job
       ├─ rendered by React mission summary
       ├─ consumed by focused result projection
       └─ gates repair-preparation transition

Audit report + AuditMission + diagnostic missions + repairs
  └─ deriveAuditMissionState()
       ├─ focused, deduplicated priorities
       ├─ evidence state per priority
       ├─ assessment completion
       ├─ next actor + exact semantic action
       └─ contextual WebMCP tool availability
```

The derived mission state is not stored independently. It is recomputed from authoritative persisted records, preventing drift between an orchestration table and the existing mission state machines.

## Audit Mission Contract

### File: `src/audit-mission-contract.js`

Create one pure shared module. It must not import React, Worker APIs, browser globals, or network code.

Exports:

- `AUDIT_FOCUS_AREAS` — `accessibility`, `seo`, `performance`, `security`, `reliability`.
- `AUDIT_MISSION_INTENTS` — `assess`, `prepare-fix`.
- `createAuditMission(input, source, now)` — strict normalisation for a new mission.
- `auditMissionSnapshot(value)` — bounded serialisable public shape.
- `auditMissionSignature(value)` — stable string used only for admission/deduplication identity.
- `prepareRepairIntent(mission, findingId, source, now)` — immutable transition with attribution.
- `focusedAuditPriorities(report, mission, diagnosticMissions)` — current focused/deduplicated projection moved out of `webmcp.js`.
- `deriveAuditMissionState({ report, mission, diagnosticMissions, repairs })` — state and next-action projection.

### Persisted mission shape

```js
{
  schemaVersion: 1,
  intent: "assess" | "prepare-fix",
  focusAreas: ["accessibility", "seo"], // zero to three unique values
  maxPriorities: 3,                     // integer one to five
  requestedBy: "human" | "agent",
  requestedAt: 1720000000000,
  repairPreparation: null | {
    findingId: "...",
    requestedBy: "human" | "agent",
    requestedAt: 1720000000000
  }
}
```

Rules:

- Default intent is `assess`.
- Human URL-only starts use broad focus `[]` and maximum three.
- Agent starts may supply focus areas and maximum priorities; raw natural-language prompts are not accepted or retained.
- `prepare-fix` may be supplied at start only when the agent is acting on an explicit repair request.
- `repairPreparation` is set only by the explicit transition and freezes the selected finding.
- Repeating the same transition is idempotent. Attempting to replace its finding fails with `REPAIR_INTENT_CONFLICT`.
- Unknown keys, duplicate/unsupported focus areas, invalid maximums, and invalid intent fail with `INVALID_INPUT`.

Implements: PRD Stories 1.1, 1.2, 3.1, 5.1.

## Derived Mission State

### Priority evidence states

Each returned priority has exactly one of:

- `measured-evidence-sufficient`
- `diagnosis-recommended`
- `diagnosis-in-progress`
- `diagnosis-contributed`
- `diagnosis-blocked`
- `unsupported-continuation`

The initial implementation can produce every state except `diagnosis-blocked` unless an existing diagnostic record contains an explicit blocked result. Do not invent blocked evidence. If no blocked-record contract exists, leave it for the later-time list rather than encoding fake completeness.

### Assessment state

```js
{
  intent: "assess",
  status: "complete" | "action-available" | "in-progress" | "awaiting-repair-preparation",
  auditComplete: true,
  assessmentComplete: false,
  requestedFocusAreas: ["accessibility", "seo"],
  priorityCount: 3,
  priorities: [...],
  nextActor: "agent" | "person" | null,
  nextAction: null | {
    tool: "open_diagnostic_mission",
    input: { findingId: "..." },
    reason: "..."
  },
  authority: {
    mayDiagnose: true,
    mayPrepareRepair: false,
    mayDeploy: false,
    mayAttestDeployment: false
  }
}
```

Derivation rules:

1. Deduplicate by measured provider rule while retaining all strategies and occurrence count.
2. Order by severity, occurrence count, then stable source order.
3. Use the mission's persisted focus and maximum by default.
4. A supported diagnostic priority with no mission makes assessment `action-available` and recommends `open_diagnostic_mission`.
5. An awaiting diagnostic mission makes assessment `in-progress` and recommends `submit_runtime_diagnosis` with its mission ID.
6. A contributed diagnosis satisfies the read-only assessment requirement for that priority.
7. A non-diagnostic priority has sufficient measured evidence; its repository fix brief is optional evidence, not required to finish Assess.
8. With zero matching findings, assessment completes honestly with scores and zero priorities.
9. In Assess, repair preparation is unavailable as an allowed action. The projection may state that the person can request a fix after reviewing the assessment.
10. In Prepare fix, the existing repair mission state determines the next actor and action after the selected finding is frozen.

Implements: PRD Stories 2.2, 3.1, 3.2, 8.1.

## HTTP Contract

### Start audit

`POST /api/audits`

Request:

```json
{
  "url": "https://example.com/",
  "source": "agent",
  "mission": {
    "intent": "assess",
    "focusAreas": ["accessibility", "seo"],
    "maxPriorities": 3
  }
}
```

Changes:

- `worker/index.js` and `worker/local-runtime.js` validate and normalise mission input with the shared contract.
- The admission operation key incorporates the mission signature. Same URL plus same mission retains existing deduplication; a materially different structured goal creates an attributable new job instead of overwriting the first mission.
- The job `/start` payload stores the mission alongside the existing URL/source/verification/exploration fields.
- Retry preserves the original mission.
- Related-page and verification jobs retain existing semantics. They may carry a bounded inherited mission reference only if required for display; they must not silently change the root intent.

Response/audit snapshot adds:

```json
{
  "mission": {
    "schemaVersion": 1,
    "intent": "assess",
    "focusAreas": ["accessibility", "seo"],
    "maxPriorities": 3,
    "requestedBy": "agent",
    "requestedAt": 1720000000000,
    "repairPreparation": null
  }
}
```

### Prepare repair intent

`POST /api/audits/:auditId/mission/prepare-repair`

Request:

```json
{
  "findingId": "exact-completed-report-finding-id",
  "source": "human"
}
```

Behaviour:

- Requires a completed root audit and an exact retained finding.
- Records the intent transition in the existing job state.
- Does not create a repair draft, approve work, consume delegated allowance, accept code, or mutate the target.
- Is idempotent for the same finding and rejects an attempt to swap findings.
- Returns the updated audit mission and derived mission state.

The Worker and local runtime must implement the same route and validation.

Implements: PRD Stories 1.2, 5.1.

## Application Service

### File: `src/audit-service.js`

Transport changes:

- `start({ url, source, mission })`
- `prepareRepair(auditId, findingId, source)`

Service changes:

- `startAudit(input)` normalises URL and passes bounded mission fields.
- `prepareRepair(auditId, findingId, source)` validates identifiers, calls the transport, remembers the updated audit, and emits to UI/WebMCP subscribers.
- `getAuditMissionState(auditId)` derives state from the remembered audit report, diagnostic missions, and repairs.
- `getActiveAuditMissionState()` is a convenience for contextual registration/UI only.

Do not add a separate mission cache. The remembered audit plus existing diagnostic/repair caches are sufficient.

Implements: all PRD epics through the shared adapter boundary.

## WebMCP Tools

### `start_site_audit` changes

Add optional fields:

```js
intent: "assess" | "prepare-fix"       // default assess
focusAreas: string[]                    // one to three when supplied
maxPriorities: integer                  // one to five, default three
```

Update the description so natural audit requests use `assess`, pass the person's focus, navigate only after the call, poll, then continue until `assessmentComplete` is true or a named blocker prevents it.

Return the mission snapshot, workspace path, and a concise next action to poll.

### `get_site_audit_results` changes

- Use persisted mission focus and maximum when optional overrides are absent.
- Keep optional focus/max overrides only for backward-compatible read-only re-filtering; label them `resultProjection` and never rewrite persisted mission intent.
- Return raw bounded report evidence plus `missionState` from the shared derivation.
- Replace the loose `recommendedNextAction` with the typed mission state's exact tool and input while retaining a compatibility alias for one release if tests/documentation require it.
- Explicitly state that job completion does not equal assessment completion when diagnosis remains.

### New `prepare_site_repair` tool

Purpose: record that the person explicitly asked to move one assessed finding into repair preparation.

Input:

```js
{
  auditId?: string,
  findingId: string
}
```

Rules:

- Description must say to call only after an explicit person request to prepare/fix this finding.
- It records intent only and is not approval.
- It does not accept plan text, files, checks, code, or risk.
- It returns updated mission state and names `stage_site_repair` as the next possible agent action.

### Contextual registration changes

- Completed Assess mission: results, applicable read-only evidence/exploration tools, diagnostics, and `prepare_site_repair`; do not expose `stage_site_repair` until repair preparation is recorded.
- Awaiting diagnosis: expose `submit_runtime_diagnosis` and keep results.
- Prepare fix: expose existing staging/workspace actions according to diagnostic readiness and repair state.
- Existing revisions, implementation receipts, verification receipts, and verification start continue to follow current repair state.
- A verification audit's existing receipt tools remain available regardless of root mission intent.

Tool count becomes seventeen. Tests and visible capability copy must use the contextual subset, not advertise all seventeen as always available.

Implements: PRD Stories 1.1, 1.2, 3.1, 3.2, 5.1, 8.2.

## Human UI

### Mission summary

Add `AuditMissionSummary` near the top of progress and completed workspaces.

It displays:

- `Assessment` or `Preparing a fix`
- Requested focus areas, or `Full frontend audit`
- Current state in plain language
- Next actor and next valid action
- A concise boundary: assessment is read-only; agent prepares repository evidence; the person controls deployment

The summary must be a semantic labelled section and must remain usable at 390 px.

### Focused priority presentation

The existing evidence queue remains the complete bounded finding list. Add a mission-priority summary above it or inside the mission section rather than hiding non-focused findings.

- Show ranks and affected strategies for the mission's top priorities.
- Show diagnostic evidence state.
- Selecting a priority selects the underlying finding in the existing workspace.
- Do not duplicate full finding-detail content.

### Prepare repair transition

In Assess mode, show `Prepare a fix` for the selected priority after the assessment evidence is available.

- The button calls the same application service used by WebMCP.
- It explains that this records intent but does not approve or deploy anything.
- After success, mission summary changes to Prepare fix and contextual tools re-register.
- Existing RepairPolicyControl remains the authority mechanism and must not appear to be toggled by this action.

### Existing mission rail

Do not replace `RepairMissionRail`. The new audit mission summary provides the outer goal; once a repair exists, the existing rail remains the detailed authority/progress component.

Implements: PRD Stories 1.1, 1.2, 3.1, 5.1, 8.1.

## File Structure

```text
src/
  audit-mission-contract.js       New pure goal, priority, and continuation contract
  audit-service.js                Extend HTTP/service adapters with mission data and transition
  webmcp.js                       Intent-aware schemas, results, new transition tool, registration
  App.jsx                         Mission summary, priorities, human prepare-fix action
  styles.css                      Responsive mission-summary and priority states
  diagnostic-contract.js          Reused unchanged unless snapshot helper is needed
  repair-contract.js              Reused as authoritative repair/verification state

worker/
  index.js                        Persist mission in DO; route prepare-repair transition
  local-runtime.js                Mirror production route/state for tests and Vite integration

tests/
  audit-mission-contract.test.mjs New pure contract/state derivation tests
  audit-service.test.mjs          Transport/service propagation and transition tests
  sites-worker.test.mjs           Durable API parity, dedupe signature, persistence, gating
  webmcp.test.mjs                 Schemas, mission outputs, contextual tool lifecycle
  diagnostic-contract.test.mjs    Existing diagnosis behaviour regression coverage
  repair-contract.test.mjs        Existing authority and verification regression coverage

README.md                         Explain assessment vs repair and natural prompt
DEMO_SCRIPT.md                    Update under-three-minute judge flow after implementation proof
RELEASE_CANDIDATE.md              Record only verified build/browser/deployment evidence
docs/hackathon-build/             Planning/checklist/build journal
```

## Data Flow

### Natural assessment lifecycle

1. Agent interprets the person's prompt into URL, `intent: assess`, focus areas, and maximum priorities.
2. `start_site_audit` validates schema and calls `auditService.startAudit`.
3. Service normalises URL and forwards the structured mission to `POST /api/audits`.
4. Worker normalises the mission, includes its signature in admission identity, and persists it in the audit job DO.
5. Audit provider runs unchanged. Progress snapshots carry the mission for the shared UI.
6. Completed report freezes the mission snapshot for exports and restoration.
7. UI and `get_site_audit_results` call the same pure mission derivation with report + current diagnostic/repair snapshots.
8. If diagnosis is recommended, the WebMCP result names `open_diagnostic_mission` with exact input and `assessmentComplete: false`.
9. Agent opens and contributes diagnosis through existing services.
10. Re-derived state becomes complete for Assess when required supported diagnosis has been contributed.

### Repair preparation lifecycle

1. Person explicitly asks to fix the selected assessed priority in chat or the visible UI.
2. WebMCP `prepare_site_repair` or human button calls the same service endpoint.
3. Audit job freezes the finding-scoped repair intent and attribution.
4. Mission state changes to Prepare fix; contextual tools now expose `stage_site_repair` when existing diagnostic readiness allows it.
5. Existing repair contract owns proposal, review/delegation, implementation, deployment attestation, and verification unchanged.

### Reload lifecycle

1. Stable `/audits/:id` workspace loads the audit snapshot.
2. Snapshot restores mission alongside job/report.
3. UI loads diagnostics and repairs through existing endpoints.
4. Mission state re-derives from authoritative snapshots; no browser-only mission state is required.

## PRD Epic Mapping

### Audit mission contract

Implements: Epics 1, 2, 3, 5, 8.

### Existing diagnostic contract

Implements: Epics 3 and 4. Extended only through mission-state projection.

### Existing repair contract

Implements: Epics 5, 6, and 7. Remains authoritative.

### React mission summary and priorities

Implements: Epics 1, 2, 3, 5, and 8.

### WebMCP schemas and contextual lifecycle

Implements: Epics 1, 3, 4, 5, 7, and 8.

### Worker/local-runtime persistence

Implements: cross-session acceptance criteria in Epics 1–7.

### Release verification and docs

Implements: Epic 8 and Submission Proof Points.

## External APIs And Dependencies

- No new runtime API or package.
- PageSpeed provider invocation remains unchanged.
- Mission data is internal bounded metadata, not sent to PageSpeed.
- Cloudflare Access configuration is external release state and must not be encoded into the application.
- WebMCP remains progressive enhancement through `document.modelContext`.

## AI Usage

- Frontmend does not call an LLM at runtime. Its runtime produces deterministic audit, mission, policy, and verification contracts.
- A WebMCP-capable coding agent such as Codex is the external reasoning and repository actor. It discovers semantic tools, inspects the repository in its own authorised environment, and contributes bounded evidence back to Frontmend.
- The agent's diagnosis and implementation receipt remain explicitly agent-reported; Frontmend never promotes them into provider measurement, independent check proof, deployment proof, or resolution proof.
- Codex is also the development collaborator for this hackathon work: planning, implementation, tests, release evidence, README, and submission drafting. Submission copy must describe that use accurately without implying the application itself embeds Codex.

## Error Strategy

### Invalid structured mission

Return `INVALID_INPUT` with the exact field constraint. Do not silently drop unsupported focus or coerce repair intent.

### Conflicting deduplication

Mission signature participates in the admission key. Do not reuse and overwrite an active job created for a different goal.

### Invalid repair transition

- Incomplete audit: `AUDIT_NOT_READY`.
- Unknown/non-retained finding: `FINDING_NOT_FOUND`.
- Different finding already frozen: `REPAIR_INTENT_CONFLICT`.
- Same finding repeated: return current state successfully.

### Diagnosis unavailable

Retain measured evidence and show assessment incomplete/action unavailable only when a real blocked state is recorded. Do not fabricate a blocker or mark diagnosis complete.

### Stale UI or agent action

Server state wins. Return actionable current-state errors and leave newer state unchanged.

### Retry

Retry carries the original mission. A user who wants a different focus starts an attributable new mission rather than rewriting the failed attempt's goal.

## Security And Privacy

- Strict allowlists and `additionalProperties: false` at WebMCP and HTTP boundaries.
- No raw prompt storage.
- Focus values are enums; maximum is bounded.
- Finding IDs must exist in the retained completed report before intent transition.
- Mission attribution is provenance, not authentication or proof of human identity.
- Existing same-origin write checks remain in place.
- Activity ledger still records only tool name/status/time.
- Existing repository-relative path and source-content rejection remains unchanged.
- WebMCP cannot approve review-mode work, alter repair policy, deploy, or attest deployment.

## Tests And Verification

### Pure mission contract

- Defaults and strict validation.
- Stable snapshot/signature.
- Same/different goal signatures.
- Focused deduplication across viewports.
- Severity/occurrence ordering.
- Zero matching findings.
- Diagnosis recommended, in progress, and contributed.
- Assess versus Prepare fix authority projection.
- Idempotent and conflicting repair-intent transitions.

### Service and HTTP

- Mission transmitted at start and restored with job snapshots.
- Same URL/same mission dedupes; same URL/different mission does not overwrite.
- Retry preserves mission.
- Worker and local runtime expose identical prepare-repair behaviour.
- Finding and state validation fail closed.

### WebMCP

- Natural assessment input schema and output.
- Persisted focus used when result call passes `{}`.
- Read-only projection overrides do not mutate mission.
- Exact continuation tool/input for diagnostic priority.
- `stage_site_repair` absent before repair preparation and present afterward when eligible.
- New transition cannot approve, consume policy, deploy, or attest.
- Dynamic registration re-runs after mission transition.
- Existing 16-tool behaviours retain regression coverage; total library is 17.

### UI/static QA

- Assessment/focus visible during progress and result.
- Mission summary and priorities agree with structured WebMCP output.
- Prepare-fix action updates state and capability copy.
- 390 px layout has no horizontal overflow.
- Keyboard focus, reduced motion, dialogs, sharing, and human-only fallback retain existing behaviour.

### Allowed release commands

```powershell
bun run test
bun run build
bunx wrangler deploy --dry-run --strict
```

Do not start `bun dev`, `bun start`, a preview server, or Wrangler dev without explicit permission. Do not deploy without explicit permission.

## Fresh-Session Evaluation

### ChatGPT

Use a fresh session with the live app and an accessible target repository/deployment. The natural prompt must:

1. Discover and start Frontmend in Assess mode with accessibility + SEO focus.
2. Poll the actual job and read persisted focus using an empty result call where possible.
3. Return no more than three priorities.
4. Continue into a supported read-only diagnostic mission when one exists.
5. Attach bounded browser and repository evidence without staging a repair.
6. Finish the assessment or name a real blocker.

### Chrome

With the supported WebMCP flag enabled in Chrome 149+, confirm the same contextual discovery and visible mission state. Record exact version, flag, tool subset, audit ID, mission/diagnostic IDs, UI state, and console output.

The eval fails if the agent stops after Lighthouse while `missionState.assessmentComplete` is false and a valid next diagnostic action exists.

## Demo And Submission Flow

### Under-three-minute video

- **0:00–0:15:** Natural prompt and immediate WebMCP discovery/start.
- **0:15–0:40:** Stable workspace, shared progress, and contextual tools.
- **0:40–1:10:** Focused priorities; explicitly show measurement complete versus assessment incomplete.
- **1:10–1:45:** Agent browser/repository diagnosis appears in the human workspace with source attribution.
- **1:45–2:15:** Person requests repair preparation; show review or bounded auto policy without claiming deployment.
- **2:15–2:45:** Implementation receipt, person-only deployment gate, and genuine fresh verification receipt from a recorded run.
- **2:45–3:00:** One-sentence value: the person and agent share one durable protocol from public evidence to proof.

### Judge self-test

- README starts with the natural prompt and a short explanation of Assess versus Prepare fix.
- Public live URL opens without temporary private access, or tested judge credentials are present in private instructions.
- Public repository shows Apache-2.0 and challenge-period history.
- Exact fresh ChatGPT and Chrome steps are concise and reproducible.

## Risks And Verification

### Risk: a second state machine drifts from repairs

Mitigation: store only structured goal and explicit repair-intent transition; derive everything else from existing diagnostic/repair state.

### Risk: natural prompt still stops after results

Mitigation: typed `assessmentComplete`, exact next tool/input, tool-description instruction, and a fresh-session eval that fails on premature stopping.

### Risk: intent metadata is mistaken for security authentication

Mitigation: describe it as attributable structured provenance. Existing human UI approval, delegated grant, and deployment gates remain the authority controls.

### Risk: same-URL dedupe overwrites a different goal

Mitigation: include mission signature in admission identity.

### Risk: broader scope threatens deadline

Mitigation: no new provider, database, dependency, rule catalogue, or agent runtime. Implement contract → persistence → tools → UI → proof in that order.

### Risk: demo depends on an unpredictable target finding

Mitigation: select a genuine accessible target/run before recording and preserve exact IDs/evidence. Do not add a contrived product path or fake fixture to the live demo.

## Architecture Self-Review

1. **Why persist mission on the audit rather than create a Mission Durable Object?** The audit is already the durable shared workspace and all downstream records key from its ID. A second object adds joins, failure modes, and time cost without improving the current submission.
2. **Why add an explicit prepare transition instead of letting `stage_site_repair` imply intent?** It lets the human UI and contextual tool set show the boundary before a proposal, and proves auto mode does not silently broaden an audit request.
3. **Why not require repository diagnosis for every finding?** Some rules already have sufficient measured evidence, and unsupported diagnosis would encourage invented source claims. The contract requires it only for explicitly supported diagnostic symptoms.

## Checklist Anchors

The build checklist must sequence these independently committable slices:

1. Pure mission contract and tests.
2. Worker/local-runtime persistence, admission identity, and service transport.
3. Intent-aware WebMCP schemas, result state, transition tool, and contextual registration.
4. Human mission summary, focused priorities, and prepare-fix action.
5. Documentation/evals plus full allowed release verification.

Each item must name exact tests and stop if existing repair/deployment authority regresses.
