export type AssignmentDraftAddress = {
  id: string;
  sequence: number;
};

export function buildAssignmentByAddressId<TAddress extends AssignmentDraftAddress>(
  zones: Map<string, TAddress[]>
): Map<string, string> {
  const assignment = new Map<string, string>();
  zones.forEach((zoneAddresses, memberId) => {
    zoneAddresses.forEach((address) => {
      assignment.set(address.id, memberId);
    });
  });
  return assignment;
}

export function applyManualOverridesToZones<TAddress extends AssignmentDraftAddress>(
  autoZones: Map<string, TAddress[]>,
  addresses: TAddress[],
  memberIds: string[],
  manualOverrides: Record<string, string>
): Map<string, TAddress[]> {
  const zones = new Map<string, TAddress[]>();
  memberIds.forEach((memberId) => zones.set(memberId, []));
  if (memberIds.length === 0) return zones;

  const memberIdSet = new Set(memberIds);
  const addressById = new Map(addresses.map((address) => [address.id, address]));
  const autoAssignmentByAddress = buildAssignmentByAddressId(autoZones);
  const effectiveAssignmentByAddress = new Map<string, string>();

  addresses.forEach((address) => {
    const overrideMemberId = manualOverrides[address.id];
    const autoMemberId = autoAssignmentByAddress.get(address.id);
    effectiveAssignmentByAddress.set(
      address.id,
      overrideMemberId && memberIdSet.has(overrideMemberId)
        ? overrideMemberId
        : autoMemberId && memberIdSet.has(autoMemberId)
          ? autoMemberId
          : memberIds[0]
    );
  });

  const seenAddressIds = new Set<string>();
  memberIds.forEach((memberId) => {
    (autoZones.get(memberId) ?? []).forEach((address) => {
      if (effectiveAssignmentByAddress.get(address.id) !== memberId) return;
      const canonicalAddress = addressById.get(address.id);
      if (!canonicalAddress || seenAddressIds.has(address.id)) return;
      zones.get(memberId)!.push(canonicalAddress);
      seenAddressIds.add(address.id);
    });
  });

  addresses
    .slice()
    .sort((left, right) => left.sequence - right.sequence)
    .forEach((address) => {
      if (seenAddressIds.has(address.id)) return;
      const memberId = effectiveAssignmentByAddress.get(address.id);
      if (!memberId || !memberIdSet.has(memberId)) return;
      zones.get(memberId)!.push(address);
      seenAddressIds.add(address.id);
    });

  return zones;
}

export function sanitizeManualOverrides<TAddress extends AssignmentDraftAddress>(
  manualOverrides: Record<string, string>,
  addresses: TAddress[],
  memberIds: string[],
  autoZones: Map<string, TAddress[]>
): Record<string, string> {
  const addressIdSet = new Set(addresses.map((address) => address.id));
  const memberIdSet = new Set(memberIds);
  const autoAssignmentByAddress = buildAssignmentByAddressId(autoZones);
  const next: Record<string, string> = {};

  Object.entries(manualOverrides).forEach(([addressId, memberId]) => {
    if (!addressIdSet.has(addressId) || !memberIdSet.has(memberId)) return;
    if (autoAssignmentByAddress.get(addressId) === memberId) return;
    next[addressId] = memberId;
  });

  return next;
}

export function shallowRecordEqual(left: Record<string, string>, right: Record<string, string>): boolean {
  const leftEntries = Object.entries(left);
  if (leftEntries.length !== Object.keys(right).length) return false;
  return leftEntries.every(([key, value]) => right[key] === value);
}

export function countManualOverridesByMember<TAddress extends AssignmentDraftAddress>(
  manualOverrides: Record<string, string>,
  addresses: TAddress[],
  memberIds: string[],
  autoZones: Map<string, TAddress[]>
): Map<string, number> {
  const counts = new Map(memberIds.map((memberId) => [memberId, 0]));
  const sanitizedOverrides = sanitizeManualOverrides(manualOverrides, addresses, memberIds, autoZones);
  Object.values(sanitizedOverrides).forEach((memberId) => {
    counts.set(memberId, (counts.get(memberId) ?? 0) + 1);
  });
  return counts;
}
