# Frontmend demo script

Target length: 2 minutes 50 seconds. Use a controlled public deployment whose repository is open in Codex. Keep the Frontmend URL visible at the beginning and end, and use only genuine retained evidence.

## The one-line prompt

> Hey Codex, please use Frontmend to audit my site for accessibility and SEO issues.

That is the complete opening prompt. Codex should resolve the repository's public deployment, discover Frontmend, and follow the persisted mission without making the user describe tool names or protocol steps.

## 0:00–0:15 — The problem and promise

Show the target repository, its public URL, and Frontmend's one-tool landing state.

Narration: “Lighthouse measures a page. Frontmend turns that measurement into a shared investigation: the page directs a coding agent through rendered-browser checks, keeps every source separate, and carries the evidence into reviewable fixes and fresh proof.”

Send the one-line prompt.

## 0:15–0:40 — One shared assessment

Show `start_site_audit` receiving `intent: assess`, `focusAreas: [accessibility, seo]`, and at most three priorities. Let Codex follow the returned workspace path after the call finishes. Briefly show that queued/running state exposes only progress and cancellation to both the page and the agent.

When measurement finishes, call `get_site_audit_results` with `{}`. Point to the visible **Assessment**, retained focus, ranked provider priorities, and the same structured `missionState`. Do not spend the demo reading Lighthouse scores. The result must say the next action is `open_browser_review`; even a zero-finding provider result is not the end of this agent-started accessibility/SEO assessment.

## 0:40–1:20 — The browser-agent collaboration

Call `open_browser_review` with `{}`. Show the visible **Agent browser review · not Lighthouse** card and the exact first task. Frontmend should reveal only the current non-destructive check, not dump a giant audit prompt on the agent.

Have Codex perform each task on the rendered target with its normal browser tools, then call `record_browser_review_check` with the returned `reviewId`, exact `checkId`, outcome, and short direct observations. Use `passed` only for what was actually checked; use `issue` with up to three bounded findings when the rendered page exposes a problem. If the browser cannot safely perform the check, record one allowed blocker reason rather than improvising.

Show the queue advance one check at a time. Point to direct observations appearing in the human workspace and any browser-only issue becoming a ranked priority labelled **Agent-observed browser finding**. Provider and browser evidence must remain visibly separate. Narration: “The webpage is orchestrating capabilities the coding agent already has. It owns the mission and validation; the agent owns the browser.”

This is a bounded rendered-browser review, not a complete manual accessibility, screen-reader, or expert SEO audit. Say that once on screen rather than weakening the value with a generic “Lighthouse only” disclaimer.

## 1:20–1:45 — From observed issue to repository diagnosis

Choose the strongest provider or browser-observed priority that requires diagnosis. Frontmend should name `open_diagnostic_mission` as the exact next action while `assessmentComplete` remains false.

Codex opens the mission, reproduces the symptom where required, and inspects the repository with its normal repository tools. It then calls `submit_runtime_diagnosis` with a short reproduction, bounded observations, repository-relative ownership locations, and planned checks. Show the four-stage evidence chain: provider or browser evidence remains attributed to its source, while reproduction, repository ownership, and planned checks become **Contributed**.

If the controlled take deliberately demonstrates missing capability, persist the exact browser-review or diagnostic blocker and show that receipt/repair actions stay locked. Do not use a blocker-only take as the final successful demo.

Compare the visible and structured state:

- Lighthouse evidence remains labelled measured; browser-review evidence remains labelled agent-observed.
- The causal diagnosis remains labelled agent-reported.
- Frontmend received no source contents, absolute paths, prompts, credentials, or command output.
- The visible evidence chain and the `evidenceChain` returned through WebMCP agree stage for stage.
- `assessmentComplete` becomes true only after the required evidence is present.

Refresh the contextual tool view. `get_assessment_receipt` should appear only now. Call it with `{}` and briefly compare its structured priorities, evidence-chain provenance, and all-false repair/deployment authority with the new visible **Export assessment** Markdown action. This is the portable handoff artifact the agent can carry into the next coding task without reducing the assessment to a Lighthouse score.

Narration: “The agent keeps source access. Frontmend keeps the public evidence, shared mission, and authority boundary.”

## 1:45–2:05 — Explicitly cross into repair

Send a second natural request:

> Please prepare the first priority for a fix, but don't approve, change, or deploy anything.

Show `prepare_site_repair` freezing the exact finding. Point out that **Prepare a fix** is a semantic transition: it records intent only. No repair, approval, auto-policy consumption, repository edit, or deployment has occurred. The contextual capability set now exposes staging only because both explicit intent and required diagnosis exist.

Have Codex read `get_repository_fix_brief`, inspect the repository, and stage a bounded proposal with the exact repository-relative files and planned checks. Show the same plan appear in the human workspace awaiting review.

## 2:05–2:25 — Shared authority, not agent theatre

Keep **Review each plan** selected. Approve the proposal yourself in the visible UI, then let Codex implement only the reviewed repository scope and run the named checks. Have it attach `record_repository_implementation` with a short summary, relative files, truthful check statuses, and an optional commit ID.

Pause on the mission rail:

- Frontmend measured.
- Codex diagnosed and implemented.
- The person reviewed.
- Deployment still belongs to the site owner.
- Verification is still blocked.

Ask Codex to verify too early and show the structured `DEPLOYMENT_NOT_ATTESTED` result. Do not deploy during the recorded demo unless the controlled target change was genuinely reviewed and deployed beforehand.

## 2:25–2:45 — Fresh proof

On a genuine controlled receipt, show the person-only deployment handoff followed by a fresh verification audit. If the repaired priority came from Lighthouse or document evidence, point to the frozen baseline and fresh audit IDs, every captured mobile/desktop/document occurrence, repository receipt provenance, and comparable-coverage decision.

For the strongest take, repair a browser-observed priority. When fresh provider measurement finishes, show that `get_verification_receipt` is still absent and `open_browser_review` has reappeared. Frontmend should render **Fresh browser replay · WebMCP**, preserve the exact original observation, element and viewport, and return one `fresh-browser-replay` task. Codex revisits the deployed page, performs that exact comparison, and calls `record_browser_review_check` with `passed`, `issue`, or a real blocker. Only a completed pass/issue unlocks the receipt; a blocker keeps the same task resumable. Show the final receipt keeping provider measurement and agent-reported browser proof separate.

If one provider viewport still fails or the browser issue remains, the result must stay **still present**. If provider coverage changed, show that summary deltas are withheld. If the browser replay is blocked, show the claim lock rather than a receipt.

Never rehearse a fake resolution. A truthful still-present or inconclusive result is stronger evidence than an invented win.

## 2:45–2:50 — Closing line

“Frontmend makes the webpage, coding agent, and person collaborators: one visible mission, different capabilities, and no shared unsafe authority.”

End on the reloadable `/audits/:id` workspace and its contextual WebMCP status.

## Optional auto-mode cutaway

If time permits, use a separate controlled audit. The person visibly enables **Delegated auto mode**, which permits at most three agent-authored low-risk HTML/CSS plans with repository files and checks. Show one eligible plan consume one allowance and move to implementation, then show an ineligible JavaScript, headers, configuration, medium/high-risk, or plan-free proposal remain in review. Deployment and deployment attestation never become automatic.

## Demo failure conditions

Do not use the take if Codex stops after provider measurement; skips an assessment review or required verification replay; repeats Lighthouse scores instead of performing the exact rendered checks; reports unobserved passes; loses browser-review provenance; narrates a missing capability without persisting its blocker; lets a blocker unlock receipt or repair staging; stages without explicit preparation; presents agent diagnosis as measured; approves, enables auto mode, deploys, or attests deployment; sends source or absolute paths to Frontmend; starts repository work before authority exists; disagrees with visible mission state; or describes a local build as live proof.
