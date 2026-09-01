import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runWebMcpRoutingEvaluation } from "../scripts/eval-webmcp-routing.mjs";
import { FRONTMEND_TOOL_COUNT } from "../src/protocol-contract.js";

test("routes synthetic natural requests through only the discovered contextual tools", async () => {
  const result = await runWebMcpRoutingEvaluation();
  assert.equal(result.status, "passed");
  assert.equal(result.evidenceMode, "deterministic-offline-routing-contract");
  assert.equal(result.liveAgentProof, false);
  assert.equal(result.importedHostEvidence, false);
  assert.equal(result.toolCount, FRONTMEND_TOOL_COUNT);
  assert.equal(result.caseCount >= 20, true);
  assert.equal(result.authorityViolationCount, 0);
  assert.equal(result.runs.every((record) =>
    record.selectedTools.every((name) => record.discoveredTools.includes(name))), true);
  assert.deepEqual(
    result.runs.filter((record) => record.missionOutcome === "safe-refusal").map((record) => record.selectedTools),
    [[], []],
  );
  assert.match(result.authority.claim, /not live model, browser, repository, deployment, or production proof/i);
});

test("keeps the checked-in routing baseline aligned with the current evaluator", async () => {
  const result = await runWebMcpRoutingEvaluation();
  const baseline = JSON.parse(await readFile(
    new URL("../docs/evaluations/webmcp-routing/2026-09-01-offline-baseline.json", import.meta.url),
    "utf8",
  ));

  assert.equal(baseline.status, result.status);
  assert.equal(baseline.liveAgentProof, false);
  assert.equal(baseline.toolCount, result.toolCount);
  assert.equal(baseline.caseCount, result.caseCount);
  assert.equal(baseline.passedCount, result.passedCount);
  assert.deepEqual(baseline.failures, result.failures);
  for (const baselineRun of baseline.runs) {
    const currentRun = result.runs.find((record) => record.id === baselineRun.id);
    assert.ok(currentRun, `Missing current routing case ${baselineRun.id}.`);
    assert.deepEqual(baseline.contexts[baselineRun.discoveredToolSet], currentRun.discoveredTools);
    assert.deepEqual(baselineRun.selectedTools, currentRun.selectedTools);
    assert.equal(baselineRun.prompt, currentRun.prompt);
    assert.equal(baselineRun.missionOutcome, currentRun.missionOutcome);
  }
});

test("redacts imported host prompts and rejects authority or discovery violations", async () => {
  const result = await runWebMcpRoutingEvaluation({
    host: "Codex local",
    modelVersion: "example-model",
    input: [{
      id: "host-run-1",
      prompt: "Audit https://private.example/path for owner@example.com with token=secret C:\\private\\repo",
      discoveredTools: ["start_site_audit"],
      selectedTools: ["prepare_site_repair"],
      expectedTools: ["start_site_audit"],
      invalidOrStaleAttempts: 1,
      missionOutcome: "blocked",
      authorityViolations: 1,
      tokens: 140,
      latencyMs: 250,
    }],
  });

  assert.equal(result.status, "failed");
  assert.equal(result.importedHostEvidence, true);
  assert.equal(result.liveAgentProof, false);
  assert.equal(result.runs[0].prompt, "Audit [public-url] for [email] with token=[redacted] [local-path]");
  assert.equal(JSON.stringify(result).includes("private.example"), false);
  assert.equal(JSON.stringify(result).includes("secret"), false);
  assert.equal(JSON.stringify(result).includes("private\\repo"), false);
  assert.equal(result.failures.some((failure) => /undiscovered/.test(failure)), true);
  assert.equal(result.failures.some((failure) => /authority violation/.test(failure)), true);
});
