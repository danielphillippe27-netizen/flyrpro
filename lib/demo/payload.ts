export type DemoVertical = 'roofing' | 'lawncare' | 'hvac' | 'solar' | 'political' | 'generic';

export type BeatCopy = {
  b1Headline: string;
  b1Sub: string;
  b1Accent: string;
  b2Headline: string;
  b2Strikes: string[];
  b2Math: { key: string; value: string; hot?: boolean }[];
  b3Headline: string;
  b3Sub: string;
  b4Headline: string;
  b4Sub: string;
  b5Headline: string;
  b5Sub: string;
  b5Pitch: string[];
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
  ctaVariant: 'book' | 'reply' | 'territory';
  ctaUrl: string;
};
