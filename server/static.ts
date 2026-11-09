import express from 'express';
import type { Express, Request, Response, NextFunction } from 'express';
import fs from "node:fs";
import path from "node:path";
import { classifyHost } from "./hostname-router";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  // Stage 17: serve the availability sub-SPA on its hostname. (The family
  // sub-SPA was retired on 9 Nov 2026.)
  const availDist = path.join(distPath, "availability");

  app.use((req: Request, res: Response, next: NextFunction) => {
    const kind = classifyHost(req.hostname);
    if (kind === "availability" && fs.existsSync(availDist)) {
      express.static(availDist)(req, res, next);
    } else {
      next();
    }
  });

  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
  app.use("/{*path}", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
