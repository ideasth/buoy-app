// Free-text event parser powered by Perplexity Sonar.
//
// Takes a natural-language event description ("Coffee with Sam next Thurs 3pm
// at Higher Ground") and returns structured event fields the frontend can
// pre-fill in the Add Event dialog. The user then confirms before we persist.
//
// Uses the baked Perplexity key that already ships with the Coach page. If no
// key is available (local dev without VPS bake), the endpoint returns 503.
//
// Contract:
//   POST /api/events/parse   { text: string, referenceDate?: ISO string }
//   200  { title, start_utc, end_utc, all_day, location, notes, confidence, warnings }
//   400  { error: "text required" }
//   503  { error: "parse service unavailable" }
//   502  { error: "parse failed", details }
//
// The reference date is what the LLM should interpret "next Thursday", "tomorrow"
// etc against. Frontend sends the current Melbourne wall-clock so relative dates
// resolve correctly regardless of server timezone.

import { BAKED_PERPLEXITY_KEY } from "./baked-llm-keys";

const PERPLEXITY_URL = "https://api.perplexity.ai/chat/completions";

// Small, fast model. Free-text event parsing doesn't need deep reasoning.
const PARSE_MODEL = "sonar";

export interface ParsedEvent {
  title: string;
  start_utc: string;   // ISO 8601 UTC
  end_utc: string;     // ISO 8601 UTC
  all_day: boolean;
  location: string;
  notes: string;
  confidence: "high" | "medium" | "low";
  warnings: string[];
}

function getApiKey(): string {
  return process.env.PERPLEXITY_API_KEY || BAKED_PERPLEXITY_KEY || "";
}

function buildPrompt(text: string, referenceDate: string): string {
  return `You extract calendar event details from free text.

Reference date/time (Melbourne, Australia/Melbourne): ${referenceDate}

Interpret relative dates ("tomorrow", "next Thursday", "Friday", "in two weeks") against this reference. Assume Melbourne local time for all wall-clock times unless a timezone is explicitly stated.

Rules:
- If the text mentions no time and no all-day marker, assume 09:00 local for 1 hour.
- If it says "all day" or gives only a date, set all_day=true and use midnight-to-midnight in Melbourne time.
- If a duration is given ("for 30 min", "2 hours"), use it; else default to 60 minutes.
- title: short, imperative, no leading pronouns. Strip location and time words.
- location: the venue only ("Higher Ground", "204 Collins St"), not the whole city.
- notes: anything meaningful that isn't title/time/location (e.g. "bring the contract"). Empty string if none.
- confidence: "high" if date+time+title are all unambiguous; "medium" if the model had to pick a default; "low" if the text was very ambiguous.
- warnings: list any assumptions you made (e.g. "assumed 9am start", "guessed year=2026").

Return ONLY a JSON object with these exact keys: title, start_utc, end_utc, all_day, location, notes, confidence, warnings.
Both start_utc and end_utc MUST be ISO 8601 with a trailing Z (UTC).

Text to parse:
"""
${text}
"""`;
}

export async function parseFreeTextEvent(
  text: string,
  referenceDateIso: string,
): Promise<ParsedEvent> {
  const key = getApiKey();
  if (!key) {
    const err: any = new Error("parse service unavailable");
    err.status = 503;
    throw err;
  }

  const body = {
    model: PARSE_MODEL,
    messages: [
      {
        role: "system",
        content:
          "You are a strict JSON extractor. Return only a single JSON object, no prose, no markdown fences.",
      },
      { role: "user", content: buildPrompt(text, referenceDateIso) },
    ],
    temperature: 0.1,
    max_tokens: 400,
    disable_search: true,
    response_format: { type: "json_object" as const },
  };

  const resp = await fetch(PERPLEXITY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    const err: any = new Error(`parse failed: ${resp.status}`);
    err.status = 502;
    err.details = detail.slice(0, 500);
    throw err;
  }

  const data = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content?.trim() ?? "";
  if (!content) {
    const err: any = new Error("empty parse response");
    err.status = 502;
    throw err;
  }

  // Guard against models that wrap JSON in ```json ... ``` fences even when
  // response_format=json_object is requested.
  const stripped = content
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  let parsed: any;
  try {
    parsed = JSON.parse(stripped);
  } catch (e) {
    const err: any = new Error("model returned invalid JSON");
    err.status = 502;
    err.details = stripped.slice(0, 500);
    throw err;
  }

  // Normalise + validate.
  const out: ParsedEvent = {
    title: String(parsed.title ?? "").trim(),
    start_utc: String(parsed.start_utc ?? "").trim(),
    end_utc: String(parsed.end_utc ?? "").trim(),
    all_day: Boolean(parsed.all_day),
    location: String(parsed.location ?? "").trim(),
    notes: String(parsed.notes ?? "").trim(),
    confidence:
      parsed.confidence === "high" || parsed.confidence === "low"
        ? parsed.confidence
        : "medium",
    warnings: Array.isArray(parsed.warnings)
      ? parsed.warnings.map((w: any) => String(w).slice(0, 200))
      : [],
  };
  if (!out.title || !out.start_utc || !out.end_utc) {
    const err: any = new Error("model returned incomplete event");
    err.status = 502;
    err.details = JSON.stringify(parsed).slice(0, 500);
    throw err;
  }
  // Sanity-check ISO 8601-ish
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(out.start_utc) ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(out.end_utc)) {
    const err: any = new Error("model returned non-ISO timestamps");
    err.status = 502;
    err.details = `start=${out.start_utc} end=${out.end_utc}`;
    throw err;
  }
  return out;
}
