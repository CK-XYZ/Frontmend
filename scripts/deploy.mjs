#!/usr/bin/env bun

function commandOutput(command) {
  const result = Bun.spawnSync({
    cmd: command,
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "inherit",
  });
  if (result.exitCode !== 0) process.exit(result.exitCode || 1);
  return result.stdout.toString().trim();
}

const commit = commandOutput(["git", "rev-parse", "HEAD"]).toLowerCase();
if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error("Could not determine the release commit.");

const trackedChanges = Bun.spawnSync({
  cmd: ["git", "diff", "--quiet", "HEAD", "--"],
  cwd: process.cwd(),
  stdout: "pipe",
  stderr: "inherit",
});
if (trackedChanges.exitCode !== 0) {
  throw new Error("Commit tracked Frontmend changes before deployment so the public build identity is exact.");
}

const build = Bun.spawnSync({
  cmd: [process.execPath, "run", "build"],
  cwd: process.cwd(),
  stdout: "inherit",
  stderr: "inherit",
});
if (build.exitCode !== 0) process.exit(build.exitCode || 1);

const deploy = Bun.spawnSync({
  cmd: [
    process.execPath,
    "x",
    "wrangler",
    "deploy",
    "dist/server/index.js",
    "--config",
    "wrangler.jsonc",
    "--strict",
    "--tag",
    commit,
    "--message",
    `Frontmend ${commit.slice(0, 12)}`,
  ],
  cwd: process.cwd(),
  stdout: "inherit",
  stderr: "inherit",
});
if (deploy.exitCode !== 0) process.exit(deploy.exitCode || 1);
