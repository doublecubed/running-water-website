import { describe, expect, it } from "vitest";
import type { GameState, Location } from "../types";
import { findPath } from "./pathfinding";

function loc(id: string, ...to: string[]): Location {
  return { id, nameKey: `l.${id}`, descriptionKey: `l.${id}.d`, aliases: [id], kind: "exterior", connections: to.map((toId) => ({ toId })) };
}

function world(...locations: Location[]): GameState {
  return { locations: Object.fromEntries(locations.map((l) => [l.id, l])) } as unknown as GameState;
}

describe("findPath", () => {
  it("returns just the start when from and to are the same place", () => {
    expect(findPath(world(loc("a")), "a", "a")).toEqual(["a"]);
  });

  it("finds a direct connection", () => {
    expect(findPath(world(loc("a", "b"), loc("b")), "a", "b")).toEqual(["a", "b"]);
  });

  it("takes the route with the fewest hops, not the first one listed", () => {
    // a -> b -> c -> d is reachable, but a -> d directly is shorter.
    const state = world(loc("a", "b", "d"), loc("b", "c"), loc("c", "d"), loc("d"));
    expect(findPath(state, "a", "d")).toEqual(["a", "d"]);
  });

  it("finds a multi-hop route", () => {
    const state = world(loc("a", "b"), loc("b", "c"), loc("c", "d"), loc("d"));
    expect(findPath(state, "a", "d")).toEqual(["a", "b", "c", "d"]);
  });

  it("only follows connections the way they point", () => {
    const state = world(loc("a", "b"), loc("b"));
    expect(findPath(state, "a", "b")).toEqual(["a", "b"]);
    expect(findPath(state, "b", "a")).toBeNull();
  });

  it("returns null for an unreachable place, and survives cycles", () => {
    const state = world(loc("a", "b"), loc("b", "a"), loc("c"));
    expect(findPath(state, "a", "c")).toBeNull();
  });

  it("ignores a connection that points at a location that doesn't exist", () => {
    expect(findPath(world(loc("a", "ghost")), "a", "ghost")).toBeNull();
  });
});
