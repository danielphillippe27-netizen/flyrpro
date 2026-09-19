import { cache } from 'react';
import { cardMetadata } from '@/lib/cards/metadata';
import { notFound } from 'next/navigation';
import { publicCard,CardError } from '@/lib/cards/server';
import PublicCard from '@/components/cards/PublicCard';
export const dynamic='force-dynamic';
const loadCard = cache(publicCard);
export async function generateMetadata({params}:{params:Promise<{token:string}>}) {
 const {token}=await params;
 try { const {content}=await loadCard(token); return cardMetadata(content); }
 catch(error) { if(error instanceof CardError) return cardMetadata(); throw error; }
}
export default async function Page({params}:{params:Promise<{token:string}>}) {
 const {token}=await params;
 try {const {content,share}=await loadCard(token);return <PublicCard content={content} token={token} referral={!!share.parent_share_id}/>;}
 catch(error){if(error instanceof CardError)notFound();throw error;}
}
