import assert from "node:assert/strict";
import test from "node:test";
import {
  createAdmissionOperationalEvent,
  createAuditOperationalEvent,
  createProviderOperationalEvents,
  emitOperationalEvents,
  operationalTelemetryBoundary,
} from "../src/operational-event-contract.js";

test("projects aggregate admission and provider metrics without target identity", () => {
  const admission = createAdmissionOperationalEvent({
    outcome: "allowed",
    reason: "none",
    batchSize: 3,
    newStarts: 2,
    reusedStarts: 1,
    clientWindowStarts: 5,
    globalWindowStarts: 60,
    clientCapacityRemaining: 0,
    globalCapacityRemaining: 0,
    url: "https://private.example/path",
    fingerprint: "client-secret",
    urlHash: "target-hash",
  });
  const providers = createProviderOperationalEvents({
    providerRuns: [{
      adapterId: "google-pagespeed-lighthouse",
      kind: "viewport",
      outcome: "failed",
      latencyMs: 812.6,
      measuredConditionCount: 0,
      failureCode: "PROVIDER_RATE_LIMITED",
      quotaLimited: true,
      url: "https://private.example/path",
    }],
  }, "exploration-child");
  const audit = createAuditOperationalEvent({
    outcome: "failed",
    workload: "exploration-child",
    latencyMs: 900,
    fallbackUsed: true,
    availableSourceCount: 1,
    failureCode: "AUDIT_FAILED",
    auditId: "must-not-appear",
  });
  const serialized = JSON.stringify([admission, ...providers, audit]);

  assert.deepEqual(admission, {
    event: "frontmend.admission",
    schemaVersion: 1,
    outcome: "allowed",
    reason: "none",
    batchSize: 3,
    newStarts: 2,
    reusedStarts: 1,
    clientWindowStarts: 5,
    globalWindowStarts: 60,
    clientCapacityRemaining: 0,
    globalCapacityRemaining: 0,
    queueMode: "direct-admission",
    queueDepth: 0,
  });
  assert.equal(providers[0].latencyMs, 813);
  assert.equal(providers[0].quotaLimited, true);
  assert.equal(audit.workload, "exploration-child");
  for (const blocked of ["private.example", "client-secret", "target-hash", "must-not-appear"]) {
    assert.equal(serialized.includes(blocked), false);
  }
});

test("emits only through an explicit diagnostic logger or deployed version binding", () => {
  const retained = [];
  const events = [createAuditOperationalEvent({ outcome: "complete", availableSourceCount: 2 })];
  assert.equal(emitOperationalEvents({}, events), 0);
  assert.equal(emitOperationalEvents({ OPERATIONAL_LOGGER: (event) => retained.push(event) }, events), 1);
  assert.deepEqual(retained, events);
  assert.equal(operationalTelemetryBoundary.publicEndpoint, false);
  assert.equal(operationalTelemetryBoundary.excludes.includes("target URLs"), true);
});
