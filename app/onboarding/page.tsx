'use client';

import { Suspense, useState, useCallback, useEffect, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { User, Users, Building2, Plus, Minus } from 'lucide-react';
import { ExclusiveOfferArcadeEmbed } from '@/components/landing/ExclusiveOfferArcadeEmbed';
import { getClientAsync } from '@/lib/supabase/client';

type BrokerageSuggestion = { id: string; name: string };

const INDUSTRIES_TOP = ['Real Estate', 'Solar', 'Roofing & Exteriors'];

const INDUSTRIES_REST = [
  'Financing',
  'Home Health Care',
  'HVAC & Plumbing',
  'Insurance',
  'Landscaping & Snow',
  'Pest Control',
  'Political / Canvassing',
  'Pool Service',
  'Other',
];

const SOLO_SEATS = 1;
const TEAM_MIN_SEATS = 2;
const MAX_SEATS = 100;

function LogoutDoorEmblem({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      className={className}
    >
      <path
        d="M4 5v14h8V5H4z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <path
        d="M12 12h8M17 9l3 3-3 3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="9.5" cy="12" r="0.9" fill="currentColor" />
    </svg>
  );
}

function normalizeEmailList(values: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    const email = value.trim().toLowerCase();
    if (!email) continue;
    if (seen.has(email)) continue;
    seen.add(email);
    normalized.push(email);
  }
  return normalized;
}

function OnboardingContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const offerType = searchParams.get('offer');
  const partnerOfferToken = searchParams.get('partnerOfferToken');
  const partnerExclusiveParam = searchParams.get('partnerExclusive');
  const isExclusivePartnerOnboarding =
    offerType === 'exclusive30' &&
    typeof partnerOfferToken === 'string' &&
    partnerOfferToken.trim().length > 0;
  const [legacyPartnerExclusiveLayout, setLegacyPartnerExclusiveLayout] = useState<'team' | 'solo' | null>(
    null
  );
  const isIgOnboardingPath = pathname === '/onboarding/ig';
  const onboardingEntryPath = isIgOnboardingPath ? '/onboarding/ig' : '/onboarding';

  useEffect(() => {
    if (!isExclusivePartnerOnboarding) {
      setLegacyPartnerExclusiveLayout(null);
      return;
    }
    if (partnerExclusiveParam === 'team' || partnerExclusiveParam === 'solo') {
      setLegacyPartnerExclusiveLayout(null);
      return;
    }
    let cancelled = false;
    const token = partnerOfferToken.trim();
    fetch(`/api/partner-offer/onboarding-hint?token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((d: { partnerExclusive?: string }) => {
        if (cancelled) return;
        setLegacyPartnerExclusiveLayout(d.partnerExclusive === 'solo' ? 'solo' : 'team');
      })
      .catch(() => {
        if (!cancelled) setLegacyPartnerExclusiveLayout('team');
      });
    return () => {
      cancelled = true;
    };
  }, [isExclusivePartnerOnboarding, partnerOfferToken, partnerExclusiveParam]);

  const resolvedPartnerExclusiveLayout: 'team' | 'solo' | null = !isExclusivePartnerOnboarding
    ? null
    : partnerExclusiveParam === 'team' || partnerExclusiveParam === 'solo'
      ? partnerExclusiveParam
      : legacyPartnerExclusiveLayout;

  const isExclusivePartnerLayoutReady =
    !isExclusivePartnerOnboarding ||
    partnerExclusiveParam === 'team' ||
    partnerExclusiveParam === 'solo' ||
    legacyPartnerExclusiveLayout !== null;

  const isExclusivePartnerTeamLayout =
    isExclusivePartnerOnboarding && resolvedPartnerExclusiveLayout === 'team';

  const onboardingDemo =
    isIgOnboardingPath || (isExclusivePartnerOnboarding && resolvedPartnerExclusiveLayout === 'solo')
      ? 'ig-dm'
      : 'team';
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [workEmail, setWorkEmail] = useState('');
  const [accountPassword, setAccountPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [useCase, setUseCase] = useState<'solo' | 'team'>('solo');
  const [workspaceName, setWorkspaceName] = useState('');
  const [industry, setIndustry] = useState('');
  const [brokerage, setBrokerage] = useState('');
  const [brokerageId, setBrokerageId] = useState<string | null>(null);
  const [brokerageSuggestions, setBrokerageSuggestions] = useState<BrokerageSuggestion[]>([]);
  const [brokerageSuggestionsOpen, setBrokerageSuggestionsOpen] = useState(false);
  const brokerageQueryTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const brokerageInputRef = useRef<HTMLInputElement>(null);
  const brokerageListRef = useRef<HTMLDivElement>(null);
  const [referralCode, setReferralCode] = useState('');
  const [seats, setSeats] = useState(TEAM_MIN_SEATS);
  const [teamInviteEmails, setTeamInviteEmails] = useState<string[]>(['']);

  // When arriving from app handoff (Continue on web), skip name step and start at team/workspace.
  useEffect(() => {
    if (searchParams.get('from_handoff') === '1') {
      setStep(2);
      setUseCase('team');
      setSeats(TEAM_MIN_SEATS);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!isExclusivePartnerTeamLayout) return;
    setUseCase('team');
    setSeats((previous) => Math.max(TEAM_MIN_SEATS, previous));
  }, [isExclusivePartnerTeamLayout]);

  const canStep1 =
    firstName.trim().length > 0 &&
    lastName.trim().length > 0 &&
    (!isExclusivePartnerOnboarding ||
      (workEmail.trim().length > 0 && accountPassword.trim().length >= 6));
  const canStep3 =
    workspaceName.trim().length > 0 && industry.length > 0;

  const fetchBrokerageSuggestions = useCallback(async (q: string) => {
    if (!q.trim()) {
      setBrokerageSuggestions([]);
      return;
    }
    try {
      const res = await fetch(
        `/api/brokerages/search?q=${encodeURIComponent(q)}&limit=15`,
        { credentials: 'include' }
      );
      const data = await res.json().catch(() => []);
      setBrokerageSuggestions(Array.isArray(data) ? data : []);
    } catch {
      setBrokerageSuggestions([]);
    }
  }, []);

  useEffect(() => {
    if (industry !== 'Real Estate') return;
    const value = brokerage.trim();
    if (brokerageQueryTimeout.current) clearTimeout(brokerageQueryTimeout.current);
    if (!value) {
      setBrokerageSuggestions([]);
      setBrokerageSuggestionsOpen(false);
      return;
    }
    brokerageQueryTimeout.current = setTimeout(() => {
      fetchBrokerageSuggestions(value);
      setBrokerageSuggestionsOpen(true);
      brokerageQueryTimeout.current = null;
    }, 200);
    return () => {
      if (brokerageQueryTimeout.current) clearTimeout(brokerageQueryTimeout.current);
    };
  }, [industry, brokerage, fetchBrokerageSuggestions]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        brokerageSuggestionsOpen &&
        brokerageInputRef.current &&
        brokerageListRef.current &&
        !brokerageInputRef.current.contains(e.target as Node) &&
        !brokerageListRef.current.contains(e.target as Node)
      ) {
        setBrokerageSuggestionsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [brokerageSuggestionsOpen]);

  const handleSubmit = async () => {
    setError(null);
    setLoading(true);
    try {
      const normalizedInviteEmails = normalizeEmailList(teamInviteEmails);
      const res = await fetch('/api/onboarding/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          workspaceName: workspaceName.trim(),
          industry: industry.trim(),
          referralCode:
            isExclusivePartnerOnboarding && isExclusivePartnerTeamLayout
              ? null
              : referralCode.trim() || null,
          brokerage: brokerage.trim() || undefined,
          brokerageId: brokerageId ?? undefined,
          useCase: isExclusivePartnerTeamLayout ? 'team' : useCase,
          maxSeats: isExclusivePartnerTeamLayout
            ? Math.max(TEAM_MIN_SEATS, normalizedInviteEmails.length + 1, seats)
            : useCase === 'team'
              ? Math.max(TEAM_MIN_SEATS, seats)
              : SOLO_SEATS,
          partnerOfferToken: isExclusivePartnerOnboarding ? partnerOfferToken : undefined,
          teamMemberEmails: isExclusivePartnerTeamLayout ? normalizedInviteEmails : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.redirect) {
        window.location.href = data.redirect;
        return;
      }
      setError(data?.error ?? 'Something went wrong. Please try again.');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = useCallback(async () => {
    setSigningOut(true);
    try {
      const supabase = await getClientAsync();
      await supabase.auth.signOut();
      router.push('/login');
    } catch {
      setSigningOut(false);
    }
  }, [router]);

  const ensureExclusiveAuth = useCallback(async (): Promise<boolean> => {
    if (!isExclusivePartnerOnboarding) return true;
    const normalizedEmail = workEmail.trim().toLowerCase();
    if (!normalizedEmail || accountPassword.trim().length < 6) {
      setAuthError('Enter a valid work email and a password (6+ characters).');
      return false;
    }

    setAuthError(null);
    setAuthLoading(true);
    try {
      const supabase = await getClientAsync();
      const {
        data: { user: currentUser },
      } = await supabase.auth.getUser();
      if (
        currentUser?.email &&
        currentUser.email.toLowerCase() === normalizedEmail
      ) {
        return true;
      }

      if (currentUser) {
        await supabase.auth.signOut();
      }

      const signInResult = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password: accountPassword,
      });
      if (!signInResult.error && signInResult.data?.session) {
        return true;
      }

      const isInvalidCredentials =
        signInResult.error?.message
          ?.toLowerCase()
          .includes('invalid login credentials') ||
        signInResult.error?.message
          ?.toLowerCase()
          .includes('invalid_credentials');

      if (!isInvalidCredentials) {
        setAuthError(signInResult.error?.message || 'Failed to sign in with this email.');
        return false;
      }

      const nextQs = new URLSearchParams({
        offer: 'exclusive30',
        partnerOfferToken: partnerOfferToken ?? '',
      });
      if (partnerExclusiveParam === 'team' || partnerExclusiveParam === 'solo') {
        nextQs.set('partnerExclusive', partnerExclusiveParam);
      } else if (legacyPartnerExclusiveLayout === 'team' || legacyPartnerExclusiveLayout === 'solo') {
        nextQs.set('partnerExclusive', legacyPartnerExclusiveLayout);
      }
      const onboardingNext = `${onboardingEntryPath}?${nextQs.toString()}`;
      const callbackUrl = new URL('/auth/callback', window.location.origin);
      callbackUrl.searchParams.set('next', onboardingNext);

      const signUpResult = await supabase.auth.signUp({
        email: normalizedEmail,
        password: accountPassword,
        options: {
          emailRedirectTo: callbackUrl.toString(),
          data: {
            first_name: firstName.trim() || undefined,
            last_name: lastName.trim() || undefined,
          },
        },
      });

      if (signUpResult.error) {
        setAuthError(signUpResult.error.message || 'Failed to create account.');
        return false;
      }

      if (signUpResult.data?.session) {
        return true;
      }

      setAuthError(
        'Check your inbox to confirm your email, then return to finish onboarding.'
      );
      return false;
    } catch {
      setAuthError('Could not verify account. Please try again.');
      return false;
    } finally {
      setAuthLoading(false);
    }
  }, [
    accountPassword,
    firstName,
    isExclusivePartnerOnboarding,
    lastName,
    legacyPartnerExclusiveLayout,
    onboardingEntryPath,
    partnerExclusiveParam,
    partnerOfferToken,
    workEmail,
  ]);

  if (!isExclusivePartnerLayoutReady) {
    return (
      <div className="dark min-h-screen bg-gradient-to-br from-black to-[#262626] flex flex-col items-center justify-center p-6">
        <p className="text-zinc-400">Loading your offer…</p>
      </div>
    );
  }

  return (
    <div className="dark min-h-screen bg-gradient-to-br from-black to-[#262626] flex flex-col items-center justify-center p-6 pb-28 sm:pb-24 relative overflow-x-hidden overflow-y-auto">
      <div className="absolute inset-0 bg-gradient-to-b from-red-950/40 via-transparent to-black/80 pointer-events-none" />
      <div
        className={`relative w-full min-w-0 space-y-8 rounded-2xl border border-white/15 bg-white/[0.06] p-6 sm:p-10 backdrop-blur-2xl shadow-[0_24px_70px_rgba(0,0,0,0.6),0_10px_30px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.2)] ${step >= 4 ? 'max-w-5xl' : 'max-w-lg'}`}
      >
        <div className="text-center space-y-2">
          <h1
            className={`max-w-full min-w-0 font-bold leading-tight text-white break-words [overflow-wrap:anywhere] ${
              step === 4
                ? 'text-3xl sm:text-4xl md:text-5xl'
                : step === 5
                  ? 'text-4xl'
                  : 'text-3xl'
            }`}
          >
            {step === 1 && 'What should we call you?'}
            {step === 2 && 'How will you use FLYR?'}
            {step === 3 && 'Set up your workspace'}
            {step === 4 && (
              <>
                FLYR is revolutionizing
                <br />
                Door 2 Door Marketing
              </>
            )}
            {step === 5 && (
              <>
                You&apos;re one step away from tracking every door
                <br />
                and never losing a lead.
              </>
            )}
          </h1>
          {(step === 1 || step === 2 || step === 3) && (
            <p className="text-base text-[#AAAAAA]">
              {step === 1 && 'We use this to personalize your experience.'}
              {step === 2 &&
                (isExclusivePartnerTeamLayout
                  ? 'We set this to team mode for your exclusive offer.'
                  : 'Choose solo or invite your team.')}
              {step === 3 && 'Name your business and tell us your industry.'}
            </p>
          )}
        </div>

        {isExclusivePartnerOnboarding && step === 1 ? (
          <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4">
            <p className="text-center text-xs font-semibold uppercase tracking-wider text-red-300">
              {isExclusivePartnerTeamLayout ? 'Exclusive Team Onboarding' : 'Exclusive offer'}
            </p>
            <p className="mt-1 text-center text-lg font-semibold text-white">
              30-day exclusive offer unlocked
            </p>
            <p className="mt-1 text-center text-sm text-zinc-300">
              Finish onboarding to activate your 30-day trial and watch the demo if you haven&apos;t already.
            </p>
            <div className="mt-4 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900">
              <ExclusiveOfferArcadeEmbed demo={onboardingDemo} />
            </div>
          </div>
        ) : null}

        {step === 1 && (
          <form
            className="space-y-5"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!canStep1) return;
              const authReady = await ensureExclusiveAuth();
              if (authReady) setStep((s) => s + 1);
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="firstName" className="text-base text-white">First name</Label>
              <Input
                id="firstName"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="First name"
                autoFocus
                className="h-16 text-2xl md:text-2xl text-white placeholder:text-gray-500 bg-[#2a2a2a] border-zinc-600 focus-visible:border-white focus-visible:ring-2 focus-visible:ring-white/40"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName" className="text-base text-white">Last name</Label>
              <Input
                id="lastName"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Last name"
                className="h-16 text-2xl md:text-2xl text-white placeholder:text-gray-500 bg-[#2a2a2a] border-zinc-600 focus-visible:border-white focus-visible:ring-2 focus-visible:ring-white/40"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && canStep1) {
                    e.preventDefault();
                    setStep((s) => s + 1);
                  }
                }}
              />
            </div>
            {isExclusivePartnerOnboarding ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="workEmail" className="text-base text-white">Work email</Label>
                  <Input
                    id="workEmail"
                    type="email"
                    value={workEmail}
                    onChange={(e) => setWorkEmail(e.target.value)}
                    placeholder="you@company.com"
                    className="h-16 text-2xl md:text-2xl text-white placeholder:text-gray-500 bg-[#2a2a2a] border-zinc-600 focus-visible:border-white focus-visible:ring-2 focus-visible:ring-white/40"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="accountPassword" className="text-base text-white">Password</Label>
                  <Input
                    id="accountPassword"
                    type="password"
                    value={accountPassword}
                    onChange={(e) => setAccountPassword(e.target.value)}
                    placeholder="At least 6 characters"
                    className="h-16 text-2xl md:text-2xl text-white placeholder:text-gray-500 bg-[#2a2a2a] border-zinc-600 focus-visible:border-white focus-visible:ring-2 focus-visible:ring-white/40"
                  />
                </div>
                <p className="text-xs text-zinc-400">
                  We will sign in or create this account before continuing so onboarding never runs on the wrong user.
                </p>
              </>
            ) : null}
          </form>
        )}

        {step === 2 && (
          isExclusivePartnerTeamLayout ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-center">
                <p className="text-sm font-semibold text-white">Team onboarding is pre-selected for this exclusive offer.</p>
                <p className="mt-1 text-xs text-zinc-300">Add teammate emails now and invites will be sent after onboarding completes.</p>
              </div>
              <div className="space-y-3">
                <Label className="text-base text-white">Team member emails (optional)</Label>
                <div className="space-y-2">
                  {teamInviteEmails.map((email, index) => (
                    <Input
                      key={index}
                      type="email"
                      value={email}
                      onChange={(event) => {
                        const nextEmails = [...teamInviteEmails];
                        nextEmails[index] = event.target.value;
                        setTeamInviteEmails(nextEmails);
                      }}
                      placeholder={`teammate${index + 1}@company.com`}
                      className="h-12 text-base text-white placeholder:text-gray-500 bg-[#2a2a2a] border-zinc-600 focus-visible:border-white focus-visible:ring-2 focus-visible:ring-white/40"
                    />
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setTeamInviteEmails((prev) => [...prev, ''])}
                    className="border-zinc-600 text-white hover:bg-zinc-800 hover:text-white"
                  >
                    Add another email
                  </Button>
                  {teamInviteEmails.length > 1 ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setTeamInviteEmails((prev) => prev.slice(0, -1))}
                      className="border-zinc-600 text-white hover:bg-zinc-800 hover:text-white"
                    >
                      Remove last
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <button
                type="button"
                onClick={() => {
                  setUseCase('solo');
                  setSeats(SOLO_SEATS);
                }}
                className={`flex flex-col items-center gap-2 rounded-xl border-2 p-7 transition-colors ${
                  useCase === 'solo'
                    ? 'border-red-500 bg-red-500/10'
                    : 'border-zinc-600 hover:border-zinc-500'
                }`}
              >
                <User className="h-9 w-9 text-[#AAAAAA]" />
                <span className="text-base font-medium text-white">For myself</span>
                <span className="text-sm text-[#AAAAAA] text-center">
                  Solo use
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setUseCase('team');
                  setSeats((prev) => Math.max(prev, TEAM_MIN_SEATS));
                }}
                className={`flex flex-col items-center gap-2 rounded-xl border-2 p-7 transition-colors ${
                  useCase === 'team'
                    ? 'border-red-500 bg-red-500/10'
                    : 'border-zinc-600 hover:border-zinc-500'
                }`}
              >
                <Users className="h-9 w-9 text-[#AAAAAA]" />
                <span className="text-base font-medium text-white">For my team</span>
                <span className="text-sm text-[#AAAAAA] text-center">
                  Add teammates later
                </span>
              </button>
            </div>
          )
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="workspaceName" className="text-base text-white">Business or team name</Label>
              <Input
                id="workspaceName"
                value={workspaceName}
                onChange={(e) => setWorkspaceName(e.target.value)}
                placeholder="XYZ Group"
                autoFocus
                className="h-16 text-2xl md:text-2xl text-white placeholder:text-gray-500 bg-[#2a2a2a] border-zinc-600 focus-visible:border-white focus-visible:ring-2 focus-visible:ring-white/40"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="industry" className="text-base text-white">Industry</Label>
              <Select
                value={industry || undefined}
                onValueChange={(value) => {
                  setIndustry(value);
                  if (value !== 'Real Estate') {
                    setBrokerage('');
                    setBrokerageId(null);
                    setBrokerageSuggestions([]);
                    setBrokerageSuggestionsOpen(false);
                  }
                }}
              >
                <SelectTrigger id="industry" className="w-full h-16 text-2xl md:text-2xl text-white bg-[#2a2a2a] border-zinc-600 data-[placeholder]:text-gray-500">
                  <SelectValue placeholder="Select industry" />
                </SelectTrigger>
                <SelectContent className="max-h-[190px] overflow-y-auto">
                  {INDUSTRIES_TOP.map((ind) => (
                    <SelectItem key={ind} value={ind}>
                      {ind}
                    </SelectItem>
                  ))}
                  <SelectSeparator className="bg-red-500/50 my-1.5 mx-3 h-px rounded-full" />
                  {INDUSTRIES_REST.map((ind) => (
                    <SelectItem key={ind} value={ind}>
                      {ind}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {industry === 'Real Estate' && (
              <div className="space-y-2 relative" ref={brokerageListRef}>
                <Label htmlFor="brokerage" className="text-base text-white">Brokerage</Label>
                <Input
                  ref={brokerageInputRef}
                  id="brokerage"
                  value={brokerage}
                  onChange={(e) => {
                    setBrokerage(e.target.value);
                    setBrokerageId(null);
                  }}
                  onFocus={() => brokerage.trim() && setBrokerageSuggestionsOpen(true)}
                  placeholder="Search brokerage..."
                  className="h-16 text-2xl md:text-2xl text-white placeholder:text-gray-500 bg-[#2a2a2a] border-zinc-600 focus-visible:border-white focus-visible:ring-2 focus-visible:ring-white/40"
                  autoComplete="off"
                />
                {brokerageSuggestionsOpen && brokerage.trim() && (
                  <div
                    className="absolute z-50 mt-1 w-full rounded-md border border-zinc-600 bg-[#2a2a2a] shadow-lg max-h-72 overflow-auto py-1"
                    role="listbox"
                  >
                    {brokerageSuggestions.map((b) => (
                      <button
                        key={b.id}
                        type="button"
                        role="option"
                        className="w-full px-4 py-3 text-left text-base text-white hover:bg-zinc-700 focus:bg-zinc-700 focus:outline-none flex items-center gap-3"
                        onClick={() => {
                          setBrokerage(b.name);
                          setBrokerageId(b.id);
                          setBrokerageSuggestionsOpen(false);
                          setBrokerageSuggestions([]);
                        }}
                      >
                        <Building2 className="h-4 w-4 shrink-0 text-[#AAAAAA]" aria-hidden />
                        <span>{b.name}</span>
                        <span className="text-xs text-[#AAAAAA] ml-auto">Existing</span>
                      </button>
                    ))}
                    {brokerage.trim() &&
                      !brokerageSuggestions.some(
                        (b) => b.name.toLowerCase() === brokerage.trim().toLowerCase()
                      ) && (
                        <button
                          type="button"
                          role="option"
                          className="w-full px-4 py-3 text-left text-base text-white hover:bg-zinc-700 focus:bg-zinc-700 focus:outline-none flex items-center gap-3 border-t border-zinc-600 mt-1 pt-2"
                          onClick={() => {
                            const value = brokerage.trim().replace(/\s+/g, ' ');
                            setBrokerage(value);
                            setBrokerageId(null);
                            setBrokerageSuggestionsOpen(false);
                            setBrokerageSuggestions([]);
                          }}
                        >
                          <Plus className="h-4 w-4 shrink-0 text-red-500" aria-hidden />
                          <span className="text-[#AAAAAA]">
                            Add &quot;{brokerage.trim()}&quot; as new brokerage
                          </span>
                        </button>
                      )}
                  </div>
                )}
              </div>
            )}
            {!(isExclusivePartnerOnboarding && isExclusivePartnerTeamLayout) ? (
              <div className="space-y-2">
                <Label htmlFor="referralCode" className="text-base text-white">Referral code (optional)</Label>
                <Input
                  id="referralCode"
                  value={referralCode}
                  onChange={(e) => setReferralCode(e.target.value)}
                  placeholder="e.g. Launch2026"
                  className="h-16 text-2xl md:text-2xl text-white placeholder:text-gray-500 bg-[#2a2a2a] border-zinc-600 focus-visible:border-white focus-visible:ring-2 focus-visible:ring-white/40"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && canStep3) {
                      e.preventDefault();
                      setStep(4);
                    }
                  }}
                />
              </div>
            ) : null}
            {useCase === 'team' && (
              <div className="space-y-2">
                <Label className="text-base text-white">Members</Label>
                <div className="flex items-center justify-between rounded-md border border-zinc-600 bg-[#2a2a2a] px-4 py-3">
                  <span className="text-2xl md:text-2xl text-white tabular-nums">
                    {seats}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-10 w-10 text-white hover:bg-zinc-700"
                      onClick={() =>
                        setSeats((prev) => Math.max(TEAM_MIN_SEATS, prev - 1))
                      }
                      disabled={seats <= TEAM_MIN_SEATS}
                      aria-label="Decrease seats"
                    >
                      <Minus className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-10 w-10 text-white hover:bg-zinc-700"
                      onClick={() => setSeats((prev) => Math.min(MAX_SEATS, prev + 1))}
                      disabled={seats >= MAX_SEATS}
                      aria-label="Increase seats"
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {step === 4 && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {[
              { title: 'Create your campaign', src: '/onboarding-create-campaign.png' },
              { title: 'Own your data', src: '/onboarding-own-data.png' },
              { title: 'Track your results', src: '/onboarding-track-results.png' },
            ].map((card) => (
              <div
                key={card.title}
                className="flex flex-col items-center"
              >
                <div className="w-full rounded-xl border border-zinc-600 bg-[#2a2a2a] overflow-hidden shadow-sm">
                  <div className="aspect-[4/3] w-full bg-zinc-800 overflow-hidden">
                    <img
                      src={card.src}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  </div>
                </div>
                <p className="mt-3 text-center text-2xl font-semibold text-white">{card.title}</p>
              </div>
            ))}
          </div>
        )}

        {step === 5 && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { title: 'Plan your route', src: '/onboarding-see-rank.svg' },
              { title: "Record session's", src: '/onboarding-record-session.svg' },
              { title: 'Stay organized', src: '/onboarding-stay-organized.svg' },
              { title: 'See your rank', src: '/onboarding-plan-route.svg' },
            ].map((card) => (
              <div
                key={card.title}
                className="flex flex-col items-center"
              >
                <div className="w-full flex items-center justify-center p-1 overflow-hidden">
                  <img
                    src={card.src}
                    alt=""
                    className="w-full h-[210px] object-contain"
                  />
                </div>
                <p className="mt-2 text-center text-2xl font-semibold text-white">{card.title}</p>
              </div>
            ))}
          </div>
        )}

        {error && (
          <p className="text-sm text-red-400 text-center">{error}</p>
        )}
        {authError && (
          <p className="text-sm text-red-400 text-center">{authError}</p>
        )}

        <div className="flex flex-col gap-3">
          {step > 1 && (
            <Button
              type="button"
              variant="outline"
              onClick={() => setStep((s) => s - 1)}
              className="w-full h-12 text-base border-zinc-600 text-white hover:bg-zinc-800 hover:text-white"
            >
              Back
            </Button>
          )}
          {step < 5 ? (
            <Button
              type="button"
              onClick={async () => {
                if (step === 1 && isExclusivePartnerOnboarding) {
                  if (!canStep1) return;
                  const authReady = await ensureExclusiveAuth();
                  if (!authReady) return;
                }
                setStep((s) => s + 1);
              }}
              disabled={
                authLoading ||
                (step === 1 && !canStep1) ||
                (step === 3 && !canStep3)
              }
              className="w-full h-14 text-lg font-semibold bg-[#ef4444] text-white hover:bg-[#dc2626] border-0"
            >
              {authLoading && step === 1 ? 'Verifying account…' : 'Continue'}
            </Button>
          ) : (
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={loading}
              className="w-full h-14 text-lg font-semibold bg-[#ef4444] text-white hover:bg-[#dc2626] border-0"
            >
              {loading
                ? 'Saving…'
                : isExclusivePartnerOnboarding
                  ? 'Activate 30-day exclusive access'
                  : 'Continue for 14-day free trial'}
            </Button>
          )}
        </div>
      </div>

      <div className="fixed bottom-5 left-0 right-0 z-20 flex justify-center pointer-events-none px-4">
        <button
          type="button"
          onClick={() => void handleLogout()}
          disabled={signingOut}
          title="Log out"
          aria-label="Log out"
          className="pointer-events-auto inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-black/40 text-zinc-400 backdrop-blur-sm transition-colors hover:border-white/25 hover:bg-white/10 hover:text-white disabled:opacity-50"
        >
          <LogoutDoorEmblem className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
          <p className="text-muted-foreground">Loading…</p>
        </div>
      }
    >
      <OnboardingContent />
    </Suspense>
  );
}
