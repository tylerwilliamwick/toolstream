// src/dependency-resolver.ts - Tool dependency resolution (warn mode)

import type { ToolRecord } from "./types.js";

const MAX_DEPTH = 2;

interface FieldSignature {
  name: string;
  type: string;
}

export class DependencyResolver {
  private toolsByServer: Map<string, ToolRecord[]> = new Map();

  registerTools(serverId: string, tools: ToolRecord[]): void {
    this.toolsByServer.set(serverId, tools);
  }

  /**
   * Given a tool that was just loaded, find dependent tools on the same server.
   * Returns tools that should be pre-loaded based on schema field matching.
   */
  resolveDependencies(tool: ToolRecord, depth: number = 0): ToolRecord[] {
    if (depth >= MAX_DEPTH) {
      if (depth === MAX_DEPTH) {
        console.warn(
          `[DependencyResolver] Max depth (${MAX_DEPTH}) reached for tool '${tool.id}'. Skipping deeper dependencies.`
        );
      }
      return [];
    }

    const serverTools = this.toolsByServer.get(tool.serverId);
    if (!serverTools) return [];

    const outputFields = extractOutputFields(tool.inputSchema);
    if (outputFields.length === 0) return [];

    const dependents: ToolRecord[] = [];
    const visited = new Set<string>([tool.id]);

    for (const candidate of serverTools) {
      if (visited.has(candidate.id)) continue;

      const inputFields = extractInputFields(candidate.inputSchema);
      const hasMatch = outputFields.some((outField) =>
        inputFields.some(
          (inField) =>
            inField.name === outField.name && inField.type === outField.type
        )
      );

      if (hasMatch) {
        visited.add(candidate.id);
        dependents.push(candidate);

        // Recurse for transitive dependencies
        const transitive = this.resolveDependenciesWithVisited(
          candidate,
          depth + 1,
          visited
        );
        dependents.push(...transitive);
      }
    }

    return dependents;
  }

  private resolveDependenciesWithVisited(
    tool: ToolRecord,
    depth: number,
    visited: Set<string>
  ): ToolRecord[] {
    if (depth >= MAX_DEPTH) {
      console.warn(
        `[DependencyResolver] Max depth (${MAX_DEPTH}) reached for tool '${tool.id}'. Skipping deeper dependencies.`
      );
      return [];
    }

    const serverTools = this.toolsByServer.get(tool.serverId);
    if (!serverTools) return [];

    const outputFields = extractOutputFields(tool.inputSchema);
    if (outputFields.length === 0) return [];

    const dependents: ToolRecord[] = [];

    for (const candidate of serverTools) {
      if (visited.has(candidate.id)) continue;

      const inputFields = extractInputFields(candidate.inputSchema);
      const hasMatch = outputFields.some((outField) =>
        inputFields.some(
          (inField) =>
            inField.name === outField.name && inField.type === outField.type
        )
      );

      if (hasMatch) {
        visited.add(candidate.id);
        dependents.push(candidate);

        const transitive = this.resolveDependenciesWithVisited(
          candidate,
          depth + 1,
          visited
        );
        dependents.push(...transitive);
      }
    }

    return dependents;
  }
}

function extractInputFields(schema: Record<string, unknown>): FieldSignature[] {
  const fields: FieldSignature[] = [];
  const properties = schema.properties as
    | Record<string, { type?: string }>
    | undefined;
  if (!properties) return fields;

  for (const [name, prop] of Object.entries(properties)) {
    if (prop && typeof prop === "object" && prop.type) {
      fields.push({ name, type: String(prop.type) });
    }
  }

  const required = schema.required as string[] | undefined;
  if (required) {
    // Mark required fields by filtering
    return fields.filter((f) => required.includes(f.name));
  }
  return fields;
}

function extractOutputFields(
  schema: Record<string, unknown>
): FieldSignature[] {
  // In MCP, tools don't have output schemas in a standard way.
  // We use the input schema's properties as potential output fields
  // (tools that produce IDs typically also accept them as input for related operations).
  const fields: FieldSignature[] = [];
  const properties = schema.properties as
    | Record<string, { type?: string }>
    | undefined;
  if (!properties) return fields;

  for (const [name, prop] of Object.entries(properties)) {
    if (prop && typeof prop === "object" && prop.type) {
      fields.push({ name, type: String(prop.type) });
    }
  }
  return fields;
}
