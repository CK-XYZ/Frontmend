# Frontmend

**Audit the site. Fix the right things.**

Frontmend turns a public URL into a short, evidence-backed frontend improvement brief. People get a clear ranked list; a compatible coding agent receives the same findings as structured WebMCP data, then uses its normal repository, browser, and terminal tools to implement the work.

Frontmend does not try to become a code editor, approval system, deployment dashboard, or substitute for the coding agent. Its job is to measure the public site, explain the most useful work, and hand over cleanly.

## The product loop

1. Enter a public URL and choose an optional audit focus.
2. Frontmend runs an asynchronous PageSpeed Insights/Lighthouse audit plus a bounded live-document analysis.
3. The result becomes a readable, prioritised recommendation list with evidence, affected routes and viewports, target selectors or landmarks, a suggested change, and concrete acceptance criteria.
4. WebMCP returns the same information as a bounded coding-agent brief. The agent investigates and fixes the repository with the tools and permissions it already has.
5. After deployment, run the public URL through Frontmend again for fresh evidence.

The complete audit and recommendation experience remains usable when `document.modelContext` is unavailable.

## A real Codex prompt

Open the target repository in Codex, then ask:

> Hey Codex, audit the deployed frontend for this repository using Frontmend. Start a public-site audit, wait for it to finish, then read the structured recommendations. Investigate the strongest evidence in this codebase, implement the fixes that are justified, and run the repository's real checks. Do not invent source locations from the audit, and do not deploy unless I explicitly ask.

The useful WebMCP moment is the handoff: Codex receives rule IDs, retained evidence, routes, viewports, selectors, search hints, and acceptance criteria directly from Frontmend rather than scraping a visual report or receiving a giant prose dump.

## What a recommendation contains

- severity and category;
- measured or observed symptom;
- provider and exact rule ID;
- affected routes, viewports, selectors, and occurrence count;
- a concise recommended change;
- repository search hints based only on public evidence;
- acceptance criteria the coding agent can verify;
- an explicit evidence boundary.

Frontmend never fabricates filenames or line numbers. Repository ownership is established by the coding agent after the handoff.

## WebMCP

WebMCP is the browser-native control surface for the same application service used by the human interface. It does not perform the audit itself.

The live page advertises only the small set that is useful at the current point in the audit:

| State | Available actions |
| --- | --- |
| No active audit | `start_site_audit`, `get_mission_summary` |
| Audit running | `check_site_audit_progress`, `cancel_site_audit`, `get_mission_summary` |
| Audit complete | `get_site_audit_results`, `get_mission_summary` |
| Evidence available | `get_evidence_chain` |
| Retained routes available | `start_related_page_audit`, `start_site_exploration` |
| Exploration exists | `get_site_exploration` |

`get_site_audit_results` returns the compact human result plus `codingAgentBrief`. Its public continuation ends there: Frontmend tells the agent to continue in the repository with its ordinary tools, not to enter a second repair workflow.

The codebase retains the earlier 28-tool repair protocol and its deterministic tests as a compatibility and research layer. Tool-library v9 deliberately stops advertising those repair, approval, candidate-review, deployment, and verification controls in the live product path.

## Evidence boundary

Frontmend can report only what its retained audit sources support:

- Lighthouse/PageSpeed evidence stays distinct from live-document evidence.
- Partial or fallback runs remain visibly labelled.
- Browser-agent observations, where retained by older records, remain separately attributed.
- A recommendation is not proof that the repository contains a particular implementation.
- A code change, local test, build, or dry run is not proof of deployment.
- Only a fresh public audit can show what the deployed site now exposes.

The audit is deliberately bounded. It is not a complete manual accessibility review, screen-reader test, penetration test, expert SEO engagement, or exhaustive crawl.

## Architecture

```text
Human UI ────────┐                         ┌─ PageSpeed Insights / Lighthouse
                 ├─ shared audit service ─┼─ bounded live-document analysis
WebMCP tools ────┘                         └─ deterministic recommendation brief
                             │
                             ├─ FrontmendAuditGate Durable Object
                             ├─ FrontmendAuditJob Durable Object
                             └─ versioned, JSON-serialisable audit state

codingAgentBrief ──> coding agent's existing repo/browser/terminal workflow
```

The client is React 19 and Vite. The production runtime is a Cloudflare Worker with static assets and two SQLite Durable Object classes. Human actions and WebMCP tools use the same service and validation boundaries.

## Security and privacy

- Public crawling rejects credentials, private and loopback networks, metadata endpoints, unsafe schemes, and redirects into blocked targets.
- Every destination is revalidated on the server.
- Time, byte, redirect, concurrency, and rate limits apply before arbitrary URLs are accepted.
- Target HTML, metadata, screenshots, tool results, and errors are treated as untrusted input.
- Audit traces exclude raw prompts, URLs, source contents, patches, credentials, cookies, and secrets.
- PageSpeed receives the public target URL and provider options only; it never receives repository data.

## Development

Requires Bun 1.3 or newer. Dependency installation is protected by Socket's Bun security scanner through `bunfig.toml`.

```powershell
bun install --frozen-lockfile
bun run check
bun run lint
bun run test
bun run eval:webmcp-routing
bun run build
bunx wrangler deploy dist/server/index.js --dry-run --strict --config wrangler.jsonc
```

Do not start a development server unless explicitly requested.

The offline mission and routing evaluators use deterministic fixtures. They do not browse a site, inspect a repository, call PageSpeed Insights, deploy, or prove live WebMCP compatibility.

## Cloudflare

`wrangler.jsonc` packages the client, SPA fallback, audit Worker, and Durable Object migrations. Production builds embed the Git commit, build time, protocol version, tool-library version, and tool count. `GET /api/version` exposes that non-sensitive descriptor with `no-store`.

Set `PAGESPEED_API_KEY` as a Worker secret for reliable automated Lighthouse quota. Keyless calls remain supported but may be rate limited. No deployment is performed automatically.

For an explicitly started local Wrangler session, copy `.dev.vars.example` to `.dev.vars` and set the key only in the ignored file.

## Public repository

Frontmend is licensed under Apache-2.0. See `CONTRIBUTING.md`, `SECURITY.md`, and `THIRD_PARTY_NOTICES.md` before contributing or reporting a vulnerability.
