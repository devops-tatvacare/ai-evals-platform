import { describe, expect, it } from "vitest";

import {
  KNOWN_NODE_TYPES,
  NodeConfigSchema,
  parseNodeConfig,
} from "../nodeConfig";

describe("parseNodeConfig — discriminator + strict mode", () => {
  it("parses a known-good Bolna call config without issues", () => {
    const result = parseNodeConfig("crm.place_bolna_call", {
      connection_id: "11111111-1111-1111-1111-111111111111",
      template_slug: "bolna_default",
      agent_id: "agent-uuid",
      from_phone: "",
      phone_field: "phone",
      variable_mappings: [],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Discriminator stripped before write-back so on-wire shape is preserved.
      expect(result.data).not.toHaveProperty("nodeType");
      expect(result.data.connection_id).toBe(
        "11111111-1111-1111-1111-111111111111",
      );
    }
  });

  it("parses a known-good WATI config without issues", () => {
    const result = parseNodeConfig("crm.send_wati", {
      connection_id: "c-1",
      template_slug: "wati_default",
      template_name: "concierge_priority",
      channel_number: "+919999999999",
      broadcast_name: "concierge_2026_05",
      phone_field: "whatsapp_number",
      variable_mappings: [],
    });
    expect(result.ok).toBe(true);
  });

  it("surfaces unknown extra keys as parse issues (strict)", () => {
    const result = parseNodeConfig("crm.send_wati", {
      connection_id: "c-1",
      template_slug: "wati_default",
      // Inject an unknown field — strict mode should reject.
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
    const result = parseNodeConfig("crm.send_wati", {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.field === "connection_id")).toBe(true);
    }
  });

  it("draft mode treats omitted required fields as incomplete authoring, not parse issues", () => {
    const result = parseNodeConfig("crm.send_wati", {}, { mode: "draft" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({});
    }
  });

  it("draft mode still surfaces unknown extra keys when required fields are omitted", () => {
    const result = parseNodeConfig(
      "crm.send_wati",
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
    // Pre-parse: branches carry both `match` and `predicate`. Parser should
    // strip whichever doesn't apply to the active mode.
    const result = parseNodeConfig("logic.split", {
      mode: "by_field",
      field: "plan",
      branches: [
        {
          id: "gold",
          label: "Gold",
          predicate: { field: "plan", op: "eq", value: "gold" },
        },
        { id: "silver", label: "Silver", match: "silver" },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const branches = result.data.branches as Array<Record<string, unknown>>;
      expect(branches).toHaveLength(2);
      // by_field mode keeps `match`, drops `predicate`.
      for (const b of branches) {
        expect(b).not.toHaveProperty("predicate");
        expect(b.match).toBeDefined();
      }
    }
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
    const result = parseNodeConfig("crm.send_wati", null);
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
