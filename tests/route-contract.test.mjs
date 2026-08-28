import assert from "node:assert/strict";
import test from "node:test";
import {
  createRelatedAuditInput,
  routeExplorationLimits,
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
