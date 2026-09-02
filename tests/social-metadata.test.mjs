import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const projectRoot = new URL("../", import.meta.url);
const socialImageUrl = "https://frontmend.dev/og_image.png";

test("publishes complete Open Graph and Twitter large-image metadata", async () => {
  const html = await readFile(new URL("index.html", projectRoot), "utf8");

  assert.match(
    html,
    /<link rel="canonical" href="https:\/\/frontmend\.dev\/" \/>/,
  );
  assert.match(html, /<meta property="og:type" content="website" \/>/);
  assert.match(html, /<meta property="og:site_name" content="Frontmend" \/>/);
  assert.match(html, /<meta property="og:image:width" content="1200" \/>/);
  assert.match(html, /<meta property="og:image:height" content="630" \/>/);
  assert.match(html, /<meta property="og:image:type" content="image\/png" \/>/);
  assert.match(html, /<meta name="twitter:card" content="summary_large_image" \/>/);
  assert.equal(html.includes(`property="og:image"\n      content="${socialImageUrl}"`), true);
  assert.equal(html.includes(`name="twitter:image"\n      content="${socialImageUrl}"`), true);
  assert.match(html, /property="og:image:alt"/);
  assert.match(html, /name="twitter:image:alt"/);
});

test("keeps the social image at the declared 1200 by 630 PNG contract", async () => {
  const image = await readFile(new URL("public/og_image.png", projectRoot));
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  assert.equal(image.subarray(0, 8).equals(pngSignature), true);
  assert.equal(image.subarray(12, 16).toString("ascii"), "IHDR");
  assert.equal(image.readUInt32BE(16), 1200);
  assert.equal(image.readUInt32BE(20), 630);
});
