// filepath: /home/user/workspace/anchor/server/ontime/graph.ts
// Stage 25 (On Time) — read-only Microsoft Graph mail poller.
//
// Auth: OAuth2 client-credentials against the AUPFHS tenant. The app
// registration holds ONLY the Mail.Read application permission, and an
// Exchange Online application access policy (or RBAC for Applications)
// restricts it to drjoliverdaly@aupfhs.com.au. Nothing here can send,
// move, flag or delete mail: only GET requests are issued.
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
