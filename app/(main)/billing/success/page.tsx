'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

function BillingSuccessContent() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session_id');

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
          {sessionId && (
            <p className="text-xs text-muted-foreground font-mono break-all">
              Session: {sessionId}
            </p>
          )}
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
