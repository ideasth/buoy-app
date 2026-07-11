// Stage 23 — Notes-timeline thread pointer.
//
// A project component note's sourceUrl doubles as a "thread" pointer. The
// sourceLabel is no longer entered by hand: on create it is auto-fetched from
// the page <title> (falling back to og:title). Fetching is best-effort — it
// never throws and returns null on any failure, so a saved note always keeps
// its URL even when the title cannot be resolved.

const TITLE_FETCH_TIMEOUT_MS = 8000;
const MAX_TITLE_LEN = 200;
const USER_AGENT =
  "Mozilla/5.0 (compatible; BuoyBot/1.0; +https://github.com/ideasth/buoy-app)";

// True only for an absolute http(s) URL. Blank/null is handled by the caller
// (it clears both fields), so this returns false for blank input.
export function isAbsoluteHttpUrl(v: unknown): boolean {
  if (typeof v !== "string" || v.trim() === "") return false;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

// Collapse whitespace, trim, decode a few common HTML entities, and cap length.
export function normaliseTitle(raw: string): string {
  const decoded = raw
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'");
  const collapsed = decoded.replace(/\s+/g, " ").trim();
  return collapsed.length > MAX_TITLE_LEN
    ? collapsed.slice(0, MAX_TITLE_LEN).trim()
    : collapsed;
}

// Pull a title out of raw HTML: prefer <title>, fall back to og:title.
export function extractTitleFromHtml(html: string): string | null {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch && titleMatch[1].trim() !== "") {
    return normaliseTitle(titleMatch[1]);
  }
  const og = html.match(
    /<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']*)["'][^>]*>/i,
  ) || html.match(
    /<meta[^>]+content=["']([^"']*)["'][^>]*property=["']og:title["'][^>]*>/i,
  );
  if (og && og[1].trim() !== "") {
    return normaliseTitle(og[1]);
  }
  return null;
}

// Fetch the page at `url` and return its title, or null on any failure.
// Never throws.
export async function fetchThreadTitle(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TITLE_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,*/*" },
    });
    if (!res.ok) return null;
    const html = await res.text();
    return extractTitleFromHtml(html);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface ResolvedNoteSource {
  ok: boolean;
  error?: string;
  sourceUrl: string | null;
  sourceLabel: string | null;
}

// Shared create/update logic for a note's thread pointer. The fetcher is
// injectable so callers (and tests) can supply a deterministic title source.
//   - blank/null url  -> clears both fields.
//   - non-http(s) url -> { ok:false, error:"invalid_source_url" }.
//   - valid url       -> stores the url + fetched title (title may be null).
export async function resolveNoteSource(
  sourceUrl: unknown,
  fetcher: (url: string) => Promise<string | null> = fetchThreadTitle,
): Promise<ResolvedNoteSource> {
  if (sourceUrl == null || (typeof sourceUrl === "string" && sourceUrl.trim() === "")) {
    return { ok: true, sourceUrl: null, sourceLabel: null };
  }
  if (!isAbsoluteHttpUrl(sourceUrl)) {
    return { ok: false, error: "invalid_source_url", sourceUrl: null, sourceLabel: null };
  }
  const url = (sourceUrl as string).trim();
  const sourceLabel = await fetcher(url);
  return { ok: true, sourceUrl: url, sourceLabel };
}
