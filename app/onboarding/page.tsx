'use client';

import { Suspense, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import Image from 'next/image';
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
import { Check, ChevronDown, User, Users, Building2, Plus } from 'lucide-react';
import { ExclusiveOfferArcadeEmbed } from '@/components/landing/ExclusiveOfferArcadeEmbed';
import { getClientAsync } from '@/lib/supabase/client';
import { COUNTRY_OPTIONS } from '@/lib/countries';

type BrokerageSuggestion = { id: string; name: string };
type SalespersonInviteHint = {
  valid?: boolean;
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  workspaceName?: string | null;
  completed?: boolean;
};
type ReferralValidation = {
  referralCode: string;
  trialDays: number;
  ambassadorName?: string | null;
  partnerName?: string | null;
  salespersonName?: string | null;
  referralType?: 'ambassador' | 'salesperson';
};
type BillingPlan = 'annual' | 'monthly';
type BillingCurrency = 'USD' | 'CAD';
type OnboardingCompletionResponse = {
  success?: boolean;
  redirect?: string;
  error?: string;
};

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
const MAX_SEATS = 200;
const FINAL_ONBOARDING_STEP = 6;
const EXCLUSIVE_ONBOARDING_AUTH_DRAFT_KEY = 'flyr.exclusiveOnboardingAuthDraft';

function getBillingCurrency(): BillingCurrency {
  return 'USD';
}

function formatPlanPrice(amount: number, currency: BillingCurrency): string {
  const formatted = amount.toLocaleString('en-US', {
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return currency === 'CAD' ? `CA$${formatted} CAD` : `$${formatted} USD`;
}

function getSeatPricing(): {
  seatMonthlyDisplay: number;
} {
  return { seatMonthlyDisplay: 30 };
}

function normalizeReferralCodeInput(value: string): string {
  return value
    .toUpperCase()
    .replace(/&/g, 'AND')
    .replace(/[^A-Z0-9]+/g, '')
    .slice(0, 20);
}

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

function formatAuthError(
  error: unknown,
  fallback = 'Sign-in is temporarily unavailable. Please try again in a minute.'
) {
  const asRecord =
    error && typeof error === 'object' ? (error as Record<string, unknown>) : null;
  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof asRecord?.message === 'string'
        ? asRecord.message
        : '';
  const message = rawMessage.trim();
  const status = typeof asRecord?.status === 'number' ? asRecord.status : null;

  const isUpstreamFailure =
    message === '{}' ||
    /upstream connect error|remote connection failure|service unavailable|fetch failed|timeout|timed out/i.test(
      message
    ) ||
    (status !== null && status >= 500);

  if (isUpstreamFailure) {
    return fallback;
  }

  return message || fallback;
}

function OnboardingContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const offerType = searchParams.get('offer');
  const partnerOfferToken = searchParams.get('partnerOfferToken');
  const salespersonInviteToken = searchParams.get('salespersonInvite');
  const handoffCode = searchParams.get('code')?.trim() ?? '';
  const partnerExclusiveParam = searchParams.get('partnerExclusive');
  const challenge30FromUrl = searchParams.get('challenge30') === '1';
  const isExclusivePartnerOnboarding =
    offerType === 'exclusive30' &&
    typeof partnerOfferToken === 'string' &&
    partnerOfferToken.trim().length > 0;
  const [legacyPartnerExclusiveLayout, setLegacyPartnerExclusiveLayout] = useState<'team' | 'solo' | null>(
    null
  );
  const [hintChallenge30, setHintChallenge30] = useState<boolean | null>(null);
  const isIgOnboardingPath = pathname === '/onboarding/ig';
  const onboardingEntryPath = isIgOnboardingPath ? '/onboarding/ig' : '/onboarding';
  const isSalespersonOnboarding =
    typeof salespersonInviteToken === 'string' && salespersonInviteToken.trim().length > 0;
  const isDialerOnboarding =
    searchParams.get('source') === 'dialer' || searchParams.get('campaign') === 'power-dialer';
  const requiresOnboardingAuth = isExclusivePartnerOnboarding || isSalespersonOnboarding || isDialerOnboarding;
  const requiresStepOneAuth = requiresOnboardingAuth;

  useEffect(() => {
    if (!isExclusivePartnerOnboarding) {
      setLegacyPartnerExclusiveLayout(null);
      setHintChallenge30(null);
      return;
    }

    const needsLayoutHint =
      partnerExclusiveParam !== 'team' && partnerExclusiveParam !== 'solo';
    const needsChallengeHint = !challenge30FromUrl;

    if (!needsLayoutHint && !needsChallengeHint) {
      setLegacyPartnerExclusiveLayout(null);
      setHintChallenge30(null);
      return;
    }

    let cancelled = false;
    const token = partnerOfferToken.trim();
    fetch(`/api/partner-offer/onboarding-hint?token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((d: { partnerExclusive?: string; challenge30?: boolean }) => {
        if (cancelled) return;
        if (needsLayoutHint) {
          setLegacyPartnerExclusiveLayout(d.partnerExclusive === 'solo' ? 'solo' : 'team');
        } else {
          setLegacyPartnerExclusiveLayout(null);
        }
        if (needsChallengeHint) {
          setHintChallenge30(d.challenge30 === true);
        } else {
          setHintChallenge30(null);
        }
      })
      .catch(() => {
        if (cancelled) return;
        if (needsLayoutHint) setLegacyPartnerExclusiveLayout('team');
        if (needsChallengeHint) setHintChallenge30(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isExclusivePartnerOnboarding, partnerOfferToken, partnerExclusiveParam, challenge30FromUrl]);

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

  const hideExclusiveStep1Demo = challenge30FromUrl || hintChallenge30 === true;
  const shouldShowReferralStep =
    !isSalespersonOnboarding &&
    !(isExclusivePartnerOnboarding && isExclusivePartnerTeamLayout);

  const onboardingDemo =
    isIgOnboardingPath || (isExclusivePartnerOnboarding && resolvedPartnerExclusiveLayout === 'solo')
      ? 'ig-dm'
      : 'team';
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const billingPlan: BillingPlan = 'monthly';
  const [postOnboardingRedirect, setPostOnboardingRedirect] = useState<string | null>(null);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [countryCode, setCountryCode] = useState('');
  const [countrySearchOpen, setCountrySearchOpen] = useState(false);
  const [countrySearchQuery, setCountrySearchQuery] = useState('');
  const [workEmail, setWorkEmail] = useState('');
  const [accountPassword, setAccountPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<'credentials' | 'google' | 'apple' | null>(null);
  const [authenticatedEmail, setAuthenticatedEmail] = useState<string | null>(null);
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
  const [referralValidation, setReferralValidation] = useState<ReferralValidation | null>(null);
  const [referralValidationLoading, setReferralValidationLoading] = useState(false);
  const [referralValidationError, setReferralValidationError] = useState<string | null>(null);
  const [referralSource, setReferralSource] = useState<string | null>(null);
  const [referralCampaign, setReferralCampaign] = useState<string | null>(null);
  const [seats, setSeats] = useState(TEAM_MIN_SEATS);
  const [teamInviteEmails, setTeamInviteEmails] = useState<string[]>(['']);
  const demoPrefillApplied = useRef(false);
  const [handoffRedeemState, setHandoffRedeemState] = useState<
    'idle' | 'loading' | 'error'
  >(handoffCode ? 'loading' : 'idle');
  const [handoffRedeemError, setHandoffRedeemError] = useState<string>('');

  useEffect(() => {
    if (demoPrefillApplied.current || searchParams.get('source') !== 'demo') return;
    demoPrefillApplied.current = true;

    const demoFirstName = searchParams.get('firstName')?.trim() ?? '';
    const demoLastName = searchParams.get('lastName')?.trim() ?? '';
    const demoWorkEmail = searchParams.get('workEmail')?.trim().toLowerCase() ?? '';
    const demoTeamSize = searchParams.get('teamSize');

    if (demoFirstName) setFirstName((current) => current || demoFirstName);
    if (demoLastName) setLastName((current) => current || demoLastName);
    if (demoWorkEmail) setWorkEmail((current) => current || demoWorkEmail);

    if (demoTeamSize === 'solo') {
      setUseCase('solo');
      setSeats(SOLO_SEATS);
    } else if (demoTeamSize === '2-5') {
      setUseCase('team');
      setSeats(2);
    } else if (demoTeamSize === '6-20') {
      setUseCase('team');
      setSeats(6);
    } else if (demoTeamSize === '20-plus') {
      setUseCase('team');
      setSeats(20);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!handoffCode) {
      setHandoffRedeemState('idle');
      setHandoffRedeemError('');
      return;
    }

    let cancelled = false;
    setHandoffRedeemState('loading');
    setHandoffRedeemError('');

    fetch('/api/auth/redeem-handoff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ code: handoffCode }),
    })
      .then(async (response) => {
        if (cancelled) return;
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          setHandoffRedeemState('error');
          setHandoffRedeemError(
            typeof payload?.error === 'string'
              ? payload.error
              : 'This onboarding link is invalid or expired.'
          );
          return;
        }

        const params = new URLSearchParams(searchParams.toString());
        params.delete('code');
        const nextQuery = params.toString();
        router.replace(`${pathname}${nextQuery ? `?${nextQuery}` : ''}`);
      })
      .catch(() => {
        if (cancelled) return;
        setHandoffRedeemState('error');
        setHandoffRedeemError('Could not sign you in from the app. Open onboarding again from Android.');
      });

    return () => {
      cancelled = true;
    };
  }, [handoffCode, pathname, router, searchParams]);

  useEffect(() => {
    if (!isSalespersonOnboarding || !salespersonInviteToken?.trim()) return;

    let cancelled = false;
    fetch(`/api/salesperson-invites/validate?token=${encodeURIComponent(salespersonInviteToken.trim())}`)
      .then((response) => response.json().catch(() => ({} as SalespersonInviteHint)))
      .then((payload: SalespersonInviteHint) => {
        if (cancelled || !payload?.valid) return;
        if (payload.firstName) setFirstName((current) => current || payload.firstName || '');
        if (payload.lastName) setLastName((current) => current || payload.lastName || '');
        if (payload.email) setWorkEmail(payload.email.trim().toLowerCase());
        if (payload.workspaceName) setWorkspaceName(payload.workspaceName);
        setUseCase('solo');
        setSeats(SOLO_SEATS);
        setIndustry((current) => current || 'Real Estate');
      })
      .catch(() => {
        if (!cancelled) {
          setError('This salesperson invite is invalid or expired.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isSalespersonOnboarding, salespersonInviteToken]);

  // When arriving from app handoff (Continue on web), skip name step and start at team/workspace.
  useEffect(() => {
    if (searchParams.get('from_handoff') === '1') {
      setStep(2);
      setUseCase('team');
      setSeats(TEAM_MIN_SEATS);
    }
  }, [searchParams]);

  useEffect(() => {
    const referralCodeFromUrl =
      searchParams.get('referralCode') ?? searchParams.get('ref') ?? '';
    const normalizedReferralCode = normalizeReferralCodeInput(referralCodeFromUrl);
    if (normalizedReferralCode) {
      setReferralCode(normalizedReferralCode);
    }
    setReferralSource(searchParams.get('source'));
    setReferralCampaign(searchParams.get('campaign'));
  }, [searchParams]);

  useEffect(() => {
    const normalized = normalizeReferralCodeInput(referralCode);
    if (referralValidation?.referralCode === normalized) return;
    setReferralValidation(null);
    setReferralValidationError(null);
  }, [referralCode, referralValidation?.referralCode]);

  useEffect(() => {
    if (!isExclusivePartnerTeamLayout) return;
    setUseCase('team');
    setSeats((previous) => Math.max(TEAM_MIN_SEATS, previous));
  }, [isExclusivePartnerTeamLayout]);

  useEffect(() => {
    if (!requiresOnboardingAuth) {
      setAuthenticatedEmail(null);
      return;
    }

    if (typeof window !== 'undefined') {
      try {
        const storedDraft = window.localStorage.getItem(EXCLUSIVE_ONBOARDING_AUTH_DRAFT_KEY);
        if (storedDraft) {
          const parsed = JSON.parse(storedDraft) as {
            firstName?: unknown;
            lastName?: unknown;
            countryCode?: unknown;
            workEmail?: unknown;
          };
          const firstName = typeof parsed.firstName === 'string' ? parsed.firstName.trim() : '';
          const lastName = typeof parsed.lastName === 'string' ? parsed.lastName.trim() : '';
          const workEmail = typeof parsed.workEmail === 'string' ? parsed.workEmail.trim() : '';
          if (firstName) {
            setFirstName((current) => current || firstName);
          }
          if (lastName) {
            setLastName((current) => current || lastName);
          }
          const countryCode = typeof parsed.countryCode === 'string' ? parsed.countryCode.trim() : '';
          if (countryCode) {
            setCountryCode((current) => current || countryCode.toUpperCase());
          }
          if (workEmail) {
            setWorkEmail((current) => current || workEmail.toLowerCase());
          }
        }
      } catch {
        // Ignore malformed local draft data from earlier attempts.
      }
    }

    let cancelled = false;
    getClientAsync()
      .then((supabase) => supabase.auth.getUser())
      .then(({ data: { user } }) => {
        if (cancelled) return;
        const email =
          typeof user?.email === 'string' && user.email.trim()
            ? user.email.trim().toLowerCase()
            : null;
        setAuthenticatedEmail(email);
        if (email) {
          setWorkEmail((current) => current.trim() || email);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAuthenticatedEmail(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [requiresOnboardingAuth]);

  useEffect(() => {
    if (!requiresOnboardingAuth) return;

    const error = searchParams.get('error');
    const errorDescription = searchParams.get('error_description') || '';

    if (error === 'apple_oauth_failed') {
      setAuthError('Could not start Sign in with Apple. Please try again.');
      return;
    }
    if (error === 'apple_exchange_failed') {
      if (typeof window !== 'undefined' && errorDescription) {
        console.warn('[Apple Sign-In]', errorDescription);
      }
      setAuthError('Sign in with Apple did not complete. Please try again or use another sign-in option.');
      return;
    }
    if (error === 'pkce_verifier_mismatch') {
      setAuthError('Sign-in session expired or another sign-in was started. Please try again in a single tab.');
      return;
    }
    if (error === 'auth_failed' || error === 'callback_error') {
      setAuthError('Sign-in failed. Please try again.');
    }
  }, [requiresOnboardingAuth, searchParams]);

  const normalizedWorkEmail = workEmail.trim().toLowerCase();
  const hasAuthenticatedOnboardingSession =
    !!authenticatedEmail &&
    !!normalizedWorkEmail &&
    authenticatedEmail === normalizedWorkEmail;
  const canStep1 =
    firstName.trim().length > 0 &&
    lastName.trim().length > 0 &&
    countryCode.length > 0 &&
    (!requiresStepOneAuth ||
      hasAuthenticatedOnboardingSession ||
      (normalizedWorkEmail.length > 0 && accountPassword.trim().length >= 6));
  const canStep3 =
    workspaceName.trim().length > 0 && industry.length > 0;
  const selectedCountry = COUNTRY_OPTIONS.find((country) => country.code === countryCode);
  const filteredCountries = useMemo(() => {
    const query = countrySearchQuery.trim().toLowerCase();
    if (!query) return COUNTRY_OPTIONS;
    return COUNTRY_OPTIONS.filter((country) =>
      `${country.label} ${country.name} ${country.code}`.toLowerCase().includes(query)
    );
  }, [countrySearchQuery]);
  const billingCurrency = getBillingCurrency();
  const seatPricing = getSeatPricing();
  const selectedSeatCount = useCase === 'team' ? Math.max(TEAM_MIN_SEATS, seats) : SOLO_SEATS;
  const pricingCards = [
    {
      id: 'simple-pro',
      title: 'FLYR Pro',
      seatCount: selectedSeatCount,
      description: 'Everything you need to run campaigns, track routes, and follow up with leads.',
      features: ['Campaign planning', 'Route tracking', 'Lead follow-up', 'Team seats when you need them'],
    },
  ] as const;

  const persistExclusiveAuthDraft = useCallback(() => {
    if (!requiresOnboardingAuth || typeof window === 'undefined') return;
    window.localStorage.setItem(
      EXCLUSIVE_ONBOARDING_AUTH_DRAFT_KEY,
      JSON.stringify({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        countryCode,
        workEmail: normalizedWorkEmail,
      })
    );
  }, [countryCode, firstName, requiresOnboardingAuth, lastName, normalizedWorkEmail]);

  const buildExclusiveAuthCallbackURL = useCallback(() => {
    const callbackUrl = new URL('/auth/callback', window.location.origin);
    const nextPath = `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;
    callbackUrl.searchParams.set('next', nextPath);
    return callbackUrl.toString();
  }, [pathname, searchParams]);

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

  const validateReferralStep = useCallback(async (): Promise<boolean> => {
    const normalizedReferralCode = normalizeReferralCodeInput(referralCode);
    setReferralValidationError(null);

    if (!normalizedReferralCode) {
      setReferralCode('');
      setReferralValidation(null);
      return true;
    }

    if (referralValidation?.referralCode === normalizedReferralCode) {
      return true;
    }

    setReferralValidationLoading(true);
    try {
      const response = await fetch('/api/onboarding/referral-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ referralCode: normalizedReferralCode }),
      });
      const payload = await response.json().catch(() => ({}));

      if (response.ok && payload?.valid === true && payload?.referralCode) {
        const validatedCode = String(payload.referralCode);
        setReferralCode(validatedCode);
        setReferralValidation({
          referralCode: validatedCode,
          trialDays:
            typeof payload.trialDays === 'number' && Number.isFinite(payload.trialDays)
              ? payload.trialDays
              : 30,
          ambassadorName:
            typeof payload.ambassadorName === 'string' ? payload.ambassadorName : null,
          partnerName:
            typeof payload.partnerName === 'string' ? payload.partnerName : null,
          salespersonName:
            typeof payload.salespersonName === 'string' ? payload.salespersonName : null,
          referralType:
            payload.referralType === 'salesperson' ? 'salesperson' : 'ambassador',
        });
        return true;
      }

      setReferralValidation(null);
      setReferralValidationError(
        typeof payload?.error === 'string'
          ? payload.error
          : 'Enter a valid ambassador referral code, or leave this blank.'
      );
      return false;
    } catch {
      setReferralValidation(null);
      setReferralValidationError('Network error validating referral code. Please try again.');
      return false;
    } finally {
      setReferralValidationLoading(false);
    }
  }, [referralCode, referralValidation?.referralCode]);

  const completeOnboarding = async (options?: {
    checkoutSeats?: number;
    checkoutUseCase?: 'solo' | 'team';
  }): Promise<OnboardingCompletionResponse | null> => {
    setError(null);
    setCheckoutError(null);
    setLoading(true);
    try {
      const normalizedInviteEmails = normalizeEmailList(teamInviteEmails);
      const completionUseCase = options?.checkoutUseCase ?? useCase;
      const completionSeats =
        typeof options?.checkoutSeats === 'number' && Number.isFinite(options.checkoutSeats)
          ? options.checkoutSeats
          : seats;
      const res = await fetch('/api/onboarding/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          countryCode,
          workspaceName: workspaceName.trim(),
          industry: industry.trim(),
          referralCode: shouldShowReferralStep ? referralCode.trim() || null : null,
          referralSource,
          referralCampaign,
          brokerage: brokerage.trim() || undefined,
          brokerageId: brokerageId ?? undefined,
          useCase: isExclusivePartnerTeamLayout ? 'team' : completionUseCase,
          maxSeats: isExclusivePartnerTeamLayout
            ? Math.max(TEAM_MIN_SEATS, normalizedInviteEmails.length + 1, completionSeats)
            : completionUseCase === 'team'
              ? Math.max(TEAM_MIN_SEATS, completionSeats)
              : SOLO_SEATS,
          partnerOfferToken: isExclusivePartnerOnboarding ? partnerOfferToken : undefined,
          salespersonInviteToken: isSalespersonOnboarding ? salespersonInviteToken : undefined,
          clientSource: searchParams.get('source') ?? undefined,
          teamMemberEmails: isExclusivePartnerTeamLayout ? normalizedInviteEmails : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        if (typeof data?.redirect === 'string') {
          setPostOnboardingRedirect(data.redirect);
        }
        return data as OnboardingCompletionResponse;
      }
      setError(data?.error ?? 'Something went wrong. Please try again.');
      return null;
    } catch {
      setError('Network error. Please try again.');
      return null;
    } finally {
      setLoading(false);
    }
  };

  const redirectAfterOnboarding = (redirect?: string | null) => {
    const destination = redirect || postOnboardingRedirect;
    if (!destination) return;
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(EXCLUSIVE_ONBOARDING_AUTH_DRAFT_KEY);
      window.location.href = destination;
    }
  };

  const handleSubmit = async (options?: {
    checkoutSeats?: number;
    checkoutUseCase?: 'solo' | 'team';
  }) => {
    const data = await completeOnboarding(options);
    if (data?.redirect) {
      redirectAfterOnboarding(data.redirect);
    }
  };

  const handleSelectPlan = async (checkoutSeats: number) => {
    const checkoutUseCase = checkoutSeats > SOLO_SEATS ? 'team' : 'solo';
    const completion = await completeOnboarding({ checkoutSeats, checkoutUseCase });
    if (!completion?.redirect) return;

    setCheckoutLoading(true);
    setCheckoutError(null);
    try {
      const checkoutRes = await fetch('/api/billing/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          plan: billingPlan,
          currency: billingCurrency,
          seats: checkoutSeats,
        }),
      });
      const data = await checkoutRes.json().catch(() => ({}));
      if (checkoutRes.ok && data?.url) {
        if (typeof window !== 'undefined') {
          window.localStorage.removeItem(EXCLUSIVE_ONBOARDING_AUTH_DRAFT_KEY);
          window.location.href = data.url;
        }
        return;
      }
      setCheckoutError(
        typeof data?.error === 'string'
          ? `${data.error} Your onboarding is saved, so you can skip into FLYR.`
          : 'Checkout could not start. Your onboarding is saved, so you can skip into FLYR.'
      );
    } catch {
      setCheckoutError('Network error starting checkout. Your onboarding is saved, so you can skip into FLYR.');
    } finally {
      setCheckoutLoading(false);
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
    if (!requiresOnboardingAuth) return true;
    const normalizedEmail = normalizedWorkEmail;
    if (!normalizedEmail || accountPassword.trim().length < 6) {
      if (hasAuthenticatedOnboardingSession) {
        return true;
      }
      setAuthError('Enter a valid work email and a password (6+ characters), or continue with Google or Apple.');
      return false;
    }

    setAuthError(null);
    setAuthLoading(true);
    setAuthMode('credentials');
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
        setAuthError(formatAuthError(signInResult.error, 'Failed to sign in with this email.'));
        return false;
      }

      const nextQs = new URLSearchParams();
      if (isDialerOnboarding) {
        nextQs.set('source', 'dialer');
        nextQs.set('campaign', 'power-dialer');
      } else if (isSalespersonOnboarding && salespersonInviteToken) {
        nextQs.set('salespersonInvite', salespersonInviteToken);
      } else {
        nextQs.set('offer', 'exclusive30');
        nextQs.set('partnerOfferToken', partnerOfferToken ?? '');
        if (partnerExclusiveParam === 'team' || partnerExclusiveParam === 'solo') {
          nextQs.set('partnerExclusive', partnerExclusiveParam);
        } else if (legacyPartnerExclusiveLayout === 'team' || legacyPartnerExclusiveLayout === 'solo') {
          nextQs.set('partnerExclusive', legacyPartnerExclusiveLayout);
        }
        if (challenge30FromUrl) {
          nextQs.set('challenge30', '1');
        }
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
            country_code: countryCode || undefined,
          },
        },
      });

      if (signUpResult.error) {
        setAuthError(formatAuthError(signUpResult.error, 'Failed to create account.'));
        return false;
      }

      if (signUpResult.data?.session) {
        return true;
      }

      setAuthError(
        'Check your inbox to confirm your email, then return to finish onboarding.'
      );
      return false;
    } catch (error) {
      setAuthError(formatAuthError(error, 'Could not verify account. Please try again.'));
      return false;
    } finally {
      setAuthLoading(false);
      setAuthMode(null);
    }
  }, [
    accountPassword,
    firstName,
    hasAuthenticatedOnboardingSession,
    requiresOnboardingAuth,
    isDialerOnboarding,
    isSalespersonOnboarding,
    lastName,
    countryCode,
    challenge30FromUrl,
    legacyPartnerExclusiveLayout,
    onboardingEntryPath,
    partnerExclusiveParam,
    partnerOfferToken,
    salespersonInviteToken,
    normalizedWorkEmail,
  ]);

  const handleExclusiveOAuthSignIn = useCallback(
    async (provider: 'google' | 'apple') => {
      const normalizedFirstName = firstName.trim();
      const normalizedLastName = lastName.trim();

      if (!normalizedFirstName || !normalizedLastName) {
        setAuthError('Enter your first and last name before continuing with Google or Apple.');
        return;
      }

      setAuthError(null);
      setAuthLoading(true);
      setAuthMode(provider);
      try {
        persistExclusiveAuthDraft();
        const supabase = await getClientAsync();
        const { data, error } = await supabase.auth.signInWithOAuth({
          provider,
          options: {
            redirectTo: buildExclusiveAuthCallbackURL(),
          },
        });
        if (error) throw error;
        if (data?.url) {
          window.location.href = data.url;
          return;
        }
        throw new Error(`Failed to start ${provider === 'google' ? 'Google' : 'Apple'} sign-in.`);
      } catch (error) {
        setAuthError(
          formatAuthError(
            error,
            provider === 'google'
              ? 'Failed to start Google sign-in.'
              : 'Failed to start Sign in with Apple.'
          )
        );
        setAuthLoading(false);
        setAuthMode(null);
      }
    },
    [buildExclusiveAuthCallbackURL, firstName, lastName, persistExclusiveAuthDraft]
  );

  const labelClass = 'text-sm font-semibold text-[#1f2024]';
  const inputClass =
    'h-14 rounded-xl border-[#d9dce2] bg-white text-base font-semibold text-[#17181c] placeholder:text-[#8a8f99] shadow-none focus-visible:border-[#17181c] focus-visible:ring-2 focus-visible:ring-black/10 dark:bg-white dark:text-[#17181c] dark:placeholder:text-[#8a8f99]';
  const outlineButtonClass =
    'h-12 rounded-xl border-[#d9dce2] bg-white text-[#202124] hover:bg-[#f5f6f8] hover:text-[#202124] dark:border-[#d9dce2] dark:bg-white dark:text-[#202124] dark:hover:bg-[#f5f6f8] dark:hover:text-[#202124]';
  const onboardingNavButtonClass =
    'h-auto min-h-11 min-w-20 rounded-none bg-transparent px-2 text-xl font-bold text-[#17181c] shadow-none hover:bg-transparent hover:text-[#17181c] focus-visible:ring-black/10 dark:bg-transparent dark:text-[#17181c] dark:hover:bg-transparent dark:hover:text-[#17181c]';
  const activeDotClass = 'h-2.5 w-7 rounded-full bg-[#17181c]';
  const inactiveDotClass = 'h-2.5 w-2.5 rounded-full bg-[#c7c9ce]';

  const heading =
    step === 1
      ? 'Help us personalize your experience'
      : step === 2
        ? 'How will you use FLYR?'
        : step === 3
          ? 'Set up your workspace'
          : step === 4
            ? 'Ambassador referral code'
            : step === 5
              ? 'FLYR is built for the field'
              : 'Do more with FLYR';

  const subheading =
    step === 1
      ? null
      : step === 2
        ? isExclusivePartnerTeamLayout
          ? 'Team mode is pre-selected for this exclusive offer.'
          : 'Choose solo or team so we can tailor your workspace.'
        : step === 3
          ? 'Name your business and tell us your industry.'
          : step === 4
            ? 'Enter an ambassador code to unlock your offer, or skip this step.'
            : step === 5
              ? 'Plan campaigns, track doors, and keep your leads organized.'
              : 'Select a plan based on your needs';

  if (handoffRedeemState === 'loading') {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6">
        <p className="text-[#6f7480]">Signing you in...</p>
      </div>
    );
  }

  if (handoffRedeemState === 'error') {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6">
        <div className="max-w-md rounded-xl border border-red-200 bg-red-50 p-5 text-center">
          <h1 className="text-lg font-semibold text-[#17181c]">Onboarding link expired</h1>
          <p className="mt-2 text-sm text-[#6f7480]">
            {handoffRedeemError || 'Open onboarding again from Android.'}
          </p>
        </div>
      </div>
    );
  }

  if (!isExclusivePartnerLayoutReady) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6">
        <p className="text-[#6f7480]">Loading your offer...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-[#17181c] flex flex-col items-center justify-center overflow-x-hidden px-5 py-10">
      <main
        className={`w-full min-w-0 ${
          step === FINAL_ONBOARDING_STEP ? 'max-w-[1280px]' : step === 5 ? 'max-w-5xl' : 'max-w-[720px]'
        }`}
      >
        <div className={step === FINAL_ONBOARDING_STEP ? 'mb-10 text-center' : 'mb-8 text-center'}>
          <div className="space-y-3">
            <h1 className={step === FINAL_ONBOARDING_STEP ? 'text-4xl font-bold leading-tight tracking-normal sm:text-5xl' : 'text-3xl font-bold leading-tight tracking-normal sm:text-4xl'}>
              {heading}
            </h1>
            {subheading ? (
              <p className="text-lg font-semibold text-[#7b7f89]">{subheading}</p>
            ) : null}
          </div>
        </div>

        {(isExclusivePartnerOnboarding || isSalespersonOnboarding) && step === 1 ? (
          <div className="mb-6 rounded-xl border border-[#d9dce2] bg-[#fafafa] p-4 text-center">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#6f7480]">
              {isSalespersonOnboarding
                ? 'Salesperson onboarding'
                : isExclusivePartnerTeamLayout
                  ? 'Exclusive Team Onboarding'
                  : 'Exclusive offer'}
            </p>
            <p className="mt-1 text-lg font-bold text-[#17181c]">
              {isSalespersonOnboarding ? 'Set up your FLYR sales workspace' : '30-day exclusive offer unlocked'}
            </p>
            <p className="mt-1 text-sm text-[#6f7480]">
              {isSalespersonOnboarding
                ? 'Create your account with the invited email. Your workspace will be nested under FLYR / Salespeople.'
                : hideExclusiveStep1Demo
                  ? 'Finish onboarding to activate your 30-day trial.'
                  : 'Finish onboarding to activate your 30-day trial and watch the demo if you have not already.'}
            </p>
            {!isSalespersonOnboarding && !hideExclusiveStep1Demo ? (
              <div className="mt-4 overflow-hidden rounded-lg border border-[#d9dce2] bg-white">
                <ExclusiveOfferArcadeEmbed demo={onboardingDemo} />
              </div>
            ) : null}
          </div>
        ) : null}

        <section className={step === FINAL_ONBOARDING_STEP ? '' : 'mx-auto max-w-[720px]'}>
          {step === 1 && (
            <form
              className="space-y-5"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!canStep1) return;
                const authReady = await ensureExclusiveAuth();
                if (!authReady) return;
                if (isSalespersonOnboarding) {
                  await handleSubmit();
                  return;
                }
                setStep((s) => s + 1);
              }}
            >
              <div className="grid gap-5 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="firstName" className={labelClass}>First name</Label>
                  <Input
                    id="firstName"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="First name"
                    autoFocus
                    className={inputClass}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName" className={labelClass}>Last name</Label>
                  <Input
                    id="lastName"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Last name"
                    className={inputClass}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && canStep1) {
                        e.preventDefault();
                        void (async () => {
                          const authReady = await ensureExclusiveAuth();
                          if (!authReady) return;
                          if (isSalespersonOnboarding) {
                            await handleSubmit();
                            return;
                          }
                          setStep((s) => s + 1);
                        })();
                      }
                    }}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="countryCode" className={labelClass}>Country</Label>
                <div className="relative">
                  <button
                    id="countryCode"
                    type="button"
                    onClick={() => setCountrySearchOpen((open) => !open)}
                    className="flex h-14 w-full items-center justify-between rounded-xl border border-[#d9dce2] bg-white px-4 text-left text-base font-semibold text-[#17181c] outline-none transition focus:border-[#17181c] focus:ring-2 focus:ring-black/10"
                    aria-haspopup="listbox"
                    aria-expanded={countrySearchOpen}
                  >
                    <span>{selectedCountry?.label ?? 'Select your country'}</span>
                    <ChevronDown className="h-5 w-5 text-[#7b7f89]" />
                  </button>
                  {countrySearchOpen ? (
                    <div className="absolute z-50 mt-2 w-full overflow-hidden rounded-xl border border-[#d9dce2] bg-white shadow-xl">
                      <Input
                        value={countrySearchQuery}
                        onChange={(event) => setCountrySearchQuery(event.target.value)}
                        placeholder="Search countries..."
                        className="h-12 rounded-none border-0 border-b border-[#e3e5e8] bg-white text-[#17181c] placeholder:text-[#8a8f99] focus-visible:ring-0"
                      />
                      <div className="max-h-64 overflow-y-auto" role="listbox" aria-label="Countries">
                        {filteredCountries.length > 0 ? (
                          filteredCountries.map((country) => (
                            <button
                              key={country.code}
                              type="button"
                              role="option"
                              aria-selected={country.code === countryCode}
                              onClick={() => {
                                setCountryCode(country.code);
                                setCountrySearchOpen(false);
                                setCountrySearchQuery('');
                              }}
                              className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold text-[#17181c] hover:bg-[#f5f6f8]"
                            >
                              <span>{country.label}</span>
                              {country.code === countryCode ? <Check className="h-4 w-4" /> : null}
                            </button>
                          ))
                        ) : (
                          <p className="px-4 py-3 text-sm text-[#6f7480]">No countries found.</p>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
              {requiresStepOneAuth ? (
                <div className="space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="workEmail" className={labelClass}>Work email</Label>
                    <Input
                      id="workEmail"
                      type="email"
                      value={workEmail}
                      onChange={(e) => setWorkEmail(e.target.value.trim().toLowerCase())}
                      placeholder="you@company.com"
                      className={inputClass}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="accountPassword" className={labelClass}>Password</Label>
                    <Input
                      id="accountPassword"
                      type="password"
                      value={accountPassword}
                      onChange={(e) => setAccountPassword(e.target.value)}
                      placeholder="At least 6 characters"
                      className={inputClass}
                    />
                  </div>
                  <p className={`text-xs ${hasAuthenticatedOnboardingSession ? 'text-emerald-700' : 'text-[#6f7480]'}`}>
                    {hasAuthenticatedOnboardingSession
                      ? `Signed in as ${authenticatedEmail}.`
                      : 'We will sign in or create this account before continuing.'}
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Button type="button" variant="outline" className={outlineButtonClass} onClick={() => void handleExclusiveOAuthSignIn('google')} disabled={authLoading}>
                      {authLoading && authMode === 'google' ? 'Continuing with Google...' : 'Continue with Google'}
                    </Button>
                    <Button type="button" variant="outline" className={outlineButtonClass} onClick={() => void handleExclusiveOAuthSignIn('apple')} disabled={authLoading}>
                      {authLoading && authMode === 'apple' ? 'Continuing with Apple...' : 'Continue with Apple'}
                    </Button>
                  </div>
                </div>
              ) : null}
            </form>
          )}

          {step === 2 && (
            isExclusivePartnerTeamLayout ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-[#d9dce2] bg-[#fafafa] p-4 text-center">
                  <p className="text-sm font-bold text-[#17181c]">Team onboarding is pre-selected for this exclusive offer.</p>
                  <p className="mt-1 text-xs text-[#6f7480]">Add teammate emails now and invites will be sent after onboarding completes.</p>
                </div>
                <div className="space-y-3">
                  <Label className={labelClass}>Team member emails (optional)</Label>
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
                        className={inputClass}
                      />
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" onClick={() => setTeamInviteEmails((prev) => [...prev, ''])} className={outlineButtonClass}>
                      Add another email
                    </Button>
                    {teamInviteEmails.length > 1 ? (
                      <Button type="button" variant="outline" onClick={() => setTeamInviteEmails((prev) => prev.slice(0, -1))} className={outlineButtonClass}>
                        Remove last
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {[
                  { value: 'solo' as const, icon: User, title: 'For myself', description: 'Solo use' },
                  { value: 'team' as const, icon: Users, title: 'For my team', description: 'Add teammates later' },
                ].map(({ value, icon: Icon, title, description }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      setUseCase(value);
                      setSeats(value === 'team' ? (prev) => Math.max(prev, TEAM_MIN_SEATS) : SOLO_SEATS);
                    }}
                    className={`flex min-h-32 items-center gap-5 rounded-xl border p-6 text-left transition ${
                      useCase === value
                        ? 'border-[#17181c] bg-[#fafafa] shadow-[0_12px_30px_rgba(0,0,0,0.08)]'
                        : 'border-[#d9dce2] bg-white hover:border-[#aeb3bd]'
                    }`}
                  >
                    <Icon className="h-7 w-7 shrink-0 text-[#17181c]" />
                    <span>
                      <span className="block text-lg font-bold text-[#17181c]">{title}</span>
                      <span className="mt-1 block text-sm font-semibold text-[#6f7480]">{description}</span>
                    </span>
                  </button>
                ))}
              </div>
            )
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="workspaceName" className={labelClass}>Business or team name</Label>
                <Input id="workspaceName" value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)} placeholder="XYZ Group" autoFocus className={inputClass} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="industry" className={labelClass}>Industry</Label>
                <Select
                  value={industry}
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
                  <SelectTrigger id="industry" className="h-14 w-full rounded-xl border-[#d9dce2] bg-white text-base font-semibold text-[#17181c] data-[placeholder]:text-[#8a8f99] dark:bg-white dark:text-[#17181c] dark:data-[placeholder]:text-[#8a8f99]">
                    <SelectValue placeholder="Select industry" />
                  </SelectTrigger>
                  <SelectContent className="max-h-[220px] overflow-y-auto rounded-xl border-[#d9dce2] bg-white text-[#17181c] dark:bg-white dark:text-[#17181c]">
                    {INDUSTRIES_TOP.map((ind) => (
                      <SelectItem key={ind} value={ind} className="text-base font-semibold text-[#17181c] focus:bg-[#f5f6f8] focus:text-[#17181c] dark:text-[#17181c] dark:focus:bg-[#f5f6f8] dark:focus:text-[#17181c]">{ind}</SelectItem>
                    ))}
                    <SelectSeparator className="mx-3 my-1.5 h-px rounded-full bg-[#e3e5e8]" />
                    {INDUSTRIES_REST.map((ind) => (
                      <SelectItem key={ind} value={ind} className="text-base font-semibold text-[#17181c] focus:bg-[#f5f6f8] focus:text-[#17181c] dark:text-[#17181c] dark:focus:bg-[#f5f6f8] dark:focus:text-[#17181c]">{ind}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {industry === 'Real Estate' && (
                <div className="relative space-y-2" ref={brokerageListRef}>
                  <Label htmlFor="brokerage" className={labelClass}>Brokerage</Label>
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
                    className={inputClass}
                    autoComplete="off"
                  />
                  {brokerageSuggestionsOpen && brokerage.trim() && (
                    <div className="absolute z-50 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-[#d9dce2] bg-white py-1 shadow-lg" role="listbox">
                      {brokerageSuggestions.map((b) => (
                        <button
                          key={b.id}
                          type="button"
                          role="option"
                          aria-selected={false}
                          className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-semibold text-[#17181c] hover:bg-[#f5f6f8] focus:bg-[#f5f6f8] focus:outline-none"
                          onClick={() => {
                            setBrokerage(b.name);
                            setBrokerageId(b.id);
                            setBrokerageSuggestionsOpen(false);
                            setBrokerageSuggestions([]);
                          }}
                        >
                          <Building2 className="h-4 w-4 shrink-0 text-[#6f7480]" aria-hidden />
                          <span>{b.name}</span>
                          <span className="ml-auto text-xs text-[#6f7480]">Existing</span>
                        </button>
                      ))}
                      {brokerage.trim() &&
                        !brokerageSuggestions.some((b) => b.name.toLowerCase() === brokerage.trim().toLowerCase()) && (
                          <button
                            type="button"
                            role="option"
                            aria-selected={false}
                            className="mt-1 flex w-full items-center gap-3 border-t border-[#e3e5e8] px-4 py-3 pt-3 text-left text-sm font-semibold text-[#17181c] hover:bg-[#f5f6f8] focus:bg-[#f5f6f8] focus:outline-none"
                            onClick={() => {
                              const value = brokerage.trim().replace(/\s+/g, ' ');
                              setBrokerage(value);
                              setBrokerageId(null);
                              setBrokerageSuggestionsOpen(false);
                              setBrokerageSuggestions([]);
                            }}
                          >
                            <Plus className="h-4 w-4 shrink-0 text-[#17181c]" aria-hidden />
                            <span>Add &quot;{brokerage.trim()}&quot; as new brokerage</span>
                          </button>
                        )}
                    </div>
                  )}
                </div>
              )}
              {useCase === 'team' && (
                <div className="space-y-2">
                  <Label htmlFor="teamSeats" className={labelClass}>Members</Label>
                  <Input
                    id="teamSeats"
                    type="number"
                    min={TEAM_MIN_SEATS}
                    max={MAX_SEATS}
                    inputMode="numeric"
                    value={seats}
                    onChange={(event) => {
                      const requestedSeats = Number.parseInt(event.target.value, 10);
                      if (!Number.isFinite(requestedSeats)) {
                        setSeats(TEAM_MIN_SEATS);
                        return;
                      }
                      setSeats(Math.min(MAX_SEATS, Math.max(TEAM_MIN_SEATS, requestedSeats)));
                    }}
                    onFocus={(event) => event.currentTarget.select()}
                    className={`${inputClass} tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
                  />
                </div>
              )}
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="referralCode" className={labelClass}>Referral code (optional)</Label>
                <Input
                  id="referralCode"
                  value={referralCode}
                  onChange={(e) => setReferralCode(e.target.value)}
                  placeholder="e.g. LAUNCH2026"
                  className={`${inputClass} uppercase placeholder:normal-case`}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void (async () => {
                        if (await validateReferralStep()) setStep(5);
                      })();
                    }
                  }}
                  autoComplete="off"
                />
              </div>
              {referralValidation ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
                  {referralValidation.trialDays}-day trial unlocked
                  {referralValidation.partnerName || referralValidation.ambassadorName || referralValidation.salespersonName
                    ? ` with ${referralValidation.partnerName || referralValidation.ambassadorName || referralValidation.salespersonName}`
                    : ''}
                  .
                </div>
              ) : (
                <p className="text-sm leading-6 text-[#6f7480]">No code? No problem. You can continue without one.</p>
              )}
              {referralValidationError ? <p className="text-sm font-semibold text-red-600">{referralValidationError}</p> : null}
            </div>
          )}

          {step === 5 && (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
              {[
                { title: 'Create your campaign', src: '/onboarding-create-campaign.png' },
                { title: 'Own your data', src: '/onboarding-own-data.png' },
                { title: 'Track your results', src: '/onboarding-track-results.png' },
              ].map((card) => (
                <div key={card.title} className="flex flex-col items-center">
                  <div className="w-full overflow-hidden rounded-xl border border-[#d9dce2] bg-[#f5f6f8] shadow-sm">
                    <div className="relative aspect-[4/3] w-full overflow-hidden bg-[#f5f6f8]">
                      <Image
                        src={card.src}
                        alt=""
                        fill
                        sizes="(min-width: 640px) 33vw, 100vw"
                        className="object-cover"
                      />
                    </div>
                  </div>
                  <p className="mt-3 text-center text-xl font-bold text-[#17181c]">{card.title}</p>
                </div>
              ))}
            </div>
          )}

          {step === FINAL_ONBOARDING_STEP && (
            <div className="space-y-8">
              <div className="mx-auto grid max-w-xl gap-6">
                {pricingCards.map((card) => {
                  return (
                    <div
                      key={card.id}
                      className="flex min-h-[520px] flex-col rounded-[26px] border border-[#d9dce2] bg-white p-8 shadow-[0_18px_45px_rgba(0,0,0,0.08)]"
                    >
                      <h2 className="text-3xl font-bold text-[#17181c]">{card.title}</h2>
                      <div className="mt-7">
                        <span className="text-5xl font-bold text-[#050505]">
                          {formatPlanPrice(seatPricing.seatMonthlyDisplay, billingCurrency)}
                        </span>
                        <span className="text-2xl font-medium text-[#17181c]">/seat/month</span>
                      </div>
                      <p className="mt-2 text-sm font-semibold text-[#7b7f89]">
                        {card.seatCount} seat{card.seatCount === 1 ? '' : 's'} selected. Billed monthly.
                      </p>
                      <p className="mt-6 text-lg font-semibold leading-7 text-[#7b7f89]">
                        {card.description}
                      </p>
                      <ul className="mt-7 space-y-4">
                        {card.features.map((feature) => (
                          <li key={feature} className="flex items-center gap-3 text-base font-semibold text-[#17181c]">
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#17181c] text-white">
                              <Check className="h-4 w-4" />
                            </span>
                            {feature}
                          </li>
                          ))}
                      </ul>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={loading || checkoutLoading || authLoading}
                        onClick={async () => {
                          if (isDialerOnboarding) {
                            const authReady = await ensureExclusiveAuth();
                            if (!authReady) return;
                          }
                          await handleSelectPlan(card.seatCount);
                        }}
                        className="mt-8 h-12 w-full rounded-xl border-[#d9dce2] bg-[#09090b] text-base font-bold text-white hover:bg-[#27272a] hover:text-white dark:border-[#09090b] dark:bg-[#09090b] dark:text-white dark:hover:bg-[#27272a] dark:hover:text-white"
                      >
                        {checkoutLoading ? 'Redirecting...' : 'Select plan'}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {error ? <p className="mt-5 text-center text-sm font-semibold text-red-600">{error}</p> : null}
          {authError ? <p className="mt-5 text-center text-sm font-semibold text-red-600">{authError}</p> : null}
          {checkoutError ? <p className="mt-5 text-center text-sm font-semibold text-red-600">{checkoutError}</p> : null}

          <div className="mt-10 flex items-center justify-center gap-14 sm:gap-24">
            {step > 1 ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setStep((s) => (!shouldShowReferralStep && s === 5 ? 3 : s - 1))}
                className={onboardingNavButtonClass}
                disabled={loading || checkoutLoading || authLoading}
              >
                Back
              </Button>
            ) : null}
            {step < FINAL_ONBOARDING_STEP ? (
              <Button
                type="button"
                variant="ghost"
                onClick={async () => {
                  if (step === 1 && requiresStepOneAuth) {
                    if (!canStep1) return;
                    const authReady = await ensureExclusiveAuth();
                    if (!authReady) return;
                    if (isSalespersonOnboarding) {
                      await handleSubmit();
                      return;
                    }
                  }
                  if (step === 4) {
                    const referralReady = await validateReferralStep();
                    if (!referralReady) return;
                  }
                  setStep((s) => (!shouldShowReferralStep && s === 3 ? 5 : s + 1));
                }}
                disabled={loading || authLoading || referralValidationLoading || (step === 1 && !canStep1) || (step === 3 && !canStep3)}
                className={onboardingNavButtonClass}
              >
                {loading && isSalespersonOnboarding
                  ? 'Setting up salesperson workspace...'
                  : authLoading && step === 1
                    ? authMode === 'google'
                      ? 'Continuing with Google...'
                      : authMode === 'apple'
                        ? 'Continuing with Apple...'
                        : 'Verifying account...'
                    : referralValidationLoading && step === 4
                      ? 'Checking code...'
                      : 'Next'}
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                onClick={async () => {
                  if (isDialerOnboarding) {
                    const authReady = await ensureExclusiveAuth();
                    if (!authReady) return;
                  }
                  await handleSubmit();
                }}
                disabled={loading || checkoutLoading || authLoading}
                className={onboardingNavButtonClass}
              >
                {loading ? 'Saving...' : 'Skip'}
              </Button>
            )}
          </div>
        </section>
      </main>

      <div className="fixed bottom-7 left-0 right-0 z-20 flex justify-center gap-2 pointer-events-none px-4">
        {Array.from({ length: FINAL_ONBOARDING_STEP }, (_, index) => (
          <span key={index} className={index + 1 === step ? activeDotClass : inactiveDotClass} />
        ))}
      </div>

      <button
        type="button"
        onClick={() => void handleLogout()}
        disabled={signingOut}
        title="Log out"
        aria-label="Log out"
        className="fixed right-5 top-5 inline-flex h-10 w-10 items-center justify-center rounded-full border border-[#d9dce2] bg-white text-[#6f7480] shadow-sm transition-colors hover:bg-[#f5f6f8] hover:text-[#17181c] disabled:opacity-50"
      >
        <LogoutDoorEmblem className="h-5 w-5" />
      </button>
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-white flex items-center justify-center">
          <p className="text-[#6f7480]">Loading...</p>
        </div>
      }
    >
      <OnboardingContent />
    </Suspense>
  );
}
