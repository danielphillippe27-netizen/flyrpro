import type { Metadata } from 'next';
import type { CardContent } from './contracts';

export function cardMetadata(content?: CardContent): Metadata {
 const name = content?.name.trim() || content?.company.trim() || 'Business Card';
 const title = content ? `${name} · Business Card` : 'Card unavailable';
 const business = [content?.title, content?.company].filter(value => value?.trim()).join(' · ');
 const description = content
  ? business || content.bio.trim().slice(0, 200) || `View ${name === 'Business Card' ? 'this business card' : `${name}’s business card`} and save contact details.`
  : 'This business card is no longer available.';
 const photo = content?.photo || content?.companyLogo;
 const images = photo ? [{ url: photo, alt: `${name} · Business Card` }] : [];
 return {
  title: { absolute: title }, description,
  robots: { index: false, follow: false }, referrer: 'no-referrer',
  openGraph: { type: 'website', title, description, images },
  twitter: { card: photo ? 'summary_large_image' : 'summary', title, description, images },
 };
}
