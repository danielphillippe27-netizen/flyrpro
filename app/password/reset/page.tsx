import { Suspense } from 'react';
import { ResetPasswordAliasRedirect } from '@/components/auth/ResetPasswordAliasRedirect';

export default function PasswordResetAliasPage() {
  return (
    <Suspense fallback={<ResetPasswordAliasRedirectFallback sourcePath="/password/reset" />}>
      <ResetPasswordAliasRedirect sourcePath="/password/reset" />
    </Suspense>
  );
}

function ResetPasswordAliasRedirectFallback({ sourcePath }: { sourcePath: string }) {
  return (
    <div className="dark min-h-screen bg-gradient-to-br from-black to-[#262626] flex items-center justify-center p-4">
      <div className="rounded-2xl border border-white/15 bg-white/[0.06] px-6 py-4 text-base text-[#AAAAAA] backdrop-blur-2xl">
        Redirecting your recovery link from <span className="text-white">{sourcePath}</span>...
      </div>
    </div>
  );
}
