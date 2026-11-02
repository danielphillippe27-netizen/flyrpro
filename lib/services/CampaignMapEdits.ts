/** Campaign corrections live above immutable PMTiles. Source rows and history are never deleted. */
export type EditKind = "address" | "building" | "parcel";
export type MapEditValue = {
  hidden?: boolean;
  geometry?: { type: "Point" | "Polygon" | "MultiPolygon"; coordinates: unknown };
  buildingLinkSet?: boolean;
  buildingId?: string;
  parcelLinkSet?: boolean;
  parcelId?: string;
  sourceRevision?: string;
};
export type MapEditChange = { kind: EditKind; id: string; value: MapEditValue | null };
export type MapEditState = { revision: number; features: Record<string, MapEditValue> };

const kinds = new Set(["address", "building", "parcel"]);
const fields = new Set(["hidden", "geometry", "buildingLinkSet", "buildingId", "parcelLinkSet", "parcelId", "sourceRevision"]);
export function editKey(kind: EditKind, id: string): string { return `${kind}:${id.trim().toLowerCase()}`; }

function identifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256 &&
    value === value.trim() && !/[\u0000-\u001f]/.test(value);
}
function point(value: unknown): boolean {
  return Array.isArray(value) && value.length === 2 && value.every(v => typeof v === "number" && Number.isFinite(v)) &&
    Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90;
}
function polygon(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0 && value.every(ring =>
    Array.isArray(ring) && ring.length >= 4 && ring.every(point) &&
    ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]);
}

/** Reject the entire batch before writing anything. Null means remove an override (undo). */
export function validateMapEditChanges(input: unknown): MapEditChange[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 500) throw new Error("Select between 1 and 500 items.");
  const seen = new Set<string>();
  let vertices = 0;
  return input.map(change => {
    if (!change || !kinds.has(change.kind) || !identifier(change.id) || !("value" in change)) throw new Error("Invalid map item.");
    const id = change.id.toLowerCase();
    const key = editKey(change.kind, id);
    if (seen.has(key)) throw new Error("An item can only be changed once per batch.");
    seen.add(key);
    const v = change.value;
    if (v !== null) {
      if (!v || Array.isArray(v) || typeof v !== "object" || Object.keys(v).some(k => !fields.has(k))) throw new Error("Invalid correction.");
      for (const field of ["hidden", "buildingLinkSet", "parcelLinkSet"]) {
        if (field in v && typeof v[field] !== "boolean") throw new Error("Invalid correction flag.");
      }
      for (const field of ["buildingId", "parcelId", "sourceRevision"]) {
        if (field in v && !identifier(v[field])) throw new Error("Invalid linked item.");
      }
      if (("buildingId" in v && !v.buildingLinkSet) || (v.buildingLinkSet && change.kind !== "address")) throw new Error("Invalid building link.");
      if ("parcelId" in v && !v.parcelLinkSet) throw new Error("Invalid parcel link.");
      if ("geometry" in v) {
        const g = v.geometry;
        if (!g || typeof g !== "object" || Array.isArray(g)) throw new Error("Invalid geometry.");
        if (Object.keys(g).some(k => k !== "type" && k !== "coordinates")) throw new Error("Invalid geometry.");
        const valid = change.kind === "address" ? g.type === "Point" && point(g.coordinates) :
          (g.type === "Polygon" && polygon(g.coordinates)) ||
          (g.type === "MultiPolygon" && Array.isArray(g.coordinates) && g.coordinates.length > 0 && g.coordinates.every(polygon));
        if (!valid) throw new Error("Invalid geometry.");
        const count = (node: unknown): number => Array.isArray(node) ? (typeof node[0] === "number" ? 1 : node.reduce<number>((n, child) => n + count(child), 0)) : 0;
        vertices += count(g.coordinates);
        if (vertices > 100_000) throw new Error("This edit contains too much geometry.");
      }
    }
    return { kind: change.kind, id, value: v };
  });
}

export function applyMapEditChanges(state: MapEditState, changes: MapEditChange[]): MapEditState {
  const features = { ...state.features };
  for (const change of changes) {
    const key = editKey(change.kind, change.id);
    if (change.value === null) delete features[key]; else features[key] = change.value;
  }
  return { revision: state.revision + 1, features };
}
