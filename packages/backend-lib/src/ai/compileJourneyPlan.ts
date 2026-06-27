import { assertUnreachable } from "isomorphic-lib/src/typeAssertions";
import { ChannelType } from "isomorphic-lib/src/types";
import { v4 as uuidv4 } from "uuid";

import {
  DelayVariantType,
  EntryNode,
  JourneyBodyNode,
  JourneyDefinition,
  JourneyNodeType,
  MessageVariant,
  SegmentSplitVariantType,
} from "../types";
import {
  AI_JOURNEY_CHANNELS,
  JourneyAiPlan,
  LeafJourneyStep,
} from "./journeyPlan";

// Children that lead to journey completion reference the exit node by its
// literal type string (the exit node has no id of its own).
const EXIT_CHILD = JourneyNodeType.ExitNode;

type PlanChannel = (typeof AI_JOURNEY_CHANNELS)[number];

function buildMessageVariant(step: {
  channel: PlanChannel;
  templateId: string;
}): MessageVariant {
  const { templateId } = step;
  switch (step.channel) {
    case "Email":
      return { type: ChannelType.Email, templateId };
    case "Sms":
      return { type: ChannelType.Sms, templateId };
    case "Webhook":
      return { type: ChannelType.Webhook, templateId };
    case "MobilePush":
      return { type: ChannelType.MobilePush, templateId };
    default:
      return assertUnreachable(step.channel);
  }
}

export interface CompileJourneyPlanOptions {
  // Injectable for deterministic tests.
  generateId?: () => string;
}

/**
 * Deterministically compiles an LLM-produced {@link JourneyAiPlan} into a
 * canonical {@link JourneyDefinition}, owning all node id generation and
 * `child` pointer wiring. Pure: the only impurity (id generation) is injectable.
 */
export function compileJourneyPlan(
  plan: JourneyAiPlan,
  { generateId = uuidv4 }: CompileJourneyPlanOptions = {},
): JourneyDefinition {
  const nodes: JourneyBodyNode[] = [];

  function pushLeaf(id: string, step: LeafJourneyStep, child: string): void {
    switch (step.type) {
      case "message":
        nodes.push({
          id,
          type: JourneyNodeType.MessageNode,
          name: step.name,
          variant: buildMessageVariant(step),
          child,
        });
        return;
      case "delay":
        nodes.push({
          id,
          type: JourneyNodeType.DelayNode,
          variant: {
            type: DelayVariantType.Second,
            seconds: step.seconds,
          },
          child,
        });
        return;
      case "waitForSegment":
        nodes.push({
          id,
          type: JourneyNodeType.WaitForNode,
          timeoutSeconds: step.timeoutSeconds,
          timeoutChild: child,
          segmentChildren: [{ id: child, segmentId: step.segmentId }],
        });
        return;
      default:
        assertUnreachable(step);
    }
  }

  // Compiles a flat list of leaf steps into a chain terminating at
  // `terminalChild`. Ids are assigned in traversal (head-first) order. Returns
  // the id of the head node, or `terminalChild` when there are no steps.
  function compileLeafChain(
    steps: LeafJourneyStep[],
    terminalChild: string,
  ): string {
    const [head, ...rest] = steps;
    if (!head) {
      return terminalChild;
    }
    const id = generateId();
    const child = compileLeafChain(rest, terminalChild);
    pushLeaf(id, head, child);
    return id;
  }

  // Compiles the top-level step list starting at `index`. A `segmentSplit` is
  // terminal (its branches end at exit), so any steps following it are ignored.
  function compileSteps(index: number): string {
    const step = plan.steps[index];
    if (!step) {
      return EXIT_CHILD;
    }
    if (step.type === "segmentSplit") {
      const id = generateId();
      const trueChild = compileLeafChain(step.trueSteps, EXIT_CHILD);
      const falseChild = compileLeafChain(step.falseSteps, EXIT_CHILD);
      nodes.push({
        id,
        type: JourneyNodeType.SegmentSplitNode,
        variant: {
          type: SegmentSplitVariantType.Boolean,
          segment: step.segmentId,
          trueChild,
          falseChild,
        },
      });
      return id;
    }
    const id = generateId();
    const child = compileSteps(index + 1);
    pushLeaf(id, step, child);
    return id;
  }

  const firstChild = compileSteps(0);

  const entryNode: EntryNode =
    plan.entry.type === "segment"
      ? {
          type: JourneyNodeType.SegmentEntryNode,
          segment: plan.entry.segmentId,
          child: firstChild,
        }
      : {
          type: JourneyNodeType.EventEntryNode,
          event: plan.entry.event,
          key: plan.entry.key,
          child: firstChild,
        };

  return {
    entryNode,
    exitNode: { type: JourneyNodeType.ExitNode },
    nodes,
  };
}
