# Product Requirements Document

## Product Summary

Frontmend is a shared frontend-quality workspace for a person and their repository-aware coding agent. It begins with a live public-site audit, but its value is the durable mission around that evidence: focus the result on the user's goal, distinguish measurement from diagnosis, attach browser and repository ownership evidence, prepare a bounded repair only when requested, preserve human authority, and verify the deployed result with a fresh comparable audit.

The product must make this collaboration obvious from one natural request. A judge should not need to know Frontmend's tool names or manually instruct an agent through a hidden sequence.

## Target Users

### Repository-aware developer

Uses Codex or another capable coding agent inside the site's repository. Wants a concise, defensible answer about what matters, where the problem is likely owned, and what should happen next.

### Site owner or technical decision-maker

Owns repair policy and deployment. Wants to see the same evidence and plan as the agent, understand which claims came from which actor, and prevent an agent from approving or deploying work without authority.

### Hackathon judge

Has limited attention. Needs to see a coherent product, meaningful WebMCP usage, and a credible real-world workflow within the first successful run and the first moments of the demo.

## Product Principles

1. **Natural intent first.** People express a goal; they do not recite Frontmend's tool sequence.
2. **Assessment is not repair.** “Audit” permits measurement and read-only diagnosis, not repository mutation or repair staging.
3. **Shared state, separate authority.** Human UI and WebMCP expose the same mission, while actor permissions remain explicit.
4. **Evidence keeps its source.** Lighthouse, document inspection, agent observations, repository ownership, implementation receipts, deployment attestation, and verification never collapse into one unsupported claim.
5. **Contextual tools are product behaviour.** Agents see only actions valid for the visible mission state.
6. **Auto mode is bounded approval, not autonomy by implication.** A prior grant never creates repair intent, expands risk, authorises deployment, or attests success.
7. **Honest partial success is useful.** Missing viewports, unavailable browser reproduction, or absent repository evidence remain visible without discarding valid evidence.

## Mission Intent

Every agent-started mission has an explicit intent:

- **Assess** — the default for prompts such as “audit my site,” “find accessibility issues,” or “tell me what to fix first.” It permits public measurement, focused prioritisation, diagnostic mission creation, browser reproduction, and read-only repository ownership evidence. It does not permit repair staging or implementation reporting.
- **Prepare fix** — used only when the person explicitly asks to fix, prepare a fix, or continue an assessed finding into remediation. It permits a bounded proposal to enter the existing review or delegated-auto policy.

Changing from Assess to Prepare fix must be visible in the human workspace and attributable to the person's request. A previously enabled delegated-auto policy must not perform that change.

## Core User Journey

1. The person opens Frontmend or a fresh agent session and supplies a public URL plus a natural frontend-quality goal.
2. The visible workspace shows the target, requested focus areas, and mission intent in plain language.
3. Frontmend runs a real asynchronous audit. Human and agent views show the same attempt, progress, cancellation state, evidence mode, and eventual result.
4. Results return no more than the requested priority count and deduplicate the same rule across viewports. Each priority states whether measured evidence is already sufficient, diagnosis is recommended, or no supported continuation exists.
5. In Assess mode, an agent may continue a supported priority into a diagnostic mission, contribute bounded browser observations and repository-relative ownership, and return a higher-confidence assessment. It may not stage a repair.
6. If the person explicitly requests remediation, the mission visibly enters Prepare fix. The agent may submit a bounded repository plan for review or eligible delegated authorisation.
7. After authorisation, the repository-aware agent performs work outside Frontmend and records only bounded implementation evidence. Failed or unrun checks remain visible attention states.
8. The site owner deploys through their normal workflow and explicitly attests that the reviewed change is live.
9. Frontmend re-audits and reports exact-rule resolution, persistence, or inconclusive evidence. Whole-report deltas appear only when comparable.

## Epics And User Stories

### Epic 1: Start from a natural quality goal

#### Story 1.1 — Focused assessment request

As a developer, I want to ask Frontmend to audit accessibility and SEO in ordinary language so that I receive relevant evidence without learning tool syntax.

Acceptance criteria:

- A capable agent can map the natural request to the public URL, Assess intent, requested focus areas, and a bounded maximum priority count.
- The stable workspace visibly names the target, “Assessment,” and the requested focus areas.
- When no focus is supplied through the human UI, Frontmend retains its existing broad audit behaviour and does not invent a narrower request.
- Reopening the workspace restores the mission goal alongside the durable audit state.
- Repeating the same active request follows existing deduplication and attempt rules rather than silently creating unrelated missions.

#### Story 1.2 — Intent cannot be inferred upward

As a site owner, I want “audit” to remain read-only so that an agent cannot interpret curiosity as permission to prepare or execute changes.

Acceptance criteria:

- Assess mode does not expose repair-staging or implementation-reporting actions.
- A response may recommend asking the person whether they want a fix prepared, but it must not claim permission was granted.
- A visible delegated-auto grant does not change Assess intent and is not consumed during measurement or diagnosis.
- Prepare fix becomes active only after an attributable person request and appears in the workspace before a proposal can be submitted.

### Epic 2: Run and understand real evidence

#### Story 2.1 — Shared asynchronous progress

As a person watching an agent-run audit, I want the page to show the same live job so that WebMCP does not feel like a hidden backend.

Acceptance criteria:

- Starting through WebMCP returns a stable workspace path without unexpectedly navigating the page.
- On the running workspace, both adapters expose progress and safe cancellation for the same attempt.
- The visible activity ledger records bounded tool lifecycle events without raw URL, inputs, prompts, source, patches, or secrets.
- Cancellation, provider failure, retry, and partial viewport completion remain explicit terminal or recoverable states.

#### Story 2.2 — Focused priorities instead of a Lighthouse dump

As a developer, I want at most three deduplicated priorities for my requested areas so that I can act on the most important evidence first.

Acceptance criteria:

- Results honour supported requested focus areas and a bounded priority maximum.
- The same failed rule across mobile and desktop appears once with both occurrences retained.
- The result preserves category scores and explicit evidence provenance.
- The result states the complete supported failure total, retained detail count, and omitted count independently.
- When no matching finding exists, Frontmend says so and does not substitute unrelated issues.

### Epic 3: Know whether the assessment is actually complete

#### Story 3.1 — Mission state, not just job state

As an agent, I want to know whether measurement completed the user's goal or whether a supported diagnostic step remains so that I do not stop at a misleading score summary.

Acceptance criteria:

- Results separately state audit-job completion and assessment-mission completion.
- Each retained priority has one clear evidence state: sufficient measured evidence, diagnosis recommended, diagnosis in progress, diagnosis contributed, blocked, or no supported continuation.
- The response identifies the next actor and one valid next action when continuation exists.
- Continuation guidance contains the stable identifiers required for that action and never asks the agent to guess from display text.
- For an agent-started accessibility or SEO mission, provider evidence alone never completes the assessment; the ordered browser review must complete first. A repository diagnostic mission is still conditional on the resulting priorities.

#### Story 3.2 — Supported diagnosis continues naturally

As a repository-aware coding agent, I want Frontmend to direct me into browser and repository investigation for diagnostic symptoms so that my answer is more useful than automated Lighthouse output.

Acceptance criteria:

- Console-error, contrast, and main-thread-blocking evidence can recommend the existing diagnostic mission path.
- Opening a diagnostic mission is visible in the human workspace and does not imply repair permission.
- The diagnostic mission names the browser observation, repository ownership, and verification questions that remain.
- Once bounded diagnosis is contributed, the priority and mission show its separate agent/person attribution.
- The agent can finish an Assess mission with diagnosis and repository ownership without creating a repair proposal.

### Epic 4: Contribute trustworthy diagnosis

#### Story 4.0 — Ordered rendered-browser review

As a developer, I want Frontmend to direct the coding agent through a small rendered-browser investigation so that a natural accessibility/SEO request produces evidence beyond automated provider output.

Acceptance criteria:

- Agent-started accessibility or SEO assessments require a persisted browser review after provider measurement, including zero-provider-finding runs.
- Frontmend returns one exact, ordered, non-destructive check at a time rather than one large free-form instruction.
- Each check records `passed`, `issue`, or `blocked` with concrete observations; issue outcomes include no more than three bounded structured findings.
- Browser findings remain agent-observed, enter the ranked priority queue, and can use the existing diagnosis/repair/verification path.
- An allowed blocker keeps the same check resumable and leaves assessment receipt and repair staging unavailable.
- The product calls this a bounded rendered-browser review, not a complete manual, screen-reader, or expert SEO audit.

#### Story 4.1 — Browser reproduction

As a developer, I want the agent's reproduction observations recorded separately from Lighthouse so that measured evidence is not overwritten by interpretation.

Acceptance criteria:

- Browser observations are bounded, plain, and labelled as agent- or person-reported.
- An observation cannot claim the public issue is resolved; only fresh verification may do that.
- Missing access, inability to reproduce, or a different runtime outcome can be recorded as a blocker or conflicting observation.
- The visible workspace shows both provider evidence and contributed diagnosis without merging their provenance.

#### Story 4.2 — Repository ownership without source upload

As a repository-aware agent, I want to attach relative ownership hints and planned checks so that the person can review a credible source-level handoff without giving Frontmend the repository.

Acceptance criteria:

- Repository evidence accepts only bounded repository-relative paths, ownership summary, and planned checks.
- Absolute paths, source contents, credentials, environment values, and arbitrary patches are rejected or excluded.
- The workspace makes clear that Frontmend did not inspect or receive repository source.
- If no credible repository owner is found, the assessment remains useful and names that limitation.

### Epic 5: Move into remediation only when asked

#### Story 5.1 — Person-requested transition

As a site owner, I want to explicitly request a fix after reading the assessment so that repair intent is visible and attributable.

Acceptance criteria:

- The UI provides a plain-language transition from assessed priority to Prepare fix.
- The agent may also report that the person requested remediation, but the workspace must retain that attribution and must not derive it from auto mode alone.
- The selected finding, diagnosis, repository ownership, and requested acceptance criteria carry into the proposal context.
- A second finding cannot silently replace the selected repair scope.

#### Story 5.2 — Review or bounded delegated authorisation

As a person, I want either explicit review or a narrow prior auto policy so that low-risk work can move quickly without granting open-ended control.

Acceptance criteria:

- Review mode keeps approval in the visible human UI and absent from WebMCP.
- Delegated auto mode remains limited to the existing bounded count, agent-authored low-risk HTML/CSS work, repository files, and planned checks.
- JavaScript, headers, configuration, medium/high risk, missing repository plans, deployment, and deployment attestation remain gated.
- Every delegated decision shows the prior human grant and remaining allowance.
- Ineligible work returns to review without weakening or expanding the policy.

### Epic 6: Preserve implementation and deployment truth

#### Story 6.1 — Repository implementation receipt

As a person reviewing the mission, I want to see what the coding agent reports it changed and checked so that implementation history is accountable but not overstated.

Acceptance criteria:

- Only an authorised repair accepts an implementation receipt.
- The receipt contains bounded relative filenames, check outcomes, a short summary, and optional Git object identifier.
- All-passed checks advance the mission; failed or unrun checks remain an attention state with a corrective next action.
- Later receipts retain bounded earlier failures rather than erasing them.
- The UI calls this agent-reported evidence, not independent proof that code or deployment succeeded.

#### Story 6.2 — Human-only deployment handoff

As the site owner, I want deployment to remain my explicit action so that Frontmend cannot claim a repository change reached production without me.

Acceptance criteria:

- Neither Assess nor Prepare fix allows WebMCP to deploy or attest deployment.
- Verification remains unavailable until the person confirms the reviewed change was deployed.
- The attestation names the repair and appears in the visible mission state.
- A premature verification attempt returns an actionable deployment-not-attested result and leaves state unchanged.

### Epic 7: Verify the exact result

#### Story 7.1 — Fresh rule-level proof

As a developer, I want a new public audit compared with the frozen baseline so that “fixed” means the original evidence was actually re-measured.

Acceptance criteria:

- Verification creates a fresh audit tied to the authorised repair and deployment attestation.
- Resolution requires every captured occurrence of the exact original rule to pass explicitly.
- A sibling viewport failure or missing comparison prevents a resolved result.
- The result is one of resolved, still present, or inconclusive.
- Rule comparability remains separate from summary metric comparability.

#### Story 7.2 — Portable proof receipt

As a person or agent, I want the result in the visible workspace, structured WebMCP output, and bounded Markdown so that the same truth can support review and submission evidence.

Acceptance criteria:

- The receipt identifies baseline and fresh audit attempts, evidence strategies, exact-rule outcomes, and lineage.
- Metric deltas appear only when coverage and evidence basis are comparable.
- The frozen implementation receipt and its agent-reported boundary are retained.
- Exports escape provider text and expose no secret, source, prompt, or absolute-path content.

### Epic 8: Make the WebMCP differentiation immediately legible

#### Story 8.1 — Human-visible mission rail

As a judge, I want to see what the person, agent, site owner, and Frontmend each own so that the innovation is understandable without an architecture lecture.

Acceptance criteria:

- The completed workspace shows the mission goal and current phase before secondary detail.
- It names the next actor, permitted action, and blocked authority in plain language.
- Measurement, diagnosis, repair, implementation, deployment, and verification appear as one coherent journey even though different actors own them.
- Contextual WebMCP status explains why the available tool set changed.

#### Story 8.2 — Fresh-session natural-prompt success

As a judge, I want an ordinary prompt to exercise Frontmend correctly so that the demo does not depend on memorised tool choreography.

Acceptance criteria:

- In a fresh ChatGPT session, the natural accessibility/SEO prompt discovers Frontmend, starts a real assessment, waits for provider completion, and opens the required rendered-browser review.
- The agent performs each exact check with real browser controls, records direct observations or an honest blocker, and re-reads the combined priorities.
- When a supported diagnostic priority is present and repository access is available, the agent continues into read-only diagnosis before declaring the assessment complete.
- In supported Chrome WebMCP, the same contextual tools and visible mission state are discoverable.
- The verification script records exact prompts, tool lifecycle, visible state, result identifiers, and any limitations.
- A run that stops after provider measurement is recorded as a failed mission-continuity eval, even if the audit job itself succeeded.

## Edge Cases

### Intent and authority

- The person says “audit” while delegated auto mode is enabled: remain in Assess and consume no grant.
- The person says “fix it” before evidence completes: retain the requested future intent, but do not stage a proposal until a supported finding and bounded plan exist.
- The agent attempts repair staging in Assess: reject with the exact person-controlled transition required.
- The person changes focus after measurement: create an attributable new request or re-filter supported retained evidence; never rewrite the original goal silently.

### Evidence and diagnosis

- No provider findings match the requested focus: finish provider reporting honestly with zero provider priorities, then run the required browser review before deciding whether the assessment has zero combined priorities.
- A diagnostic rule is present but browser access is unavailable: retain the measured priority and mark diagnosis blocked, not complete.
- Browser observation conflicts with Lighthouse: show both sources and require fresh verification for resolution claims.
- Repository access points at a different project: do not accept guessed ownership as fact.
- Multiple viewports share a rule: one priority retains every occurrence and acceptance criterion.

### Persistence and concurrency

- The browser reloads or a fresh agent session opens the stable workspace: restore goal, evidence, mission state, and attribution.
- Human and agent act concurrently: invalid stale actions fail without erasing newer state.
- An audit is cancelled or retried: the mission names the current attempt and preserves prior terminal evidence where already supported.
- The same low-risk auto grant is nearly exhausted: the visible remaining count must be authoritative before the next proposal.

### Verification and release

- The site owner attests deployment but the page is unchanged: fresh verification reports still present.
- Evidence coverage changes between runs: exact supported rule proof may remain possible while whole-report deltas are withheld.
- Temporary Cloudflare Access remains enabled: the release is blocked unless judges receive tested access.
- A local build or Wrangler dry run passes: release documentation must not call that deployment or supported-browser proof.

## What We Are Building Now

- Explicit assessment versus prepare-fix intent.
- Durable focus/goal visibility shared by human UI and WebMCP.
- Structured mission-completion and per-priority continuation states.
- Ordered agent-contributed rendered-browser review with separately attributed browser findings.
- Read-only diagnostic continuation for the natural accessibility/SEO prompt.
- Clear transition from assessment into person-requested remediation.
- Judge-legible mission/actor presentation using the existing state machine and activity ledger.
- Contract tests plus fresh ChatGPT and Chrome mission-continuity verification.
- Release and submission evidence aligned with the actual shipped behaviour.

## What We Would Add With More Time

- More diagnostic rule families after the mission contract proves useful.
- Verified-domain browser capture for authenticated or local environments.
- Team roles and organisation policy beyond the current single-person authority model.
- Optional Git hosting integrations that preserve the same source-safe boundary.
- Longer-lived mission analytics and evaluation dashboards.
- Additional agent/client compatibility receipts beyond ChatGPT and supported Chrome.

## Non-Goals

- No autonomous repository editing inside Frontmend; the coding agent already has the appropriate repository environment.
- No autonomous deployment or machine-generated deployment attestation.
- No agent-created or agent-expanded permission grants.
- No promise to diagnose unsupported Lighthouse findings beyond the evidence available.
- No full-site crawler, authenticated browsing proxy, or private-network access.
- No requirement that a person use WebMCP; the complete human audit experience remains functional without it.

## Submission Proof Points

1. One natural prompt starts an intent-aware assessment and creates a visible shared mission.
2. Contextual WebMCP tools change with real durable state rather than exposing a static tool catalogue.
3. Frontmend orchestrates the agent through exact rendered-browser checks; browser-only issues remain separately attributed and actionable.
4. Assess remains read-only; repair intent and human authority are visible and testable.
5. Bounded auto mode accelerates eligible work without authorising deployment or broadening intent.
6. Implementation, deployment, and verification each retain their real owner and evidence boundary.
7. Fresh verification produces exact-rule proof rather than a generic before/after score claim.
8. Human UI, structured WebMCP output, activity ledger, and exports all corroborate the same mission.

## Product Acceptance Gate

The product slice is accepted only when automated contracts pass and at least one fresh supported-browser run proves the natural prompt continues from provider measurement through the ordered browser review and any required repository diagnosis. If that fresh-session behaviour fails, Frontmend may still be a functioning audit tool, but this submission's central product claim is not ready.
