import { describe, it, expect } from "vitest";
import { DependencyResolver } from "../src/dependency-resolver.js";
import type { ToolRecord } from "../src/types.js";

function makeTool(
  serverId: string,
  name: string,
  properties: Record<string, { type: string }>,
  required?: string[]
): ToolRecord {
  return {
    id: `${serverId}:${name}`,
    serverId,
    toolName: name,
    description: `${name} tool`,
    inputSchema: {
      type: "object",
      properties,
      ...(required ? { required } : {}),
    },
    isActive: true,
  };
}

describe("DependencyResolver", () => {
  it("detects field-name dependencies", () => {
    const resolver = new DependencyResolver();
    const toolA = makeTool("s1", "get_file", {
      file_id: { type: "string" },
      path: { type: "string" },
    });
    const toolB = makeTool(
      "s1",
      "read_file",
      { file_id: { type: "string" }, encoding: { type: "string" } },
      ["file_id"]
    );
    const toolC = makeTool("s1", "delete_file", {
      name: { type: "string" },
    });

    resolver.registerTools("s1", [toolA, toolB, toolC]);

    const deps = resolver.resolveDependencies(toolA);
    expect(deps.map((d) => d.id)).toContain("s1:read_file");
    // toolC has no matching fields
    expect(deps.map((d) => d.id)).not.toContain("s1:delete_file");
  });

  it("limits depth to 2 hops", () => {
    const resolver = new DependencyResolver();

    // Chain: A -> B -> C -> D
    const toolA = makeTool("s1", "tool_a", { id_field: { type: "string" } });
    const toolB = makeTool("s1", "tool_b", {
      id_field: { type: "string" },
      result_id: { type: "string" },
    });
    const toolC = makeTool("s1", "tool_c", {
      result_id: { type: "string" },
      final_id: { type: "string" },
    });
    const toolD = makeTool("s1", "tool_d", {
      final_id: { type: "string" },
      extra: { type: "string" },
    });

    resolver.registerTools("s1", [toolA, toolB, toolC, toolD]);

    const deps = resolver.resolveDependencies(toolA);
    const depIds = deps.map((d) => d.id);

    // B and C should be loaded (depth 0 and 1)
    expect(depIds).toContain("s1:tool_b");
    expect(depIds).toContain("s1:tool_c");
    // D should NOT be loaded (depth 2, which is at max)
    expect(depIds).not.toContain("s1:tool_d");
  });

  it("detects and breaks circular dependencies", () => {
    const resolver = new DependencyResolver();

    // Circular: A -> B -> A
    const toolA = makeTool("s1", "tool_a", {
      shared_field: { type: "string" },
    });
    const toolB = makeTool("s1", "tool_b", {
      shared_field: { type: "string" },
    });

    resolver.registerTools("s1", [toolA, toolB]);

    // Should not infinite loop
    const start = Date.now();
    const deps = resolver.resolveDependencies(toolA);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(100);
    // B should be found, but not A again
    expect(deps.map((d) => d.id)).toContain("s1:tool_b");
  });

  it("returns empty for tools with no properties", () => {
    const resolver = new DependencyResolver();
    const tool = makeTool("s1", "simple", {});
    resolver.registerTools("s1", [tool]);

    const deps = resolver.resolveDependencies(tool);
    expect(deps).toHaveLength(0);
  });

  it("only matches tools on the same server", () => {
    const resolver = new DependencyResolver();

    const toolA = makeTool("s1", "tool_a", {
      file_id: { type: "string" },
    });
    const toolB = makeTool("s2", "tool_b", {
      file_id: { type: "string" },
    });

    resolver.registerTools("s1", [toolA]);
    resolver.registerTools("s2", [toolB]);

    const deps = resolver.resolveDependencies(toolA);
    // Should not find tool_b since it's on a different server
    expect(deps).toHaveLength(0);
  });
});
