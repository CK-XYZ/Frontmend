# Frontmend project instructions

These instructions are the working contract for contributors and coding agents in this repository.

## Product contract

Frontmend is a URL-first frontend audit and coding-agent handoff tool for humans and browser agents.

The primary journey is:

1. Submit a public URL.
2. Start an asynchronous audit.
3. Watch truthful progress.
4. Inspect findings with visible evidence.
5. Read a concise, ranked recommendation list.
6. Hand the same evidence-rich brief to a coding agent through WebMCP.
7. Let the coding agent investigate and work in the repository with its existing tools.
8. Re-audit the deployed public site for fresh evidence when appropriate.

The public judging path must require only the deployed web application. Extensions, native programs, accounts, private repositories, and local MCP servers must never be mandatory.

## Current implementation boundary

- The audit service uses PageSpeed Insights/Lighthouse when available and a bounded live-document fallback when the provider is unavailable.
- Keep evidence mode, provenance, fallback status, and measured viewport count visible and truthful.
- The current public workflow ends at the recommendation and coding-agent handoff. Never imply Frontmend inspected a repository, implemented a change, deployed a site, or proved resolution.
- Older repair contracts remain compatibility and research code; do not expose them in the live public workflow without an explicit product decision.
- Keep providers, persistence, and verification comparison behind the existing service and job boundaries rather than moving them into React or WebMCP handlers.

## Architecture

- Human UI actions and WebMCP tools must call the same application service.
- WebMCP starts jobs, checks progress, reads results, and returns the coding-agent brief. It does not perform the audit or replace the coding agent's repository tools.
- Keep audit IDs stable and duplicate starts safe.
- Keep results JSON-serialisable, versioned, bounded, and attributable to their source.
- Treat tool schemas as routing assistance; application validation remains authoritative.
- Preserve graceful human mode when `document.modelContext` is unavailable.
- Keep remote rendering, capture providers, persistence, and queues behind replaceable adapters.

## Security

- Public crawling must reject credentials, private and loopback networks, metadata endpoints, unsafe schemes, and redirects that cross into blocked targets.
- Revalidate every redirect and resolved destination on the server. Client-side URL validation is UX only and is not a security boundary.
- Apply time, byte, redirect, concurrency, and rate limits before accepting arbitrary public URLs.
- Treat target HTML, metadata, screenshots, tool results, and error strings as untrusted content.
- Never expose browser cookies, unrelated session state, internal addresses, secrets, or raw infrastructure errors.

## Visual direction

The rules below are the public design contract. Local design references may add
working context, but they are not part of the submission source of truth.

- Frontmend runs two deliberate visual systems. Do not merge them.
  - The landing (`mode === "landing"`) uses the approved mineral-cobalt field with
    bone-white display type, burnt orange for unresolved evidence, and acidic lime
    for confirmation and the primary action. It lives in `src/landing.css`, scoped
    to `.app-shell.landing`.
  - Every workspace surface — audit progress, restoration, report, `/how-it-works` —
    keeps the calm, warm-white experience adapted from the selected OpenUp
    direction, in `src/styles.css`.
- The first screen should remain focused on one dominant URL field with minimal supporting copy.
- Audit progress should feel active and trustworthy without fake technical theatre.
- Findings must connect evidence, viewport, affected target, proposed repair, and verification state visually.
- Maintain keyboard access, visible focus, reduced-motion support, responsive layouts, and useful empty/error states.
- Use the existing Phosphor dependency. Never add Lucide icons.

## Public/private boundary

- All Frontmend source is intended for a public competition repository.
- Do not copy code, assets, prompts, rules, algorithms, or proprietary implementation details from private products.
- Future local or authenticated capture must be implemented as new Frontmend code and remain optional.

## Commands and delivery

- Use Bun and retain the Socket scanner configuration in `bunfig.toml`.
- Do not start a development or preview server unless the user explicitly requests it.
- Before handoff, run `bun run build`, `bun run test`, and the relevant Cloudflare dry run.
- Do not deploy, commit, or push unless explicitly requested.
