import assert from "node:assert/strict";
import test from "node:test";
import { runDocumentAudit, runFrontmendAudit, runPageSpeedAudit } from "../worker/pagespeed-provider.js";

function lighthouseFixture(strategy) {
  const mobile = strategy === "mobile";
  return {
    analysisUTCTimestamp: "2026-08-27T00:00:00.000Z",
    lighthouseResult: {
      finalUrl: "https://removemyexif.com/",
      lighthouseVersion: "13.0.0",
      categories: {
        performance: { score: mobile ? 0.72 : 0.91 },
        accessibility: { score: mobile ? 0.88 : 0.96 },
        "best-practices": { score: 1 },
        seo: { score: 1 },
      },
      audits: {
        "color-contrast": {
          score: mobile ? 0 : 1,
          scoreDisplayMode: "binary",
          displayValue: mobile ? "2 elements" : undefined,
          details: {
            items: mobile ? [{ node: { selector: ".muted-copy" } }] : [],
          },
        },
        "largest-contentful-paint": {
          score: mobile ? 0.35 : 0.93,
          scoreDisplayMode: "numeric",
          numericValue: mobile ? 4_800 : 1_900,
          displayValue: mobile ? "4.8 s" : "1.9 s",
        },
        "final-screenshot": {
          score: null,
          scoreDisplayMode: "informative",
          details: { data: "data:image/jpeg;base64,YWJj" },
        },
      },
    },
  };
}

test("builds bounded live Lighthouse evidence for mobile and desktop", async () => {
  const calls = [];
  const progress = [];
  const output = await runPageSpeedAudit({
    auditId: "b8b16bf0-913c-40ea-a741-bb4bf76d326b",
    url: "https://removemyexif.com/",
    now: () => 1_787_766_000_000,
    onProgress: async (state) => progress.push(state),
    fetchImpl: async (url) => {
      const strategy = url.searchParams.get("strategy");
      calls.push({
        strategy,
        categories: url.searchParams.getAll("category"),
        hasKey: url.searchParams.has("key"),
      });
      return Response.json(lighthouseFixture(strategy));
    },
  });

  assert.deepEqual(
    calls.map((call) => call.strategy),
    ["mobile", "desktop"],
  );
  assert.equal(calls.every((call) => call.categories.length === 4), true);
  assert.equal(calls.every((call) => call.hasKey === false), true);
  assert.equal(progress.at(-1).phase, "inspect");
  assert.equal(output.report.engine.mode, "live-lighthouse");
  assert.equal(output.report.engine.provider, "PageSpeed Insights");
  assert.equal(output.report.viewportCount, 2);
  assert.equal(output.report.viewports.length, 2);
  assert.equal(output.report.findingCount, 2);
  assert.equal(output.report.findingsOmitted, 0);
  assert.equal(output.report.findings[0].source.provider, "Lighthouse");
  assert.equal(output.report.findings.some((finding) => finding.id === "mobile-color-contrast"), true);
  assert.equal(
    output.report.findings.some((finding) => finding.id === "mobile-largest-contentful-paint"),
    true,
  );
  assert.equal(output.report.findings.every((finding) => finding.evidence.length <= 240), true);
  assert.equal(output.report.findings.every((finding) => !finding.evidence.includes("<")), true);
  assert.deepEqual(output.report.checks, { passed: 2, warnings: 0, failed: 2 });
  assert.deepEqual(
    output.report.ruleOutcomes.filter((outcome) => outcome.source.auditId === "color-contrast"),
    [
      {
        source: { provider: "Lighthouse", auditId: "color-contrast", strategy: "mobile" },
        status: "failed",
      },
      {
        source: { provider: "Lighthouse", auditId: "color-contrast", strategy: "desktop" },
        status: "passed",
      },
    ],
  );
  assert.equal(output.screenshots.mobile, "data:image/jpeg;base64,YWJj");
  assert.equal("screenshots" in output.report, false);
  assert.equal("documentProfile" in output.report, false);
});

test("retains bounded actionable diagnostics for console, contrast, and long tasks", async () => {
  const output = await runPageSpeedAudit({
    auditId: "b8b16bf0-913c-40ea-a741-bb4bf76d326b",
    url: "https://example.com/",
    fetchImpl: async (url) => {
      const mobile = url.searchParams.get("strategy") === "mobile";
      const failed = mobile ? 0 : 1;
      return Response.json({
        lighthouseResult: {
          finalUrl: "https://example.com/",
          lighthouseVersion: "13.4.1",
          categories: {
            performance: { score: mobile ? 0.8 : 1 },
            accessibility: { score: mobile ? 0.9 : 1 },
            "best-practices": { score: mobile ? 0.9 : 1 },
            seo: { score: 1 },
          },
          audits: {
            "errors-in-console": {
              score: failed,
              scoreDisplayMode: "binary",
              displayValue: mobile ? "2 errors logged to the console" : undefined,
              details: { items: mobile ? [
                {
                  source: "network",
                  description: "Failed to load resource: the server responded with 404",
                  sourceLocation: {
                    url: "https://example.com/assets/missing.js?token=must-not-persist",
                    line: 12,
                    column: 4,
                  },
                },
              ] : [] },
            },
            "color-contrast": {
              score: failed,
              scoreDisplayMode: "binary",
              displayValue: mobile ? "1 element" : undefined,
              details: { items: mobile ? [{
                node: {
                  selector: "button.muted",
                  nodeLabel: "Continue",
                  snippet: "<button class=\"muted\">Continue</button>",
                  explanation: "Element has insufficient color contrast of 2.4 (foreground color: #777777, background color: #ffffff). Expected ratio of 4.5:1",
                },
              }] : [] },
            },
            "total-blocking-time": {
              score: failed,
              scoreDisplayMode: "numeric",
              numericValue: mobile ? 280 : 0,
              displayValue: mobile ? "280 ms" : "0 ms",
            },
            "long-tasks": {
              score: 1,
              scoreDisplayMode: "informative",
              details: { items: mobile
                ? Array.from({ length: 7 }, (_, index) => ({
                    duration: 80 + index,
                    startTime: 100 + index,
                    url: `https://cdn.example.com/app.js?build=${index}`,
                  }))
                : [] },
            },
          },
        },
      });
    },
  });

  const consoleFinding = output.report.findings.find((finding) => finding.id === "mobile-errors-in-console");
  assert.equal(consoleFinding.diagnosticEvidence.kind, "console-errors");
  assert.equal(consoleFinding.diagnosticEvidence.completeness, "actionable");
  assert.equal(consoleFinding.diagnosticEvidence.entries[0].sourceUrl, "https://example.com/assets/missing.js");
  assert.equal(JSON.stringify(consoleFinding.diagnosticEvidence).includes("must-not-persist"), false);
  assert.equal(consoleFinding.diagnosticEvidence.entries[0].lineNumber, 12);

  const contrastFinding = output.report.findings.find((finding) => finding.id === "mobile-color-contrast");
  assert.equal(contrastFinding.diagnosticEvidence.nodes[0].selector, "button.muted");
  assert.equal(contrastFinding.diagnosticEvidence.nodes[0].observedRatio, 2.4);
  assert.equal(contrastFinding.diagnosticEvidence.nodes[0].expectedRatio, 4.5);
  assert.match(contrastFinding.diagnosticEvidence.nodes[0].snippet, /Continue/);

  const blockingFinding = output.report.findings.find((finding) => finding.id === "mobile-total-blocking-time");
  assert.equal(blockingFinding.diagnosticEvidence.totalBlockingTimeMs, 280);
  assert.equal(blockingFinding.diagnosticEvidence.longTasks.length, 5);
  assert.equal(blockingFinding.diagnosticEvidence.omitted, 2);
  assert.equal(blockingFinding.diagnosticEvidence.longTasks[0].sourceUrl, "https://cdn.example.com/app.js");
});

test("retains supported SEO findings with explicit accessibility and SEO focus areas", async () => {
  const output = await runPageSpeedAudit({
    auditId: "b8b16bf0-913c-40ea-a741-bb4bf76d326b",
    url: "https://example.com/",
    fetchImpl: async (url) => {
      const fixture = lighthouseFixture(url.searchParams.get("strategy"));
      fixture.lighthouseResult.audits = {
        "meta-description": { score: 0, scoreDisplayMode: "binary", displayValue: "No meta description" },
        "document-title": { score: 0, scoreDisplayMode: "binary", displayValue: "No title" },
        "robots-txt": { score: 1, scoreDisplayMode: "binary" },
      };
      return Response.json(fixture);
    },
  });

  assert.equal(output.report.findingCount, 4);
  const meta = output.report.findings.find((finding) => finding.id === "mobile-meta-description");
  assert.deepEqual(meta.focusAreas, ["seo"]);
  const title = output.report.findings.find((finding) => finding.id === "mobile-document-title");
  assert.deepEqual(title.focusAreas, ["accessibility", "seo"]);
  assert.equal(output.report.ruleOutcomes.some((outcome) => outcome.source.auditId === "robots-txt" && outcome.status === "passed"), true);
});

test("reports the full Lighthouse failure total while bounding detailed findings", async () => {
  const failingAuditIds = [
    "color-contrast",
    "tap-targets",
    "image-alt",
    "label",
    "button-name",
    "link-name",
    "viewport",
    "heading-order",
    "document-title",
    "html-has-lang",
    "errors-in-console",
    "is-on-https",
    "largest-contentful-paint",
    "cumulative-layout-shift",
    "total-blocking-time",
  ];
  const output = await runPageSpeedAudit({
    auditId: "b8b16bf0-913c-40ea-a741-bb4bf76d326b",
    url: "https://removemyexif.com/",
    fetchImpl: async (url) => {
      const fixture = lighthouseFixture(url.searchParams.get("strategy"));
      fixture.lighthouseResult.audits = Object.fromEntries(
        failingAuditIds.map((id) => [id, {
          score: 0,
          scoreDisplayMode: "binary",
          displayValue: "Measured failure",
          numericValue: id === "largest-contentful-paint" ? 4_800 : 1_000,
          details: { items: [{ node: { selector: `#${id}` } }] },
        }]),
      );
      return Response.json(fixture);
    },
  });

  assert.equal(output.report.findingCount, 30);
  assert.equal(output.report.findings.length, 10);
  assert.equal(output.report.findingsOmitted, 20);
  assert.equal(output.report.ruleOutcomes.length, 30);
  assert.equal(output.report.ruleOutcomes.every((outcome) => outcome.status === "failed"), true);
});

test("rejects a streamed provider response that exceeds the actual-byte limit", async () => {
  const chunk = new Uint8Array(1024 * 1024);
  const body = new ReadableStream({
    start(controller) {
      for (let index = 0; index < 13; index += 1) controller.enqueue(chunk);
      controller.close();
    },
  });
  await assert.rejects(
    () =>
      runPageSpeedAudit({
        auditId: "b8b16bf0-913c-40ea-a741-bb4bf76d326b",
        url: "https://removemyexif.com/",
        fetchImpl: async () => new Response(body, { status: 200 }),
      }),
    (error) => error.code === "PROVIDER_RESPONSE_TOO_LARGE",
  );
});

test("does not retain active SVG returned as screenshot evidence", async () => {
  const output = await runPageSpeedAudit({
    auditId: "b8b16bf0-913c-40ea-a741-bb4bf76d326b",
    url: "https://removemyexif.com/",
    fetchImpl: async (url) => {
      const fixture = lighthouseFixture(url.searchParams.get("strategy"));
      fixture.lighthouseResult.audits["final-screenshot"].details.data =
        "data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+PC9zdmc+";
      return Response.json(fixture);
    },
  });
  assert.deepEqual(output.screenshots, {});
  assert.equal(output.report.viewports.every((viewport) => viewport.evidenceUrl === null), true);
});

test("returns a recoverable provider error for quota exhaustion", async () => {
  await assert.rejects(
    () =>
      runPageSpeedAudit({
        auditId: "b8b16bf0-913c-40ea-a741-bb4bf76d326b",
        url: "https://removemyexif.com/",
        fetchImpl: async () => new Response("quota", { status: 429 }),
      }),
    (error) =>
      error.code === "PROVIDER_RATE_LIMITED" &&
      error.recoverable === true &&
      !error.message.includes("quota"),
  );
});

test("propagates caller cancellation without falling back to another provider", async () => {
  const controller = new AbortController();
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  let calls = 0;
  const operation = runFrontmendAudit({
    auditId: "b8b16bf0-913c-40ea-a741-bb4bf76d326b",
    url: "https://removemyexif.com/",
    signal: controller.signal,
    fetchImpl: async (_input, { signal }) => {
      calls += 1;
      markStarted();
      return new Promise((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(new DOMException("The operation was aborted.", "AbortError")),
          { once: true },
        );
      });
    },
  });

  await started;
  controller.abort("cancelled");
  await assert.rejects(
    () => operation,
    (error) => error.code === "AUDIT_CANCELLED" && error.recoverable === true,
  );
  assert.equal(calls, 2);
});

test("blocks a private DNS answer before any provider or document request", async () => {
  let fetches = 0;
  await assert.rejects(
    () => runFrontmendAudit({
      auditId: "b8b16bf0-913c-40ea-a741-bb4bf76d326b",
      url: "https://public-name.example/",
      resolveHostname: async () => [{ address: "169.254.169.254", family: 4 }],
      fetchImpl: async () => {
        fetches += 1;
        return new Response("unreachable");
      },
    }),
    (error) => error?.code === "RESOLVED_DESTINATION_BLOCKED",
  );
  assert.equal(fetches, 0);
});

test("re-resolves and blocks every redirect destination before following it", async () => {
  const resolutions = [];
  const fetches = [];
  await assert.rejects(
    () => runDocumentAudit({
      auditId: "b8b16bf0-913c-40ea-a741-bb4bf76d326b",
      url: "https://public-name.example/",
      resolveHostname: async (hostname) => {
        resolutions.push(hostname);
        return [{ address: hostname === "public-name.example" ? "93.184.216.34" : "127.0.0.1" }];
      },
      fetchImpl: async (input) => {
        fetches.push(String(input));
        return new Response(null, {
          status: 302,
          headers: { location: "https://private-hop.example/admin" },
        });
      },
    }),
    (error) => error?.code === "RESOLVED_DESTINATION_BLOCKED",
  );
  assert.deepEqual(resolutions, ["public-name.example", "private-hop.example"]);
  assert.deepEqual(fetches, ["https://public-name.example/"]);
});

test("falls back to bounded live document evidence when Lighthouse is rate limited", async () => {
  let calls = 0;
  const output = await runFrontmendAudit({
    auditId: "b8b16bf0-913c-40ea-a741-bb4bf76d326b",
    url: "https://removemyexif.com/",
    now: () => 1_787_766_000_000,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return new Response("quota", { status: 429 });
      return new Response(
        '<!doctype html><html lang="en"><head><title>Remove My EXIF</title><meta name="description" content="Remove image metadata privately."><meta name="viewport" content="width=device-width"></head><body><main><h1>Remove metadata</h1><img src="hero.png"></main></body></html>',
        {
          status: 200,
          headers: {
            "content-type": "text/html; charset=utf-8",
            "content-security-policy": "default-src 'self'",
            "x-content-type-options": "nosniff",
          },
        },
      );
    },
  });

  assert.equal(calls, 3);
  assert.equal(output.report.engine.mode, "live-document");
  assert.equal(output.report.engine.fallbackReason, "PROVIDER_RATE_LIMITED");
  assert.equal(output.report.viewportCount, 0);
  assert.equal(output.report.findings.length, 1);
  assert.equal(output.report.findings[0].id, "document-image-alt");
  assert.equal(output.report.findings[0].evidence, "Observed 1 of 1 image elements without alt attributes.");
  assert.equal(
    output.report.ruleOutcomes.find((outcome) => outcome.source.auditId === "image-alt").status,
    "failed",
  );
  assert.equal(
    output.report.ruleOutcomes.find((outcome) => outcome.source.auditId === "missing-h1").status,
    "passed",
  );
  assert.deepEqual(output.screenshots, {});
});

test("retains one successful Lighthouse viewport and supplements it with document evidence", async () => {
  const calls = [];
  const output = await runFrontmendAudit({
    auditId: "b8b16bf0-913c-40ea-a741-bb4bf76d326b",
    url: "https://removemyexif.com/",
    now: () => 1_787_766_000_000,
    fetchImpl: async (input) => {
      const requestUrl = new URL(input);
      if (requestUrl.hostname === "pagespeedonline.googleapis.com") {
        const strategy = requestUrl.searchParams.get("strategy");
        calls.push(strategy);
        if (strategy === "desktop") return new Response("busy", { status: 429 });
        const fixture = lighthouseFixture(strategy);
        fixture.lighthouseResult.audits["image-alt"] = {
          score: 0,
          scoreDisplayMode: "binary",
          displayValue: "1 image",
          details: { items: [{ node: { selector: "img.hero" } }] },
        };
        return Response.json(fixture);
      }
      calls.push("document");
      return new Response(
        '<!doctype html><html lang="en"><head><title>Remove My EXIF</title><meta name="description" content="Remove image metadata privately."><meta name="viewport" content="width=device-width"></head><body><main><h1>Remove metadata</h1><img class="hero" src="/hero.jpg"></main></body></html>',
        {
          status: 200,
          headers: {
            "content-type": "text/html; charset=utf-8",
            "x-content-type-options": "nosniff",
          },
        },
      );
    },
  });

  assert.deepEqual(calls, ["mobile", "desktop", "document"]);
  assert.equal(output.report.engine.mode, "hybrid-lighthouse-document");
  assert.equal(output.report.engine.fallbackReason, "PARTIAL_LIGHTHOUSE");
  assert.equal(output.report.viewportCount, 1);
  assert.deepEqual(output.report.viewports.map((viewport) => viewport.id), ["mobile", "document"]);
  assert.deepEqual(output.report.viewportFailures, [{
    id: "desktop",
    label: "Desktop",
    status: "unavailable",
    code: "PROVIDER_RATE_LIMITED",
    message: "The live audit provider is busy. Try again in a few minutes.",
    recoverable: true,
  }]);
  assert.equal(output.report.scoreBasis, "measured-lighthouse-viewports");
  assert.equal(output.report.documentProfile.type, "live-document-profile");
  assert.deepEqual(output.report.documentSupplement, {
    evaluatedRuleCount: 9,
    overlappingRulesOmitted: 1,
    caveat: "Fetched-document rules already evaluated by retained Lighthouse evidence were omitted from combined totals. Document evidence does not replace viewport or rendered-browser evidence.",
  });
  assert.deepEqual(output.report.checks, { passed: 8, warnings: 1, failed: 3 });
  assert.equal(output.report.findingCount, 4);
  assert.equal(output.report.findings.some((finding) => finding.id === "mobile-color-contrast"), true);
  assert.equal(output.report.findings.some((finding) => finding.id === "mobile-image-alt"), true);
  assert.equal(output.report.findings.some((finding) => finding.id === "document-image-alt"), false);
  assert.equal(
    output.report.ruleOutcomes.filter((outcome) => outcome.source.auditId === "image-alt").length,
    1,
  );
  assert.equal(
    output.report.findings.some((finding) => finding.id === "document-content-security-policy"),
    true,
  );
  assert.equal(output.screenshots.mobile, "data:image/jpeg;base64,YWJj");
  assert.equal("desktop" in output.screenshots, false);
});

test("returns partial Lighthouse evidence when the document supplement also fails", async () => {
  const output = await runFrontmendAudit({
    auditId: "b8b16bf0-913c-40ea-a741-bb4bf76d326b",
    url: "https://removemyexif.com/",
    fetchImpl: async (input) => {
      const requestUrl = new URL(input);
      if (requestUrl.hostname !== "pagespeedonline.googleapis.com") {
        return new Response("unavailable", { status: 503 });
      }
      const strategy = requestUrl.searchParams.get("strategy");
      if (strategy === "desktop") return new Response("failed", { status: 500 });
      return Response.json(lighthouseFixture(strategy));
    },
  });

  assert.equal(output.report.engine.mode, "live-lighthouse-partial");
  assert.equal(output.report.viewportCount, 1);
  assert.deepEqual(output.report.viewports.map((viewport) => viewport.id), ["mobile"]);
  assert.equal(output.report.viewportFailures[0].id, "desktop");
  assert.equal(output.report.viewportFailures[0].code, "PROVIDER_FAILED");
  assert.equal("documentProfile" in output.report, false);
  assert.equal(output.report.coverage.level, "viewport-only");
  assert.equal(output.report.coverage.sources.document.status, "unavailable");
  assert.equal(output.report.sourceFailures[0].source, "document");
});

test("combines full Lighthouse and live document evidence for every successful audit", async () => {
  const calls = [];
  const output = await runFrontmendAudit({
    auditId: "b8b16bf0-913c-40ea-a741-bb4bf76d326b",
    url: "https://removemyexif.com/",
    now: () => 1_787_766_000_000,
    fetchImpl: async (input) => {
      const requestUrl = new URL(input);
      if (requestUrl.hostname === "pagespeedonline.googleapis.com") {
        const strategy = requestUrl.searchParams.get("strategy");
        calls.push(strategy);
        return Response.json(lighthouseFixture(strategy));
      }
      calls.push("document");
      return new Response(
        '<!doctype html><html lang="en"><head><title>Remove My EXIF</title><meta name="description" content="Remove image metadata privately."><meta name="viewport" content="width=device-width"></head><body><main><h1>Remove metadata</h1><a href="/privacy">Privacy</a></main></body></html>',
        {
          status: 200,
          headers: {
            "content-type": "text/html; charset=utf-8",
            "content-security-policy": "default-src 'self'",
            "x-content-type-options": "nosniff",
          },
        },
      );
    },
  });

  assert.deepEqual(calls.sort(), ["desktop", "document", "mobile"]);
  assert.equal(output.report.engine.mode, "live-lighthouse-document");
  assert.equal(output.report.engine.provider, "PageSpeed Insights + Frontmend document audit");
  assert.equal(output.report.viewportCount, 2);
  assert.deepEqual(output.report.viewports.map((viewport) => viewport.id), ["mobile", "desktop", "document"]);
  assert.equal(output.report.documentProfile.type, "live-document-profile");
  assert.deepEqual(output.report.documentProfile.routes, ["/privacy"]);
  assert.equal(output.report.coverage.level, "page-multi-source");
  assert.deepEqual(output.report.coverage.sources.lighthouse.measuredStrategies, ["mobile", "desktop"]);
  assert.equal(output.report.coverage.sources.document.routeCandidateCount, 1);
  assert.deepEqual(output.report.sourceFailures, []);
  assert.equal(output.report.documentSupplement.evaluatedRuleCount > 0, true);
  assert.equal(
    output.report.ruleOutcomes.filter((outcome) => outcome.source.auditId === "color-contrast").length,
    2,
  );
});

test("builds a bounded static CSP resource inventory without claiming runtime coverage", async () => {
  let calls = 0;
  const output = await runFrontmendAudit({
    auditId: "b8b16bf0-913c-40ea-a741-bb4bf76d326b",
    url: "https://removemyexif.com/",
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return new Response("quota", { status: 429 });
      return new Response(
        `<!doctype html><html lang="en"><head>
          <title>Remove My EXIF</title>
          <meta name="description" content="Remove image metadata privately.">
          <meta name="viewport" content="width=device-width">
          <link rel="stylesheet" href="https://styles.example.net/site.css">
          <link rel="preload" as="font" href="https://fonts.example.net/site.woff2">
          <script src="https://scripts.example.net/app.js"></script>
          <script>globalThis.boot = true;</script>
          <style>body { color: black; }</style>
        </head><body style="background:white"><main><h1>Remove metadata</h1>
          <img src="https://images.example.net/hero.png" alt="">
          <img src="/local.png" alt="">
          <iframe src="https://frames.example.net/embed"></iframe>
        </main></body></html>`,
        {
          status: 200,
          headers: {
            "content-type": "text/html; charset=utf-8",
            "x-content-type-options": "nosniff",
          },
        },
      );
    },
  });

  assert.equal(output.report.schemaVersion, 5);
  assert.equal(output.report.findings.length, 1);
  const finding = output.report.findings[0];
  assert.equal(finding.id, "document-content-security-policy");
  assert.deepEqual(finding.repairContext.directives, [
    { directive: "script-src", origins: ["https://scripts.example.net"], omitted: 0 },
    { directive: "style-src", origins: ["https://styles.example.net"], omitted: 0 },
    { directive: "img-src", origins: ["https://images.example.net"], omitted: 0 },
    { directive: "font-src", origins: ["https://fonts.example.net"], omitted: 0 },
    { directive: "frame-src", origins: ["https://frames.example.net"], omitted: 0 },
  ]);
  assert.deepEqual(finding.repairContext.inline, { scripts: 1, styles: 2 });
  assert.match(finding.repairContext.caveat, /Runtime requests/);
  assert.equal(JSON.stringify(finding.repairContext).includes("/local.png"), false);
  assert.deepEqual(output.report.documentProfile.elements, {
    scripts: 2,
    stylesheets: 1,
    images: 2,
    links: 0,
    forms: 0,
    headings: 1,
  });
  assert.deepEqual(output.report.documentProfile.inline, { scripts: 1, styles: 2 });
  assert.deepEqual(output.report.documentProfile.externalOrigins, [
    "https://fonts.example.net",
    "https://frames.example.net",
    "https://images.example.net",
    "https://scripts.example.net",
    "https://styles.example.net",
  ]);
  assert.equal(output.report.documentProfile.externalOriginsOmitted, 0);
  assert.equal(output.report.documentProfile.headers.contentSecurityPolicy, false);
  assert.equal(output.report.documentProfile.headers.nosniff, true);
  assert.match(output.report.documentProfile.caveat, /Runtime DOM changes/);
});

test("discovers bounded unique same-site page routes without claiming they were visited", async () => {
  let calls = 0;
  const links = [
    ...Array.from({ length: 12 }, (_, index) => `<a href="/page-${index}?source=nav#top">Page ${index}</a>`),
    '<a href="/page-0">Duplicate</a>',
    '<a href="/asset.png">Image</a>',
    '<a href="https://outside.example.net/page">External</a>',
    '<a href="mailto:hello@example.net">Email</a>',
    '<a href="/">Current page</a>',
  ].join("");
  const output = await runFrontmendAudit({
    auditId: "b8b16bf0-913c-40ea-a741-bb4bf76d326b",
    url: "https://removemyexif.com/",
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return new Response("quota", { status: 429 });
      return new Response(
        `<!doctype html><html lang="en"><head><title>Routes</title><meta name="viewport" content="width=device-width"></head><body><main><h1>Routes</h1>${links}</main></body></html>`,
        {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "content-security-policy": "default-src 'self'",
            "x-content-type-options": "nosniff",
          },
        },
      );
    },
  });

  assert.deepEqual(output.report.documentProfile.routes, [
    "/page-0",
    "/page-1",
    "/page-2",
    "/page-3",
    "/page-4",
    "/page-5",
    "/page-6",
    "/page-7",
  ]);
  assert.equal(output.report.documentProfile.routesOmitted, 4);
  assert.match(output.report.documentProfile.routesCaveat, /not visited or audited/);
  assert.equal(JSON.stringify(output.report.documentProfile.routes).includes("outside.example.net"), false);
  assert.equal(JSON.stringify(output.report.documentProfile.routes).includes("source=nav"), false);
});

test("keeps document-profile origins bounded while retaining aggregate counts", async () => {
  let calls = 0;
  const scripts = Array.from(
    { length: 20 },
    (_, index) => `<script src="https://assets-${index}.example.net/app.js"></script>`,
  ).join("");
  const output = await runFrontmendAudit({
    auditId: "b8b16bf0-913c-40ea-a741-bb4bf76d326b",
    url: "https://removemyexif.com/",
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return new Response("quota", { status: 429 });
      return new Response(
        `<!doctype html><html lang="en"><head><title>Profile bounds</title><meta name="viewport" content="width=device-width">${scripts}</head><body><main><h1>Profile</h1></main></body></html>`,
        {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "content-security-policy": "default-src 'self'",
            "x-content-type-options": "nosniff",
          },
        },
      );
    },
  });

  assert.equal(output.report.documentProfile.elements.scripts, 20);
  assert.equal(output.report.documentProfile.externalOrigins.length, 8);
  assert.equal(output.report.documentProfile.externalOriginsOmitted, 12);
  assert.equal(JSON.stringify(output.report.documentProfile).includes("assets-19.example.net"), false);
});
