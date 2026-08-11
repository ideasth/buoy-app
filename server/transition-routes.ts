// Stage 24 — HTTP routes for the Relationship Transition module.
//
// Auth: requireAuth is applied globally in server/index.ts, so we do not
// re-attach it per-route here.

import type { Express, Request, Response, NextFunction } from "express";
import express from "express";
import {
  buildTransitionExport,
  createTransitionAction,
  createTransitionFinancial,
  createTransitionIt,
  createTransitionLedgerEntry,
  deleteTransitionAction,
  deleteTransitionFinancial,
  deleteTransitionIt,
  deleteTransitionLedgerEntry,
  getTransitionAction,
  getTransitionFinancial,
  getTransitionIt,
  getTransitionLedgerEntry,
  getTransitionState,
  getTransitionSummary,
  listTransitionActions,
  listTransitionFinancial,
  listTransitionIt,
  listTransitionLedger,
  patchTransitionAction,
  patchTransitionFinancial,
  patchTransitionIt,
  patchTransitionLedgerEntry,
  patchTransitionState,
} from "./transition-storage";
import type { TransitionExportAudience } from "@shared/schema";

function sendErr(res: Response, err: any) {
  const status = typeof err?.status === "number" ? err.status : 500;
  const code = typeof err?.code === "string" ? err.code : "internal_error";
  const message = typeof err?.message === "string" ? err.message : "internal_error";
  res.status(status).json({ error: code, message });
}

function parseId(req: Request): number | null {
  const raw = req.params.id;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function registerTransitionRoutes(app: Express): void {
  const json = express.json({ limit: "1mb" });

  // ---- state ----
  app.get("/api/transition/state", (_req, res) => {
    try {
      res.json(getTransitionState());
    } catch (err) {
      sendErr(res, err);
    }
  });

  app.patch("/api/transition/state", json, (req, res) => {
    try {
      res.json(patchTransitionState(req.body ?? {}));
    } catch (err) {
      sendErr(res, err);
    }
  });

  // ---- actions ----
  app.get("/api/transition/actions", (req, res) => {
    try {
      res.json(
        listTransitionActions({
          horizon: typeof req.query.horizon === "string" ? req.query.horizon : undefined,
          area: typeof req.query.area === "string" ? req.query.area : undefined,
          status: typeof req.query.status === "string" ? req.query.status : undefined,
        }),
      );
    } catch (err) {
      sendErr(res, err);
    }
  });

  app.post("/api/transition/actions", json, (req, res) => {
    try {
      const row = createTransitionAction(req.body ?? {});
      res.status(201).json(row);
    } catch (err) {
      sendErr(res, err);
    }
  });

  app.get("/api/transition/actions/:id", (req, res) => {
    const id = parseId(req);
    if (id == null) return sendErr(res, Object.assign(new Error("invalid_id"), { status: 400, code: "invalid_id" }));
    const row = getTransitionAction(id);
    if (!row) return res.status(404).json({ error: "not_found" });
    res.json(row);
  });

  app.patch("/api/transition/actions/:id", json, (req, res) => {
    const id = parseId(req);
    if (id == null) return sendErr(res, Object.assign(new Error("invalid_id"), { status: 400, code: "invalid_id" }));
    try {
      const row = patchTransitionAction(id, req.body ?? {});
      if (!row) return res.status(404).json({ error: "not_found" });
      res.json(row);
    } catch (err) {
      sendErr(res, err);
    }
  });

  app.delete("/api/transition/actions/:id", (req, res) => {
    const id = parseId(req);
    if (id == null) return sendErr(res, Object.assign(new Error("invalid_id"), { status: 400, code: "invalid_id" }));
    const ok = deleteTransitionAction(id);
    if (!ok) return res.status(404).json({ error: "not_found" });
    res.status(204).end();
  });

  // ---- ledger ----
  app.get("/api/transition/ledger", (req, res) => {
    try {
      res.json(
        listTransitionLedger({
          recordType: typeof req.query.recordType === "string" ? req.query.recordType : undefined,
          category: typeof req.query.category === "string" ? req.query.category : undefined,
          perspective: typeof req.query.perspective === "string" ? req.query.perspective : undefined,
          confidentiality:
            typeof req.query.confidentiality === "string" ? req.query.confidentiality : undefined,
        }),
      );
    } catch (err) {
      sendErr(res, err);
    }
  });

  app.post("/api/transition/ledger", json, (req, res) => {
    try {
      const row = createTransitionLedgerEntry(req.body ?? {});
      res.status(201).json(row);
    } catch (err) {
      sendErr(res, err);
    }
  });

  app.get("/api/transition/ledger/:id", (req, res) => {
    const id = parseId(req);
    if (id == null) return sendErr(res, Object.assign(new Error("invalid_id"), { status: 400, code: "invalid_id" }));
    const row = getTransitionLedgerEntry(id);
    if (!row) return res.status(404).json({ error: "not_found" });
    res.json(row);
  });

  app.patch("/api/transition/ledger/:id", json, (req, res) => {
    const id = parseId(req);
    if (id == null) return sendErr(res, Object.assign(new Error("invalid_id"), { status: 400, code: "invalid_id" }));
    try {
      const row = patchTransitionLedgerEntry(id, req.body ?? {});
      if (!row) return res.status(404).json({ error: "not_found" });
      res.json(row);
    } catch (err) {
      sendErr(res, err);
    }
  });

  app.delete("/api/transition/ledger/:id", (req, res) => {
    const id = parseId(req);
    if (id == null) return sendErr(res, Object.assign(new Error("invalid_id"), { status: 400, code: "invalid_id" }));
    const ok = deleteTransitionLedgerEntry(id);
    if (!ok) return res.status(404).json({ error: "not_found" });
    res.status(204).end();
  });

  // ---- financial ----
  app.get("/api/transition/financial", (req, res) => {
    try {
      res.json(
        listTransitionFinancial({
          category: typeof req.query.category === "string" ? req.query.category : undefined,
          direction: typeof req.query.direction === "string" ? req.query.direction : undefined,
        }),
      );
    } catch (err) {
      sendErr(res, err);
    }
  });

  app.post("/api/transition/financial", json, (req, res) => {
    try {
      const row = createTransitionFinancial(req.body ?? {});
      res.status(201).json(row);
    } catch (err) {
      sendErr(res, err);
    }
  });

  app.get("/api/transition/financial/:id", (req, res) => {
    const id = parseId(req);
    if (id == null) return sendErr(res, Object.assign(new Error("invalid_id"), { status: 400, code: "invalid_id" }));
    const row = getTransitionFinancial(id);
    if (!row) return res.status(404).json({ error: "not_found" });
    res.json(row);
  });

  app.patch("/api/transition/financial/:id", json, (req, res) => {
    const id = parseId(req);
    if (id == null) return sendErr(res, Object.assign(new Error("invalid_id"), { status: 400, code: "invalid_id" }));
    try {
      const row = patchTransitionFinancial(id, req.body ?? {});
      if (!row) return res.status(404).json({ error: "not_found" });
      res.json(row);
    } catch (err) {
      sendErr(res, err);
    }
  });

  app.delete("/api/transition/financial/:id", (req, res) => {
    const id = parseId(req);
    if (id == null) return sendErr(res, Object.assign(new Error("invalid_id"), { status: 400, code: "invalid_id" }));
    const ok = deleteTransitionFinancial(id);
    if (!ok) return res.status(404).json({ error: "not_found" });
    res.status(204).end();
  });

  // ---- IT handover ----
  app.get("/api/transition/it-handover", (_req, res) => {
    try {
      res.json(listTransitionIt());
    } catch (err) {
      sendErr(res, err);
    }
  });

  app.post("/api/transition/it-handover", json, (req, res) => {
    try {
      const row = createTransitionIt(req.body ?? {});
      res.status(201).json(row);
    } catch (err) {
      sendErr(res, err);
    }
  });

  app.get("/api/transition/it-handover/:id", (req, res) => {
    const id = parseId(req);
    if (id == null) return sendErr(res, Object.assign(new Error("invalid_id"), { status: 400, code: "invalid_id" }));
    const row = getTransitionIt(id);
    if (!row) return res.status(404).json({ error: "not_found" });
    res.json(row);
  });

  app.patch("/api/transition/it-handover/:id", json, (req, res) => {
    const id = parseId(req);
    if (id == null) return sendErr(res, Object.assign(new Error("invalid_id"), { status: 400, code: "invalid_id" }));
    try {
      const row = patchTransitionIt(id, req.body ?? {});
      if (!row) return res.status(404).json({ error: "not_found" });
      res.json(row);
    } catch (err) {
      sendErr(res, err);
    }
  });

  app.delete("/api/transition/it-handover/:id", (req, res) => {
    const id = parseId(req);
    if (id == null) return sendErr(res, Object.assign(new Error("invalid_id"), { status: 400, code: "invalid_id" }));
    const ok = deleteTransitionIt(id);
    if (!ok) return res.status(404).json({ error: "not_found" });
    res.status(204).end();
  });

  // ---- summary + export ----
  app.get("/api/transition/summary", (_req, res) => {
    try {
      res.json(getTransitionSummary());
    } catch (err) {
      sendErr(res, err);
    }
  });

  app.post("/api/transition/export", json, (req, res) => {
    try {
      const audience = (req.body?.audience ?? "").toString() as TransitionExportAudience;
      const bundle = buildTransitionExport(audience);
      res.json(bundle);
    } catch (err) {
      sendErr(res, err);
    }
  });
}
