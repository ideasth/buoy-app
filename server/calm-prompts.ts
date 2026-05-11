// Stage 13 (2026-05-11) — Calm coach prompts + fallback strings.
//
// Kept in a standalone module (not coach-context.ts) so unit tests can
// import them without pulling in storage.ts (which opens the live
// data.db on import).

export const CALM_REFRAME_SYSTEM_PROMPT = `You write one short reframe for a person who has just paused, slowed their breathing, and named what is around them. Your goal is regulation, not problem solving.

Voice: calm, grounded, second-person ("you"). Australian English. No emoji. Plain prose. One short paragraph, sixty words or fewer.

Rules:
- Acknowledge the feeling they named.
- Normalise it without minimising it.
- Suggest sitting with the thought rather than fixing it.
- Do not offer steps, plans, actions, or advice.
- Do not use bullet points or numbered lists.
- Do not ask a question.
- Do not reference the breathing or grounding directly more than once.`;

export const CALM_ACKNOWLEDGE_SYSTEM_PROMPT = `You write one short acknowledgement after the user has named something they are noticing. Your only job is pacing — letting their words land before the next prompt.

Voice: calm, warm, brief. Australian English. No emoji.

Rules:
- A single sentence, fifteen words or fewer.
- Never advice. Never planning. Never a question.
- Reflect that you heard them, nothing more.
- Examples of the right register: "Thank you for naming that.", "That is a real observation.", "That sounds heavy to be carrying."`;

export function buildCalmReframeMessages(input: {
  issueLabel: string;
  preTags: string[];
  preIntensity: number;
  groundingObservations: { see: string; hear: string; feel: string };
}): Array<{ role: "system" | "user"; content: string }> {
  const lines = [
    `Issue: ${input.issueLabel}`,
    `Feeling tags: ${input.preTags.length ? input.preTags.join(", ") : "(none)"}`,
    `Intensity (0-10): ${input.preIntensity}`,
    `Grounding — see: ${input.groundingObservations.see || "(blank)"}`,
    `Grounding — hear: ${input.groundingObservations.hear || "(blank)"}`,
    `Grounding — feel: ${input.groundingObservations.feel || "(blank)"}`,
  ];
  return [
    { role: "system", content: CALM_REFRAME_SYSTEM_PROMPT },
    { role: "user", content: lines.join("\n") },
  ];
}

export function buildCalmAcknowledgeMessages(input: {
  questionLabel: string;
  userAnswer: string;
}): Array<{ role: "system" | "user"; content: string }> {
  return [
    { role: "system", content: CALM_ACKNOWLEDGE_SYSTEM_PROMPT },
    {
      role: "user",
      content: `Question: ${input.questionLabel}\nUser answer: ${input.userAnswer}`,
    },
  ];
}

export const CALM_REFRAME_FALLBACK = "You've slowed your breathing and named what's around you. That's enough for this moment. The thought you're holding doesn't need an answer right now — it needs space.";
export const CALM_ACKNOWLEDGE_FALLBACK = "Noted.";

export const CALM_REFLECTION_PROMPTS = {
  worst: "What's the worst-case story you're telling yourself right now?",
  accurate: "What's a more accurate story?",
  next: "What's one small next action that's within your control?",
} as const;

/**
 * Strip sonar-reasoning-pro's <think>...</think> reasoning preamble.
 * Mirrors the helper in coach-routes.ts so the calm endpoints can clean
 * model output without importing the route module.
 */
export function stripThinkTags(text: string): string {
  if (!text) return text;
  return text.replace(/<think>[\s\S]*?<\/think>\s*/gi, "").trim();
}
