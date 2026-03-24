// src/meta-tools.ts - The always-visible meta-tools

export const META_TOOL_SCHEMAS = [
  {
    name: "discover_servers",
    description:
      "List all upstream MCP servers registered with this proxy, including IDs and tool counts. Use when you need to understand what capabilities are available.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [] as string[],
    },
  },
  {
    name: "discover_tools",
    description:
      "Search for tools by natural language query. Returns the most relevant tools from all servers. Use when you know what you want to do but don't see the right tool.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string" as const,
          description:
            "Natural language description of what you want to do. Example: 'read a file', 'create a GitHub issue'.",
        },
        top_k: {
          type: "number" as const,
          description: "Max tools to return. Defaults to 10.",
          default: 10,
        },
      },
      required: ["query"],
    },
  },
  {
    name: "execute_tool",
    description:
      "Execute any tool on any server by name, even if not in your current tool list. Direct escape hatch for known tools.",
    inputSchema: {
      type: "object" as const,
      properties: {
        server: {
          type: "string" as const,
          description: "Server ID from discover_servers.",
        },
        tool: {
          type: "string" as const,
          description: "Tool name on that server.",
        },
        arguments: {
          type: "object" as const,
          description: "Arguments to pass to the tool.",
          additionalProperties: true,
        },
      },
      required: ["server", "tool", "arguments"],
    },
  },
  {
    name: "reconnect_server",
    description:
      "Force-reconnect a specific upstream server. Use when execute_tool returns server_not_connected or server_reconnecting.",
    inputSchema: {
      type: "object" as const,
      properties: {
        server_id: {
          type: "string" as const,
          description: "Server ID from discover_servers.",
        },
      },
      required: ["server_id"],
    },
  },
] as const;

export type MetaToolName = (typeof META_TOOL_SCHEMAS)[number]["name"];

export function isMetaTool(name: string): name is MetaToolName {
  return META_TOOL_SCHEMAS.some((mt) => mt.name === name);
}
