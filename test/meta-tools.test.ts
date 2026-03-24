import { describe, it, expect } from "vitest";
import { META_TOOL_SCHEMAS, isMetaTool } from "../src/meta-tools.js";

describe("Meta-Tools", () => {
  it("exposes exactly 3 meta-tools", () => {
    expect(META_TOOL_SCHEMAS).toHaveLength(3);
  });

  it("has discover_servers with correct schema", () => {
    const tool = META_TOOL_SCHEMAS.find((t) => t.name === "discover_servers");
    expect(tool).toBeDefined();
    expect(tool!.inputSchema.type).toBe("object");
    expect(tool!.inputSchema.required).toHaveLength(0);
  });

  it("has discover_tools with query parameter", () => {
    const tool = META_TOOL_SCHEMAS.find((t) => t.name === "discover_tools");
    expect(tool).toBeDefined();
    expect(tool!.inputSchema.required).toContain("query");
    expect(tool!.inputSchema.properties).toHaveProperty("query");
    expect(tool!.inputSchema.properties).toHaveProperty("top_k");
  });

  it("has execute_tool with required params", () => {
    const tool = META_TOOL_SCHEMAS.find((t) => t.name === "execute_tool");
    expect(tool).toBeDefined();
    expect(tool!.inputSchema.required).toContain("server");
    expect(tool!.inputSchema.required).toContain("tool");
    expect(tool!.inputSchema.required).toContain("arguments");
  });

  it("isMetaTool returns true for meta-tool names", () => {
    expect(isMetaTool("discover_servers")).toBe(true);
    expect(isMetaTool("discover_tools")).toBe(true);
    expect(isMetaTool("execute_tool")).toBe(true);
  });

  it("isMetaTool returns false for other names", () => {
    expect(isMetaTool("read_file")).toBe(false);
    expect(isMetaTool("")).toBe(false);
    expect(isMetaTool("discover")).toBe(false);
  });
});
