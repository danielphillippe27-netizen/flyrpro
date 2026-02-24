'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface PaywallGuardProps {
  open: boolean;
  onClose: () => void;
}

export function PaywallGuard({ open, onClose }: PaywallGuardProps) {
  const [loading, setLoading] = useState(false);

  const handleUpgrade = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/billing/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ plan: 'monthly', currency: 'USD' }),
      });

      const data = await response.json().catch(() => ({}));
      if (response.ok && data.url) {
        window.location.href = data.url;
        return;
      }
      throw new Error(data?.error || 'Failed to create checkout session');
    } catch (error) {
      console.error('Error creating checkout:', error);
      alert('Failed to create checkout session');
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px] rounded-2xl">
        <DialogHeader>
          <DialogTitle>Upgrade to Pro</DialogTitle>
          <DialogDescription>
            You&apos;ve reached the free limit of 100 QR codes per month. 
            Upgrade to Pro for unlimited QR code generation.
          </DialogDescription>
        </DialogHeader>
        <div className="py-6">
          <div className="bg-gradient-to-r from-red-50 dark:from-red-900/20 to-purple-50 dark:to-purple-900/20 p-6 rounded-xl border dark:border-gray-700">
            <h3 className="text-2xl font-bold mb-2">Pro Plan</h3>
            <div className="text-3xl font-bold mb-4">$29<span className="text-lg text-gray-600">/month</span></div>
            <ul className="space-y-2 text-sm">
              <li className="flex items-center">
                <span className="mr-2">✓</span> Unlimited QR code generation
              </li>
              <li className="flex items-center">
                <span className="mr-2">✓</span> Unlimited campaigns
              </li>
              <li className="flex items-center">
                <span className="mr-2">✓</span> Advanced analytics
              </li>
              <li className="flex items-center">
                <span className="mr-2">✓</span> Priority support
              </li>
            </ul>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleUpgrade} disabled={loading}>
            {loading ? 'Processing...' : 'Upgrade Now'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
