# Frontmend demo script

Target length: 2 minutes 30 seconds. Use a real public deployment whose repository is already open in Codex. Keep Frontmend visible at the beginning and return to the completed result near the end.

## The prompt

> Hey Codex, audit the deployed frontend for this repository using Frontmend. Start a public-site audit, wait for it to finish, then read the structured recommendations. Investigate the strongest evidence in this codebase, implement the fixes that are justified, and run the repository's real checks. Do not invent source locations from the audit, and do not deploy unless I explicitly ask.

Do not mention WebMCP tool names in the spoken prompt. Discovery is part of the demonstration.

## 0:00–0:20 — The problem

Show the target site and its repository, then open Frontmend's URL-first landing page.

Narration:

> Audit tools find problems. Coding agents can fix them. The awkward part is getting useful, trustworthy evidence from the live site into the agent's coding workflow.

Send the prompt in Codex.

## 0:20–0:55 — One audit, two interfaces

Let Codex discover `start_site_audit` and start the same asynchronous audit available through the URL field. Briefly show truthful running progress and the small contextual WebMCP action set.

Narration:

> WebMCP means Codex does not need to scrape this interface or guess which button advances the audit. The page exposes the exact actions and structured results; the same application service powers the human UI.

Do not spend time narrating tool schemas or raw Lighthouse scores.

## 0:55–1:30 — The useful result

When the audit completes, show the new recommendation document:

- the concise verdict and run facts;
- the ranked fixes;
- evidence and recommended change together;
- affected routes, viewports, and targets;
- one expanded **Exact audit evidence** disclosure;
- the **Done when** criteria.

Narration:

> A person gets a useful list, not a dashboard full of workflow state. Each recommendation keeps its exact rule, target, condition, and acceptance criteria attached.

Show **Copy coding-agent brief** once, then return to Codex.

## 1:30–2:05 — The WebMCP advantage

Let Codex call `get_site_audit_results`. Show enough of `codingAgentBrief` to make these fields legible:

- ranked recommendation;
- retained evidence;
- exact source rule;
- route, viewport, and selector;
- repository search hints;
- acceptance criteria;
- evidence boundary.

Narration:

> This is the WebMCP value: the same result becomes machine-usable context without page scraping, screenshot interpretation, or a copied wall of prose. Frontmend stops at the repository boundary.

The agent should now inspect the actual repository with its normal tools. If it finds that a search hint does not map to the implementation, it must follow repository evidence rather than treating the hint as a filename claim.

## 2:05–2:25 — Real coding work

Show Codex locating the owning code, making one justified change, and running the project's real checks. Keep this as a quick montage; Frontmend is not a code editor and does not need to mirror the patch.

Narration:

> Codex already knows how to inspect, edit, and test code. Frontmend gives it better live-site evidence, then gets out of the way.

Do not imply that a local fix is deployed or that the issue is resolved.

## 2:25–2:30 — Close

Return to the Frontmend result and its audit/agent handoff.

Closing line:

> Useful for people. Structured for coding agents. One public URL to the right frontend work.

## Optional ending after a real deployment

Only if the change was genuinely deployed before recording, run a fresh Frontmend audit and compare the new public evidence. Say “the fresh audit no longer observed the rule”, not “Frontmend deployed or fixed the site”.

## Do not use a take that

- shows repair approval, candidate-review, deployment-attestation, or checkbox workflow UI;
- treats a score alone as the product result;
- invents repository files or source ownership from a public audit;
- presents agent interpretation as provider measurement;
- claims a local edit, test, build, or dry run reached production;
- hides a partial provider or fallback evidence mode;
- depends on WebMCP for the human result to remain usable.
