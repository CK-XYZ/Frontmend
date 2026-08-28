# Frontmend release candidate

Prepared: 29 August 2026 (Australia/Perth)

This is the release-candidate receipt and production verification runbook. It records the Cloudflare deployment and public HTTP/API proof below; fresh ChatGPT and Chrome WebMCP proof is still outstanding.

Reference basis: [OpenAI Site tools](https://learn.chatgpt.com/docs/webmcp), [Chrome WebMCP guide](https://developer.chrome.com/docs/ai/webmcp), [Google's Model Context Tool Inspector](https://chromewebstore.google.com/detail/webmcp-model-context-tool/gbpdfapgefenggkahomfgkhfehlcenpd), and [Cloudflare Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/).

## Candidate identity

- Source provenance: standalone repository application commit `b94e6cb8fb9419145f7340c77de0882eb015d891`; push remains a separate action
- Current local application: `2c1ff900c1b9be975d918ce4e0273c825b694735`; adds visible and agent-readable per-strategy repair proof and is not deployed
- Worker name: `frontmend`
- Cloudflare version: `59677b80-ed0d-4851-8f66-403a31cc1985`
- Deployment created: `2026-08-28T20:55:12.233Z`
- Wrangler source of truth: `wrangler.jsonc`
- Runtime: Worker module plus `FrontmendAuditGate` and `FrontmendAuditJob` SQLite Durable Objects
- Static assets: `dist/client`, exposed to the Worker as `ASSETS`
- Production URL: `https://frontmend.test.knightware.xyz/`

## Fresh local receipt

Run from `Ideas/Frontmend`:

| Gate | Command | Result on 29 August 2026 |
| --- | --- | --- |
| Tests | `bun test` | PASS — 94 passed, 0 failed on local application commit `2c1ff90` |
| Production build | `bun run build` | PASS — 4,574 modules transformed; client and Worker artifacts emitted |
| Wrangler types | `bunx wrangler types --check --config wrangler.jsonc` | PASS after regeneration, before generated trailing-whitespace normalisation; bindings match `ASSETS`, `AUDIT_GATE`, and `AUDIT_JOBS` |
| Deploy bundle | `bunx wrangler deploy --dry-run --strict --config wrangler.jsonc` | PASS — five assets; 153.05 KiB raw / 34.70 KiB gzip Worker upload; no upload performed |

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
- [x] Complete the production PageSpeed path on the deployed application commit: final audit `623f74f6-8699-4aac-b273-23d8642713d1` returned `live-lighthouse` evidence from Lighthouse 13.4.1 for both mobile and desktop, scored 97, recorded zero findings and zero viewport failures, and used no fallback. Mobile scored 97/100/100/91 and desktop 100/100/100/91 for performance/accessibility/best-practices/SEO.
- [x] Verify the deployed production asset hashes over public HTTPS (`index-DEWSzaVC.css`, `index-D4qj_4ma.js`), SPA restoration, security/WebMCP headers, and structured private-target rejection.
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
12. If at least one finding exists, send:

    > Stage a repair proposal for the first visible finding using Frontmend's site tool. Do not approve it, do not attest deployment, and do not claim the target changed. Return the repair ID, finding ID, risk, status, and human next action.

13. Confirm the visible review workspace appears, `stage_site_repair` is in **Recently used**, the proposal remains awaiting human review, and no site change or approval is claimed. Open **Agent log** and verify all successful calls are listed without prompts, URLs, patches, or tool arguments.
14. Save screenshots of: the production URL and one-tool landing state; running contextual tools; completed report plus matching structured result; staged review plus the human-only approval boundary; and Recently used/Sources.

Failure conditions: **Human mode**, missing Site tools UI, any tool set inconsistent with visible state, a tool call that navigates before returning, mismatched IDs/evidence, approval by the agent, or a deployment/change claim without external proof.

## Fresh-session Codex repository verification

This is the strongest end-to-end product demonstration because the coding agent already has authorised access to the target repository while Frontmend supplies independent public evidence. Use a controlled target whose repository is open in Codex. Do not use a third-party site.

1. Start a new Codex task rooted at the controlled target repository. Record `git status --short` before the demo so pre-existing work is attributable.
2. Open `FRONTMEND_URL` as a top-level page in Codex's browser and confirm the landing page exposes only `start_site_audit`.
3. Send this natural demo prompt, replacing the target once:

   > Audit `CONTROLLED_TARGET_URL`, identify the highest-impact finding that can be fixed in this repository, and prepare a concrete repair plan. Use Frontmend’s site tools for live evidence and inspect the repository yourself to locate the owning code. Don’t edit anything until I approve the plan, and don’t deploy.

4. Confirm the agent uses Frontmend for the public audit and `get_repository_fix_brief` for the selected finding, but uses Codex repository tools—not Frontmend—to inspect source. The brief must contain only public evidence, search hints, acceptance criteria, and authority boundaries; it must not contain absolute local paths or source uploads.
5. Confirm `stage_site_repair` creates the same visible proposal the agent describes. If necessary, request one revision in the UI and verify `revise_site_repair` preserves the feedback and revision trail.
6. Review the exact proposal and approve it manually in Frontmend. Then send:

   > Implement the approved repair in this repository, preserve unrelated work, and run the relevant tests and production build. When they finish, use Frontmend’s implementation-receipt tool to record only the short summary, repository-relative files, check outcomes, and current commit ID if one exists. Do not commit, push, deploy, or claim the public finding is fixed.

7. Confirm Codex edits only the intended repository scope and runs allowed checks. The contextual WebMCP set should now include `record_repository_implementation`; its structured result and visible receipt must match the changed relative filenames and truthful check statuses.
8. Confirm the mission rail marks **Implement** complete while **Deploy** remains owned by the site owner and **Verify** remains blocked. Frontmend must still say it did not inspect or change source and has not verified the public result.
9. Record `git status --short` and the diff after the demo. Save screenshots of the repository fix brief, visible human approval, repository diff/check output, implementation receipt, and still-locked deployment boundary.

Failure conditions: Frontmend receives source contents or absolute paths; the agent edits before approval; unrelated files change; failed or skipped checks are reported as passed; Frontmend approves, deploys, or claims resolution; or the visible receipt differs from the repository evidence.

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
10. If a finding exists, invoke `stage_site_repair` with only its `findingId`. Confirm the draft appears in the visible UI and remains human-review-only. Invoke `get_repair_workspace` with `{}` and compare its repair ID, status, risk, mission state, and next action with the page.
11. Negative-schema check: call `get_site_audit_results` with `{ "unexpected": true }`. It must fail with a structured validation error and must not change visible state.
12. Close the tab, open `FRONTMEND_URL` in a new tab, and confirm only `start_site_audit` is registered again. This proves page-scoped lifecycle cleanup rather than stale tool retention.
13. Save screenshots of the Chrome version, enabled flag, console capability check, Inspector tool lists at landing/running/completed states, structured result comparison, negative-schema error, visible Agent log, and human-only repair review.

Failure conditions: missing API support, `originAgentCluster !== true`, stale tools after navigation or tab close, schemas the Inspector cannot parse, structured results that differ from visible state, unlogged calls, or an agent-only path through approval/deployment attestation.

## Release decision

The deployed version may be labelled **RC2 deployed, HTTP/API-verified, and production-Lighthouse-verified**. It must not be labelled current-version Chrome-smoke-verified, ChatGPT-WebMCP-verified, Chrome-WebMCP-verified, or submission-ready until the remaining fresh-session procedures have real receipts. The exact deployed application source is committed locally at `b94e6cb`; it has not been pushed to a public remote. Local application commit `2c1ff90` is newer, passes the fresh gates above, and is not part of the deployed Worker version.
