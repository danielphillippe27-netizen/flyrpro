/**
 * Run with: npx tsx lib/__tests__/manualAddressIdentity.test.ts
 */

import assert from "node:assert/strict";
import {
  addressIdentitiesMatch,
  normalizedAddressIdentity,
} from "../../app/api/campaigns/[campaignId]/addresses/_utils/addressIdentity";

const existing = normalizedAddressIdentity({
  houseNumber: "18",
  streetName: "Merino St",
  postalCode: "8083",
});
const reverseGeocode = normalizedAddressIdentity({
  formatted: "18 MERINO STREET, CHRISTCHURCH, 8083",
});

assert.ok(addressIdentitiesMatch(reverseGeocode, existing));
assert.equal(reverseGeocode?.primary, "18|merino street");
assert.equal(reverseGeocode?.postalCode, "8083");

assert.ok(
  addressIdentitiesMatch(
    normalizedAddressIdentity({
      houseNumber: "18",
      streetName: "Merino Street",
      postalCode: " 8 0 8 3 ",
    }),
    normalizedAddressIdentity({
      formatted: "18 Merino St, Christchurch 8083",
    })
  )
);

assert.equal(
  addressIdentitiesMatch(
    normalizedAddressIdentity({ formatted: "18 Merino Street, Christchurch, 8083" }),
    normalizedAddressIdentity({ formatted: "19 Merino Street, Christchurch, 8083" })
  ),
  false
);

assert.equal(
  addressIdentitiesMatch(
    normalizedAddressIdentity({ formatted: "18 Merino Street, Christchurch, 8083" }),
    normalizedAddressIdentity({ formatted: "18 Merino Street, Christchurch, 8084" })
  ),
  false
);

assert.equal(
  normalizedAddressIdentity({ formatted: "18 Merino Street" })?.postalCode,
  null
);

console.log("manualAddressIdentity tests passed");
