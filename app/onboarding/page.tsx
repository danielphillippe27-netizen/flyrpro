'use client';

import { Suspense, useState, useCallback, useEffect, useMemo, useRef } from 'react';
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
import { Check, ChevronDown, User, Users, Building2, Plus, Minus } from 'lucide-react';
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
const MAX_SEATS = 100;
const FINAL_ONBOARDING_STEP = 6;
const EXCLUSIVE_ONBOARDING_AUTH_DRAFT_KEY = 'flyr.exclusiveOnboardingAuthDraft';

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
  const requiresStepOneAuth = isExclusivePartnerOnboarding || isSalespersonOnboarding;
  const requiresOnboardingAuth = requiresStepOneAuth || isDialerOnboarding;

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
  const [error, setError] = useState<string | null>(null);

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
          countryCode,
          workspaceName: workspaceName.trim(),
          industry: industry.trim(),
          referralCode: shouldShowReferralStep ? referralCode.trim() || null : null,
          referralSource,
          referralCampaign,
          brokerage: brokerage.trim() || undefined,
          brokerageId: brokerageId ?? undefined,
          useCase: isExclusivePartnerTeamLayout ? 'team' : useCase,
          maxSeats: isExclusivePartnerTeamLayout
            ? Math.max(TEAM_MIN_SEATS, normalizedInviteEmails.length + 1, seats)
            : useCase === 'team'
              ? Math.max(TEAM_MIN_SEATS, seats)
              : SOLO_SEATS,
          partnerOfferToken: isExclusivePartnerOnboarding ? partnerOfferToken : undefined,
          salespersonInviteToken: isSalespersonOnboarding ? salespersonInviteToken : undefined,
          clientSource: searchParams.get('source') ?? undefined,
          teamMemberEmails: isExclusivePartnerTeamLayout ? normalizedInviteEmails : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.redirect) {
        if (typeof window !== 'undefined') {
          window.localStorage.removeItem(EXCLUSIVE_ONBOARDING_AUTH_DRAFT_KEY);
        }
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

  if (handoffRedeemState === 'loading') {
    return (
      <div className="dark min-h-screen bg-gradient-to-br from-black to-[#262626] flex flex-col items-center justify-center p-6">
        <p className="text-zinc-400">Signing you in...</p>
      </div>
    );
  }

  if (handoffRedeemState === 'error') {
    return (
      <div className="dark min-h-screen bg-gradient-to-br from-black to-[#262626] flex flex-col items-center justify-center p-6">
        <div className="max-w-md rounded-xl border border-red-500/40 bg-red-500/10 p-5 text-center">
          <h1 className="text-lg font-semibold text-white">Onboarding link expired</h1>
          <p className="mt-2 text-sm text-zinc-300">
            {handoffRedeemError || 'Open onboarding again from Android.'}
          </p>
        </div>
      </div>
    );
  }

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
        className={`relative w-full min-w-0 space-y-8 rounded-2xl border border-white/15 bg-white/[0.06] p-6 sm:p-10 backdrop-blur-2xl shadow-[0_24px_70px_rgba(0,0,0,0.6),0_10px_30px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.2)] ${step >= 5 && !(isDialerOnboarding && step === 6) ? 'max-w-5xl' : 'max-w-lg'}`}
      >
        {!(isDialerOnboarding && step === 6) && (
          <div className="text-center space-y-2">
            <h1
              className={`max-w-full min-w-0 font-bold leading-tight text-white break-words [overflow-wrap:anywhere] ${
                step === 5
                  ? 'text-3xl sm:text-4xl md:text-5xl'
                  : step === 6
                    ? 'text-4xl'
                    : 'text-3xl'
              }`}
            >
              {step === 1 && 'What should we call you?'}
              {step === 2 && 'How will you use FLYR?'}
              {step === 3 && 'Set up your workspace'}
              {step === 4 && 'Ambassador referral code'}
              {step === 5 && (
                <>
                  FLYR is revolutionizing
                  <br />
                  Door 2 Door Marketing
                </>
              )}
              {step === 6 && (
                <>
                  You&apos;re one step away from tracking every door
                  <br />
                  and never losing a lead.
                </>
              )}
            </h1>
            {(step === 1 || step === 2 || step === 3 || step === 4) && (
              <p className="text-base text-[#AAAAAA]">
                {step === 1 && 'We use this to personalize your experience.'}
                {step === 2 &&
                  (isExclusivePartnerTeamLayout
                    ? 'We set this to team mode for your exclusive offer.'
                    : 'Choose solo or invite your team.')}
                {step === 3 && 'Name your business and tell us your industry.'}
                {step === 4 && 'Enter an ambassador code to unlock your 30-day trial, or skip this step.'}
              </p>
            )}
          </div>
        )}

        {(isExclusivePartnerOnboarding || isSalespersonOnboarding) && step === 1 ? (
          <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4">
            <p className="text-center text-xs font-semibold uppercase tracking-wider text-red-300">
              {isSalespersonOnboarding
                ? 'Salesperson onboarding'
                : isExclusivePartnerTeamLayout
                  ? 'Exclusive Team Onboarding'
                  : 'Exclusive offer'}
            </p>
            <p className="mt-1 text-center text-lg font-semibold text-white">
              {isSalespersonOnboarding ? 'Set up your FLYR sales workspace' : '30-day exclusive offer unlocked'}
            </p>
            <p className="mt-1 text-center text-sm text-zinc-300">
              {isSalespersonOnboarding
                ? 'Create your account with the invited email. Your workspace will be nested under FLYR / Salespeople.'
                : hideExclusiveStep1Demo
                ? 'Finish onboarding to activate your 30-day trial.'
                : 'Finish onboarding to activate your 30-day trial and watch the demo if you haven&apos;t already.'}
            </p>
            {!isSalespersonOnboarding && !hideExclusiveStep1Demo ? (
              <div className="mt-4 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900">
                <ExclusiveOfferArcadeEmbed demo={onboardingDemo} />
              </div>
            ) : null}
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
                    void (async () => {
                      const authReady = await ensureExclusiveAuth();
                      if (authReady) setStep((s) => s + 1);
                    })();
                  }
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="countryCode" className="text-base text-white">Country</Label>
              <div className="relative">
                <button
                  id="countryCode"
                  type="button"
                  onClick={() => setCountrySearchOpen((open) => !open)}
                  className="flex h-16 w-full items-center justify-between rounded-md border border-zinc-600 bg-[#2a2a2a] px-3 text-left text-2xl text-white outline-none focus:border-white focus:ring-2 focus:ring-white/40"
                  aria-haspopup="listbox"
                  aria-expanded={countrySearchOpen}
                >
                  <span>{selectedCountry?.label ?? 'Select your country'}</span>
                  <ChevronDown className="h-5 w-5 text-zinc-400" />
                </button>
                {countrySearchOpen ? (
                  <div className="absolute z-50 mt-2 w-full overflow-hidden rounded-md border border-zinc-600 bg-[#1f1f1f] shadow-xl">
                    <Input
                      value={countrySearchQuery}
                      onChange={(event) => setCountrySearchQuery(event.target.value)}
                      placeholder="Search countries..."
                      className="h-12 rounded-none border-0 border-b border-zinc-700 bg-[#2a2a2a] text-white placeholder:text-zinc-500 focus-visible:ring-0"
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
                            className="flex w-full items-center justify-between px-3 py-3 text-left text-base text-white hover:bg-white/10"
                          >
                            <span>{country.label}</span>
                            {country.code === countryCode ? <Check className="h-4 w-4" /> : null}
                          </button>
                        ))
                      ) : (
                        <p className="px-3 py-3 text-sm text-zinc-400">No countries found.</p>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
            {requiresStepOneAuth ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="workEmail" className="text-base text-white">Work email</Label>
                  <Input
                    id="workEmail"
                    type="email"
                    value={workEmail}
                    onChange={(e) => setWorkEmail(e.target.value.trim().toLowerCase())}
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
                {hasAuthenticatedOnboardingSession ? (
                  <p className="text-xs text-emerald-300">
                    Signed in as {authenticatedEmail}. Continue onboarding below, or choose another sign-in option.
                  </p>
                ) : (
                  <p className="text-xs text-zinc-400">
                    We will sign in or create this account before continuing so onboarding never runs on the wrong user.
                  </p>
                )}
                <div className="relative flex items-center gap-4 pt-1">
                  <span className="flex-1 border-t border-zinc-600" />
                  <span className="shrink-0 text-xs uppercase tracking-[0.2em] text-zinc-500">
                    Or continue with
                  </span>
                  <span className="flex-1 border-t border-zinc-600" />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-12 border-zinc-600 bg-transparent text-white hover:bg-zinc-800 hover:text-white"
                    onClick={() => void handleExclusiveOAuthSignIn('google')}
                    disabled={authLoading}
                  >
                    <svg className="mr-2 h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none">
                      <path
                        fill="currentColor"
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      />
                      <path
                        fill="currentColor"
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      />
                      <path
                        fill="currentColor"
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                      />
                      <path
                        fill="currentColor"
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                      />
                    </svg>
                    {authLoading && authMode === 'google'
                      ? 'Continuing with Google…'
                      : 'Continue with Google'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-12 border-zinc-600 bg-transparent text-white hover:bg-zinc-800 hover:text-white"
                    onClick={() => void handleExclusiveOAuthSignIn('apple')}
                    disabled={authLoading}
                  >
                    <svg className="mr-2 h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
                    </svg>
                    {authLoading && authMode === 'apple'
                      ? 'Continuing with Apple…'
                      : 'Continue with Apple'}
                  </Button>
                </div>
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
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="referralCode" className="text-base text-white">
                Ambassador code (optional)
              </Label>
              <Input
                id="referralCode"
                value={referralCode}
                onChange={(e) => setReferralCode(e.target.value)}
                placeholder="e.g. LAUNCH2026"
                className="h-16 text-2xl md:text-2xl uppercase text-white placeholder:normal-case placeholder:text-gray-500 bg-[#2a2a2a] border-zinc-600 focus-visible:border-white focus-visible:ring-2 focus-visible:ring-white/40"
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
              <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                30-day trial unlocked
                {referralValidation.ambassadorName
                  ? ` with ${referralValidation.ambassadorName}`
                  : ''}
                .
              </div>
            ) : (
              <p className="text-sm leading-6 text-zinc-400">
                No code? No problem. You can continue without one.
              </p>
            )}
            {referralValidationError ? (
              <p className="text-sm text-red-400">{referralValidationError}</p>
            ) : null}
          </div>
        )}

        {step === 5 && (
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

        {step === 6 && (
          <div className="space-y-6">
            {!isDialerOnboarding && (
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

            {isDialerOnboarding ? (
              <div className="rounded-xl border border-zinc-700 bg-black/30 p-4 space-y-4">
                <div className="text-center">
                  <p className="text-lg font-semibold text-white">Start your free trial</p>
                  <p className="mt-1 text-sm text-zinc-400">Create your account now. No credit card.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="workEmail" className="text-base text-white">Work email</Label>
                  <Input
                    id="workEmail"
                    type="email"
                    value={workEmail}
                    onChange={(e) => setWorkEmail(e.target.value.trim().toLowerCase())}
                    placeholder="you@company.com"
                    className="h-14 text-xl text-white placeholder:text-gray-500 bg-[#2a2a2a] border-zinc-600 focus-visible:border-white focus-visible:ring-2 focus-visible:ring-white/40"
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
                    className="h-14 text-xl text-white placeholder:text-gray-500 bg-[#2a2a2a] border-zinc-600 focus-visible:border-white focus-visible:ring-2 focus-visible:ring-white/40"
                  />
                </div>
                {hasAuthenticatedOnboardingSession ? (
                  <p className="text-xs text-center text-emerald-300">
                    Signed in as {authenticatedEmail}.
                  </p>
                ) : (
                  <p className="text-xs text-center text-zinc-400">
                    We will sign in or create this account before activating your trial.
                  </p>
                )}
                <div className="relative flex items-center gap-4 pt-1">
                  <span className="flex-1 border-t border-zinc-600" />
                  <span className="shrink-0 text-xs uppercase tracking-[0.2em] text-zinc-500">
                    Or continue with
                  </span>
                  <span className="flex-1 border-t border-zinc-600" />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-12 border-zinc-600 bg-transparent text-white hover:bg-zinc-800 hover:text-white"
                    onClick={() => void handleExclusiveOAuthSignIn('google')}
                    disabled={authLoading}
                  >
                    <svg className="mr-2 h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none">
                      <path
                        fill="currentColor"
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      />
                      <path
                        fill="currentColor"
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      />
                      <path
                        fill="currentColor"
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                      />
                      <path
                        fill="currentColor"
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                      />
                    </svg>
                    {authLoading && authMode === 'google'
                      ? 'Continuing with Google…'
                      : 'Continue with Google'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-12 border-zinc-600 bg-transparent text-white hover:bg-zinc-800 hover:text-white"
                    onClick={() => void handleExclusiveOAuthSignIn('apple')}
                    disabled={authLoading}
                  >
                    <svg className="mr-2 h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
                    </svg>
                    {authLoading && authMode === 'apple'
                      ? 'Continuing with Apple…'
                      : 'Continue with Apple'}
                  </Button>
                </div>
              </div>
            ) : null}
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
              onClick={() =>
                setStep((s) => (!shouldShowReferralStep && s === 5 ? 3 : s - 1))
              }
              className="w-full h-12 text-base border-zinc-600 text-white hover:bg-zinc-800 hover:text-white"
            >
              Back
            </Button>
          )}
          {step < FINAL_ONBOARDING_STEP ? (
            <Button
              type="button"
              onClick={async () => {
                if (step === 1 && requiresStepOneAuth) {
                  if (!canStep1) return;
                  const authReady = await ensureExclusiveAuth();
                  if (!authReady) return;
                }
                if (step === 4) {
                  const referralReady = await validateReferralStep();
                  if (!referralReady) return;
                }
                setStep((s) => (!shouldShowReferralStep && s === 3 ? 5 : s + 1));
              }}
              disabled={
                authLoading ||
                referralValidationLoading ||
                (step === 1 && !canStep1) ||
                (step === 3 && !canStep3)
              }
              className="w-full h-14 text-lg font-semibold bg-[#ef4444] text-white hover:bg-[#dc2626] border-0"
            >
              {authLoading && step === 1
                ? authMode === 'google'
                  ? 'Continuing with Google…'
                  : authMode === 'apple'
                  ? 'Continuing with Apple…'
                  : 'Verifying account…'
                : referralValidationLoading && step === 4
                  ? 'Checking code…'
                : 'Continue'}
            </Button>
          ) : (
            <Button
              type="button"
              onClick={async () => {
                if (isDialerOnboarding) {
                  const authReady = await ensureExclusiveAuth();
                  if (!authReady) return;
                }
                await handleSubmit();
              }}
              disabled={loading || authLoading}
              className="w-full h-14 text-lg font-semibold bg-[#ef4444] text-white hover:bg-[#dc2626] border-0"
            >
              {authLoading && isDialerOnboarding
                ? authMode === 'google'
                  ? 'Continuing with Google…'
                  : authMode === 'apple'
                    ? 'Continuing with Apple…'
                    : 'Verifying account…'
                : loading
                ? 'Saving…'
                : isSalespersonOnboarding
                  ? 'Enter salesperson workspace'
                : isExclusivePartnerOnboarding
                  ? 'Activate 30-day exclusive access'
                  : referralValidation
                    ? 'Continue for 30-day free trial'
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
