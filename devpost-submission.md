# Title

Frontmend

## One-line summary

Frontmend turns a public website audit into a useful human recommendation list and an evidence-rich brief a coding agent can act on through WebMCP.

## The problem

Frontend audit tools and coding agents are individually useful, but the handoff between them is poor. Audit output is usually a score dashboard or a long report written for people. The coding agent then has to scrape that interface, interpret screenshots, or work from a copied summary that has lost the exact rule, route, viewport, target, and evidence.

Duplicating the coding agent's repository workflow inside the audit tool creates a different problem: extra approval states, checklists, and simulated deployment steps without improving the actual fix. Coding agents already know how to inspect repositories, edit files, run tests, and work within the person's existing permissions.

## What Frontmend does

A person enters one public URL. Frontmend runs an asynchronous PageSpeed Insights/Lighthouse audit plus a bounded live-document analysis, then turns the retained evidence into a short ranked list.

Each recommendation keeps the useful context together:

- what was observed and why it matters;
- severity, category, provider, and exact rule ID;
- affected routes and viewports, plus selectors when available and the occurrence count;
- a concise recommended change;
- repository search hints derived only from public evidence;
- concrete acceptance criteria;
- an explicit statement of what Frontmend did not inspect or prove.

The human result is a readable editorial document, not a workflow dashboard. Frontmend then offers one clean handoff to the coding agent. The current public workflow ends there: the agent continues in the repository with its normal tools, while Frontmend does not mirror the patch, request approval checkboxes, or pretend to deploy the site. After a real deployment, the public URL can be audited again for fresh evidence.

## How WebMCP is used

WebMCP makes the webpage an active, structured participant in the coding workflow.

From a natural request, a compatible agent can discover the actions available in the current page state, start the same audit as the human interface, poll truthful progress, read the results, and receive a bounded `codingAgentBrief`. The agent does not need to scrape the DOM or infer the workflow from buttons.

The `get_site_audit_results` tool returns ranked recommendations with retained evidence, exact audit rule IDs and provider provenance, routes, viewports, available selectors, search hints, acceptance criteria, and a clear repository boundary. That is the final Frontmend action. Repository inspection and implementation continue through Codex's ordinary file, browser, and terminal capabilities.

The live page advertises only the contextual audit and handoff actions that are useful now:

- start, poll, or cancel an audit;
- read a compact mission summary;
- read structured audit results and the coding-agent brief;
- inspect an evidence chain for a retained finding;
- optionally audit one retained related route or a bounded set of observed routes.

Human and WebMCP actions call the same application service and validation logic. The full human audit remains usable when WebMCP is unavailable.

## Why this matters

Frontmend uses WebMCP where it has genuine leverage: converting a human-facing web product into a reliable tool surface for an agent without turning the web product into an agent-only API.

The person gets a clearer, prioritised audit result. The coding agent gets better context. Neither has to learn a second repair product, and Frontmend does not ask for repository source or credentials.

## How it was built

- React 19 and Vite for the public interface.
- Bun for package management, tests, linting, and builds, with Socket's Bun security scanner enabled.
- A Cloudflare Worker and SQLite Durable Objects for asynchronous audit jobs, rate limits, stable IDs, cancellation, and retained state.
- PageSpeed Insights/Lighthouse plus a bounded live-document fallback behind replaceable evidence adapters.
- Versioned JSON-serialisable contracts shared by the human interface and WebMCP tools.
- Phosphor icons and two deliberate visual systems: a mineral-cobalt landing and a warm editorial audit workspace.

Codex was the primary development collaborator and the intended repository-aware user. It helped shape the product boundary, implement contracts across the client and Worker, test WebMCP routing, and challenge unsupported claims about source ownership, deployment, and resolution.

## Key features

- URL-first public-site audit with no account required for the first run.
- Concurrent mobile, desktop, and live-document evidence with visible partial/fallback modes.
- Durable asynchronous jobs, safe same-URL deduplication, cancellation, retry, and stable audit URLs.
- A concise ranked recommendation document for people.
- A deterministic bounded `codingAgentBrief` shared by the UI and WebMCP.
- Exact evidence provenance and no fabricated repository filenames or line numbers.
- Contextual WebMCP registration rather than a permanent wall of tools.
- Server-side public-target validation, redirect revalidation, and resource/rate limits.
- Complete human fallback when `document.modelContext` is unavailable.
- In the public workflow, a fresh re-audit is the only path to new public-site evidence after deployment.

## Architecture

```text
Human UI ────────┐                         ┌─ PageSpeed Insights / Lighthouse
                 ├─ shared audit service ─┼─ bounded live-document analysis
WebMCP tools ────┘                         └─ deterministic recommendation brief
                             │
                             ├─ FrontmendAuditGate Durable Object
                             ├─ FrontmendAuditJob Durable Object
                             └─ versioned audit state

codingAgentBrief ──> coding agent's existing repo/browser/terminal workflow
```

## Suggested demo prompt

> Hey Codex, audit the deployed frontend for this repository using Frontmend. Start a public-site audit, wait for it to finish, then read the structured recommendations. Investigate the strongest evidence in this codebase, implement the fixes that are justified, and run the repository's real checks. Do not invent source locations from the audit, and do not deploy unless I explicitly ask.

## Judge path

1. Open `https://frontmend.dev/` with WebMCP available and confirm the landing page exposes the audit start action.
2. Start an audit through natural language or the URL field. Confirm the same stable job and truthful progress are visible to both interfaces.
3. Open the completed audit and inspect the ranked recommendation list, including one expanded exact-evidence section.
4. Read the result through WebMCP and inspect `codingAgentBrief`. Confirm it carries the same recommendations plus structured evidence and acceptance criteria, without invented repository ownership.
5. In the recorded demo, continue in a controlled target repository with normal coding tools. Confirm the public Frontmend workflow does not expose approval, candidate-review, deployment, or source-upload controls.

Detailed timing and narration are in `DEMO_SCRIPT.md`.

## Local reproducibility

```powershell
bun install --frozen-lockfile
bun run check
bun run lint
bun run test
bun run eval:webmcp-routing
bun run build
bunx wrangler deploy dist/server/index.js --dry-run --strict --config wrangler.jsonc
```

These commands prove local contracts and packaging only. They do not prove deployment, provider availability, browser compatibility, or a production result.

## Known limitations

- Frontmend is a bounded automated audit, not a complete manual accessibility review, screen-reader test, penetration test, expert SEO engagement, or exhaustive crawl.
- The live-document fallback cannot observe runtime DOM changes, every request, user journeys, or viewport rendering.
- Repository investigation requires an external coding agent that already has authorised repository access.
- Search hints are starting points from public evidence, not source ownership claims.
- Frontmend does not edit, commit, push, deploy, or prove that a local code change reached production.

## Submission links

- Live URL: `https://frontmend.dev/`
- Public repository: `https://github.com/CK-XYZ/Frontmend`
- Public YouTube demo: `https://youtu.be/hCmA5rFoTr0`

Before submission, verify the exact deployed build identity, unauthenticated judge access, public repository visibility and licence, current WebMCP behaviour, responsive/browser QA, and the final public video. Nothing in this document claims those checks have already passed.

## Official form fields still requiring owner input

- Submitter type
- Country of residence
- App status
- Agents/clients tested on the final deployed build
- Learning level
- Career AI value
