// filepath: test/add-project-flow.test.ts
// Stage 24 — Add-project flow (POST + PATCH) helper tests with a mocked API.

import { describe, expect, it, vi } from "vitest";
import { createProjectWithPmt } from "../client/src/lib/createProjectFlow";

type Call = { method: string; url: string; body?: unknown };

// Build a fake apiRequest that records calls and returns the given POST body.
function makeApi(createdProject: any) {
  const calls: Call[] = [];
  const apiRequest = vi.fn(async (method: string, url: string, body?: unknown) => {
    calls.push({ method, url, body });
    const payload = method === "POST" ? createdProject : {};
    return { json: async () => payload } as unknown as Response;
  });
  return { apiRequest, calls };
}

describe("createProjectWithPmt", () => {
  it("POSTs the name then PATCHes pmtStatus Active + pmtLabel when a label is given", async () => {
    const { apiRequest, calls } = makeApi({ id: 42, pmtStatus: null });
    const created = await createProjectWithPmt(apiRequest, { name: "New thing", pmtLabel: "Bayside Health" });

    expect(created.id).toBe(42);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ method: "POST", url: "/api/projects", body: { name: "New thing" } });
    expect(calls[1].method).toBe("PATCH");
    expect(calls[1].url).toBe("/api/projects/42");
    expect(calls[1].body).toEqual({ pmtStatus: "Active", pmtLabel: "Bayside Health" });
  });

  it("PATCHes only pmtStatus Active when no label is given", async () => {
    const { apiRequest, calls } = makeApi({ id: 7, pmtStatus: null });
    await createProjectWithPmt(apiRequest, { name: "Solo" });
    expect(calls).toHaveLength(2);
    expect(calls[1].body).toEqual({ pmtStatus: "Active" });
  });

  it("trims whitespace-only labels to nothing (no pmtLabel in PATCH)", async () => {
    const { apiRequest, calls } = makeApi({ id: 9, pmtStatus: null });
    await createProjectWithPmt(apiRequest, { name: "Trim", pmtLabel: "   " });
    expect(calls[1].body).toEqual({ pmtStatus: "Active" });
  });

  it("skips the PATCH entirely when POST already returns Active and no label", async () => {
    const { apiRequest, calls } = makeApi({ id: 5, pmtStatus: "Active" });
    await createProjectWithPmt(apiRequest, { name: "AlreadyActive" });
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("POST");
  });

  it("still PATCHes the label when POST returns Active", async () => {
    const { apiRequest, calls } = makeApi({ id: 6, pmtStatus: "Active" });
    await createProjectWithPmt(apiRequest, { name: "WithLabel", pmtLabel: "Epworth" });
    expect(calls).toHaveLength(2);
    expect(calls[1].body).toEqual({ pmtLabel: "Epworth" });
  });
});
