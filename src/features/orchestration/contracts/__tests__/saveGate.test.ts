import { describe, expect, it } from "vitest";

import {
  buildSaveBlockedMessage,
  shouldBlockSave,
} from "../saveGate";
import type { HardParseIssueGroup } from "@/features/orchestration/store/workflowBuilderStore";

const oneHardGroup: HardParseIssueGroup = {
  nodeId: "n1",
  nodeType: "core.webhook_out",
  hardIssues: [
    { field: "fabricated_key", message: "Unrecognized key", code: "unrecognized_keys" },
  ],
};

const twoHardGroups: HardParseIssueGroup[] = [
  oneHardGroup,
  {
    nodeId: "n2",
    nodeType: "logic.split",
    hardIssues: [
      { field: "mode", message: "invalid value", code: "invalid_value" },
      { field: "branches.0.match", message: "expected string", code: "invalid_type" },
    ],
  },
];

describe("shouldBlockSave — section 5 gate decision", () => {
  it("returns false for an empty list (clean or partial-draft canvas)", () => {
    expect(shouldBlockSave([])).toBe(false);
  });

  it("returns true when any node carries a hard issue", () => {
    expect(shouldBlockSave([oneHardGroup])).toBe(true);
  });

  it("returns true regardless of count", () => {
    expect(shouldBlockSave(twoHardGroups)).toBe(true);
  });
});

describe("buildSaveBlockedMessage — single-source notification copy", () => {
  it("singular wording for one issue on one node", () => {
    const msg = buildSaveBlockedMessage([oneHardGroup]);
    expect(msg).toContain("1 schema issue on 1 node");
    expect(msg).toContain("core.webhook_out");
    expect(msg).toContain("fabricated_key");
  });

  it("plural wording when multiple issues / nodes", () => {
    const msg = buildSaveBlockedMessage(twoHardGroups);
    expect(msg).toContain("3 schema issues on 2 nodes");
  });

  it("falls back to (node-level) when the first issue has no field", () => {
    const groupWithoutField: HardParseIssueGroup = {
      nodeId: "n3",
      nodeType: "logic.wait",
      hardIssues: [{ field: "", message: "graph", code: "invalid_union" }],
    };
    const msg = buildSaveBlockedMessage([groupWithoutField]);
    expect(msg).toContain("(node-level)");
  });
});
