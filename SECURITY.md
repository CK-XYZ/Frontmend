# Security policy

## Reporting a vulnerability

Please report security vulnerabilities privately through the repository's **Security** tab using **Report a vulnerability**. Do not include exploit details, credentials, personal data, or vulnerable target URLs in a public issue.

Include the affected revision, a concise impact description, reproducible steps using a target you are authorised to test, and any suggested mitigation. Maintainers will assess the report and coordinate disclosure after a fix is available.

## Security boundaries

Frontmend accepts public URLs and processes untrusted site and provider data. Reports involving server-side request forgery, redirect or DNS validation, cross-audit access, WebMCP mutation authority, script injection, secret exposure, or resource-exhaustion controls are especially useful.

Frontmend is an automated audit aid, not a penetration-testing service. Only test systems you own or have explicit permission to assess.
