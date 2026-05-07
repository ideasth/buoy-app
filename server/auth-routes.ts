import type { Express, Request, Response } from "express";
import {
  hasPassphrase,
  setPassphrase,
  verifyPassphrase,
  createSession,
  validateSession,
  revokeSession,
  revokeSessionById,
  listSessions,
  revokeAllSessions,
  setSessionCookie,
  clearSessionCookie,
  getCurrentToken,
  getCurrentSession,
  COOKIE_NAME,
} from "./auth";

// In-memory rate limiter: 5 failed logins per IP per 10 minutes.
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 5;
type Bucket = { count: number; firstAt: number };
const failBuckets = new Map<string, Bucket>();

function clientIp(req: Request): string {
  const fwd = (req.header("x-forwarded-for") || "").split(",")[0]?.trim();
  return fwd || req.ip || req.socket.remoteAddress || "unknown";
}

function isRateLimited(ip: string): boolean {
  const b = failBuckets.get(ip);
  if (!b) return false;
  if (Date.now() - b.firstAt > RATE_WINDOW_MS) {
    failBuckets.delete(ip);
    return false;
  }
  return b.count >= RATE_MAX;
}

function recordFailure(ip: string) {
  const now = Date.now();
  const b = failBuckets.get(ip);
  if (!b || now - b.firstAt > RATE_WINDOW_MS) {
    failBuckets.set(ip, { count: 1, firstAt: now });
  } else {
    b.count += 1;
  }
}

function clearFailures(ip: string) {
  failBuckets.delete(ip);
}

export function registerAuthRoutes(app: Express): void {
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/auth/status", (req: Request, res: Response) => {
    const session = getCurrentSession(req);
    res.json({
      hasPassphrase: hasPassphrase(),
      authenticated: !!session,
    });
  });

  app.post("/api/auth/setup", async (req: Request, res: Response) => {
    if (hasPassphrase()) {
      return res.status(400).json({ error: "passphrase already set" });
    }
    const passphrase = String(req.body?.passphrase ?? "");
    if (passphrase.length < 8) {
      return res.status(400).json({ error: "passphrase must be at least 8 characters" });
    }
    const deviceLabel =
      typeof req.body?.deviceLabel === "string" && req.body.deviceLabel.trim()
        ? String(req.body.deviceLabel).slice(0, 80)
        : null;
    await setPassphrase(passphrase);
    const { token, expiresAt } = createSession(deviceLabel ?? undefined);
    setSessionCookie(res, token);
    res.json({ ok: true, token, expiresAt });
  });

  app.post("/api/auth/login", async (req: Request, res: Response) => {
    const ip = clientIp(req);
    if (isRateLimited(ip)) {
      return res
        .status(429)
        .json({ error: "too many failed attempts; try again later" });
    }
    if (!hasPassphrase()) {
      return res.status(400).json({ error: "no passphrase set" });
    }
    const passphrase = String(req.body?.passphrase ?? "");
    const ok = await verifyPassphrase(passphrase);
    if (!ok) {
      recordFailure(ip);
      return res.status(401).json({ error: "invalid passphrase" });
    }
    clearFailures(ip);
    const deviceLabel =
      typeof req.body?.deviceLabel === "string" && req.body.deviceLabel.trim()
        ? String(req.body.deviceLabel).slice(0, 80)
        : null;
    const { token, expiresAt } = createSession(deviceLabel ?? undefined);
    setSessionCookie(res, token);
    res.json({ ok: true, token, expiresAt });
  });

  app.post("/api/auth/logout", (req: Request, res: Response) => {
    const token = getCurrentToken(req);
    if (token) revokeSession(token);
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  app.get("/api/auth/sessions", (req: Request, res: Response) => {
    const sessions = listSessions();
    const currentToken = getCurrentToken(req);
    // Mark which session is the current one (by tokenHash compare via lookup)
    // We don't expose tokenHash; instead, set isCurrent boolean.
    const currentSession = currentToken ? validateSession(currentToken) : null;
    const currentId = currentSession?.id ?? null;
    res.json(
      sessions.map((s) => ({
        id: s.id,
        deviceLabel: s.deviceLabel,
        createdAt: s.createdAt,
        lastSeenAt: s.lastSeenAt,
        expiresAt: s.expiresAt,
        isCurrent: s.id === currentId,
      })),
    );
  });

  app.post("/api/auth/sessions/:id/revoke", (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "invalid id" });
    }
    revokeSessionById(id);
    res.json({ ok: true });
  });

  app.post("/api/auth/sessions/revoke-others", (req: Request, res: Response) => {
    const token = getCurrentToken(req) ?? undefined;
    revokeAllSessions(token);
    res.json({ ok: true });
  });

  app.post("/api/auth/passphrase", async (req: Request, res: Response) => {
    const current = String(req.body?.current ?? "");
    const next = String(req.body?.new ?? "");
    if (next.length < 8) {
      return res.status(400).json({ error: "new passphrase must be at least 8 characters" });
    }
    const ok = await verifyPassphrase(current);
    if (!ok) return res.status(401).json({ error: "current passphrase incorrect" });
    await setPassphrase(next);
    const token = getCurrentToken(req) ?? undefined;
    revokeAllSessions(token);
    res.json({ ok: true });
  });
}
