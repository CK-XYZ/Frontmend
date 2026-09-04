import assert from "node:assert/strict";
import test from "node:test";
import {
  codingAgentBriefText,
  createCodingAgentBrief,
} from "../src/coding-agent-brief-contract.js";

function priority() {
  return {
    rank: 1,
    findingId: "mobile-color-contrast",
    title: "Text contrast is too low",
    severity: "high",
    category: "Accessibility",
    evidence: "The shared foreground and background colours measured 2.75:1.",
    suggestedRepair: "Adjust the foreground or background tokens while preserving visual hierarchy.",
    occurrenceCount: 2,
    affectedStrategies: ["mobile", "desktop"],
    evidenceProvenance: "measured-provider",
    source: { provider: "Lighthouse", auditId: "color-contrast" },
    evidenceRecords: {
      provider: {
        findings: [{
          selector: ".primary-action",
          evidence: "The primary action measured 2.75:1.",
          source: { strategy: "mobile" },
          occurrences: [
            {
              path: "/",
              viewport: "mobile",
              selector: ".primary-action",
              evidence: "The primary action measured 2.75:1 on mobile.",
            },
            {
              path: "/",
              viewport: "desktop",
              selector: ".primary-action",
              evidence: "The primary action measured 2.75:1 on desktop.",
            },
          ],
        }],
      },
    },
  };
}

test("builds a deterministic coding-agent brief from retained audit evidence", () => {
  const input = {
    report: {
      auditId: "audit-1",
      url: "https://example.com/",
      finalUrl: "https://example.com/",
      hostname: "example.com",
    },
    priorities: [priority()],
    mission: { focusAreas: ["accessibility"] },
  };
  const first = createCodingAgentBrief(input);
  const second = createCodingAgentBrief(input);

  assert.deepEqual(first, second);
  assert.equal(first.kind, "frontmend-coding-agent-brief");
  assert.equal(first.recommendations.length, 1);
  assert.deepEqual(first.recommendations[0].affected.viewports, ["mobile", "desktop"]);
  assert.deepEqual(first.recommendations[0].affected.selectors, [".primary-action"]);
  assert.deepEqual(first.recommendations[0].repositorySearchHints, ["color-contrast", ".primary-action"]);
  assert.match(first.recommendations[0].acceptanceCriteria[0], /Re-run color-contrast/);
  assert.equal(first.evidenceBoundary.repositoryInspected, false);
  assert.equal(first.evidenceBoundary.repositoryChanged, false);
  assert.equal(first.evidenceBoundary.deployed, false);
  assert.equal(first.evidenceBoundary.resolved, false);
});

test("renders a ready-to-use brief without inventing repository ownership", () => {
  const brief = createCodingAgentBrief({
    report: {
      auditId: "audit-1",
      finalUrl: "https://example.com/",
      hostname: "example.com",
    },
    priorities: [priority()],
  });
  const text = codingAgentBriefText(brief);

  assert.match(text, /work in the current repository using your normal coding tools/i);
  assert.match(text, /Repository search hints: color-contrast, \.primary-action/);
  assert.match(text, /Acceptance criteria:/);
  assert.match(text, /After deployment: Run a fresh Frontmend audit/);
  assert.doesNotMatch(text, /src\/|components\/|line \d+/i);
});

test("bounds recommendation and target volume for agent context", () => {
  const manyTargets = Array.from({ length: 12 }, (_, index) => ({
    path: `/route-${index}`,
    viewport: index % 2 ? "desktop" : "mobile",
    selector: `.target-${index}`,
    evidence: "x".repeat(1_000),
  }));
  const priorities = Array.from({ length: 8 }, (_, index) => ({
    ...priority(),
    rank: index + 1,
    findingId: `finding-${index}`,
    evidenceRecords: { provider: { findings: [{ occurrences: manyTargets }] } },
  }));
  const brief = createCodingAgentBrief({
    report: { auditId: "audit-1", finalUrl: "https://example.com/" },
    priorities,
  });

  assert.equal(brief.recommendations.length, 5);
  assert.equal(brief.recommendations[0].targets.length, 4);
  assert.equal(brief.recommendations[0].targets.every((target) => target.evidence.length <= 320), true);
});
