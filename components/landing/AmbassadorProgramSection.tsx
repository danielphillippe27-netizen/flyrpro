'use client';

import { FormEvent, useMemo, useState } from 'react';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

type ApplicationState = {
  fullName: string;
  email: string;
  phone: string;
  city: string;
  primaryNiche: string;
  primaryPlatform: string;
  audienceSize: string;
  instagramHandle: string;
  tiktokHandle: string;
  youtubeHandle: string;
  websiteUrl: string;
  audienceSummary: string;
  whyFlyr: string;
  promotionPlan: string;
};

const INITIAL_STATE: ApplicationState = {
  fullName: '',
  email: '',
  phone: '',
  city: '',
  primaryNiche: '',
  primaryPlatform: 'Instagram',
  audienceSize: '',
  instagramHandle: '',
  tiktokHandle: '',
  youtubeHandle: '',
  websiteUrl: '',
  audienceSummary: '',
  whyFlyr: '',
  promotionPlan: '',
};

const PROGRAM_BULLETS = [
  '20% recurring commission for 12 months on paid users you refer',
  '30-day free trial for your audience with your custom link and code',
  'Cash bonuses at key milestones for top-performing partners',
  'Monthly payouts with a clear Stripe-based payout path for approved ambassadors',
];

const PROGRAM_STEPS = [
  'Apply with your audience details and field-sales niche.',
  'If approved, we reach out with terms, creative angles, and your referral setup.',
  'Top partners can be upgraded into paid content + higher commission tiers.',
];

export function AmbassadorProgramSection() {
  const [form, setForm] = useState<ApplicationState>(INITIAL_STATE);
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState<string>('');

  const canSubmit = useMemo(() => {
    return Boolean(
      form.fullName.trim() &&
      form.email.trim() &&
      form.primaryNiche.trim() &&
      form.primaryPlatform.trim() &&
      form.whyFlyr.trim().length >= 20
    );
  }, [form]);

  const handleChange = (field: keyof ApplicationState, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit || status === 'submitting') return;

    setStatus('submitting');
    setMessage('');

    try {
      const response = await fetch('/api/ambassador/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        message?: string;
      };

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || 'Could not submit your application.');
      }

      setStatus('success');
      setMessage(payload.message || "Application received. We'll be in touch soon.");
      setForm(INITIAL_STATE);
    } catch (error) {
      setStatus('error');
      setMessage(
        error instanceof Error ? error.message : 'Could not submit your application.'
      );
    }
  };

  return (
    <section
      id="ambassador-program"
      className="border-t border-zinc-200 bg-white px-5 py-20 md:px-8"
    >
      <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-[1.05fr_0.95fr]">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.08em] text-red-600">
            Ambassador Program
          </p>
          <h2 className="mt-4 max-w-2xl text-4xl font-black leading-tight text-zinc-900 md:text-5xl">
            Pay for effort. Reward performance. Give creators real upside.
          </h2>
          <p className="mt-5 max-w-2xl text-lg text-zinc-600">
            Built for real estate creators, team leaders, coaches, and field-sales voices who can
            actually move people into FLYR.
          </p>

          <div className="mt-8 space-y-4">
            {PROGRAM_BULLETS.map((item) => (
              <div key={item} className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
                <p className="text-base text-zinc-800">{item}</p>
              </div>
            ))}
          </div>

          <div className="mt-10 grid gap-6 md:grid-cols-3">
            <div className="border border-zinc-200 p-5">
              <p className="text-sm font-semibold uppercase tracking-[0.06em] text-zinc-500">
                Base
              </p>
              <p className="mt-3 text-2xl font-black text-zinc-900">20%</p>
              <p className="mt-2 text-sm text-zinc-600">Recurring commission for 12 months</p>
            </div>
            <div className="border border-zinc-200 p-5">
              <p className="text-sm font-semibold uppercase tracking-[0.06em] text-zinc-500">
                Audience Offer
              </p>
              <p className="mt-3 text-2xl font-black text-zinc-900">30 days free</p>
              <p className="mt-2 text-sm text-zinc-600">Custom link and code for every approved partner</p>
            </div>
            <div className="border border-zinc-200 p-5">
              <p className="text-sm font-semibold uppercase tracking-[0.06em] text-zinc-500">
                Top Partners
              </p>
              <p className="mt-3 text-2xl font-black text-zinc-900">25% - 30%</p>
              <p className="mt-2 text-sm text-zinc-600">Paid content, milestone bonuses, and founder access</p>
            </div>
          </div>

          <div className="mt-10">
            <p className="text-sm font-semibold uppercase tracking-[0.06em] text-zinc-500">
              How it works
            </p>
            <div className="mt-4 space-y-3">
              {PROGRAM_STEPS.map((step, index) => (
                <div key={step} className="flex items-start gap-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center border border-zinc-300 text-sm font-semibold text-zinc-900">
                    {index + 1}
                  </div>
                  <p className="pt-0.5 text-base text-zinc-700">{step}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          className="border border-zinc-200 bg-zinc-50 p-6 md:p-7"
        >
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="text-2xl font-black text-zinc-900">Apply to the program</h3>
              <p className="mt-2 text-sm text-zinc-600">
                We review fit, audience trust, and how well your niche lines up with FLYR.
              </p>
            </div>
            <ArrowRight className="hidden h-5 w-5 shrink-0 text-red-600 md:block" />
          </div>

          <div className="mt-8 grid gap-5 md:grid-cols-2">
            <div className="md:col-span-2">
              <Label htmlFor="ambassador-full-name">Full name</Label>
              <Input
                id="ambassador-full-name"
                value={form.fullName}
                onChange={(event) => handleChange('fullName', event.target.value)}
                className="mt-2 h-11 rounded-md border-zinc-300 bg-white"
                placeholder="Your name"
                required
              />
            </div>

            <div>
              <Label htmlFor="ambassador-email">Email</Label>
              <Input
                id="ambassador-email"
                type="email"
                value={form.email}
                onChange={(event) => handleChange('email', event.target.value)}
                className="mt-2 h-11 rounded-md border-zinc-300 bg-white"
                placeholder="you@example.com"
                required
              />
            </div>

            <div>
              <Label htmlFor="ambassador-phone">Phone</Label>
              <Input
                id="ambassador-phone"
                value={form.phone}
                onChange={(event) => handleChange('phone', event.target.value)}
                className="mt-2 h-11 rounded-md border-zinc-300 bg-white"
                placeholder="Optional"
              />
            </div>

            <div>
              <Label htmlFor="ambassador-city">City / market</Label>
              <Input
                id="ambassador-city"
                value={form.city}
                onChange={(event) => handleChange('city', event.target.value)}
                className="mt-2 h-11 rounded-md border-zinc-300 bg-white"
                placeholder="Toronto, Dallas, Phoenix..."
              />
            </div>

            <div>
              <Label htmlFor="ambassador-niche">Primary niche</Label>
              <Input
                id="ambassador-niche"
                value={form.primaryNiche}
                onChange={(event) => handleChange('primaryNiche', event.target.value)}
                className="mt-2 h-11 rounded-md border-zinc-300 bg-white"
                placeholder="Real estate coaching, field sales..."
                required
              />
            </div>

            <div>
              <Label htmlFor="ambassador-platform">Primary platform</Label>
              <select
                id="ambassador-platform"
                value={form.primaryPlatform}
                onChange={(event) => handleChange('primaryPlatform', event.target.value)}
                className="mt-2 h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-900"
              >
                <option>Instagram</option>
                <option>TikTok</option>
                <option>YouTube</option>
                <option>LinkedIn</option>
                <option>Newsletter</option>
                <option>Podcast</option>
                <option>Other</option>
              </select>
            </div>

            <div>
              <Label htmlFor="ambassador-audience-size">Audience size</Label>
              <Input
                id="ambassador-audience-size"
                value={form.audienceSize}
                onChange={(event) => handleChange('audienceSize', event.target.value)}
                className="mt-2 h-11 rounded-md border-zinc-300 bg-white"
                placeholder="5k-20k, 25k+, etc."
              />
            </div>

            <div>
              <Label htmlFor="ambassador-instagram">Instagram</Label>
              <Input
                id="ambassador-instagram"
                value={form.instagramHandle}
                onChange={(event) => handleChange('instagramHandle', event.target.value)}
                className="mt-2 h-11 rounded-md border-zinc-300 bg-white"
                placeholder="@handle"
              />
            </div>

            <div>
              <Label htmlFor="ambassador-tiktok">TikTok</Label>
              <Input
                id="ambassador-tiktok"
                value={form.tiktokHandle}
                onChange={(event) => handleChange('tiktokHandle', event.target.value)}
                className="mt-2 h-11 rounded-md border-zinc-300 bg-white"
                placeholder="@handle"
              />
            </div>

            <div>
              <Label htmlFor="ambassador-youtube">YouTube / podcast</Label>
              <Input
                id="ambassador-youtube"
                value={form.youtubeHandle}
                onChange={(event) => handleChange('youtubeHandle', event.target.value)}
                className="mt-2 h-11 rounded-md border-zinc-300 bg-white"
                placeholder="Channel or show name"
              />
            </div>

            <div className="md:col-span-2">
              <Label htmlFor="ambassador-website">Website</Label>
              <Input
                id="ambassador-website"
                type="url"
                value={form.websiteUrl}
                onChange={(event) => handleChange('websiteUrl', event.target.value)}
                className="mt-2 h-11 rounded-md border-zinc-300 bg-white"
                placeholder="https://"
              />
            </div>

            <div className="md:col-span-2">
              <Label htmlFor="ambassador-audience-summary">Tell us about your audience</Label>
              <Textarea
                id="ambassador-audience-summary"
                value={form.audienceSummary}
                onChange={(event) => handleChange('audienceSummary', event.target.value)}
                className="mt-2 min-h-24 rounded-md border-zinc-300 bg-white"
                placeholder="Who follows you and why do they trust your recommendations?"
              />
            </div>

            <div className="md:col-span-2">
              <Label htmlFor="ambassador-why-flyr">Why do you want to partner with FLYR?</Label>
              <Textarea
                id="ambassador-why-flyr"
                value={form.whyFlyr}
                onChange={(event) => handleChange('whyFlyr', event.target.value)}
                className="mt-2 min-h-28 rounded-md border-zinc-300 bg-white"
                placeholder="Share why your audience is a fit and how you would position FLYR."
                required
              />
            </div>

            <div className="md:col-span-2">
              <Label htmlFor="ambassador-promotion-plan">How would you promote it?</Label>
              <Textarea
                id="ambassador-promotion-plan"
                value={form.promotionPlan}
                onChange={(event) => handleChange('promotionPlan', event.target.value)}
                className="mt-2 min-h-24 rounded-md border-zinc-300 bg-white"
                placeholder="Short-form video, live demo, webinar, newsletter, coaching cohort..."
              />
            </div>
          </div>

          {message ? (
            <div
              className={`mt-5 border px-4 py-3 text-sm ${
                status === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border-red-200 bg-red-50 text-red-700'
              }`}
            >
              {message}
            </div>
          ) : null}

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-zinc-500">
              Approved ambassadors are onboarded for payouts through Stripe.
            </p>
            <Button
              type="submit"
              disabled={!canSubmit || status === 'submitting'}
              className="h-11 rounded-md bg-red-600 px-5 text-sm font-semibold text-white hover:bg-red-500"
            >
              {status === 'submitting' ? 'Submitting...' : 'Apply now'}
            </Button>
          </div>
        </form>
      </div>
    </section>
  );
}
