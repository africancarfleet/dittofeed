import { ChannelType } from "isomorphic-lib/src/types";

import { JourneyBodyNode, JourneyNodeType } from "../types";
import { compileJourneyPlan } from "./compileJourneyPlan";
import { JourneyAiPlan } from "./journeyPlan";

function counterIds(): () => string {
  let i = 0;
  return () => {
    i += 1;
    return `node-${i}`;
  };
}

function byId(nodes: JourneyBodyNode[]): Record<string, JourneyBodyNode> {
  return Object.fromEntries(nodes.map((n) => [n.id, n]));
}

describe("compileJourneyPlan", () => {
  it("compiles a linear segment-entry journey with head-first ids and wired children", () => {
    const plan: JourneyAiPlan = {
      name: "Welcome series",
      entry: { type: "segment", segmentId: "seg-1" },
      steps: [
        { type: "message", channel: "Email", templateId: "tpl-1" },
        { type: "delay", seconds: 259200 },
        { type: "message", channel: "Email", templateId: "tpl-2" },
      ],
    };

    const def = compileJourneyPlan(plan, { generateId: counterIds() });
    const nodes = byId(def.nodes);

    expect(def.entryNode).toEqual({
      type: JourneyNodeType.SegmentEntryNode,
      segment: "seg-1",
      child: "node-1",
    });
    expect(def.exitNode).toEqual({ type: JourneyNodeType.ExitNode });
    expect(def.nodes).toHaveLength(3);

    expect(nodes["node-1"]).toMatchObject({
      type: JourneyNodeType.MessageNode,
      variant: { type: ChannelType.Email, templateId: "tpl-1" },
      child: "node-2",
    });
    expect(nodes["node-2"]).toMatchObject({
      type: JourneyNodeType.DelayNode,
      variant: { type: "Second", seconds: 259200 },
      child: "node-3",
    });
    expect(nodes["node-3"]).toMatchObject({
      type: JourneyNodeType.MessageNode,
      child: JourneyNodeType.ExitNode,
    });
  });

  it("compiles an empty journey straight to exit", () => {
    const plan: JourneyAiPlan = {
      name: "Empty",
      entry: { type: "segment", segmentId: "seg-1" },
      steps: [],
    };
    const def = compileJourneyPlan(plan, { generateId: counterIds() });
    expect(def.entryNode).toMatchObject({ child: JourneyNodeType.ExitNode });
    expect(def.nodes).toHaveLength(0);
  });

  it("compiles an event entry with a key", () => {
    const plan: JourneyAiPlan = {
      name: "On signup",
      entry: { type: "event", event: "SIGNED_UP", key: "userId" },
      steps: [{ type: "message", channel: "Sms", templateId: "tpl-sms" }],
    };
    const def = compileJourneyPlan(plan, { generateId: counterIds() });
    expect(def.entryNode).toEqual({
      type: JourneyNodeType.EventEntryNode,
      event: "SIGNED_UP",
      key: "userId",
      child: "node-1",
    });
    expect(byId(def.nodes)["node-1"]).toMatchObject({
      variant: { type: ChannelType.Sms, templateId: "tpl-sms" },
    });
  });

  it("wires a waitForSegment node's timeout and segment children to the next node", () => {
    const plan: JourneyAiPlan = {
      name: "Wait then message",
      entry: { type: "segment", segmentId: "seg-1" },
      steps: [
        { type: "waitForSegment", segmentId: "seg-2", timeoutSeconds: 3600 },
        { type: "message", channel: "Email", templateId: "tpl-1" },
      ],
    };
    const def = compileJourneyPlan(plan, { generateId: counterIds() });
    expect(byId(def.nodes)["node-1"]).toMatchObject({
      type: JourneyNodeType.WaitForNode,
      timeoutSeconds: 3600,
      timeoutChild: "node-2",
      segmentChildren: [{ id: "node-2", segmentId: "seg-2" }],
    });
  });

  it("compiles a terminal segmentSplit with both branches ending at exit", () => {
    const plan: JourneyAiPlan = {
      name: "Split",
      entry: { type: "segment", segmentId: "seg-1" },
      steps: [
        {
          type: "segmentSplit",
          segmentId: "seg-vip",
          trueSteps: [{ type: "message", channel: "Email", templateId: "vip" }],
          falseSteps: [],
        },
      ],
    };
    const def = compileJourneyPlan(plan, { generateId: counterIds() });

    // The split node is visited first (node-1); its true branch message is node-2.
    expect(def.entryNode).toMatchObject({ child: "node-1" });
    expect(byId(def.nodes)["node-1"]).toMatchObject({
      type: JourneyNodeType.SegmentSplitNode,
      variant: {
        type: "Boolean",
        segment: "seg-vip",
        trueChild: "node-2",
        falseChild: JourneyNodeType.ExitNode,
      },
    });
  });
});
