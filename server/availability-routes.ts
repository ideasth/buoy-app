// Stage 17 — routes for oliver-availability.thinhalo.com.
//
// All routes are host-guarded to "availability" by routes.ts middleware.
// Auth: token-only (no password).  Missing/wrong token → 404.
//
// Routes:
//   GET /              — HTML page (token in ?t= or cookie)
//   GET /elgin.ics     — public ICS feed (token in ?t= required; cookie not sufficient)
//   GET /assets/*      — static assets
//   Everything else    — 404

import { Router as makeRouter } from "express";
import type { Request, Response, Router } from "express";
import { requireAvailabilityAuth, checkAvailabilityToken } from "./availability-auth";
import {
  computeAvailability,
  emitPublicIcs,
  type BookableWindow,
} from "./public-calendar";
import { listPublicCalendarBlocks } from "./calendar-blocks-storage";
import { getSetting, KEY } from "./app-settings";
import { getCachedEventsForFeeds } from "./ics";
import { sharedFeedSpec, busyOnly } from "./shared-calendar";
import { storage } from "./storage";
import path from "node:path";
import fs from "node:fs";

export function makeAvailabilityRouter(): Router {
  const router = makeRouter();

  // ------------------------------------------------------------------
  // ICS endpoint — token must be in ?t= param (calendar apps don't carry cookies)
  // ------------------------------------------------------------------

  router.get("/elgin.ics", (req: Request, res: Response) => {
    if (!checkAvailabilityToken(req)) {
      return void res.status(404).send("Not Found");
    }
    servePublicIcs(req, res);
  });

  // ------------------------------------------------------------------
  // HTML page — token via ?t= or signed cookie
  // ------------------------------------------------------------------

  router.get("/", requireAvailabilityAuth, (req: Request, res: Response) => {
    const indexPath = path.resolve(__dirname, "public", "availability", "index.html");
    if (!fs.existsSync(indexPath)) {
      return void res.status(503).send("Availability app not built");
    }
    res.sendFile(indexPath);
  });

  // Static assets for the availability SPA. Vite emits a shared assets
  // dir at dist/public/assets/; the availability index.html references them
  // as `../assets/...` which resolves to /assets/<file> in the browser, so
  // we serve from the shared dir (NOT dist/public/availability/assets).
  router.get("/assets/*splat", requireAvailabilityAuth, (req: Request, res: Response) => {
    const distBase = path.resolve(__dirname, "public", "assets");
    const rel = req.path.replace(/^\/assets\//, "");
    const assetPath = path.join(distBase, rel);
    if (!assetPath.startsWith(distBase + path.sep)) return void res.status(404).send("Not Found");
    res.sendFile(assetPath, (err) => {
      if (err) res.status(404).send("Not Found");
    });
  });

  // Catch-all: any other path → 404
  router.use((_req: Request, res: Response) => {
    res.status(404).send("Not Found");
  });

  return router;
}

// ---------------------------------------------------------------------------
// Shared ICS computation helper
// ---------------------------------------------------------------------------

async function servePublicIcs(_req: Request, res: Response): Promise<void> {
  const label = getSetting(KEY.PUBLIC_CALENDAR_LABEL) ?? "Author Available (sanitised)";
  const windowJson = getSetting(KEY.PUBLIC_CALENDAR_BOOKABLE_WINDOW_JSON);
  let bookableWindow: BookableWindow = {
    mon: ["07:00", "19:00"],
    tue: ["07:00", "19:00"],
    wed: ["07:00", "19:00"],
    thu: ["07:00", "19:00"],
    fri: ["07:00", "19:00"],
    sat: ["08:00", "13:00"],
    sun: null,
  };
  if (windowJson) {
    try {
      bookableWindow = JSON.parse(windowJson);
    } catch {}
  }

  const s = storage.getSettings();
  const allFeeds: Parameters<typeof getCachedEventsForFeeds>[0] = [];
  if (s.calendar_ics_url) allFeeds.push({ url: s.calendar_ics_url });
  if (s.aupfhs_ics_url) allFeeds.push({ url: s.aupfhs_ics_url });
  if (s.shared_ics_url) allFeeds.push(sharedFeedSpec(s.shared_ics_url));

  const now = Date.now();
  const horizonMs = 12 * 7 * 24 * 60 * 60 * 1000;

  let calEvents: import("./ics").CalEvent[] = [];
  try {
    calEvents = busyOnly(await getCachedEventsForFeeds(allFeeds));
  } catch {}

  const blocks = listPublicCalendarBlocks();

  const available = computeAvailability({
    calEvents,
    blocks,
    bookableWindow,
    now,
    horizonMs,
  });

  const ics = emitPublicIcs(available, label);
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Content-Disposition", 'inline; filename="elgin.ics"');
  res.setHeader("Cache-Control", "private, max-age=300");
  res.send(ics);
}

// Export for use by apex routes that also expose the public ICS feed
export { servePublicIcs };
