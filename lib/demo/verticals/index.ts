import type { BeatCopy, DemoVertical } from '../payload';

/**
 * Vertical copy overrides.
 *
 * Only supply keys that differ from DEFAULT_PAYLOAD.copy (lib/demo/defaults.ts).
 * resolvePayload.ts deep-merges these on top of the cloned default.
 * Arrays (b2Strikes, b2Math, b5Pitch, b5LeadDetails) replace the entire array.
 */
const VERTICAL_COPY: Partial<Record<DemoVertical, Partial<BeatCopy>>> = {
  real_estate: {
    b1Headline: 'Your agents are on the doors',
    b1Sub:
      'FLYR PRO runs real estate canvassing teams: farm maps, door routes, reps, and every knock — verified.',

    b2Headline: "You're paying for prospecting\nyou can't see.",
    b2Sub:
      'Ten agents left at 9 AM to farm the neighbourhood. Right now the knock record is a group chat and an afternoon check-in.',
    b2Strikes: ['Paper route sheets', 'The group chat', '"Trust me, boss"'],
    b2Math: [
      { key: 'Agents', value: '10' },
      { key: 'Rate', value: '$30/hr' },
      { key: 'Hours', value: '4' },
      { key: 'Paid on faith, daily', value: '$1,200', hot: true },
    ],

    b3Headline: 'Draw a farm.\nGet every door.',
    b3Sub:
      'Draw or import a polygon and every deliverable address inside it is provisioned from municipal records, house by house, unit splits included. Assign agents to farms, run a just-listed blitz, or cultivate the same neighbourhood for months. And when a property hits the market overnight, your team is knocking by 8 AM while the competition is still printing maps.',

    b4Headline: 'Every agent. Every door.\nLive.',
    b4Sub:
      'This is your dashboard at 2:30 on a Wednesday. GPS-tracked sessions, door-by-door outcomes, and a leaderboard your agents compete on all afternoon.',

    b5Headline: 'Doorstep to CRM\nin one tap.',
    b5Pitch: [
      'Tap an outcome below, this phone is live.',
      'Leads land in your CRM as they\'re captured: Follow Up Boss, BoldTrail, HubSpot, or webhook into anything else.',
      'No new workflow. This replaces the group chat, the farm sheet, and the end-of-day text thread.',
      'Zero signal? Full offline database. Syncs the moment coverage returns.',
      'Agents keep stats and shareable performance cards — they want to log doors.',
    ],
    b5DoorAddress: '47 Elmwood Drive',
    b5DoorMeta: 'Door 47 of 112 · Farm A · 4 doors/hr pace',
    b5OutcomeButtons: {
      ok: 'Interested',
      nh: 'Not home',
      na: 'No answer',
      dk: 'Do not knock',
    },
    b5LeadDetails: [
      { key: 'Name', value: 'M. Chen' },
      { key: 'Phone', value: '(604) 555-0132' },
      { key: 'Note', value: 'Thinking of selling, wants CMA' },
    ],
    b5SyncText: '✓ Synced → Follow Up Boss · 0.4s',

    b6Headline: 'One listing pays\nfor the year.',
    b6Price: '$40/agent/mo.',
  },
};

export function getVerticalCopyOverrides(vertical: DemoVertical): Partial<BeatCopy> {
  return VERTICAL_COPY[vertical] ?? {};
}
