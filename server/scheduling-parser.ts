// Stage 16 (2026-05-12) — LLM-based scheduling prompt parser.
//
// generateParsed(prompt, model?) calls the configured LLM with the prompt
// template from server/prompts/scheduling-parser.md, validates the returned
// JSON shape, clamps strings, and returns the parsed payload.
//
// Throws a SchedulingParseError on:
//   - LLM HTTP failure (502-equivalent)
//   - Malformed / non-JSON response
//   - Response that fails shape validation

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { getPerplexityAdapter } from "./llm/perplexity";

// ---- Types ------------------------------------------------------------------

export type LocationType = "online" | "in_person" | "unspecified";
export type PartOfDay = "morning" | "afternoon" | "evening";

export interface DateConstraint {
  type: "weekday" | "exact" | "relative";
  value: string;
  partOfDay: PartOfDay | null;
}

export interface TimePreference {
  partOfDay: PartOfDay;
}

export interface ParsedScheduling {
  activity: string;
  durationMinutes: number | null;
  locationType: LocationType;
  locationLabel: string | null;
  travelMinutesBefore: number;
  travelMinutesAfter: number;
  dateConstraints: DateConstraint[];
  timePreferences: TimePreference[] | null;
}

// ---- Error ------------------------------------------------------------------

export class SchedulingParseError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "SchedulingParseError";
  }
}

// ---- Prompt template --------------------------------------------------------

function loadPromptTemplate(): string {
  // Production build copies server/prompts -> dist/prompts; __dirname is dist/.
  // Dev/test runs from source via tsx; __dirname is server/.
  // Try the colocated path first, then fall back to the source tree, then to cwd.
  const candidates = [
    path.resolve(__dirname, "prompts/scheduling-parser.md"),
    path.resolve(__dirname, "../server/prompts/scheduling-parser.md"),
    path.resolve(process.cwd(), "server/prompts/scheduling-parser.md"),
    path.resolve(process.cwd(), "dist/prompts/scheduling-parser.md"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return readFileSync(p, "utf8");
  }
  throw new Error(
    `scheduling-parser prompt template not found. Tried: ${candidates.join(", ")}`,
  );
}

// ---- Validation helpers -----------------------------------------------------

const VALID_LOCATION_TYPES = new Set<LocationType>(["online", "in_person", "unspecified"]);
const VALID_PART_OF_DAY = new Set<PartOfDay>(["morning", "afternoon", "evening"]);
const VALID_DATE_TYPES = new Set(["weekday", "exact", "relative"]);

function clampString(v: unknown, max = 120): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return t.slice(0, max);
}

function coerceInt(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.round(n));
}

function validatePartOfDay(v: unknown): PartOfDay | null {
  if (typeof v === "string" && VALID_PART_OF_DAY.has(v as PartOfDay)) {
    return v as PartOfDay;
  }
  return null;
}

function validateDateConstraints(raw: unknown): DateConstraint[] {
  if (!Array.isArray(raw)) return [];
  const out: DateConstraint[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const obj = item as Record<string, unknown>;
    const type = typeof obj.type === "string" ? obj.type : "";
    if (!VALID_DATE_TYPES.has(type)) continue;
    const value = clampString(obj.value, 20);
    if (!value) continue;
    out.push({
      type: type as DateConstraint["type"],
      value: value.toLowerCase(),
      partOfDay: validatePartOfDay(obj.partOfDay),
    });
  }
  return out;
}

function validateTimePreferences(raw: unknown): TimePreference[] | null {
  if (!Array.isArray(raw)) return null;
  const out: TimePreference[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const p = validatePartOfDay((item as Record<string, unknown>).partOfDay);
    if (p) out.push({ partOfDay: p });
  }
  return out.length > 0 ? out : null;
}

function validateShape(raw: unknown): ParsedScheduling {
  if (typeof raw !== "object" || raw === null) {
    throw new SchedulingParseError("LLM returned non-object JSON");
  }
  const obj = raw as Record<string, unknown>;

  const activity = clampString(obj.activity, 80) ?? "meeting";

  const durationRaw = coerceInt(obj.durationMinutes);
  const durationMinutes = durationRaw !== null && durationRaw > 0 ? durationRaw : null;

  const locationType: LocationType = VALID_LOCATION_TYPES.has(
    obj.locationType as LocationType,
  )
    ? (obj.locationType as LocationType)
    : "unspecified";

  const locationLabel = clampString(obj.locationLabel, 80);

  const travelBefore = coerceInt(obj.travelMinutesBefore) ?? 0;
  const travelAfter = coerceInt(obj.travelMinutesAfter) ?? 0;

  const dateConstraints = validateDateConstraints(obj.dateConstraints);
  const timePreferences = validateTimePreferences(obj.timePreferences);

  return {
    activity,
    durationMinutes,
    locationType,
    locationLabel,
    travelMinutesBefore: travelBefore,
    travelMinutesAfter: travelAfter,
    dateConstraints,
    timePreferences,
  };
}

// ---- Main export ------------------------------------------------------------

const DEFAULT_PARSER_MODEL = "sonar-pro";

export async function generateParsed(
  prompt: string,
  model: string = DEFAULT_PARSER_MODEL,
): Promise<ParsedScheduling> {
  const template = loadPromptTemplate();
  const systemPrompt = template.trimEnd();

  const llm = getPerplexityAdapter();

  let fullText: string;
  try {
    const result = await llm.complete({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt.trim() },
      ],
      temperature: 0,
      maxTokens: 600,
      disableSearch: true,
    });
    fullText = result.fullText.trim();
  } catch (err) {
    throw new SchedulingParseError(
      `LLM call failed: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }

  // Strip any markdown fences the model may have added despite instructions.
  const cleaned = fullText
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new SchedulingParseError(
      `LLM returned non-JSON: ${cleaned.slice(0, 200)}`,
      err,
    );
  }

  return validateShape(parsed);
}
