# Third-party notices

Frontmend is licensed under Apache-2.0. Its direct JavaScript dependencies are redistributed under the following licences, as declared by the installed package metadata on 27 August 2026:

| Package | Use | Licence |
| --- | --- | --- |
| React and React DOM | Human interface | MIT |
| Phosphor Icons for React | Interface icons | MIT |
| Vite and `@vitejs/plugin-react` | Development and production build | MIT |
| Wrangler | Cloudflare Worker development and packaging | MIT OR Apache-2.0 |
| Socket Bun Security Scanner | Dependency-install protection | MIT |

Exact versions and transitive packages are pinned by `bun.lock`. Their package metadata and licence files remain the authoritative redistribution terms.

Frontmend calls Google PageSpeed Insights when available. That remote service is not redistributed with this project; use is subject to Google's applicable API terms and quota policies. The production runtime targets Cloudflare Workers and Durable Objects, which are likewise external services governed by their own terms. The production domain also uses Cloudflare Web Analytics, delivered from `static.cloudflareinsights.com` with telemetry sent to `cloudflareinsights.com`; those are the only analytics origins permitted by the app's Content Security Policy.

Frontmend self-hosts three redistributable typefaces under the SIL Open Font License 1.1. Only Latin subsets are bundled, in `public/fonts/`, together with the upstream licence texts.

| Typeface | Use | Copyright | Licence |
| --- | --- | --- | --- |
| Geist | Interface and body text | Copyright 2024 The Geist Project Authors (https://github.com/vercel/geist-font) | SIL OFL 1.1 (`public/fonts/OFL-Geist.txt`) |
| Geist Mono | Code, selectors, and file references | Copyright 2024 The Geist Project Authors (https://github.com/vercel/geist-font) | SIL OFL 1.1 (`public/fonts/OFL-Geist.txt`) |
| Bricolage Grotesque | Display headlines | Copyright 2022 The Bricolage Grotesque Project Authors (https://github.com/ateliertriay/bricolage) | SIL OFL 1.1 (`public/fonts/OFL-Bricolage-Grotesque.txt`) |

The landing-page background fields in `public/backgrounds/` were generated for Frontmend and are covered by this repository's own licence.

The interface direction was independently implemented for Frontmend. No third-party screenshots, site captures, logos, or private product source are bundled.
