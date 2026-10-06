import { describe, expect, it } from "vitest";
import type { Location } from "../engine/types";
import { buildConnectionEdges } from "./connectionEdges";

function loc(id: string, connections: Location["connections"]): Location {
  return { id, nameKey: `location.${id}.name`, descriptionKey: `location.${id}.description`, aliases: [id], connections, x: 0, y: 0, kind: "exterior" };
}

const nameOf = (id: string) => id.toUpperCase();

describe("buildConnectionEdges", () => {
  it("groups a one-way Connection into a single edge with one forward arrow", () => {
    const groups = buildConnectionEdges([loc("a", [{ toId: "b", distanceKm: 1, modes: ["foot"] }]), loc("b", [])], nameOf);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.edge.arrows).toEqual(["forward"]);
    expect(groups[0]!.entries).toHaveLength(1);
  });

  it("groups a two-way pair into one edge with both arrows", () => {
    const groups = buildConnectionEdges(
      [loc("a", [{ toId: "b", distanceKm: 1, modes: ["foot"] }]), loc("b", [{ toId: "a", distanceKm: 1, modes: ["foot"] }])],
      nameOf,
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]!.edge.arrows).toEqual(["forward", "backward"]);
    expect(groups[0]!.entries).toHaveLength(2);
  });

  it("merges multiple same-pair Connections (different modes) into one edge, not one per Connection", () => {
    const groups = buildConnectionEdges(
      [
        loc("a", [
          { toId: "b", distanceKm: 1, modes: ["foot"] },
          { toId: "b", distanceKm: 1, modes: ["taxi"] },
        ]),
        loc("b", []),
      ],
      nameOf,
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]!.entries).toHaveLength(2);
  });

  it("shows a single un-split tooltip when both directions offer the same modes", () => {
    const groups = buildConnectionEdges(
      [loc("a", [{ toId: "b", distanceKm: 1, modes: ["foot"] }]), loc("b", [{ toId: "a", distanceKm: 1, modes: ["foot"] }])],
      nameOf,
    );

    expect(groups[0]!.edge.tooltip).toBe("foot");
  });

  it("splits the tooltip by direction when the two directions differ", () => {
    const groups = buildConnectionEdges(
      [loc("a", [{ toId: "b", distanceKm: 1, modes: ["foot", "taxi"] }]), loc("b", [{ toId: "a", distanceKm: 1, modes: ["foot"] }])],
      nameOf,
    );

    expect(groups[0]!.edge.tooltip).toBe("A → B: foot/taxi\nB → A: foot");
  });

  it("skips a Connection whose destination isn't in the given location list", () => {
    const groups = buildConnectionEdges([loc("a", [{ toId: "ghost", distanceKm: 1, modes: ["foot"] }])], nameOf);
    expect(groups).toHaveLength(0);
  });
});
