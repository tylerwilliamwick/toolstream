import { describe, it, expect, vi, beforeEach } from "vitest";
import { HealthMonitor } from "../src/health-monitor.js";

// Minimal fake UpstreamManager shape needed by HealthMonitor
function makeFakeManager(servers: Array<{ id: string; conn: any }>) {
  return {
    getServerStatus: vi.fn(() => servers.map((s) => ({ id: s.id, name: s.id, healthy: s.conn.healthy, toolCount: 0 }))),
    getConnection: vi.fn((serverId: string) => {
      const entry = servers.find((s) => s.id === serverId);
      return entry?.conn;
    }),
    scheduleReconnect: vi.fn(),
  } as any;
}

function makeConn(overrides: Partial<{ ping: () => Promise<void>; healthy: boolean; reconnecting: boolean }> = {}) {
  return {
    client: { ping: overrides.ping ?? vi.fn().mockResolvedValue(undefined) },
    healthy: overrides.healthy ?? true,
    reconnecting: overrides.reconnecting ?? false,
  };
}

describe("HealthMonitor", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("pingAll with a working ping() resolves without error", async () => {
    const conn = makeConn();
    const manager = makeFakeManager([{ id: "server-a", conn }]);
    const monitor = new HealthMonitor(manager, {}, { timeoutMs: 50 });

    await expect(monitor.pingAll()).resolves.toBeUndefined();
    expect(conn.client.ping).toHaveBeenCalledOnce();
  });

  it("ping timeout triggers scheduleReconnect when conn.reconnecting is false", async () => {
    const conn = makeConn({
      ping: () => new Promise((resolve) => setTimeout(resolve, 5000)), // never resolves within timeout
      healthy: true,
      reconnecting: false,
    });
    const manager = makeFakeManager([{ id: "slow-server", conn }]);
    const monitor = new HealthMonitor(manager, {}, { timeoutMs: 50 });

    await monitor.pingAll();

    expect(manager.scheduleReconnect).toHaveBeenCalledWith("slow-server");
    expect(conn.healthy).toBe(false);
  });

  it("ping timeout does NOT trigger scheduleReconnect when conn.reconnecting is true", async () => {
    const conn = makeConn({
      ping: () => new Promise((resolve) => setTimeout(resolve, 5000)),
      healthy: false,
      reconnecting: true,
    });
    const manager = makeFakeManager([{ id: "reconnecting-server", conn }]);
    const monitor = new HealthMonitor(manager, {}, { timeoutMs: 50 });

    await monitor.pingAll();

    expect(manager.scheduleReconnect).not.toHaveBeenCalled();
  });

  it("successful ping on previously unhealthy server emits server_recovered event", async () => {
    const conn = makeConn({ healthy: false, reconnecting: false });
    const manager = makeFakeManager([{ id: "recovering-server", conn }]);
    const monitor = new HealthMonitor(manager, {}, { timeoutMs: 50 });

    const recovered: Array<[string, number]> = [];
    monitor.on("server_recovered", (serverId: string, pingMs: number) => {
      recovered.push([serverId, pingMs]);
    });

    await monitor.pingAll();

    expect(recovered).toHaveLength(1);
    expect(recovered[0][0]).toBe("recovering-server");
    expect(typeof recovered[0][1]).toBe("number");
    expect(conn.healthy).toBe(true);
  });
});
