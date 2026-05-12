// Stage 14b (2026-05-12) — Relationships CRUD handlers.
//
// Pure functions over a minimal storage facade. Kept standalone so the
// HTTP-layer tests can import the handlers with a fake storage without
// booting server/storage.ts (which opens the live data.db).
//
// routes.ts wires these into express; the validation + result shapes
// are the single source of truth here.

export interface RelationshipRow {
  id: number;
  name: string;
  relationshipLabel: string;
  notes: string | null;
  active: number;
  displayOrder: number;
  userId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface RelationshipsStorageFacade {
  listAllRelationships(): RelationshipRow[];
  getActiveRelationships(): RelationshipRow[];
  getRelationship(id: number): RelationshipRow | undefined;
  createRelationship(input: {
    name: string;
    relationshipLabel: string;
    notes?: string | null;
    active?: number;
    displayOrder?: number;
    userId?: number | null;
  }): RelationshipRow;
  updateRelationship(
    id: number,
    patch: Partial<
      Pick<
        RelationshipRow,
        "name" | "relationshipLabel" | "notes" | "active" | "displayOrder"
      >
    >,
  ): RelationshipRow | undefined;
  softDeleteRelationship(id: number): RelationshipRow | undefined;
}

export type HandlerResult<T = unknown> =
  | { status: 200 | 201; body: T }
  | { status: 400 | 404; body: { error: string } };

const CREATE_ALLOWED = new Set([
  "name",
  "relationship_label",
  "notes",
  "active",
  "display_order",
]);
const PATCH_ALLOWED = CREATE_ALLOWED;

function trimOrEmpty(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function validateRequiredString(
  raw: unknown,
  field: string,
  max = 80,
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== "string") return { ok: false, error: `${field}_required` };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: `${field}_required` };
  if (trimmed.length > max) return { ok: false, error: `${field}_too_long` };
  return { ok: true, value: trimmed };
}

function validateOptionalString(
  raw: unknown,
  field: string,
  max = 80,
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== "string") return { ok: false, error: `${field}_must_be_string` };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: `${field}_required` };
  if (trimmed.length > max) return { ok: false, error: `${field}_too_long` };
  return { ok: true, value: trimmed };
}

function coerceNotes(raw: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  // null and "" both clear the field. Otherwise it must be a string ≤500.
  if (raw === null) return { ok: true, value: null };
  if (raw === undefined) return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false, error: "notes_must_be_string" };
  if (raw.length === 0) return { ok: true, value: null };
  if (raw.length > 500) return { ok: false, error: "notes_too_long" };
  return { ok: true, value: raw };
}

function coerceActive(raw: unknown): number {
  return raw ? 1 : 0;
}

function coerceDisplayOrder(
  raw: unknown,
  fallback = 0,
): { ok: true; value: number } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, value: fallback };
  if (typeof raw === "number" && Number.isInteger(raw)) {
    return { ok: true, value: raw };
  }
  // Accept JSON-style numeric strings (browsers stringify form values).
  if (typeof raw === "string" && /^-?\d+$/.test(raw.trim())) {
    return { ok: true, value: parseInt(raw, 10) };
  }
  return { ok: false, error: "display_order_must_be_integer" };
}

function rejectUnknown(
  body: Record<string, unknown>,
  allowed: Set<string>,
): { error: string } | null {
  for (const k of Object.keys(body)) {
    if (!allowed.has(k)) return { error: `unknown_field: ${k}` };
  }
  return null;
}

// -- List --------------------------------------------------------------------

export function listRelationshipsHandler(
  storage: RelationshipsStorageFacade,
  query: Record<string, unknown>,
): HandlerResult<{ relationships: RelationshipRow[] }> {
  const includeInactive =
    query.include_inactive === "1" ||
    query.include_inactive === 1 ||
    query.include_inactive === true ||
    query.include_inactive === "true";
  const rows = includeInactive
    ? storage.listAllRelationships()
    : storage.getActiveRelationships();
  return { status: 200, body: { relationships: rows } };
}

// -- Create ------------------------------------------------------------------

export function createRelationshipHandler(
  storage: RelationshipsStorageFacade,
  body: Record<string, unknown>,
): HandlerResult<{ relationship: RelationshipRow }> {
  const unknown = rejectUnknown(body, CREATE_ALLOWED);
  if (unknown) return { status: 400, body: unknown };

  const name = validateRequiredString(body.name, "name");
  if (!name.ok) return { status: 400, body: { error: name.error } };

  const label = validateRequiredString(
    body.relationship_label,
    "relationship_label",
  );
  if (!label.ok) return { status: 400, body: { error: label.error } };

  const notes = coerceNotes(body.notes);
  if (!notes.ok) return { status: 400, body: { error: notes.error } };

  const order = coerceDisplayOrder(body.display_order, 0);
  if (!order.ok) return { status: 400, body: { error: order.error } };

  // active defaults to truthy (1) for new rows when omitted. Spec says
  // "coerced to 0 or 1"; treating "missing" as 1 matches the UI default
  // ("Active" switch defaults on for new rows).
  const active = body.active === undefined ? 1 : coerceActive(body.active);

  const created = storage.createRelationship({
    name: name.value,
    relationshipLabel: label.value,
    notes: notes.value,
    active,
    displayOrder: order.value,
    userId: null,
  });
  return { status: 201, body: { relationship: created } };
}

// -- Patch -------------------------------------------------------------------

export function patchRelationshipHandler(
  storage: RelationshipsStorageFacade,
  idRaw: unknown,
  body: Record<string, unknown>,
): HandlerResult<{ relationship: RelationshipRow }> {
  const id = typeof idRaw === "number" ? idRaw : parseInt(String(idRaw ?? ""), 10);
  if (!Number.isFinite(id) || id <= 0) {
    return { status: 400, body: { error: "invalid_id" } };
  }
  const unknown = rejectUnknown(body, PATCH_ALLOWED);
  if (unknown) return { status: 400, body: unknown };

  const existing = storage.getRelationship(id);
  if (!existing) return { status: 404, body: { error: "not_found" } };

  const patch: Parameters<RelationshipsStorageFacade["updateRelationship"]>[1] = {};

  if ("name" in body) {
    const v = validateOptionalString(body.name, "name");
    if (!v.ok) return { status: 400, body: { error: v.error } };
    patch.name = v.value;
  }
  if ("relationship_label" in body) {
    const v = validateOptionalString(body.relationship_label, "relationship_label");
    if (!v.ok) return { status: 400, body: { error: v.error } };
    patch.relationshipLabel = v.value;
  }
  if ("notes" in body) {
    const v = coerceNotes(body.notes);
    if (!v.ok) return { status: 400, body: { error: v.error } };
    patch.notes = v.value;
  }
  if ("active" in body) {
    patch.active = coerceActive(body.active);
  }
  if ("display_order" in body) {
    const v = coerceDisplayOrder(body.display_order);
    if (!v.ok) return { status: 400, body: { error: v.error } };
    patch.displayOrder = v.value;
  }

  const updated = storage.updateRelationship(id, patch);
  if (!updated) return { status: 404, body: { error: "not_found" } };
  return { status: 200, body: { relationship: updated } };
}

// -- Soft delete -------------------------------------------------------------

export function deleteRelationshipHandler(
  storage: RelationshipsStorageFacade,
  idRaw: unknown,
): HandlerResult<{ relationship: RelationshipRow }> {
  const id = typeof idRaw === "number" ? idRaw : parseInt(String(idRaw ?? ""), 10);
  if (!Number.isFinite(id) || id <= 0) {
    return { status: 400, body: { error: "invalid_id" } };
  }
  const existing = storage.getRelationship(id);
  if (!existing) return { status: 404, body: { error: "not_found" } };
  const updated = storage.softDeleteRelationship(id);
  if (!updated) return { status: 404, body: { error: "not_found" } };
  return { status: 200, body: { relationship: updated } };
}
