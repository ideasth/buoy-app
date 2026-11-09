// Availability hostname authentication (split out of the retired family-auth
// module, 9 Nov 2026). Token URL (?t=) sets a signed cookie for the HTML page;
// the ICS feed must re-supply ?t= each time.

import type { Request, Response, NextFunction } from "express";
import { createHmac } from "node:crypto";
import { getSetting, KEY } from "./app-settings";

const IS_PROD = process.env.NODE_ENV === "production";
const AVAIL_COOKIE_MAX_AGE = 365 * 24 * 60 * 60 * 1000; // 1 year in ms

// Middleware: require availability token.
// Returns 404 (not 401) on missing/wrong token to not advertise the endpoint.
export function requireAvailabilityAuth(req: Request, res: Response, next: NextFunction): void {
  const publicEnabled = getSetting(KEY.PUBLIC_CALENDAR_ENABLED) === "1";
  if (!publicEnabled) {
    return void res.status(404).send("Not Found");
  }

  const storedToken = getSetting(KEY.PUBLIC_CALENDAR_TOKEN) ?? "";

  // Check ?t= param
  const tokenParam = (req.query?.t as string | undefined) ?? "";
  if (tokenParam && storedToken && tokenParam === storedToken) {
    // Set signed cookie for subsequent requests
    const signed = signAvailCookie(tokenParam);
    res.cookie(AVAIL_COOKIE_NAME, signed, {
      httpOnly: true,
      secure: IS_PROD,
      sameSite: IS_PROD ? "none" : "lax",
      path: "/",
      maxAge: AVAIL_COOKIE_MAX_AGE,
    });
    return next();
  }

  // Check cookie (HTML page only — ICS must re-supply ?t= each time)
  const cookieVal = (req.cookies as Record<string, string>)[AVAIL_COOKIE_NAME];
  if (cookieVal && verifyAvailCookie(cookieVal, storedToken)) {
    return next();
  }

  return void res.status(404).send("Not Found");
}

// Availability cookie (same signing pattern)
export const AVAIL_COOKIE_NAME = IS_PROD ? "__Host-buoy-avail-sid" : "buoy-avail-sid";

function signAvailCookie(token: string): string {
  const sig = createHmac("sha256", token).update("avail").digest("base64url");
  return `avail.${sig}`;
}

function verifyAvailCookie(raw: string, storedToken: string): boolean {
  if (!storedToken) return false;
  const expected = signAvailCookie(storedToken);
  if (raw.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < raw.length; i++) diff |= raw.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

// ICS-only token check (no cookie — calendar apps don't carry cookies)
export function checkAvailabilityToken(req: Request): boolean {
  const storedToken = getSetting(KEY.PUBLIC_CALENDAR_TOKEN) ?? "";
  if (!storedToken) return false;
  const t = (req.query?.t as string | undefined) ?? "";
  return t === storedToken;
}
