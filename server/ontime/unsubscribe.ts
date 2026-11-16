// filepath: /home/user/workspace/anchor/server/ontime/unsubscribe.ts
// Stage 36 — "Unsubscribe" category: work out how Oliver can stop an email.
//
// Sources, in order of reliability:
//   1. the List-Unsubscribe header (RFC 2369), with RFC 8058 one-click hint
//   2. unsubscribe / opt-out / preferences links found in the body text
//   3. fallback Outlook steps (block sender, rule to Junk)
// Buoy never sends mail and never visits these links itself: it only shows
// them. Links are untrusted input, so only http(s) and mailto are returned.

export type UnsubLink = { kind: "web" | "email"; url: string; source: "header" | "body" };

export interface UnsubPlan {
  links: UnsubLink[];
  oneClick: boolean;
  caution: string | null;
  steps: string[];
}

const MAX_LINKS = 3;

function cleanUrl(raw: string): string | null {
  const u = raw.trim().replace(/^<|>$/g, "").replace(/[).,;]+$/, "");
  if (/^https?:\/\/[^\s<>"]+$/i.test(u)) return u.slice(0, 2000);
  if (/^mailto:[^\s<>"]+$/i.test(u)) return u.slice(0, 1000);
  return null;
}

export function parseListUnsubscribe(header: string | null | undefined): UnsubLink[] {
  if (!header) return [];
  const out: UnsubLink[] = [];
  for (const m of header.matchAll(/<([^>]+)>/g)) {
    const url = cleanUrl(m[1]);
    if (!url) continue;
    out.push({ kind: url.toLowerCase().startsWith("mailto:") ? "email" : "web", url, source: "header" });
  }
  return out;
}

const UNSUB_WORDS = /unsubscribe|opt[\s-]?out|manage (?:your )?(?:email |subscription |communication )?preferences|email preferences|update (?:your )?preferences|stop receiving|remove me|subscription settings/i;

/** Links near unsubscribe wording in a plain-text body (Graph renders links as `text <url>`). */
export function findBodyUnsubLinks(body: string | null | undefined): UnsubLink[] {
  if (!body) return [];
  const text = body.slice(0, 60_000);
  const out: UnsubLink[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(/(?:https?:\/\/|mailto:)[^\s<>"]+/gi)) {
    const at = m.index ?? 0;
    // Wording usually sits just before the link ("Unsubscribe <url>") or right
    // after it on the same line ("<url> to unsubscribe"). Stay within the
    // link's own paragraph so a nearby "Read more" link isn't picked up.
    const before = text.slice(Math.max(0, at - 120), at).split(/\n\s*\n/).pop() ?? "";
    const after = (text.slice(at + m[0].length, at + m[0].length + 30).split("\n")[0]) ?? "";
    const near = `${before}${after}`;
    const url = cleanUrl(m[0]);
    if (!url || seen.has(url)) continue;
    if (!UNSUB_WORDS.test(near) && !UNSUB_WORDS.test(url)) continue;
    seen.add(url);
    out.push({ kind: url.toLowerCase().startsWith("mailto:") ? "email" : "web", url, source: "body" });
  }
  return out;
}

export function buildUnsubPlan(inp: {
  headers?: Array<{ name: string; value: string }> | null;
  body?: string | null;
  sender: string;
  category?: string | null;
}): UnsubPlan {
  const h = (n: string) => (inp.headers ?? []).find((x) => x.name.toLowerCase() === n)?.value ?? null;
  const headerLinks = parseListUnsubscribe(h("list-unsubscribe"));
  const oneClick = /list-unsubscribe=one-click/i.test(h("list-unsubscribe-post") ?? "");
  const seen = new Set(headerLinks.map((l) => l.url));
  const bodyLinks = findBodyUnsubLinks(inp.body).filter((l) => !seen.has(l.url));
  // Prefer web links (one click for Oliver), then email, header before body.
  const links = [...headerLinks, ...bodyLinks]
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "web" ? -1 : 1))
    .slice(0, MAX_LINKS);

  const sender = inp.sender || "this sender";
  const caution = inp.category === "spam"
    ? "This looks like junk. Unsubscribe links in scam or phishing emails can confirm your address is live, so block the sender in Outlook instead."
    : null;

  const steps: string[] = [];
  const web = links.find((l) => l.kind === "web");
  const mail = links.find((l) => l.kind === "email");
  if (!caution && web) {
    steps.push(oneClick
      ? "Open the unsubscribe page below; this sender supports one-click unsubscribe, so it usually takes effect straight away."
      : "Open the unsubscribe page below and confirm on that page if it asks.");
  }
  if (!caution && mail) {
    steps.push(web
      ? "If the page doesn't work, use the unsubscribe email instead: it opens a pre-addressed message in your mail app, and you press Send (Buoy never sends mail for you)."
      : "Use the unsubscribe email below: it opens a pre-addressed message in your mail app, and you press Send (Buoy never sends mail for you).");
  }
  if (!caution && links.length) {
    steps.push("Australian senders must honour an unsubscribe within 5 working days, so a few more may arrive.");
    steps.push("When done, press \"I've unsubscribed\": Buoy closes this email and sends any more from this sender to Spam/Junk.");
  }
  if (caution || !links.length) {
    if (!caution) steps.push("No unsubscribe link was found in this email.");
    steps.push(`In Outlook, right-click the email and choose Block > Block sender to stop mail from ${sender}.`);
    steps.push(`Or create an Outlook rule: Rules > Create rule > From ${sender} > Move to Junk Email.`);
    steps.push("Then press \"I've unsubscribed\" so Buoy sends any more from this sender to Spam/Junk.");
  }
  return { links: caution ? [] : links, oneClick: caution ? false : oneClick, caution, steps };
}
