// filepath: /home/user/workspace/anchor/server/ontime/notify.ts
// Stage 25 (On Time) — ntfy publisher. The access token (if the self-hosted
// ntfy server requires one) is read from a secrets file at send time and is
// never logged or returned by any API.

import fs from "node:fs";
import path from "node:path";
import type { OnTimeConfig } from "./config";

export interface NtfyAction {
  action: "view" | "http";
  label: string;
  url: string;
  method?: "POST" | "GET";
  clear?: boolean;
}

export interface NtfyMessage {
  title: string;
  message: string;
  priority: 1 | 2 | 3 | 4 | 5;
  tags?: string[];
  click?: string;
  actions?: NtfyAction[];
}

export function secretsDir(): string {
  return process.env.BUOY_SECRETS_DIR || path.resolve(process.cwd(), ".secrets");
}

function readSecret(name: string): string | null {
  try {
    const v = fs.readFileSync(path.join(secretsDir(), name), "utf8").trim();
    return v || null;
  } catch {
    return null;
  }
}

export function ntfyConfigured(cfg: OnTimeConfig): boolean {
  return Boolean(cfg.ntfyBaseUrl && cfg.ntfyTopic);
}

export type Sender = (cfg: OnTimeConfig, msg: NtfyMessage) => Promise<{ ok: boolean; error?: string }>;

export const sendNtfy: Sender = async (cfg, msg) => {
  if (!ntfyConfigured(cfg)) return { ok: false, error: "ntfy not configured" };
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = readSecret("ntfy_token");
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const payload = {
    topic: cfg.ntfyTopic,
    title: msg.title.slice(0, 120),
    message: msg.message.slice(0, 1000),
    priority: msg.priority,
    tags: msg.tags,
    click: msg.click,
    actions: msg.actions?.slice(0, 3),
  };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    const res = await fetch(cfg.ntfyBaseUrl, {
      method: "POST", headers, body: JSON.stringify(payload), signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, error: `ntfy HTTP ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
};
