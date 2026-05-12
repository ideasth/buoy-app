// Stage 14b (2026-05-12) — Relationships CRUD route handler tests.
//
// Pure hermetic tests over the route handlers in
// server/relationships-handlers.ts. A fake storage implements the
// RelationshipsStorageFacade interface so the tests run without
// booting server/storage.ts (which would open the live data.db).

import { beforeEach, describe, expect, it } from "vitest";
import {
  listRelationshipsHandler,
  createRelationshipHandler,
  patchRelationshipHandler,
  deleteRelationshipHandler,
  type RelationshipRow,
  type RelationshipsStorageFacade,
} from "../server/relationships-handlers";

class FakeStorage implements RelationshipsStorageFacade {
  rows: RelationshipRow[] = [];
  nextId = 1;
  listAllRelationships(): RelationshipRow[] {
    return [...this.rows].sort((a, b) => {
      if (a.displayOrder !== b.displayOrder) return a.displayOrder - b.displayOrder;
      return a.id - b.id;
    });
  }
  getActiveRelationships(): RelationshipRow[] {
    return this.listAllRelationships().filter((r) => r.active === 1);
  }
  getRelationship(id: number): RelationshipRow | undefined {
    return this.rows.find((r) => r.id === id);
  }
  createRelationship(input: {
    name: string;
    relationshipLabel: string;
    notes?: string | null;
    active?: number;
    displayOrder?: number;
    userId?: number | null;
  }): RelationshipRow {
    const now = new Date().toISOString();
    const row: RelationshipRow = {
      id: this.nextId++,
      name: input.name,
      relationshipLabel: input.relationshipLabel,
      notes: input.notes ?? null,
      active: input.active ?? 1,
      displayOrder: input.displayOrder ?? 0,
      userId: input.userId ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.push(row);
    return row;
  }
  updateRelationship(
    id: number,
    patch: Partial<
      Pick<
        RelationshipRow,
        "name" | "relationshipLabel" | "notes" | "active" | "displayOrder"
      >
    >,
  ): RelationshipRow | undefined {
    const row = this.rows.find((r) => r.id === id);
    if (!row) return undefined;
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.relationshipLabel !== undefined)
      row.relationshipLabel = patch.relationshipLabel;
    if (patch.notes !== undefined) row.notes = patch.notes;
    if (patch.active !== undefined) row.active = patch.active;
    if (patch.displayOrder !== undefined) row.displayOrder = patch.displayOrder;
    row.updatedAt = new Date().toISOString();
    return row;
  }
  softDeleteRelationship(id: number): RelationshipRow | undefined {
    return this.updateRelationship(id, { active: 0 });
  }
}

function seedAuthorRows(s: FakeStorage) {
  s.createRelationship({
    name: "Marieke",
    relationshipLabel: "partner",
    displayOrder: 0,
  });
  s.createRelationship({
    name: "Hilde",
    relationshipLabel: "daughter",
    displayOrder: 1,
  });
  s.createRelationship({
    name: "Axel",
    relationshipLabel: "son",
    displayOrder: 2,
  });
}

describe("GET /api/relationships", () => {
  let storage: FakeStorage;
  beforeEach(() => {
    storage = new FakeStorage();
    seedAuthorRows(storage);
  });

  it("returns active rows only by default", () => {
    storage.softDeleteRelationship(2); // Hide Hilde
    const res = listRelationshipsHandler(storage, {});
    expect(res.status).toBe(200);
    expect(res.status === 200 ? res.body.relationships.map((r) => r.name) : null).toEqual([
      "Marieke",
      "Axel",
    ]);
  });

  it("returns all rows including inactive when include_inactive=1", () => {
    storage.softDeleteRelationship(2);
    const res = listRelationshipsHandler(storage, { include_inactive: "1" });
    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    expect(res.body.relationships.map((r) => r.name)).toEqual([
      "Marieke",
      "Hilde",
      "Axel",
    ]);
    expect(res.body.relationships.find((r) => r.id === 2)?.active).toBe(0);
  });

  it("returns rows ordered by display_order then id", () => {
    const s = new FakeStorage();
    s.createRelationship({ name: "C", relationshipLabel: "x", displayOrder: 5 });
    s.createRelationship({ name: "A", relationshipLabel: "x", displayOrder: 1 });
    s.createRelationship({ name: "B", relationshipLabel: "x", displayOrder: 1 });
    const res = listRelationshipsHandler(s, {});
    if (res.status !== 200) throw new Error("unexpected status");
    expect(res.body.relationships.map((r) => r.name)).toEqual(["A", "B", "C"]);
  });
});

describe("POST /api/relationships", () => {
  let storage: FakeStorage;
  beforeEach(() => {
    storage = new FakeStorage();
  });

  it("creates a row on a happy-path body and returns 201", () => {
    const res = createRelationshipHandler(storage, {
      name: "Sam",
      relationship_label: "colleague",
      notes: "co-lead on Project ABC",
      display_order: 3,
    });
    expect(res.status).toBe(201);
    if (res.status !== 201) return;
    expect(res.body.relationship.id).toBeGreaterThan(0);
    expect(res.body.relationship.name).toBe("Sam");
    expect(res.body.relationship.relationshipLabel).toBe("colleague");
    expect(res.body.relationship.active).toBe(1);
    expect(res.body.relationship.displayOrder).toBe(3);
    expect(res.body.relationship.notes).toBe("co-lead on Project ABC");
  });

  it("trims whitespace from name and relationship_label", () => {
    const res = createRelationshipHandler(storage, {
      name: "  Pat  ",
      relationship_label: "  friend  ",
    });
    expect(res.status).toBe(201);
    if (res.status !== 201) return;
    expect(res.body.relationship.name).toBe("Pat");
    expect(res.body.relationship.relationshipLabel).toBe("friend");
  });

  it("returns 400 when name is empty after trim", () => {
    const res = createRelationshipHandler(storage, {
      name: "   ",
      relationship_label: "friend",
    });
    expect(res.status).toBe(400);
    if (res.status !== 400) return;
    expect(res.body.error).toBe("name_required");
  });

  it("returns 400 when relationship_label is missing", () => {
    const res = createRelationshipHandler(storage, { name: "Sam" });
    expect(res.status).toBe(400);
    if (res.status !== 400) return;
    expect(res.body.error).toBe("relationship_label_required");
  });

  it("returns 400 for an unknown body field", () => {
    const res = createRelationshipHandler(storage, {
      name: "Sam",
      relationship_label: "friend",
      colour: "blue",
    });
    expect(res.status).toBe(400);
    if (res.status !== 400) return;
    expect(res.body.error).toBe("unknown_field: colour");
  });

  it("rejects an over-long name (> 80 chars)", () => {
    const res = createRelationshipHandler(storage, {
      name: "x".repeat(81),
      relationship_label: "friend",
    });
    expect(res.status).toBe(400);
    if (res.status !== 400) return;
    expect(res.body.error).toBe("name_too_long");
  });

  it("rejects over-long notes (> 500 chars)", () => {
    const res = createRelationshipHandler(storage, {
      name: "Sam",
      relationship_label: "friend",
      notes: "x".repeat(501),
    });
    expect(res.status).toBe(400);
    if (res.status !== 400) return;
    expect(res.body.error).toBe("notes_too_long");
  });

  it("treats empty-string notes as null (clearing the field)", () => {
    const res = createRelationshipHandler(storage, {
      name: "Sam",
      relationship_label: "friend",
      notes: "",
    });
    expect(res.status).toBe(201);
    if (res.status !== 201) return;
    expect(res.body.relationship.notes).toBeNull();
  });

  it("accepts negative display_order (useful for top-pinning)", () => {
    const res = createRelationshipHandler(storage, {
      name: "Sam",
      relationship_label: "friend",
      display_order: -5,
    });
    expect(res.status).toBe(201);
    if (res.status !== 201) return;
    expect(res.body.relationship.displayOrder).toBe(-5);
  });

  it("coerces truthy active values to 1 and falsy to 0", () => {
    const a = createRelationshipHandler(storage, {
      name: "A",
      relationship_label: "x",
      active: 0,
    });
    const b = createRelationshipHandler(storage, {
      name: "B",
      relationship_label: "x",
      active: true,
    });
    if (a.status !== 201 || b.status !== 201) throw new Error("unexpected");
    expect(a.body.relationship.active).toBe(0);
    expect(b.body.relationship.active).toBe(1);
  });
});

describe("PATCH /api/relationships/:id", () => {
  let storage: FakeStorage;
  beforeEach(() => {
    storage = new FakeStorage();
    seedAuthorRows(storage);
  });

  it("returns 404 when the row does not exist", () => {
    const res = patchRelationshipHandler(storage, "999", { name: "Z" });
    expect(res.status).toBe(404);
    if (res.status !== 404) return;
    expect(res.body.error).toBe("not_found");
  });

  it("returns 400 for an unknown body field", () => {
    const res = patchRelationshipHandler(storage, 1, { colour: "blue" });
    expect(res.status).toBe(400);
    if (res.status !== 400) return;
    expect(res.body.error).toBe("unknown_field: colour");
  });

  it("returns 400 when patching name to empty string", () => {
    const res = patchRelationshipHandler(storage, 1, { name: "  " });
    expect(res.status).toBe(400);
    if (res.status !== 400) return;
    expect(res.body.error).toBe("name_required");
  });

  it("patches the row and refreshes the row through the storage facade", () => {
    const before = storage.getRelationship(1)!;
    const res = patchRelationshipHandler(storage, 1, {
      notes: "a quick note",
      display_order: 7,
    });
    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    expect(res.body.relationship.notes).toBe("a quick note");
    expect(res.body.relationship.displayOrder).toBe(7);
    // Identity: PATCH returns the updated row, not a copy of the pre-edit
    // snapshot. Use the changed fields as proof rather than the
    // timestamp, which can land in the same millisecond in fast tests.
    expect(res.body.relationship.id).toBe(before.id);
    expect(res.body.relationship.name).toBe(before.name);
  });

  it("soft-deletes when active=0 is patched, removing the row from active-only GET", () => {
    const res = patchRelationshipHandler(storage, 2, { active: 0 });
    expect(res.status).toBe(200);
    const list = listRelationshipsHandler(storage, {});
    if (list.status !== 200) throw new Error("unexpected");
    expect(list.body.relationships.find((r) => r.id === 2)).toBeUndefined();
    const listAll = listRelationshipsHandler(storage, {
      include_inactive: "1",
    });
    if (listAll.status !== 200) throw new Error("unexpected");
    expect(listAll.body.relationships.find((r) => r.id === 2)?.active).toBe(0);
  });

  it("re-activates via active=1 after a soft-delete", () => {
    storage.softDeleteRelationship(2);
    const res = patchRelationshipHandler(storage, 2, { active: 1 });
    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    expect(res.body.relationship.active).toBe(1);
    const list = listRelationshipsHandler(storage, {});
    if (list.status !== 200) throw new Error("unexpected");
    expect(list.body.relationships.map((r) => r.id)).toContain(2);
  });

  it("clears notes when passed null or empty string", () => {
    storage.updateRelationship(1, { notes: "something" });
    const a = patchRelationshipHandler(storage, 1, { notes: null });
    expect(a.status).toBe(200);
    if (a.status !== 200) return;
    expect(a.body.relationship.notes).toBeNull();
    storage.updateRelationship(1, { notes: "something" });
    const b = patchRelationshipHandler(storage, 1, { notes: "" });
    expect(b.status).toBe(200);
    if (b.status !== 200) return;
    expect(b.body.relationship.notes).toBeNull();
  });
});

describe("DELETE /api/relationships/:id", () => {
  let storage: FakeStorage;
  beforeEach(() => {
    storage = new FakeStorage();
    seedAuthorRows(storage);
  });

  it("soft-deletes (active=0) and returns the row", () => {
    const res = deleteRelationshipHandler(storage, 2);
    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    expect(res.body.relationship.id).toBe(2);
    expect(res.body.relationship.active).toBe(0);
    // Row is still present in storage; just inactive.
    expect(storage.getRelationship(2)?.active).toBe(0);
  });

  it("returns 404 for a missing id", () => {
    const res = deleteRelationshipHandler(storage, "999");
    expect(res.status).toBe(404);
    if (res.status !== 404) return;
    expect(res.body.error).toBe("not_found");
  });

  it("returns 400 for an invalid id", () => {
    const res = deleteRelationshipHandler(storage, "not-a-number");
    expect(res.status).toBe(400);
    if (res.status !== 400) return;
    expect(res.body.error).toBe("invalid_id");
  });

  it("a soft-deleted row no longer appears in the active-only list", () => {
    deleteRelationshipHandler(storage, 2);
    const list = listRelationshipsHandler(storage, {});
    if (list.status !== 200) throw new Error("unexpected");
    expect(list.body.relationships.map((r) => r.name)).toEqual([
      "Marieke",
      "Axel",
    ]);
  });
});
