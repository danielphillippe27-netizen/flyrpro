export type CampaignAssignmentMode = 'zone_split' | 'whole_team';
export type CampaignAssignmentStatus = 'assigned' | 'in_progress' | 'completed' | 'cancelled';
export type CampaignAssignmentSplitMode = 'natural' | 'balanced';

export type ZoneAssignmentInput = {
  userId: string;
  addressIds: string[];
};

export type NormalizedZoneAssignment = {
  userId: string;
  addressIds: string[];
  goalHomes: number;
  zoneIndex: number;
};

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

export function distributeWholeTeamGoals(totalHomes: number, memberIds: string[]): Map<string, number> {
  const normalizedMemberIds = uniqueStrings(memberIds);
  const safeTotal = Math.max(0, Math.floor(totalHomes) || 0);
  const goals = new Map<string, number>();

  if (normalizedMemberIds.length === 0) return goals;

  const base = Math.floor(safeTotal / normalizedMemberIds.length);
  const remainder = safeTotal % normalizedMemberIds.length;

  normalizedMemberIds.forEach((memberId, index) => {
    goals.set(memberId, base + (index < remainder ? 1 : 0));
  });

  return goals;
}

export function normalizeZoneAssignments(params: {
  memberIds: string[];
  zoneAssignments: ZoneAssignmentInput[];
  campaignAddressIds: string[];
}): NormalizedZoneAssignment[] {
  const memberIds = uniqueStrings(params.memberIds);
  const validAddressIds = new Set(uniqueStrings(params.campaignAddressIds));
  const zoneAssignments = Array.isArray(params.zoneAssignments) ? params.zoneAssignments : [];

  if (memberIds.length === 0) {
    throw new Error('At least one member is required.');
  }
  if (zoneAssignments.length !== memberIds.length) {
    throw new Error('Zone assignments must include exactly one zone per selected member.');
  }

  const selectedMemberSet = new Set(memberIds);
  const seenMembers = new Set<string>();
  const seenAddresses = new Set<string>();
  const normalized: NormalizedZoneAssignment[] = [];

  zoneAssignments.forEach((zone, index) => {
    const userId = typeof zone.userId === 'string' ? zone.userId.trim() : '';
    if (!selectedMemberSet.has(userId)) {
      throw new Error('Zone assignment contains a user outside the selected members.');
    }
    if (seenMembers.has(userId)) {
      throw new Error('Zone assignment contains a duplicate member.');
    }

    const addressIds = uniqueStrings(Array.isArray(zone.addressIds) ? zone.addressIds : []);
    if (addressIds.length === 0) {
      throw new Error('Every selected member needs at least one assigned home.');
    }

    addressIds.forEach((addressId) => {
      if (!validAddressIds.has(addressId)) {
        throw new Error('Zone assignment contains a home outside this campaign.');
      }
      if (seenAddresses.has(addressId)) {
        throw new Error('Zone assignment contains a duplicate home.');
      }
      seenAddresses.add(addressId);
    });

    seenMembers.add(userId);
    normalized.push({
      userId,
      addressIds,
      goalHomes: addressIds.length,
      zoneIndex: index + 1,
    });
  });

  if (seenAddresses.size !== validAddressIds.size) {
    throw new Error('Zone assignments must include every campaign home exactly once.');
  }

  return normalized;
}
