'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { MessageCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SupportInbox } from '@/components/support';

export default function SupportInboxPage() {
  const router = useRouter();
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;
    const supabase = createClient();

    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        if (mounted) {
          setAllowed(false);
          router.replace('/login');
        }
        return;
      }

      const [{ data: profile }, { data: founderProfile }] = await Promise.all([
        supabase.from('profiles').select('is_support').eq('id', user.id).single(),
        supabase.from('user_profiles').select('user_id').eq('user_id', user.id).eq('is_founder', true).maybeSingle(),
      ]);

      const isSupport = !!profile?.is_support;
      const isFounder = !!founderProfile?.user_id;
      if (!isSupport && !isFounder) {
        if (mounted) setAllowed(false);
        return;
      }
      if (mounted) setAllowed(true);
    })();

    return () => { mounted = false; };
  }, [router]);

  if (allowed === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (allowed === false) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 dark:bg-background px-4">
        <MessageCircle className="h-12 w-12 text-muted-foreground mb-4" />
        <h1 className="text-xl font-semibold text-foreground">Not authorized</h1>
        <p className="text-muted-foreground mt-2 text-center">
          Only support staff can access the Support Inbox.
        </p>
        <Button variant="outline" className="mt-4" onClick={() => router.push('/home')}>
          Back to Home
        </Button>
      </div>
    );
  }

  return (
    <SupportInbox
      title="Support Inbox"
      description="Reply to user messages from the app"
    />
  );
}
