import { z } from 'zod';
export const socialPlatforms = ['Instagram','Facebook','LinkedIn','TikTok','YouTube','X','Website'] as const;
export const safeUrl = z.string().trim().max(2048).refine(value => { try { const u=new URL(value); return u.protocol==='https:' && !u.username && !u.password; } catch { return false; } }, 'Use an https:// URL');
export const cardContentSchema = z.object({
 name:z.string().trim().min(1).max(100), title:z.string().trim().max(100).default(''), company:z.string().trim().max(100).default(''),
 bio:z.string().trim().max(2000).default(''), phone:z.string().trim().max(40).regex(/^[+\d ()-]*$/).default(''),
 email:z.union([z.email(),z.literal('')]).default(''), photo:z.union([safeUrl,z.literal('')]).default(''),
 reviewUrl:z.union([safeUrl,z.literal('')]).default(''),
 socials:z.array(z.object({platform:z.enum(socialPlatforms),url:safeUrl})).max(7).refine(rows=>new Set(rows.map(r=>r.platform)).size===rows.length).default([])
});
export type CardContent=z.infer<typeof cardContentSchema>;
export const actionTypes=['call_clicked','text_clicked','email_clicked','contact_downloaded','social_clicked','website_clicked','review_clicked','referral_started'] as const;
export function isPreview(userAgent:string) { return /bot|crawler|spider|preview|scanner|facebookexternalhit|slack|whatsapp|telegram|headless/i.test(userAgent); }
export function cardMessage(name:string,phone:string,url:string) { return `Hey ${name.trim().split(/\s+/)[0] || 'there'}, it was nice chatting with you 👋 Below is my business card link so we can keep in touch!${phone ? ` You can always text me directly at ${phone}.` : ''}\n${url}`; }
export function vcard(card:CardContent) {
 const escape=(s:string)=>s.replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');
 return ['BEGIN:VCARD','VERSION:3.0',`FN:${escape(card.name)}`,`ORG:${escape(card.company)}`,`TITLE:${escape(card.title)}`,`TEL:${escape(card.phone)}`,`EMAIL:${escape(card.email)}`,...card.socials.map(s=>`URL:${escape(s.url)}`),'END:VCARD'].join('\r\n');
}
