import type { Connection, Location } from "../engine/types";
import type { MapEdge } from "./MapView";

/**
 * One direction's real Connection within a grouped pair (see
 * `buildConnectionEdges`). `location` is the Connection's own FROM side —
 * the actual `Location` object whose `connections` array contains it —
 * needed by callers (the editor) that mutate a Connection in place (curve
 * edits) or need to know which content file to re-save.
 */
export interface ConnectionGroupEntry {
  location: Location;
  connection: Connection;
}

export interface ConnectionEdgeGroup {
  edge: MapEdge;
  /** Every real Connection between this pair, from both directions — a curve edit writes to all of them so the group keeps rendering as one consistent line. */
  entries: ConnectionGroupEntry[];
}

/**
 * Groups every real `Connection` among `locations` by UNORDERED location
 * pair rather than one `MapEdge` per `Connection` — see the (now-applied)
 * plan this implements, `docs/context.md`'s history. A foot path and a bus
 * line between the same two locations are two independent `Connection`
 * objects (the engine needs that granularity for fares/transit lines), but
 * from a player's perspective they're the same fact — "can I get there" —
 * so they render as ONE `MapEdge`, with `arrows` (which direction(s) have
 * at least one real Connection) and a hover `tooltip` summarizing modes,
 * split by direction only when the two directions actually differ.
 *
 * Shared by the editor (which also needs `entries` back, to mutate the
 * underlying Connections on a curve drag and to know which location — and
 * so which content file — each one came from) and the game's `worldmap`
 * view (which only needs `edge`).
 *
 * `nameOf` resolves a location id to display text for the tooltip, passed
 * in rather than hardcoded so the editor can use its own selected-language
 * table and the game view can use `t()` — this module stays agnostic of
 * both, like `MapView.ts` itself.
 */
export function buildConnectionEdges(locations: Location[], nameOf: (locationId: string) => string): ConnectionEdgeGroup[] {
  const byId = new Map(locations.map((loc) => [loc.id, loc]));
  const groups = new Map<string, ConnectionGroupEntry[]>();

  for (const loc of locations) {
    for (const connection of loc.connections) {
      if (!byId.has(connection.toId)) continue; // destination not in the placed/visible set — same silent-skip MapView itself does for an edge referencing an unknown node
      const pairKey = [loc.id, connection.toId].sort().join("|");
      const list = groups.get(pairKey);
      if (list) list.push({ location: loc, connection });
      else groups.set(pairKey, [{ location: loc, connection }]);
    }
  }

  const result: ConnectionEdgeGroup[] = [];
  for (const [pairKey, entries] of groups) {
    const [a, b] = pairKey.split("|") as [string, string];
    const forwardEntries = entries.filter((e) => e.location.id === a);
    const backwardEntries = entries.filter((e) => e.location.id === b);

    const arrows: ("forward" | "backward")[] = [];
    if (forwardEntries.length > 0) arrows.push("forward");
    if (backwardEntries.length > 0) arrows.push("backward");

    const forwardLabel = forwardEntries.map(connectionLabel).join(", ");
    const backwardLabel = backwardEntries.map(connectionLabel).join(", ");
    const tooltip =
      forwardLabel && backwardLabel && forwardLabel !== backwardLabel
        ? `${nameOf(a)} → ${nameOf(b)}: ${forwardLabel}\n${nameOf(b)} → ${nameOf(a)}: ${backwardLabel}`
        : forwardLabel || backwardLabel || undefined;

    // Any Connection's curve applies to the whole shared line — curve edits
    // write the same {cx,cy} to every entry (see the editor's
    // onCurveDragged), so picking the first one present is equivalent to
    // picking any of them once the group has been edited at least once.
    const curve = entries.find((e) => e.connection.curve)?.connection.curve;

    result.push({ edge: { id: `pair:${pairKey}`, fromId: a, toId: b, curve, tooltip, arrows }, entries });
  }
  return result;
}

/** e.g. "foot" or "bus (line-1)" — a single Connection's modes plus its transit line id, if any. Kept id-based rather than resolving the line's own display name, since this module has no locale table to resolve it against (see this file's doc comment on `nameOf`). */
function connectionLabel(entry: ConnectionGroupEntry): string {
  const { connection } = entry;
  const modes = connection.modes.join("/");
  return connection.transitLineId ? `${modes} (${connection.transitLineId})` : modes;
}
