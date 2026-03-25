import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ToolStreamDatabase } from "../src/database.js";
import { existsSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

function tmpDbPath(): string {
  const dir = join(tmpdir(), "toolstream-test");
  mkdirSync(dir, { recursive: true });
  return join(dir, `test-${randomUUID()}.db`);
}

describe("CLI Stats - getTopCooccurrence", () => {
  let db: ToolStreamDatabase;
  let dbPath: string;

  beforeEach(() => {
    dbPath = tmpDbPath();
    db = new ToolStreamDatabase(dbPath);
  });

  afterEach(() => {
    db.close();
    if (existsSync(dbPath)) unlinkSync(dbPath);
    for (const suffix of ["-wal", "-shm"]) {
      const p = dbPath + suffix;
      if (existsSync(p)) unlinkSync(p);
    }
  });

  it("returns empty array when no co-occurrence data exists", () => {
    const result = db.getTopCooccurrence(10);
    expect(result).toEqual([]);
  });

  it("returns co-occurrence pairs ordered by count descending", () => {
    db.incrementCooccurrence("tool-a", "tool-b");
    db.incrementCooccurrence("tool-a", "tool-b");
    db.incrementCooccurrence("tool-a", "tool-c");

    const result = db.getTopCooccurrence(10);
    expect(result.length).toBe(2);
    expect(result[0].tool_a_id).toBe("tool-a");
    expect(result[0].tool_b_id).toBe("tool-b");
    expect(result[0].count).toBe(2);
    expect(result[1].count).toBe(1);
  });

  it("respects the limit parameter", () => {
    db.incrementCooccurrence("tool-a", "tool-b");
    db.incrementCooccurrence("tool-c", "tool-d");
    db.incrementCooccurrence("tool-e", "tool-f");

    const result = db.getTopCooccurrence(2);
    expect(result.length).toBe(2);
  });

  it("returns correct three-field tuple shape", () => {
    db.incrementCooccurrence("alpha", "beta");

    const result = db.getTopCooccurrence(1);
    expect(result.length).toBe(1);

    const row = result[0];
    expect(row).toHaveProperty("tool_a_id");
    expect(row).toHaveProperty("tool_b_id");
    expect(row).toHaveProperty("count");
    expect(typeof row.tool_a_id).toBe("string");
    expect(typeof row.tool_b_id).toBe("string");
    expect(typeof row.count).toBe("number");
  });
});
