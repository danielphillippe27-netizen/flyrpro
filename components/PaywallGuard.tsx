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
      const response = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priceId: 'price_pro_monthly' }),
      });

      const { url } = await response.json();
      if (url) {
        window.location.href = url;
      }
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
          <div className="bg-gradient-to-r from-blue-50 to-purple-50 p-6 rounded-xl border">
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

