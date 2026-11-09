// filepath: /home/user/workspace/anchor/server/ontime/graph.ts
// Stage 25 (On Time) — read-only Microsoft Graph mail poller.
//
// Auth: OAuth2 client-credentials against the AUPFHS tenant. The app
// registration holds ONLY the Mail.Read application permission, and an
// Exchange Online application access policy (or RBAC for Applications)
// restricts it to drjoliverdaly@aupfhs.com.au.
//
// Writes (Application Mail.ReadWrite, scoped by Exchange RBAC for
// Applications "Buoy Mail Scope RBAC" to the same single mailbox):
//   Stage 29 setMessageFlag()  — the message `flag` property only
//   Stage 30 patchMessage()    — `flag` and/or `categories` only (enforced)
//   Stage 30 moveMessage()     — Archive > Buoy-DoneDismissed, or back to Inbox
//   Stage 30 ensureDoneFolder()— creates that one folder if missing
// Nothing here sends, deletes or marks mail read.
//
// Credentials: <secrets>/graph_mail.json
//   { "tenantId": "...", "clientId": "...", "clientSecret": "...", "mailbox": "drjoliverdaly@aupfhs.com.au" }
// Never logged, never returned by any API.

import fs from "node:fs";
import path from "node:path";
import { secretsDir } from "./notify";

export interface GraphCreds {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  mailbox: string;
}

export interface GraphMessage {
  id: string;
  receivedAt: number;
  sender: string;
  senderName: string;
  subject: string;
  body: string;
  webLink: string | null;
}

export function readGraphCreds(): GraphCreds | null {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(secretsDir(), "graph_mail.json"), "utf8"));
    if (j.tenantId && j.clientId && j.clientSecret && j.mailbox) return j as GraphCreds;
    return null;
  } catch {
    return null;
  }
}

let tokenCache: { token: string; exp: number } | null = null;

async function getToken(c: GraphCreds): Promise<string> {
  if (tokenCache && tokenCache.exp - 60_000 > Date.now()) return tokenCache.token;
  const body = new URLSearchParams({
    client_id: c.clientId,
    client_secret: c.clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(c.tenantId)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`graph token HTTP ${res.status}`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return j.access_token;
}

function stripHtml(s: string): string {
  return s
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

function mapMessage(m: any): GraphMessage | null {
  if (!m || m["@removed"] || !m.id) return null;
  const from = m.from?.emailAddress ?? m.sender?.emailAddress ?? {};
  const raw = m.body?.content ?? m.bodyPreview ?? "";
  const body = m.body?.contentType === "html" ? stripHtml(raw) : String(raw);
  return {
    id: String(m.id),
    receivedAt: Date.parse(m.receivedDateTime) || Date.now(),
    sender: String(from.address ?? "").toLowerCase(),
    senderName: String(from.name ?? from.address ?? ""),
    subject: String(m.subject ?? ""),
    body: body.slice(0, 6000),
    webLink: m.webLink ?? null,
  };
}

/**
 * Pull new Inbox messages using a delta query. On first run, only messages
 * from the last `backfillDays` are requested. Returns messages plus the new
 * deltaLink to persist.
 */
export async function pollInbox(
  c: GraphCreds, deltaLink: string | null, backfillDays = 3,
): Promise<{ messages: GraphMessage[]; deltaLink: string | null }> {
  const token = await getToken(c);
  const select = "id,subject,from,sender,receivedDateTime,bodyPreview,body,webLink";
  let url = deltaLink;
  if (!url) {
    const since = new Date(Date.now() - backfillDays * 86_400_000).toISOString();
    url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(c.mailbox)}/mailFolders('inbox')/messages/delta`
      + `?$select=${select}&$filter=${encodeURIComponent(`receivedDateTime ge ${since}`)}`;
  }
  const out: GraphMessage[] = [];
  let next: string | null = url;
  let finalDelta: string | null = null;
  let pages = 0;
  while (next && pages < 50) {
    pages++;
    const res = await fetch(next, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Prefer: 'outlook.body-content-type="text", odata.maxpagesize=50',
      },
    });
    if (res.status === 410) {
      // delta token expired — restart from a fresh backfill next poll
      return { messages: out, deltaLink: null };
    }
    if (!res.ok) throw new Error(`graph delta HTTP ${res.status}`);
    const j = (await res.json()) as any;
    for (const m of j.value ?? []) {
      const mm = mapMessage(m);
      if (mm) out.push(mm);
    }
    next = j["@odata.nextLink"] ?? null;
    if (j["@odata.deltaLink"]) finalDelta = j["@odata.deltaLink"];
  }
  return { messages: out, deltaLink: finalDelta ?? deltaLink };
}

/**
 * Stage 29 — set or clear the Outlook follow-up flag on one message.
 * Sends ONLY {"flag":{"flagStatus":...}}; no other property is touched.
 */
export async function setMessageFlag(
  c: GraphCreds, messageId: string, flagStatus: "flagged" | "notFlagged",
): Promise<void> {
  const token = await getToken(c);
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(c.mailbox)}/messages/${encodeURIComponent(messageId)}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ flag: { flagStatus } }),
  });
  if (!res.ok) {
    let msg = "";
    try { msg = String(((await res.json()) as any)?.error?.code ?? ""); } catch { /* ignore */ }
    throw new Error(`graph flag HTTP ${res.status}${msg ? ` ${msg}` : ""}`);
  }
}

// ---------------------------------------------------------------- Stage 30

const ALLOWED_PATCH_KEYS = new Set(["flag", "categories"]);
export const DONE_FOLDER_NAME = "Buoy-DoneDismissed";

function msgUrl(c: GraphCreds, id: string): string {
  return `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(c.mailbox)}/messages/${encodeURIComponent(id)}`;
}

async function graphFetch(c: GraphCreds, url: string, init: { method: string; body?: unknown }, what: string): Promise<any> {
  const token = await getToken(c);
  const res = await fetch(url, {
    method: init.method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  if (!res.ok) {
    let code = "";
    try { code = String(((await res.json()) as any)?.error?.code ?? ""); } catch { /* ignore */ }
    throw new Error(`graph ${what} HTTP ${res.status}${code ? ` ${code}` : ""}`);
  }
  if (res.status === 204) return {};
  try { return await res.json(); } catch { return {}; }
}

export async function getMessageCategories(c: GraphCreds, id: string): Promise<string[]> {
  const j = await graphFetch(c, `${msgUrl(c, id)}?$select=categories`, { method: "GET" }, "categories");
  return Array.isArray(j?.categories) ? j.categories.map(String) : [];
}

export async function patchMessage(c: GraphCreds, id: string, body: Record<string, unknown>): Promise<void> {
  for (const k of Object.keys(body)) if (!ALLOWED_PATCH_KEYS.has(k)) throw new Error(`refusing to patch ${k}`);
  await graphFetch(c, msgUrl(c, id), { method: "PATCH", body }, "patch");
}

let doneFolderCache: { mailbox: string; id: string } | null = null;
export function _resetDoneFolderCache(): void { doneFolderCache = null; }

export async function ensureDoneFolder(c: GraphCreds): Promise<string> {
  if (doneFolderCache?.mailbox === c.mailbox) return doneFolderCache.id;
  const base = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(c.mailbox)}/mailFolders('archive')/childFolders`;
  const filter = encodeURIComponent(`displayName eq '${DONE_FOLDER_NAME}'`);
  const found = await graphFetch(c, `${base}?$filter=${filter}&$select=id,displayName`, { method: "GET" }, "folder lookup");
  let id: string | undefined = found?.value?.[0]?.id;
  if (!id) {
    const made = await graphFetch(c, base, { method: "POST", body: { displayName: DONE_FOLDER_NAME } }, "folder create");
    id = made?.id;
  }
  if (!id) throw new Error("graph folder: no id returned");
  doneFolderCache = { mailbox: c.mailbox, id };
  return id;
}

export async function moveMessage(
  c: GraphCreds, id: string, dest: "file" | "inbox",
): Promise<{ id: string; webLink: string | null }> {
  const destinationId = dest === "inbox" ? "inbox" : await ensureDoneFolder(c);
  const j = await graphFetch(c, `${msgUrl(c, id)}/move`, { method: "POST", body: { destinationId } }, "move");
  if (!j?.id) throw new Error("graph move: no id returned");
  return { id: String(j.id), webLink: j.webLink ?? null };
}

// ---------------------------------------------------------------- Stage 34
/**
 * Read-only lookup of one message in the same mailbox by its RFC 822
 * Message-ID (e.g. "<abc@host>"). Used to give uploaded .eml/.msg rows an
 * Outlook link. Returns null when the message isn't in this mailbox.
 */
export async function findMessageByInternetId(
  c: GraphCreds, internetMessageId: string,
): Promise<{ id: string; webLink: string | null } | null> {
  const q = internetMessageId.replace(/'/g, "''");
  const filter = encodeURIComponent(`internetMessageId eq '${q}'`);
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(c.mailbox)}/messages?$filter=${filter}&$select=id,webLink&$top=1`;
  const j = await graphFetch(c, url, { method: "GET" }, "message lookup");
  const m = j?.value?.[0];
  return m?.id ? { id: String(m.id), webLink: m.webLink ?? null } : null;
}
