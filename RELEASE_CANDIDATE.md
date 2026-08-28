# Frontmend release candidate

Prepared: 29 August 2026 (Australia/Perth)

This is the release-candidate receipt and production verification runbook. It records the Cloudflare deployment and public HTTP/API proof below; fresh ChatGPT and Chrome WebMCP proof is still outstanding.

Reference basis: [OpenAI Site tools](https://learn.chatgpt.com/docs/webmcp), [Chrome WebMCP guide](https://developer.chrome.com/docs/ai/webmcp), [Google's Model Context Tool Inspector](https://chromewebstore.google.com/detail/webmcp-model-context-tool/gbpdfapgefenggkahomfgkhfehlcenpd), and [Cloudflare Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/).

## Candidate identity

- Source provenance: standalone repository application commit `a20e1ff0edaa35538211129904c6ff746cf3525a`; push remains a separate action
- Current local application: `0b59884`; adds actionable Lighthouse diagnostics plus persisted browser-and-repository diagnosis missions, human review/delegated-auto policy, and visible capability language; it is not deployed
- Worker name: `frontmend`
- Cloudflare version: `c04eb2e0-780b-4ee6-978f-876692784108`
- Deployment created: `2026-08-28T21:26:28.048Z`
- Wrangler source of truth: `wrangler.jsonc`
- Runtime: Worker module plus `FrontmendAuditGate` and `FrontmendAuditJob` SQLite Durable Objects
- Static assets: `dist/client`, exposed to the Worker as `ASSETS`
- Production URL: `https://frontmend.test.knightware.xyz/`

## Fresh local receipt

Run from `Ideas/Frontmend`:

| Gate | Command | Result on 29 August 2026 |
| --- | --- | --- |
| Tests | `bun test` | PASS — 106 passed, 0 failed on the local application candidate |
| Production build | `bun run build` | PASS — 4,575 modules transformed; client and Worker artifacts emitted |
| Wrangler types | `bunx wrangler types --check --config wrangler.jsonc` | PASS after regeneration, before generated trailing-whitespace normalisation; bindings match `ASSETS`, `AUDIT_GATE`, and `AUDIT_JOBS` |
| Deploy bundle | `bunx wrangler deploy --dry-run --strict --config wrangler.jsonc` | PASS — five assets; 194.80 KiB raw / 43.44 KiB gzip Worker upload; no upload performed |

Wrangler 4.126.0 generated six trailing spaces in its runtime declaration output. They were removed so `git diff --check` remains usable; this is formatting-only and does not change the generated binding hash.

## Deployment prerequisites

The candidate is deployed and HTTP/API-verified but not WebMCP-verified until each remaining item below is satisfied.

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
- [ ] Complete a fresh Chrome console smoke on the currently deployed asset hashes with zero errors or warnings.
- [ ] Complete both fresh-session procedures below against the exact production URL.

`PAGESPEED_API_KEY` is not required for the Worker to start. It is now configured for the deployed judging path; if Google still rate-limits one strategy, the strengthened candidate retains any successful Lighthouse viewport and names the unavailable strategy rather than discarding valid evidence.

## Fresh-session ChatGPT verification

Define `FRONTMEND_URL` as the exact public HTTPS deployment URL. Do not use localhost, a preview server, an old browser tab, or a URL from a previous build.

1. Update the ChatGPT desktop app, then fully quit and reopen it.
2. Use a personal supported workspace, not Enterprise or Edu. In **Settings → Browser → Permissions**, turn on **Enable site tools**.
3. Start a new chat with no inherited browser tab or earlier Frontmend messages. Select **GPT-5.6 Sol** or **GPT-5.6 Terra**; do not use Luna for this test.
4. Open `FRONTMEND_URL` as a top-level page in ChatGPT's built-in browser. Wait for the landing page to settle.
5. In the browser address bar, select **Site tools → Available site tools**. Record a screenshot showing exactly one active Frontmend tool, `start_site_audit`. The page badge should read **WebMCP · 1 active**, not **Human mode**.
6. Send this exact prompt, replacing the placeholder once:

   > Use the current page's site tools, not visual clicking, to audit `FRONTMEND_URL`. Return the tool name, audit ID, status, and workspace path. Do not claim the audit is complete until the tool reports it.

7. Confirm **Sources/Recently used** records `start_site_audit`, the result contains a stable audit ID and `/audits/<id>` workspace path, and the visible Agent log adds a successful entry without raw arguments or the URL.
8. Open the returned workspace path only after the tool call finishes. While the audit is queued or running, inspect **Available site tools** again. It must expose `check_site_audit_progress` and `cancel_site_audit`; the visible page must also offer **Cancel audit**.
9. Send:

   > Check the visible Frontmend audit until it reaches a terminal state. Use the page's site tool and report the exact status and evidence mode. Do not cancel it and do not infer completion from the screen.

10. If the audit completes, send:

    > Read the completed audit using the current page's site tool. Report the audit ID, final URL, engine and evidence mode, measured viewport count, score, finding IDs, omitted-finding count, and any observed same-site route paths. Distinguish Lighthouse evidence from the live-document fallback.

11. Confirm `get_site_audit_results` appears in **Recently used**, its structured values match the visible report, and the page's contextual capability list has changed from progress tools to completed-report tools. Export the human audit report and compare its audit ID, evidence mode, findings, and boundary with the tool result.
12. If at least one finding exists, first inspect its contextual capabilities. For a structured console, contrast, or main-thread finding, ask ChatGPT to open its diagnostic mission and explain the required browser/repository evidence without fabricating repository access. For any finding whose repair tool is available, send:

    > Stage a repair proposal for the first visible finding using Frontmend's site tool. Do not approve it, do not attest deployment, and do not claim the target changed. Return the repair ID, finding ID, risk, status, and human next action.

13. Confirm the visible review workspace appears, `stage_site_repair` is in **Recently used**, the proposal remains awaiting human review, and no site change or approval is claimed. Open **Agent log** and verify all successful calls are listed without prompts, URLs, patches, or tool arguments.
14. Save screenshots of: the production URL and one-tool landing state; running contextual tools; completed report plus matching structured result; staged review plus the human-only approval boundary; and Recently used/Sources.

Failure conditions: **Human mode**, missing Site tools UI, any tool set inconsistent with visible state, a tool call that navigates before returning, mismatched IDs/evidence, approval by the agent, or a deployment/change claim without external proof.

## Fresh-session Codex repository verification

This is the strongest end-to-end product demonstration because the coding agent already has authorised access to the target repository while Frontmend supplies independent public evidence. Use a controlled target whose repository is open in Codex. Do not use a third-party site.

1. Start a new Codex task rooted at the controlled target repository. Record `git status --short` before the demo so pre-existing work is attributable.
2. Open `FRONTMEND_URL` as a top-level page in Codex's browser and confirm the landing page exposes only `start_site_audit`.
3. Send this natural demo prompt:

   > Hey Codex, please use Frontmend to audit my site for accessibility and SEO issues.

4. Confirm the agent carries the requested `accessibility` and `seo` focus into `get_site_audit_results`, receives no more than three deduplicated priorities, and uses `get_repository_fix_brief` for its selected finding. It must use Codex repository tools—not Frontmend—to inspect source. The brief must contain only public evidence, search hints, acceptance criteria, and authority boundaries; it must not contain absolute local paths or source uploads.
5. For a console-error, contrast-node, or main-thread-blocking finding, confirm the contextual tool set exposes `open_diagnostic_mission` but withholds agent repair staging. The agent must reproduce the issue in the browser, inspect the owning repository code, and call `submit_runtime_diagnosis` with bounded observations, repository-relative locations, and planned checks. Confirm the UI labels the Lighthouse symptom **measured** and the causal diagnosis **agent-reported**. Only then may `stage_site_repair` become available for that finding. Do not accept a diagnosis inferred from Lighthouse alone.
6. Confirm `stage_site_repair` creates the same visible proposal the agent describes and includes only the exact repository-relative target files plus planned checks discovered by Codex. The visible **Coding-agent plan**, structured tool result, and reviewed-plan Markdown must match; no source contents, absolute paths, command output, credentials, or environment values may appear. If necessary, request one revision in the UI and verify `revise_site_repair` preserves the earlier plan in the revision trail while showing the new plan for review.
7. Review the exact proposal and approve it manually in Frontmend. Then send:

   > Implement the approved repair in this repository, preserve unrelated work, and run the relevant tests and production build. When they finish, use Frontmend’s implementation-receipt tool to record only the short summary, repository-relative files, check outcomes, and current commit ID if one exists. Do not commit, push, deploy, or claim the public finding is fixed.

8. Confirm Codex edits only the reviewed repository scope and runs the planned checks. The contextual WebMCP set should now include `record_repository_implementation`; its structured result and visible receipt must match the changed relative filenames and truthful check statuses. The final verification receipt must retain both the reviewed repository plan and the implementation receipt as separate agent-reported provenance.
9. Confirm the mission rail marks **Implement** complete while **Deploy** remains owned by the site owner and **Verify** remains blocked. Frontmend must still say it did not inspect or change source and has not verified the public result.
10. Record `git status --short` and the diff after the demo. Save screenshots of the repository fix brief, visible human approval, repository diff/check output, implementation receipt, and still-locked deployment boundary.

Failure conditions: Frontmend receives source contents or absolute paths; the agent edits before approval; unrelated files change; failed or skipped checks are reported as passed; Frontmend approves, deploys, or claims resolution; or the visible receipt differs from the repository evidence.

## Fresh-session Codex delegated-auto verification

Use a fresh controlled audit with at least one genuine low-risk HTML or CSS finding. Do not reuse the review-mode repair above.

1. Open the completed audit workspace and personally select **Delegated auto mode**. Check the authorisation statement first; confirm the visible receipt says three approvals remain, low risk only, HTML/CSS only, repository plan required, and deployment person-only.
2. In a fresh Codex task rooted at the controlled repository, send:

   > Use the visible Frontmend audit and my recorded delegated-auto policy. Choose one eligible low-risk HTML or CSS finding, inspect this repository, submit the exact repository-relative files and planned checks, implement only if Frontmend reports the mission was auto-authorised, run the checks, and attach the implementation receipt. Stop before deployment.

3. Confirm `stage_site_repair` returns `approval.mode: "delegated-auto"`, `requiresHumanReview: false`, `approvalEvidence: "prior-human-auto-policy"`, and an implementation next action. The page must show **Auto-authorised by your policy**, the same files/checks, and two approvals remaining.
4. Confirm Codex edits only the authorised files, runs the named checks, and calls `record_repository_implementation`. Failed or unrun checks must remain an attention state. **Deploy** stays site-owner-owned and no deployment evidence exists.
5. Submit a separate JavaScript, headers, configuration, medium-risk, high-risk, or repository-plan-free mission. Confirm it remains a draft awaiting explicit review and does not consume another allowance.
6. Switch the visible policy back to **Review each plan**. Confirm a later eligible low-risk plan also waits for explicit review; the agent cannot re-enable auto mode through WebMCP.
7. Save screenshots of the human grant, auto-authorised mission, consumed allowance, repository diff/checks, implementation receipt, ineligible draft, and still-locked deployment gate.

Failure conditions: the agent enables or widens the policy; an ineligible or plan-free proposal is auto-authorised; more than three approvals are consumed; deployment becomes automatic; allowance/state differs between UI and WebMCP; or repository work begins without an explicit or delegated authorisation receipt.

## Fresh-session Chrome verification

Chrome's public WebMCP origin trial begins with Chrome 149. This exact inspector-based procedure uses Chrome 150.0.7861.0 or newer because that is the current minimum stated by Google's inspector extension. Until the production origin is enrolled in the WebMCP origin trial, use Chrome's explicit testing flag for this verification.

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

   > Audit the current Frontmend URL using the registered WebMCP tool. Return the tool name, audit ID, status, and workspace path. Do not use DOM clicking to start it.

7. Confirm the call is `start_site_audit`, its structured output contains the stable ID and workspace path, and the visible Agent log records success. Navigate to the returned path after the call completes.
8. While running, confirm the Inspector now discovers exactly `check_site_audit_progress` and `cancel_site_audit`. Manually invoke `check_site_audit_progress` with `{}` and verify the structured state matches the page.
9. After completion, refresh the Inspector's registered-tool view. Invoke `get_site_audit_results` with `{}`. Compare audit ID, final URL, evidence mode, score, findings, omitted count, and route candidates with the visible report and exported Markdown.
10. If a structured diagnostic finding exists, invoke `open_diagnostic_mission` with its `findingId`; confirm `submit_runtime_diagnosis` appears and agent repair staging remains gated until valid diagnosis evidence exists. Otherwise invoke `stage_site_repair` with only the finding ID. In either path, compare the visible and structured state and do not invent repository evidence in this Chrome-only test.
11. Negative-schema check: call `get_site_audit_results` with `{ "unexpected": true }`. It must fail with a structured validation error and must not change visible state.
12. Close the tab, open `FRONTMEND_URL` in a new tab, and confirm only `start_site_audit` is registered again. This proves page-scoped lifecycle cleanup rather than stale tool retention.
13. Save screenshots of the Chrome version, enabled flag, console capability check, Inspector tool lists at landing/running/completed states, structured result comparison, negative-schema error, visible Agent log, and human-only repair review.

Failure conditions: missing API support, `originAgentCluster !== true`, stale tools after navigation or tab close, schemas the Inspector cannot parse, structured results that differ from visible state, unlogged calls, or an agent-only path through approval/deployment attestation.

## Release decision

The deployed version may be labelled **RC3 deployed, HTTP/API-verified, and production-Lighthouse-verified**. The newer local diagnostic-mission candidate remains undeployed. Neither may be labelled current-version Chrome-smoke-verified, ChatGPT-WebMCP-verified, Chrome-WebMCP-verified, or submission-ready until the remaining fresh-session procedures have real receipts. The exact deployed application source is committed locally at `a20e1ff`; it has not been pushed to a public remote. Local application commit `0b59884` adds persisted repository-aware diagnosis and the human-controlled delegated repair protocol, passes the fresh gates above, and is not part of the deployed Worker version.
