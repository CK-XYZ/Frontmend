import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");

test("exposes a meaningful same-site guide through a crawlable landing link", () => {
  assert.match(app, /href="\/how-it-works"/);
  assert.match(app, /function HowItWorksPage\(/);
  assert.match(app, /if \(staticRoute === "how-it-works"\) return "guide"/);
  assert.match(app, /mode === "guide" \? <HowItWorksPage \/>/);
  assert.match(app, /href="\/"[^>]*>\s*Start a site audit/s);
});
