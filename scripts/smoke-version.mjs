#!/usr/bin/env bun
import { assertExpectedBuildDescriptor } from "../src/protocol-contract.js";

const [targetValue, commitValue] = process.argv.slice(2);
const expectedCommit = commitValue ?? process.env.FRONTMEND_EXPECTED_COMMIT;
if (!targetValue || !expectedCommit) {
  throw new Error("Usage: bun run smoke:version -- <deployed-origin> <expected-git-commit>");
}

const endpoint = new URL("/api/version", targetValue);
const response = await fetch(endpoint, {
  headers: { accept: "application/json" },
  redirect: "error",
});
if (!response.ok) throw new Error(`Frontmend version smoke check returned HTTP ${response.status}.`);
const payload = await response.json();
assertExpectedBuildDescriptor(payload?.data, { commit: expectedCommit });
console.log(`Verified Frontmend ${payload.data.commit} with ${payload.data.toolCount} WebMCP contracts.`);
