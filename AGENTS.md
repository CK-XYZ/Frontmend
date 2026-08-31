# Frontmend project instructions

These instructions extend the repository-root `AGENTS.md` for work inside `Ideas/Frontmend/`.

## Product contract

Frontmend is a URL-first frontend audit and repair tool for humans and browser agents.

The primary journey is:

1. Submit a public URL.
2. Start an asynchronous audit.
3. Watch truthful progress.
4. Inspect findings with visible evidence.
5. Stage and preview a repair.
6. Verify the repair across relevant conditions.
7. Export a patch or evidence report after human review.

The public judging path must require only the deployed web application. Extensions, native programs, accounts, private repositories, and local MCP servers must never be mandatory.

## Current implementation boundary

- The audit service uses PageSpeed Insights/Lighthouse when available and a bounded live-document fallback when the provider is unavailable.
- Keep evidence mode, provenance, fallback status, and measured viewport count visible and truthful.
- Repair drafts are proposals only. Never imply Frontmend changed an unrelated public site; only claim resolution after a comparable fresh audit no longer observes the original rule.
- Keep providers, persistence, and verification comparison behind the existing service and job boundaries rather than moving them into React or WebMCP handlers.

## Architecture

- Human UI actions and WebMCP tools must call the same application service.
- WebMCP starts jobs, checks progress, reads results, and later operates the visible review workflow. It does not perform the audit itself.
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

`DESIGN.md` is the design-system reference: tokens, typography, motion, layering,
component patterns, and the accessibility invariants that tests lock. Read it
before any visual work. `design-qa.md` is the separate verification log.

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
