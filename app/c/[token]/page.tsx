import { notFound } from 'next/navigation';
import { publicCard,CardError } from '@/lib/cards/server';
import PublicCard from '@/components/cards/PublicCard';
export const dynamic='force-dynamic';
export const metadata={title:'Business Card · WolfGrid',robots:{index:false,follow:false},referrer:'no-referrer'};
export default async function Page({params}:{params:Promise<{token:string}>}) {
 const {token}=await params;
 try {const {content,share}=await publicCard(token);return <PublicCard content={content} token={token} referral={!!share.parent_share_id}/>;}
 catch(error){if(error instanceof CardError)notFound();throw error;}
}
