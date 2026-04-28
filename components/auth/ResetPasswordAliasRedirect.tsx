'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

type ResetPasswordAliasRedirectProps = {
  sourcePath: string;
};

export function ResetPasswordAliasRedirect({
  sourcePath,
}: ResetPasswordAliasRedirectProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const query = searchParams.toString();

  useEffect(() => {
    const destination = `/reset-password${query ? `?${query}` : ''}${window.location.hash}`;
    router.replace(destination);
  }, [query, router]);

  return (
    <div className="dark min-h-screen bg-gradient-to-br from-black to-[#262626] flex items-center justify-center p-4">
      <div className="rounded-2xl border border-white/15 bg-white/[0.06] px-6 py-4 text-base text-[#AAAAAA] backdrop-blur-2xl">
        Redirecting your recovery link from <span className="text-white">{sourcePath}</span>...
      </div>
    </div>
  );
}
