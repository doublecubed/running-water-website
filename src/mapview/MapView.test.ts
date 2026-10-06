import { describe, expect, it } from "vitest";
import { MapView, pointAtT } from "./MapView";

function makeMount(): HTMLElement {
  const el = document.createElement("div");
  document.body.append(el);
  return el;
}

/** jsdom does no real layout — every element's getBoundingClientRect() is all-zero by default. Pointer-drag math needs a real rect to convert client pixels to SVG user units, so tests exercising that stub a fixed one. */
function stubRect(svg: SVGSVGElement, rect: { left: number; top: number; width: number; height: number }): void {
  svg.getBoundingClientRect = () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height, x: rect.left, y: rect.top, toJSON: () => rect });
}

/** jsdom doesn't implement the PointerEvent constructor — a plain MouseEvent with the same clientX/clientY carries everything MapView's handlers actually read (the `pointerId` field, only used for the try/catch-guarded setPointerCapture call, is left undefined). */
function pointer(type: string, opts: { clientX: number; clientY: number }): Event {
  return new MouseEvent(type, { clientX: opts.clientX, clientY: opts.clientY, bubbles: true });
}

describe("pointAtT", () => {
  it("interpolates a straight line's point and tangent angle", () => {
    const from = { x: 0, y: 0 };
    const to = { x: 100, y: 0 };
    expect(pointAtT(from, to, undefined, 0)).toEqual({ x: 0, y: 0, angleDeg: 0 });
    expect(pointAtT(from, to, undefined, 1)).toEqual({ x: 100, y: 0, angleDeg: 0 });
    const mid = pointAtT(from, to, undefined, 0.6);
    expect(mid.x).toBeCloseTo(60);
    expect(mid.y).toBeCloseTo(0);
    expect(mid.angleDeg).toBeCloseTo(0);
  });

  it("follows a quadratic bezier's curve and tangent, not the straight-line chord", () => {
    const from = { x: 0, y: 0 };
    const to = { x: 100, y: 0 };
    const curve = { cx: 50, cy: 40 };
    const point = pointAtT(from, to, curve, 0.5);
    // B(0.5) for this control point is (50, 20) — above the straight chord (y=0).
    expect(point.x).toBeCloseTo(50);
    expect(point.y).toBeCloseTo(20);
    // Tangent at the midpoint of a symmetric bezier points straight along +x (angle 0).
    expect(point.angleDeg).toBeCloseTo(0);
  });

  it("t=0.6 and t=0.4 land at different points on a curve, matching the two-way arrow placement", () => {
    const from = { x: 0, y: 0 };
    const to = { x: 100, y: 0 };
    const curve = { cx: 50, cy: 40 };
    const forward = pointAtT(from, to, curve, 0.6);
    const backward = pointAtT(from, to, curve, 0.4);
    expect(forward.x).not.toBeCloseTo(backward.x);
    // Symmetric about x=50 for this symmetric curve.
    expect(forward.x + backward.x).toBeCloseTo(100);
    expect(forward.y).toBeCloseTo(backward.y);
  });
});

describe("MapView — rendering", () => {
  it("renders one circle+label per node and one line per edge", () => {
    const mount = makeMount();
    const view = new MapView(mount);
    view.setData(
      [
        { id: "a", x: 0, y: 0, label: "Alley" },
        { id: "b", x: 100, y: 50, label: "Street" },
      ],
      [{ id: "a-b", fromId: "a", toId: "b" }],
    );

    const svg = mount.querySelector("svg")!;
    expect(svg).not.toBeNull();
    expect(svg.querySelectorAll(".mapview__node")).toHaveLength(2);
    expect(svg.querySelectorAll(".mapview__edge")).toHaveLength(1);

    const nodeA = svg.querySelector('[data-node-id="a"]')!;
    expect(nodeA.querySelector("circle")!.getAttribute("cx")).toBe("0");
    expect(nodeA.querySelector("circle")!.getAttribute("cy")).toBe("0");
    expect(nodeA.querySelector("text")!.textContent).toBe("Alley");

    const edge = svg.querySelector('[data-edge-id="a-b"]')!;
    expect(edge.getAttribute("x1")).toBe("0");
    expect(edge.getAttribute("y1")).toBe("0");
    expect(edge.getAttribute("x2")).toBe("100");
    expect(edge.getAttribute("y2")).toBe("50");
  });

  it("adds mapview__node--interior only for a node with kind: interior", () => {
    const mount = makeMount();
    const view = new MapView(mount);
    view.setData(
      [
        { id: "a", x: 0, y: 0, label: "Alley", kind: "exterior" },
        { id: "b", x: 10, y: 10, label: "Lobby", kind: "interior" },
        { id: "c", x: 20, y: 20, label: "Street" },
      ],
      [],
    );

    const svg = mount.querySelector("svg")!;
    expect(svg.querySelector('[data-node-id="a"]')!.classList.contains("mapview__node--interior")).toBe(false);
    expect(svg.querySelector('[data-node-id="b"]')!.classList.contains("mapview__node--interior")).toBe(true);
    expect(svg.querySelector('[data-node-id="c"]')!.classList.contains("mapview__node--interior")).toBe(false);
  });

  it("renders a curved edge as a quadratic-bezier path instead of a line", () => {
    const mount = makeMount();
    const view = new MapView(mount);
    view.setData(
      [
        { id: "a", x: 0, y: 0, label: "A" },
        { id: "b", x: 100, y: 0, label: "B" },
      ],
      [{ id: "a-b", fromId: "a", toId: "b", curve: { cx: 50, cy: 40 } }],
    );

    const svg = mount.querySelector("svg")!;
    const edge = svg.querySelector('[data-edge-id="a-b"]')!;
    expect(edge.tagName).toBe("path");
    expect(edge.getAttribute("d")).toBe("M 0 0 Q 50 40 100 0");
  });

  it("draws one arrowhead for a one-way edge and two for a two-way one", () => {
    const mount = makeMount();
    const view = new MapView(mount);
    view.setData(
      [
        { id: "a", x: 0, y: 0, label: "A" },
        { id: "b", x: 100, y: 0, label: "B" },
        { id: "c", x: 0, y: 100, label: "C" },
        { id: "d", x: 100, y: 100, label: "D" },
      ],
      [
        { id: "a-b", fromId: "a", toId: "b", arrows: ["forward"] },
        { id: "c-d", fromId: "c", toId: "d", arrows: ["forward", "backward"] },
      ],
    );

    const svg = mount.querySelector("svg")!;
    expect(svg.querySelectorAll(".mapview__edge-arrow")).toHaveLength(3);
  });

  it("draws no arrowhead for an edge with no `arrows` set", () => {
    const mount = makeMount();
    const view = new MapView(mount);
    view.setData(
      [
        { id: "a", x: 0, y: 0, label: "A" },
        { id: "b", x: 100, y: 0, label: "B" },
      ],
      [{ id: "a-b", fromId: "a", toId: "b" }],
    );

    const svg = mount.querySelector("svg")!;
    expect(svg.querySelectorAll(".mapview__edge-arrow")).toHaveLength(0);
  });

  it("silently skips an edge referencing an unknown node id", () => {
    const mount = makeMount();
    const view = new MapView(mount);
    view.setData([{ id: "a", x: 0, y: 0, label: "Alley" }], [{ id: "a-ghost", fromId: "a", toId: "ghost" }]);

    const svg = mount.querySelector("svg")!;
    expect(svg.querySelectorAll(".mapview__edge")).toHaveLength(0);
  });

  it("replaces previously rendered data on a second setData call", () => {
    const mount = makeMount();
    const view = new MapView(mount);
    view.setData([{ id: "a", x: 0, y: 0, label: "Alley" }], []);
    view.setData([{ id: "b", x: 5, y: 5, label: "Street" }], []);

    const svg = mount.querySelector("svg")!;
    expect(svg.querySelectorAll(".mapview__node")).toHaveLength(1);
    expect(svg.querySelector('[data-node-id="b"]')).not.toBeNull();
    expect(svg.querySelector('[data-node-id="a"]')).toBeNull();
  });

  it("sets a fallback viewBox when given no nodes", () => {
    const mount = makeMount();
    const view = new MapView(mount);
    view.setData([], []);

    const svg = mount.querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe("0 0 100 100");
  });

  it("preserves the current viewBox across a second setData call rather than re-fitting", () => {
    const mount = makeMount();
    const view = new MapView(mount);
    view.setData([{ id: "a", x: 0, y: 0, label: "A" }], []);
    view.panBy(1000, 1000);
    const panned = mount.querySelector("svg")!.getAttribute("viewBox");

    view.setData([{ id: "b", x: 0, y: 0, label: "B" }], []);
    expect(mount.querySelector("svg")!.getAttribute("viewBox")).toBe(panned);
  });
});

describe("MapView — pan/zoom", () => {
  it("panBy shifts the viewBox origin without touching node positions", () => {
    const mount = makeMount();
    const view = new MapView(mount);
    view.setData([{ id: "a", x: 0, y: 0, label: "A" }], []);
    const before = mount.querySelector("svg")!.getAttribute("viewBox")!;
    const [bx, by, bw, bh] = before.split(" ").map(Number) as [number, number, number, number];

    view.panBy(10, -5);
    const after = mount.querySelector("svg")!.getAttribute("viewBox")!;
    const [ax, ay, aw, ah] = after.split(" ").map(Number) as [number, number, number, number];

    expect(ax).toBeCloseTo(bx + 10);
    expect(ay).toBeCloseTo(by - 5);
    expect(aw).toBeCloseTo(bw);
    expect(ah).toBeCloseTo(bh);
    expect(mount.querySelector("circle")!.getAttribute("cx")).toBe("0");
  });

  it("zoomBy shrinks the viewBox and keeps the given center point fixed", () => {
    const mount = makeMount();
    const view = new MapView(mount);
    view.setData([{ id: "a", x: 0, y: 0, label: "A" }], []);
    view.zoomBy(0.5, 0, 0);

    const [, , w, h] = mount.querySelector("svg")!.getAttribute("viewBox")!.split(" ").map(Number);
    const before = 60 * 2 + 0; // fitToContent margin*2 for a single node
    expect(w).toBeCloseTo(before * 0.5);
    expect(h).toBeCloseTo(before * 0.5);
  });

  it("setBounds clamps panning so the viewBox can't leave the bounds rectangle", () => {
    const mount = makeMount();
    const view = new MapView(mount);
    view.setData([{ id: "a", x: 0, y: 0, label: "A" }], []);
    view.setBounds({ minX: -50, minY: -50, maxX: 50, maxY: 50 });

    view.panBy(-10000, -10000);
    const [x, y] = mount.querySelector("svg")!.getAttribute("viewBox")!.split(" ").map(Number);
    expect(x).toBeCloseTo(-50);
    expect(y).toBeCloseTo(-50);
  });

  it("setBounds caps the zoomed-out viewBox size to the bounds' own size", () => {
    const mount = makeMount();
    const view = new MapView(mount);
    view.setData([{ id: "a", x: 0, y: 0, label: "A" }], []);
    view.setBounds({ minX: 0, minY: 0, maxX: 40, maxY: 40 });
    view.zoomBy(100, 0, 0);

    const [, , w, h] = mount.querySelector("svg")!.getAttribute("viewBox")!.split(" ").map(Number);
    expect(w).toBeCloseTo(40);
    expect(h).toBeCloseTo(40);
  });
});

describe("MapView — click/drag interaction", () => {
  it("fires onNodeClick when a press and release happen at the same point on a node", () => {
    const mount = makeMount();
    const view = new MapView(mount);
    view.setData([{ id: "a", x: 0, y: 0, label: "A" }], []);
    const svg = mount.querySelector("svg")!;
    stubRect(svg, { left: 0, top: 0, width: 200, height: 200 });

    const clicked: string[] = [];
    view.onNodeClick((id) => clicked.push(id));

    const circle = svg.querySelector("circle")!;
    circle.dispatchEvent(pointer("pointerdown", { clientX: 100, clientY: 100 }));
    circle.dispatchEvent(pointer("pointerup", { clientX: 100, clientY: 100 }));

    expect(clicked).toEqual(["a"]);
  });

  it("fires onEdgeClick, not onNodeClick, when clicking an edge", () => {
    const mount = makeMount();
    const view = new MapView(mount);
    view.setData(
      [
        { id: "a", x: 0, y: 0, label: "A" },
        { id: "b", x: 100, y: 0, label: "B" },
      ],
      [{ id: "a-b", fromId: "a", toId: "b" }],
    );
    const svg = mount.querySelector("svg")!;
    stubRect(svg, { left: 0, top: 0, width: 200, height: 200 });

    const nodeClicks: string[] = [];
    const edgeClicks: string[] = [];
    view.onNodeClick((id) => nodeClicks.push(id));
    view.onEdgeClick((id) => edgeClicks.push(id));

    const line = svg.querySelector(".mapview__edge")!;
    line.dispatchEvent(pointer("pointerdown", { clientX: 50, clientY: 50 }));
    line.dispatchEvent(pointer("pointerup", { clientX: 50, clientY: 50 }));

    expect(edgeClicks).toEqual(["a-b"]);
    expect(nodeClicks).toEqual([]);
  });

  it("does not fire a click when the pointer moves past the click threshold before release (a drag)", () => {
    const mount = makeMount();
    const view = new MapView(mount);
    view.setData([{ id: "a", x: 0, y: 0, label: "A" }], []);
    const svg = mount.querySelector("svg")!;
    stubRect(svg, { left: 0, top: 0, width: 200, height: 200 });

    const clicked: string[] = [];
    view.onNodeClick((id) => clicked.push(id));

    const circle = svg.querySelector("circle")!;
    circle.dispatchEvent(pointer("pointerdown", { clientX: 100, clientY: 100 }));
    svg.dispatchEvent(pointer("pointermove", { clientX: 130, clientY: 100 }));
    svg.dispatchEvent(pointer("pointerup", { clientX: 130, clientY: 100 }));

    expect(clicked).toEqual([]);
  });

  it("enableNodeDrag moves the dragged node and reports its final position on release", () => {
    const mount = makeMount();
    const view = new MapView(mount);
    view.setData([{ id: "a", x: 0, y: 0, label: "A" }], []);
    const svg = mount.querySelector("svg")!;
    stubRect(svg, { left: 0, top: 0, width: 200, height: 200 });

    const moves: { id: string; x: number; y: number }[] = [];
    view.enableNodeDrag((id, x, y) => moves.push({ id, x, y }));

    const circle = svg.querySelector("circle")!;
    circle.dispatchEvent(pointer("pointerdown", { clientX: 100, clientY: 100 }));
    svg.dispatchEvent(pointer("pointermove", { clientX: 140, clientY: 100 }));
    svg.dispatchEvent(pointer("pointerup", { clientX: 140, clientY: 100 }));

    expect(moves).toHaveLength(1);
    expect(moves[0]!.id).toBe("a");
    // Node's rendered position should have followed the drag too.
    expect(svg.querySelector("circle")!.getAttribute("cx")).toBe(String(moves[0]!.x));
  });

  it("fires onCanvasClick with user-unit coordinates when clicking empty background", () => {
    const mount = makeMount();
    const view = new MapView(mount);
    view.setData([{ id: "a", x: -50, y: -50, label: "A" }], []);
    const svg = mount.querySelector("svg")!;
    stubRect(svg, { left: 0, top: 0, width: 200, height: 200 });

    const clicks: { x: number; y: number }[] = [];
    view.onCanvasClick((x, y) => clicks.push({ x, y }));

    svg.dispatchEvent(pointer("pointerdown", { clientX: 0, clientY: 0 }));
    svg.dispatchEvent(pointer("pointerup", { clientX: 0, clientY: 0 }));

    expect(clicks).toHaveLength(1);
  });

  it("setSelectedNode adds the is-selected class to the matching node only", () => {
    const mount = makeMount();
    const view = new MapView(mount);
    view.setData(
      [
        { id: "a", x: 0, y: 0, label: "A" },
        { id: "b", x: 10, y: 10, label: "B" },
      ],
      [],
    );
    view.setSelectedNode("b");

    const svg = mount.querySelector("svg")!;
    expect(svg.querySelector('[data-node-id="a"]')!.classList.contains("is-selected")).toBe(false);
    expect(svg.querySelector('[data-node-id="b"]')!.classList.contains("is-selected")).toBe(true);
  });

  it("curve-edit: dragging the handle sets the edge's curve and reports it once on release", () => {
    const mount = makeMount();
    const view = new MapView(mount);
    view.setData(
      [
        { id: "a", x: 0, y: 0, label: "A" },
        { id: "b", x: 100, y: 0, label: "B" },
      ],
      [{ id: "a-b", fromId: "a", toId: "b" }],
    );
    const svg = mount.querySelector("svg")!;
    stubRect(svg, { left: 0, top: 0, width: 200, height: 200 });

    const updates: { edgeId: string; cx: number; cy: number }[] = [];
    view.enableCurveEdit((edgeId, cx, cy) => updates.push({ edgeId, cx, cy }));
    view.selectEdgeForCurveEdit("a-b");

    const handle = svg.querySelector(".mapview__curve-handle circle")!;
    handle.dispatchEvent(pointer("pointerdown", { clientX: 100, clientY: 100 }));
    svg.dispatchEvent(pointer("pointermove", { clientX: 100, clientY: 130 }));
    svg.dispatchEvent(pointer("pointerup", { clientX: 100, clientY: 130 }));

    expect(updates).toHaveLength(1);
    expect(updates[0]!.edgeId).toBe("a-b");
    expect(svg.querySelector('[data-edge-id="a-b"]')!.tagName).toBe("path");
  });

  it("shows a hover tooltip for a node with `tooltip` set, and hides it once the pointer leaves", () => {
    const mount = makeMount();
    const view = new MapView(mount);
    view.setData([{ id: "a", x: 0, y: 0, label: "A", tooltip: "loc-a\nAlley\nexterior" }], []);
    const svg = mount.querySelector("svg")!;
    stubRect(svg, { left: 0, top: 0, width: 200, height: 200 });

    const tooltip = mount.querySelector(".mapview__tooltip") as HTMLDivElement;
    expect(tooltip.hidden).toBe(true);

    const circle = svg.querySelector("circle")!;
    circle.dispatchEvent(pointer("pointermove", { clientX: 100, clientY: 100 }));
    expect(tooltip.hidden).toBe(false);
    expect(tooltip.textContent).toBe("loc-a\nAlley\nexterior");

    svg.dispatchEvent(pointer("pointerleave", { clientX: 100, clientY: 100 }));
    expect(tooltip.hidden).toBe(true);
  });

  it("shows a hover tooltip for an edge with `tooltip` set", () => {
    const mount = makeMount();
    const view = new MapView(mount);
    view.setData(
      [
        { id: "a", x: 0, y: 0, label: "A" },
        { id: "b", x: 100, y: 0, label: "B" },
      ],
      [{ id: "a-b", fromId: "a", toId: "b", tooltip: "foot, bus (line-1)" }],
    );
    const svg = mount.querySelector("svg")!;
    stubRect(svg, { left: 0, top: 0, width: 200, height: 200 });

    const tooltip = mount.querySelector(".mapview__tooltip") as HTMLDivElement;
    const line = svg.querySelector(".mapview__edge")!;
    line.dispatchEvent(pointer("pointermove", { clientX: 50, clientY: 50 }));

    expect(tooltip.hidden).toBe(false);
    expect(tooltip.textContent).toBe("foot, bus (line-1)");
  });

  it("does not show a tooltip for a node with no `tooltip` set", () => {
    const mount = makeMount();
    const view = new MapView(mount);
    view.setData([{ id: "a", x: 0, y: 0, label: "A" }], []);
    const svg = mount.querySelector("svg")!;
    stubRect(svg, { left: 0, top: 0, width: 200, height: 200 });

    const tooltip = mount.querySelector(".mapview__tooltip") as HTMLDivElement;
    const circle = svg.querySelector("circle")!;
    circle.dispatchEvent(pointer("pointermove", { clientX: 100, clientY: 100 }));
    expect(tooltip.hidden).toBe(true);
  });

  it("without enableNodeDrag, dragging starting on a node pans the canvas instead", () => {
    const mount = makeMount();
    const view = new MapView(mount);
    view.setData([{ id: "a", x: 0, y: 0, label: "A" }], []);
    const svg = mount.querySelector("svg")!;
    stubRect(svg, { left: 0, top: 0, width: 200, height: 200 });
    const before = svg.getAttribute("viewBox")!;

    const circle = svg.querySelector("circle")!;
    circle.dispatchEvent(pointer("pointerdown", { clientX: 100, clientY: 100 }));
    svg.dispatchEvent(pointer("pointermove", { clientX: 140, clientY: 100 }));
    svg.dispatchEvent(pointer("pointerup", { clientX: 140, clientY: 100 }));

    expect(svg.getAttribute("viewBox")).not.toBe(before);
    // The node itself never moved — only the view panned.
    expect(svg.querySelector("circle")!.getAttribute("cx")).toBe("0");
  });
});
