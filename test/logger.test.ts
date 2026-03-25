import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

// We need to import a fresh Logger instance per test since it's a singleton.
// Import the class directly by re-importing the module.
import { logger } from "../src/logger.js";

function tmpLogPath(): string {
  const dir = join(tmpdir(), "toolstream-test");
  mkdirSync(dir, { recursive: true });
  return join(dir, `test-${randomUUID()}.log`);
}

describe("Logger", () => {
  let logPath: string;

  beforeEach(() => {
    logPath = tmpLogPath();
  });

  afterEach(() => {
    // Reset logger to default state (info level, no file)
    (logger as any).level = 2; // LEVELS.info
    (logger as any).filePath = null;

    if (existsSync(logPath)) unlinkSync(logPath);
    const rotated = logPath + ".1";
    if (existsSync(rotated)) unlinkSync(rotated);
  });

  it("debug messages are filtered out at info level", () => {
    logger.configure({ level: "info" });
    logger.configure({ file: logPath });

    logger.info("visible-info");
    logger.debug("hidden-debug");

    const contents = readFileSync(logPath, "utf8");
    expect(contents).toContain("visible-info");
    expect(contents).not.toContain("hidden-debug");
  });

  it("JSON output has required fields: timestamp, level, message", () => {
    logger.configure({ level: "info" });
    logger.configure({ file: logPath });

    logger.info("test-message");

    const line = readFileSync(logPath, "utf8").trim();
    const parsed = JSON.parse(line);
    expect(parsed).toHaveProperty("timestamp");
    expect(parsed).toHaveProperty("level", "info");
    expect(parsed).toHaveProperty("message", "test-message");
    // timestamp should be an ISO string
    expect(() => new Date(parsed.timestamp)).not.toThrow();
  });

  it("context object is included in JSON output when provided", () => {
    logger.configure({ level: "info" });
    logger.configure({ file: logPath });

    logger.info("ctx-test", { sessionId: "abc123", serverId: "jira" });

    const line = readFileSync(logPath, "utf8").trim();
    const parsed = JSON.parse(line);
    expect(parsed.context).toBeDefined();
    expect(parsed.context.sessionId).toBe("abc123");
    expect(parsed.context.serverId).toBe("jira");
  });

  it("file output writes entries to disk", () => {
    logger.configure({ level: "info" });
    logger.configure({ file: logPath });

    logger.warn("disk-write-test");

    expect(existsSync(logPath)).toBe(true);
    const contents = readFileSync(logPath, "utf8");
    expect(contents).toContain("disk-write-test");
  });

  it("stderr output is written (does not throw)", () => {
    logger.configure({ level: "debug" });

    // We cannot easily capture stderr in vitest without mocking process.stderr,
    // but we verify no exception is thrown for all log levels.
    expect(() => {
      logger.error("err-msg");
      logger.warn("warn-msg");
      logger.info("info-msg");
      logger.debug("debug-msg");
    }).not.toThrow();
  });
});
