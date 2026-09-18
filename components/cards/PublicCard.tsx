'use client';
import { useEffect,useRef,useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { FaInstagram,FaFacebook,FaLinkedin,FaTiktok,FaYoutube,FaGlobe } from 'react-icons/fa';
import { FaXTwitter } from 'react-icons/fa6';
import type { CardContent } from '@/lib/cards/contracts';
import './cards.css';
const icons={Instagram:FaInstagram,Facebook:FaFacebook,LinkedIn:FaLinkedin,TikTok:FaTiktok,YouTube:FaYoutube,X:FaXTwitter,Website:FaGlobe};
export default function PublicCard({content:c,token,referral=false}:{content:CardContent;token?:string;referral?:boolean}) {
 const visit=useRef('');const [form,setForm]=useState(false);const [status,setStatus]=useState('');const [busy,setBusy]=useState(false);
 const [referralUrl,setReferralUrl]=useState('');const linkKey=useRef('');const submission=useRef('');
 async function request(action:string,body:unknown){const response=await fetch(`/api/cards/public/${token}/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),keepalive:true});const data=await response.json();if(!response.ok)throw new Error(data.error||'Please retry');return data;}
 function track(type:string,detail?:string){if(!token)return;if(!visit.current)visit.current=crypto.randomUUID();void request('events',{visitId:visit.current,eventId:crypto.randomUUID(),type,detail}).catch(()=>{});}
 useEffect(()=>{
  if(!token)return;visit.current=crypto.randomUUID();let timer:ReturnType<typeof setTimeout>|undefined;let opened=false;
  const visible=()=>{clearTimeout(timer);if(!opened&&document.visibilityState==='visible')timer=setTimeout(()=>{opened=true;void request('events',{visitId:visit.current,eventId:crypto.randomUUID(),type:'qualified_open',visibleMs:2000}).catch(()=>{opened=false;});},2000);};
  visible();document.addEventListener('visibilitychange',visible);return()=>{clearTimeout(timer);document.removeEventListener('visibilitychange',visible);};
  // The token defines a visit; rendering or form edits must not restart it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[token]);
 async function shareReferral(){if(!token)return;setBusy(true);try{linkKey.current||=crypto.randomUUID();const result=await request('referral-link',{idempotencyKey:linkKey.current});setReferralUrl(result.url);if(navigator.share)await navigator.share({title:`${c.name}'s business card`,url:result.url});else {await navigator.clipboard.writeText(result.url);setStatus('Referral link copied');}}catch(e){setStatus(e instanceof Error?e.message:'Please retry');}finally{setBusy(false);}}
 async function submit(event:React.FormEvent<HTMLFormElement>){event.preventDefault();if(!token)return;setBusy(true);setStatus('');const values=new FormData(event.currentTarget);try{submission.current||=crypto.randomUUID();await request('referrals',{submissionId:submission.current,name:values.get('name'),phone:values.get('phone')||'',email:values.get('email')||'',note:values.get('note')||'',referrerName:values.get('referrerName')||'',permission:values.get('permission')==='on'});setForm(false);setStatus('Thank you! Your details have been sent.');}catch(e){setStatus(e instanceof Error?e.message:'Please retry');}finally{setBusy(false);}}
 return <main className="wolfcard-shell"><article className="wolfcard">
 <header>{c.photo?<Image unoptimized width={96} height={96} src={c.photo} alt={c.name} className="wolfcard-avatar"/>:<div className="wolfcard-avatar wolfcard-initials">{c.name.split(/\s+/).map(s=>s[0]).slice(0,2).join('')}</div>}
 <h1>{c.name}</h1><p>{[c.title,c.company].filter(Boolean).join(' · ')}</p>
 <nav aria-label="Contact" className="wolfcard-actions">{c.phone&&<><a href={`tel:${c.phone.replace(/[^+\d]/g,'')}`} onClick={()=>track('call_clicked')}>Call</a><a href={`sms:${c.phone.replace(/[^+\d]/g,'')}`} onClick={()=>track('text_clicked')}>Text</a></>}{c.email&&<a href={`mailto:${c.email}`} onClick={()=>track('email_clicked')}>Email</a>}{token&&<a className="wolfcard-primary" href={`/api/cards/public/${token}/contact`} onClick={()=>track('contact_downloaded')}>Save Contact</a>}</nav>
 <nav className="wolfcard-socials" aria-label="Social media">{c.socials.map(s=>{const Icon=icons[s.platform];return <a key={s.platform} href={s.url} target="_blank" rel="noopener noreferrer" onClick={()=>track(s.platform==='Website'?'website_clicked':'social_clicked',s.platform)}><Icon aria-hidden/><span>{s.platform}</span></a>;})}</nav></header>
 {c.bio&&<section><h2>About me</h2><p className="wolfcard-bio">{c.bio}</p></section>}
 {c.reviewUrl&&<section><a className="wolfcard-button" href={c.reviewUrl} target="_blank" rel="noopener noreferrer" onClick={()=>track('review_clicked')}>Read or leave a review</a></section>}
 <section className="wolfcard-referrals"><h2>{referral?'Let’s connect':'Know someone I can help?'}</h2><button disabled={!token} className="wolfcard-button wolfcard-primary" onClick={()=>{setForm(true);track('referral_started');}}>{referral?'Send my details':'Send a Referral'}</button><button className="wolfcard-button" disabled={!token||busy} onClick={shareReferral}>Share a referral link</button>{referralUrl&&<input aria-label="Your referral link" readOnly value={referralUrl}/>}
 {form&&<form onSubmit={submit}><label>{referral?'Your name':'Referral name'}<input name="name" required maxLength={100} autoComplete="name"/></label><label>Phone<input name="phone" type="tel" maxLength={40}/></label><label>Email<input name="email" type="email" maxLength={254}/></label><p>Enter a phone number or email address.</p>{!referral&&<label>Your name (optional)<input name="referrerName" maxLength={100}/></label>}<label>Note<textarea name="note" maxLength={2000}/></label><label className="wolfcard-check"><input type="checkbox" name="permission" required/>{referral?'I agree to be contacted about my request.':'I have permission to share these details so this representative can follow up.'}</label><button className="wolfcard-button wolfcard-primary" disabled={busy}>{busy?'Sending…':'Send details'}</button><button type="button" className="wolfcard-button" onClick={()=>setForm(false)}>Cancel</button></form>}
 <p role="status">{status}</p></section><footer>Link views and button interactions are recorded to help this representative follow up. Forwarded links remain associated with their original share. <Link href="/privacy">Privacy</Link><p>Made with WolfGrid</p></footer>
 </article></main>;
}
