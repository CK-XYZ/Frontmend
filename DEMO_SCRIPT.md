# Frontmend demo script

Target length: 2 minutes 30 seconds. Show the real deployed application and keep the browser address visible at the beginning and end.

Natural fresh-task prompt for the repository-aware version:

> Audit the deployed site and fix the most important issue you can prove is owned by this repository. Use Frontmend for public evidence. If it opens a diagnostic mission, reproduce the issue in the browser, trace it to the owning repository code, and contribute that diagnosis before proposing a repair. Show me the evidence and plan before editing unless my visible Frontmend auto-mode grant explicitly authorises it. Run the agreed checks, never deploy, and don’t claim the live site is fixed until a fresh Frontmend verification proves it.

Auto-mode variant after the person visibly enables **Delegated auto mode** in Frontmend:

> Audit the deployed site and use Frontmend’s shared repair workspace. For an eligible low-risk HTML or CSS finding, inspect this repository, submit the exact files and checks under my visible auto-mode grant, implement the authorised plan, run its checks, and record the implementation receipt. Stop before deployment.

## 0:00–0:20 — The problem

“Frontend audits produce long reports, but the repair still gets lost between an agent, a developer, and a browser. Frontmend gives both people and browser agents one evidence-backed repair bench.”

Paste a controlled public URL and point out that the normal human interface works without WebMCP.

If a target cannot be audited, use **Try this URL again** to show a numbered fresh attempt under the same workspace. Explain that Frontmend retains normal rate limits and does not disguise a repeated measured failure as success.

For the agent path, call `start_site_audit`, show that the result contains a stable `workspacePath`, then navigate to it only after the tool result returns. This preserves browser approval safety while still landing on a reloadable audit route.

## 0:20–0:55 — Real audit

Ask the agent to audit the current URL. Show `start_site_audit`, then the visible progress state. Ask it to check progress and retrieve results. Open one finding and show the measured evidence, rule provenance, evidence mode, and affected condition. For a missing CSP, show the bounded resource-origin inventory and its explicit static-HTML caveat.

Briefly point out that the same running state exposes **Cancel audit** to the person and `cancel_site_audit` to the agent. If you demonstrate it, show the persisted cancelled state and the numbered same-ID retry; do not imply that leaving the page alone stops server work.

Click **Export report** and briefly show the portable Markdown: target and final URL, audit ID, engine, score, findings, explicit rule outcomes, and the evidence boundary. It is the human handoff for the same persisted evidence the agent receives—not a second report assembled from screen text.

Show **Routes observed on this page**. Ask the agent to choose one exact path with `start_related_page_audit`; point out that the completed parent job—not browser memory—accepts only paths found in its retained report, starts a fresh job, and returns a stable workspace without claiming the candidate was previously visited. Follow one more route and show **Route journey**: the visible root, parent hops, current path, and **Parent audit** link are the same bounded lineage the tool and Markdown export return. Contrast that with the same visible **Audit route** action for a person.

For the strongest site-level moment, select two routes under **Explore a small part of this site** or call `start_site_exploration`. Show the two independent child audit IDs and then the recurring-issue card. Call `get_site_exploration` with `{}` and compare its page counts and exact rule with the visible aggregate. Export the mission and point to the explicit selected-pages-only boundary.

Open **Agent log** and show the three genuine lifecycle entries. Point out that people can see what the agent did while raw URLs, tool arguments, patches, prompts, and secrets are deliberately absent.

If Lighthouse falls back, say exactly: “The provider was quota-limited, so Frontmend is showing a bounded live Document profile and zero measured viewports. It does not invent a screenshot.” Point out the real HTML size, element counts, external origins, inline code, and response-header signals; then read the caveat that runtime DOM changes, CSS imports, requests, and user journeys are outside this evidence mode.

If only one Lighthouse strategy succeeds, say exactly: “Frontmend retained the successful viewport and names the missing strategy. The Document profile adds only non-overlapping HTML and header rules; it does not pretend to be the missing viewport.” Show the added-rule and omitted-overlap counts beside the provider failure.

## 0:55–1:30 — Agent proposes, person decides

Pause on **Human-agent operating policy**. Explain that this is the central WebMCP idea: the webpage is not merely exposing audit calls; it is holding the shared authority and mission state between a coding agent with repository access and the person who owns deployment.

For the review path, keep **Review each plan** selected. Ask the agent to submit a repository mission for the selected finding. Show the draft appear immediately in the same visible workspace. For CSP, trace an observed origin from the evidence inventory into the Report-Only header, then point out the inline evidence, nonce-or-hash guidance, risk, and real-journey verification plan. Emphasize that the agent cannot grant itself approval.

Before staging, use `get_repository_fix_brief` for the finding. Show that Frontmend returns measured evidence, likely repository ownership points, and acceptance criteria—but no source content or absolute paths. After Codex inspects the repository, have it stage the proposal with the exact repository-relative target files and planned checks. Point to that structured **Coding-agent plan** in the visible review workspace before approval. If the same rule failed in more than one measured strategy, point to the visible repair scope and the brief's bounded occurrence list: one repository change must be checked against every failing strategy, not only whichever viewport the agent selected first. This is the Codex-native handoff: the coding agent keeps source access; Frontmend receives only public evidence and bounded plan metadata.

For console, contrast, or main-thread findings, open the visible **Diagnostic mission** first. Show the measured Lighthouse symptom, then have the agent call `open_diagnostic_mission`, reproduce the exact issue in the browser, inspect repository ownership, and call `submit_runtime_diagnosis`. Compare the visible diagnosis with its repository-relative locations and planned checks. Frontmend labels this contribution as agent-reported and does not promote it into measured evidence. Until that step is complete, the agent repair tool remains unavailable for that finding; manual drafting is still possible for a person.

Write one specific change request and click **Request agent revision**. Show approval disappear, ask the agent to read `get_repair_workspace`, and then use `revise_site_repair`. Point to the incremented revision, reopened human review, and visible revision trail. This is collaboration over shared state, not an agent clicking its own approval.

Use the repair mission rail to narrate ownership: Frontmend measures, a person or agent drafts, the person reviews, the site owner deploys through their normal workflow, and Frontmend verifies. Ask the agent for `get_repair_workspace` to show that the same next-action model is structured rather than scraped from the page.

Review the proposal and click **Approve repair plan** yourself. Show that export becomes available, while verification remains locked at **Waiting for site owner**. Ask the agent to verify now and show the structured `DEPLOYMENT_NOT_ATTESTED` failure in the visible Agent log.

For the optional auto path, start from a fresh controlled audit and visibly enable **Delegated auto mode** by checking its authorisation statement. Show the persisted receipt: three approvals, low risk only, HTML/CSS only, and a mandatory repository plan. Have Codex submit one eligible CSS mission. The mission should move directly to implementation with **Auto-authorised by your policy**, consume one allowance, and expose `record_repository_implementation` without an approval click. Then try or describe an ineligible JavaScript, headers, configuration, or medium/high-risk proposal: it must remain in review. Point out that deployment and deployment attestation never become automatic.

On a controlled repository, let the coding agent implement the approved plan through its normal repository tools and run the planned checks. Then call `record_repository_implementation` with only a short summary, repository-relative filenames, check outcomes, and an optional commit ID. Compare the pre-approval plan with the post-implementation receipt in the visible workspace. If a check failed or was not run, show the amber **Implement** attention state and the agent's corrective next action; only a receipt whose reported checks all passed earns the completion tick. Explain that Frontmend still did not inspect source, make the edit, deploy it, or prove the public result.

Only on a controlled target where the reviewed change has genuinely been deployed, check the site-owner confirmation and click **Confirm deployment handoff**. Explain that this is a human report, not a Frontmend deployment claim; it unlocks measurement but does not claim the repair succeeded.

## 1:30–2:05 — Export and prove

Open or download the reviewed repair-plan Markdown and point out its baseline audit ID, frozen rule-scope table, and proposal-only honesty notice. Contrast it with the earlier audit-report export: measured evidence first, reviewed proposal second, fresh verification proof last. After the controlled target has been updated and the deployment handoff recorded, start **Verify live site**. Show the before/after proof receipt: deployment-attestation time, the frozen coding-agent receipt, baseline and fresh audit IDs, every captured mobile/desktop/document outcome, the aggregate rule result, and server-derived score, passed-check, and finding deltas. State the distinction plainly: the repository metadata records what the agent reported implementing; only the fresh public audit can prove the live rule outcomes. In the evidence trail, point to **Comparable coverage** for a like-for-like attempt; if a strategy, engine, or supplement changed, show **Coverage changed · deltas withheld** in both the UI and Markdown rather than narrating the raw scores as a trend.

If audit coverage changes between baseline and verification, point out the two comparison rows: the exact rule may still be comparable, but summary deltas are withheld unless the engine, Lighthouse version, measured strategies, score basis, and document supplement match. Never narrate non-like-for-like numbers as an improvement.

For the strongest controlled demo, make the same rule fail in two measured strategies. First show a verification where mobile passes but desktop still fails: the aggregate result must remain **still present**. Then apply the complete fix and show both strategy rows pass before Frontmend marks the repair resolved. This is the clearest proof that the product does not cherry-pick a favourable viewport.

If demonstrating more than one repair attempt, point to the evidence trail. It keeps the original baseline and every recent verification together, so neither a human nor an agent can quietly replace an inconvenient result.

Never rehearse a fake resolution. If the finding remains, use that truthful result to demonstrate why verification matters.

## 2:05–2:30 — Why WebMCP

“A start-and-poll API is not the innovation. Frontmend turns the page into a browser-native repair protocol shared by production evidence, a coding agent with repository access, and the person who owns the site. The same mission can require explicit review or consume a narrow human delegation. Tool availability changes with that recorded authority: evidence unlocks planning, approval or eligible delegation unlocks implementation, and human deployment attestation unlocks fresh verification. The agent contributes repository-aware execution; the person controls risk and deployment; the browser proves every captured rule occurrence on the public result.”

Click the **WebMCP · _ active** status. The capability panel should match the current browser discovery and clearly distinguish explicit review, prior human delegation, and the still-human-only deployment boundary.

On the completed workspace, call `get_site_audit_results` with `{}`. Frontmend should infer the visible audit. Then stage the selected finding with only `findingId` and show the same draft appearing immediately in the human review surface.

End on the shareable `/audits/:id` result and show that a reload restores it.

If clipboard permission is unavailable, **Share audit** reveals and selects the same stable URL instead of ending in a dead “copy unavailable” state.
