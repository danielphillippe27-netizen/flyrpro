import assert from 'node:assert/strict';
import { planFarmCampaignAddressLinks } from '../campaignAddressLinks';

const farm = { id: 'farm-home', campaign_address_id: null, gers_id: 'home-1', formatted: ' 27 Living Court ' };
const campaign = { campaign_address_id: 'campaign-home', gers_id: 'home-1', formatted: '27 LIVING COURT' };
assert.deepEqual(planFarmCampaignAddressLinks([farm], [campaign]), [{ farmId: 'farm-home', campaignAddressId: 'campaign-home' }]);
assert.deepEqual(planFarmCampaignAddressLinks([farm, { ...farm, id: 'other' }], [campaign]), []);
assert.deepEqual(planFarmCampaignAddressLinks([farm], [campaign, { ...campaign, campaign_address_id: 'other' }]), []);
assert.deepEqual(planFarmCampaignAddressLinks([farm], [{ ...campaign, gers_id: 'different' }]), []);
assert.deepEqual(planFarmCampaignAddressLinks([{ ...farm, campaign_address_id: 'previous' }], [campaign]), []);
assert.deepEqual(planFarmCampaignAddressLinks([farm, { ...farm, id: 'other', formatted: 'different', campaign_address_id: 'campaign-home' }], [campaign]), []);
console.log('PASS: farm campaign address links preserve identity and avoid ambiguous matches');
