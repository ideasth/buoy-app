// filepath: client/src/lib/createProjectFlow.ts
// Stage 24 — pure helper for the "Add project" flow on the Projects page.
// POSTs the new project, then PATCHes the optional PMT label and ensures a
// default pmtStatus of "Active" (createProject does not set one). Kept free of
// React so it can be unit-tested with a mocked apiRequest.

import type { Project } from "@shared/schema";

type ApiRequest = (method: string, url: string, data?: unknown) => Promise<Response>;

export async function createProjectWithPmt(
  apiRequest: ApiRequest,
  input: { name: string; pmtLabel?: string },
): Promise<Project> {
  const created: Project = await (
    await apiRequest("POST", "/api/projects", { name: input.name })
  ).json();

  const patch: Record<string, unknown> = {};
  if (created.pmtStatus !== "Active") patch.pmtStatus = "Active";
  const label = (input.pmtLabel ?? "").trim();
  if (label) patch.pmtLabel = label;

  if (Object.keys(patch).length > 0) {
    await apiRequest("PATCH", `/api/projects/${created.id}`, patch);
  }
  return created;
}
