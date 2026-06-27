import { z } from "zod";

/**
 * An intermediate, LLM-friendly representation of a journey. The model targets
 * this schema (via structured output) rather than the canonical
 * {@link JourneyDefinition}, because the canonical format wires nodes together
 * with opaque `child` id pointers that are error prone for a model to produce.
 *
 * Two representations live here:
 *  - The **loose** schema ({@link looseJourneyPlanSchema}) is what we hand to
 *    the LLM. It is deliberately union-free and non-recursive: a single object
 *    shape with an enum `type` discriminator plus optional per-variant fields.
 *    This is required because Gemini's structured output (`responseSchema`) does
 *    not reliably honour discriminated unions (`anyOf` with `const`), which
 *    causes the model to invent its own field/enum names.
 *  - The **strict** schema ({@link journeyAiPlanSchema}) is the validated,
 *    discriminated form the rest of the code (and {@link compileJourneyPlan})
 *    consumes. {@link normalizeLoosePlan} maps loose → strict, dropping any
 *    steps that are missing the fields their type requires.
 */

export const AI_JOURNEY_CHANNELS = [
  "Email",
  "Sms",
  "Webhook",
  "MobilePush",
] as const;

// ---------------------------------------------------------------------------
// Strict, discriminated representation (internal — used by the compiler).
// ---------------------------------------------------------------------------

export const leafJourneyStepSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("message"),
    channel: z.enum(AI_JOURNEY_CHANNELS),
    templateId: z.string(),
    name: z.string().optional(),
  }),
  z.object({
    type: z.literal("delay"),
    seconds: z.number().int().positive(),
  }),
  z.object({
    type: z.literal("waitForSegment"),
    segmentId: z.string(),
    timeoutSeconds: z.number().int().positive(),
  }),
]);

export type LeafJourneyStep = z.infer<typeof leafJourneyStepSchema>;

export const journeyStepSchema = z.union([
  leafJourneyStepSchema,
  z.object({
    type: z.literal("segmentSplit"),
    segmentId: z.string(),
    trueSteps: z.array(leafJourneyStepSchema),
    falseSteps: z.array(leafJourneyStepSchema),
  }),
]);

export type JourneyStep = z.infer<typeof journeyStepSchema>;

export const journeyEntrySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("segment"), segmentId: z.string() }),
  z.object({
    type: z.literal("event"),
    event: z.string(),
    key: z.string().optional(),
  }),
]);

export type JourneyEntry = z.infer<typeof journeyEntrySchema>;

export const journeyAiPlanSchema = z.object({
  name: z.string(),
  entry: journeyEntrySchema,
  steps: z.array(journeyStepSchema),
});

export type JourneyAiPlan = z.infer<typeof journeyAiPlanSchema>;

// ---------------------------------------------------------------------------
// Loose representation (what the LLM produces).
//
// This schema must be PERMISSIVE: Gemini's structured output ignores "optional"
// and tends to populate every field it sees (with 0 / "" / nested arrays). So:
//  - no numeric refinements (`.int()`, `.positive()`) — the AI SDK validates the
//    raw model output against this schema, and a stray `0` would fail it;
//  - no branching surface (`trueSteps`/`falseSteps`) — exposing those just
//    invites the model to nest steps and silently lose them. v1 journeys are
//    linear; segmentSplit support remains in the compiler for a later iteration.
// All cleanup (dropping irrelevant/invalid fields per step type, enforcing
// positivity) happens in {@link normalizeLoosePlan}.
// ---------------------------------------------------------------------------

export const LEAF_STEP_TYPES = ["message", "delay", "waitForSegment"] as const;
export const ENTRY_KINDS = ["segment", "event"] as const;

export type PlanChannel = (typeof AI_JOURNEY_CHANNELS)[number];

export function planChannelFromString(value: string): PlanChannel | undefined {
  return AI_JOURNEY_CHANNELS.find((channel) => channel === value);
}

const looseLeafStepSchema = z.object({
  type: z.enum(LEAF_STEP_TYPES),
  // message
  channel: z.enum(AI_JOURNEY_CHANNELS).optional(),
  templateId: z.string().optional(),
  name: z.string().optional(),
  // delay
  seconds: z.number().optional(),
  // waitForSegment
  segmentId: z.string().optional(),
  timeoutSeconds: z.number().optional(),
});

export type LooseLeafStep = z.infer<typeof looseLeafStepSchema>;

export const looseJourneyPlanSchema = z.object({
  name: z.string().describe("A short, descriptive name for the journey."),
  entry: z.object({
    kind: z.enum(ENTRY_KINDS),
    segmentId: z
      .string()
      .optional()
      .describe("Required when kind is 'segment'."),
    event: z.string().optional().describe("Required when kind is 'event'."),
    key: z.string().optional(),
  }),
  steps: z.array(looseLeafStepSchema),
});

export type LooseJourneyPlan = z.infer<typeof looseJourneyPlanSchema>;

// ---------------------------------------------------------------------------
// Normalisation: loose (LLM) → strict (internal).
// ---------------------------------------------------------------------------

function isPositiveInt(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export interface NormalizeLoosePlanOptions {
  // Authoritative channel for each template id. The channel is resolved from the
  // template rather than trusted from the model (which frequently omits it).
  templateChannels?: ReadonlyMap<string, PlanChannel>;
}

function normalizeLeaf(
  step: LooseLeafStep,
  options: NormalizeLoosePlanOptions,
): LeafJourneyStep | null {
  switch (step.type) {
    case "message": {
      if (!step.templateId) {
        return null;
      }
      const channel =
        options.templateChannels?.get(step.templateId) ?? step.channel;
      if (!channel) {
        return null;
      }
      return {
        type: "message",
        channel,
        templateId: step.templateId,
        name: step.name,
      };
    }
    case "delay":
      if (!isPositiveInt(step.seconds)) {
        return null;
      }
      return { type: "delay", seconds: Math.floor(step.seconds) };
    case "waitForSegment":
      if (!step.segmentId || !isPositiveInt(step.timeoutSeconds)) {
        return null;
      }
      return {
        type: "waitForSegment",
        segmentId: step.segmentId,
        timeoutSeconds: Math.floor(step.timeoutSeconds),
      };
    default:
      return null;
  }
}

/**
 * Maps the loose LLM output into the strict {@link JourneyAiPlan}. The message
 * channel is resolved from the referenced template (see
 * {@link NormalizeLoosePlanOptions}). Steps missing (or with invalid values for)
 * the fields their type requires are dropped. The result is still validated
 * against {@link journeyAiPlanSchema} by the caller.
 */
export function normalizeLoosePlan(
  loose: LooseJourneyPlan,
  options: NormalizeLoosePlanOptions = {},
): JourneyAiPlan {
  const entry: JourneyEntry =
    loose.entry.kind === "segment"
      ? { type: "segment", segmentId: loose.entry.segmentId ?? "" }
      : { type: "event", event: loose.entry.event ?? "", key: loose.entry.key };

  return {
    name: loose.name,
    entry,
    steps: loose.steps
      .map((step) => normalizeLeaf(step, options))
      .filter((s): s is LeafJourneyStep => s !== null),
  };
}
