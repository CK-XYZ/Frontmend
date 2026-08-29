# Frontmend submission readiness

Last audited: 30 August 2026 (Australia/Perth)

This is an evidence ledger, not a launch claim. A checked item identifies the proof available now; unchecked items require external delivery or a fresh clean-environment test.

The current local candidate receipt, deployment prerequisites, and exact fresh-session verification procedures are in [RELEASE_CANDIDATE.md](./RELEASE_CANDIDATE.md).

Authoritative sources rechecked on 29 August 2026: [Devpost Official Rules](https://webmcp.devpost.com/rules), [Devpost challenge page](https://webmcp.devpost.com/), and [OpenAI challenge page](https://openai.com/webmcp-challenge/). The Official Rules and Devpost deadline currently say **3 September 2026 at 1:00 p.m. PT**; they prevail over the later time displayed on one OpenAI promotional section.

## Core product

- [x] Public URL intake rejects local, private, credentialed, IPv6-literal, and unsafe-scheme targets.
- [x] Asynchronous audit jobs return stable IDs and truthful progress.
- [x] Failed audits can be retried by people or agents without replaying the deduplicated failure; attempts remain rate-limited, numbered, and attached to the stable workspace.
- [x] Active audits can be cancelled by a person or agent through the shared service; provider abort, persisted `cancelled` state, idempotent replay, retention, and same-ID retry are covered in both runtimes.
- [x] Human UI and WebMCP use the same application service and Worker routes.
- [x] Natural accessibility/SEO requests persist a bounded **Assess** mission with no raw prompt, survive retry/reload, and return at most three deduplicated priorities through both the visible workspace and structured WebMCP result.
- [x] Agent-started accessibility/SEO audits require a persisted, ordered rendered-browser review after provider measurement. Each exact check accepts only direct observations, bounded issues, or an honest browser blocker and remains resumable without claiming complete manual or assistive-technology coverage.
- [x] Browser-observed issues are separately attributed, ranked beside provider findings, and accepted by the same repository brief, diagnostic, repair, receipt, and fresh-verification contracts.
- [x] Audit completion and assessment completion are distinct: browser review and any supported repository diagnosis must complete before a receipt or repair staging can become eligible.
- [x] A capable agent that cannot access or reconcile the required browser/repository evidence can record one bounded diagnostic blocker instead of inventing ownership. The measured finding stays unresolved, visible, receipt-ineligible, repair-ineligible, and resumable by a later capable session with blocker history retained.
- [x] A completed assessment exposes one contextual structured/Markdown receipt with the retained mission, ranked provider evidence, a separate agent-contributed browser-review section, diagnostic contributions, and an explicit no-repair/no-deployment authority boundary; incomplete assessments cannot export it.
- [x] Mobile and desktop Lighthouse requests run independently; successful viewport evidence survives a sibling failure, with a labelled hybrid document supplement or truthful partial-Lighthouse result.
- [x] Live-document fallback emits a bounded schema-5 Document profile with element counts, inline-code counts, external-origin inventory, and observed response-header signals; it remains explicit about omitted runtime and viewport evidence.
- [x] Completed document reports expose bounded unique same-site route paths, an omitted count, and an unvisited-route caveat; the retained parent job authoritatively validates every human or agent follow-up and persists bounded root/parent/depth lineage into the child.
- [x] A durable site-exploration mission atomically admits one to three selected observed routes, retains independent child audits, aggregates recurring rule evidence, survives reload, and exports a bounded non-crawl report.
- [x] Missing-CSP findings include a bounded static resource-origin inventory and generate a site-aware Report-Only draft that avoids blanket inline-script weakening.
- [x] Evidence is bounded, versioned, source-attributed, and marked untrusted to agents.
- [x] Lighthouse result bounding is explicit: supported-rule check counts, the complete supported failure total, retained ten-detail queue, omitted count, and full supported rule-outcome record remain distinct across UI, JSON, and Markdown; hybrid totals omit overlapping document rules.
- [x] A person or agent acting on an explicit request must first record **Prepare a fix** intent for one retained finding; only then can an eligible repair proposal be staged without changing the target site.
- [x] Repair preparation is idempotent for the selected finding, rejects conflicting or stale replacement, consumes no delegated-auto allowance, creates no approval, and cannot deploy or attest deployment.
- [x] Coding agents can request a source-safe repository fix brief with measured evidence, bounded same-rule occurrences, every failing measured strategy, ownership hints, and cross-viewport acceptance criteria; the visible report exposes the same repair scope, while Frontmend does not receive repository source or absolute paths.
- [x] Coding agents can attach a bounded pre-approval repository plan containing only relative target files and planned checks; it is visible to the person, revisioned, agent-readable, exported with the reviewed proposal, and frozen into final verification provenance. Human-authored metadata, absolute paths, source contents, credentials, and environment values are rejected or excluded.
- [x] People can request bounded, visible changes; agents can revise only after that request, and each new proposal re-enters human review with a five-version history cap.
- [x] In review mode, approval is absent from WebMCP and requires explicit confirmation in the visible UI.
- [x] A person may instead enable an audit-scoped delegated-auto policy in the visible UI. It is capped at three agent-authored low-risk HTML/CSS plans with repository files and checks; the agent cannot create or widen the grant, and deployment attestation remains person-only.
- [x] Verification remains blocked after approval until a person explicitly attests the reviewed change was deployed; WebMCP cannot grant or bypass that attestation.
- [x] Repair missions expose the same step ownership and allowed next actions through HTTP, WebMCP, and the visible UI.
- [x] After human approval, a coding agent can attach a bounded implementation receipt containing only repository-relative files, check outcomes, a summary, and optional Git object ID; only all-passed reported checks complete the implementation mission step, while failed/not-run evidence stays in an attention state with a corrective agent action. Repeated reports retain five prior receipts so failures cannot be silently overwritten, and the latest receipt is frozen into verification without being promoted to source, check, deployment, or resolution proof.
- [x] Approved plans export as Markdown with an explicit proposal-only notice.
- [x] Completed audits export as bounded Markdown with escaped provider text, rule-level provenance, and evidence-mode limits through the visible report workspace.
- [x] Repair verification uses a fresh replay-safe audit; `resolved` requires every captured mobile, desktop, or document occurrence of the original measured rule to pass explicitly. One passing strategy cannot hide a sibling failure or missing comparison.
- [x] The frozen rule scope and per-strategy fresh outcomes are visible in the repair and verification workspaces, returned as structured WebMCP data, and preserved in both reviewed-plan and verification Markdown exports.
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

- [x] `bun test`: 147 passing tests across browser review, mission, assessment receipt, diagnostic blocker, service, provider, route-lineage, cross-page exploration, repair, Worker, local-runtime, and WebMCP contracts; the packaging contract rebuilds current source before artifact assertions.
- [x] `bun run build`: 4,578 Vite modules transformed; current client assets `index-BYWFuMOk.css` and `index-Cg_dC0xN.js`, bundled Worker, and Sites metadata emitted successfully.
- [x] `bunx wrangler deploy --dry-run --strict --config wrangler.jsonc`: Wrangler 4.126.0 read five static assets, recognised `AUDIT_GATE`, `AUDIT_JOBS`, and `ASSETS`, and produced a 251.58 KiB raw / 54.28 KiB gzip bundle without upload.
- [x] Command-safe release gate ran from tracked revision `7fa65b1b7062bd0a2ee09046628d8a66c5f44228`; worktree and whitespace checks were clean before and after.
- [x] Wrangler type generation retained binding hash `1fceb1fc38391a32e57618cd2bbf1564`; exact `types --check` remains a documented warning because Wrangler 4.126.0 changes its generated command banner and inserts six trailing spaces. Strict dry-run binding discovery is the current packaging proof.
- [x] Clean-copy receipt: Socket-scanned `bun install --frozen-lockfile`, `bun test` (47 passes including a fresh Vite/Sites build), and Wrangler dry-run all passed without an existing `node_modules` or `dist`.
- [x] In-app-browser contextual WebMCP discovery on port 3434: landing exposed only `start_site_audit`; that historical receipt predates the current twenty-one-tool library and the ordered browser-review transition, so it is not current-candidate browser proof.
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
- [x] Historical pre-preparation WebMCP proof on audit `b8fb882b`: results and workspace calls succeeded with `{}`, and repair `5ab83c3a` staged using only `findingId`; the visible UI matched that older human-review contract. This does not prove the current explicit preparation transition.
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
- [x] Production deployment receipt: `https://frontmend.test.knightware.xyz/` serves application commit `a20e1ff` as Cloudflare Worker version `c04eb2e0-780b-4ee6-978f-876692784108`; valid HTTPS, current hashed assets, SPA restoration, security/WebMCP headers, structured private-target rejection, and the fresh audit Durable Object path were verified.
- [x] Production security/WebMCP headers: `Origin-Agent-Cluster: ?1`, `Permissions-Policy: tools=(self)`, CSP, `nosniff`, frame denial, and strict-origin referrer policy are present on the public origin.
- [x] Production PageSpeed API-key path on the current deployment: secret version `72b82cc8-61bf-4fd9-9ff1-06593fd6d78b`; final audit `cac6da7e-ca38-4084-a0e1-c5e181451432` returned Lighthouse 13.4.1 mobile and desktop evidence, score 98, 22 passed checks, zero findings, zero viewport failures, accessibility 100 and best practices 100 in both strategies, with no fallback.
- [x] Public HTTP smoke on current assets `index-BR_ayGCH.css` and `index-CkJVqSRf.js`: both returned 200 with their expected content types; intended security/WebMCP headers and SPA restoration were present.
- [ ] Fresh Chrome console smoke on the current deployed asset hashes; the zero-error browser receipt for `index-BJ5D1pIW.css` and `index-Ba57YJQT.js` belongs to the prior deployment.
- [x] Current-session production Codex WebMCP receipt: landing exposed only `start_site_audit`; call `884d30d6` returned a stable workspace without navigation; the workspace exposed exactly progress/cancel while running and then the four applicable completed tools. `get_site_audit_results` returned live Lighthouse 13.4.1 evidence for two viewports, score 96, six findings, and zero viewport failures; `{ "unexpected": true }` returned structured `INVALID_INPUT` without changing state. This is deployed lifecycle proof, but it is not the still-required fresh-session ChatGPT or Chrome receipt.
- [ ] Fresh browser proof for the current local candidate: visible Assess focus, required browser-review opening, exact sequential tasks, pass/issue/blocker recording, browser-finding provenance, diagnostic continuation, assessment-receipt appearance only after completion, explicit preparation, contextual re-registration, and 390 px browser-review/priority layout. Static contracts and builds are not this proof.

## Competition delivery

- [x] Valid Apache-2.0 project licence.
- [x] Direct dependency and external-service notice.
- [x] Reproducible local setup instructions.
- [x] Tracked publication preflight: no credential-like filenames, common token/private-key signatures, or absolute user-home paths detected; `.env*` and Cloudflare `.dev.vars*` secrets are ignored with safe examples explicitly allowlisted.
- [ ] Public source repository and challenge-period commit history.
- [x] Stable production HTTPS deployment exists and is verified from an authorised owner session.
- [x] Current unauthenticated entry proof: an app-scoped Cloudflare Access Bypass/Everyone policy exposes only `frontmend.test.knightware.xyz`; a fresh in-app browser reached the Frontmend heading and discovered `start_site_audit` without login on 30 August 2026.
- [ ] Production URL verified in ChatGPT's in-app browser.
- [ ] Production URL verified in the supported Chrome WebMCP path.
- [ ] Free judging access confirmed through the full judging window.
- [ ] Final English Devpost description.
- [ ] Public YouTube demo under three minutes with clear audio.
- [x] Exact deployed revision, repository revision, and final test receipt recorded.

## Release blockers

1. The deployed source is committed locally, but the public remote, push, and challenge-period history are not yet prepared.
2. Gated candidate content `7fa65b1` (application source through `c39882d`) adds the persisted agent browser review, browser-observed findings, contextual tools, visible evidence card, and judge runbook on top of the Assess/Prepare-fix mission; it is newer than deployed application commit `a20e1ff` and has no live proof.
3. Temporary app-scoped Access bypass `fa97f6cc-0019-40a7-a9a3-4a71a62b0cdd` currently makes the hostname public while preserving reusable **Only CK** for rollback. Keep the bypass active through testing and judging, or replace it only with another verified public-access arrangement.
4. The current deployment needs a fresh Chrome console smoke on its asset hashes.
5. The eventual current deployment must be exercised through WebMCP from fresh ChatGPT, Codex-repository, and Chrome sessions before any submission claim.
6. Video capture, narration, upload, and Devpost submission remain external deliverables.
