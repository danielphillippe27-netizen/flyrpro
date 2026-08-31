'use client';

import { useState, type FormEvent } from 'react';
import {
  Apple,
  ArrowLeft,
  CircleDot,
  Eye,
  LockKeyhole,
  MapPinned,
  Pentagon,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { AddressAutocomplete } from '@/components/address/AddressAutocomplete';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import type { AddressSuggestion } from '@/lib/services/MapboxAutocompleteService';

export type SelfServeProspectingStep = 'location' | 'selection' | 'preview';
export type SelfServeSelectionTool = 'polygon' | 'radius';

type ClaimCredentials = {
  fullName: string;
  email: string;
  password: string;
};

type SelfServeProspectingFunnelProps = {
  mapLoaded: boolean;
  step: SelfServeProspectingStep;
  selectionTool: SelfServeSelectionTool;
  searchQuery: string;
  selectedCount: number;
  discoveredCount: number;
  previewRevealCount: number;
  hasBoundary: boolean;
  locationPending: boolean;
  locationError: string | null;
  claimOpen: boolean;
  claimLoading: boolean;
  claimError: string | null;
  isAuthenticated: boolean;
  onSearchQueryChange: (value: string) => void;
  onSearchSelect: (suggestion: AddressSuggestion) => void;
  onUseLocation: () => void;
  onStartDrawing: () => void;
  onSelectionToolChange: (tool: SelfServeSelectionTool) => void;
  onClearBoundary: () => void;
  onGeneratePreview: () => void;
  onRevealPreview: () => void;
  onBackToSelection: () => void;
  onClaimOpenChange: (open: boolean) => void;
  onAuthenticatedClaim: () => void;
  onCredentialsClaim: (credentials: ClaimCredentials) => Promise<void>;
  onOAuthClaim: (provider: 'google' | 'apple', fullName: string) => Promise<void>;
  onDemoOutcomeChange: (outcome: 'unvisited' | 'contacted' | 'lead') => void;
};

const outcomeOptions = [
  { id: 'unvisited' as const, label: 'Unvisited', color: 'bg-zinc-500' },
  { id: 'contacted' as const, label: 'Contacted', color: 'bg-amber-400' },
  { id: 'lead' as const, label: 'Lead', color: 'bg-emerald-400' },
];

export function SelfServeProspectingFunnel({
  mapLoaded,
  step,
  selectionTool,
  searchQuery,
  selectedCount,
  discoveredCount,
  previewRevealCount,
  hasBoundary,
  locationPending,
  locationError,
  claimOpen,
  claimLoading,
  claimError,
  isAuthenticated,
  onSearchQueryChange,
  onSearchSelect,
  onUseLocation,
  onStartDrawing,
  onSelectionToolChange,
  onClearBoundary,
  onGeneratePreview,
  onRevealPreview,
  onBackToSelection,
  onClaimOpenChange,
  onAuthenticatedClaim,
  onCredentialsClaim,
  onOAuthClaim,
  onDemoOutcomeChange,
}: SelfServeProspectingFunnelProps) {
  const [demoOpen, setDemoOpen] = useState(false);
  const [demoOutcome, setDemoOutcome] = useState<'unvisited' | 'contacted' | 'lead'>('unvisited');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const capped = discoveredCount > 1000;
  const selectionLabel = capped ? '1,000 selected · limit reached' : `${selectedCount} selected`;
  const previewRevealInProgress = previewRevealCount > 0 && previewRevealCount < selectedCount;
  const previewRevealed = selectedCount > 0 && previewRevealCount >= selectedCount;

  const handleCredentialsSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void onCredentialsClaim({ fullName, email, password });
  };

  const changeDemoOutcome = (outcome: 'unvisited' | 'contacted' | 'lead') => {
    setDemoOutcome(outcome);
    onDemoOutcomeChange(outcome);
    window.setTimeout(() => setDemoOpen(false), 320);
  };

  if (step === 'location') {
    return (
      <div className="pointer-events-none absolute inset-0 z-20 flex flex-col justify-end bg-[linear-gradient(180deg,rgba(3,5,8,0.15)_0%,rgba(3,5,8,0.42)_34%,rgba(3,5,8,0.96)_100%)] px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] text-white sm:justify-center sm:px-6">
        <div className="pointer-events-auto mx-auto w-full max-w-lg rounded-[2rem] border border-white/12 bg-[#090a0d]/88 p-5 shadow-[0_28px_90px_rgba(0,0,0,0.55)] backdrop-blur-2xl sm:p-7">
          <div className="mb-8 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-black tracking-[0.16em]">
              <span className="flex size-9 items-center justify-center rounded-xl bg-red-500 shadow-[0_0_30px_rgba(239,68,68,0.38)]">
                <MapPinned className="size-5" />
              </span>
              WOLFGRID
            </div>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-300">
              Free campaign
            </span>
          </div>

          <div className="space-y-3">
            <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-red-300">
              <Sparkles className="size-3.5" />
              Built around your latest job
            </p>
            <h1 className="text-balance text-[2.45rem] font-black leading-[0.98] tracking-[-0.055em] sm:text-5xl">
              Create a 3D Prospecting Map Around Your Latest Job
            </h1>
            <p className="max-w-md text-base font-medium leading-7 text-zinc-300">
              Target surrounding homeowners in under 60 seconds.
            </p>
          </div>

          <div className="mt-7 space-y-3">
            <AddressAutocomplete
              inputId="campaign-map-search"
              value={searchQuery}
              onChange={onSearchQueryChange}
              onSelect={onSearchSelect}
              includeCities
              placeholder="Enter property address or city..."
              inputClassName="h-14 rounded-2xl border-white/15 bg-white/10 pl-4 text-base text-white shadow-none placeholder:text-zinc-500 focus-visible:border-red-400 focus-visible:ring-red-400/30 dark:bg-white/10"
            />
            {locationError ? <p className="px-1 text-xs font-medium text-red-200">{locationError}</p> : null}
            <Button
              type="button"
              onClick={onStartDrawing}
              disabled={!mapLoaded}
              className="h-14 w-full rounded-2xl bg-red-500 text-base font-black text-white shadow-[0_18px_45px_rgba(239,68,68,0.28)] hover:bg-red-400"
            >
              <Pentagon className="size-5" />
              {mapLoaded ? 'Draw Map Area' : 'Loading 3D map...'}
            </Button>
            <button
              type="button"
              onClick={onUseLocation}
              disabled={locationPending || !mapLoaded}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-sm font-bold text-zinc-300 transition hover:bg-white/[0.08] disabled:opacity-50"
            >
              <CircleDot className="size-4" />
              {locationPending ? 'Finding your neighborhood...' : 'Use my current location'}
            </button>
          </div>

          <p className="mt-5 text-center text-[11px] font-medium text-zinc-500">
            No sign-in or credit card required to build your preview.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-5">
        <div className="pointer-events-auto mx-auto flex w-full max-w-2xl items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#08090c]/86 p-2.5 text-white shadow-2xl backdrop-blur-xl">
          <button
            type="button"
            onClick={step === 'preview' ? onBackToSelection : onClearBoundary}
            className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 transition hover:bg-white/10"
            aria-label={step === 'preview' ? 'Back to selection' : 'Clear boundary'}
          >
            <ArrowLeft className="size-5" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">
              {step === 'preview' ? 'Campaign preview' : 'Live territory estimate'}
            </p>
            <p className="truncate text-sm font-black">
              Buildings Selected: <span className="text-red-300">{selectedCount}</span>
            </p>
          </div>
          <span className={`rounded-full px-3 py-2 text-[10px] font-black uppercase tracking-wide ${capped ? 'bg-red-500 text-white' : 'bg-white/10 text-zinc-200'}`}>
            {selectionLabel}
          </span>
        </div>
      </div>

      {step === 'selection' ? (
        <>
          <div className="pointer-events-none absolute inset-x-0 top-[5.5rem] z-20 px-3 sm:px-5">
            <div className="pointer-events-auto mx-auto grid w-full max-w-sm grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-[#08090c]/86 p-2 shadow-2xl backdrop-blur-xl">
              {([
                ['polygon', Pentagon, 'Tap boundary'],
                ['radius', CircleDot, 'Drag radius'],
              ] as const).map(([tool, Icon, label]) => (
                <button
                  key={tool}
                  type="button"
                  onClick={() => onSelectionToolChange(tool)}
                  className={`flex min-h-12 items-center justify-center gap-2 rounded-xl px-3 text-xs font-black transition ${selectionTool === tool ? 'bg-red-500 text-white shadow-[0_10px_28px_rgba(239,68,68,0.28)]' : 'bg-white/5 text-zinc-300 hover:bg-white/10'}`}
                >
                  <Icon className="size-4" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
            <div className="pointer-events-auto mx-auto w-full max-w-lg rounded-[1.75rem] border border-white/10 bg-[#08090c]/90 p-4 text-white shadow-[0_-18px_60px_rgba(0,0,0,0.45)] backdrop-blur-2xl">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-2xl bg-white/5 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">Buildings</p>
                  <p className="mt-1 text-2xl font-black">{selectedCount}</p>
                </div>
                <div className="rounded-2xl bg-white/5 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">Est. contacts</p>
                  <p className="mt-1 text-2xl font-black">{selectedCount}</p>
                </div>
              </div>
              <p className="mt-3 text-xs leading-5 text-zinc-400">
                Aim for 50–1,000 homes. WolfGrid will provision every available address and stop at 1,000.
              </p>
              <Button
                type="button"
                onClick={onGeneratePreview}
                disabled={!hasBoundary || selectedCount === 0}
                className="mt-3 h-14 w-full rounded-2xl bg-red-500 text-sm font-black text-white hover:bg-red-400"
              >
                <Sparkles className="size-5" />
                Create My 3D Map
              </Button>
            </div>
          </div>
        </>
      ) : (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 max-h-[65dvh] overflow-y-auto px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
          <div className="pointer-events-auto mx-auto w-full max-w-lg rounded-[1.75rem] border border-white/10 bg-[#08090c]/92 p-4 text-white shadow-[0_-24px_80px_rgba(0,0,0,0.55)] backdrop-blur-2xl sm:p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-red-300">
                  {previewRevealed ? 'Your live campaign demo' : 'Your selected neighborhood'}
                </p>
                <h2 className="mt-1 text-xl font-black tracking-tight">
                  {previewRevealed
                    ? 'Your 3D prospecting map is ready.'
                    : previewRevealInProgress
                      ? 'Watch the houses fill in.'
                      : 'Ready to bring your map to life?'}
                </h2>
              </div>
              <ShieldCheck className="size-6 shrink-0 text-red-300" />
            </div>

            {!previewRevealed ? (
              <>
                <p className="mt-3 text-sm font-medium leading-6 text-zinc-400">
                  Press the button and WolfGrid will turn your selected houses into a live 3D field campaign.
                </p>
                <div className="mt-4 overflow-hidden rounded-full bg-white/8">
                  <div
                    className="h-2 rounded-full bg-gradient-to-r from-red-500 to-orange-400 transition-[width] duration-200"
                    style={{ width: `${selectedCount > 0 ? Math.round((previewRevealCount / selectedCount) * 100) : 0}%` }}
                  />
                </div>
                <p className="mt-2 text-center text-[10px] font-black uppercase tracking-[0.14em] text-zinc-500">
                  {previewRevealInProgress ? `${previewRevealCount} of ${selectedCount} houses added` : `${selectedCount} houses ready`}
                </p>
                <Button
                  type="button"
                  onClick={onRevealPreview}
                  disabled={previewRevealInProgress}
                  className="mt-4 h-14 w-full rounded-2xl bg-red-500 text-sm font-black text-white shadow-[0_16px_40px_rgba(239,68,68,0.28)] hover:bg-red-400"
                >
                  <Sparkles className="size-5" />
                  {previewRevealInProgress ? 'Filling Your 3D Map…' : 'Fill My Map in 3D'}
                </Button>
              </>
            ) : (
              <>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <div className="rounded-2xl bg-white/5 p-3">
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">3D houses</p>
                    <p className="mt-1 text-2xl font-black">{selectedCount}</p>
                  </div>
                  <div className="rounded-2xl bg-white/5 p-3">
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">Demo house</p>
                    <p className={`mt-1 text-sm font-black ${demoOutcome === 'lead' ? 'text-emerald-300' : demoOutcome === 'contacted' ? 'text-amber-300' : 'text-zinc-300'}`}>
                      {demoOutcome === 'lead' ? 'New lead' : demoOutcome === 'contacted' ? 'Contacted' : 'Not visited'}
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDemoOpen(true)}
                  className="mt-3 h-12 w-full rounded-2xl border-white/12 bg-white/5 text-sm font-black text-white hover:bg-white/10 hover:text-white"
                >
                  <Eye className="size-4" />
                  Hit a House and See What Happens
                </Button>
                <p className="mt-4 text-center text-sm font-bold leading-5 text-zinc-200">
                  Want to claim this map and use WolfGrid to find your next job?
                </p>
                <Button
                  type="button"
                  onClick={isAuthenticated ? onAuthenticatedClaim : () => onClaimOpenChange(true)}
                  className="mt-3 h-14 w-full rounded-2xl bg-red-500 text-sm font-black text-white shadow-[0_16px_40px_rgba(239,68,68,0.28)] hover:bg-red-400"
                >
                  <LockKeyhole className="size-4" />
                  {isAuthenticated ? 'Claim My Map' : 'Sign Up Free & Claim This Map'}
                </Button>
                <p className="mt-3 text-center text-[10px] font-medium text-zinc-500">
                  No credit card required. Your first campaign is included.
                </p>
              </>
            )}
          </div>
        </div>
      )}

      <Dialog open={demoOpen} onOpenChange={setDemoOpen}>
        <DialogContent className="overflow-hidden border-white/10 bg-[#0a0b0e] p-0 text-white sm:max-w-md">
          <div className="h-28 bg-[radial-gradient(circle_at_50%_0%,rgba(239,68,68,0.28),transparent_70%)]" />
          <div className="-mt-12 p-5 pt-0">
            <DialogHeader className="text-left">
              <span className="mb-2 flex size-12 items-center justify-center rounded-2xl bg-red-500 shadow-[0_0_35px_rgba(239,68,68,0.35)]">
                <MapPinned className="size-6" />
              </span>
              <DialogTitle className="text-2xl font-black">You just hit this house.</DialogTitle>
              <DialogDescription className="leading-6 text-zinc-400">
                What happened at the door? Choose an outcome and watch that house update on your map.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-5 grid grid-cols-3 gap-2">
              {outcomeOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => changeDemoOutcome(option.id)}
                  className={`min-h-16 rounded-2xl border p-2 text-xs font-black transition ${demoOutcome === option.id ? 'border-white/25 bg-white/10 text-white' : 'border-white/8 bg-white/[0.03] text-zinc-500'}`}
                >
                  <span className={`mx-auto mb-2 block size-3 rounded-full ${option.color}`} />
                  {option.label}
                </button>
              ))}
            </div>
            <div className="mt-4 flex items-center justify-between rounded-2xl border border-white/8 bg-white/[0.035] px-4 py-3">
              <span className="text-xs font-bold text-zinc-400">Live campaign coverage</span>
              <span className="text-sm font-black text-white">{demoOutcome === 'unvisited' ? '0' : demoOutcome === 'contacted' ? '1' : '1'} / {selectedCount}</span>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Sheet open={claimOpen} onOpenChange={onClaimOpenChange}>
        <SheetContent side="bottom" className="max-h-[94dvh] overflow-y-auto rounded-t-[2rem] border-white/10 bg-[#090a0d] px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-6 text-white sm:left-1/2 sm:max-w-lg sm:-translate-x-1/2 sm:rounded-[2rem] sm:bottom-5 sm:border">
          <SheetHeader className="pr-8 text-left">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-red-300">One last step</p>
            <SheetTitle className="text-2xl font-black tracking-tight text-white">Claim this map and start finding your next job.</SheetTitle>
            <SheetDescription className="leading-6 text-zinc-400">
              Sign up free today. No credit card required, and your first neighborhood campaign is included.
            </SheetDescription>
          </SheetHeader>

          <form onSubmit={handleCredentialsSubmit} className="mt-5 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="claim-full-name" className="text-xs font-bold text-zinc-300">Full name</Label>
              <Input id="claim-full-name" value={fullName} onChange={(event) => setFullName(event.target.value)} autoComplete="name" placeholder="Jordan Smith" className="h-12 rounded-xl border-white/12 bg-white/[0.06] text-white placeholder:text-zinc-600 dark:bg-white/[0.06]" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="claim-email" className="text-xs font-bold text-zinc-300">Email</Label>
              <Input id="claim-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="you@company.com" className="h-12 rounded-xl border-white/12 bg-white/[0.06] text-white placeholder:text-zinc-600 dark:bg-white/[0.06]" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="claim-password" className="text-xs font-bold text-zinc-300">Password</Label>
              <Input id="claim-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" placeholder="6+ characters" className="h-12 rounded-xl border-white/12 bg-white/[0.06] text-white placeholder:text-zinc-600 dark:bg-white/[0.06]" />
            </div>
            {claimError ? <p role="alert" className="rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-200">{claimError}</p> : null}
            <Button type="submit" disabled={claimLoading} className="h-14 w-full rounded-2xl bg-red-500 text-sm font-black text-white hover:bg-red-400">
              {claimLoading ? 'Claiming your campaign...' : 'Claim Free Campaign'}
            </Button>
          </form>

          <div className="my-4 flex items-center gap-3 text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-600">
            <span className="h-px flex-1 bg-white/8" /> or continue with <span className="h-px flex-1 bg-white/8" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" disabled={claimLoading} onClick={() => void onOAuthClaim('google', fullName)} className="h-12 rounded-xl border-white/12 bg-white/5 font-black text-white hover:bg-white/10 hover:text-white">
              <span className="text-base">G</span> Google
            </Button>
            <Button type="button" variant="outline" disabled={claimLoading} onClick={() => void onOAuthClaim('apple', fullName)} className="h-12 rounded-xl border-white/12 bg-white/5 font-black text-white hover:bg-white/10 hover:text-white">
              <Apple className="size-4" /> Apple
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
