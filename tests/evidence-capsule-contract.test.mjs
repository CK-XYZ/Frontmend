import assert from "node:assert/strict";
import test from "node:test";
import {
  createEvidenceCapsules,
  getActiveEvidenceCapsule,
} from "../src/evidence-capsule-contract.js";

const audit = {
  id: "audit-1",
  url: "https://example.com/checkout",
  missionRevision: 7,
  mission: { schemaVersion: 2, focusAreas: ["accessibility"], maxPriorities: 2 },
};
const findings = [{
  id: "mobile-color-contrast",
  title: "Primary action has insufficient contrast",
  severity: "high",
  category: "Accessibility",
  viewport: "Mobile",
  selector: ".checkout-primary",
  evidence: "Lighthouse measured the foreground/background pair below the expected threshold.",
  source: {
    provider: "PageSpeed Insights / Lighthouse",
    auditId: "color-contrast",
    strategy: "mobile",
  },
}];
const report = {
  auditId: audit.id,
  url: audit.url,
  finalUrl: audit.url,
  completedAt: 1_777_000_000_000,
  findings,
  viewports: [{
    id: "mobile",
    label: "Mobile",
    detail: "Emulated 412 px viewport",
    evidenceUrl: "/api/audits/audit-1/evidence/mobile",
  }],
};
const missionState = {
  priorities: [{
    rank: 1,
    findingId: findings[0].id,
    source: findings[0].source,
    affectedStrategies: ["mobile"],
    evidenceProvenance: "measured-provider",
  }],
};

test("builds one revision-bound capsule per ranked priority from retained audit evidence", () => {
  const capsules = createEvidenceCapsules({ audit, report, missionState, findings });
  assert.equal(capsules.length, 1);
  const capsule = capsules[0];
  assert.equal(capsule.capsuleId, "audit-1:r7:mobile-color-contrast");
  assert.equal(capsule.auditRevision, 7);
  assert.equal(capsule.timestamp, report.completedAt);
  assert.equal(capsule.screenshot.url, "/api/audits/audit-1/evidence/mobile");
  assert.equal(capsule.screenshot.source, "lighthouse-audit-capture");
  assert.deepEqual(capsule.target, { route: "/checkout", selector: ".checkout-primary", landmark: null });
  assert.equal(capsule.evidence.source.provider, "PageSpeed Insights / Lighthouse");
  assert.equal(capsule.evidence.source.auditId, "color-contrast");
  assert.match(capsule.observationTask.instructions, /checkout-primary/i);
  assert.deepEqual(capsule.observationTask.requiredCapabilities, [
    "visual-browser-access",
    "responsive-emulation",
  ]);
  assert.match(capsule.boundary, /not a fresh capture/i);
});

test("returns only the active priority and rejects a stale selection", () => {
  const active = getActiveEvidenceCapsule({
    audit,
    report,
    missionState,
    findings,
    findingId: "mobile-color-contrast",
  });
  assert.equal(active.findingId, "mobile-color-contrast");
  assert.throws(
    () => getActiveEvidenceCapsule({
      audit,
      report,
      missionState,
      findings,
      findingId: "stale-finding",
    }),
    (error) => error.code === "EVIDENCE_NOT_FOUND",
  );
});

test("derives fallback observation capabilities from the viewport the fallback task names", () => {
  // No compiled or retained task matches this priority, so the capsule falls
  // back to its own observation task.
  const unmatched = [{
    ...findings[0],
    id: "mobile-tap-targets",
    selector: ".pay-now",
    source: { ...findings[0].source, auditId: "no-compiled-investigation" },
  }];
  const unmatchedMission = {
    priorities: [{ ...missionState.priorities[0], findingId: unmatched[0].id }],
  };
  const browserReview = { tasks: [{ id: "unrelated", trigger: { ruleId: "some-other-rule" } }] };

  const mobile = createEvidenceCapsules({
    audit,
    report: { ...report, findings: unmatched },
    missionState: unmatchedMission,
    findings: unmatched,
    browserReview,
  })[0];
  assert.equal(mobile.observationTask.id, "observe-no-compiled-investigation");
  assert.equal(mobile.observationTask.viewport, "mobile");
  assert.deepEqual(mobile.observationTask.requiredCapabilities, [
    "visual-browser-access",
    "responsive-emulation",
  ]);

  const desktopFindings = [{ ...unmatched[0], source: { ...unmatched[0].source, strategy: "desktop" } }];
  const desktop = createEvidenceCapsules({
    audit,
    report: { ...report, findings: desktopFindings },
    missionState: unmatchedMission,
    findings: desktopFindings,
    browserReview,
  })[0];
  assert.equal(desktop.observationTask.viewport, "desktop");
  assert.deepEqual(desktop.observationTask.requiredCapabilities, ["visual-browser-access"]);
});
