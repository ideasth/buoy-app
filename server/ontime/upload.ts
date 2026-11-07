// filepath: /home/user/workspace/anchor/server/ontime/upload.ts
// Stage 25 (On Time) — parse manually uploaded emails (Safer Care Victoria
// and anything else outside the AUPFHS mailbox). Accepts .eml, .msg or
// pasted text. Nothing is written to disk; only the triage row is stored.

import crypto from "node:crypto";
import { simpleParser } from "mailparser";
import MsgReaderMod from "@kenjiuno/msgreader";

export interface ParsedUpload {
  externalId: string;
  receivedAt: number;
  sender: string;
  senderName: string;
  subject: string;
  body: string;
}

const MsgReader: any = (MsgReaderMod as any).default ?? MsgReaderMod;

function hash(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex").slice(0, 32);
}

export async function parseEml(buf: Buffer): Promise<ParsedUpload> {
  const m = await simpleParser(buf);
  const from = m.from?.value?.[0];
  const body = (m.text ?? (typeof m.html === "string" ? m.html.replace(/<[^>]+>/g, " ") : "") ?? "").slice(0, 6000);
  const id = m.messageId || hash(`${from?.address}|${m.subject}|${m.date?.toISOString()}|${body.slice(0, 200)}`);
  return {
    externalId: `eml:${id}`,
    receivedAt: m.date?.getTime() ?? Date.now(),
    sender: String(from?.address ?? "").toLowerCase(),
    senderName: String(from?.name || from?.address || ""),
    subject: String(m.subject ?? ""),
    body,
  };
}

export function parseMsg(buf: Buffer): ParsedUpload {
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const reader = new MsgReader(ab);
  const d: any = reader.getFileData();
  const sender = String(d.senderEmail ?? d.senderSmtpAddress ?? "").toLowerCase();
  const dateStr = d.messageDeliveryTime || d.clientSubmitTime || d.creationTime;
  const receivedAt = dateStr ? Date.parse(dateStr) || Date.now() : Date.now();
  const body = String(d.body ?? "").slice(0, 6000);
  const id = d.internetMessageId || hash(`${sender}|${d.subject}|${receivedAt}|${body.slice(0, 200)}`);
  return {
    externalId: `msg:${id}`,
    receivedAt,
    sender,
    senderName: String(d.senderName ?? sender),
    subject: String(d.subject ?? ""),
    body,
  };
}

/**
 * Pasted text: tries to read "From:", "Subject:", "Sent:"/"Date:" header
 * lines (as copied from Outlook), else treats the whole thing as the body.
 */
export function parsePasted(text: string): ParsedUpload {
  const t = text.replace(/\r\n/g, "\n").slice(0, 20000);
  const hdr = (name: string) => {
    const m = t.match(new RegExp(`^${name}:\\s*(.+)$`, "im"));
    return m ? m[1].trim() : "";
  };
  const fromLine = hdr("From");
  const addr = (fromLine.match(/<([^>]+)>/)?.[1] ?? fromLine.match(/[\w.+-]+@[\w.-]+/)?.[0] ?? "").toLowerCase();
  const name = fromLine.replace(/<[^>]+>/, "").replace(/"/g, "").trim() || addr;
  const subject = hdr("Subject") || t.split("\n").find((l) => l.trim())?.slice(0, 120) || "(pasted email)";
  const dateLine = hdr("Sent") || hdr("Date");
  const parsedDate = dateLine ? Date.parse(dateLine.replace(/^\w+day,?\s*/i, "")) : NaN;
  return {
    externalId: `paste:${hash(t)}`,
    receivedAt: Number.isFinite(parsedDate) ? parsedDate : Date.now(),
    sender: addr,
    senderName: name,
    subject,
    body: t.slice(0, 6000),
  };
}

export async function parseUpload(input: { filename?: string; contentBase64?: string; text?: string }): Promise<ParsedUpload> {
  if (input.text && input.text.trim()) return parsePasted(input.text);
  if (!input.contentBase64) throw new Error("no content");
  const buf = Buffer.from(input.contentBase64, "base64");
  if (buf.length > 15 * 1024 * 1024) throw new Error("file too large (15 MB max)");
  const name = (input.filename ?? "").toLowerCase();
  // OLE compound file magic = .msg
  const isOle = buf.length > 8 && buf.readUInt32BE(0) === 0xd0cf11e0;
  if (name.endsWith(".msg") || isOle) return parseMsg(buf);
  return parseEml(buf);
}
