// src/notifications/telegram.ts - Telegram Bot API notifications (zero dependencies)

interface TelegramConfig {
  botToken: string;
  chatId: string;
  events: string[];
  throttleSeconds: number;
}

interface ThrottleEntry {
  lastSent: number;
}

export class TelegramNotifier {
  private config: TelegramConfig;
  private throttleMs: number;
  private throttleMap: Map<string, ThrottleEntry> = new Map();
  private enabled: boolean = false;

  constructor(config: TelegramConfig, throttleMsOverride?: number) {
    this.config = config;
    this.throttleMs = throttleMsOverride ?? config.throttleSeconds * 1000;
  }

  async initialize(): Promise<void> {
    if (!this.config.botToken || !this.config.chatId) {
      console.warn("[Telegram] Missing bot_token or chat_id. Notifications disabled.");
      return;
    }

    // Startup health check - send a test message
    try {
      const ok = await this.sendRaw("Toolstream started. Telegram notifications active.");
      if (ok) {
        this.enabled = true;
        console.log("[Telegram] Notifications enabled.");
      } else {
        console.warn("[Telegram] Startup test failed. Notifications disabled.");
      }
    } catch {
      console.warn("[Telegram] Could not reach Telegram API. Notifications disabled.");
    }
  }

  async notify(event: string, message: string): Promise<void> {
    if (!this.enabled) return;
    if (!this.config.events.includes(event)) return;
    if (this.isThrottled(event)) return;

    try {
      await this.sendRaw(message);
      this.recordSend(event);
    } catch {
      // Failed send does not count against throttle
    }
  }

  private isThrottled(event: string): boolean {
    const entry = this.throttleMap.get(event);
    if (!entry) return false;
    return Date.now() - entry.lastSent < this.throttleMs;
  }

  private recordSend(event: string): void {
    this.throttleMap.set(event, { lastSent: Date.now() });
  }

  private async sendRaw(text: string): Promise<boolean> {
    const url = `https://api.telegram.org/bot${this.config.botToken}/sendMessage`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: this.config.chatId,
        text,
        parse_mode: "HTML",
      }),
    });
    return response.ok;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }
}

// Helper to format notification messages
export function formatServerDown(serverId: string, error: string, attempt: number, maxAttempts: number): string {
  const time = new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
  return `🔴 Toolstream: Server '${serverId}' DOWN\nTime: ${time}\nError: ${error}\nAction: Auto-reconnect in progress (attempt ${attempt}/${maxAttempts})`;
}

export function formatServerRecovered(serverId: string, pingMs: number): string {
  const time = new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
  return `🟢 Toolstream: Server '${serverId}' RECOVERED\nTime: ${time}\nPing: ${pingMs}ms`;
}

export function formatStartupFailure(error: string): string {
  const time = new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
  return `🔴 Toolstream: STARTUP FAILURE\nTime: ${time}\nError: ${error}`;
}
