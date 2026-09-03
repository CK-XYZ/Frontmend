import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

test("shows current WebMCP discovery and privacy-safe execution facts", () => {
  assert.match(app, />WebMCP trace</);
  assert.match(app, />Discovery now</);
  assert.match(app, /registration\.toolNames\.join\(" · "\)/);
  assert.match(app, /activity\.operationKind/);
  assert.match(app, /activity\.outputCharacters/);
  assert.match(app, /tools \$\{activity\.activeToolCountBefore\}→\$\{activity\.activeToolCountAfter\}/);
  assert.match(app, /activity\.nextTool/);
  assert.match(app, /Tool inputs, URLs, patches, prompts, and secrets are not logged/);
  assert.match(styles, /\.agent-activity-discovery\s*\{/);
  assert.match(styles, /\.agent-activity-next\s*\{/);
});
