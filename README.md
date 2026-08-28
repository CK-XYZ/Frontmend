# Frontmend

**Paste a URL. Mend the frontend.**

Frontmend is a URL-first frontend audit and repair workspace for people and browser agents. A human can start an audit from the floating URL field; a compatible agent can inspect the same evidence and stage a repair through WebMCP. Both adapters use one application service, persisted jobs, and one visible review state.

## Working product slice

- Warm-white URL-first landing adapted from the selected OpenUp visual direction.
- Validated public-URL intake with local/private target rejection in the shared client and Worker boundaries.
- Durable, asynchronous audit jobs with stable IDs, persisted progress, per-client and service-wide budgets, same-URL deduplication, and 24-hour retention.
- Real audit cancellation shared by the human control and WebMCP: the active provider request is aborted, `cancelled` is persisted as a terminal state, repeated cancellation is safe, and the same stable audit can be restarted as a numbered attempt.
- Fresh retry semantics for failed jobs: a repeated human or agent start keeps the stable workspace ID, consumes the normal rate budget, increments the visible attempt, clears stale failure state, and actually runs the provider again.
- Independent PageSpeed Insights/Lighthouse evidence for mobile and desktop, including bounded screenshots when supplied by the provider. One failed viewport no longer discards the other viewport's measured result.
- A truthful live-document fallback when Lighthouse is unavailable, plus a hybrid mode that supplements a retained single-viewport Lighthouse result with bounded public HTML and response-header evidence. Every report names unavailable strategies instead of flattening partial evidence into a total failure.
- Bounded same-site route discovery from fetched anchor paths, with explicit unvisited-route caveats and a shared human/WebMCP action whose server-authoritative parent job starts a real follow-up audit only for an observed path.
- Durable route journeys with bounded root, parent, depth, and ancestor provenance in job snapshots, reports, Markdown exports, WebMCP results, and a visible back-to-parent trail.
- Durable site-exploration missions that atomically start one to three selected observed routes, preserve a separate audit per page, aggregate recurring rule evidence, survive reload, and export a bounded cross-page report without claiming a full crawl.
- Site-aware CSP repair evidence that inventories bounded external resource origins and inline script/style usage from the fetched document, then produces a conservative Report-Only candidate without claiming runtime coverage.
- Responsive findings workspace with evidence provenance and source-specific scoring.
- Truthful high-volume Lighthouse results: the summary reports the full measured failure total, while the bounded ten-detail queue exposes its omitted count and retains every explicit rule outcome for agents and exports.
- Portable completed-audit Markdown export backed by the persisted report, with bounded escaped findings, every recorded rule outcome, provider provenance, and evidence-mode limits.
- Bounded repair drafts that may be proposed by a person or agent, but can only be approved through the visible human interface.
- A bounded human-agent revision loop: people request specific changes in the visible UI, agents submit a new complete proposal through WebMCP, and the previous versions plus feedback remain attributable.
- A source-safe repository fix brief that translates one measured finding into search hints, acceptance criteria, and authority boundaries for a coding agent that already has repository access—without uploading or exposing source to Frontmend.
- An optional repository implementation receipt after human approval: the coding agent may report only repository-relative filenames, check outcomes, a short summary, and an optional Git object ID. Passed checks complete the implementation step; failed or not-run checks remain an explicit attention state and prompt the agent to record a corrective receipt. Repeated reports retain a bounded five-receipt history, so a later pass cannot silently erase an earlier failure; the latest receipt is frozen into subsequent verification proof, while remaining explicitly agent-reported rather than source, check, deployment, or resolution evidence.
- A shared repair-mission state machine that assigns measure, draft, review, implement, deploy, and verify steps to Frontmend, the coding agent/person, or the external site owner and exposes allowed next actions through WebMCP.
- A human-only deployment-handoff gate: approval unlocks export, but a site-owner attestation is required before human or WebMCP verification can start.
- Approval-gated Markdown export with an explicit proposal-only honesty notice.
- Portable verification-receipt export with exact-rule proof, metric deltas, repository implementation provenance when recorded, audit lineage, and explicit source/check/deployment boundaries.
- Fresh repair verification that reports `resolved`, `still-present`, or `inconclusive`; resolution requires an explicit `passed` outcome for the exact original provider rule under a comparable evidence engine.
- Rule proof and summary-metric proof are deliberately separate: partial/hybrid verification requires the same Lighthouse version for an exact Lighthouse rule, while score/check/finding deltas appear only when the engine, measured strategies, score basis, and document-supplement coverage all match.
- A before/after proof receipt with baseline and fresh audit IDs plus server-derived score, passed-check, and finding deltas; the same structure is returned through WebMCP.
- A bounded audit-lineage trail that carries the exact rule across repeated repair attempts, preserves the root audit, stores each attempt's evidence signature, labels whether its summary metrics are comparable to the baseline, and compacts older history after eight receipts.
- A library of fourteen WebMCP tools covering audit start/progress/cancellation/results, repository handoff, single-route and multi-page exploration, verification receipts, repair staging/revision/implementation/workspace, and verification; only the capabilities valid for the visible page state are registered at any moment.
- Audit-scoped tools infer the visible audit when `auditId` is omitted, while retaining explicit IDs for durable or background workflows.
- A session-only WebMCP activity drawer that exposes bounded semantic tool lifecycle events while deliberately omitting tool inputs, URLs, patches, prompts, and secrets.
- An inspectable WebMCP status panel that shows the active contextual subset, explains why it changed, and keeps human-only authority visible.
- Stable audit sharing with an auto-selected manual URL fallback when clipboard access is unavailable.
- Keyboard-safe dialogs that move focus inside, contain Tab navigation, close on Escape, and restore the invoking control.
- Human and agent actions share the same audit service.
- Graceful full human experience when `document.modelContext` is unavailable.
- Cloudflare Worker, Durable Object, and static-assets packaging with native Bun tests.

## Evidence boundary

Frontmend reports only evidence returned by the current run. Each supported Lighthouse or document rule emits an explicit `passed`, `failed`, `not-applicable`, or `not-evaluated` outcome independently of the bounded findings display. `findingCount` records the full measured failure total, `findings` retains the ten highest-priority details, and `findingsOmitted` makes the difference explicit instead of silently shrinking the result. Provider responses are limited by bytes actually read, screenshots accept only bounded passive image formats, failures remain structured and recoverable, and a fallback report states that no screenshot or viewport measurement was made. CSP resource inventories accept only bounded HTTP(S) origins, exclude same-origin references already covered by `'self'`, and explicitly state that static HTML cannot reveal runtime requests, CSS imports, or every user journey.

The current slice diagnoses a deliberately narrow set of Lighthouse and document rules. Summary check counts include only those explicit supported rules, rather than every opaque audit in the upstream payload. In hybrid runs, document rules already evaluated by the retained Lighthouse strategy are omitted from findings and totals; the fetched-document profile remains available, but it never substitutes for the unavailable viewport. Verification history does not turn unlike measurements into a trend: each attempt records its evidence signature, and scores remain visible as observations while the UI and Markdown receipt explicitly withhold deltas when coverage differs from the root baseline. A repair artifact is a reviewed proposal: Frontmend does not claim it edited a third-party site. The person deploys the change through their normal source and hosting workflow, then Frontmend performs a fresh public audit. A successful local run, build, or Wrangler dry run is not a deployment or production proof.

Arbitrary Browser Rendering is intentionally not exposed as an open proxy. The audit boundary rejects private, local, credentialed, and non-HTTP targets; document redirects are revalidated and capped. A future browser-capture provider should use verified-domain authorization before accepting navigations.

No source from private products or existing MCP bridges has been copied into this repository. Future local or authenticated capture is an optional integration and must be implemented as new Frontmend code.

## Architecture

```text
Human URL form ──┐                         ┌─ PageSpeed Insights / Lighthouse
                 ├─ audit service ─ jobs ─┤
WebMCP tools ────┘                         └─ bounded live-document fallback
                                  │
                                  ├─ one visible, structured report
                                  └─ repair draft → human approval → fresh verification
```

WebMCP controls the application; it does not perform the audit itself. Both adapters start, cancel, and poll the same job, read the same structured result, explore the same observed route set, and stage against the same repair store. Related-route starts are validated inside the completed parent job, not trusted from browser memory, then carry a bounded root/parent/depth trail into the child job and export. Multi-page missions reuse that authority boundary: an atomic gate admits the whole bounded batch, every selected page remains an independent job, and the root audit retains the durable aggregate. The browser registration follows that shared state: landing exposes start, an active job exposes progress plus cancellation, and a completed document report exposes its applicable evidence, exploration, and repair actions. Human feedback unlocks revision, and a human deployment attestation unlocks verification. Agent-started jobs return a stable workspace path but do not mutate browser history during the tool call; this preserves the browser's page-change safety check, after which the agent can navigate explicitly. Human starts, observed-route audits, and verifications enter the workspace route immediately, and sharing always copies the stable audit route. WebMCP cannot approve a proposal or attest an external deployment. Each page-tool call also emits a bounded, session-only lifecycle event into the visible Agent log; the ledger records only semantic tool status and safe audit or repair references, never raw arguments. The Cloudflare runtime uses one gate Durable Object per bounded client key and one job Durable Object per audit ID. Verification uses a fresh replay-safe job tied to the approved repair and the site owner's visible deployment attestation. The Vite integration preserves that HTTP contract for local development.

## WebMCP tools

| Tool | Role |
| --- | --- |
| `start_site_audit` | Start a real asynchronous public audit. |
| `check_site_audit_progress` | Read authoritative job progress. |
| `cancel_site_audit` | Stop an active job and persist its terminal cancellation state. |
| `get_site_audit_results` | Read the bounded evidence report. |
| `get_repository_fix_brief` | Translate one finding into a source-safe repository implementation contract. |
| `start_related_page_audit` | Start a real audit for an exact same-site path observed in the visible report. |
| `start_site_exploration` | Atomically start one to three observed page audits under one durable mission. |
| `get_site_exploration` | Read mission progress and bounded recurring evidence across selected pages. |
| `get_verification_receipt` | Return portable Markdown proof for a completed verification. |
| `stage_site_repair` | Create a visible draft without changing the target site. |
| `revise_site_repair` | Submit a complete new version only after visible human feedback. |
| `get_repair_workspace` | Inspect drafts, mission progress, ownership boundaries, and allowed next actions. |
| `record_repository_implementation` | Attach bounded agent-reported filenames and check outcomes after human approval. |
| `start_repair_verification` | Re-audit an approved repair and compare the measured rule. |

## Development

Requires Bun 1.3 or newer. Dependency installation is protected by Socket's Bun security scanner through `bunfig.toml`.

`bun test` is clean-tree safe: the packaging contract always rebuilds the current Vite/Sites artifact before asserting the emitted files. `bun run test` currently runs 92 contracts.

```powershell
bun install
bun run test
bun run build
bunx wrangler deploy --dry-run
```

Do not start a development server unless the user explicitly requests it.

## Cloudflare

`wrangler.jsonc` packages the Vite client, SPA fallback, audit Worker, and Durable Object migrations. Set `PAGESPEED_API_KEY` as a Worker secret for reliable automated Lighthouse quota; keyless calls are supported but may be rate limited. No deployment is performed automatically.

For an explicitly started local Wrangler session, copy `.dev.vars.example` to `.dev.vars` and set the key only in the ignored local file. Never put a real key in the example, source, Git history, or command output.

## Verified locally

On 28 August 2026, the local app on port 3434 audited `https://removemyexif.com/` through genuine WebMCP. The landing page registered only `start_site_audit`; older completed audit `11cf031e` registered only the three applicable result and repair-workspace capabilities available before route discovery. The current bounded library has fourteen tools; this historical browser receipt predates the repository-brief and implementation-receipt additions. Earlier audit `4da1e838` proved progress-only registration before cancellation existed. After the cancellation contract landed, genuine running audit `3d5fa898` visibly exposed exactly `check_site_audit_progress` and `cancel_site_audit`, alongside the real human **Cancel audit** control, before its fast live-document run completed. Audit `b8fb882b` then proved the navigation-safe start contract: the tool returned a running job and `/audits/b8fb882b-…` while the browser remained at `/`; explicit navigation after the call restored the completed report. The bounded live-document result scored 89 and observed the missing-CSP finding after following the site's public redirect. Audit `3aa6eb20` observed `static.cloudflareinsights.com`, seven inline scripts, and fifteen inline style blocks/attributes and used those inputs in a visible Report-Only CSP candidate. Audit `f61621be`, repair `decdfde4` moved from a visible human request into agent revision 2; the corrected header placed `report-uri /csp-report` on the policy line, retained its unmet site-owner prerequisite, reopened human review, and rendered both versions plus the feedback in the revision trail. A separate sequence proved the deployment-attestation gate without falsely claiming the public site changed. This is local runtime evidence only, not a deployed-service claim.

Live cancellation audit `7c70fe45` started against a unique `removemyexif.com` URL, returned HTTP 200 cancellation while running, and restored as persisted `cancelled` state. Repeating the exact start returned HTTP 202 under the same audit ID as attempt 2, then completed with score 89 using fresh live-document evidence. This proves server cancellation and retry; the separate browser observation above proves the visible human and contextual WebMCP controls without claiming the fast browser run itself was cancelled.

Route-discovery audit `ad95d84f` observed eight bounded same-site paths from the real homepage and reported 33 additional paths as omitted without claiming any were visited. Its visible report exposed four contextual tools, including `start_related_page_audit`; a genuine WebMCP call selected the observed `/tools/remove-pdf-metadata` path and created audit `7bf9d065` with an attributable baseline ID and stable workspace. The human route button then selected `/tools` from that completed result and created audit `3f3972ab`, updating browser history to its stable route. All three runs completed with fresh public evidence, and the Markdown export carried the same route list, omission count, and unvisited-route caveat.

The server-authoritative route-journey replay started at real homepage audit `d7239dd1`, followed `/view` through the human control as audit `2856f957`, then `/privacy` as audit `31b3edab`. From that completed page, genuine WebMCP started `/terms` as audit `8265782c` and returned root, parent, depth 3, the three-entry ancestor trail, and a stable workspace path. The visible report rendered the same route trail and parent link, and its HTTP Markdown export returned 200 with the same provenance and an explicit coverage boundary. This is local runtime evidence, not a deployment claim.

Real root audit `2ed1ffcd` then proved the multi-page mission. Genuine WebMCP atomically started `/view` as audit `4dced272` and `/tools/remove-pdf-metadata` as audit `78198da6` under exploration `8bd9c892`. Both completed at score 89; the visible and agent-readable aggregate reported two pages complete, two findings, and one recurring missing-CSP rule. Reload restored the mission, its Markdown export returned HTTP 200 with both child IDs and the explicit non-crawl boundary, and the 390-pixel layout had no horizontal overflow. This remains local evidence, not a deployment claim.

Fresh audit `d09c07c9` verified the human-facing **Export report** action against the real `removemyexif.com` evidence. The local HTTP route returned 200 with a stable audit-specific filename, `text/markdown`, `no-store`, and `nosniff`; the artifact recorded score 89, eight passed checks, the failed CSP rule, all nine explicit rule outcomes, and the live-document boundary. The deployable Worker and Vite adapter now share that contract, and the mobile control rendered at 390×844 without horizontal overflow or console errors.

Audit `3e46d0a9` verified report schema 5 and the richer live-document fallback against the same public site. The visible and agent-readable profile recorded 273,662 bounded HTML bytes, 21 scripts, two stylesheets, nine images, 87 links, 72 headings, seven inline scripts, fifteen inline styles, one external origin, an absent CSP, and an observed `nosniff` header. The Markdown export carried the same profile and caveat. These are fetched-markup counts, not runtime DOM, network, screenshot, or viewport claims.

Failure replay `4d4ccb52` used the real non-HTML `removemyexif.com/robots.txt` route. Attempt 1 failed truthfully with `DOCUMENT_NOT_HTML`; a second start returned HTTP 202 under the same stable audit ID, exposed attempt 2, and ran the provider again. The target remained non-HTML, so the second attempt failed for the same measured reason rather than being presented as a recovery.

A separate dependency-free copy then proved a clean Socket-scanned `bun install --frozen-lockfile`, `bun test` with 47 passes, fresh Vite/Sites packaging, and `wrangler deploy --dry-run`. The temporary copy was removed after verification. This is reproducibility evidence, not a deployment.

Playwright then rendered the human fallback at 390×844 with no horizontal overflow or console errors. Reduced-motion emulation was active and every computed animation/transition duration was at most 0.01ms. The two QA captures live under `output/playwright/`; the favicon is a small original SVG shipped with the app.

A clipboard-denied replay proved the sharing fallback on audit `b8fb882b`: the exact `/audits/:id` URL appeared focused and fully selected, including at 390px. The full hostname and coverage score remained visible, the fallback did not overlap either, and the page had no horizontal overflow or console errors.

Keyboard replays at 390px proved the WebMCP capability panel, Agent log, and How it works sheet all focus their close control on entry, retain Tab focus inside, close on Escape, and return focus to the exact invoking button.

On visible audit `b8fb882b`, genuine WebMCP calls read results and the repair workspace with empty input objects, then staged repair `5ab83c3a` using only the finding ID. The UI immediately entered `Human decision required` with the site-aware Report-Only CSP proposal; no approval, deployment attestation, or target mutation occurred.
