import { notFound } from 'next/navigation';
import { ChallengeDetailClient } from '@/components/challenges/ChallengeDetailClient';

type PageProps = { params: Promise<{ challengeId: string }> };

export default async function ChallengeDetailPage({ params }: PageProps) {
  const { challengeId } = await params;
  if (!challengeId) notFound();
  return <ChallengeDetailClient challengeId={challengeId} />;
}
