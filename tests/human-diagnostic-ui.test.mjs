import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const diagnosisSource = async () => (await Promise.all([
  readFile(`${projectRoot}/src/workspaces/DiagnosisWorkspace.jsx`, "utf8"),
  readFile(`${projectRoot}/src/ui/human-mission-recovery.js`, "utf8"),
])).join("\n");

test("Human mode exposes the complete bounded diagnostic and blocker contracts", async () => {
  const source = await diagnosisSource();

  assert.match(source, /function HumanDiagnosticContribution/);
  assert.match(source, /Browser observations <small>1–5 required<\/small>/);
  assert.match(source, /Repository ownership <small>1–8 relative locations required<\/small>/);
  assert.match(source, /Planned verification checks <small>1–8 required<\/small>/);
  assert.match(source, /\["low", "medium", "high"\]|value="low"[\s\S]*?value="medium"[\s\S]*?value="high"/);
  assert.match(source, /repository-unavailable/);
  assert.match(source, /conflicting-runtime/);
  assert.match(source, /auditService\.submitDiagnosticEvidence\([\s\S]*?"person"/);
  assert.match(source, /auditService\.recordDiagnosticBlocker\([\s\S]*?"person"/);
});

test("Human diagnosis uses capability-aware copy and safe stale-session recovery", async () => {
  const source = await diagnosisSource();

  assert.match(source, /A repository-aware agent can call <code>submit_runtime_diagnosis<\/code>/);
  assert.match(source, /WebMCP is not ready in this browser/);
  assert.match(source, /auditService\.refreshMissionWorkspace\(auditId\)/);
  assert.match(source, /inspect it before resubmitting/i);
  assert.doesNotMatch(source, /MISSION_REVISION_STALE[\s\S]{0,400}submitDiagnosticEvidence/);
});

test("Human diagnosis warns against source upload and collapses at narrow widths", async () => {
  const [source, styles] = await Promise.all([
    diagnosisSource(),
    readFile(`${projectRoot}/src/styles.css`, "utf8"),
  ]);
  const compact = styles.slice(styles.indexOf("@media (max-width: 650px)"));

  assert.match(source, /Do not paste source, patches, credentials, environment values, absolute paths, or private browser data/);
  assert.match(compact, /\.human-diagnostic-source-fields[\s\S]*?grid-template-columns: 1fr;/);
  assert.match(compact, /\.human-diagnostic-contribution \.human-review-submit > button \{\s*width: 100%;/);
});
