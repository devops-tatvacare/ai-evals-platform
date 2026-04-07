import { useEffect, useRef, useState, useCallback } from "react";
import { Search } from "lucide-react";
import * as d3 from "d3";
import { FilterPills, PageHeader } from "@/features/guide/components";
import { usePageExport } from "@/features/guide/hooks/usePageExport";
import {
  brainMapNodes,
  brainMapLinks,
  features,
  layers,
  getNodeColor,
  getNodeStroke,
  getNodeRadius,
  type BrainNode,
  type BrainLink,
} from "@/features/guide/data/brainMap";

function escapeHtml(str: string): string {
  const div = document.createElement("div");
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

export default function BrainMap() {
  const svgRef = useRef<SVGSVGElement>(null);
  const infoPanelRef = useRef<HTMLDivElement>(null);
  const [activeFeature, setActiveFeature] = useState("all");
  const [activeLayer, setActiveLayer] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const { contentRef } = usePageExport();

  // Store D3 selections for filter/search interactions
  const d3Refs = useRef<{
    node: d3.Selection<
      SVGCircleElement,
      BrainNode,
      SVGGElement,
      unknown
    > | null;
    link: d3.Selection<SVGLineElement, BrainLink, SVGGElement, unknown> | null;
    label: d3.Selection<SVGTextElement, BrainNode, SVGGElement, unknown> | null;
    simulation: d3.Simulation<BrainNode, BrainLink> | null;
    nodes: BrainNode[];
  }>({ node: null, link: null, label: null, simulation: null, nodes: [] });

  const initBrainMap = useCallback(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;

    // Clear existing
    svgEl.innerHTML = "";

    // Clone nodes & links for D3 mutation
    const nodes: BrainNode[] = brainMapNodes.map((n) => ({
      ...n,
      radius: getNodeRadius(n),
    }));
    const linkData: BrainLink[] = brainMapLinks.map((l) => ({ ...l }));

    d3Refs.current.nodes = nodes;

    const rect = svgEl.getBoundingClientRect();
    const width = rect.width || 900;
    let height = rect.height || 600;

    const svg = d3
      .select(svgEl)
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("preserveAspectRatio", "xMidYMid meet");

    const g = svg.append("g").attr("class", "brain-map-root");

    // Zoom
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
      });
    svg.call(zoom);

    // Arrow marker
    svg
      .append("defs")
      .append("marker")
      .attr("id", "arrowhead")
      .attr("viewBox", "-0 -5 10 10")
      .attr("refX", 20)
      .attr("refY", 0)
      .attr("orient", "auto")
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", "var(--border)");

    // Simulation
    const simulation = d3
      .forceSimulation<BrainNode>(nodes)
      .force(
        "link",
        d3
          .forceLink<BrainNode, BrainLink>(linkData)
          .id((d) => d.id)
          .distance((d) => {
            const src = d.source as BrainNode;
            if (src.type === "feature") return 120;
            if (src.type === "file") return 60;
            return 40;
          }),
      )
      .force(
        "charge",
        d3.forceManyBody<BrainNode>().strength((d) => {
          if (d.type === "feature") return -400;
          if (d.type === "file") return -150;
          return -50;
        }),
      )
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force(
        "collision",
        d3.forceCollide<BrainNode>().radius((d) => (d.radius || 8) + 5),
      );

    d3Refs.current.simulation = simulation;

    // Links
    const linkGroup = g.append("g").attr("class", "links");
    const link = linkGroup
      .selectAll<SVGLineElement, BrainLink>("line")
      .data(linkData)
      .enter()
      .append("line")
      .attr("stroke", "var(--border)")
      .attr("stroke-opacity", 0.5)
      .attr("stroke-width", (d) => {
        const src = d.source as BrainNode;
        return src.type === "feature" ? 1.5 : 1;
      });

    d3Refs.current.link = link;

    // Drag handlers
    function dragStarted(
      event: d3.D3DragEvent<SVGCircleElement, BrainNode, BrainNode>,
      d: BrainNode,
    ) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    }
    function dragged(
      event: d3.D3DragEvent<SVGCircleElement, BrainNode, BrainNode>,
      d: BrainNode,
    ) {
      d.fx = event.x;
      d.fy = event.y;
    }
    function dragEnded(
      event: d3.D3DragEvent<SVGCircleElement, BrainNode, BrainNode>,
      d: BrainNode,
    ) {
      if (!event.active) simulation.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    }

    // Nodes
    const nodeGroup = g.append("g").attr("class", "nodes");
    const node = nodeGroup
      .selectAll<SVGCircleElement, BrainNode>("circle")
      .data(nodes)
      .enter()
      .append("circle")
      .attr("r", (d) => d.radius || 8)
      .attr("fill", (d) => getNodeColor(d))
      .attr("stroke", (d) => getNodeStroke(d))
      .attr("stroke-width", (d) => (d.type === "feature" ? 3 : 1.5))
      .attr("cursor", "pointer")
      .attr("opacity", 1)
      .call(
        d3
          .drag<SVGCircleElement, BrainNode>()
          .on("start", dragStarted)
          .on("drag", dragged)
          .on("end", dragEnded),
      );

    d3Refs.current.node = node;

    // Labels
    const labelGroup = g.append("g").attr("class", "labels");
    const label = labelGroup
      .selectAll<SVGTextElement, BrainNode>("text")
      .data(nodes)
      .enter()
      .append("text")
      .attr("text-anchor", "middle")
      .attr("dy", (d) => -((d.radius || 8) + 6))
      .attr("font-size", (d) => {
        if (d.type === "feature") return "13px";
        if (d.type === "file") return "10px";
        return "9px";
      })
      .attr("font-weight", (d) => (d.type === "feature" ? "700" : "500"))
      .attr("fill", "var(--text)")
      .attr("opacity", (d) => (d.type === "feature" ? 1 : 0))
      .text((d) => d.label);

    d3Refs.current.label = label;

    // Hover behavior
    node
      .on("mouseenter", function (_event, d) {
        d3.select(this)
          .transition()
          .duration(150)
          .attr("r", (d.radius || 8) * 1.3);
        label
          .filter((ld) => ld.id === d.id)
          .transition()
          .duration(150)
          .attr("opacity", 1);
      })
      .on("mouseleave", function (_event, d) {
        d3.select(this)
          .transition()
          .duration(150)
          .attr("r", d.radius || 8);
        if (!d._selected) {
          label
            .filter((ld) => ld.id === d.id && ld.type !== "feature")
            .transition()
            .duration(150)
            .attr("opacity", 0);
        }
      });

    // Click node -> info panel
    node.on("click", function (event, d) {
      event.stopPropagation();
      nodes.forEach((n) => {
        n._selected = false;
      });
      d._selected = true;

      if (!infoPanelRef.current) return;

      let html = "";

      if (d.type === "feature") {
        const featureFiles = nodes.filter(
          (n) => n.type === "file" && n.feature === d.feature,
        );
        html += `<h3 style="margin:0 0 0.75rem 0; color:var(--accent-text);">${escapeHtml(d.label)}</h3>`;
        html += `<p style="color:var(--text-secondary); margin:0 0 0.75rem 0;">Feature group (${featureFiles.length} files)</p>`;
        html += '<ul style="margin:0; padding-left:1.25rem;">';
        featureFiles.forEach((f) => {
          const badgeBg =
            f.layer === "frontend"
              ? "var(--surface-info); color:var(--color-info)"
              : f.layer === "backend"
                ? "var(--surface-success); color:var(--color-success)"
                : "var(--surface-brand-subtle); color:var(--text-brand)";
          html += `<li style="margin-bottom:0.375rem; color:var(--text);"><code>${escapeHtml(f.label)}</code><span style="display:inline-block; padding:0.125rem 0.5rem; border-radius:99px; font-size:0.7rem; font-weight:600; margin-left:0.5rem; background:${badgeBg};">${f.layer}</span><br/><span style="font-size:0.75rem; color:var(--text-muted);">${escapeHtml(f.fullPath || "")}</span></li>`;
        });
        html += "</ul>";
      } else if (d.type === "file") {
        const fileMethods = nodes.filter(
          (n) => n.type === "method" && n.fullPath === d.fullPath,
        );
        html += `<h3 style="margin:0 0 0.5rem 0; color:var(--text);">${escapeHtml(d.label)}</h3>`;
        html += `<p style="color:var(--text-muted); margin:0 0 0.25rem 0; font-size:0.85rem; font-family:'JetBrains Mono',monospace;">${escapeHtml(d.fullPath || "")}</p>`;
        html += `<p style="color:var(--text-secondary); margin:0 0 0.75rem 0;">Layer: <strong>${d.layer.charAt(0).toUpperCase() + d.layer.slice(1)}</strong> — ${fileMethods.length} exported methods</p>`;
        if (fileMethods.length > 0) {
          html += '<div style="display:flex; flex-wrap:wrap; gap:0.375rem;">';
          fileMethods.forEach((m) => {
            html += `<span style="display:inline-block; padding:0.25rem 0.625rem; border-radius:6px; background:var(--bg-secondary); border:1px solid var(--border); font-size:0.8rem; font-family:'JetBrains Mono',monospace; color:var(--text);">${escapeHtml(m.label)}</span>`;
          });
          html += "</div>";
        }
      } else {
        const parentFile = nodes.find(
          (n) => n.type === "file" && n.fullPath === d.fullPath,
        );
        html += `<h3 style="margin:0 0 0.5rem 0; color:var(--text); font-family:'JetBrains Mono',monospace;">${escapeHtml(d.label)}</h3>`;
        html +=
          '<p style="color:var(--text-secondary); margin:0 0 0.25rem 0;">Method / Export</p>';
        if (parentFile) {
          html += `<p style="color:var(--text-muted); margin:0; font-size:0.85rem;">Defined in: <code>${escapeHtml(parentFile.label)}</code></p>`;
          html += `<p style="color:var(--text-muted); margin:0.25rem 0 0 0; font-size:0.8rem; font-family:'JetBrains Mono',monospace;">${escapeHtml(d.fullPath || "")}</p>`;
        }
      }

      infoPanelRef.current.innerHTML = html;
    });

    // Click empty area resets
    svg.on("click", () => {
      nodes.forEach((n) => {
        n._selected = false;
      });
      if (infoPanelRef.current) {
        infoPanelRef.current.innerHTML =
          '<p style="color:var(--text-muted)">Click on a node to see details. Use feature pills above to highlight subgraphs.</p>';
      }
    });

    // Tick
    simulation.on("tick", () => {
      link
        .attr("x1", (d) => (d.source as BrainNode).x || 0)
        .attr("y1", (d) => (d.source as BrainNode).y || 0)
        .attr("x2", (d) => (d.target as BrainNode).x || 0)
        .attr("y2", (d) => (d.target as BrainNode).y || 0);

      node.attr("cx", (d) => d.x || 0).attr("cy", (d) => d.y || 0);

      label.attr("x", (d) => d.x || 0).attr("y", (d) => d.y || 0);
    });

    // Resize handler
    const resizeHandler = () => {
      const newRect = svgEl.getBoundingClientRect();
      const newWidth = newRect.width || 900;
      height = newRect.height || height;
      svg.attr("viewBox", `0 0 ${newWidth} ${height}`);
      simulation.force("center", d3.forceCenter(newWidth / 2, height / 2));
      simulation.alpha(0.3).restart();
    };

    let resizeTimeout: ReturnType<typeof setTimeout>;
    const debouncedResize = () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(resizeHandler, 200);
    };
    window.addEventListener("resize", debouncedResize);

    return () => {
      window.removeEventListener("resize", debouncedResize);
      simulation.stop();
    };
  }, []);

  // Initialize on mount
  useEffect(() => {
    return initBrainMap();
  }, [initBrainMap]);

  // Feature filter effect
  useEffect(() => {
    const { node, link, label } = d3Refs.current;
    if (!node || !link || !label) return;

    if (activeFeature === "all") {
      node
        .transition()
        .duration(300)
        .attr("opacity", 1)
        .attr("r", (d) => d.radius || 8);
      link.transition().duration(300).attr("stroke-opacity", 0.5);
      label
        .transition()
        .duration(300)
        .attr("opacity", (d) => (d.type === "feature" ? 1 : 0));
    } else {
      node
        .transition()
        .duration(300)
        .attr("opacity", (d) => (d.feature === activeFeature ? 1 : 0.1))
        .attr("r", (d) =>
          d.feature === activeFeature ? (d.radius || 8) * 1.15 : d.radius || 8,
        );
      link
        .transition()
        .duration(300)
        .attr("stroke-opacity", (d) => {
          const src = (d.source as BrainNode).feature;
          const tgt = (d.target as BrainNode).feature;
          return src === activeFeature && tgt === activeFeature ? 0.8 : 0.05;
        });
      label
        .transition()
        .duration(300)
        .attr("opacity", (d) => (d.feature === activeFeature ? 1 : 0));
    }
  }, [activeFeature]);

  // Layer filter effect
  useEffect(() => {
    const { node, link, label } = d3Refs.current;
    if (!node || !link || !label) return;

    if (activeLayer === "all") {
      node
        .transition()
        .duration(300)
        .attr("opacity", 1)
        .attr("r", (d) => d.radius || 8);
      link.transition().duration(300).attr("stroke-opacity", 0.5);
      label
        .transition()
        .duration(300)
        .attr("opacity", (d) => (d.type === "feature" ? 1 : 0));
    } else {
      node
        .transition()
        .duration(300)
        .attr("opacity", (d) => {
          if (d.type === "feature") return 0.6;
          return d.layer === activeLayer ? 1 : 0.1;
        })
        .attr("r", (d) =>
          d.layer === activeLayer && d.type !== "feature"
            ? (d.radius || 8) * 1.15
            : d.radius || 8,
        );
      link
        .transition()
        .duration(300)
        .attr("stroke-opacity", (d) => {
          const srcLayer = (d.source as BrainNode).layer;
          const tgtLayer = (d.target as BrainNode).layer;
          return srcLayer === activeLayer || tgtLayer === activeLayer
            ? 0.6
            : 0.05;
        });
      label
        .transition()
        .duration(300)
        .attr("opacity", (d) => {
          if (d.type === "feature") return 0.6;
          return d.layer === activeLayer ? 1 : 0;
        });
    }
  }, [activeLayer]);

  // Search effect
  useEffect(() => {
    const { node, link, label, nodes } = d3Refs.current;
    if (!node || !link || !label) return;

    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      node
        .transition()
        .duration(200)
        .attr("opacity", 1)
        .attr("r", (d) => d.radius || 8);
      link.transition().duration(200).attr("stroke-opacity", 0.5);
      label
        .transition()
        .duration(200)
        .attr("opacity", (d) => (d.type === "feature" ? 1 : 0));
      return;
    }

    const matchingIds: Record<string, boolean> = {};
    nodes.forEach((n) => {
      if (n.label.toLowerCase().includes(query)) matchingIds[n.id] = true;
    });

    if (Object.keys(matchingIds).length === 0) {
      node.transition().duration(200).attr("opacity", 0.3);
      link.transition().duration(200).attr("stroke-opacity", 0.1);
      label.transition().duration(200).attr("opacity", 0.3);
      return;
    }

    // Include parent feature nodes
    nodes.forEach((n) => {
      if (matchingIds[n.id] && n.feature) {
        const featureNode = nodes.find(
          (fn) => fn.type === "feature" && fn.feature === n.feature,
        );
        if (featureNode) matchingIds[featureNode.id] = true;
      }
    });

    node
      .transition()
      .duration(200)
      .attr("opacity", (d) => (matchingIds[d.id] ? 1 : 0.1))
      .attr("r", (d) =>
        matchingIds[d.id] ? (d.radius || 8) * 1.3 : d.radius || 8,
      );
    link
      .transition()
      .duration(200)
      .attr("stroke-opacity", (d) => {
        const srcMatch = matchingIds[(d.source as BrainNode).id];
        const tgtMatch = matchingIds[(d.target as BrainNode).id];
        return srcMatch && tgtMatch ? 0.8 : 0.05;
      });
    label
      .transition()
      .duration(200)
      .attr("opacity", (d) => (matchingIds[d.id] ? 1 : 0));
  }, [searchQuery]);

  return (
    <div
      ref={contentRef}
      className="page-content animate-fade-in-up"
      data-title="Code Map"
    >
      <PageHeader
        title="Code Map"
        subtitle="Explore feature, file, and method relationships. Search, filter by layer/feature, then inspect nodes in the details panel."
        pageTitle="Code Map"
        contentRef={contentRef}
      />

      {/* Controls */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="relative w-full flex-shrink-0 sm:w-auto">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2"
            style={{ color: "var(--text-muted)" }}
          />
          <input
            type="text"
            placeholder="Search files or methods..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg py-2 pl-9 pr-4 text-sm sm:w-72"
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              color: "var(--text)",
              outline: "none",
              fontFamily: "inherit",
            }}
          />
        </div>
        <FilterPills
          options={layers}
          active={activeLayer}
          onChange={setActiveLayer}
          className="flex-1"
        />
      </div>

      {/* Feature pills */}
      <FilterPills
        options={features}
        active={activeFeature}
        onChange={setActiveFeature}
        className="mb-3"
      />

      {/* SVG */}
      <svg
        ref={svgRef}
        style={{
          width: "100%",
          height: "clamp(420px, 68vh, 760px)",
          borderRadius: "12px",
          border: "1px solid var(--border)",
          background: "var(--surface)",
        }}
      />

      {/* Info Panel */}
      <div
        ref={infoPanelRef}
        className="mt-3 rounded-xl p-4"
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          minHeight: "64px",
        }}
      >
        <p style={{ color: "var(--text-muted)" }}>
          Click on a node to see details. Use feature pills above to highlight
          subgraphs.
        </p>
      </div>
    </div>
  );
}
