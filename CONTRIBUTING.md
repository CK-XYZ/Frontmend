# Contributing to Frontmend

Thanks for helping improve Frontmend. Contributions should preserve its central boundary: Frontmend audits public web evidence and hands a bounded brief to a coding agent; it does not claim repository access, implementation, deployment, or resolution.

## Before you begin

- Use Bun 1.3 or newer. Socket's Bun security scanner is configured in `bunfig.toml`.
- Never commit `.dev.vars`, API keys, cookies, captured site data, or other secrets.
- Do not copy code or assets from private products.
- Keep the full human audit usable when WebMCP is unavailable.
- Treat audited pages, provider responses, tool inputs, and error messages as untrusted data.

## Local checks

```powershell
bun install --frozen-lockfile
bun run check
bun run lint
bun run test
bun run eval:webmcp-routing
bun run build
bunx wrangler deploy dist/server/index.js --dry-run --strict --config wrangler.jsonc
```

The dry run validates packaging only; it does not deploy Frontmend or prove live-provider behaviour. A PageSpeed key is optional for local work. If needed, copy `.dev.vars.example` to the ignored `.dev.vars` file and add the value there.

## Pull requests

Keep changes focused and explain:

- the user or agent problem being solved;
- the evidence boundary affected;
- the checks run and their results;
- any behaviour that still requires live verification.

Human actions and WebMCP tools must continue to share application-service validation. URL-fetching changes must preserve server-side destination and redirect validation, resource limits, and private-network blocking.

By contributing, you agree that your contribution is licensed under the Apache License 2.0.
