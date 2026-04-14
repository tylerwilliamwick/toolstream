// test/routing-quality.test.ts - Precision@5 benchmark for semantic routing

import { describe, it, expect, beforeAll } from "vitest";
import { ToolRegistry } from "../src/tool-registry.js";
import { ToolStreamDatabase } from "../src/database.js";
import { EmbeddingEngine } from "../src/embedding-engine.js";

// ---------------------------------------------------------------------------
// Tool catalog: 30 tools across 5 servers
// ---------------------------------------------------------------------------

const SERVERS: Array<{
  id: string;
  displayName: string;
  tools: Array<{ name: string; description: string }>;
}> = [
  {
    id: "filesystem",
    displayName: "Filesystem",
    tools: [
      { name: "read_file", description: "Read the contents of a file from disk" },
      { name: "write_file", description: "Write or overwrite content to a file on disk" },
      { name: "list_directory", description: "List all files and folders in a directory" },
      { name: "delete_file", description: "Delete a file from the filesystem" },
      { name: "search_files", description: "Search for files matching a pattern on disk" },
    ],
  },
  {
    id: "github",
    displayName: "GitHub",
    tools: [
      { name: "create_issue", description: "Create a new issue in a GitHub repository" },
      { name: "list_repos", description: "List all GitHub repositories for a user or organization" },
      { name: "create_pr", description: "Open a pull request to merge changes into a branch on GitHub" },
      { name: "search_code", description: "Search for code across GitHub repositories" },
      { name: "get_file_contents", description: "Get the contents of a file from a GitHub repository" },
    ],
  },
  {
    id: "database",
    displayName: "Database",
    tools: [
      { name: "run_query", description: "Execute a SQL query against the database" },
      { name: "list_tables", description: "List all tables in the database" },
      { name: "describe_table", description: "Describe the schema and columns of a database table" },
      { name: "insert_row", description: "Insert a new row into a database table" },
      { name: "update_row", description: "Update an existing row in a database table" },
    ],
  },
  {
    id: "slack",
    displayName: "Slack",
    tools: [
      { name: "send_message", description: "Send a message to a Slack channel or user" },
      { name: "list_channels", description: "List all available Slack channels" },
      { name: "search_messages", description: "Search for messages across Slack channels" },
      { name: "upload_file", description: "Upload a file to a Slack channel" },
    ],
  },
  {
    id: "email",
    displayName: "Email",
    tools: [
      { name: "send_email", description: "Send an email message to one or more recipients" },
      { name: "list_inbox", description: "List emails in the inbox" },
      { name: "search_email", description: "Search for emails matching a query" },
      { name: "create_draft", description: "Create a draft email message" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Ground truth: 50 query -> expected toolId pairs
// ---------------------------------------------------------------------------

const GROUND_TRUTH: Array<{ query: string; expectedToolId: string }> = [
  { query: "read a file from disk", expectedToolId: "filesystem:read_file" },
  { query: "create a new GitHub issue", expectedToolId: "github:create_issue" },
  { query: "run a SQL query", expectedToolId: "database:run_query" },
  { query: "send a Slack message", expectedToolId: "slack:send_message" },
  { query: "list all files in a directory", expectedToolId: "filesystem:list_directory" },
  { query: "open a pull request", expectedToolId: "github:create_pr" },
  { query: "search for code in the repository", expectedToolId: "github:search_code" },
  { query: "list database tables", expectedToolId: "database:list_tables" },
  { query: "send an email to the team", expectedToolId: "email:send_email" },
  { query: "upload a file to Slack", expectedToolId: "slack:upload_file" },
  { query: "delete a file", expectedToolId: "filesystem:delete_file" },
  { query: "describe the schema of a table", expectedToolId: "database:describe_table" },
  { query: "check my inbox", expectedToolId: "email:list_inbox" },
  { query: "find messages about the release", expectedToolId: "slack:search_messages" },
  { query: "get contents of a file from GitHub", expectedToolId: "github:get_file_contents" },
  { query: "write data to a file on disk", expectedToolId: "filesystem:write_file" },
  { query: "insert a row into the users table", expectedToolId: "database:insert_row" },
  { query: "draft an email response", expectedToolId: "email:create_draft" },
  { query: "list all GitHub repositories", expectedToolId: "github:list_repos" },
  { query: "find all Slack channels", expectedToolId: "slack:list_channels" },
  // Additional 30 pairs
  { query: "load a text file from the filesystem", expectedToolId: "filesystem:read_file" },
  { query: "save content to a file", expectedToolId: "filesystem:write_file" },
  { query: "show files in a folder", expectedToolId: "filesystem:list_directory" },
  { query: "remove a file from storage", expectedToolId: "filesystem:delete_file" },
  { query: "find files matching a pattern", expectedToolId: "filesystem:search_files" },
  { query: "report a bug on GitHub", expectedToolId: "github:create_issue" },
  { query: "show all my GitHub repos", expectedToolId: "github:list_repos" },
  { query: "merge changes via pull request", expectedToolId: "github:create_pr" },
  { query: "look up code on GitHub", expectedToolId: "github:search_code" },
  { query: "fetch a file from a GitHub repo", expectedToolId: "github:get_file_contents" },
  { query: "execute a database query", expectedToolId: "database:run_query" },
  { query: "show all tables in the database", expectedToolId: "database:list_tables" },
  { query: "get column info for a table", expectedToolId: "database:describe_table" },
  { query: "add a record to a database table", expectedToolId: "database:insert_row" },
  { query: "modify an existing database row", expectedToolId: "database:update_row" },
  { query: "post a message to a Slack channel", expectedToolId: "slack:send_message" },
  { query: "browse available Slack channels", expectedToolId: "slack:list_channels" },
  { query: "search Slack for a conversation", expectedToolId: "slack:search_messages" },
  { query: "attach a file to Slack", expectedToolId: "slack:upload_file" },
  { query: "compose and send an email", expectedToolId: "email:send_email" },
  { query: "view emails in my inbox", expectedToolId: "email:list_inbox" },
  { query: "search emails for a keyword", expectedToolId: "email:search_email" },
  { query: "write a draft email", expectedToolId: "email:create_draft" },
  { query: "open and read a local file", expectedToolId: "filesystem:read_file" },
  { query: "write output to a local file", expectedToolId: "filesystem:write_file" },
  { query: "create a GitHub pull request to review changes", expectedToolId: "github:create_pr" },
  { query: "update a row in the database", expectedToolId: "database:update_row" },
  { query: "search for files on disk", expectedToolId: "filesystem:search_files" },
  { query: "email someone", expectedToolId: "email:send_email" },
  { query: "look up emails matching a query", expectedToolId: "email:search_email" },
];

// ---------------------------------------------------------------------------
// Benchmark suite
// ---------------------------------------------------------------------------

describe("Routing Quality - Precision@5", () => {
  let engine: EmbeddingEngine;
  let db: ToolStreamDatabase;
  let registry: ToolRegistry;

  beforeAll(async () => {
    engine = new EmbeddingEngine("local");
    await engine.initialize();

    db = new ToolStreamDatabase(":memory:");

    for (const server of SERVERS) {
      db.insertServer(server.id, server.displayName, "stdio");
    }

    registry = new ToolRegistry(db, engine);

    for (const server of SERVERS) {
      await registry.registerTools(
        server.id,
        server.tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: { type: "object" as const, properties: {} },
        }))
      );
    }
  }, 60000);

  it("index contains all registered tools", () => {
    const totalTools = SERVERS.reduce((sum, s) => sum + s.tools.length, 0);
    expect(registry.indexSize).toBe(totalTools);
  });

  it(`Precision@5 >= 0.80 across ${GROUND_TRUTH.length} queries`, async () => {
    let hits = 0;
    const misses: Array<{ query: string; expected: string; got: string[] }> = [];

    for (const { query, expectedToolId } of GROUND_TRUTH) {
      const queryVector = await engine.embed(query);
      const results = await registry.topKByVector(queryVector, 5);
      const returnedIds = results.map((r) => r.tool.id);

      if (returnedIds.includes(expectedToolId)) {
        hits++;
      } else {
        misses.push({ query, expected: expectedToolId, got: returnedIds });
      }
    }

    const precision = hits / GROUND_TRUTH.length;

    if (misses.length > 0) {
      console.log("\n[routing-quality] Missed queries:");
      for (const miss of misses) {
        console.log(`  query:    "${miss.query}"`);
        console.log(`  expected: ${miss.expected}`);
        console.log(`  top-5:    ${miss.got.join(", ")}`);
      }
    }

    console.log(
      `\n[routing-quality] Precision@5 = ${hits}/${GROUND_TRUTH.length} = ${(precision * 100).toFixed(1)}%`
    );

    expect(precision).toBeGreaterThanOrEqual(0.80);
  }, 60000);
});
