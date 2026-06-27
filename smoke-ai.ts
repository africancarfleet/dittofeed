import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateObject } from "ai";

import { compileJourneyPlan } from "./packages/backend-lib/src/ai/compileJourneyPlan";
import {
  looseJourneyPlanSchema,
  normalizeLoosePlan,
  PlanChannel,
} from "./packages/backend-lib/src/ai/journeyPlan";

// Mirrors how the orchestrator resolves a template's channel from its id.
const templateChannels = new Map<string, PlanChannel>([
  ["tpl-welcome", "Email"],
  ["tpl-followup", "Email"],
]);

const apiKey = process.env.GOOGLE_API_KEY ?? process.env.LLM_API_KEY;
if (!apiKey) {
  throw new Error("Set GOOGLE_API_KEY (or LLM_API_KEY) in the environment.");
}

const model = createGoogleGenerativeAI({ apiKey })("gemini-2.5-flash");

const system = `You are a marketing automation specialist for Dittofeed.
Follow the output schema EXACTLY (exact field names and values).
- entry.kind is exactly "segment" or "event"; for "segment" set entry.segmentId.
- step.type is exactly one of "message", "delay", "waitForSegment", "segmentSplit".
  - message: set channel (Email|Sms|Webhook|MobilePush) and templateId.
  - delay: set seconds (e.g. 3 days = 259200).
Only reference the ids below; never invent ids.
Available segments:
- Trial users (id: seg-trial)
- VIP users (id: seg-vip)
- Churned users (id: seg-churned)
Available message templates:
- Welcome email [Email] (id: tpl-welcome)
- Follow-up email [Email] (id: tpl-followup)`;

const prompt =
  process.argv[2] ??
  "Welcome new trial users with an email, wait 3 days, then send a follow-up email.";

async function main() {
  const { object } = await generateObject({
    model,
    schema: looseJourneyPlanSchema,
    schemaName: "JourneyPlan",
    schemaDescription: "A plan describing a Dittofeed user journey.",
    system,
    prompt,
  });

  // eslint-disable-next-line no-console
  console.log("RAW LLM OUTPUT:\n", JSON.stringify(object, null, 2));

  const plan = normalizeLoosePlan(object, { templateChannels });
  // eslint-disable-next-line no-console
  console.log("\nNORMALIZED PLAN:\n", JSON.stringify(plan, null, 2));
  // eslint-disable-next-line no-console
  console.log(
    "\nCOMPILED DEFINITION:\n",
    JSON.stringify(compileJourneyPlan(plan), null, 2),
  );
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
