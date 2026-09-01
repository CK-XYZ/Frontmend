#!/usr/bin/env bun

function run(command, env) {
  const result = Bun.spawnSync({
    cmd: command,
    cwd: process.cwd(),
    env,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (result.exitCode !== 0) process.exit(result.exitCode || 1);
}

const revision = Bun.spawnSync({
  cmd: ["git", "rev-parse", "HEAD"],
  cwd: process.cwd(),
  stdout: "pipe",
  stderr: "pipe",
});
if (revision.exitCode !== 0) {
  throw new Error("Frontmend production builds require a readable Git commit.");
}

const commit = revision.stdout.toString().trim().toLowerCase();
if (!/^[0-9a-f]{40}$/.test(commit)) {
  throw new Error("Frontmend could not derive a full Git commit for the build descriptor.");
}

const trackedChanges = Bun.spawnSync({
  cmd: ["git", "diff", "--quiet", "HEAD", "--"],
  cwd: process.cwd(),
  stdout: "pipe",
  stderr: "pipe",
});
if (![0, 1].includes(trackedChanges.exitCode)) {
  throw new Error("Frontmend could not determine whether tracked build inputs differ from HEAD.");
}

const buildEnv = {
  ...process.env,
  FRONTMEND_BUILD_COMMIT: commit,
  FRONTMEND_BUILT_AT: new Date().toISOString(),
  FRONTMEND_SOURCE_DIRTY: trackedChanges.exitCode === 1 ? "true" : "false",
};

run([process.execPath, "x", "vite", "build"], buildEnv);
run([process.execPath, "scripts/prepare-sites-build.mjs"], buildEnv);
