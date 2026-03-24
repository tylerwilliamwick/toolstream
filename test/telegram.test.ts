import { describe, it, expect, vi, beforeEach } from "vitest";
import { TelegramNotifier, formatServerDown, formatServerRecovered } from "../src/notifications/telegram.js";

describe("TelegramNotifier", () => {
  let notifier: TelegramNotifier;

  beforeEach(() => {
    notifier = new TelegramNotifier(
      {
        botToken: "test-token",
        chatId: "test-chat",
        events: ["server_down", "server_recovered"],
        throttleSeconds: 300,
      },
      100 // 100ms throttle for fast tests
    );
  });

  it("starts disabled before initialize()", () => {
    expect(notifier.isEnabled).toBe(false);
  });

  it("throttles repeated events", async () => {
    // Manually enable for testing
    (notifier as any).enabled = true;

    // Mock fetch
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    global.fetch = mockFetch;

    await notifier.notify("server_down", "test message 1");
    await notifier.notify("server_down", "test message 2"); // Should be throttled

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("allows different event types through throttle", async () => {
    (notifier as any).enabled = true;
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    global.fetch = mockFetch;

    await notifier.notify("server_down", "down");
    await notifier.notify("server_recovered", "up"); // Different event, not throttled

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("skips events not in config", async () => {
    (notifier as any).enabled = true;
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    global.fetch = mockFetch;

    await notifier.notify("some_other_event", "test");

    expect(mockFetch).toHaveBeenCalledTimes(0);
  });

  it("failed send does not count against throttle", async () => {
    (notifier as any).enabled = true;
    const mockFetch = vi.fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({ ok: true });
    global.fetch = mockFetch;

    await notifier.notify("server_down", "attempt 1"); // Fails
    await notifier.notify("server_down", "attempt 2"); // Should not be throttled

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

describe("message formatters", () => {
  it("formatServerDown includes server id and attempt", () => {
    const msg = formatServerDown("github", "Connection refused", 1, 10);
    expect(msg).toContain("github");
    expect(msg).toContain("DOWN");
    expect(msg).toContain("attempt 1/10");
  });

  it("formatServerRecovered includes server id and ping", () => {
    const msg = formatServerRecovered("github", 42);
    expect(msg).toContain("github");
    expect(msg).toContain("RECOVERED");
    expect(msg).toContain("42ms");
  });
});
