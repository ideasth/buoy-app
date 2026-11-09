// filepath: server/ontime/upload-links.ts
// Stage 34 — give uploaded .eml/.msg triage rows an "Open in Outlook" link.
//
// Bulk-uploaded emails (Stage 25.1) were inserted with web_link NULL. Many were
// later read again by the Graph backfill, so the Email list shows the same
// email twice: once with a link (graph) and once without (upload).
// For each upload row without a link, look the message up READ-ONLY in the
// same mailbox by its Message-ID:
//   - found and already a graph row  -> remove the uploaded duplicate
//     (only if it has no linked task and is still open; otherwise just link it)
//   - found, no graph row            -> store its webLink on the upload row
//   - not found (other mailbox/deleted) -> leave unchanged
// Nothing in Outlook is changed.

export interface UploadLinkDeps {
  rows(): Array<{ id: number; external_id: string; status: string; task_id: number | null }>;
  hasGraphRow(graphId: string): boolean;
  setWebLink(id: number, webLink: string): void;
  deleteRow(id: number): boolean;
  lookup(internetMessageId: string): Promise<{ id: string; webLink: string | null } | null>;
}

export interface UploadLinkResult {
  checked: number; linked: number; duplicatesRemoved: number; notFound: number; noMessageId: number; errors: number;
}

export function messageIdOf(externalId: string): string | null {
  const m = /^(?:eml|msg):(.+)$/.exec(externalId);
  if (!m) return null;
  const id = m[1].trim();
  if (!id || /^[0-9a-f]{32}$/.test(id)) return null; // hashed fallback — no real Message-ID
  return id.startsWith("<") ? id : `<${id}>`;
}

export async function linkUploadedEmails(d: UploadLinkDeps): Promise<UploadLinkResult> {
  const out: UploadLinkResult = { checked: 0, linked: 0, duplicatesRemoved: 0, notFound: 0, noMessageId: 0, errors: 0 };
  for (const r of d.rows()) {
    out.checked++;
    const mid = messageIdOf(r.external_id);
    if (!mid) { out.noMessageId++; continue; }
    let hit: { id: string; webLink: string | null } | null = null;
    try { hit = await d.lookup(mid); } catch { out.errors++; continue; }
    if (!hit) { out.notFound++; continue; }
    const open = r.status === "new" || r.status === "queued";
    if (d.hasGraphRow(hit.id) && r.task_id == null && open) {
      if (d.deleteRow(r.id)) out.duplicatesRemoved++;
      continue;
    }
    if (hit.webLink) { d.setWebLink(r.id, hit.webLink); out.linked++; }
    else out.notFound++;
  }
  return out;
}
