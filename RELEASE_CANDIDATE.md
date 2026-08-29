# Frontmend release candidate

Prepared: 29 August 2026 (Australia/Perth)

This is the release-candidate receipt and production verification runbook. It records historical public HTTP/API proof for the deployed revision; the current hostname is temporarily protected by Cloudflare Access, the newer local mission candidate is not deployed, and fresh ChatGPT/Chrome WebMCP proof is still outstanding.

Reference basis: [OpenAI Site tools](https://learn.chatgpt.com/docs/webmcp), [Chrome WebMCP guide](https://developer.chrome.com/docs/ai/webmcp), [Google's Model Context Tool Inspector](https://chromewebstore.google.com/detail/webmcp-model-context-tool/gbpdfapgefenggkahomfgkhfehlcenpd), and [Cloudflare Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/).

## Candidate identity

- Source provenance: standalone repository application commit `a20e1ff0edaa35538211129904c6ff746cf3525a`; push remains a separate action
- Current local application source: `8e988f0`; adds persisted Assess missions, focused priorities, browser-and-repository diagnosis, explicit repair preparation, and the visible authority boundary; judge-facing documentation through `71ac6b2` is also local-only
- Worker name: `frontmend`
- Cloudflare version: `c04eb2e0-780b-4ee6-978f-876692784108`
- Deployment created: `2026-08-28T21:26:28.048Z`
- Wrangler source of truth: `wrangler.jsonc`
- Runtime: Worker module plus `FrontmendAuditGate` and `FrontmendAuditJob` SQLite Durable Objects
- Static assets: `dist/client`, exposed to the Worker as `ASSETS`
- Production URL: `https://frontmend.test.knightware.xyz/`

## Fresh local receipt

Run from `Ideas/Frontmend`:

The command-safe release gate ran from tracked revision `71ac6b24106b201f0292276c6fab5a27eaa62daf`. `git status --short` and `git diff --check` were empty before and after the commands; generated `dist` output remains ignored.

| Gate | Command | Result on 29 August 2026 |
| --- | --- | --- |
| Tests | `bun test` | PASS — 124 passed, 0 failed on the local application candidate |
| Production build | `bun run build` | PASS — 4,576 modules transformed; `index-By0mrP6s.css`, `index-CsoRpCO4.js`, client HTML, Worker artifact, and Sites metadata emitted |
| Wrangler types | `bunx wrangler types --check --config wrangler.jsonc` | RETAINED EARLIER RECEIPT — not rerun in this three-command gate; bindings matched `ASSETS`, `AUDIT_GATE`, and `AUDIT_JOBS` |
| Deploy bundle | `bunx wrangler deploy --dry-run --strict --config wrangler.jsonc` | PASS — Wrangler 4.126.0 read five assets and reported 210.20 KiB raw / 46.27 KiB gzip; `--dry-run: exiting now`, so no upload occurred |

Wrangler 4.126.0 generated six trailing spaces in its runtime declaration output. They were removed so `git diff --check` remains usable; this is formatting-only and does not change the generated binding hash.

## Deployment prerequisites

The older deployed revision is HTTP/API-verified. The current local mission candidate is not deployed and must not inherit those production claims.

- [x] Wrangler 4.x is installed (`4.126.0` during this receipt).
- [x] Wrangler is authenticated to the intended Cloudflare account.
- [x] No `.wrangler/deploy/config.json` redirect overrides `wrangler.jsonc`.
- [x] `name`, `main`, `compatibility_date`, assets, Durable Object bindings, and the `v1` SQLite migration pass Wrangler's dry run.
- [x] `compatibility_date` is `2026-08-27`.
- [x] Confirm the currently authenticated Cloudflare account is the intended production owner immediately before deployment.
- [x] Obtain a Google PageSpeed API key and keep it outside source control.
- [x] Set the key interactively as the `PAGESPEED_API_KEY` Worker secret; secret change version `72b82cc8-61bf-4fd9-9ff1-06593fd6d78b` was recorded without exposing the value.
- [x] Perform the authorised deployment to the exact custom domain with `workers.dev` and preview URLs disabled.
- [x] Record the exact deployed URL, deployed version ID, source state, UTC deployment time, and final command receipt here.
- [x] Verify explicit WebMCP response headers: `Origin-Agent-Cluster: ?1` and `Permissions-Policy: tools=(self)`.
- [x] Verify public DNS through `1.1.1.1` and `8.8.8.8`, valid HTTPS, current hashed assets, SPA restoration, private-target rejection, and Durable Object persistence.
- [x] Complete the production PageSpeed path on the deployed application commit: final audit `cac6da7e-ca38-4084-a0e1-c5e181451432` returned `live-lighthouse` evidence from Lighthouse 13.4.1 for both mobile and desktop, scored 98, recorded 22 passed checks, zero findings and zero viewport failures, and used no fallback. Mobile scored 98/100/100/91 and desktop 100/100/100/91 for performance/accessibility/best-practices/SEO.
- [x] Verify the deployed production asset hashes over public HTTPS (`index-BR_ayGCH.css`, `index-CkJVqSRf.js`), SPA restoration, security/WebMCP headers, and structured private-target rejection.
- [ ] Remove the temporary Cloudflare Access policy **Only CK** before judging, or provide tested judge credentials through an allowed private channel. An authorised owner session is not proof of free judging access.
- [ ] Complete a fresh Chrome console smoke on the currently deployed asset hashes with zero errors or warnings.
- [ ] Complete the required fresh-session procedures below against the exact production URL.

`PAGESPEED_API_KEY` is not required for the Worker to start. It is now configured for the deployed judging path; if Google still rate-limits one strategy, the strengthened candidate retains any successful Lighthouse viewport and names the unavailable strategy rather than discarding valid evidence.

## Fresh-session ChatGPT verification

Define `FRONTMEND_URL` as the exact deployed Frontmend HTTPS URL and `TARGET_URL` as a controlled public site. Do not use localhost, a preview server, an old tab, or a prior chat.

1. Update the ChatGPT desktop app, fully quit it, reopen it, and enable **Settings → Browser → Permissions → Enable site tools** in a supported personal workspace.
2. Start a new chat with no earlier Frontmend messages or inherited browser tab. Open `FRONTMEND_URL` as a top-level page and wait for it to settle.
3. Open **Site tools → Available site tools**. Capture exactly `start_site_audit` and the page badge **WebMCP · 1 active**. If it says **Human mode**, stop and record failure.
4. Send one natural prompt, replacing only the target:

   > Hey ChatGPT, please use Frontmend to audit `TARGET_URL` for accessibility and SEO issues.

5. Confirm ChatGPT calls `start_site_audit` with `intent: "assess"`, focus areas `accessibility` and `seo`, and no raw prompt field. The result must contain one stable audit ID and `/audits/<id>` path; navigation may occur only after that tool result returns.
6. On the workspace, confirm the visible mission says **Assessment** with both focus areas. While queued/running, the contextual set must be exactly progress plus cancellation, and the human page must expose the same cancellation action.
7. Let ChatGPT poll the actual job and call `get_site_audit_results` with `{}` where possible. Confirm no more than three deduplicated priorities, cross-viewport occurrences, and `missionState` match the visible workspace. Lighthouse job completion alone is not mission completion.
8. If `assessmentComplete` is false, ChatGPT must follow the exact `nextAction`. It should open a supported diagnostic mission and contribute only evidence it can actually obtain. Without repository access, it must name that blocker after opening/reading the mission rather than fabricate ownership or stop at Lighthouse.
9. Confirm the opening audit prompt did not call `prepare_site_repair` or `stage_site_repair`. Then send:

   > Please prepare the first priority for a fix, but don't approve, change, or deploy anything.

10. Confirm `prepare_site_repair` freezes that finding, the visible intent changes to **Preparing a fix**, and the result says recorded intent only. It must not create approval, consume auto allowance, claim an edit, deploy, or attest deployment. Staging appears only if any required diagnosis is complete.
11. Call `get_site_audit_results` with `{ "unexpected": true }`. It must return structured `INVALID_INPUT` and leave visible mission state unchanged. Inspect **Agent log** and confirm entries contain no prompts, target URL, arguments, patches, or secrets.
12. Save screenshots of landing discovery, Assess focus, running tools, completed measurement versus assessment state, diagnostic continuation or real blocker, explicit preparation, Recently used/Sources, and Agent log.

Failure conditions: **Human mode**; missing or stale tools; focus lost on the empty result call; more than three priorities; stopping after Lighthouse while a valid next action exists; fabricated repository evidence; repair preparation during the audit-only prompt; staging without explicit preparation; agent approval/deployment/attestation; or visible and structured state disagreement.

## Fresh-session Codex repository verification

This is the strongest end-to-end product demonstration because the coding agent already has authorised access to the target repository while Frontmend supplies independent public evidence. Use a controlled target whose repository is open in Codex. Do not use a third-party site.

1. Start a new Codex task rooted at the controlled target repository. Record `git status --short` before the demo so pre-existing work is attributable.
2. Open `FRONTMEND_URL` as a top-level page in Codex's browser and confirm the landing page exposes only `start_site_audit`.
3. Send this natural demo prompt:

   > Hey Codex, please use Frontmend to audit my site for accessibility and SEO issues.

4. Confirm the agent carries the requested `accessibility` and `seo` focus into `get_site_audit_results` with `{}`, receives no more than three deduplicated priorities, and does not stage a repair. It must use Codex repository tools—not Frontmend—to inspect source.
5. For a console-error, contrast-node, or main-thread-blocking finding, confirm the contextual tool set exposes `open_diagnostic_mission` but withholds agent repair staging. The agent must reproduce the issue in the browser, inspect the owning repository code, and call `submit_runtime_diagnosis` with bounded observations, repository-relative locations, and planned checks. Confirm the UI labels the Lighthouse symptom **measured** and the causal diagnosis **agent-reported**. This satisfies the diagnosis gate; staging must still remain absent until the explicit repair preparation in the next step. Do not accept a diagnosis inferred from Lighthouse alone.
6. After the assessment is complete, send: “Please prepare the first priority for a fix, but don't approve, change, or deploy anything.” Confirm Codex calls `prepare_site_repair`, the visible mission freezes that finding, auto allowance remains unchanged, and `stage_site_repair` appears only when required diagnosis is ready.
7. Confirm Codex then uses `get_repository_fix_brief`, inspects source through repository tools, and stages the same bounded proposal it describes with only exact repository-relative files plus planned checks. The visible **Coding-agent plan**, structured result, and reviewed-plan Markdown must match; no source contents, absolute paths, command output, credentials, or environment values may appear.
8. Review the exact proposal and approve it manually in Frontmend. Then send:

   > Implement the approved repair in this repository, preserve unrelated work, and run the relevant tests and production build. When they finish, use Frontmend’s implementation-receipt tool to record only the short summary, repository-relative files, check outcomes, and current commit ID if one exists. Do not commit, push, deploy, or claim the public finding is fixed.

9. Confirm Codex edits only the reviewed repository scope and runs the planned checks. `record_repository_implementation`, its structured result, and the visible receipt must match the relative filenames and truthful check statuses.
10. Confirm the mission rail marks **Implement** complete while **Deploy** remains owned by the site owner and **Verify** remains blocked. Frontmend must still say it did not inspect or change source and has not verified the public result.
11. Record `git status --short` and the diff after the demo. Save screenshots of the diagnosis, explicit preparation, repository fix brief, visible human approval, repository diff/check output, implementation receipt, and locked deployment boundary.

Failure conditions: Frontmend receives source contents or absolute paths; the agent edits before approval; unrelated files change; failed or skipped checks are reported as passed; Frontmend approves, deploys, or claims resolution; or the visible receipt differs from the repository evidence.

## Fresh-session Codex delegated-auto verification

Use a fresh controlled audit with at least one genuine low-risk HTML or CSS finding. Do not reuse the review-mode repair above.

1. Open the completed audit workspace and personally select **Delegated auto mode**. Check the authorisation statement first; confirm the visible receipt says three approvals remain, low risk only, HTML/CSS only, repository plan required, and deployment person-only.
2. In a fresh Codex task rooted at the controlled repository, send:

   > Use the visible Frontmend audit and my recorded delegated-auto policy. Choose one eligible low-risk HTML or CSS finding, inspect this repository, submit the exact repository-relative files and planned checks, implement only if Frontmend reports the mission was auto-authorised, run the checks, and attach the implementation receipt. Stop before deployment.

3. Confirm Codex first calls `prepare_site_repair` for the chosen finding. Preparation must not consume allowance. Only the subsequent eligible `stage_site_repair` may return `approval.mode: "delegated-auto"`, `requiresHumanReview: false`, `approvalEvidence: "prior-human-auto-policy"`, and an implementation next action. The page must show **Auto-authorised by your policy**, the same files/checks, and two approvals remaining.
4. Confirm Codex edits only the authorised files, runs the named checks, and calls `record_repository_implementation`. Failed or unrun checks must remain an attention state. **Deploy** stays site-owner-owned and no deployment evidence exists.
5. Submit a separate JavaScript, headers, configuration, medium-risk, high-risk, or repository-plan-free mission. Confirm it remains a draft awaiting explicit review and does not consume another allowance.
6. Switch the visible policy back to **Review each plan**. Confirm a later eligible low-risk plan also waits for explicit review; the agent cannot re-enable auto mode through WebMCP.
7. Save screenshots of the human grant, auto-authorised mission, consumed allowance, repository diff/checks, implementation receipt, ineligible draft, and still-locked deployment gate.

Failure conditions: the agent enables or widens the policy; an ineligible or plan-free proposal is auto-authorised; more than three approvals are consumed; deployment becomes automatic; allowance/state differs between UI and WebMCP; or repository work begins without an explicit or delegated authorisation receipt.

## Fresh-session Chrome verification

Chrome's public WebMCP origin trial begins with Chrome 149. This exact inspector-based procedure uses Chrome 150.0.7861.0 or newer because that is the current minimum stated by Google's inspector extension. Until the production origin is enrolled in the WebMCP origin trial, use Chrome's explicit testing flag for this verification.

Define `TARGET_URL` as a controlled public site distinct from the Frontmend application URL.

1. Use Chrome 150.0.7861.0 or newer. Create a dedicated new Chrome profile with no Frontmend storage, service worker, or previously open Frontmend tab.
2. Open `chrome://flags/#enable-webmcp-testing`, set **WebMCP testing** to **Enabled**, and relaunch Chrome.
3. Install or enable Google's **Model Context Tool Inspector** extension only in this dedicated verification profile. It is a development inspector, not a production security boundary. Open `FRONTMEND_URL` directly as a top-level page, not inside an iframe, then perform one hard reload.
4. In DevTools Console, run these read-only checks and save the output:

   ```js
   ({
     modelContext: typeof document.modelContext,
     registerTool: typeof document.modelContext?.registerTool,
     originAgentCluster: window.originAgentCluster,
   })
   ```

   Acceptance: `modelContext` is `"object"`, `registerTool` is `"function"`, and `originAgentCluster` is `true`.
5. Open the Model Context Tool Inspector. Confirm it discovers exactly `start_site_audit` on the landing page. Inspect its schema and confirm unknown fields are disallowed.
6. In the Inspector's agent chat, send:

   > Hey Frontmend, please audit `TARGET_URL` for accessibility and SEO issues.

7. Confirm the call is `start_site_audit` with Assess intent plus accessibility/SEO focus, its structured output contains the stable ID and workspace path, and the visible Agent log records success. Navigate to the returned path after the call completes.
8. While running, confirm the Inspector now discovers exactly `check_site_audit_progress` and `cancel_site_audit`. Manually invoke `check_site_audit_progress` with `{}` and verify the structured state matches the page.
9. After completion, refresh the Inspector's registered-tool view. Invoke `get_site_audit_results` with `{}`. Compare audit ID, final URL, evidence mode, retained focus, no more than three priorities, `assessmentComplete`, findings, omitted count, and route candidates with the visible report and exported Markdown.
10. If a structured diagnostic finding exists, invoke `open_diagnostic_mission` with its `findingId`; confirm `submit_runtime_diagnosis` appears and staging remains gated because the Inspector has no repository evidence. Do not invent that evidence. Then invoke `prepare_site_repair` for one retained priority and confirm the visible **Preparing a fix** state; `stage_site_repair` may appear only for a measured-sufficient or fully diagnosed selected finding.
11. Negative-schema check: call `get_site_audit_results` with `{ "unexpected": true }`. It must fail with a structured validation error and must not change visible state.
12. Close the tab, open `FRONTMEND_URL` in a new tab, and confirm only `start_site_audit` is registered again. This proves page-scoped lifecycle cleanup rather than stale tool retention.
13. Save screenshots of the Chrome version, enabled flag, console capability check, Inspector tool lists at landing/running/completed states, structured result comparison, negative-schema error, visible Agent log, and explicit preparation/repair gate.

Failure conditions: missing API support, `originAgentCluster !== true`, stale tools after navigation or tab close, schemas the Inspector cannot parse, structured results that differ from visible state, unlogged calls, or an agent-only path through approval/deployment attestation.

## Release decision

The deployed version may be labelled **RC3 deployed, HTTP/API-verified, and production-Lighthouse-verified**. The current local mission candidate remains undeployed and cannot inherit that live proof. Neither may be labelled current-version Chrome-smoke-verified, ChatGPT-WebMCP-verified, Chrome-WebMCP-verified, freely judge-accessible, or submission-ready until temporary Cloudflare Access is resolved and the procedures above have genuine receipts. The deployed application source is `a20e1ff`; current application source `8e988f0` plus judge documentation through tested revision `71ac6b2` have not been pushed to a public remote or deployed.
