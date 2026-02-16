'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle, ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

function BillingSuccessContent() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session_id');
  const [status, setStatus] = useState<'idle' | 'confirming' | 'done' | 'error'>(
    sessionId ? 'confirming' : 'done'
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId || status !== 'confirming') return;

    const confirm = async () => {
      try {
        const res = await fetch('/api/billing/stripe/confirm-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ session_id: sessionId }),
        });
        const data = await res.json();
        if (res.ok && data.ok) {
          setStatus('done');
        } else {
          setStatus('error');
          setErrorMessage(data.error || 'Could not confirm subscription');
        }
      } catch {
        setStatus('error');
        setErrorMessage('Network error');
      }
    };

    confirm();
  }, [sessionId, status]);

  if (status === 'confirming') {
    return (
      <div className="p-6 max-w-md mx-auto">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3 text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin" />
              <span>Activating your subscription…</span>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="p-6 max-w-md mx-auto">
        <Card>
          <CardHeader>
            <CardTitle>Something went wrong</CardTitle>
            <CardDescription>
              {errorMessage ?? 'We couldn’t confirm your subscription. Your payment may still have gone through.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/billing">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Billing
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-md mx-auto">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CheckCircle className="w-8 h-8 text-green-500" />
            <CardTitle>Thank you</CardTitle>
          </div>
          <CardDescription>
            Your subscription is active. You now have access to Pro features.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button asChild>
            <Link href="/billing">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Billing
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default function BillingSuccessPage() {
  return (
    <Suspense fallback={<div className="p-6">Loading…</div>}>
      <BillingSuccessContent />
    </Suspense>
  );
}
