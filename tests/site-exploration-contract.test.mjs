import assert from "node:assert/strict";
import test from "node:test";
import {
  createSiteExplorationInputs,
  createSiteRouteCandidates,
  createSiteExplorationMission,
  siteExplorationLimits,
  siteExplorationMarkdown,
  siteExplorationSnapshot,
} from "../src/site-exploration-contract.js";

const ROOT_ID = "19474d5a-a536-4cb3-84bf-99f00ba585c0";
const MISSION_ID = "232d593c-6c81-48c3-b137-a3df269454ff";
const CHILD_A = "be37882f-87f6-45cf-8c85-49f28fdef131";
const CHILD_B = "e76477a9-bf2a-4530-8891-fc8978d3058c";

function rootReport() {
  return {
    auditId: ROOT_ID,
    finalUrl: "https://removemyexif.com/",
    documentProfile: { routes: ["/privacy", "/terms", "/tools"] },
  };
}

function mission() {
  const inputs = createSiteExplorationInputs(rootReport(), ["/privacy", "/terms"]);
  return createSiteExplorationMission({
    missionId: MISSION_ID,
    rootAuditId: ROOT_ID,
    source: "agent",
    routes: inputs.routes,
    children: [{ auditId: CHILD_A }, { auditId: CHILD_B }],
    createdAt: 100,
  });
}

function completeAudit(id, path, score, extraFinding = null) {
  return {
    id,
    status: "complete",
    progress: 100,
    report: {
      score,
      checks: { passed: 8, warnings: 0, failed: 1 },
      findingCount: extraFinding ? 2 : 1,
      findings: [
        {
          id: "document-content-security-policy",
          title: "No Content Security Policy header was observed",
          category: "security",
          severity: "low",
          evidence: `CSP was absent on ${path}.`,
          source: { provider: "frontmend-document", auditId: "document-content-security-policy" },
        },
        ...(extraFinding ? [extraFinding] : []),
      ],
    },
  };
}

test("validates a bounded unique set of authoritative observed routes", () => {
  const input = createSiteExplorationInputs(rootReport(), ["/privacy", "/terms"]);
  assert.equal(input.routes.length, 2);
  assert.equal(input.routes[0].url, "https://removemyexif.com/privacy");
  assert.equal(input.routes[0].exploration.parentAuditId, ROOT_ID);
  assert.throws(
    () => createSiteExplorationInputs(rootReport(), ["/privacy", "/privacy"]),
    (error) => error.code === "INVALID_INPUT",
  );
  assert.throws(
    () => createSiteExplorationInputs(rootReport(), ["/not-observed"]),
    (error) => error.code === "ROUTE_NOT_OBSERVED",
  );
  assert.equal(siteExplorationLimits.maxRoutes, 3);
});

test("accepts only deterministic server-issued route candidates for bounded-site missions", () => {
  const report = rootReport();
  const candidates = createSiteRouteCandidates(report);
  assert.equal(candidates.length, 3);
  const inputs = createSiteExplorationInputs(
    report,
    { routeCandidateIds: [candidates[0].id, candidates[2].id] },
    { requireCandidateIds: true },
  );
  assert.deepEqual(inputs.routes.map((route) => route.path), ["/privacy", "/tools"]);
  assert.throws(
    () => createSiteExplorationInputs(report, { routeCandidateIds: ["route-deadbeef"] }, { requireCandidateIds: true }),
    (error) => error.code === "ROUTE_CANDIDATE_INVALID",
  );
  assert.throws(
    () => createSiteExplorationInputs(report, ["/privacy"], { requireCandidateIds: true }),
    /server-issued routeCandidateIds/,
  );
});

test("mints bounded exploration candidates from server-validated rendered routes", () => {
  const report = {
    ...rootReport(),
    documentProfile: { routes: [] },
    renderedRouteObservations: [
      { path: "/projects", source: "agent-reported-browser-route", method: "HEAD", validatedAt: 500 },
      { path: "/services", source: "person-reported-browser-route", method: "HEAD", validatedAt: 501 },
      { path: "/contact", source: "agent-reported-browser-route", method: "GET", validatedAt: 502 },
      { path: "/omitted", source: "agent-reported-browser-route", method: "HEAD", validatedAt: 503 },
    ],
  };
  const candidates = createSiteRouteCandidates(report);
  assert.equal(candidates.length, 3);
  assert.deepEqual(candidates.map((item) => [item.path, item.source]), [
    ["/projects", "agent-reported-browser-route"],
    ["/services", "person-reported-browser-route"],
    ["/contact", "agent-reported-browser-route"],
  ]);
  const input = createSiteExplorationInputs(
    report,
    { routeCandidateIds: [candidates[0].id] },
    { requireCandidateIds: true },
  );
  assert.equal(input.routes[0].source, "agent-reported-browser-route");
});

test("aggregates recurring rule evidence across completed page audits", () => {
  const snapshot = siteExplorationSnapshot(mission(), [
    completeAudit(CHILD_A, "/privacy", 89),
    completeAudit(CHILD_B, "/terms", 89, {
      id: "document-title",
      title: "Document title needs attention",
      category: "content",
      severity: "medium",
      evidence: "A bounded second issue.",
      source: { provider: "frontmend-document", auditId: "document-title" },
    }),
  ]);

  assert.equal(snapshot.status, "complete");
  assert.equal(snapshot.progress, 100);
  assert.deepEqual(snapshot.summary, {
    pagesRequested: 2,
    pagesComplete: 2,
    pagesFailed: 0,
    totalFindings: 3,
    uniqueIssues: 2,
    recurringIssues: 1,
  });
  assert.equal(snapshot.issues[0].ruleId, "document-content-security-policy");
  assert.equal(snapshot.issues[0].occurrenceCount, 2);
  assert.equal(snapshot.issues[0].distinctPageCount, 2);
  assert.deepEqual(snapshot.issues[0].occurrences.map((item) => item.path), ["/privacy", "/terms"]);
});

test("separates viewport occurrences from distinct affected pages", () => {
  const singleRoute = createSiteExplorationMission({
    missionId: MISSION_ID,
    rootAuditId: ROOT_ID,
    source: "agent",
    routes: createSiteExplorationInputs(rootReport(), ["/privacy"]).routes,
    children: [{ auditId: CHILD_A }],
    createdAt: 100,
  });
  const audit = completeAudit(CHILD_A, "/privacy", 89, {
    id: "desktop-content-security-policy",
    title: "No Content Security Policy header was observed",
    category: "security",
    severity: "low",
    evidence: "CSP was also absent in the desktop strategy.",
    source: {
      provider: "frontmend-document",
      auditId: "document-content-security-policy",
      strategy: "desktop",
    },
  });
  audit.report.findings[0].source.strategy = "mobile";
  const snapshot = siteExplorationSnapshot(singleRoute, [audit]);

  assert.equal(snapshot.issues[0].occurrenceCount, 2);
  assert.equal(snapshot.issues[0].distinctPageCount, 1);
  assert.equal(snapshot.summary.recurringIssues, 0);
  assert.match(siteExplorationMarkdown(snapshot), /Observed: 2 occurrences across 1 selected page/);
});

test("keeps partial missions truthful when one child fails", () => {
  const snapshot = siteExplorationSnapshot(mission(), [
    completeAudit(CHILD_A, "/privacy", 89),
    {
      id: CHILD_B,
      status: "failed",
      progress: 42,
      error: { code: "DOCUMENT_TIMEOUT", message: "The page timed out.", recoverable: true },
    },
  ]);
  assert.equal(snapshot.status, "partial");
  assert.equal(snapshot.summary.pagesComplete, 1);
  assert.equal(snapshot.summary.pagesFailed, 1);
  assert.equal(snapshot.pages[1].error.code, "DOCUMENT_TIMEOUT");
});

test("exports bounded cross-page evidence without a complete-crawl claim", () => {
  const snapshot = siteExplorationSnapshot(mission(), [
    completeAudit(CHILD_A, "/privacy", 89),
    completeAudit(CHILD_B, "/terms", 89),
  ]);
  const markdown = siteExplorationMarkdown(snapshot);
  assert.match(markdown, /# Frontmend site exploration/);
  assert.match(markdown, /Observed: 2 occurrences across 2 selected pages/);
  assert.match(markdown, /\/privacy/);
  assert.match(markdown, /not claim a complete crawl/);
});
