import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assertPublicResolvedDestination,
  isPublicResolvedAddress,
  publicDestinationBoundary,
} from "../src/public-destination-contract.js";

test("classifies public, private, metadata, mapped, and non-routable addresses", () => {
  for (const address of [
    "0.0.0.0", "10.1.2.3", "100.64.0.1", "127.0.0.1", "169.254.169.254",
    "172.16.0.1", "192.168.1.1", "198.18.0.1", "224.0.0.1", "255.255.255.255",
    "::", "::1", "::ffff:127.0.0.1", "::ffff:c0a8:101", "fc00::1", "fd12::1",
    "fe80::1", "ff02::1", "2001:db8::1",
  ]) {
    assert.equal(isPublicResolvedAddress(address), false, address);
  }
  for (const address of ["8.8.8.8", "93.184.216.34", "2606:4700:4700::1111", "2001:4860:4860::8888"]) {
    assert.equal(isPublicResolvedAddress(address), true, address);
  }
});

test("fails closed when any DNS answer is non-public or resolution is unavailable", async () => {
  await assert.rejects(
    () => assertPublicResolvedDestination(
      "https://public-name.example/",
      async () => [{ address: "93.184.216.34" }, { address: "127.0.0.1" }],
    ),
    (error) => error?.code === "RESOLVED_DESTINATION_BLOCKED" && !error.message.includes("127.0.0.1"),
  );
  await assert.rejects(
    () => assertPublicResolvedDestination("https://public-name.example/", async () => []),
    (error) => error?.code === "RESOLVED_DESTINATION_BLOCKED",
  );
  await assert.rejects(
    () => assertPublicResolvedDestination("https://public-name.example/", async () => { throw new Error("raw DNS detail"); }),
    (error) => error?.code === "DESTINATION_RESOLUTION_FAILED" && !error.message.includes("raw DNS detail"),
  );
});

test("enables Cloudflare public-Internet fetch routing and documents the local limit", () => {
  const wrangler = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  assert.match(wrangler, /"compatibility_flags"\s*:\s*\["global_fetch_strictly_public"\]/);
  assert.match(publicDestinationBoundary.production, /public-Internet traffic/);
  assert.match(publicDestinationBoundary.local, /cannot pin/);
});
