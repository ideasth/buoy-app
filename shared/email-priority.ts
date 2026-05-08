// Email priority evaluator — single source of truth for "is this email a
// priority?". Mirrors the criteria documented in the Life Management space
// CONTEXT.md ("Email priority criteria") verbatim.
//
// Outlook-side flag/importance fields are intentionally NOT consulted here
// (the user does not maintain those). The cron used to filter on them; that
// filter was removed on 2026-05-08, but the regression of stored
// isFlagged=0 even on matching rows traced back to the cron not writing the
// flag at all. To keep the criteria deterministic and resistant to future
// cron-side regressions, the server now evaluates priority itself on every
// upsert and on a boot-time backfill. Whatever the cron sends in `isFlagged`
// is overridden by `evaluateEmailPriority` below.
//
// Keep this file dependency-free so it can be imported from both server
// runtime and vitest tests without pulling in DB / network code.

export const PRIORITY_DOMAINS: readonly string[] = [
  // Workplaces
  "aupfhs.com.au",                 // Elgin House / AUPFHS
  "monashhealth.org",              // Monash Health
  "safercare.vic.gov.au",          // Safer Care Victoria
  "epworth.org.au",                // Epworth
  "epworthhealthcare.org.au",      // Epworth alt domain
  // Family / school
  "alia.vic.edu.au",               // Children's school
  // Medicolegal: domain-only hits matter (subject/body may not mention it)
  "medicolegalassessmentsgroup.com.au",
];

export const PRIORITY_SENDERS: readonly string[] = [
  // Marieke
  "mariekedench@yahoo.com.au",
  "info@mariekedench.com.au",
  // Kathryn Daly (also Kathryn Simmons)
  "spikyred@yahoo.com",
  "kathrynsdaly@gmail.com",
  "kathryn.daly@monash.edu",
  // Tilly Daly (Matilda)
  "tillydaly@icloud.com",
  "matildaedaly@gmail.com",
  // Poppy Daly (Penelope)
  "penelopedaly@icloud.com",
  "poppyedaly@gmail.com",
];

// Subject- or body-preview substring matches (case-insensitive).
export const PRIORITY_KEYWORDS: readonly string[] = [
  "medicolegal",
  "medico-legal",
  "ranzcog",
  "theatre list",
  "theatre lists",
  "epworth",
  "iuga",
  "ugsa",
  "peninsula health",
];

// No-reply / automated senders are rejected before priority evaluation,
// regardless of domain. Even noreply@epworth.org.au should NOT flag.
export const NO_REPLY_PATTERNS: readonly string[] = [
  "no-reply",
  "noreply",
  "newsletter",
  "mailer-daemon",
  "notifications",
  "do-not-reply",
];

export interface EmailPriorityInput {
  sender: string | null | undefined;
  subject: string | null | undefined;
  bodyPreview: string | null | undefined;
}

export interface EmailPriorityResult {
  isPriority: boolean;
  // For diagnostics / tests; never persisted.
  reason: string | null;
}

const EMAIL_RE = /<([^>]+)>|([\w.+-]+@[\w.-]+)/g;

/**
 * Best-effort extraction of the bare email address from a "sender" field.
 * Outlook returns either `"Name <addr@dom>"` or just `"addr@dom"`. Falls back
 * to the raw input lower-cased.
 */
export function extractSenderEmail(sender: string | null | undefined): string {
  if (!sender) return "";
  const s = String(sender).trim();
  if (!s) return "";
  EMAIL_RE.lastIndex = 0;
  let last = "";
  let m: RegExpExecArray | null;
  while ((m = EMAIL_RE.exec(s)) !== null) {
    last = (m[1] || m[2] || "").trim();
  }
  return (last || s).toLowerCase();
}

function isNoReply(email: string): boolean {
  if (!email) return false;
  const local = email.split("@")[0] || "";
  // Match against the local-part rather than the full address so that domains
  // accidentally containing "newsletter" don't trip the rule.
  return NO_REPLY_PATTERNS.some((p) => local.includes(p));
}

function senderDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1) : "";
}

function domainMatches(domain: string, target: string): boolean {
  if (!domain || !target) return false;
  // Allow subdomain matches (e.g. mail.epworth.org.au still flags as epworth).
  return domain === target || domain.endsWith("." + target);
}

export function evaluateEmailPriority(input: EmailPriorityInput): EmailPriorityResult {
  const email = extractSenderEmail(input.sender);
  if (!email) return { isPriority: false, reason: null };

  if (isNoReply(email)) {
    return { isPriority: false, reason: "no-reply rejected" };
  }

  // Exact sender match (family / friends).
  if (PRIORITY_SENDERS.includes(email)) {
    return { isPriority: true, reason: `sender:${email}` };
  }

  // Domain match (workplace / school / medicolegal).
  const domain = senderDomain(email);
  for (const d of PRIORITY_DOMAINS) {
    if (domainMatches(domain, d)) {
      return { isPriority: true, reason: `domain:${d}` };
    }
  }

  // Keyword match in subject or body preview.
  const haystack = `${input.subject || ""}\n${input.bodyPreview || ""}`.toLowerCase();
  if (haystack.trim()) {
    for (const kw of PRIORITY_KEYWORDS) {
      if (haystack.includes(kw)) {
        return { isPriority: true, reason: `keyword:${kw}` };
      }
    }
  }

  return { isPriority: false, reason: null };
}
