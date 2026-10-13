/**
 * Framework-free SVG renderer for the city graph — shared, unmodified,
 * between the game's view layer and the map editor (see
 * docs/architecture.md). Positions are plain SVG user units — callers
 * decide what those units mean (currently just Location.x/y from
 * content, unscaled).
 *
 * Pan/zoom deliberately only ever mutates the root `<svg>`'s `viewBox`
 * attribute — never per-node/-edge attributes — so the renderer stays
 * cheap at large node counts (see docs/future_work.md's node-graph-editor
 * entry on SVG scalability). The pure `panBy`/`zoomBy`/`setBounds` methods
 * are unit-testable without real browser layout; the pointer/wheel DOM
 * wiring that calls them needs an actual browser to verify (jsdom doesn't
 * implement SVG layout metrics like `getBoundingClientRect`).
 */

import { isClick, movedDistance } from "./dragGesture";

const SVG_NS = "http://www.w3.org/2000/svg";
const MIN_VIEWBOX_SIZE = 20;
/** Parametric position (0=from, 1=to) along an edge's path where its arrowhead sits — deliberately NOT the midpoint (0.5), so a two-way pair's two arrowheads (one per direction, see `pointAtT`) land at 0.6 and 0.4 of the same shared path instead of stacking on top of each other. */
const ARROW_T = 0.6;

export interface MapNode {
  id: string;
  x: number;
  y: number;
  label: string;
  /** Optional multi-line text (join with "\n") shown in a hover popup near the cursor — e.g. the editor uses this to surface a location's id, which isn't otherwise visible on the graph. Omit for a node with no tooltip. */
  tooltip?: string;
  /** Mirrors Location.kind — adds a `mapview__node--interior` class so callers can style interior locations distinctly (e.g. a more muted color) without MapView hardcoding a color choice itself. Omit (or "exterior") for the default styling. */
  kind?: "exterior" | "interior";
}

/** `curve`, when present, bends the edge through one quadratic-bezier control point instead of drawing it straight. */
export interface MapEdge {
  id: string;
  fromId: string;
  toId: string;
  curve?: { cx: number; cy: number };
  /** Optional multi-line hover-popup text, mirroring `MapNode.tooltip` — e.g. the grouped-connection editor/worldmap views use this to list a connection's compass labels. Omit for an edge with no tooltip. */
  tooltip?: string;
  /** Which direction(s) this edge actually represents — "forward" = fromId→toId, "backward" = toId→fromId. Drives how many arrowheads `render()` draws (0, 1, or 2) and, for "backward", the arrowhead's orientation. Omit (or empty) to draw no arrowheads at all, e.g. for an edge whose directionality isn't meaningful to show. */
  arrows?: ("forward" | "backward")[];
}

export interface MapBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The point and local tangent angle (degrees, atan2 convention — matches
 * SVG's `rotate()`) at parameter `t` along an edge's path, straight or the
 * existing quadratic bezier. Pure and unit-testable without a browser
 * (unlike the rest of MapView's rendering, which needs a real DOM) — used
 * to place a directional arrowhead partway along an edge without
 * duplicating the straight/curved branching `makeStraightEdge`/
 * `makeCurvedEdge` already have.
 */
export function pointAtT(
  from: { x: number; y: number },
  to: { x: number; y: number },
  curve: { cx: number; cy: number } | undefined,
  t: number,
): { x: number; y: number; angleDeg: number } {
  if (!curve) {
    return {
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
      angleDeg: (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI,
    };
  }
  const mt = 1 - t;
  const x = mt * mt * from.x + 2 * mt * t * curve.cx + t * t * to.x;
  const y = mt * mt * from.y + 2 * mt * t * curve.cy + t * t * to.y;
  // Derivative of the quadratic bezier B(t) — the path's tangent direction at this point.
  const dx = 2 * mt * (curve.cx - from.x) + 2 * t * (to.x - curve.cx);
  const dy = 2 * mt * (curve.cy - from.y) + 2 * t * (to.y - curve.cy);
  return { x, y, angleDeg: (Math.atan2(dy, dx) * 180) / Math.PI };
}

export class MapView {
  private readonly svg: SVGSVGElement;
  private readonly edgesGroup: SVGGElement;
  private readonly nodesGroup: SVGGElement;
  private readonly handleGroup: SVGGElement;
  private readonly tooltip: HTMLDivElement;

  private nodes: MapNode[] = [];
  private edges: MapEdge[] = [];
  private viewBox: ViewBox | null = null;
  private bounds: MapBounds | null = null;
  private selectedNodeId: string | null = null;
  private curveEditEdgeId: string | null = null;

  private nodeClickHandlers: ((id: string) => void)[] = [];
  private edgeClickHandlers: ((id: string) => void)[] = [];
  private canvasClickHandlers: ((x: number, y: number) => void)[] = [];
  private nodeDragHandler: ((id: string, x: number, y: number) => void) | null = null;
  private curveEditHandler: ((edgeId: string, cx: number, cy: number) => void) | null = null;

  private dragState:
    | { kind: "pan"; startClientX: number; startClientY: number; startViewBox: ViewBox; moved: number }
    | { kind: "node"; nodeId: string; startClientX: number; startClientY: number; moved: number }
    | { kind: "handle"; edgeId: string; startClientX: number; startClientY: number; moved: number }
    | null = null;

  constructor(mount: HTMLElement) {
    this.svg = document.createElementNS(SVG_NS, "svg");
    this.svg.setAttribute("class", "mapview");
    this.svg.setAttribute("width", "100%");
    this.svg.setAttribute("height", "100%");

    // Edges drawn first so node circles/labels sit on top of them; the
    // curve-edit handle (editor-only) sits above everything else.
    this.edgesGroup = document.createElementNS(SVG_NS, "g");
    this.edgesGroup.setAttribute("class", "mapview__edges");
    this.nodesGroup = document.createElementNS(SVG_NS, "g");
    this.nodesGroup.setAttribute("class", "mapview__nodes");
    this.handleGroup = document.createElementNS(SVG_NS, "g");
    this.handleGroup.setAttribute("class", "mapview__handles");

    this.svg.append(this.edgesGroup, this.nodesGroup, this.handleGroup);

    this.tooltip = document.createElement("div");
    this.tooltip.className = "mapview__tooltip";
    this.tooltip.hidden = true;

    // A positioned wrapper so the tooltip can be placed with plain
    // absolute coordinates relative to the SVG, without touching the
    // caller's own styling of `mount`.
    const wrapper = document.createElement("div");
    wrapper.className = "mapview__wrapper";
    wrapper.style.position = "relative";
    wrapper.style.width = "100%";
    wrapper.style.height = "100%";
    wrapper.append(this.svg, this.tooltip);
    mount.replaceChildren(wrapper);

    this.svg.addEventListener("pointerdown", this.handlePointerDown);
    this.svg.addEventListener("pointermove", this.handlePointerMove);
    this.svg.addEventListener("pointerup", this.handlePointerUp);
    this.svg.addEventListener("pointerleave", this.handlePointerUp);
    this.svg.addEventListener("pointerleave", this.hideTooltip);
    this.svg.addEventListener("wheel", this.handleWheel, { passive: false });
  }

  /** The current view's center, in user units — `null` before the first `setData`. Used by the editor to spawn a new node somewhere the user is actually looking at, rather than at a fixed content-space origin that could be far outside the current pan/zoom. */
  getViewCenter(): { x: number; y: number } | null {
    if (!this.viewBox) return null;
    return { x: this.viewBox.x + this.viewBox.w / 2, y: this.viewBox.y + this.viewBox.h / 2 };
  }

  /** Restricts panning/zooming so the viewBox can never leave (or zoom out past) this rectangle. `null` removes the restriction. */
  setBounds(bounds: MapBounds | null): void {
    this.bounds = bounds;
    if (this.viewBox) this.applyViewBox(this.clamp(this.viewBox));
  }

  /** Node clicks are only reported when the pointer barely moved between down and up — see CLICK_MOVEMENT_THRESHOLD_PX — so a pan gesture that happens to start on a node doesn't also fire a click. */
  onNodeClick(handler: (id: string) => void): void {
    this.nodeClickHandlers.push(handler);
  }

  onEdgeClick(handler: (id: string) => void): void {
    this.edgeClickHandlers.push(handler);
  }

  /** Fires with the clicked point's user-unit coordinates when a click lands on empty canvas — not a node, not an edge, not the curve handle. Used by the editor's "click to add a location here" flow. */
  onCanvasClick(handler: (x: number, y: number) => void): void {
    this.canvasClickHandlers.push(handler);
  }

  /** Opt-in: while set, dragging a node moves it (rendering live; `handler` fires once with the final position when the drag ends) instead of panning the canvas. Read-only game views never call this; the editor does. */
  enableNodeDrag(handler: (id: string, x: number, y: number) => void): void {
    this.nodeDragHandler = handler;
  }

  disableNodeDrag(): void {
    this.nodeDragHandler = null;
  }

  /** Highlights one node (`is-selected` CSS class) — editor-only, e.g. to show which node is the pending start of a new connection. `null` clears the highlight. */
  setSelectedNode(id: string | null): void {
    this.selectedNodeId = id;
    this.render();
  }

  /** Opt-in, like enableNodeDrag: while set, `selectEdgeForCurveEdit` shows a draggable control-point handle for one connection, and dragging it live-updates that edge's curve via `handler`. */
  enableCurveEdit(handler: (edgeId: string, cx: number, cy: number) => void): void {
    this.curveEditHandler = handler;
  }

  disableCurveEdit(): void {
    this.curveEditHandler = null;
    this.curveEditEdgeId = null;
    this.render();
  }

  /** Shows (or, with `null`, hides) the curve-edit handle for one edge. A straight edge gets a handle at its midpoint on first selection, becoming an explicit curve only once actually dragged. No-op if `enableCurveEdit` hasn't been called. */
  selectEdgeForCurveEdit(edgeId: string | null): void {
    if (!this.curveEditHandler) return;
    this.curveEditEdgeId = edgeId;
    this.render();
  }

  /** Replaces all rendered nodes/edges with the given data. Edges referencing an unknown node id are silently skipped — validation of that belongs to the caller (e.g. cityLoader.ts), not the renderer. The current pan/zoom is preserved across calls; use `fitToContent()` to explicitly reframe. */
  setData(nodes: MapNode[], edges: MapEdge[]): void {
    this.nodes = nodes;
    this.edges = edges;
    if (!this.viewBox) this.fitToContent();
    this.render();
  }

  /** Reframes the viewBox to fit all current nodes with a fixed margin. Called automatically on the first `setData`; call explicitly afterward (e.g. an editor "reset view" button) since further `setData` calls otherwise preserve whatever the user last panned/zoomed to. */
  fitToContent(): void {
    if (this.nodes.length === 0) {
      this.applyViewBox({ x: 0, y: 0, w: 100, h: 100 });
      return;
    }
    const margin = 60;
    const xs = this.nodes.map((n) => n.x);
    const ys = this.nodes.map((n) => n.y);
    const x = Math.min(...xs) - margin;
    const y = Math.min(...ys) - margin;
    const w = Math.max(...xs) - Math.min(...xs) + margin * 2;
    const h = Math.max(...ys) - Math.min(...ys) + margin * 2;
    this.applyViewBox(this.clamp({ x, y, w, h }));
  }

  /** Pans by a delta given in SVG user units (not screen pixels) — exposed as a pure, testable operation; DOM pointer handling converts screen-pixel drag deltas into user units before calling this. */
  panBy(dx: number, dy: number): void {
    if (!this.viewBox) return;
    this.applyViewBox(this.clamp({ ...this.viewBox, x: this.viewBox.x + dx, y: this.viewBox.y + dy }));
  }

  /** Scales the viewBox by `factor` (less than 1 zooms in) around the given user-unit point, which stays fixed on screen. */
  zoomBy(factor: number, centerX: number, centerY: number): void {
    if (!this.viewBox) return;
    const vb = this.viewBox;
    const newW = vb.w * factor;
    const newH = vb.h * factor;
    const x = centerX - ((centerX - vb.x) / vb.w) * newW;
    const y = centerY - ((centerY - vb.y) / vb.h) * newH;
    this.applyViewBox(this.clamp({ x, y, w: newW, h: newH }));
  }

  private applyViewBox(vb: ViewBox): void {
    this.viewBox = vb;
    this.svg.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  }

  /** Keeps the viewBox within `bounds` (if set) and its size within a sane zoom range. Zooming out is capped at the bounds' own size; panning is capped so the viewBox never leaves the bounds rectangle. */
  private clamp(vb: ViewBox): ViewBox {
    let { x, y, w, h } = vb;
    w = Math.max(w, MIN_VIEWBOX_SIZE);
    h = Math.max(h, MIN_VIEWBOX_SIZE);

    if (this.bounds) {
      const boundsW = this.bounds.maxX - this.bounds.minX;
      const boundsH = this.bounds.maxY - this.bounds.minY;
      w = Math.min(w, boundsW);
      h = Math.min(h, boundsH);
      x = Math.min(Math.max(x, this.bounds.minX), this.bounds.maxX - w);
      y = Math.min(Math.max(y, this.bounds.minY), this.bounds.maxY - h);
    }
    return { x, y, w, h };
  }

  private render(): void {
    const byId = new Map(this.nodes.map((n) => [n.id, n]));

    this.edgesGroup.replaceChildren(
      ...this.edges.flatMap((edge) => {
        const from = byId.get(edge.fromId);
        const to = byId.get(edge.toId);
        if (!from || !to) return [];
        const el = edge.curve
          ? this.makeCurvedEdge(edge, from, to, edge.curve)
          : this.makeStraightEdge(edge, from, to);
        return [el, ...this.makeArrowheads(edge, from, to)];
      }),
    );

    this.nodesGroup.replaceChildren(
      ...this.nodes.map((node) => {
        const group = document.createElementNS(SVG_NS, "g");
        const classes = ["mapview__node"];
        if (node.kind === "interior") classes.push("mapview__node--interior");
        if (node.id === this.selectedNodeId) classes.push("is-selected");
        group.setAttribute("class", classes.join(" "));
        group.dataset.nodeId = node.id;

        const circle = document.createElementNS(SVG_NS, "circle");
        circle.setAttribute("cx", String(node.x));
        circle.setAttribute("cy", String(node.y));
        circle.setAttribute("r", "6");

        const text = document.createElementNS(SVG_NS, "text");
        text.setAttribute("x", String(node.x + 10));
        text.setAttribute("y", String(node.y + 4));
        text.textContent = node.label;

        group.append(circle, text);
        return group;
      }),
    );

    this.handleGroup.replaceChildren(...this.renderCurveHandle(byId));
  }

  private renderCurveHandle(byId: Map<string, MapNode>): SVGGElement[] {
    if (!this.curveEditHandler || !this.curveEditEdgeId) return [];
    const edge = this.edges.find((e) => e.id === this.curveEditEdgeId);
    const from = edge && byId.get(edge.fromId);
    const to = edge && byId.get(edge.toId);
    if (!edge || !from || !to) return [];

    const point = edge.curve ?? { cx: (from.x + to.x) / 2, cy: (from.y + to.y) / 2 };
    const group = document.createElementNS(SVG_NS, "g");
    group.setAttribute("class", "mapview__curve-handle");
    group.dataset.edgeId = edge.id;
    const circle = document.createElementNS(SVG_NS, "circle");
    circle.setAttribute("cx", String(point.cx));
    circle.setAttribute("cy", String(point.cy));
    circle.setAttribute("r", "5");
    group.append(circle);
    return [group];
  }

  /** One arrowhead per entry in `edge.arrows` — a one-way edge gets 1, a two-way one gets 2, positioned at ARROW_T and 1-ARROW_T of the SAME shared path (never the midpoint) so they never overlap even on a straight line. "backward" reuses "forward"'s position formula (t = 1 - ARROW_T) but points the opposite way, since it travels toId→fromId along a path parametrized fromId→toId. */
  private makeArrowheads(edge: MapEdge, from: MapNode, to: MapNode): SVGPathElement[] {
    if (!edge.arrows || edge.arrows.length === 0) return [];
    return edge.arrows.map((direction) => {
      const t = direction === "forward" ? ARROW_T : 1 - ARROW_T;
      const { x, y, angleDeg } = pointAtT(from, to, edge.curve, t);
      const angle = direction === "forward" ? angleDeg : angleDeg + 180;
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("class", "mapview__edge-arrow");
      path.setAttribute("d", "M -6 -4 L 6 0 L -6 4 Z");
      path.setAttribute("transform", `translate(${x} ${y}) rotate(${angle})`);
      return path;
    });
  }

  private makeStraightEdge(edge: MapEdge, from: MapNode, to: MapNode): SVGLineElement {
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("class", "mapview__edge");
    line.dataset.edgeId = edge.id;
    line.setAttribute("x1", String(from.x));
    line.setAttribute("y1", String(from.y));
    line.setAttribute("x2", String(to.x));
    line.setAttribute("y2", String(to.y));
    return line;
  }

  private makeCurvedEdge(edge: MapEdge, from: MapNode, to: MapNode, curve: { cx: number; cy: number }): SVGPathElement {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("class", "mapview__edge mapview__edge--curved");
    path.dataset.edgeId = edge.id;
    path.setAttribute("fill", "none");
    path.setAttribute("d", `M ${from.x} ${from.y} Q ${curve.cx} ${curve.cy} ${to.x} ${to.y}`);
    return path;
  }

  // --- Pointer/wheel wiring — converts screen gestures into the pure pan/zoom/drag operations above ---

  private clientToUser(clientX: number, clientY: number): { x: number; y: number } {
    const vb = this.viewBox;
    const rect = this.svg.getBoundingClientRect();
    if (!vb || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    return {
      x: vb.x + ((clientX - rect.left) / rect.width) * vb.w,
      y: vb.y + ((clientY - rect.top) / rect.height) * vb.h,
    };
  }

  private handlePointerDown = (event: PointerEvent): void => {
    const target = event.target as Element;
    const handleEl = target.closest(".mapview__curve-handle") as SVGGElement | null;
    const nodeEl = target.closest(".mapview__node") as SVGGElement | null;
    // Not implemented in every test/rendering environment (e.g. jsdom) — pan/click still work without it, just without capturing the pointer once it leaves the SVG mid-drag.
    try {
      this.svg.setPointerCapture(event.pointerId);
    } catch {
      /* unsupported in this environment — non-fatal */
    }

    if (handleEl?.dataset.edgeId && this.curveEditHandler) {
      this.dragState = { kind: "handle", edgeId: handleEl.dataset.edgeId, startClientX: event.clientX, startClientY: event.clientY, moved: 0 };
    } else if (nodeEl?.dataset.nodeId && this.nodeDragHandler) {
      this.dragState = { kind: "node", nodeId: nodeEl.dataset.nodeId, startClientX: event.clientX, startClientY: event.clientY, moved: 0 };
    } else if (this.viewBox) {
      this.dragState = { kind: "pan", startClientX: event.clientX, startClientY: event.clientY, startViewBox: this.viewBox, moved: 0 };
    }
    this.hideTooltip();
  };

  /** No-op unless the pointer is currently over a node OR edge that has `tooltip` set — called on every pointermove while nothing is being dragged. Node tooltips take priority since a node's circle can sit visually on top of an edge endpoint. */
  private updateHover(event: PointerEvent): void {
    const target = event.target as Element;
    const nodeEl = target.closest(".mapview__node") as SVGGElement | null;
    const node = nodeEl?.dataset.nodeId ? this.nodes.find((n) => n.id === nodeEl.dataset.nodeId) : undefined;
    if (node?.tooltip) {
      this.showTooltip(node.tooltip, event);
      return;
    }
    const edgeEl = target.closest(".mapview__edge") as SVGElement | null;
    const edge = edgeEl?.dataset.edgeId ? this.edges.find((e) => e.id === edgeEl.dataset.edgeId) : undefined;
    if (edge?.tooltip) {
      this.showTooltip(edge.tooltip, event);
      return;
    }
    this.hideTooltip();
  }

  private showTooltip(text: string, event: PointerEvent): void {
    const wrapperRect = this.svg.getBoundingClientRect();
    this.tooltip.textContent = text;
    this.tooltip.style.left = `${event.clientX - wrapperRect.left + 12}px`;
    this.tooltip.style.top = `${event.clientY - wrapperRect.top + 12}px`;
    this.tooltip.hidden = false;
  }

  private hideTooltip = (): void => {
    this.tooltip.hidden = true;
  };

  private handlePointerMove = (event: PointerEvent): void => {
    const state = this.dragState;
    if (!state) {
      this.updateHover(event);
      return;
    }
    const dxClient = event.clientX - state.startClientX;
    const dyClient = event.clientY - state.startClientY;
    state.moved = movedDistance(dxClient, dyClient);

    if (state.kind === "pan") {
      const rect = this.svg.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const vb = state.startViewBox;
      const dxUser = (dxClient / rect.width) * vb.w;
      const dyUser = (dyClient / rect.height) * vb.h;
      this.applyViewBox(this.clamp({ ...vb, x: vb.x - dxUser, y: vb.y - dyUser }));
    } else if (state.kind === "node") {
      const { x, y } = this.clientToUser(event.clientX, event.clientY);
      const node = this.nodes.find((n) => n.id === state.nodeId);
      if (node) {
        node.x = x;
        node.y = y;
        this.render();
      }
    } else {
      const { x, y } = this.clientToUser(event.clientX, event.clientY);
      const edge = this.edges.find((e) => e.id === state.edgeId);
      if (edge) {
        edge.curve = { cx: x, cy: y };
        this.render();
      }
    }
  };

  private handlePointerUp = (event: PointerEvent): void => {
    const state = this.dragState;
    this.dragState = null;
    if (!state) return;

    if (!isClick(state.moved)) {
      if (state.kind === "node" && this.nodeDragHandler) {
        const node = this.nodes.find((n) => n.id === state.nodeId);
        if (node) this.nodeDragHandler(state.nodeId, node.x, node.y);
      } else if (state.kind === "handle" && this.curveEditHandler) {
        const edge = this.edges.find((e) => e.id === state.edgeId);
        if (edge?.curve) this.curveEditHandler(state.edgeId, edge.curve.cx, edge.curve.cy);
      }
      return;
    }

    // Below the movement threshold — treat as a click, not a drag.
    //
    // Deliberately hit-test by screen position rather than trust
    // event.target: handlePointerDown calls setPointerCapture on every
    // press (so a drag keeps receiving events after leaving the SVG), and
    // per the Pointer Events spec, once an element has pointer capture,
    // *all* subsequent events for that pointer — pointerup included — are
    // retargeted so event.target becomes the capturing element (this.svg)
    // instead of whatever's actually under the cursor. That silently broke
    // every node/edge click in real browsers (closest() on the svg root
    // itself can never match a descendant's class). jsdom doesn't
    // implement setPointerCapture — it throws, caught by the try/catch
    // above — so this never reproduced in tests; elementFromPoint isn't
    // implemented there either, hence elementAtPoint's fallback below.
    const target = (this.elementAtPoint(event.clientX, event.clientY) ?? (event.target as Element)) as Element;
    const nodeEl = target.closest(".mapview__node") as SVGGElement | null;
    if (nodeEl?.dataset.nodeId) {
      for (const h of this.nodeClickHandlers) h(nodeEl.dataset.nodeId);
      return;
    }
    const edgeEl = target.closest(".mapview__edge") as SVGElement | null;
    if (edgeEl?.dataset.edgeId) {
      for (const h of this.edgeClickHandlers) h(edgeEl.dataset.edgeId);
      return;
    }
    if (target.closest(".mapview__curve-handle")) return;
    if (this.canvasClickHandlers.length > 0) {
      const { x, y } = this.clientToUser(event.clientX, event.clientY);
      for (const h of this.canvasClickHandlers) h(x, y);
    }
  };

  /** `document.elementFromPoint` isn't implemented at all in jsdom (no `document.elementFromPoint` function, unlike the DOM-spec-standard method real browsers ship) — guarded so tests fall back to `event.target`. */
  private elementAtPoint(clientX: number, clientY: number): Element | null {
    if (typeof document.elementFromPoint !== "function") return null;
    return document.elementFromPoint(clientX, clientY);
  }

  private handleWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const { x, y } = this.clientToUser(event.clientX, event.clientY);
    const factor = event.deltaY > 0 ? 1.1 : 1 / 1.1;
    this.zoomBy(factor, x, y);
  };
}
