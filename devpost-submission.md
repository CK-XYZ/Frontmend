# Title

Frontmend

## One-line Summary

Frontmend turns one natural site-audit request into a shared mission from public evidence to repository diagnosis, human-authorised repair, and fresh verification.

## Problem

Frontend audits usually end where the hard work begins. Lighthouse can report a console error, contrast failure, or long main-thread task, but the developer still has to reproduce it, find the owning repository code, decide whether an agent may prepare a change, preserve review authority, deploy through the real hosting workflow, and prove the public result changed.

A coding agent can summarise the score, but that often makes the experience worse: a completed measurement is mistaken for a completed assessment, browser evidence is blended with agent interpretation, and a request to “audit my site” can drift into unasked-for remediation. The person cannot easily see which evidence is measured, which claim came from the agent, or which authority the agent exercised.

## Solution

Frontmend is a human-facing frontend assessment and repair workspace with WebMCP as a native control surface. A developer can say:

> Hey Codex, please use Frontmend to audit my site for accessibility and SEO issues.

Frontmend persists that goal as a bounded **Assess** mission, runs a real asynchronous public-site audit, and returns no more than three deduplicated priorities. Then it does something a Lighthouse wrapper cannot: it gives the external coding agent one exact rendered-browser check at a time. The visible page and the agent share the same job, focus, evidence, mission state, and next action.

For agent-started accessibility or SEO work, measurement is never mistaken for assessment completion. Frontmend opens a persisted browser review with ordered, non-destructive tasks covering rendered structure, a primary journey, responsive reflow, and search discovery as applicable. The agent uses its own browser controls and records only direct observations, bounded findings, or an honest blocker. Browser-only issues become ranked priorities, but remain labelled agent-observed. This is a bounded rendered-browser review, not a claim of complete manual or screen-reader coverage.

When an issue still needs a cause and owner, Frontmend opens a durable diagnostic mission; the coding agent inspects the repository it already has access to and contributes bounded reproduction, repository-relative ownership locations, and planned checks. Lighthouse evidence remains measured evidence. Browser review and causal diagnosis remain separately attributed agent contributions.

An audit request is not repair permission. Only a later explicit request—such as “Please prepare the first priority for a fix”—records **Prepare a fix** intent for one retained finding. That transition creates no approval, edit, delegated-policy consumption, deployment, or deployment attestation. When the evidence and intent gates are satisfied, the agent can submit a bounded repository plan into the same visible workspace. A person reviews it or relies on a previously granted, narrow low-risk auto policy. The site owner still deploys externally. Provider findings need fresh comparable rule evidence; browser findings trigger one exact replay of the preserved observation, element, check and viewport before Frontmend will issue the verification receipt.

## Why This Matters

Frontmend addresses a real workflow used by developers, maintainers, and product owners. Today that work is fragmented across an audit report, browser DevTools, repository search, chat, code review, deployment, and a second audit. Important provenance and authority are lost between those surfaces.

WebMCP makes the webpage an active participant in the engineering mission. The page holds durable public evidence, policy, review state, deployment handoff, and verification. The coding agent holds repository access and implementation ability. The person controls intent, risk, approval, and deployment. That creates something difficult to achieve with visual clicking or a generic MCP wrapper: one inspectable protocol shared by three actors without giving any actor unsafe authority.

The potential impact extends beyond frontend quality. The same pattern can support other long-running, evidence-sensitive workflows where agents contribute specialised work but people must retain consequential authority.

## How We Used AI

Frontmend does not hide an autonomous model behind the page. It exposes twenty-one semantic WebMCP tools so a compatible agent can participate in the same application state as a person.

The agent uses reasoning where it is valuable:

- resolve the controlled repository's public deployment from available project context;
- carry a natural accessibility/SEO request into a bounded structured mission;
- choose and continue the highest-value evidence path instead of dumping every audit item;
- perform the next exact rendered-browser check and contribute only directly observed evidence;
- reproduce a measured symptom in the browser;
- inspect repository ownership with its own authorised repository tools;
- submit only bounded diagnosis, repository-relative plans, and implementation receipts;
- follow contextual next actions while respecting human review and deployment boundaries.

Frontmend uses deterministic contracts where trust matters. It validates URLs, focus areas, mission transitions, evidence provenance, relative paths, policy consumption, approval, deployment attestation, and comparable verification. The agent cannot approve review-mode work, enable or widen auto mode, deploy, or attest deployment through WebMCP.

## How We Used Codex

Codex was both the primary development collaborator and the intended repository-aware user.

During the build, Codex inspected the existing React, service, Worker, Durable Object, and test architecture; helped turn the product risk into a scope, PRD, technical specification, and sequenced build checklist; implemented isolated slices; and committed each completed slice with the existing project identity. It added the mission and browser-review contracts, cross-runtime persistence, explicit repair-preparation route, mission-aware WebMCP outputs, contextual tool gating, visible browser-evidence and priority UI, responsive styling, and cross-layer regression coverage.

Codex also challenged weak claims. The build explicitly treated “stops after Lighthouse” as a failed evaluation, made an agent-started browser review mandatory for the natural accessibility/SEO prompt, and found that browser findings could not honestly close through a provider-only rerun. Frontmend now calls the agent back for one exact post-deployment browser replay and withholds the receipt until it completes. The build also keeps historical browser receipts separate from current proof, preserves unrelated work, rejects raw prompt/source/absolute-path retention, and distinguishes tests/build/dry-run from deployment. The current local candidate has 261 passing deterministic tests, a successful production build with a 418.49 kB raw / 118.19 kB gzip initial JavaScript entry, and a successful strict Wrangler dry run that exited without upload. These remain local packaging evidence, not deployment or supported-browser proof.

The intended live demonstration uses Codex inside a controlled target repository: Codex can receive independent public evidence from Frontmend, use its own repository access to investigate and implement an authorised plan, and return a bounded receipt without uploading the source tree to Frontmend.

## Key Features

- Natural **Assess** missions with retained accessibility, SEO, performance, security, or reliability focus and no raw prompt storage.
- Real asynchronous PageSpeed Insights/Lighthouse measurement for independent mobile and desktop strategies, with truthful partial and bounded live-document fallback modes.
- No more than five bounded priorities by contract and three in the natural demo, deduplicated across viewports with occurrence and evidence state preserved.
- Distinct `auditComplete` and `assessmentComplete` states with an exact next tool/input when supported diagnosis remains.
- Ordered agent-contributed browser review with exact check instructions, pass/issue/blocker outcomes, and separately attributed observations.
- Browser-only issues promoted into the same ranked evidence and repair workflow without being mislabelled as Lighthouse findings.
- Exact post-deployment browser replay for browser-observed repairs, with the original evidence and viewport preserved and the verification receipt locked until the comparison passes, remains, or is honestly blocked.
- Durable diagnostic missions with a shared four-stage evidence chain that keeps provider measurement separate from agent-reported browser reproduction, repository ownership, and planned checks.
- A structured diagnostic blocker that preserves unavailable or conflicting browser/repository evidence instead of inviting an agent to invent a cause; the mission remains visibly incomplete and resumable.
- A portable completion receipt that becomes available only when the retained assessment is complete and carries provider evidence beside separately attributed agent contributions without claiming repair, deployment, or resolution.
- Explicit `prepare_site_repair` transition that freezes one finding before repair staging is eligible.
- Twenty-one contextual WebMCP tools; only actions valid for the visible mission state are registered.
- Source-safe repository fix briefs, bounded repository plans, human review/revision, and optional low-risk delegated-auto approval capped at three uses.
- Agent implementation receipts that accept only relative files, check outcomes, a summary, and optional Git object ID.
- Person-only deployment attestation and fresh rule-by-rule verification across every captured strategy, with deltas withheld when coverage is not comparable.
- Durable route journeys and bounded multi-page exploration that aggregate recurring evidence without claiming a full crawl.
- Fully usable human fallback when `document.modelContext` is unavailable.

## Architecture

```text
Human UI ────────┐                         ┌─ PageSpeed Insights / Lighthouse
                 ├─ shared audit service ─┼─ bounded live-document fallback
WebMCP tools ────┘                         └─ agent-contributed browser review
                             │
                             ├─ FrontmendAuditGate Durable Object
                             ├─ FrontmendAuditJob Durable Object
                             └─ shared mission state
                                   ├─ agent: browser review + diagnosis + repository receipt
                                  ├─ person: intent + review or bounded delegation
                                  ├─ site owner: external deploy + attestation
                                  └─ Frontmend: fresh comparable verification
```

The client is React 19 and Vite. The production runtime is a Cloudflare Worker with static assets and two SQLite Durable Object classes. Human and WebMCP actions call the same application service and HTTP routes. PageSpeed receives only the public URL and provider options—never mission text or repository metadata. WebMCP registration is contextual and abortable, while the complete human experience remains available without WebMCP.

Built with: React, Vite, Bun, Cloudflare Workers, Cloudflare Durable Objects, WebMCP, PageSpeed Insights/Lighthouse, and Phosphor Icons.

## Testing Instructions

### Judge path

1. Open the final `PUBLIC_DEMO_URL` as a top-level page in ChatGPT's in-app browser or supported Chrome with WebMCP enabled.
2. Confirm the landing page exposes exactly `start_site_audit`.
3. From a fresh Codex task in a controlled public target repository, send: “Hey Codex, please use Frontmend to audit my site for accessibility and SEO issues.”
4. Confirm the audit starts in Assess mode, retains both focus areas, returns a stable `/audits/<id>` workspace, and exposes only progress/cancel while running.
5. Confirm `get_site_audit_results` with `{}` returns the same `missionState` shown in the page and names `open_browser_review` as the next action even when the provider found zero issues.
6. Confirm Codex opens the browser review, performs each exact check with real browser controls, and records only direct observations, bounded issues, or an honest browser blocker. The visible **Agent browser review · not Lighthouse** card must advance in the same order as the structured result.
7. Confirm any browser-observed issue enters the ranked queue with agent provenance. If a priority needs repository diagnosis, Codex follows that exact action and contributes only bounded relative-path evidence; a genuine capability gap must be persisted as a blocker rather than narrated or fabricated.
8. When `assessmentComplete` becomes true, confirm `get_assessment_receipt` appears, invoke it with `{}`, and compare its provider/browser/repository provenance and authority boundary with the visible **Export assessment** Markdown action.
9. Send: “Please prepare the first priority for a fix, but don't approve, change, or deploy anything.” Confirm the intent transition occurs before staging becomes eligible and consumes no auto allowance.
10. Confirm any staged plan remains visibly reviewable and deployment is person-only. Verification must fail with `DEPLOYMENT_NOT_ATTESTED` until a genuine external handoff is recorded; for a browser-observed repair, fresh provider completion must then expose one exact browser replay while the receipt remains absent.
11. Perform that exact replay on the rendered target. Confirm `passed` resolves only the retained issue, `issue` keeps it present, and a real blocker leaves the receipt locked and the same task resumable.

Exact fresh-session ChatGPT, Codex, delegated-auto, and Chrome Inspector procedures are in `RELEASE_CANDIDATE.md`.

### Local reproducibility

```powershell
bun install --frozen-lockfile
bun run test
bun run build
bunx wrangler deploy --dry-run --strict --config wrangler.jsonc
```

Fresh local release evidence for the browser-review and verification-replay candidate is recorded in `RELEASE_CANDIDATE.md`. Build, tests, and Wrangler dry-run evidence are local packaging proof only; they do not prove deployment or browser compatibility.

## Public Demo Link

Planned URL: `https://frontmend.test.knightware.xyz/`

Status: **TODO before final submission.** The hostname currently serves an older deployed revision. It is publicly reachable through a temporary app-scoped Cloudflare Access bypass while the reusable **Only CK** policy remains available for rollback. Deploy the current candidate only after explicit authorisation, then re-run the fresh judge procedures against the exact deployed revision.

## Public Repository Link

Planned: `https://github.com/CK-XYZ/Frontmend`

Status: `origin/main` exists at commit `49f7733`, while the local candidate includes receipt commit `199cec0` plus this unpushed documentation correction. An unauthenticated request to the planned GitHub URL returns 404, so the repository is not yet judge-public and nothing from this candidate was pushed during this work. The repository already has Apache-2.0 `LICENSE`, `THIRD_PARTY_NOTICES.md`, reproducible instructions, and challenge-period history.

## Demo Video

`TODO_PUBLIC_YOUTUBE_URL`

Required format: public YouTube video, under three minutes, with clear audio. Target runtime is 2:50. The exact shot-by-shot script is in `DEMO_SCRIPT.md`.

Outline:

1. One-line natural prompt and contextual WebMCP discovery.
2. Shared Assess focus and measurement-versus-assessment state.
3. Ordered rendered-browser review and repository diagnosis beyond Lighthouse.
4. Explicit Prepare-a-fix transition and visible bounded plan.
5. Human authority, implementation receipt, person-only deployment gate, and genuine fresh proof.

## Screenshot Shot List

No final screenshot assets have been supplied yet.

1. Landing page with the production URL and exactly one active `start_site_audit` tool.
2. Completed measurement with **Assessment**, accessibility/SEO focus, and `open_browser_review` as the required next action.
3. Visible **Agent browser review · not Lighthouse** card beside a separately labelled browser-observed priority.
4. **Preparing a fix** transition, contextual tool change, and visible review/auto-policy authority boundary.
5. Implementation receipt plus person-only deployment gate and a genuine fresh multi-strategy verification receipt.

## Submission Readiness Notes

Official live Devpost data was fetched on 29 August 2026. Submissions close at `2026-09-03T20:00:00Z` (4:00 am Australia/Perth on 4 September 2026). The account is authenticated and registered for The WebMCP Challenge.

Judging fit:

- **WebMCP Leverage:** twenty-one contextual semantic tools share the human application's service, validation, persistence, and state transitions; ordered browser-review tasks make the webpage an orchestrator of external agent capabilities rather than a static command catalogue.
- **Execution:** a coherent human product, real asynchronous evidence, durable jobs, Worker/Durable Object runtime, human fallback, 261 passing tests, production build, and a no-upload Wrangler release gate.
- **Potential Impact:** replaces a fragmented developer workflow with a durable, inspectable path from live evidence to repository work and fresh proof.
- **Creativity & Ambition:** applies WebMCP to a multi-actor engineering protocol with changing authority rather than a single stateless agent action.

Current blockers:

- current mission candidate is not deployed;
- the temporary public Access bypass must remain active through judging or be replaced by another verified public-access arrangement;
- fresh current-version ChatGPT, Codex-repository, and Chrome WebMCP receipts are missing;
- current Chrome console and 390 px browser proof are missing;
- public repository URL and visible repository About licence are missing;
- final screenshots and public <3-minute YouTube video are missing;
- Devpost project fields and required participant choices have not been sent.

Nothing has been sent to Devpost.

## Known Limitations

- Frontmend combines deliberately bounded Lighthouse/live-document rules with an ordered agent-contributed browser review; it is not a complete manual, screen-reader, expert SEO, security, or usability audit.
- Browser/repository diagnosis currently depends on a capable external agent with authorised access. Frontmend does not receive or index the repository.
- The live-document fallback cannot observe runtime DOM changes, CSS imports, every request, user journeys, or viewport rendering.
- Route exploration is limited to one to three server-observed same-site paths and never claims full-crawl coverage.
- Frontmend does not edit repositories, execute patches, push, deploy, or independently prove that a person deployed the reviewed source.
- Fresh verification can be inconclusive when provider engines, strategies, or supplements differ; summary deltas are withheld in that case.

## TODO Official Form Fields

Live fields from `get_submission_requirements`:

- `28249` — **Submitter Type** (required): `TODO_CONFIRM Individual | Team of Individuals | Organization`
- `28250` — **Country of residence of yourself and team members if applicable** (required): `TODO_CONFIRM_COUNTRY`
- `28251` — **Organization name** (conditional): `Not applicable unless submitter type is Organization`
- `28252` — **App Status** (required): draft `New` — repository history begins during the challenge period; confirm before final entry
- `28253` — **If Existing, explain updates during the submission period**: `Not applicable if App Status is New`; otherwise use the challenge-period mission, diagnosis, preparation, authority, and verification work described above
- `28254` — **Live URL** (required): `https://frontmend.test.knightware.xyz/` after current deployment and judge-access verification
- `28255` — **Private testing instructions / credentials** (optional): use the Judge path above; `TODO_RESOLVE_ACCESS_OR_ADD_TESTED_JUDGE_CREDENTIALS`
- `28256` — **Public code repository URL** (required): `TODO_PUBLIC_REPOSITORY_URL`
- `28257` — **Agents/clients tested** (required): proven historical Codex desktop in-app-browser lifecycle on the older deployment; `TODO_ADD_CURRENT_CANDIDATE_CHATGPT_CODEX_CHROME_RECEIPTS`
- `28258` — **AI tools leveraged** (required): OpenAI Codex for repository analysis, implementation, testing, release hardening, and the repository-aware product workflow; ChatGPT/Codex in-app browser for WebMCP evaluation. PageSpeed Insights/Lighthouse supplies measurement and is not presented as an AI tool.
- `28259` — **Learning level** (required): `TODO_CONFIRM None | Moderate | Significant` (draft recommendation: `Significant`)
- `28260` — **Career AI value** (required): `TODO_CONFIRM Yes | No`

Official deliverables: working judge-accessible live URL, text description, public <3-minute YouTube demo with audio, and public licensed repository. No Codex session ID field is present in the live form.
