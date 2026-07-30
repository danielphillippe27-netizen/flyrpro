export const DEMO_HOME_VISIT_DURATION_MS = 900;
export const DEMO_STREET_TRANSITION_MS = 350;
export const DEMO_FINALE_MAX_DURATION_MS = 1800;
export const MAX_DEMO_ASSIGNMENT_HOMES = 96;

export type DemoLiveMember = {
  user_id: string;
  display_name: string;
  color: string;
};

export type DemoBuildingCandidate = {
  id: string;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  center: [number, number];
  streetName?: string | null;
  houseNumber?: string | number | null;
};

export type DemoChoreographyBuilding = DemoBuildingCandidate & {
  streetKey: string;
  assigneeId: string | null;
  assigneeName: string | null;
  assigneeColor: string | null;
  sequence: number | null;
  activeFromMs: number | null;
  completeAtMs: number | null;
  finaleAtMs: number;
};

export type DemoLiveChoreography = {
  buildings: DemoChoreographyBuilding[];
  assignedHomes: DemoChoreographyBuilding[];
  assignmentDurationMs: number;
  finaleDurationMs: number;
  totalDurationMs: number;
};

export type DemoBuildingPhase = 'context' | 'upcoming' | 'active' | 'completed';

function normalizeStreetName(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/\s+/g, ' ')
    : '';
}

function numericHouseNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const parsed = Number(value.match(/\d+/)?.[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function geometricStreetKey(candidate: DemoBuildingCandidate): string {
  // Roughly 11 m latitude buckets keep metadata-free homes moving in readable rows.
  return `near-${Math.round(candidate.center[1] * 10_000)}`;
}

function streetKey(candidate: DemoBuildingCandidate): string {
  return normalizeStreetName(candidate.streetName) || geometricStreetKey(candidate);
}

function orderNearest<T extends DemoBuildingCandidate>(homes: T[]): T[] {
  if (homes.length <= 2) return [...homes];
  const remaining = [...homes].sort((left, right) =>
    right.center[1] - left.center[1] || left.center[0] - right.center[0]
  );
  const ordered = [remaining.shift()!];
  while (remaining.length > 0) {
    const previous = ordered[ordered.length - 1].center;
    let closestIndex = 0;
    let closestDistance = Number.POSITIVE_INFINITY;
    remaining.forEach((home, index) => {
      const lngDelta = home.center[0] - previous[0];
      const latDelta = home.center[1] - previous[1];
      const distance = lngDelta * lngDelta + latDelta * latDelta;
      if (distance < closestDistance) {
        closestIndex = index;
        closestDistance = distance;
      }
    });
    ordered.push(remaining.splice(closestIndex, 1)[0]);
  }
  return ordered;
}

function orderStreetHomes<T extends DemoBuildingCandidate>(homes: T[]): T[] {
  const withNumbers = homes.filter((home) => numericHouseNumber(home.houseNumber) !== null);
  if (withNumbers.length < Math.ceil(homes.length * 0.6)) return orderNearest(homes);
  return [...homes].sort((left, right) => {
    const leftNumber = numericHouseNumber(left.houseNumber) ?? Number.MAX_SAFE_INTEGER;
    const rightNumber = numericHouseNumber(right.houseNumber) ?? Number.MAX_SAFE_INTEGER;
    return leftNumber - rightNumber || left.center[0] - right.center[0] || left.id.localeCompare(right.id);
  });
}

function orderZoneByStreet<T extends DemoBuildingCandidate>(homes: T[]): Array<{ key: string; homes: T[] }> {
  const grouped = new Map<string, T[]>();
  homes.forEach((home) => {
    const key = streetKey(home);
    grouped.set(key, [...(grouped.get(key) ?? []), home]);
  });

  return Array.from(grouped.entries())
    .map(([key, entries]) => ({
      key,
      homes: orderStreetHomes(entries),
      center: entries.reduce(
        (sum, home) => [sum[0] + home.center[0] / entries.length, sum[1] + home.center[1] / entries.length] as [number, number],
        [0, 0] as [number, number],
      ),
    }))
    .sort((left, right) => right.center[1] - left.center[1] || left.center[0] - right.center[0])
    .map(({ key, homes: entries }) => ({ key, homes: entries }));
}

function selectContiguousStreetHomes<T extends DemoBuildingCandidate>(homes: T[], limit: number): T[] {
  if (limit <= 0) return [];

  const selected: T[] = [];
  for (const segment of orderZoneByStreet(homes)) {
    const remaining = limit - selected.length;
    if (remaining <= 0) break;

    if (segment.homes.length <= remaining) {
      selected.push(...segment.homes);
      continue;
    }

    // Keep a continuous run within the street instead of sampling scattered
    // house numbers from across the full segment.
    const start = Math.max(0, Math.floor((segment.homes.length - remaining) / 2));
    selected.push(...segment.homes.slice(start, start + remaining));
  }

  return selected;
}

function selectDenseStreetCluster<T extends DemoBuildingCandidate>(homes: T[], limit: number): T[] {
  if (limit <= 0) return [];
  if (homes.length <= limit) return [...homes];

  // Find the busiest walkable neighborhood first. This prevents a large
  // campaign bundle from assigning the four reps to unrelated parts of a city.
  const averageLatitude = homes.reduce((sum, home) => sum + home.center[1], 0) / homes.length;
  const longitudeScale = Math.max(Math.cos((averageLatitude * Math.PI) / 180), 0.25);
  const cellSize = 0.0035;
  const cells = new Map<string, { x: number; y: number; homes: T[] }>();
  homes.forEach((home) => {
    const x = Math.floor((home.center[0] * longitudeScale) / cellSize);
    const y = Math.floor(home.center[1] / cellSize);
    const key = `${x}:${y}`;
    const cell = cells.get(key) ?? { x, y, homes: [] };
    cell.homes.push(home);
    cells.set(key, cell);
  });

  let anchorCell: { x: number; y: number; homes: T[] } | null = null;
  let anchorScore = -1;
  Array.from(cells.values()).forEach((cell) => {
    let score = 0;
    for (let xOffset = -1; xOffset <= 1; xOffset += 1) {
      for (let yOffset = -1; yOffset <= 1; yOffset += 1) {
        score += cells.get(`${cell.x + xOffset}:${cell.y + yOffset}`)?.homes.length ?? 0;
      }
    }
    if (score > anchorScore) {
      anchorCell = cell;
      anchorScore = score;
    }
  });

  if (!anchorCell) return selectContiguousStreetHomes(homes, limit);
  const anchorNeighborhood = homes.filter((home) => {
    const x = Math.floor((home.center[0] * longitudeScale) / cellSize);
    const y = Math.floor(home.center[1] / cellSize);
    return Math.abs(x - anchorCell!.x) <= 1 && Math.abs(y - anchorCell!.y) <= 1;
  });
  const anchor = anchorNeighborhood.reduce(
    (sum, home) => [
      sum[0] + home.center[0] / anchorNeighborhood.length,
      sum[1] + home.center[1] / anchorNeighborhood.length,
    ] as [number, number],
    [0, 0] as [number, number],
  );
  const distanceFromAnchor = (home: DemoBuildingCandidate) => {
    const lngDelta = (home.center[0] - anchor[0]) * longitudeScale;
    const latDelta = home.center[1] - anchor[1];
    return lngDelta * lngDelta + latDelta * latDelta;
  };

  // Keep a generous local pool so we can prefer whole street runs without
  // letting a single city-spanning street pull the assignment miles away.
  const localPool = [...homes]
    .sort((left, right) => distanceFromAnchor(left) - distanceFromAnchor(right))
    .slice(0, Math.min(homes.length, Math.max(limit * 4, limit)));
  const segments = orderZoneByStreet(localPool)
    .map((segment) => ({
      ...segment,
      distance: Math.min(...segment.homes.map(distanceFromAnchor)),
    }))
    .sort((left, right) => left.distance - right.distance || left.key.localeCompare(right.key));

  const selected: T[] = [];
  for (const segment of segments) {
    const remaining = limit - selected.length;
    if (remaining <= 0) break;
    if (segment.homes.length <= remaining) {
      selected.push(...segment.homes);
      continue;
    }

    const closestIndex = segment.homes.reduce(
      (bestIndex, home, index) =>
        distanceFromAnchor(home) < distanceFromAnchor(segment.homes[bestIndex]) ? index : bestIndex,
      0,
    );
    const start = Math.max(0, Math.min(
      segment.homes.length - remaining,
      closestIndex - Math.floor(remaining / 2),
    ));
    selected.push(...segment.homes.slice(start, start + remaining));
  }

  return selected;
}

export function buildDemoLiveChoreography(
  candidates: DemoBuildingCandidate[],
  members: DemoLiveMember[],
  assignmentLimit = MAX_DEMO_ASSIGNMENT_HOMES,
): DemoLiveChoreography {
  const uniqueCandidates = Array.from(
    new Map(candidates.map((candidate) => [candidate.id, candidate])).values(),
  );
  const spatiallySorted = [...uniqueCandidates].sort((left, right) =>
    left.center[0] - right.center[0] || right.center[1] - left.center[1]
  );
  const targetAssignmentCount = Math.min(
    spatiallySorted.length,
    Math.max(0, assignmentLimit),
  );
  const localCandidates = selectDenseStreetCluster(spatiallySorted, targetAssignmentCount);
  const localSpatiallySorted = [...localCandidates].sort((left, right) =>
    left.center[0] - right.center[0] || right.center[1] - left.center[1]
  );
  const sampled = members.flatMap((_, memberIndex) => {
    const zoneStart = Math.floor((memberIndex * localSpatiallySorted.length) / Math.max(members.length, 1));
    const zoneEnd = Math.floor(((memberIndex + 1) * localSpatiallySorted.length) / Math.max(members.length, 1));
    const assignmentStart = Math.floor((memberIndex * targetAssignmentCount) / Math.max(members.length, 1));
    const assignmentEnd = Math.floor(((memberIndex + 1) * targetAssignmentCount) / Math.max(members.length, 1));
    return selectContiguousStreetHomes(
      localSpatiallySorted.slice(zoneStart, zoneEnd),
      assignmentEnd - assignmentStart,
    );
  });
  const sampledIds = new Set(sampled.map((candidate) => candidate.id));
  const assignedById = new Map<string, DemoChoreographyBuilding>();

  members.forEach((member, memberIndex) => {
    const start = Math.floor((memberIndex * sampled.length) / Math.max(members.length, 1));
    const end = Math.floor(((memberIndex + 1) * sampled.length) / Math.max(members.length, 1));
    const segments = orderZoneByStreet(sampled.slice(start, end));
    let sequence = 0;
    let cursorMs = 0;

    segments.forEach((segment, segmentIndex) => {
      if (segmentIndex > 0) cursorMs += DEMO_STREET_TRANSITION_MS;
      segment.homes.forEach((home) => {
        const activeFromMs = cursorMs;
        cursorMs += DEMO_HOME_VISIT_DURATION_MS;
        assignedById.set(home.id, {
          ...home,
          streetKey: segment.key,
          assigneeId: member.user_id,
          assigneeName: member.display_name,
          assigneeColor: member.color,
          sequence,
          activeFromMs,
          completeAtMs: cursorMs,
          finaleAtMs: cursorMs,
        });
        sequence += 1;
      });
    });
  });

  const assignedHomes = Array.from(assignedById.values());
  const assignmentDurationMs = assignedHomes.reduce(
    (maximum, home) => Math.max(maximum, home.completeAtMs ?? 0),
    0,
  );
  const contextCandidates = spatiallySorted.filter((candidate) => !sampledIds.has(candidate.id));
  const finaleGroups = orderZoneByStreet(contextCandidates);
  const finaleStepMs = finaleGroups.length > 1
    ? Math.min(120, DEMO_FINALE_MAX_DURATION_MS / (finaleGroups.length - 1))
    : 0;
  const finaleAtById = new Map<string, number>();
  finaleGroups.forEach((group, groupIndex) => {
    const revealAt = assignmentDurationMs + groupIndex * finaleStepMs;
    group.homes.forEach((home) => finaleAtById.set(home.id, revealAt));
  });
  const finaleDurationMs = contextCandidates.length > 0
    ? Math.min(DEMO_FINALE_MAX_DURATION_MS, Math.max(0, (finaleGroups.length - 1) * finaleStepMs))
    : 0;

  const buildings = spatiallySorted.map((candidate) => {
    const assigned = assignedById.get(candidate.id);
    if (assigned) return assigned;
    return {
      ...candidate,
      streetKey: streetKey(candidate),
      assigneeId: null,
      assigneeName: null,
      assigneeColor: null,
      sequence: null,
      activeFromMs: null,
      completeAtMs: null,
      finaleAtMs: finaleAtById.get(candidate.id) ?? assignmentDurationMs,
    } satisfies DemoChoreographyBuilding;
  });

  return {
    buildings,
    assignedHomes,
    assignmentDurationMs,
    finaleDurationMs,
    totalDurationMs: assignmentDurationMs + finaleDurationMs,
  };
}

export function demoBuildingPhase(home: DemoChoreographyBuilding, elapsedMs: number): DemoBuildingPhase {
  if (home.completeAtMs !== null) {
    if (elapsedMs >= home.completeAtMs) return 'completed';
    if (home.activeFromMs !== null && elapsedMs >= home.activeFromMs) return 'active';
    return 'upcoming';
  }
  return elapsedMs >= home.finaleAtMs ? 'completed' : 'context';
}

export function completedAssignedHomes(choreography: DemoLiveChoreography, elapsedMs: number): number {
  return choreography.assignedHomes.filter(
    (home) => home.completeAtMs !== null && elapsedMs >= home.completeAtMs,
  ).length;
}

export function demoMemberHomes(
  choreography: DemoLiveChoreography,
  memberId: string,
): DemoChoreographyBuilding[] {
  return choreography.assignedHomes
    .filter((home) => home.assigneeId === memberId)
    .sort((left, right) => (left.sequence ?? 0) - (right.sequence ?? 0));
}
