import { describe, expect, it } from "vitest";
import type { Location } from "../engine/types";
import { buildConnectionEdges } from "./connectionEdges";

function loc(id: string, connections: Location["connections"]): Location {
  return { id, nameKey: `location.${id}.name`, descriptionKey: `location.${id}.description`, aliases: [id], connections, x: 0, y: 0, kind: "exterior" };
}

const nameOf = (id: string) => id.toUpperCase();

describe("buildConnectionEdges", () => {
  it("groups a one-way Connection into a single edge with one forward arrow", () => {
    const groups = buildConnectionEdges([loc("a", [{ toId: "b" }]), loc("b", [])], nameOf);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.edge.arrows).toEqual(["forward"]);
    expect(groups[0]!.entries).toHaveLength(1);
  });

  it("groups a two-way pair into one edge with both arrows", () => {
    const groups = buildConnectionEdges([loc("a", [{ toId: "b" }]), loc("b", [{ toId: "a" }])], nameOf);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.edge.arrows).toEqual(["forward", "backward"]);
    expect(groups[0]!.entries).toHaveLength(2);
  });

  it("merges multiple same-pair Connections into one edge, not one per Connection", () => {
    const groups = buildConnectionEdges([loc("a", [{ toId: "b" }, { toId: "b", compassLabel: "up" }]), loc("b", [])], nameOf);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.entries).toHaveLength(2);
  });

  it("has no tooltip when nothing carries a compass label", () => {
    const groups = buildConnectionEdges([loc("a", [{ toId: "b" }]), loc("b", [{ toId: "a" }])], nameOf);
    expect(groups[0]!.edge.tooltip).toBeUndefined();
  });

  it("shows a single un-split tooltip when both directions carry the same label", () => {
    const groups = buildConnectionEdges(
      [loc("a", [{ toId: "b", compassLabel: "north" }]), loc("b", [{ toId: "a", compassLabel: "north" }])],
      nameOf,
    );
    expect(groups[0]!.edge.tooltip).toBe("north");
  });

  it("splits the tooltip by direction when the two directions differ", () => {
    const groups = buildConnectionEdges(
      [loc("a", [{ toId: "b", compassLabel: "north" }]), loc("b", [{ toId: "a", compassLabel: "south" }])],
      nameOf,
    );
    expect(groups[0]!.edge.tooltip).toBe("A → B: north\nB → A: south");
  });

  it("skips a Connection whose destination isn't in the given location list", () => {
    const groups = buildConnectionEdges([loc("a", [{ toId: "ghost" }])], nameOf);
    expect(groups).toHaveLength(0);
  });
});
