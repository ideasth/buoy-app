import type { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import { randomBytes, createHash } from "node:crypto";
import { db, storage } from "./storage";
import { authSessions, type AuthSession } from "@shared/schema";
import { eq, and, isNull, desc, gt } from "drizzle-orm";
import { BAKED_SYNC_SECRET } from "./baked-secret";

const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
const IS_PROD = process.env.NODE_ENV === "production";

// Anchor is loaded inside an iframe via the sites proxy. The proxy strips
// any request cookie whose name does not start with __Host-, so the prefix
// is required. The iframe context is cross-site, so SameSite must be None
// (Strict/Lax cookies are dropped on iframe requests). __Host- + Secure +
// SameSite=None is permitted by Chrome/Edge/Safari modern.
export const COOKIE_NAME = IS_PROD ? "__Host-anchor-sid" : "anchor-sid";
const COOKIE_OPTS = {
  httpOnly: true,
  secure: IS_PROD,
  sameSite: IS_PROD ? ("none" as const) : ("lax" as const),
  path: "/",
  maxAge: SESSION_TTL_MS,
};

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function hasPassphrase(): boolean {
  const s = storage.getSettings();
  return !!s.passphrase_hash;
}

export async function setPassphrase(plain: string): Promise<void> {
  const hash = await bcrypt.hash(plain, 10);
  storage.updateSettings({ passphrase_hash: hash });
}

export async function verifyPassphrase(plain: string): Promise<boolean> {
  const s = storage.getSettings();
  if (!s.passphrase_hash) return false;
  try {
    return await bcrypt.compare(plain, s.passphrase_hash);
  } catch {
    return false;
  }
}

export function createSession(deviceLabel?: string): { token: string; expiresAt: number } {
  const token = randomBytes(32).toString("hex");
  const tokenHash = sha256(token);
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  db.insert(authSessions)
    .values({
      tokenHash,
      deviceLabel: deviceLabel ?? null,
      createdAt: now,
      expiresAt,
      lastSeenAt: now,
      revokedAt: null,
    })
    .run();
  return { token, expiresAt };
}

export function validateSession(token: string): AuthSession | null {
  if (!token) return null;
  const tokenHash = sha256(token);
  const row = db
    .select()
    .from(authSessions)
    .where(eq(authSessions.tokenHash, tokenHash))
    .get();
  if (!row) return null;
  if (row.revokedAt) return null;
  if (row.expiresAt <= Date.now()) return null;
  // bump lastSeenAt
  db.update(authSessions)
    .set({ lastSeenAt: Date.now() })
    .where(eq(authSessions.id, row.id))
    .run();
  return row;
}

export function revokeSession(token: string): void {
  const tokenHash = sha256(token);
  db.update(authSessions)
    .set({ revokedAt: Date.now() })
    .where(eq(authSessions.tokenHash, tokenHash))
    .run();
}

export function revokeSessionById(id: number): void {
  db.update(authSessions)
    .set({ revokedAt: Date.now() })
    .where(eq(authSessions.id, id))
    .run();
}

export function listSessions(): AuthSession[] {
  return db
    .select()
    .from(authSessions)
    .where(and(isNull(authSessions.revokedAt), gt(authSessions.expiresAt, Date.now())))
    .orderBy(desc(authSessions.lastSeenAt))
    .all();
}

export function revokeAllSessions(exceptToken?: string): void {
  if (exceptToken) {
    const exceptHash = sha256(exceptToken);
    db.update(authSessions)
      .set({ revokedAt: Date.now() })
      .where(and(isNull(authSessions.revokedAt)))
      .run();
    // Restore the kept session
    db.update(authSessions)
      .set({ revokedAt: null })
      .where(eq(authSessions.tokenHash, exceptHash))
      .run();
  } else {
    db.update(authSessions)
      .set({ revokedAt: Date.now() })
      .where(isNull(authSessions.revokedAt))
      .run();
  }
}

/**
 * Extract the session token from either:
 *   - `Authorization: Bearer <token>` header (preferred — works through the
 *      sites proxy without cookie-stripping issues)
 *   - the session cookie (fallback for direct/native clients)
 */
export function extractTokenFromRequest(req: Request): string | null {
  // Query-string token: required because the deploy_website proxy strips
  // ALL auth-ish headers (Cookie, Authorization, X-Anchor-Token). Query
  // strings survive the proxy. The token is short-lived and rotatable.
  const qToken =
    typeof (req.query as any)?.t === "string" ? String((req.query as any).t).trim() : "";
  const auth = (req.header("authorization") || "").trim();
  const xToken = (req.header("x-anchor-token") || "").trim();
  const cookieToken = (req as any).cookies?.[COOKIE_NAME];
  let result: string | null = null;
  if (qToken) result = qToken;
  if (!result && xToken) result = xToken;
  if (!result && auth.toLowerCase().startsWith("bearer ")) {
    const token = auth.slice(7).trim();
    if (token) result = token;
  }
  if (!result && cookieToken) result = cookieToken;
  return result;
}

export function getCurrentSession(req: Request): AuthSession | null {
  const token = extractTokenFromRequest(req);
  if (!token) return null;
  return validateSession(token);
}

export function getCurrentToken(req: Request): string | null {
  return extractTokenFromRequest(req);
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(COOKIE_NAME, token, COOKIE_OPTS);
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, { ...COOKIE_OPTS, maxAge: 0 });
}

const SYNC_SECRET = process.env.ANCHOR_SYNC_SECRET || BAKED_SYNC_SECRET || "";

// Routes that don't need a session (auth bootstrap + health + public ICS).
const ALLOWLIST_EXACT = new Set<string>([
  "/api/auth/status",
  "/api/auth/setup",
  "/api/auth/login",
  "/api/health",
  // Public Family Notes ICS feed — subscription clients can't pass auth
  // headers, and the contents are intentionally shareable with family.
  "/api/planner/notes.ics",
]);

// Routes already gated by orchestrator-secret + same-origin in routes.ts;
// we MUST NOT also require a session here so cron/orchestrator calls work.
// Path patterns; tested with startsWith.
const SYNC_ALLOWLIST_PREFIXES = [
  "/api/sync/",
  "/api/inbox/suggestions",
  "/api/inbox/count",
  "/api/usage/cron-run",
];

export function isAllowlistedPath(path: string): boolean {
  if (ALLOWLIST_EXACT.has(path)) return true;
  for (const p of SYNC_ALLOWLIST_PREFIXES) {
    if (path === p || path.startsWith(p)) return true;
  }
  return false;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const path = req.path;
  if (!path.startsWith("/api")) return next();
  if (isAllowlistedPath(path)) return next();

  // Orchestrator secret bypass (for any future direct cron calls).
  if (SYNC_SECRET) {
    const provided = (req.header("x-anchor-sync-secret") || "").trim();
    if (provided && provided === SYNC_SECRET) return next();
  }

  const session = getCurrentSession(req);
  if (session) {
    (req as any).authSession = session;
    return next();
  }

  res.status(401).json({ error: "auth required" });
}
