// filepath: test/stage31-workflow.test.ts
// Stage 31 — reopen filed emails, [check] on project captures, File to
// project, and Share to Buoy page titles.

import { describe, expect, it, vi } from "vitest";
import { stripProjectCheck, fileTaskToProject, CHECK_NOTE_PREFIX, type CaptureInput } from "../server/capture";
import { withSharedTitle, isPrivateHost } from "../server/capture-tokens";
import { planMailSync, FILED_DONE } from "../server/ontime/mailsync";

describe("reopen a filed email", () => {
  it("moves it back to Inbox and re-labels it", () => {
    const plan = planMailSync(
      { source: "graph", status: "new", category: "reply_week", flag_state: "cleared", buoy_label: null, filed_folder: FILED_DONE } as any,
      { flags: true, filing: true },
    );
    expect(plan.move).toBe("inbox");
    expect(plan.label).toBe("Buoy: Reply this week");
  });
});

describe("stripProjectCheck", () => {
  const cur = { title: "Read paper", notes: `${CHECK_NOTE_PREFIX} https://x.org`, deadline: null, componentId: null, completed: 0 };
  it("strips on engagement", () => {
    expect(stripProjectCheck(cur, { componentId: 4 })).toBe("https://x.org");
    expect(stripProjectCheck(cur, { title: "Read the paper" })).toBe("https://x.org");
    expect(stripProjectCheck(cur, { completed: 1 })).toBe("https://x.org");
    expect(stripProjectCheck(cur, { notes: `${CHECK_NOTE_PREFIX} edited` })).toBe("edited");
  });
  it("leaves it alone otherwise", () => {
    expect(stripProjectCheck(cur, { orderIndex: 3 })).toBeUndefined();
    expect(stripProjectCheck(cur, { title: "Read paper" })).toBeUndefined();
    expect(stripProjectCheck({ ...cur, notes: "plain" }, { title: "x" })).toBeUndefined();
    expect(stripProjectCheck(undefined, { title: "x" })).toBeUndefined();
  });
  it("handles a bare marker", () => {
    expect(stripProjectCheck({ ...cur, notes: CHECK_NOTE_PREFIX }, { componentId: 2 })).toBe("");
  });
});

describe("fileTaskToProject", () => {
  const mk = (task: Record<string, any> | undefined) => {
    const deps = {
      getTask: vi.fn(() => task),
      getProject: vi.fn((id: number) => (id === 7 ? { id: 7, name: "Buoy" } : undefined)),
      createProjectTask: vi.fn(() => ({ id: 99 })),
      deleteTask: vi.fn(),
      recordEvent: vi.fn(),
      now: () => 1000,
    };
    return deps;
  };
  it("moves the task into the project without a [check] marker", () => {
    // 2026-11-13 06:00Z = 17:00 Melbourne on the 13th
    const d = mk({ id: 5, title: "Look at this", notes: "https://x.org", status: "todo", dueAt: Date.UTC(2026, 10, 13, 6, 0) });
    const r = fileTaskToProject(d, 5, 7);
    expect(r).toMatchObject({ ok: true, projectTaskId: 99, projectName: "Buoy" });
    const arg = (d.createProjectTask.mock.calls[0] as any[])[0];
    expect(arg).toMatchObject({ projectId: 7, title: "Look at this", notes: "https://x.org", deadline: "2026-11-13", completed: 0 });
    expect(String(arg.notes).startsWith(CHECK_NOTE_PREFIX)).toBe(false);
    expect(d.deleteTask).toHaveBeenCalledWith(5);
    expect(d.recordEvent).toHaveBeenCalledOnce();
  });
  it("rejects bad input and closed tasks", () => {
    expect(fileTaskToProject(mk(undefined), 5, 7)).toMatchObject({ ok: false, status: 404 });
    expect(fileTaskToProject(mk({ status: "todo" }), 5, 8)).toMatchObject({ ok: false, status: 404, error: "project_not_found" });
    expect(fileTaskToProject(mk({ status: "todo" }), 5, "x")).toMatchObject({ ok: false, status: 400 });
    const d = mk({ status: "done" });
    expect(fileTaskToProject(d, 5, 7)).toMatchObject({ ok: false, status: 409 });
    expect(d.deleteTask).not.toHaveBeenCalled();
  });
});

describe("Share to Buoy page titles", () => {
  const base: CaptureInput = { text: "", url: null, title: null, projectId: null, dueDate: null, domain: null, estimateMinutes: null };
  it("fetches the title when only a link is sent as text", async () => {
    const f = vi.fn(async () => "A Good Article");
    const out = await withSharedTitle({ ...base, text: "https://example.com/a" }, f);
    expect(out).toMatchObject({ text: "", url: "https://example.com/a", title: "A Good Article" });
  });
  it("uses the url field and keeps typed text", async () => {
    const out = await withSharedTitle({ ...base, text: "read later", url: "https://example.com/b" }, async () => "B");
    expect(out).toMatchObject({ text: "read later", url: "https://example.com/b", title: "B" });
  });
  it("never fetches when a title came with it, or for private hosts", async () => {
    const f = vi.fn(async () => "x");
    await withSharedTitle({ ...base, text: "https://example.com", title: "Mine" }, f);
    await withSharedTitle({ ...base, text: "http://127.0.0.1:5000/api/health" }, f);
    expect(f).not.toHaveBeenCalled();
  });
  it("keeps the link when the title can't be fetched", async () => {
    const out = await withSharedTitle({ ...base, text: "https://example.com/c" }, async () => { throw new Error("boom"); });
    expect(out).toMatchObject({ url: "https://example.com/c", title: null });
  });
  it("classifies private hosts", () => {
    for (const u of ["http://localhost/", "http://10.1.2.3/", "http://192.168.0.1/", "http://172.20.0.1/", "http://169.254.169.254/", "http://[::1]/", "http://printer.local/"]) {
      expect(isPrivateHost(u)).toBe(true);
    }
    for (const u of ["https://example.com/", "https://8.8.8.8/", "https://fcbarcelona.com/", "https://172.32.0.1/"]) {
      expect(isPrivateHost(u)).toBe(false);
    }
  });
});
