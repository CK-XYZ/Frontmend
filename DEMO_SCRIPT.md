# Frontmend demo script

Target length: 2 minutes 50 seconds. Use a controlled public deployment whose repository is open in Codex. Keep the Frontmend URL visible at the beginning and end, and use only genuine retained evidence.

## The one-line prompt

> Hey Codex, please use Frontmend to audit my site for accessibility and SEO issues.

That is the complete opening prompt. Codex should resolve the repository's public deployment, discover Frontmend, and follow the persisted mission without making the user describe tool names or protocol steps.

## 0:00–0:15 — The problem and promise

Show the target repository, its public URL, and Frontmend's one-tool landing state.

Narration: “Lighthouse can measure symptoms, but it cannot carry a coding agent from public evidence to repository diagnosis, human authority, and fresh proof. Frontmend makes that whole mission visible and durable.”

Send the one-line prompt.

## 0:15–0:40 — One shared assessment

Show `start_site_audit` receiving `intent: assess`, `focusAreas: [accessibility, seo]`, and at most three priorities. Let Codex follow the returned workspace path after the call finishes. Briefly show that queued/running state exposes only progress and cancellation to both the page and the agent.

When measurement finishes, call `get_site_audit_results` with `{}`. Point to the visible **Assessment**, retained focus, ranked priorities, cross-viewport occurrences, and the same structured `missionState`. Do not spend the demo reading Lighthouse scores.

## 0:40–1:25 — The value beyond Lighthouse

Choose a priority whose evidence says diagnosis is recommended. Show the crucial distinction: the audit job is complete, but `assessmentComplete` is false and Frontmend names `open_diagnostic_mission` as the exact next action.

Codex opens the mission, reproduces the symptom in the browser, and inspects the repository with its normal repository tools. It then calls `submit_runtime_diagnosis` with a short reproduction, bounded observations, repository-relative ownership locations, and planned checks.

Compare the visible and structured state:

- Lighthouse evidence remains labelled measured.
- The causal diagnosis remains labelled agent-reported.
- Frontmend received no source contents, absolute paths, prompts, credentials, or command output.
- `assessmentComplete` becomes true only after the required evidence is present.

Narration: “The agent keeps source access. Frontmend keeps the public evidence, shared mission, and authority boundary.”

## 1:25–1:55 — Explicitly cross into repair

Send a second natural request:

> Please prepare the first priority for a fix, but don't approve, change, or deploy anything.

Show `prepare_site_repair` freezing the exact finding. Point out that **Prepare a fix** is a semantic transition: it records intent only. No repair, approval, auto-policy consumption, repository edit, or deployment has occurred. The contextual capability set now exposes staging only because both explicit intent and required diagnosis exist.

Have Codex read `get_repository_fix_brief`, inspect the repository, and stage a bounded proposal with the exact repository-relative files and planned checks. Show the same plan appear in the human workspace awaiting review.

## 1:55–2:25 — Shared authority, not agent theatre

Keep **Review each plan** selected. Approve the proposal yourself in the visible UI, then let Codex implement only the reviewed repository scope and run the named checks. Have it attach `record_repository_implementation` with a short summary, relative files, truthful check statuses, and an optional commit ID.

Pause on the mission rail:

- Frontmend measured.
- Codex diagnosed and implemented.
- The person reviewed.
- Deployment still belongs to the site owner.
- Verification is still blocked.

Ask Codex to verify too early and show the structured `DEPLOYMENT_NOT_ATTESTED` result. Do not deploy during the recorded demo unless the controlled target change was genuinely reviewed and deployed beforehand.

## 2:25–2:45 — Fresh proof

On a genuine controlled receipt, show the person-only deployment handoff followed by a fresh verification audit. Point to the frozen baseline and fresh audit IDs, every captured mobile/desktop/document rule occurrence, repository receipt provenance, and comparable-coverage decision. If one viewport still fails, the result must remain **still present**. If coverage changed, show that summary deltas are withheld.

Never rehearse a fake resolution. A truthful still-present or inconclusive result is stronger evidence than an invented win.

## 2:45–2:50 — Closing line

“Frontmend is not a start-and-poll Lighthouse wrapper. It is a browser-native protocol where a coding agent, a person, and fresh public evidence share one mission without sharing unsafe authority.”

End on the reloadable `/audits/:id` workspace and its contextual WebMCP status.

## Optional auto-mode cutaway

If time permits, use a separate controlled audit. The person visibly enables **Delegated auto mode**, which permits at most three agent-authored low-risk HTML/CSS plans with repository files and checks. Show one eligible plan consume one allowance and move to implementation, then show an ineligible JavaScript, headers, configuration, medium/high-risk, or plan-free proposal remain in review. Deployment and deployment attestation never become automatic.

## Demo failure conditions

Do not use the take if Codex stops after Lighthouse while `assessmentComplete` is false; repair staging appears without explicit preparation; agent-reported diagnosis is presented as measured; the agent approves, enables auto mode, deploys, or attests deployment; Frontmend receives source or absolute paths; repository work starts before authority exists; visible and structured mission state disagree; or any local build is described as live proof.
