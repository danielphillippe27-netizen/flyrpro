import type { DemoPayload } from './payload';

export const DEFAULT_PAYLOAD: DemoPayload = {
  slug: 'demo',
  vertical: 'generic',
  center: [43.8828, 79.4403],
  ctaVariant: 'territory',
  ctaUrl: 'mailto:harry@flyrpro.app?subject=Show%20me%20my%20territory',
  copy: {
    b1Headline: 'Your crew is on the doors',
    b1Sub:
      'FLYR PRO runs door-to-door field teams — territories, routes, reps, and every knock, verified. Three minutes, no call, no signup. Just scroll.',
    b1Accent: 'Prove it.',
    b2Headline: "You're paying for work\nyou can't see.",
    b2Sub:
      'Fifteen reps left the shop at 8 AM. Right now the knock record is a group chat and a gut feeling.',
    b2Strikes: ['Paper route sheets', 'The group chat', '"Trust me, boss"'],
    b2Math: [
      { key: 'Reps', value: '15' },
      { key: 'Rate', value: '$25/hr' },
      { key: 'Hours', value: '6' },
      { key: 'Paid on faith, daily', value: '$2,250', hot: true },
    ],
    b3Headline: 'Draw a line.\nGet every door.',
    b3Sub:
      "Draw or import a polygon and every deliverable address inside it is provisioned from municipal records — house by house, unit splits included. Assign routes, run it as a one-day blitz or farm it for months. And when hail hits overnight, you're knocking by 7 AM while the other crew is still printing maps.",
    b3CounterLabel: 'Addresses provisioned',
    b3ReplayLabel: '↻ Redraw territory',
    b3FinalTimer: '38.0 s real provisioning time · unit splits included',
    b4Headline: 'Every rep. Every door.\nLive.',
    b4Sub:
      'This is your dashboard at 2:30 on a Wednesday. GPS-tracked sessions, door-by-door outcomes, and a leaderboard your reps compete on all afternoon. The question at the top of this page — answered.',
    b4ReplayLabel: '↻ Restart session',
    b4FeedTitle: 'Live feed',
    b5Headline: 'Doorstep to CRM\nin one tap.',
    b5Sub: '',
    b5Pitch: [
      'Tap an outcome below — this phone is live.',
      "Leads land in your CRM as they're captured: HubSpot, Follow Up Boss, BoldTrail, Monday — or webhook into anything else.",
      'No new workflow. This replaces the group chat, the route sheet, and the end-of-day text thread.',
      'Zero signal? Full offline database. Syncs the moment coverage returns.',
      'Reps keep stats and shareable performance cards — they want to log doors.',
    ],
    b5AppbarText: 'FLYR',
    b5AppbarAccent: ' · LIVE SESSION',
    b5AppbarTime: '2:31 PM',
    b5DoorAddress: '112 Larkspur Crt',
    b5DoorMeta: 'Door 47 of 112 · Route B · 4 doors/hr pace',
    b5OutcomeButtons: {
      ok: 'Interested',
      nh: 'Not home',
      na: 'No answer',
      dk: 'Do not knock',
    },
    b5LeadDetails: [
      { key: 'Name', value: 'J. Okafor' },
      { key: 'Phone', value: '(905) 555-0184' },
      { key: 'Note', value: 'Hail damage, wants quote' },
    ],
    b5SyncText: '✓ Synced → HubSpot · 0.4s',
    b6Headline: 'One roof pays\nfor the year.',
    b6Price: '$40/rep/mo.',
    b6Sub: '',
    b6FounderLine:
      "No account manager. No ticket queue. You get the person who built it — if something matters at 7 AM before your crew rolls out, I'm the one who picks up, and the one who can fix it by 7:15.",
    ctaPrimary: 'See it on your territory →',
    ctaSecondary: 'flyrpro.app',
  },
};
