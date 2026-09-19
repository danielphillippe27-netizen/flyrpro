import { z } from 'zod';
export const socialPlatforms = ['Instagram','Facebook','LinkedIn','TikTok','YouTube','X','Website'] as const;
export const safeUrl = z.string().trim().max(2048).refine(value => { try { const u=new URL(value); return u.protocol==='https:' && !u.username && !u.password; } catch { return false; } }, 'Use an https:// URL');
const hexColor=z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a six-digit hex colour');
export function cardTextColor(hex:string){const c=hex.slice(1).match(/../g)!.map(v=>{const n=parseInt(v,16)/255;return n<=.04045?n/12.92:Math.pow((n+.055)/1.055,2.4);});return .2126*c[0]+.7152*c[1]+.0722*c[2]>.179?'#151719':'#ffffff';}
export const cardContentSchema = z.object({
 name:z.string().trim().max(100).default(''), title:z.string().trim().max(100).default(''), company:z.string().trim().max(100).default(''),
 bio:z.string().trim().max(2000).default(''), phone:z.string().trim().max(40).regex(/^[+\d ()-]*$/).default(''),
 email:z.union([z.email(),z.literal('')]).default(''), photo:z.union([safeUrl,z.literal('')]).default(''),
 theme:z.object({header:hexColor,accent:hexColor,background:hexColor}).optional(),
 companyLogo:z.union([safeUrl,z.literal('')]).optional(),
 reviewUrl:z.union([safeUrl,z.literal('')]).default(''),
 socials:z.array(z.object({platform:z.enum(socialPlatforms),url:safeUrl})).max(7).refine(rows=>new Set(rows.map(r=>r.platform)).size===rows.length).default([])
});
export type CardContent=z.infer<typeof cardContentSchema>;
export function cardHasDetails(card: CardContent): boolean {
 return [card.name,card.title,card.company,card.bio,card.phone,card.email,card.photo,card.reviewUrl,card.companyLogo,...card.socials.map(s=>s.url)].some(value=>Boolean(value?.trim()));
}
export const actionTypes=['call_clicked','text_clicked','email_clicked','contact_downloaded','social_clicked','website_clicked','review_clicked','referral_started'] as const;
export function isPreview(userAgent:string) { return /bot|crawler|spider|preview|scanner|facebookexternalhit|slack|whatsapp|telegram|headless/i.test(userAgent); }
export function cardMessage(name:string,phone:string,url:string) { return `Hey ${name.trim().split(/\s+/)[0] || 'there'}, it was nice chatting with you 👋 Below is my business card link so we can keep in touch!${phone ? ` You can always text me directly at ${phone}.` : ''}\n${url}`; }
export function vcard(card:CardContent, jpegBase64?:string) {
 const escape=(s:string)=>s.replace(/\\/g,'\\\\').replace(/\r\n|\r|\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');
 const [firstName='',...family]=card.name.trim().split(/\s+/);
 const lines=['BEGIN:VCARD','VERSION:3.0',`N:${escape(family.join(' '))};${escape(firstName)};;;`,
  `FN:${escape(card.name)}`,`ORG:${escape(card.company)}`,`TITLE:${escape(card.title)}`,
  `TEL;TYPE=CELL:${escape(card.phone)}`,`EMAIL;TYPE=INTERNET:${escape(card.email)}`,
  ...(jpegBase64?[`PHOTO;ENCODING=b;TYPE=JPEG:${jpegBase64}`]:card.photo?[`PHOTO;VALUE=URI:${card.photo}`]:[]),
  ...card.socials.map(s=>`URL:${escape(s.url)}`),'END:VCARD'];
 // Fold at 75 UTF-8 bytes, including the continuation space, without splitting characters.
 const encoder=new TextEncoder();
 return lines.map(line=>{let result='',bytes=0;for(const char of line){const size=encoder.encode(char).length;if(bytes+size>75){result+='\r\n ';bytes=1;}result+=char;bytes+=size;}return result;}).join('\r\n')+'\r\n';
}

export function canReceiveCard(phone: string | null | undefined, email: string | null | undefined): boolean {
 const normalizedPhone = phone?.trim() ?? '';
 const digits = normalizedPhone.replace(/\D/g, '').length;
 const validPhone = /^[+0-9 ()-]+$/.test(normalizedPhone) && digits >= 7 && digits <= 15;
 return validPhone || z.email().safeParse(email?.trim() ?? '').success;
}
