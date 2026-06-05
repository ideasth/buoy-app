import "dotenv/config";
import express, { Response, NextFunction } from 'express';
import type { Request } from 'express';
import cookieParser from "cookie-parser";
import { registerRoutes } from "./routes";
import { registerAuthRoutes } from "./auth-routes";
import { requireAuth } from "./auth";
import { serveStatic } from "./static";
import { createServer } from "node:http";
import { recordError } from "./error-buffer";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Register auth routes (allowlisted) and the auth gate first.
  registerAuthRoutes(app);
  app.use(requireAuth);

  await registerRoutes(httpServer, app);

  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    // H-lite: capture into in-memory ring buffer for /api/admin/recent-errors.
    // Best-effort; never throw out of the error handler.
    try {
      recordError({
        err,
        statusCode: status,
        method: req.method,
        path: req.originalUrl || req.url,
      });
    } catch {
      // swallow — recordError must never break the response
    }

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // Bind to 127.0.0.1 by default so the port is only reachable via the
  // local Caddy reverse proxy. Set HOST=0.0.0.0 in the environment to
  // override (e.g. when running inside a container that needs external
  // reachability).
  const port = parseInt(process.env.PORT || "5000", 10);
  const host = process.env.HOST ?? "127.0.0.1";
  httpServer.listen(
    {
      port,
      host,
      reusePort: true,
    },
    () => {
      log(`serving on ${host}:${port}`);
    },
  );
})();
