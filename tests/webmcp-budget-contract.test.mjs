import assert from "node:assert/strict";
import test from "node:test";
import {
  WEBMCP_BUDGETS,
  contextualDefinitionCharacters,
  inspectWebMcpToolBudget,
  serializedCharacterCount,
  webMcpToolBudgetFailures,
} from "../src/webmcp-budget-contract.js";
import { createFrontmendTools } from "../src/webmcp.js";
import { runWebMcpRoutingEvaluation } from "../scripts/eval-webmcp-routing.mjs";

test("keeps every WebMCP definition inside the checked-in context budgets", () => {
  const tools = createFrontmendTools({});
  const failures = webMcpToolBudgetFailures(tools);
  assert.deepEqual(failures, []);

  const records = tools.map(inspectWebMcpToolBudget);
  assert.equal(
    records.every((record) => record.descriptionCharacters <= WEBMCP_BUDGETS.toolDescriptionCharacters),
    true,
  );
  assert.equal(
    records.flatMap((record) => record.parameterDescriptions)
      .every((record) => record.characters <= WEBMCP_BUDGETS.parameterDescriptionCharacters),
    true,
  );
});

test("keeps every evaluated contextual toolset inside one bounded discovery window", async () => {
  const tools = createFrontmendTools({});
  const evaluation = await runWebMcpRoutingEvaluation();
  for (const run of evaluation.runs) {
    assert.ok(
      run.discoveredTools.length <= WEBMCP_BUDGETS.contextualToolCount,
      `${run.id} exposed ${run.discoveredTools.length} tools`,
    );
    const characters = contextualDefinitionCharacters(tools, run.discoveredTools);
    assert.ok(
      characters <= WEBMCP_BUDGETS.contextualDefinitionCharacters,
      `${run.id} exposed ${characters} definition characters`,
    );
  }
});

test("measures only serialisable result characters and fails closed for cycles", () => {
  assert.equal(serializedCharacterCount({ ok: true }), 11);
  const cyclic = {};
  cyclic.self = cyclic;
  assert.equal(serializedCharacterCount(cyclic), 0);
});
