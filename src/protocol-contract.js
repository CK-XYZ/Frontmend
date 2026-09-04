export const FRONTMEND_APP_VERSION = "0.1.0";
export const FRONTMEND_PROTOCOL_VERSION = 1;
export const FRONTMEND_TOOL_LIBRARY_VERSION = 9;
export const FRONTMEND_TOOL_COUNT = 28;

const COMMIT_PATTERN = /^[0-9a-f]{7,40}$/i;

function compiledCommit() {
  return typeof __FRONTMEND_BUILD_COMMIT__ === "string"
    ? __FRONTMEND_BUILD_COMMIT__
    : null;
}

function compiledBuiltAt() {
  return typeof __FRONTMEND_BUILT_AT__ === "string"
    ? __FRONTMEND_BUILT_AT__
    : null;
}

function compiledSourceDirty() {
  return typeof __FRONTMEND_SOURCE_DIRTY__ === "boolean"
    ? __FRONTMEND_SOURCE_DIRTY__
    : false;
}

function normalizedCommit(value) {
  return typeof value === "string" && COMMIT_PATTERN.test(value.trim())
    ? value.trim().toLowerCase()
    : null;
}

function normalizedBuiltAt(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function createBuildDescriptor({
  commit = compiledCommit(),
  builtAt = compiledBuiltAt(),
  sourceDirty = compiledSourceDirty(),
  deploymentVersion = null,
} = {}) {
  const retainedCommit = normalizedCommit(commit);
  const retainedBuiltAt = normalizedBuiltAt(builtAt);
  return {
    app: "frontmend",
    version: FRONTMEND_APP_VERSION,
    commit: retainedCommit,
    builtAt: retainedBuiltAt,
    protocolVersion: FRONTMEND_PROTOCOL_VERSION,
    toolLibraryVersion: FRONTMEND_TOOL_LIBRARY_VERSION,
    toolCount: FRONTMEND_TOOL_COUNT,
    sourceDirty: sourceDirty === true,
    buildIdentified: Boolean(retainedCommit && retainedBuiltAt && sourceDirty !== true),
    ...(typeof deploymentVersion === "string" && deploymentVersion.trim()
      ? { deploymentVersion: deploymentVersion.trim().slice(0, 160) }
      : {}),
  };
}

export function createRuntimeBuildDescriptor(env = {}) {
  const metadata = env?.FRONTMEND_VERSION && typeof env.FRONTMEND_VERSION === "object"
    ? env.FRONTMEND_VERSION
    : {};
  return createBuildDescriptor({
    commit: env?.FRONTMEND_BUILD_COMMIT ?? metadata.tag ?? compiledCommit(),
    builtAt: env?.FRONTMEND_BUILT_AT ?? metadata.timestamp ?? compiledBuiltAt(),
    sourceDirty: env?.FRONTMEND_SOURCE_DIRTY === "true"
      ? true
      : env?.FRONTMEND_SOURCE_DIRTY === "false" ? false : compiledSourceDirty(),
    deploymentVersion: metadata.id ?? null,
  });
}

export function shortBuildCommit(descriptor = createBuildDescriptor()) {
  return descriptor.commit ? descriptor.commit.slice(0, 12) : "unidentified build";
}

export function assertExpectedBuildDescriptor(
  descriptor,
  { commit, toolCount = FRONTMEND_TOOL_COUNT } = {},
) {
  const expectedCommit = normalizedCommit(commit);
  if (!expectedCommit) throw new Error("An expected Git commit is required for the deployment smoke check.");
  if (descriptor?.buildIdentified !== true || descriptor?.sourceDirty === true) {
    throw new Error("The deployed Frontmend build is not identified as a clean source build.");
  }
  if (descriptor.commit !== expectedCommit) {
    throw new Error(`The deployed Frontmend commit is ${descriptor?.commit ?? "unidentified"}, not ${expectedCommit}.`);
  }
  if (descriptor.toolCount !== toolCount) {
    throw new Error(`The deployed Frontmend tool count is ${descriptor?.toolCount ?? "unknown"}, not ${toolCount}.`);
  }
  if (
    descriptor.protocolVersion !== FRONTMEND_PROTOCOL_VERSION
    || descriptor.toolLibraryVersion !== FRONTMEND_TOOL_LIBRARY_VERSION
  ) {
    throw new Error("The deployed Frontmend protocol or tool-library version does not match this source.");
  }
  return descriptor;
}
