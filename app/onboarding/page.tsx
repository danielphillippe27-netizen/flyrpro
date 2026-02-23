'use client';

import { Suspense, useState, useCallback, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
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

function OnboardingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
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

  // When arriving from app handoff (Continue on web), skip name step and start at team/workspace.
  useEffect(() => {
    if (searchParams.get('from_handoff') === '1') {
      setStep(2);
      setUseCase('team');
      setSeats(TEAM_MIN_SEATS);
    }
  }, [searchParams]);

  const canStep1 = firstName.trim().length > 0 && lastName.trim().length > 0;
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
      const res = await fetch('/api/onboarding/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          workspaceName: workspaceName.trim(),
          industry: industry.trim(),
          referralCode: referralCode.trim() || null,
          brokerage: brokerage.trim() || undefined,
          brokerageId: brokerageId ?? undefined,
          useCase,
          maxSeats: useCase === 'team' ? Math.max(TEAM_MIN_SEATS, seats) : SOLO_SEATS,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.redirect) {
        window.location.href = data.redirect;
        return;
      }
      setError(data?.error ?? 'Something went wrong. Please try again.');
    } catch (e) {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="dark min-h-screen bg-gradient-to-br from-black to-[#262626] flex flex-col items-center justify-center p-6 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-red-950/40 via-transparent to-black/80 pointer-events-none" />
      <div
        className={`relative w-full space-y-8 rounded-2xl border border-white/15 bg-white/[0.06] p-10 backdrop-blur-2xl shadow-[0_24px_70px_rgba(0,0,0,0.6),0_10px_30px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.2)] ${step >= 4 ? 'max-w-5xl' : 'max-w-lg'}`}
      >
        <div className="text-center space-y-2">
          <h1 className={`font-bold leading-tight text-white ${step === 4 ? 'text-5xl' : step === 5 ? 'text-4xl' : 'text-3xl'}`}>
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
                You're one step away from tracking every door
                <br />
                and never losing a lead.
              </>
            )}
          </h1>
          {(step === 1 || step === 2 || step === 3) && (
            <p className="text-base text-[#AAAAAA]">
              {step === 1 && 'We use this to personalize your experience.'}
              {step === 2 && 'Choose solo or invite your team.'}
              {step === 3 && 'Name your business and tell us your industry.'}
            </p>
          )}
        </div>

        {step === 1 && (
          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              if (canStep1) setStep((s) => s + 1);
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
          </form>
        )}

        {step === 2 && (
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
                Invite others
              </span>
            </button>
          </div>
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
              onClick={() => setStep((s) => s + 1)}
              disabled={
                (step === 1 && !canStep1) || (step === 3 && !canStep3)
              }
              className="w-full h-14 text-lg font-semibold bg-[#ef4444] text-white hover:bg-[#dc2626] border-0"
            >
              Continue
            </Button>
          ) : (
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={loading}
              className="w-full h-14 text-lg font-semibold bg-[#ef4444] text-white hover:bg-[#dc2626] border-0"
            >
              {loading ? 'Saving…' : 'Start trial'}
            </Button>
          )}
        </div>
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
