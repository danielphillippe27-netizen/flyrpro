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
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Check, ChevronDown, User, Users, Building2, Plus } from 'lucide-react';
import { ExclusiveOfferArcadeEmbed } from '@/components/landing/ExclusiveOfferArcadeEmbed';
import { getClientAsync } from '@/lib/supabase/client';
import { COUNTRY_OPTIONS } from '@/lib/countries';
import { resolvePublicAppOrigin } from '@/lib/auth/public-origin';
import { WolfGridLogo } from '@/components/brand/WolfGridLogo';

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
  ambassadorName?: string | null;
  partnerName?: string | null;
  salespersonName?: string | null;
  referralType?: 'ambassador' | 'salesperson';
};
type BillingCurrency = 'USD' | 'CAD';
type OnboardingCompletionResponse = {
  success?: boolean;
  redirect?: string;
  error?: string;
};
type HandoffRedeemResponse = {
  ok?: boolean;
  user?: {
    id?: string | null;
    email?: string | null;
  };
  error?: string;
};

const INDUSTRIES_TOP = ['Home service', 'Solar', 'Roofing & Exteriors', 'HVAC', 'Real Estate'];

const INDUSTRIES_REST = [
  'Insurance',
  'Landscaping',
  'Pest Control',
  'Political / Canvassing',
  'Pool Service',
  'Other',
];

const ONBOARDING_COUNTRY_CODES = ['CA', 'US', 'AU', 'NZ', 'ZA'] as const;
const ONBOARDING_COUNTRY_OPTIONS = ONBOARDING_COUNTRY_CODES.map((code) => {
  const country = COUNTRY_OPTIONS.find((option) => option.code === code);
  if (!country) throw new Error(`Missing onboarding country option: ${code}`);
  return country;
});

const SOLO_SEATS = 1;
const TEAM_MIN_SEATS = 2;
const MAX_SEATS = 200;
const FINAL_ONBOARDING_STEP = 5;
const EXCLUSIVE_ONBOARDING_AUTH_DRAFT_KEY = 'wolfgrid.exclusiveOnboardingAuthDraft';
const ONBOARDING_DRAFT_KEY = 'wolfgrid.onboardingDraft';
const SELF_SERVE_CAMPAIGN_DRAFT_KEY = 'wolfgrid.selfServeCampaignDraft';
const LEGACY_EXCLUSIVE_ONBOARDING_AUTH_DRAFT_KEY = 'flyr.exclusiveOnboardingAuthDraft';
const LEGACY_ONBOARDING_DRAFT_KEY = 'flyr.onboardingDraft';
const LEGACY_SELF_SERVE_CAMPAIGN_DRAFT_KEY = 'flyr.selfServeCampaignDraft';
const MOBILE_RETURN_URL_PARAMS = [
  'returnUrl',
  'return_url',
  'redirectTo',
  'redirect_to',
  'cancelUrl',
  'cancel_url',
  'skipUrl',
  'skip_url',
  'successUrl',
  'success_url',
  'checkoutSuccessUrl',
  'checkout_success_url',
  'checkoutCancelUrl',
  'checkout_cancel_url',
];

type OnboardingDraft = {
  firstName: string;
  lastName: string;
  countryCode: string;
  useCase: 'solo' | 'team';
  workspaceName: string;
  industry: string;
  brokerage: string;
  brokerageId: string | null;
  referralCode: string;
  referralSource: string | null;
  referralCampaign: string | null;
  seats: number;
  teamInviteEmails: string[];
  checkoutSeats: number;
  checkoutUseCase: 'solo' | 'team';
};

type SelfServeCampaignDraft = {
  name: string;
  polygon: GeoJSON.Polygon;
  bbox?: number[];
};

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
  originalSeatMonthlyDisplay: number;
} {
  return { seatMonthlyDisplay: 30, originalSeatMonthlyDisplay: 60 };
}

function normalizeReferralCodeInput(value: string): string {
  return value
    .toUpperCase()
    .replace(/&/g, 'AND')
    .replace(/[^A-Z0-9]+/g, '')
    .slice(0, 20);
}

function readOnboardingDraft(): OnboardingDraft | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw =
      window.localStorage.getItem(ONBOARDING_DRAFT_KEY) ||
      window.localStorage.getItem(LEGACY_ONBOARDING_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OnboardingDraft>;
    const firstName = typeof parsed.firstName === 'string' ? parsed.firstName : '';
    const lastName = typeof parsed.lastName === 'string' ? parsed.lastName : '';
    const countryCode = typeof parsed.countryCode === 'string' ? parsed.countryCode : '';
    const useCase = parsed.useCase === 'team' ? 'team' : 'solo';
    const checkoutUseCase = parsed.checkoutUseCase === 'team' ? 'team' : useCase;
    const seats =
      typeof parsed.seats === 'number' && Number.isFinite(parsed.seats)
        ? Math.min(MAX_SEATS, Math.max(SOLO_SEATS, Math.trunc(parsed.seats)))
        : useCase === 'team'
          ? TEAM_MIN_SEATS
          : SOLO_SEATS;
    const checkoutSeats =
      typeof parsed.checkoutSeats === 'number' && Number.isFinite(parsed.checkoutSeats)
        ? Math.min(MAX_SEATS, Math.max(SOLO_SEATS, Math.trunc(parsed.checkoutSeats)))
        : seats;

    return {
      firstName,
      lastName,
      countryCode,
      useCase,
      workspaceName: typeof parsed.workspaceName === 'string' ? parsed.workspaceName : '',
      industry: typeof parsed.industry === 'string' ? parsed.industry : '',
      brokerage: typeof parsed.brokerage === 'string' ? parsed.brokerage : '',
      brokerageId: typeof parsed.brokerageId === 'string' ? parsed.brokerageId : null,
      referralCode: typeof parsed.referralCode === 'string' ? parsed.referralCode : '',
      referralSource: typeof parsed.referralSource === 'string' ? parsed.referralSource : null,
      referralCampaign: typeof parsed.referralCampaign === 'string' ? parsed.referralCampaign : null,
      seats,
      teamInviteEmails: Array.isArray(parsed.teamInviteEmails)
        ? parsed.teamInviteEmails.filter((email): email is string => typeof email === 'string')
        : [''],
      checkoutSeats,
      checkoutUseCase,
    };
  } catch {
    return null;
  }
}

function readSelfServeCampaignDraft(): SelfServeCampaignDraft | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw =
      window.localStorage.getItem(SELF_SERVE_CAMPAIGN_DRAFT_KEY) ||
      window.localStorage.getItem(LEGACY_SELF_SERVE_CAMPAIGN_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SelfServeCampaignDraft>;
    if (!parsed.name || parsed.polygon?.type !== 'Polygon' || !Array.isArray(parsed.polygon.coordinates)) return null;
    return {
      name: parsed.name,
      polygon: parsed.polygon,
      bbox: Array.isArray(parsed.bbox) ? parsed.bbox : undefined,
    };
  } catch {
    return null;
  }
}

function mobileReturnUrlFromSearchParams(searchParams: URLSearchParams): string | null {
  for (const param of MOBILE_RETURN_URL_PARAMS) {
    const value = searchParams.get(param)?.trim();
    if (!value) continue;
    if (value.startsWith('wolfgrid://') || value.startsWith('flyr://')) return value;
  }
  return null;
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
  const mobileReturnUrl = mobileReturnUrlFromSearchParams(searchParams);
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
  const isSelfServeDemoOnboarding =
    searchParams.get('source') === 'self-serve-demo' ||
    searchParams.get('campaign') === 'self-serve-campaign';
  const onboardingFinalStep = FINAL_ONBOARDING_STEP;
  const requiresOnboardingAuth =
    isExclusivePartnerOnboarding ||
    isSalespersonOnboarding ||
    isDialerOnboarding ||
    isSelfServeDemoOnboarding;
  const requiresStepOneAuth = isSelfServeDemoOnboarding;
  const isResumeCompletion = searchParams.get('resume') === 'complete';

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
    !isSelfServeDemoOnboarding &&
    !isSalespersonOnboarding &&
    !(isExclusivePartnerOnboarding && isExclusivePartnerTeamLayout);

  const onboardingDemo =
    isIgOnboardingPath || (isExclusivePartnerOnboarding && resolvedPartnerExclusiveLayout === 'solo')
      ? 'ig-dm'
      : 'team';
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
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
  const [authSessionChecked, setAuthSessionChecked] = useState(false);
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
  const [pendingResumeDraft, setPendingResumeDraft] = useState<OnboardingDraft | null>(null);
  const resumeCompletionStarted = useRef(false);
  const handoffAuthenticatedRef = useRef(false);
  const onboardingAccessTokenRef = useRef<string | null>(null);

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
        const payload = (await response.json().catch(() => ({}))) as HandoffRedeemResponse;
        if (!response.ok) {
          setHandoffRedeemState('error');
          setHandoffRedeemError(
            typeof payload?.error === 'string'
              ? payload.error
              : 'This onboarding link is invalid or expired.'
          );
          return;
        }

        const email =
          typeof payload?.user?.email === 'string' && payload.user.email.trim()
            ? payload.user.email.trim().toLowerCase()
            : null;
        setAuthenticatedEmail(email);
        if (email) {
          handoffAuthenticatedRef.current = true;
          setWorkEmail((current) => current.trim() || email);
        }
        setAuthSessionChecked(true);
        setHandoffRedeemState('idle');
        setHandoffRedeemError('');

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
    if (typeof window !== 'undefined') {
      try {
        const storedDraft =
          window.localStorage.getItem(EXCLUSIVE_ONBOARDING_AUTH_DRAFT_KEY) ||
          window.localStorage.getItem(LEGACY_EXCLUSIVE_ONBOARDING_AUTH_DRAFT_KEY);
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
    setAuthSessionChecked(false);
    getClientAsync()
      .then((supabase) => supabase.auth.getUser())
      .then(async ({ data: { user } }) => {
        if (cancelled) return;
        const email =
          typeof user?.email === 'string' && user.email.trim()
            ? user.email.trim().toLowerCase()
            : null;
        if (!email && handoffAuthenticatedRef.current) {
          setAuthSessionChecked(true);
          return;
        }
        setAuthenticatedEmail(email);
        if (email) {
          setWorkEmail((current) => current.trim() || email);
        }
        const {
          data: { session },
        } = await getClientAsync().then((supabase) => supabase.auth.getSession());
        onboardingAccessTokenRef.current = session?.access_token ?? null;
        setAuthSessionChecked(true);
      })
      .catch(() => {
        if (!cancelled) {
          if (handoffAuthenticatedRef.current) {
            setAuthSessionChecked(true);
            return;
          }
          setAuthenticatedEmail(null);
          setAuthSessionChecked(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

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
    (isSelfServeDemoOnboarding || ONBOARDING_COUNTRY_CODES.some((code) => code === countryCode)) &&
    (!requiresStepOneAuth ||
      hasAuthenticatedOnboardingSession ||
      (normalizedWorkEmail.length > 0 && accountPassword.trim().length >= 6));
  const canStep3 =
    workspaceName.trim().length > 0 &&
    industry.length > 0 &&
    (!isSelfServeDemoOnboarding || ONBOARDING_COUNTRY_CODES.some((code) => code === countryCode));
  const selectedCountry = ONBOARDING_COUNTRY_OPTIONS.find((country) => country.code === countryCode);
  const filteredCountries = useMemo(() => {
    const query = countrySearchQuery.trim().toLowerCase();
    if (!query) return ONBOARDING_COUNTRY_OPTIONS;
    return ONBOARDING_COUNTRY_OPTIONS.filter((country) =>
      `${country.label} ${country.name} ${country.code}`.toLowerCase().includes(query)
    );
  }, [countrySearchQuery]);
  const billingCurrency = getBillingCurrency();
  const seatPricing = getSeatPricing();
  const selectedSeatCount = SOLO_SEATS;
  const pricingCards = [
    {
      id: 'free',
      title: 'Free',
      seatCount: SOLO_SEATS,
      priceLabel: '$0',
      priceSuffix: '',
      billingLabel: 'No credit card required.',
      description: '1 free campaign to build your first map and try WolfGrid.',
      features: [
        '1 Free campaign',
        'Invite team',
        'iOS and Android mobile apps',
        'Lead capture',
        'Track performance',
        '3D prospecting map',
      ],
      buttonLabel: 'Start free',
      showLaunchPricing: false,
    },
    {
      id: 'simple-pro',
      title: 'WolfGrid',
      seatCount: selectedSeatCount,
      priceLabel: formatPlanPrice(seatPricing.seatMonthlyDisplay, billingCurrency),
      priceSuffix: '/workspace/month',
      billingLabel: 'Your whole team is included. Billed monthly.',
      description: 'Unlimited campaigns to run your team, track routes, and follow up with leads.',
      features: [
        'Unlimited campaigns',
        '3D prospecting maps',
        'GPS door tracking',
        'Rep assignments',
        'Lead capture',
        'Team dashboard',
        'QR code tools',
        '& much more',
      ],
      buttonLabel: 'Select Pro',
      showLaunchPricing: true,
    },
  ] as const;

  const buildResumePath = useCallback(() => {
    const resumeParams = new URLSearchParams(searchParams.toString());
    resumeParams.set('resume', 'complete');
    return `${onboardingEntryPath}?${resumeParams.toString()}`;
  }, [onboardingEntryPath, searchParams]);

  const persistOnboardingDraft = useCallback(
    (checkoutSeats: number, checkoutUseCase: 'solo' | 'team') => {
      if (typeof window === 'undefined') return;
      const draft: OnboardingDraft = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        countryCode,
        useCase,
        workspaceName: workspaceName.trim(),
        industry: industry.trim(),
        brokerage: brokerage.trim(),
        brokerageId,
        referralCode: referralCode.trim(),
        referralSource,
        referralCampaign,
        seats,
        teamInviteEmails,
        checkoutSeats,
        checkoutUseCase,
      };
      window.localStorage.setItem(ONBOARDING_DRAFT_KEY, JSON.stringify(draft));
      window.localStorage.removeItem(LEGACY_ONBOARDING_DRAFT_KEY);
    },
    [
      brokerage,
      brokerageId,
      countryCode,
      firstName,
      industry,
      lastName,
      referralCampaign,
      referralCode,
      referralSource,
      seats,
      teamInviteEmails,
      useCase,
      workspaceName,
    ]
  );

  const redirectToLoginForCompletion = useCallback(
    (checkoutSeats: number, checkoutUseCase: 'solo' | 'team') => {
      persistOnboardingDraft(checkoutSeats, checkoutUseCase);
      router.push(`/login?next=${encodeURIComponent(buildResumePath())}`);
    },
    [buildResumePath, persistOnboardingDraft, router]
  );

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
    window.localStorage.removeItem(LEGACY_EXCLUSIVE_ONBOARDING_AUTH_DRAFT_KEY);
  }, [countryCode, firstName, requiresOnboardingAuth, lastName, normalizedWorkEmail]);

  const buildExclusiveAuthCallbackURL = useCallback(() => {
    const callbackUrl = new URL('/auth/callback', resolvePublicAppOrigin(window.location.origin));
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
    draft?: OnboardingDraft;
  }): Promise<OnboardingCompletionResponse | null> => {
    setError(null);
    setCheckoutError(null);
    setLoading(true);
    try {
      const draft = options?.draft;
      const draftUseCase = draft?.useCase === 'team' ? 'team' : draft?.useCase === 'solo' ? 'solo' : undefined;
      const normalizedInviteEmails = normalizeEmailList(draft?.teamInviteEmails ?? teamInviteEmails);
      const completionUseCase = options?.checkoutUseCase ?? draft?.checkoutUseCase ?? draftUseCase ?? useCase;
      const completionSeats =
        typeof options?.checkoutSeats === 'number' && Number.isFinite(options.checkoutSeats)
          ? options.checkoutSeats
          : typeof draft?.checkoutSeats === 'number' && Number.isFinite(draft.checkoutSeats)
            ? draft.checkoutSeats
            : typeof draft?.seats === 'number' && Number.isFinite(draft.seats)
              ? draft.seats
              : seats;
      const selfServeCampaignDraft = isSelfServeDemoOnboarding ? readSelfServeCampaignDraft() : null;
      const sessionResult = await getClientAsync()
        .then((supabase) => supabase.auth.getSession())
        .catch(() => null);
      // OAuth/account creation can rotate the session token while onboarding is
      // open. Always prefer the current session over the cached token so the
      // final completion request does not incorrectly reset the user to step 1.
      const accessToken = sessionResult?.data.session?.access_token ?? onboardingAccessTokenRef.current ?? null;
      onboardingAccessTokenRef.current = accessToken;
      const res = await fetch('/api/onboarding/complete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({
          firstName: (draft?.firstName ?? firstName).trim(),
          lastName: (draft?.lastName ?? lastName).trim(),
          countryCode: draft?.countryCode ?? countryCode,
          workspaceName: (draft?.workspaceName ?? workspaceName).trim(),
          industry: (draft?.industry ?? industry).trim(),
          referralCode: shouldShowReferralStep ? (draft?.referralCode ?? referralCode).trim() || null : null,
          referralSource: isSelfServeDemoOnboarding
            ? 'self-serve-demo'
            : draft?.referralSource ?? referralSource,
          referralCampaign: isSelfServeDemoOnboarding
            ? 'self-serve-campaign'
            : draft?.referralCampaign ?? referralCampaign,
          brokerage: (draft?.brokerage ?? brokerage).trim() || undefined,
          brokerageId: draft?.brokerageId ?? brokerageId ?? undefined,
          useCase: isExclusivePartnerTeamLayout
            ? 'team'
            : completionUseCase,
          maxSeats: completionUseCase === 'team' || isExclusivePartnerTeamLayout
            ? Math.max(TEAM_MIN_SEATS, normalizedInviteEmails.length + 1, completionSeats)
            : SOLO_SEATS,
          partnerOfferToken: isExclusivePartnerOnboarding ? partnerOfferToken : undefined,
          salespersonInviteToken: isSalespersonOnboarding ? salespersonInviteToken : undefined,
          clientSource: isSelfServeDemoOnboarding
            ? 'self-serve-demo'
            : searchParams.get('source') ?? undefined,
          selfServeCampaignDraft,
          teamMemberEmails:
            completionUseCase === 'team' || isExclusivePartnerTeamLayout
              ? normalizedInviteEmails
              : undefined,
          openAppAfterCompletion: true,
          openCampaignCreateAfterCompletion: isSelfServeDemoOnboarding && !selfServeCampaignDraft,
          resumeCampaignAfterOnboarding:
            isSelfServeDemoOnboarding && !selfServeCampaignDraft && searchParams.get('resumeCampaign') === '1',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        if (typeof data?.redirect === 'string') {
          setPostOnboardingRedirect(data.redirect);
        }
        return data as OnboardingCompletionResponse;
      }
      if (res.status === 401 && requiresOnboardingAuth) {
        onboardingAccessTokenRef.current = null;
        setAuthenticatedEmail(null);
        setStep(1);
        setAuthError('Create or sign in to your account so we can save this campaign.');
        setError(null);
        return null;
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

  const refreshOnboardingAccessToken = useCallback(async (): Promise<string | null> => {
    const sessionResult = await getClientAsync()
      .then((supabase) => supabase.auth.getSession())
      .catch(() => null);
    const accessToken = sessionResult?.data.session?.access_token ?? null;
    onboardingAccessTokenRef.current = accessToken;
    return accessToken;
  }, []);

  const redirectAfterOnboarding = (redirect?: string | null) => {
    if (mobileReturnUrl) {
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(EXCLUSIVE_ONBOARDING_AUTH_DRAFT_KEY);
        window.localStorage.removeItem(LEGACY_EXCLUSIVE_ONBOARDING_AUTH_DRAFT_KEY);
        window.localStorage.removeItem(ONBOARDING_DRAFT_KEY);
        window.localStorage.removeItem(LEGACY_ONBOARDING_DRAFT_KEY);
        window.localStorage.removeItem(SELF_SERVE_CAMPAIGN_DRAFT_KEY);
        window.localStorage.removeItem(LEGACY_SELF_SERVE_CAMPAIGN_DRAFT_KEY);
        window.location.href = mobileReturnUrl;
      }
      return;
    }
    const destination = redirect || postOnboardingRedirect;
    if (!destination) return;
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(EXCLUSIVE_ONBOARDING_AUTH_DRAFT_KEY);
      window.localStorage.removeItem(LEGACY_EXCLUSIVE_ONBOARDING_AUTH_DRAFT_KEY);
      window.localStorage.removeItem(ONBOARDING_DRAFT_KEY);
      window.localStorage.removeItem(LEGACY_ONBOARDING_DRAFT_KEY);
      window.localStorage.removeItem(SELF_SERVE_CAMPAIGN_DRAFT_KEY);
      window.localStorage.removeItem(LEGACY_SELF_SERVE_CAMPAIGN_DRAFT_KEY);
      window.location.href = destination;
    }
  };

  const handleSubmit = async (options?: {
    checkoutSeats?: number;
    checkoutUseCase?: 'solo' | 'team';
  }) => {
    const checkoutSeats = options?.checkoutSeats ?? selectedSeatCount;
    const checkoutUseCase = options?.checkoutUseCase ?? (checkoutSeats > SOLO_SEATS ? 'team' : 'solo');
    const currentAccessToken = onboardingAccessTokenRef.current ?? await refreshOnboardingAccessToken();
    let authSatisfied =
      (hasAuthenticatedOnboardingSession && Boolean(currentAccessToken)) ||
      (!requiresOnboardingAuth && Boolean(authenticatedEmail));
    if (!authSatisfied) {
      if (isSelfServeDemoOnboarding || requiresOnboardingAuth) {
        authSatisfied = await ensureExclusiveAuth();
        if (!authSatisfied) {
          if (isSelfServeDemoOnboarding) setStep(1);
          return;
        }
      } else if (!authenticatedEmail) {
        redirectToLoginForCompletion(checkoutSeats, checkoutUseCase);
        return;
      }
    }

    if (!authSatisfied && !isSelfServeDemoOnboarding) {
      redirectToLoginForCompletion(checkoutSeats, checkoutUseCase);
      return;
    }
    const data = await completeOnboarding(options);
    if (data?.redirect) {
      redirectAfterOnboarding(data.redirect);
    }
  };

  const handleContinueToApp = async (checkoutSeats: number) => {
    const checkoutUseCase = checkoutSeats > SOLO_SEATS ? 'team' : 'solo';
    if (!authenticatedEmail) {
      if (isSelfServeDemoOnboarding) {
        setStep(1);
        setAuthError('Create your account first so we can save this campaign in your dashboard.');
        return;
      }
      redirectToLoginForCompletion(checkoutSeats, checkoutUseCase);
      return;
    }

    const completion = await completeOnboarding({ checkoutSeats, checkoutUseCase });
    if (completion?.redirect) {
      redirectAfterOnboarding(completion.redirect);
    }
  };

  useEffect(() => {
    if (!isResumeCompletion) return;
    const draft = readOnboardingDraft();
    if (!draft) {
      router.replace('/onboarding');
      return;
    }
    setFirstName(draft.firstName);
    setLastName(draft.lastName);
    setCountryCode(draft.countryCode);
    setUseCase(draft.useCase);
    setWorkspaceName(draft.workspaceName);
    setIndustry(draft.industry);
    setBrokerage(draft.brokerage);
    setBrokerageId(draft.brokerageId);
    setReferralCode(draft.referralCode);
    setReferralSource(draft.referralSource);
    setReferralCampaign(draft.referralCampaign);
    setSeats(draft.seats);
    setTeamInviteEmails(draft.teamInviteEmails.length > 0 ? draft.teamInviteEmails : ['']);
    setStep(onboardingFinalStep);
    setPendingResumeDraft(draft);
  }, [isResumeCompletion, onboardingFinalStep, router]);

  useEffect(() => {
    if (!isResumeCompletion || !pendingResumeDraft || resumeCompletionStarted.current || !authSessionChecked) return;
    if (!authenticatedEmail) {
      redirectToLoginForCompletion(pendingResumeDraft.checkoutSeats, pendingResumeDraft.checkoutUseCase);
      return;
    }
    resumeCompletionStarted.current = true;
    void completeOnboarding({
      checkoutSeats: pendingResumeDraft.checkoutSeats,
      checkoutUseCase: pendingResumeDraft.checkoutUseCase,
      draft: pendingResumeDraft,
    }).then((completion) => {
      if (completion?.redirect) {
        redirectAfterOnboarding(completion.redirect);
      } else {
        resumeCompletionStarted.current = false;
        setPendingResumeDraft(null);
      }
    });
    // The resume effect should run once for the stored draft after auth settles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    authSessionChecked,
    authenticatedEmail,
    isResumeCompletion,
    pendingResumeDraft,
    redirectToLoginForCompletion,
  ]);

  const handleLogout = useCallback(async () => {
    setSigningOut(true);
    try {
      const supabase = await getClientAsync();
      await supabase.auth.signOut();
      onboardingAccessTokenRef.current = null;
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
        const accessToken = onboardingAccessTokenRef.current ?? await refreshOnboardingAccessToken();
        if (accessToken) return true;
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
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (session?.access_token) {
          onboardingAccessTokenRef.current = session.access_token;
          setAuthenticatedEmail(normalizedEmail);
          return true;
        }
      }

      if (currentUser) {
        await supabase.auth.signOut();
        onboardingAccessTokenRef.current = null;
      }

      if (isSelfServeDemoOnboarding) {
        const createAccountResponse = await fetch('/api/onboarding/self-serve-account', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            countryCode,
            email: normalizedEmail,
            password: accountPassword,
            selfServeCampaignDraft: readSelfServeCampaignDraft(),
          }),
        }).catch(() => null);
        if (!createAccountResponse) {
          setAuthError('Could not reach authentication service. Please try again.');
          return false;
        }
        const createAccountData = await createAccountResponse.json().catch(() => ({}));
        if (!createAccountResponse.ok) {
          setAuthError(
            typeof createAccountData?.error === 'string'
              ? createAccountData.error
              : 'Failed to create account.'
          );
          return false;
        }
      }

      const signInResult = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password: accountPassword,
      });
      if (!signInResult.error && signInResult.data?.session) {
        onboardingAccessTokenRef.current = signInResult.data.session.access_token;
        setAuthenticatedEmail(normalizedEmail);
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

      if (isSelfServeDemoOnboarding) {
        setAuthError('This email already has an account. Use the right password or try another email.');
        return false;
      }

      const nextQs = new URLSearchParams();
      if (isSelfServeDemoOnboarding) {
        nextQs.set('source', 'self-serve-demo');
        nextQs.set('campaign', 'self-serve-campaign');
        if (searchParams.get('resumeCampaign') === '1') {
          nextQs.set('resumeCampaign', '1');
        }
      } else if (isDialerOnboarding) {
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
      const callbackUrl = new URL('/auth/callback', resolvePublicAppOrigin(window.location.origin));
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
        onboardingAccessTokenRef.current = signUpResult.data.session.access_token;
        setAuthenticatedEmail(normalizedEmail);
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
    isSelfServeDemoOnboarding,
    lastName,
    countryCode,
    challenge30FromUrl,
    legacyPartnerExclusiveLayout,
    onboardingEntryPath,
    partnerExclusiveParam,
    partnerOfferToken,
    refreshOnboardingAccessToken,
    searchParams,
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
    '!h-14 min-h-14 rounded-xl border-[#d9dce2] bg-white text-base font-semibold text-[#17181c] placeholder:text-[#8a8f99] shadow-none focus-visible:border-[#17181c] focus-visible:ring-2 focus-visible:ring-black/10 dark:bg-white dark:text-[#17181c] dark:placeholder:text-[#8a8f99]';
  const outlineButtonClass =
    'h-12 rounded-xl border-[#d9dce2] bg-white text-[#202124] hover:bg-[#f5f6f8] hover:text-[#202124] dark:border-[#d9dce2] dark:bg-white dark:text-[#202124] dark:hover:bg-[#f5f6f8] dark:hover:text-[#202124]';
  const onboardingNavButtonClass =
    'h-auto min-h-11 min-w-20 rounded-none bg-transparent px-2 text-xl font-bold text-[#17181c] shadow-none hover:bg-transparent hover:text-[#17181c] focus-visible:ring-black/10 dark:bg-transparent dark:text-[#17181c] dark:hover:bg-transparent dark:hover:text-[#17181c]';
  const activeDotClass = 'h-2.5 w-7 rounded-full bg-[#17181c]';
  const inactiveDotClass = 'h-2.5 w-2.5 rounded-full bg-[#c7c9ce]';

  const heading =
    step === 1
      ? isSelfServeDemoOnboarding
        ? searchParams.get('resumeCampaign') === '1'
          ? 'Your 3D map is building'
          : 'Build your first 3D prospecting map'
        : 'Help us personalize your experience'
      : step === 2
        ? 'How will you use WolfGrid?'
        : step === 3
          ? 'Set up your workspace'
          : step === 4
            ? 'Ambassador referral code'
            : 'Reach your potential with WolfGrid';

  const subheading =
    step === 1
      ? isSelfServeDemoOnboarding
        ? searchParams.get('resumeCampaign') === '1'
          ? 'Create your free account while we prepare the homes in your neighborhood.'
          : 'Create a free account to get started'
        : null
      : step === 2
        ? isExclusivePartnerTeamLayout
          ? 'Team mode is pre-selected for this exclusive offer.'
          : 'Choose solo or team so we can tailor your workspace.'
      : step === 3
        ? isSelfServeDemoOnboarding
          ? 'Finish setup and we will open your 3D homes as soon as the map is ready.'
          : 'Name your business and tell us your industry.'
          : step === 4
            ? 'Enter an ambassador code to unlock your offer, or skip this step.'
            : 'Select a plan based on your needs';

  useEffect(() => {
    if (step > onboardingFinalStep) {
      setStep(onboardingFinalStep);
    }
  }, [onboardingFinalStep, step]);

  if (isResumeCompletion && (loading || !authSessionChecked || pendingResumeDraft)) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6">
        <p className="text-[#6f7480]">Opening WolfGrid...</p>
      </div>
    );
  }

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
    <div className="min-h-screen bg-white text-[#17181c] flex flex-col items-center justify-start overflow-x-hidden px-5 py-0">
      <main
        className={`w-full min-w-0 ${
          step === FINAL_ONBOARDING_STEP ? 'max-w-[1120px]' : 'max-w-[720px]'
        }`}
      >
        <div className="-mt-5 flex justify-center">
          <WolfGridLogo
            kind="auth"
            className="h-44 w-auto sm:h-52"
            priority
            surface="light"
          />
        </div>
        <div className={step === 1 ? 'mb-4 text-center' : step === FINAL_ONBOARDING_STEP ? 'mb-6 text-center' : 'mb-5 text-center'}>
          <div className={step === 1 ? 'space-y-2' : 'space-y-3'}>
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
              {isSalespersonOnboarding ? 'Set up your WolfGrid sales workspace' : 'Exclusive included campaign unlocked'}
            </p>
            <p className="mt-1 text-sm text-[#6f7480]">
              {isSalespersonOnboarding
                ? 'Create your account with the invited email. Your workspace will be nested under WolfGrid / Salespeople.'
                : hideExclusiveStep1Demo
                  ? 'Finish onboarding to activate your included workspace campaign.'
                  : 'Finish onboarding to activate your included workspace campaign and watch the demo if you have not already.'}
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
              className="space-y-3 [&_input]:!h-12 [&_input]:min-h-12"
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
              <div className="grid gap-3 sm:grid-cols-2">
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
              {!isSelfServeDemoOnboarding ? (
                <div className="space-y-2">
                  <Label htmlFor="countryCode" className={labelClass}>Country</Label>
                  <div className="relative">
                    <button
                      id="countryCode"
                      type="button"
                      onClick={() => setCountrySearchOpen((open) => !open)}
                      className="flex h-14 min-h-14 w-full items-center justify-between rounded-xl border border-[#d9dce2] bg-white px-4 text-left text-base font-semibold text-[#17181c] outline-none transition focus:border-[#17181c] focus:ring-2 focus:ring-black/10"
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
                          className="h-12 rounded-none border-0 border-b border-[#e3e5e8] bg-[#f6f7f9] text-[#17181c] placeholder:text-[#9aa0aa] focus-visible:ring-0"
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
              ) : null}
              {requiresStepOneAuth ? (
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="workEmail" className={labelClass}>
                      {isSelfServeDemoOnboarding ? 'Email' : 'Work email'}
                    </Label>
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
                      : isSelfServeDemoOnboarding
                        ? 'Create an account so your first campaign is saved in your dashboard.'
                        : 'We will sign in or create this account before continuing.'}
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Button type="button" variant="outline" className={outlineButtonClass} onClick={() => void handleExclusiveOAuthSignIn('google')} disabled={authLoading}>
                      {authLoading && authMode === 'google'
                        ? 'Continuing with Google...'
                        : isSelfServeDemoOnboarding
                          ? 'Create with Google'
                          : 'Continue with Google'}
                    </Button>
                    <Button type="button" variant="outline" className={outlineButtonClass} onClick={() => void handleExclusiveOAuthSignIn('apple')} disabled={authLoading}>
                      {authLoading && authMode === 'apple'
                        ? 'Continuing with Apple...'
                        : isSelfServeDemoOnboarding
                          ? 'Create with Apple'
                          : 'Continue with Apple'}
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
              {isSelfServeDemoOnboarding ? (
                <div className="space-y-2">
                  <Label htmlFor="countryCode" className={labelClass}>Country</Label>
                  <div className="relative">
                    <button
                      id="countryCode"
                      type="button"
                      onClick={() => setCountrySearchOpen((open) => !open)}
                      className="flex h-14 min-h-14 w-full items-center justify-between rounded-xl border border-[#d9dce2] bg-white px-4 text-left text-base font-semibold text-[#17181c] outline-none transition focus:border-[#17181c] focus:ring-2 focus:ring-black/10"
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
                          className="h-12 rounded-none border-0 border-b border-[#e3e5e8] bg-[#f6f7f9] text-[#17181c] placeholder:text-[#9aa0aa] focus-visible:ring-0"
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
              ) : null}
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
                  <SelectTrigger id="industry" className="!h-14 min-h-14 w-full rounded-xl border-[#d9dce2] bg-white px-4 py-0 text-base font-semibold text-[#17181c] data-[placeholder]:text-[#8a8f99] dark:bg-white dark:text-[#17181c] dark:data-[placeholder]:text-[#8a8f99]">
                    <SelectValue placeholder="Select industry" />
                  </SelectTrigger>
                  <SelectContent className="max-h-[220px] overflow-y-auto rounded-xl border-[#d9dce2] bg-white text-[#17181c] dark:bg-white dark:text-[#17181c]">
                    {INDUSTRIES_TOP.map((ind) => (
                      <SelectItem key={ind} value={ind} className="text-base font-semibold text-[#17181c] focus:bg-[#f5f6f8] focus:text-[#17181c] dark:text-[#17181c] dark:focus:bg-[#f5f6f8] dark:focus:text-[#17181c]">{ind}</SelectItem>
                    ))}
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
                  Included workspace campaign unlocked
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

          {step === FINAL_ONBOARDING_STEP && (
            <div className="space-y-8">
              <div className="mx-auto grid max-w-none gap-6 md:grid-cols-2">
                {pricingCards.map((card) => {
                  return (
                    <div
                      key={card.id}
                      className="flex min-h-[440px] flex-col rounded-[26px] border border-[#d9dce2] bg-white p-6 shadow-[0_18px_45px_rgba(0,0,0,0.08)]"
                    >
                      <h2 className="text-2xl font-bold text-[#17181c]">{card.title}</h2>
                      {card.showLaunchPricing ? (
                        <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5">
                          <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">
                            50% off launch pricing
                          </p>
                          <p className="mt-1 text-sm font-semibold text-[#17181c]">
                            Normally{' '}
                            <span className="text-[#8c919c] line-through">
                              {formatPlanPrice(seatPricing.originalSeatMonthlyDisplay, billingCurrency)} /workspace/month
                            </span>
                          </p>
                        </div>
                      ) : (
                        <div className="mt-3 rounded-xl border border-[#d9dce2] bg-[#fafafa] px-4 py-2.5">
                          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#6f7480]">
                            Starter plan
                          </p>
                          <p className="mt-1 text-sm font-semibold text-[#17181c]">
                            Includes 1 free campaign
                          </p>
                        </div>
                      )}
                      <div className="mt-4">
                        <span className="text-4xl font-bold text-[#050505]">
                          {card.priceLabel}
                        </span>
                        {card.priceSuffix ? (
                          <span className="text-xl font-medium text-[#17181c]">{card.priceSuffix}</span>
                        ) : null}
                      </div>
                      <p className="mt-2 text-sm font-semibold text-[#7b7f89]">
                        {card.billingLabel}
                      </p>
                      <p className="mt-4 text-base font-semibold leading-6 text-[#7b7f89]">
                        {card.description}
                      </p>
                      <ul className="mt-5 space-y-2.5">
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
                        disabled={loading || authLoading}
                        onClick={async () => {
                          if (isDialerOnboarding) {
                            await handleContinueToApp(card.seatCount);
                            return;
                          }
                          await handleContinueToApp(card.seatCount);
                        }}
                        className="mt-5 h-11 w-full rounded-xl border-[#d9dce2] bg-[#09090b] text-sm font-bold text-white hover:bg-[#27272a] hover:text-white dark:border-[#09090b] dark:bg-[#09090b] dark:text-white dark:hover:bg-[#27272a] dark:hover:text-white"
                      >
                        {loading ? 'Opening...' : card.buttonLabel}
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

          <div className={`${step === 1 ? 'mt-4' : 'mt-6'} flex items-center justify-center gap-14 sm:gap-24`}>
            {step > 1 ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setStep((s) => (!shouldShowReferralStep && s === FINAL_ONBOARDING_STEP ? 3 : s - 1))}
                className={onboardingNavButtonClass}
                disabled={loading || authLoading}
              >
                Back
              </Button>
            ) : null}
            {step < onboardingFinalStep ? (
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
                    : isSelfServeDemoOnboarding && step === 1
                        ? 'Next'
                      : 'Next'}
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                onClick={async () => {
                  await handleSubmit({
                    checkoutSeats: selectedSeatCount,
                    checkoutUseCase: useCase,
                  });
                }}
                disabled={loading || authLoading || (step === 3 && !canStep3)}
                className={onboardingNavButtonClass}
              >
                {loading ? 'Creating...' : isSelfServeDemoOnboarding ? 'Show my map' : 'Skip'}
              </Button>
            )}
          </div>
        </section>
      </main>

      <div
        className={
          step === FINAL_ONBOARDING_STEP
            ? 'mt-3 mb-3 flex justify-center gap-2 pointer-events-none px-4'
            : 'fixed bottom-7 left-0 right-0 z-20 flex justify-center gap-2 pointer-events-none px-4'
        }
      >
        {Array.from({ length: onboardingFinalStep }, (_, index) => (
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
