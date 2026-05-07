import { describe, expect, it, beforeEach } from "vitest";
import { useWorkflowBuilderStore } from "@/features/orchestration/store/workflowBuilderStore";

describe("workflowBuilderStore", () => {
  beforeEach(() => {
    useWorkflowBuilderStore.getState().reset();
  });

  it("addNode appends to nodes and marks data hash diverged from committed", () => {
    const s = useWorkflowBuilderStore.getState();
    s.addNode({
      id: "n1",
      type: "logic.conditional",
      position: { x: 0, y: 0 },
      data: { label: "Conditional", nodeType: "logic.conditional" },
      config: { predicate: { field: "x", op: "eq", value: 1 } },
    });
    const s2 = useWorkflowBuilderStore.getState();
    expect(s2.nodes).toHaveLength(1);
    expect(s2.currentDataHash).not.toBe(s2.committedDataHash);
  });

  it("addNode does not annotate blank draft nodes for omitted required fields", () => {
    const s = useWorkflowBuilderStore.getState();
    s.addNode({
      id: "wati-draft",
      type: "crm.send_wati",
      position: { x: 0, y: 0 },
      data: { label: "WATI", nodeType: "crm.send_wati" },
      config: {},
    });
    const node = useWorkflowBuilderStore
      .getState()
      .nodes.find((n) => n.id === "wati-draft");
    expect(node?._parseIssues).toBeUndefined();
  });

  it("updateNodeConfig writes the canonicalised config from the parse boundary", () => {
    // Phase 14 / Phase D — `updateNodeConfig` now passes the new config
    // through the Zod parse boundary on success. The wait schema applies
    // its `mode` default (`duration`) so the stored shape is canonical
    // even if the editor only emitted `{ duration_hours }`. This avoids
    // the pre-Phase-14 drift where mode-derived defaults stayed implicit
    // and silently broke on the next reload.
    const s = useWorkflowBuilderStore.getState();
    s.addNode({
      id: "n1",
      type: "logic.wait",
      position: { x: 0, y: 0 },
      data: { label: "Wait", nodeType: "logic.wait" },
      config: { duration_hours: 4 },
    });
    s.updateNodeConfig("n1", { duration_hours: 8 });
    const node = useWorkflowBuilderStore
      .getState()
      .nodes.find((n) => n.id === "n1");
    expect(node?.config).toEqual({ mode: "duration", duration_hours: 8 });
    expect(node?._parseIssues).toBeUndefined();
  });

  it("updateNodeConfig log+continue: writes raw config and annotates _parseIssues on a failed parse", () => {
    const s = useWorkflowBuilderStore.getState();
    s.addNode({
      id: "n1",
      type: "crm.send_wati",
      position: { x: 0, y: 0 },
      data: { label: "WATI", nodeType: "crm.send_wati" },
      config: {
        connection_id: "c-1",
        template_slug: "wati_default",
        template_name: "concierge",
        channel_number: "+91x",
        broadcast_name: "b",
      },
    });
    s.updateNodeConfig("n1", {
      connection_id: "c-1",
      template_slug: "wati_default",
      // Inject an unknown extra key — strict mode rejects, store keeps
      // the raw config and annotates with _parseIssues.
      surprise: "extra",
    });
    const node = useWorkflowBuilderStore
      .getState()
      .nodes.find((n) => n.id === "n1");
    expect((node?.config as Record<string, unknown>).surprise).toBe("extra");
    expect(node?._parseIssues?.length ?? 0).toBeGreaterThan(0);
  });

  it("updateNodeConfig still surfaces unknown keys even when required fields are omitted", () => {
    const s = useWorkflowBuilderStore.getState();
    s.addNode({
      id: "n-draft",
      type: "crm.send_wati",
      position: { x: 0, y: 0 },
      data: { label: "WATI", nodeType: "crm.send_wati" },
      config: {},
    });
    s.updateNodeConfig("n-draft", { surprise: "extra" });
    const node = useWorkflowBuilderStore
      .getState()
      .nodes.find((n) => n.id === "n-draft");
    expect(node?._parseIssues).toEqual([
      expect.objectContaining({
        field: "surprise",
        code: "unrecognized_keys",
      }),
    ]);
  });

  it('viewMode defaults to "view" and resets to "view" on a fresh load hydrate', () => {
    const s = useWorkflowBuilderStore.getState();
    expect(s.viewMode).toBe("view");
    s.setViewMode("edit");
    expect(useWorkflowBuilderStore.getState().viewMode).toBe("edit");
    s.hydrate({
      nodes: [
        {
          id: "n1",
          type: "sink.complete",
          position: { x: 0, y: 0 },
          data: { label: "End", nodeType: "sink.complete" },
          config: {},
        },
      ],
      edges: [],
    });
    // load-mode hydrate (default) drops back to view.
    expect(useWorkflowBuilderStore.getState().viewMode).toBe("view");
  });

  it("viewMode survives a rebase hydrate so a save inside edit does not kick the operator out", () => {
    const s = useWorkflowBuilderStore.getState();
    s.setViewMode("edit");
    s.hydrate(
      {
        nodes: [
          {
            id: "n1",
            type: "sink.complete",
            position: { x: 0, y: 0 },
            data: { label: "End", nodeType: "sink.complete" },
            config: {},
          },
        ],
        edges: [],
      },
      { mode: "rebase" },
    );
    expect(useWorkflowBuilderStore.getState().viewMode).toBe("edit");
  });

  it("toDefinition strips _parseIssues so it never hits the wire", () => {
    const s = useWorkflowBuilderStore.getState();
    s.addNode({
      id: "n1",
      type: "crm.send_wati",
      position: { x: 0, y: 0 },
      data: { label: "WATI", nodeType: "crm.send_wati" },
      config: {},
    });
    s.updateNodeConfig("n1", { surprise: "extra" });
    const def = useWorkflowBuilderStore.getState().toDefinition();
    for (const n of def.nodes) {
      expect(n).not.toHaveProperty("_parseIssues");
    }
  });

  it("removeNode also removes connected edges", () => {
    const s = useWorkflowBuilderStore.getState();
    s.addNode({
      id: "a",
      type: "logic.conditional",
      position: { x: 0, y: 0 },
      data: { label: "A", nodeType: "logic.conditional" },
      config: {},
    });
    s.addNode({
      id: "b",
      type: "sink.complete",
      position: { x: 0, y: 0 },
      data: { label: "B", nodeType: "sink.complete" },
      config: {},
    });
    s.addEdge({ id: "e1", source: "a", target: "b", label: "true" });
    s.removeNode("a");
    const s2 = useWorkflowBuilderStore.getState();
    expect(s2.nodes).toHaveLength(1);
    expect(s2.edges).toHaveLength(0);
  });

  it("hydrate stamps committed snapshot so the lifecycle reads clean", () => {
    const s = useWorkflowBuilderStore.getState();
    s.addNode({
      id: "tmp",
      type: "logic.wait",
      position: { x: 0, y: 0 },
      data: { label: "Wait", nodeType: "logic.wait" },
      config: {},
    });
    {
      const live = useWorkflowBuilderStore.getState();
      expect(live.currentDataHash).not.toBe(live.committedDataHash);
    }
    s.hydrate({
      nodes: [
        {
          id: "n1",
          type: "sink.complete",
          position: { x: 0, y: 0 },
          data: { label: "End", nodeType: "sink.complete" },
          config: {},
        },
      ],
      edges: [],
    });
    const s2 = useWorkflowBuilderStore.getState();
    expect(s2.currentDataHash).toBe(s2.committedDataHash);
    expect(s2.nodes).toHaveLength(1);
  });

  it("hydrate does not flag saved draft nodes for omitted required fields", () => {
    const s = useWorkflowBuilderStore.getState();
    s.hydrate({
      nodes: [
        {
          id: "wati-1",
          type: "crm.send_wati",
          position: { x: 0, y: 0 },
          data: { label: "WATI", nodeType: "crm.send_wati" },
          config: {},
        },
      ],
      edges: [],
    });
    const node = useWorkflowBuilderStore
      .getState()
      .nodes.find((n) => n.id === "wati-1");
    expect(node?._parseIssues).toBeUndefined();
  });

  it("rebase hydrate preserves selection and in-flight state", () => {
    const s = useWorkflowBuilderStore.getState();
    s.addNode({
      id: "n1",
      type: "sink.complete",
      position: { x: 0, y: 0 },
      data: { label: "End", nodeType: "sink.complete" },
      config: {},
    });
    s.setSelectedNode("n1");
    s.beginInFlight("publishing");

    s.hydrate(
      {
        nodes: [
          {
            id: "n1",
            type: "sink.complete",
            position: { x: 0, y: 0 },
            data: { label: "End", nodeType: "sink.complete" },
            config: { normalized: true },
          },
        ],
        edges: [],
      },
      { mode: "rebase" },
    );

    const after = useWorkflowBuilderStore.getState();
    expect(after.selectedNodeId).toBe("n1");
    expect(after.inFlight).toBe("publishing");
    expect(after.currentDataHash).toBe(after.committedDataHash);
  });

  it("toDefinition returns current nodes + edges", () => {
    const s = useWorkflowBuilderStore.getState();
    s.addNode({
      id: "a",
      type: "sink.complete",
      position: { x: 1, y: 2 },
      data: { label: "End", nodeType: "sink.complete" },
      config: {},
    });
    const def = useWorkflowBuilderStore.getState().toDefinition();
    expect(def.nodes).toHaveLength(1);
    expect(def.edges).toHaveLength(0);
  });
});
