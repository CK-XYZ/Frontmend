# Frontmend submission readiness

Last audited: 29 August 2026 (Australia/Perth)

This is an evidence ledger, not a launch claim. A checked item identifies the proof available now; unchecked items require external delivery or a fresh clean-environment test.

The current local candidate receipt, deployment prerequisites, and exact fresh-session verification procedures are in [RELEASE_CANDIDATE.md](./RELEASE_CANDIDATE.md).

Authoritative sources rechecked on 29 August 2026: [Devpost Official Rules](https://webmcp.devpost.com/rules), [Devpost challenge page](https://webmcp.devpost.com/), and [OpenAI challenge page](https://openai.com/webmcp-challenge/). The Official Rules and Devpost deadline currently say **3 September 2026 at 1:00 p.m. PT**; they prevail over the later time displayed on one OpenAI promotional section.

## Core product

- [x] Public URL intake rejects local, private, credentialed, IPv6-literal, and unsafe-scheme targets.
- [x] Asynchronous audit jobs return stable IDs and truthful progress.
- [x] Failed audits can be retried by people or agents without replaying the deduplicated failure; attempts remain rate-limited, numbered, and attached to the stable workspace.
- [x] Active audits can be cancelled by a person or agent through the shared service; provider abort, persisted `cancelled` state, idempotent replay, retention, and same-ID retry are covered in both runtimes.
- [x] Human UI and WebMCP use the same application service and Worker routes.
- [x] Mobile and desktop Lighthouse requests run independently; successful viewport evidence survives a sibling failure, with a labelled hybrid document supplement or truthful partial-Lighthouse result.
- [x] Live-document fallback emits a bounded schema-5 Document profile with element counts, inline-code counts, external-origin inventory, and observed response-header signals; it remains explicit about omitted runtime and viewport evidence.
- [x] Completed document reports expose bounded unique same-site route paths, an omitted count, and an unvisited-route caveat; the retained parent job authoritatively validates every human or agent follow-up and persists bounded root/parent/depth lineage into the child.
- [x] A durable site-exploration mission atomically admits one to three selected observed routes, retains independent child audits, aggregates recurring rule evidence, survives reload, and exports a bounded non-crawl report.
- [x] Missing-CSP findings include a bounded static resource-origin inventory and generate a site-aware Report-Only draft that avoids blanket inline-script weakening.
- [x] Evidence is bounded, versioned, source-attributed, and marked untrusted to agents.
- [x] Lighthouse result bounding is explicit: supported-rule check counts, the complete supported failure total, retained ten-detail queue, omitted count, and full supported rule-outcome record remain distinct across UI, JSON, and Markdown; hybrid totals omit overlapping document rules.
- [x] Agents can stage a repair proposal without changing the target site.
- [x] Coding agents can request a source-safe repository fix brief with measured evidence, bounded same-rule occurrences, every failing measured strategy, ownership hints, and cross-viewport acceptance criteria; the visible report exposes the same repair scope, while Frontmend does not receive repository source or absolute paths.
- [x] People can request bounded, visible changes; agents can revise only after that request, and each new proposal re-enters human review with a five-version history cap.
- [x] Approval is absent from WebMCP and requires explicit confirmation in the visible UI.
- [x] Verification remains blocked after approval until a person explicitly attests the reviewed change was deployed; WebMCP cannot grant or bypass that attestation.
- [x] Repair missions expose the same step ownership and allowed next actions through HTTP, WebMCP, and the visible UI.
- [x] After human approval, a coding agent can attach a bounded implementation receipt containing only repository-relative files, check outcomes, a summary, and optional Git object ID; only all-passed reported checks complete the implementation mission step, while failed/not-run evidence stays in an attention state with a corrective agent action. Repeated reports retain five prior receipts so failures cannot be silently overwritten, and the latest receipt is frozen into verification without being promoted to source, check, deployment, or resolution proof.
- [x] Approved plans export as Markdown with an explicit proposal-only notice.
- [x] Completed audits export as bounded Markdown with escaped provider text, rule-level provenance, and evidence-mode limits through the visible report workspace.
- [x] Repair verification uses a fresh replay-safe audit; `resolved` requires an explicit pass for the exact original rule.
- [x] Verification separates exact-rule comparability from whole-report metric comparability: partial/hybrid Lighthouse proof requires the same version and strategy, while score/check/finding deltas are withheld whenever audit coverage differs.
- [x] Verification emits a visible and agent-readable before/after receipt with audit provenance, metric deltas, and the frozen repository implementation receipt when one was recorded.
- [x] Repeated same-rule repairs retain a bounded audit lineage with root preservation, per-attempt evidence signatures and baseline metric-comparability verdicts, plus compaction after eight receipts.
- [x] Completed verification proof exports as bounded Markdown through both a human download and semantic WebMCP tool.
- [x] Browser-agent calls emit a bounded, session-only visible activity ledger that excludes inputs, URLs, patches, prompts, and secrets.
- [x] Provider payloads are byte-bounded, evidence images are passively allowlisted, jobs expire, and the provider has per-client plus service-wide budgets.
- [x] Stable `/audits/:id` routes restore completed and in-progress jobs after reload.
- [x] WebMCP registration follows visible application state and removes inapplicable tools as the audit, review, and verification mission changes.
- [x] The WebMCP status is inspectable: its visible panel names active tools, explains the current-state boundary, and states which authority remains human-only.
- [x] The complete human interface remains usable without WebMCP.

## Current proof receipt

- [x] `bun test`: 93 passing tests across service, provider, route-lineage, cross-page exploration, repair, Worker, local-runtime, and WebMCP contracts; the packaging contract rebuilds current source before artifact assertions.
- [x] `bun run build`: Vite client and bundled Worker artifact emitted successfully.
- [x] `bunx wrangler deploy --dry-run`: static assets plus both Durable Object bindings recognized.
- [x] Clean-copy receipt: Socket-scanned `bun install --frozen-lockfile`, `bun test` (47 passes including a fresh Vite/Sites build), and Wrangler dry-run all passed without an existing `node_modules` or `dist`.
- [x] In-app-browser contextual WebMCP discovery on port 3434: landing exposed only `start_site_audit`; that historical receipt predates the current fourteen-tool library, and completed reports still register only their applicable result, exploration, and repair capabilities.
- [x] Dynamic lifecycle proof on genuine audit `3d5fa898`: the running page advertised exactly `check_site_audit_progress` plus `cancel_site_audit`, rendered the human **Cancel audit** control, then removed both and exposed the three applicable completed-report capabilities.
- [x] Live cancellation proof `7c70fe45`: a real `removemyexif.com` run returned and restored persisted `cancelled` state; a repeated start returned HTTP 202 under the same ID as attempt 2 and completed with score 89 using fresh live-document evidence.
- [x] Real site-exploration proof: homepage audit `ad95d84f` exposed eight observed paths plus 33 omitted; WebMCP started `/tools/remove-pdf-metadata` as audit `7bf9d065`, and the human route control started `/tools` as audit `3f3972ab`. The baseline ID, stable paths, visible state, exported caveat, and zero browser console errors were verified.
- [x] Durable route-journey proof: real audits `d7239dd1` → `2856f957` (`/view`) → `31b3edab` (`/privacy`) used visible controls, then genuine WebMCP started `8265782c` (`/terms`) at depth 3. Structured output, visible ancestor trail, parent link, and HTTP 200 Markdown provenance matched.
- [x] Real cross-page mission proof: root `2ed1ffcd`, exploration `8bd9c892`, and child audits `4dced272` plus `78198da6` completed through genuine WebMCP. UI, reload, structured result, recurring missing-CSP evidence, HTTP 200 export, and 390px no-overflow layout matched.
- [x] Navigation-safe WebMCP proof on genuine audit `b8fb882b`: start returned a running job plus its stable workspace path while the current page remained `/`; explicit post-call navigation restored the completed report without triggering the browser's page-change rejection.
- [x] Playwright mobile receipt at 390×844: no horizontal overflow, no console errors, Human mode remained fully usable, and its contextual-capability panel fit the viewport.
- [x] Reduced-motion receipt: emulated preference matched, maximum computed animation and transition durations were both 0.01ms, with zero elements exceeding 1ms.
- [x] Clipboard-denied sharing receipt on audit `b8fb882b`: the stable workspace URL appeared focused and fully selected; desktop and 390px layouts remained usable with no overlap, overflow, or console errors.
- [x] Dialog keyboard receipt at 390px: capability, Agent log, and explainer dialogs moved focus inside, contained Tab, closed on Escape, restored their trigger, and emitted no console errors.
- [x] Current-context WebMCP proof on audit `b8fb882b`: results and workspace calls succeeded with `{}`, and repair `5ab83c3a` staged using only `findingId`; the visible UI matched the returned human-review mission.
- [x] Portable audit-report proof on real audit `d09c07c9`: visible **Export report**, HTTP 200 Markdown, stable filename, `no-store`, `nosniff`, complete rule-outcome table, and explicit live-document boundary; 390×844 replay had no overflow or console errors.
- [x] Live Document-profile proof on real audit `3e46d0a9`: schema 5 JSON and visible UI matched 273,662 HTML bytes, 21 scripts, two stylesheets, nine images, 87 links, 72 headings, one external origin, CSP missing, and `nosniff` observed; Markdown export carried the same bounded profile and caveat.
- [x] Post-contract live replay `9e89fd1b`: completed on port 3434 with schema 5, one measured finding, one retained detail, `findingsOmitted: 0`, and the live Document profile; the synthetic 30-failure contract separately proved ten retained plus twenty explicitly omitted.
- [x] Live failed-retry proof `4d4ccb52`: real `removemyexif.com/robots.txt` attempt 1 returned `DOCUMENT_NOT_HTML`; retry returned HTTP 202 under the same ID, advanced to attempt 2, and performed a new run that truthfully failed for the same non-HTML evidence.
- [x] Live local run on port 3434 against `www.removemyexif.com`: baseline plus two human-reviewed verification attempts observed as one three-audit lineage in both UI and structured API output.
- [x] Live mission on audit `51fc1996`: unstaged, awaiting-human-review, and ready-for-site-handoff states observed; structured workspace matched the visible ownership model.
- [x] Verification receipt on audit `0ba83355`: visible export action and HTTP 200 Markdown download with exact-rule, metric, lineage, and boundary evidence observed.
- [x] Genuine in-app-browser WebMCP sequence on audit `bede0476`: start, progress, and results calls all appeared as successful entries in the visible Agent log with no raw arguments recorded.
- [x] Deployment gate on audit `f40f45cb` and repair `ab0784ab`: visible approval advanced to `Waiting for site owner`; premature WebMCP verification returned and logged `DEPLOYMENT_NOT_ATTESTED`. No false deployment attestation was made.
- [x] Site-aware CSP proof on audit `3aa6eb20` and repair `b62ba728`: the visible and WebMCP evidence matched one external script origin, seven inline scripts, and fifteen inline style blocks/attributes from the real `removemyexif.com` document.
- [x] Human-agent revision proof on current audit `f61621be`, repair `decdfde4`: visible feedback produced agent revision 2, reopened review, and rendered both proposal versions plus the request in bounded UI/API history.
- [x] Clean-checkout installation and build receipt.
- [x] Rendered narrow-viewport and reduced-motion browser receipt.
- [x] Production deployment receipt: `https://frontmend.test.knightware.xyz/` serves commit `88b0b7e` as Cloudflare Worker version `80ac7ced-4c8d-4cc3-ade4-5fd1a90873b6`; public DNS, valid HTTPS, final hashed assets, SPA restoration, structured private-target rejection, and Durable Object execution were verified.
- [x] Production security/WebMCP headers: `Origin-Agent-Cluster: ?1`, `Permissions-Policy: tools=(self)`, CSP, `nosniff`, frame denial, and strict-origin referrer policy are present on the public origin.
- [x] Production PageSpeed API-key path: secret version `72b82cc8-61bf-4fd9-9ff1-06593fd6d78b`; final audit `67b15094-2878-488b-b134-9088c60ce208` returned Lighthouse 13.4.1 mobile and desktop evidence, score 97, zero findings, zero viewport failures, accessibility 100 and best practices 100 in both strategies, with no fallback.
- [x] Final production Chrome smoke receipt: exact assets `index-BJ5D1pIW.css` and `index-Ba57YJQT.js`, intended security/WebMCP headers, and zero console errors or warnings.
- [x] Current-session production Codex WebMCP receipt: landing exposed only `start_site_audit`; call `884d30d6` returned a stable workspace without navigation; the workspace exposed exactly progress/cancel while running and then the four applicable completed tools. `get_site_audit_results` returned live Lighthouse 13.4.1 evidence for two viewports, score 96, six findings, and zero viewport failures; `{ "unexpected": true }` returned structured `INVALID_INPUT` without changing state. This is deployed lifecycle proof, but it is not the still-required fresh-session ChatGPT or Chrome receipt.

## Competition delivery

- [x] Valid Apache-2.0 project licence.
- [x] Direct dependency and external-service notice.
- [x] Reproducible local setup instructions.
- [x] Tracked publication preflight: no credential-like filenames, common token/private-key signatures, or absolute user-home paths detected; `.env*` and Cloudflare `.dev.vars*` secrets are ignored with safe examples explicitly allowlisted.
- [ ] Public source repository and challenge-period commit history.
- [x] Working public deployment with a stable judging URL.
- [ ] Production URL verified in ChatGPT's in-app browser.
- [ ] Production URL verified in the supported Chrome WebMCP path.
- [ ] Free judging access confirmed through the full judging window.
- [ ] Final English Devpost description.
- [ ] Public YouTube demo under three minutes with clear audio.
- [x] Exact deployed revision, repository revision, and final test receipt recorded.

## Release blockers

1. The deployed source is committed locally, but the public remote, push, and challenge-period history are not yet prepared.
2. Local application commit `b94f624` adds the verified cross-viewport repair scope but is newer than deployed application commit `88b0b7e`.
3. The production deployment must be exercised through WebMCP from fresh ChatGPT and Chrome sessions before any submission claim.
4. Video capture, narration, upload, and Devpost submission remain external deliverables.
