import assert from "node:assert/strict";
import test from "node:test";
import {
  createRelatedAuditInput,
  mergeRenderedRouteObservations,
  normalizeRenderedRouteObservations,
  observedRouteRecords,
  routeExplorationLimits,
  validateRenderedRouteObservations,
} from "../src/route-contract.js";

const ROOT_ID = "19474d5a-a536-4cb3-84bf-99f00ba585c0";
const PARENT_ID = "232d593c-6c81-48c3-b137-a3df269454ff";

function report(overrides = {}) {
  return {
    auditId: ROOT_ID,
    finalUrl: "https://removemyexif.com/",
    documentProfile: { routes: ["/privacy", "/tools", "//outside.example.net/path"] },
    ...overrides,
  };
}

test("creates bounded root lineage from an exact observed same-site path", () => {
  const related = createRelatedAuditInput(report(), "/privacy");
  assert.equal(related.url, "https://removemyexif.com/privacy");
  assert.deepEqual(related.exploration, {
    rootAuditId: ROOT_ID,
    parentAuditId: ROOT_ID,
    observedPath: "/privacy",
    depth: 1,
    trail: [{ auditId: ROOT_ID, path: "/" }],
  });
});

test("rejects unobserved and origin-changing paths even if hostile markup supplied them", () => {
  assert.throws(
    () => createRelatedAuditInput(report(), "/not-observed"),
    (error) => error.code === "ROUTE_NOT_OBSERVED",
  );
  assert.throws(
    () => createRelatedAuditInput(report(), "//outside.example.net/path"),
    (error) => error.code === "ROUTE_NOT_OBSERVED",
  );
});

test("carries the root and bounded ancestor trail across multiple route hops", () => {
  const related = createRelatedAuditInput(
    report({
      auditId: PARENT_ID,
      finalUrl: "https://removemyexif.com/tools",
      exploration: {
        rootAuditId: ROOT_ID,
        parentAuditId: ROOT_ID,
        observedPath: "/tools",
        depth: 1,
        trail: [{ auditId: ROOT_ID, path: "/" }],
      },
    }),
    "/privacy",
  );

  assert.equal(related.exploration.rootAuditId, ROOT_ID);
  assert.equal(related.exploration.parentAuditId, PARENT_ID);
  assert.equal(related.exploration.depth, 2);
  assert.deepEqual(related.exploration.trail, [
    { auditId: ROOT_ID, path: "/" },
    { auditId: PARENT_ID, path: "/tools" },
  ]);
});

test("stops a route journey at its explicit maximum depth", () => {
  assert.equal(routeExplorationLimits.maxDepth, 5);
  assert.throws(
    () =>
      createRelatedAuditInput(
        report({
          exploration: {
            rootAuditId: ROOT_ID,
            parentAuditId: PARENT_ID,
            observedPath: "/tools",
            depth: routeExplorationLimits.maxDepth,
            trail: [{ auditId: ROOT_ID, path: "/" }],
          },
        }),
        "/privacy",
      ),
    (error) => error.code === "ROUTE_DEPTH_LIMIT",
  );
});

test("normalizes only bounded relative rendered routes", () => {
  assert.deepEqual(
    normalizeRenderedRouteObservations(report({ documentProfile: { routes: [] } }), ["/projects", "/services"])
      .map((item) => item.path),
    ["/projects", "/services"],
  );
  for (const invalid of [
    ["https://outside.example/projects"],
    ["//127.0.0.1/private"],
    ["/projects?draft=1"],
    ["/projects#private"],
    ["/projects", "/projects"],
  ]) {
    assert.throws(
      () => normalizeRenderedRouteObservations(report(), invalid),
      (error) => error.code === "INVALID_BROWSER_REVIEW",
    );
  }
  assert.equal(routeExplorationLimits.maxRenderedRouteObservations, 8);
});

test("revalidates rendered routes before they join authoritative route evidence", async () => {
  const calls = [];
  const validated = await validateRenderedRouteObservations({
    report: report({ documentProfile: { routes: [] } }),
    observedRoutes: ["/projects", "/services"],
    source: "agent",
    now: 500,
    fetchImpl: async (url, init) => {
      calls.push([url, init.method, init.redirect]);
      return new Response(null, { status: 200, headers: { "content-type": "text/html" } });
    },
  });
  assert.deepEqual(calls, [
    ["https://removemyexif.com/projects", "HEAD", "manual"],
    ["https://removemyexif.com/services", "HEAD", "manual"],
  ]);
  assert.deepEqual(validated.map((item) => [item.path, item.source, item.validatedAt]), [
    ["/projects", "agent-reported-browser-route", 500],
    ["/services", "agent-reported-browser-route", 500],
  ]);

  const merged = mergeRenderedRouteObservations(report({ documentProfile: { routes: [] } }), validated);
  assert.deepEqual(observedRouteRecords(merged).map((item) => [item.path, item.source]), [
    ["/projects", "agent-reported-browser-route"],
    ["/services", "agent-reported-browser-route"],
  ]);
  assert.equal(createRelatedAuditInput(merged, "/projects").url, "https://removemyexif.com/projects");
});

test("fails rendered route validation across private or cross-origin redirects", async () => {
  for (const location of ["http://127.0.0.1/private", "https://outside.example/private"]) {
    await assert.rejects(
      validateRenderedRouteObservations({
        report: report({ documentProfile: { routes: [] } }),
        observedRoutes: ["/projects"],
        fetchImpl: async () => new Response(null, { status: 302, headers: { location } }),
      }),
      (error) => ["INVALID_URL", "PRIVATE_TARGET", "ROUTE_VALIDATION_FAILED"].includes(error.code),
    );
  }
});
