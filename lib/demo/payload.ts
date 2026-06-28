// FUTURE: navigationMode is currently always 'scroll'. When click-mode
// is built, centralize "which beat is active" into a shared
// useDemoBeatActive(beatId) hook/context that both modes implement,
// rather than each beat managing its own IntersectionObserver. Do not
// refactor Beat1/Beat3/Beat4's existing scroll logic until click-mode
// is actually being built.

export type DemoVertical = 'roofing' | 'lawncare' | 'hvac' | 'solar' | 'political' | 'real_estate' | 'generic';

export type BeatCopy = {
  b1Headline: string;
  b1Sub: string;
  b1Accent: string;
  b2Headline: string;
  b2Sub: string;
  b2Strikes: string[];
  b2Math: { key: string; value: string; hot?: boolean }[];
  b3Headline: string;
  b3Sub: string;
  b3CounterLabel: string;
  b3ReplayLabel: string;
  b3FinalTimer: string;
  b4Headline: string;
  b4Sub: string;
  b4ReplayLabel: string;
  b4FeedTitle: string;
  b5Headline: string;
  b5Sub: string;
  b5Pitch: string[];
  b5AppbarText: string;
  b5AppbarAccent: string;
  b5AppbarTime: string;
  b5DoorAddress: string;
  b5DoorMeta: string;
  b5OutcomeButtons: {
    ok: string;
    nh: string;
    na: string;
    dk: string;
  };
  b5LeadDetails: { key: string; value: string }[];
  b5SyncText: string;
  b6Headline: string;
  b6Price: string;
  b6Sub: string;
  b6FounderLine: string;
  ctaPrimary: string;
  ctaSecondary: string;
};

export type DemoPayload = {
  slug: string;
  company?: string;
  contactName?: string;
  vertical: DemoVertical;
  city?: string;
  center?: [number, number];
  copy: BeatCopy;
  ctaVariant: 'a' | 'b';
  ctaUrl: string;
  navigationMode: 'scroll' | 'click';
};
