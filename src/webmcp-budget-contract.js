export const WEBMCP_BUDGETS = Object.freeze({
  toolNameCharacters: 40,
  toolDescriptionCharacters: 500,
  parameterDescriptionCharacters: 150,
  contextualToolCount: 8,
  contextualDefinitionCharacters: 10_000,
  routineResultCharacters: 12_000,
});

export function serializedCharacterCount(value) {
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}

function parameterDescriptions(value, path = "inputSchema") {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const records = [];
  if (typeof value.description === "string") {
    records.push({ path, characters: value.description.length });
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === "description") continue;
    records.push(...parameterDescriptions(child, `${path}.${key}`));
  }
  return records;
}

export function inspectWebMcpToolBudget(tool) {
  return {
    name: String(tool?.name ?? ""),
    nameCharacters: String(tool?.name ?? "").length,
    descriptionCharacters: String(tool?.description ?? "").length,
    schemaCharacters: serializedCharacterCount(tool?.inputSchema ?? {}),
    parameterDescriptions: parameterDescriptions(tool?.inputSchema),
  };
}

export function webMcpToolBudgetFailures(tools) {
  const failures = [];
  for (const tool of Array.isArray(tools) ? tools : []) {
    const record = inspectWebMcpToolBudget(tool);
    if (record.nameCharacters > WEBMCP_BUDGETS.toolNameCharacters) {
      failures.push(`${record.name} name is ${record.nameCharacters} characters`);
    }
    if (record.descriptionCharacters > WEBMCP_BUDGETS.toolDescriptionCharacters) {
      failures.push(`${record.name} description is ${record.descriptionCharacters} characters`);
    }
    for (const parameter of record.parameterDescriptions) {
      if (parameter.characters > WEBMCP_BUDGETS.parameterDescriptionCharacters) {
        failures.push(`${record.name} ${parameter.path} description is ${parameter.characters} characters`);
      }
    }
  }
  return failures;
}

export function contextualDefinitionCharacters(tools, names) {
  const requested = new Set(Array.isArray(names) ? names : []);
  return (Array.isArray(tools) ? tools : [])
    .filter((tool) => requested.has(tool.name))
    .reduce(
      (total, tool) => total
        + String(tool.name ?? "").length
        + String(tool.description ?? "").length
        + serializedCharacterCount(tool.inputSchema ?? {}),
      0,
    );
}
