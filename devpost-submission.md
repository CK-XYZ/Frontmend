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

Frontmend persists that goal as a bounded **Assess** mission, runs a real asynchronous public-site audit, and returns no more than three deduplicated priorities. The visible page and the coding agent share the same job, focus, evidence, mission state, and next action.

The workflow deliberately continues beyond Lighthouse when the evidence only describes a symptom. Frontmend can open a durable diagnostic mission; the coding agent reproduces the problem in the browser, inspects the repository it already has access to, and contributes bounded observations, repository-relative ownership locations, and planned checks. Lighthouse evidence remains measured evidence. Agent diagnosis remains agent-reported.

An audit request is not repair permission. Only a later explicit request—such as “Please prepare the first priority for a fix”—records **Prepare a fix** intent for one retained finding. That transition creates no approval, edit, delegated-policy consumption, deployment, or deployment attestation. When the evidence and intent gates are satisfied, the agent can submit a bounded repository plan into the same visible workspace. A person reviews it or relies on a previously granted, narrow low-risk auto policy. The site owner still deploys externally, and Frontmend only claims resolution after a fresh comparable audit proves every captured rule occurrence.

## Why This Matters

Frontmend addresses a real workflow used by developers, maintainers, and product owners. Today that work is fragmented across an audit report, browser DevTools, repository search, chat, code review, deployment, and a second audit. Important provenance and authority are lost between those surfaces.

WebMCP makes the webpage an active participant in the engineering mission. The page holds durable public evidence, policy, review state, deployment handoff, and verification. The coding agent holds repository access and implementation ability. The person controls intent, risk, approval, and deployment. That creates something difficult to achieve with visual clicking or a generic MCP wrapper: one inspectable protocol shared by three actors without giving any actor unsafe authority.

The potential impact extends beyond frontend quality. The same pattern can support other long-running, evidence-sensitive workflows where agents contribute specialised work but people must retain consequential authority.

## How We Used AI

Frontmend does not hide an autonomous model behind the page. It exposes seventeen semantic WebMCP tools so a compatible agent can participate in the same application state as a person.

The agent uses reasoning where it is valuable:

- resolve the controlled repository's public deployment from available project context;
- carry a natural accessibility/SEO request into a bounded structured mission;
- choose and continue the highest-value evidence path instead of dumping every audit item;
- reproduce a measured symptom in the browser;
- inspect repository ownership with its own authorised repository tools;
- submit only bounded diagnosis, repository-relative plans, and implementation receipts;
- follow contextual next actions while respecting human review and deployment boundaries.

Frontmend uses deterministic contracts where trust matters. It validates URLs, focus areas, mission transitions, evidence provenance, relative paths, policy consumption, approval, deployment attestation, and comparable verification. The agent cannot approve review-mode work, enable or widen auto mode, deploy, or attest deployment through WebMCP.

## How We Used Codex

Codex was both the primary development collaborator and the intended repository-aware user.

During the build, Codex inspected the existing React, service, Worker, Durable Object, and test architecture; helped turn the product risk into a scope, PRD, technical specification, and eleven-item build checklist; implemented each isolated slice; and committed each completed slice with the existing project identity. It added the pure mission contract, cross-runtime persistence, explicit repair-preparation route, mission-aware WebMCP outputs, contextual tool gating, visible mission and priority UI, responsive styling, and cross-layer regression coverage.

Codex also challenged weak claims. The guided build explicitly treated “stops after Lighthouse” as a failed evaluation, kept historical browser receipts separate from current proof, preserved unrelated work, rejected raw prompt/source/absolute-path retention, and distinguished tests/build/dry-run from deployment. The final command-safe gate ran 124 deterministic tests, built the production client/Worker package, and completed a strict Wrangler dry run without upload.

The intended live demonstration uses Codex inside a controlled target repository: Codex can receive independent public evidence from Frontmend, use its own repository access to investigate and implement an authorised plan, and return a bounded receipt without uploading the source tree to Frontmend.

## Key Features

- Natural **Assess** missions with retained accessibility, SEO, performance, security, or reliability focus and no raw prompt storage.
- Real asynchronous PageSpeed Insights/Lighthouse measurement for independent mobile and desktop strategies, with truthful partial and bounded live-document fallback modes.
- No more than five bounded priorities by contract and three in the natural demo, deduplicated across viewports with occurrence and evidence state preserved.
- Distinct `auditComplete` and `assessmentComplete` states with an exact next tool/input when supported diagnosis remains.
- Durable diagnostic missions that keep measured symptoms separate from agent-reported browser and repository evidence.
- Explicit `prepare_site_repair` transition that freezes one finding before repair staging is eligible.
- Seventeen contextual WebMCP tools; only actions valid for the visible mission state are registered.
- Source-safe repository fix briefs, bounded repository plans, human review/revision, and optional low-risk delegated-auto approval capped at three uses.
- Agent implementation receipts that accept only relative files, check outcomes, a summary, and optional Git object ID.
- Person-only deployment attestation and fresh rule-by-rule verification across every captured strategy, with deltas withheld when coverage is not comparable.
- Durable route journeys and bounded multi-page exploration that aggregate recurring evidence without claiming a full crawl.
- Fully usable human fallback when `document.modelContext` is unavailable.

## Architecture

```text
Human UI ────────┐                         ┌─ PageSpeed Insights / Lighthouse
                 ├─ shared audit service ─┤
WebMCP tools ────┘                         └─ bounded live-document fallback
                             │
                             ├─ FrontmendAuditGate Durable Object
                             ├─ FrontmendAuditJob Durable Object
                             └─ shared mission state
                                  ├─ agent: diagnosis + repository plan + receipt
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
5. Confirm `get_site_audit_results` with `{}` returns no more than three deduplicated priorities and the same `missionState` shown in the page.
6. If `assessmentComplete` is false, confirm Codex follows the exact diagnostic action, reproduces the symptom, inspects repository ownership, and contributes bounded relative-path evidence without staging a repair.
7. Send: “Please prepare the first priority for a fix, but don't approve, change, or deploy anything.” Confirm the intent transition occurs before staging becomes eligible and consumes no auto allowance.
8. Confirm any staged plan remains visibly reviewable, deployment is person-only, and verification fails with `DEPLOYMENT_NOT_ATTESTED` until a genuine external handoff is recorded.

Exact fresh-session ChatGPT, Codex, delegated-auto, and Chrome Inspector procedures are in `RELEASE_CANDIDATE.md`.

### Local reproducibility

```powershell
bun install --frozen-lockfile
bun run test
bun run build
bunx wrangler deploy --dry-run --strict --config wrangler.jsonc
```

Fresh local receipt on 29 August 2026: 124 tests passed; Vite transformed 4,576 modules; Wrangler 4.126.0 recognised the assets plus both Durable Object bindings and exited in dry-run mode without uploading.

## Public Demo Link

Planned URL: `https://frontmend.test.knightware.xyz/`

Status: **TODO before final submission.** The hostname currently serves an older deployed revision and is temporarily protected by Cloudflare Access policy **Only CK**. Deploy the current candidate only after explicit authorisation, then remove temporary Access or place tested judge credentials in Devpost's private testing-instructions field.

## Public Repository Link

`TODO_PUBLIC_REPOSITORY_URL`

Status: no Git remote is currently configured. The standalone repository has Apache-2.0 `LICENSE`, `THIRD_PARTY_NOTICES.md`, reproducible instructions, and challenge-period commit history, but it has not been published or pushed.

## Demo Video

`TODO_PUBLIC_YOUTUBE_URL`

Required format: public YouTube video, under three minutes, with clear audio. Target runtime is 2:50. The exact shot-by-shot script is in `DEMO_SCRIPT.md`.

Outline:

1. One-line natural prompt and contextual WebMCP discovery.
2. Shared Assess focus and measurement-versus-assessment state.
3. Browser/repository diagnosis beyond Lighthouse.
4. Explicit Prepare-a-fix transition and visible bounded plan.
5. Human authority, implementation receipt, person-only deployment gate, and genuine fresh proof.

## Screenshot Shot List

No final screenshot assets have been supplied yet.

1. Landing page with the production URL and exactly one active `start_site_audit` tool.
2. Completed measurement with **Assessment**, accessibility/SEO focus, ranked priorities, and `assessmentComplete: false` beside the diagnostic next action.
3. Measured Lighthouse symptom beside separately labelled agent-reported browser/repository diagnosis.
4. **Preparing a fix** transition, contextual tool change, and visible review/auto-policy authority boundary.
5. Implementation receipt plus person-only deployment gate and a genuine fresh multi-strategy verification receipt.

## Submission Readiness Notes

Official live Devpost data was fetched on 29 August 2026. Submissions close at `2026-09-03T20:00:00Z` (4:00 am Australia/Perth on 4 September 2026). The account is authenticated and registered for The WebMCP Challenge.

Judging fit:

- **WebMCP Leverage:** seventeen contextual semantic tools share the human application's service, validation, persistence, and state transitions; tool availability is itself part of the authority protocol.
- **Execution:** a coherent human product, real asynchronous evidence, durable jobs, Worker/Durable Object runtime, human fallback, 124 tests, production build, and strict deployment dry run.
- **Potential Impact:** replaces a fragmented developer workflow with a durable, inspectable path from live evidence to repository work and fresh proof.
- **Creativity & Ambition:** applies WebMCP to a multi-actor engineering protocol with changing authority rather than a single stateless agent action.

Current blockers:

- current mission candidate is not deployed;
- temporary Cloudflare Access is not yet judge-ready;
- fresh current-version ChatGPT, Codex-repository, and Chrome WebMCP receipts are missing;
- current Chrome console and 390 px browser proof are missing;
- public repository URL and visible repository About licence are missing;
- final screenshots and public <3-minute YouTube video are missing;
- Devpost project fields and required participant choices have not been sent.

Nothing has been sent to Devpost.

## Known Limitations

- Frontmend supports a deliberately bounded set of Lighthouse and live-document rules; it is not a complete manual accessibility, SEO, security, or usability audit.
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
