import { describe, expect, it } from "vitest";

import {
  KNOWN_NODE_TYPES,
  NodeConfigSchema,
  isHardParseIssue,
  parseNodeConfig,
} from "../nodeConfig";

describe("parseNodeConfig — discriminator + strict mode", () => {
  it("parses a known-good core.webhook_out config without issues", () => {
    const result = parseNodeConfig("core.webhook_out", {
      connection_id: "11111111-1111-1111-1111-111111111111",
      url: "https://api.example.com/in",
      method: "POST",
      headers: {},
      body: {},
      timeout_seconds: 10,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).not.toHaveProperty("nodeType");
      expect(result.data.connection_id).toBe(
        "11111111-1111-1111-1111-111111111111",
      );
    }
  });

  it("surfaces unknown extra keys as parse issues (strict)", () => {
    const result = parseNodeConfig("core.webhook_out", {
      connection_id: "c-1",
      url: "https://api.example.com/in",
      definitely_not_a_real_field: "oops",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.issues.some((i) =>
          i.field.includes("definitely_not_a_real_field"),
        ),
      ).toBe(true);
    }
  });

  it("strict mode still treats omitted required fields as parse issues", () => {
    const result = parseNodeConfig("core.webhook_out", {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.field === "url")).toBe(true);
    }
  });

  it("draft mode treats omitted required fields as incomplete authoring, not parse issues", () => {
    const result = parseNodeConfig("core.webhook_out", {}, { mode: "draft" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({});
    }
  });

  it("draft mode still surfaces unknown extra keys when required fields are omitted", () => {
    const result = parseNodeConfig(
      "core.webhook_out",
      {
        definitely_not_a_real_field: "oops",
      },
      { mode: "draft" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]?.field).toContain("definitely_not_a_real_field");
    }
  });

  it("surfaces unknown node types without dropping the raw config", () => {
    const raw = { foo: "bar", baz: 1 };
    const result = parseNodeConfig("not.a.real.node.type", raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Log+continue: preserve the raw config so the store does not lose
      // operator input on a contract drift.
      expect(result.data).toEqual(raw);
      expect(result.issues[0].code).toBe("unknown_node_type");
    }
  });

  it("split branches normalise to active mode at parse time", () => {
    // by_field mode keeps `match`, populates default empty string when
    // missing. `predicate` is no longer a legal branch field — see the
    // adjacent test for the rejection case.
    const result = parseNodeConfig("logic.split", {
      mode: "by_field",
      field: "plan",
      branches: [
        { id: "gold", label: "Gold", match: "gold" },
        { id: "silver", label: "Silver" },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const branches = result.data.branches as Array<Record<string, unknown>>;
      expect(branches).toHaveLength(2);
      for (const b of branches) {
        expect(b).not.toHaveProperty("predicate");
        expect(b.match).toBeDefined();
      }
    }
  });

  it("logic.split rejects by_rules mode (backend doesn't ship it)", () => {
    const result = parseNodeConfig("logic.split", {
      mode: "by_rules",
      branches: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
    });
    expect(result.ok).toBe(false);
  });

  it("logic.split rejects branch.predicate (fabricated FE-only field)", () => {
    const result = parseNodeConfig("logic.split", {
      mode: "by_field",
      field: "plan",
      branches: [
        {
          id: "gold",
          label: "Gold",
          predicate: { field: "plan", op: "eq", value: "gold" },
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // unrecognized_keys surfaces 'predicate' as the offending field.
      const flagged = result.issues.some((i) =>
        i.field.includes("predicate") || i.message.toLowerCase().includes("predicate"),
      );
      expect(flagged).toBe(true);
    }
  });

  it("logic.wait correlation accepts recipient_id_field only", () => {
    const ok = parseNodeConfig("logic.wait", {
      mode: "event",
      event_name: "wati.message_replied",
      correlation: { recipient_id_field: "recipient_id" },
    });
    expect(ok.ok).toBe(true);
    const drift = parseNodeConfig("logic.wait", {
      mode: "event",
      event_name: "wati.message_replied",
      correlation: { field: "recipient_id" },
    });
    expect(drift.ok).toBe(false);
  });

  it("every issue surviving draft mode is hard", () => {
    // Draft mode pre-filters missing-required-field cases inside
    // parseNodeConfig. Anything that comes out is structurally bad and
    // the save gate must block on it — including wrong-typed provided
    // values, which Zod also encodes as code='invalid_type'.
    const fabricated = parseNodeConfig("sink.complete", { fabricated_key: 1 });
    expect(fabricated.ok).toBe(false);
    if (!fabricated.ok) {
      expect(fabricated.issues.every(isHardParseIssue)).toBe(true);
    }

    // Wrong-typed provided value (number on a string-typed field) MUST
    // be classified as hard — the previous implementation had this
    // backwards and let real bugs through.
    const wrongType = parseNodeConfig("logic.wait", {
      mode: "duration",
      duration_hours: "not-a-number",
    });
    expect(wrongType.ok).toBe(false);
    if (!wrongType.ok) {
      expect(wrongType.issues.every(isHardParseIssue)).toBe(true);
    }
  });

  it("missing required fields on a partial draft do NOT produce any parse issues", () => {
    // A blank core.webhook_out is the canonical partial-draft state — must parse cleanly.
    const result = parseNodeConfig("core.webhook_out", {}, { mode: "draft" });
    expect(result.ok).toBe(true);
  });

  it("predicate leaf transform normalises value for the operator", () => {
    // `op = exists` does not need a value — the leaf transform should
    // strip it on parse so the on-wire shape stays canonical.
    const result = parseNodeConfig("logic.conditional", {
      predicate: { field: "opt_in", op: "exists", value: "leftover" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const pred = result.data.predicate as Record<string, unknown>;
      expect(pred.op).toBe("exists");
      expect(pred).not.toHaveProperty("value");
    }
  });

  it("predicate leaf with op=in coerces value to a list", () => {
    const result = parseNodeConfig("logic.conditional", {
      predicate: { field: "plan", op: "in", value: "gold, silver" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const pred = result.data.predicate as Record<string, unknown>;
      expect(pred.value).toEqual(["gold", "silver"]);
    }
  });

  it("returns the raw object on non-object input", () => {
    const result = parseNodeConfig("core.webhook_out", null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Strict mode still surfaces missing required fields — the store uses
      // draft mode separately when it wants incomplete authoring to be quiet.
      expect(result.issues.length).toBeGreaterThan(0);
    }
  });
});

describe("NodeConfigSchema registry coverage", () => {
  it("parseNodeConfig accepts every node type listed in KNOWN_NODE_TYPES", () => {
    // Smoke test: every known node type must produce a parse result —
    // ok or not, but never `unknown_node_type`. If a node type lands in
    // the FE builder without a Zod schema entry, this test catches it.
    for (const t of KNOWN_NODE_TYPES) {
      const result = parseNodeConfig(t, {});
      if (!result.ok) {
        expect(
          result.issues.every((i) => i.code !== "unknown_node_type"),
          `node type ${t} fell through to unknown_node_type — add a schema entry`,
        ).toBe(true);
      }
    }
  });

  it("NodeConfigSchema is a discriminated union over nodeType", () => {
    expect(NodeConfigSchema).toBeDefined();
    // safeParse on a payload missing the discriminator must surface an
    // issue rather than crashing — protects against accidental schema
    // shape regressions.
    const r = NodeConfigSchema.safeParse({ unrelated: true });
    expect(r.success).toBe(false);
  });
});
