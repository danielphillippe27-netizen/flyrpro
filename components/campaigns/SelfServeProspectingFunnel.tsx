'use client';

import { useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  CircleDot,
  CheckCircle2,
  DoorOpen,
  LockKeyhole,
  MapPinned,
  Pentagon,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { AddressAutocomplete } from '@/components/address/AddressAutocomplete';
import { Button } from '@/components/ui/button';
import type { AddressSuggestion } from '@/lib/services/MapboxAutocompleteService';
import { allocateSelfServeDoorOutcomeCounts } from '@/lib/demo/selfServeDoorOutcomes';

export type SelfServeProspectingStep = 'location' | 'selection' | 'preview';
export type SelfServeSelectionTool = 'polygon' | 'radius';

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
  onSearchQueryChange: (value: string) => void;
  onSearchSelect: (suggestion: AddressSuggestion) => void;
  onUseLocation: () => void;
  onStartDrawing: () => void;
  onSelectionToolChange: (tool: SelfServeSelectionTool) => void;
  onClearBoundary: () => void;
  onGeneratePreview: () => void;
  onRevealPreview: () => void;
  onBackToSelection: () => void;
  onStartOnboarding: () => void;
};

const BUILDING_LIMIT = 1000;
const doorOutcomeLegend = [
  ['No answer', '30%', 'bg-red-500'],
  ['Answer', '30%', 'bg-green-500'],
  ['Lead', '20%', 'bg-blue-500'],
  ['Appointment', '10%', 'bg-yellow-400'],
  ['Other', '10%', 'bg-slate-500'],
] as const;

const lockedPerformanceMetrics = [
  ['Conversation / Lead %', '36.7%'],
  ['Doors / Conversation', '3.3'],
  ['Distance', '4.8 km'],
  ['Time', '2h 14m'],
] as const;

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
  onSearchQueryChange,
  onSearchSelect,
  onUseLocation,
  onStartDrawing,
  onSelectionToolChange,
  onClearBoundary,
  onGeneratePreview,
  onRevealPreview,
  onBackToSelection,
  onStartOnboarding,
}: SelfServeProspectingFunnelProps) {
  const [showResults, setShowResults] = useState(false);

  const limitExceeded = discoveredCount > BUILDING_LIMIT;
  const selectionLabel = limitExceeded ? '1,000 limit · area too large' : `${selectedCount} selected`;
  const previewRevealInProgress = previewRevealCount > 0 && previewRevealCount < selectedCount;
  const previewRevealed = selectedCount > 0 && previewRevealCount >= selectedCount;
  const outcomeCounts = allocateSelfServeDoorOutcomeCounts(selectedCount);

  const handlePreviewBack = () => {
    if (step === 'preview' && showResults) {
      setShowResults(false);
      return;
    }
    setShowResults(false);
    onBackToSelection();
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
            onClick={step === 'preview' ? handlePreviewBack : onClearBoundary}
            className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 transition hover:bg-white/10"
            aria-label={step === 'preview' && showResults ? 'Back to 3D map' : step === 'preview' ? 'Back to selection' : 'Clear boundary'}
          >
            <ArrowLeft className="size-5" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">
              {step === 'preview' ? (showResults ? 'Mock campaign results' : 'Live 3D campaign preview') : 'Live territory estimate'}
            </p>
            <p className="truncate text-sm font-black">
              {showResults ? 'Doors Hit' : 'Buildings Selected'}: <span className="text-red-300">{selectedCount}</span>
            </p>
          </div>
          <span
            aria-live="polite"
            className={`rounded-full px-3 py-2 text-[10px] font-black uppercase tracking-wide ${limitExceeded ? 'bg-red-500 text-white' : 'bg-white/10 text-zinc-200'}`}
          >
            {showResults ? '100% worked' : selectionLabel}
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
              <div
                aria-live="polite"
                className={`rounded-2xl border p-3 ${limitExceeded ? 'border-red-500 bg-red-500/15' : 'border-white/5 bg-white/5'}`}
              >
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <p className={`text-[10px] font-bold uppercase tracking-[0.14em] ${limitExceeded ? 'text-red-300' : 'text-zinc-500'}`}>
                      Buildings
                    </p>
                    <p className={`mt-1 text-3xl font-black ${limitExceeded ? 'text-red-300' : 'text-white'}`}>
                      {selectedCount}
                    </p>
                  </div>
                  {limitExceeded ? (
                    <p className="max-w-[12rem] text-right text-[11px] font-black uppercase leading-4 tracking-wide text-red-300">
                      1,000 building limit<br />Area too large
                    </p>
                  ) : null}
                </div>
              </div>
              <p className={`mt-3 text-xs leading-5 ${limitExceeded ? 'font-bold text-red-300' : 'text-zinc-400'}`}>
                {limitExceeded
                  ? 'Shrink your boundary until fewer than 1,000 buildings are selected.'
                  : 'Aim for 50–1,000 buildings. WolfGrid will add every available building inside your boundary.'}
              </p>
              <Button
                type="button"
                onClick={onGeneratePreview}
                disabled={!hasBoundary || selectedCount === 0 || limitExceeded}
                className="mt-3 h-14 w-full rounded-2xl bg-red-500 text-sm font-black text-white hover:bg-red-400"
              >
                <Sparkles className="size-5" />
                {limitExceeded ? 'Area Too Large — Reduce Below 1,000' : 'Create My 3D Map'}
              </Button>
            </div>
          </div>
        </>
      ) : (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 max-h-[65dvh] overflow-y-auto px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
          <div className="pointer-events-auto mx-auto w-full max-w-lg rounded-[1.75rem] border border-white/10 bg-[#08090c]/92 p-4 text-white shadow-[0_-24px_80px_rgba(0,0,0,0.55)] backdrop-blur-2xl sm:p-5">
            {showResults ? (
              <>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-red-300">Mock campaign results</p>
                    <h2 className="mt-1 text-xl font-black tracking-tight">Here&apos;s what a completed day could look like.</h2>
                  </div>
                  <BarChart3 className="size-6 shrink-0 text-red-300" />
                </div>
                <p className="mt-3 text-sm font-medium leading-6 text-zinc-400">
                  Sample field data generated from working every door in this territory.
                </p>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <div className="rounded-2xl border border-red-400/15 bg-red-500/10 p-3">
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-red-300">No answer · 30%</p>
                    <p className="mt-1 text-2xl font-black text-red-400">{outcomeCounts.no_answer}</p>
                  </div>
                  <div className="rounded-2xl border border-green-400/15 bg-green-500/10 p-3">
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-green-300">Answer · 30%</p>
                    <p className="mt-1 text-2xl font-black text-green-400">{outcomeCounts.answered}</p>
                  </div>
                  <div className="rounded-2xl border border-blue-400/15 bg-blue-500/10 p-3">
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-blue-300">Lead · 20%</p>
                    <p className="mt-1 text-2xl font-black text-blue-400">{outcomeCounts.lead}</p>
                  </div>
                  <div className="rounded-2xl border border-yellow-400/15 bg-yellow-400/10 p-3">
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-yellow-300">Appointment · 10%</p>
                    <p className="mt-1 text-2xl font-black text-yellow-300">{outcomeCounts.appointment}</p>
                  </div>
                </div>
                <p className="mt-2 text-center text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500">
                  {selectedCount} doors hit · {outcomeCounts.other} other / not interested
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2" aria-label="Performance analytics available after claiming this map">
                  {lockedPerformanceMetrics.map(([label, value]) => (
                    <div
                      key={label}
                      className="relative min-h-20 overflow-hidden rounded-2xl border border-white/8 bg-white/[0.035] p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[9px] font-bold uppercase leading-4 tracking-[0.12em] text-zinc-400">
                          {label}
                        </p>
                        <LockKeyhole className="size-3.5 shrink-0 text-zinc-600" aria-hidden="true" />
                      </div>
                      <p
                        aria-hidden="true"
                        className="mt-1 select-none text-xl font-black text-white blur-[5px]"
                      >
                        {value}
                      </p>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-center text-[9px] font-bold uppercase tracking-[0.14em] text-zinc-600">
                  Claim this map to unlock performance analytics
                </p>
                <div className="mt-3 flex items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.035] px-4 py-3">
                  <CheckCircle2 className="size-5 shrink-0 text-emerald-300" />
                  <p className="text-xs font-bold leading-5 text-zinc-300">
                    100% territory coverage with every outcome saved to the map.
                  </p>
                </div>
                <p className="mt-4 text-center text-sm font-bold leading-5 text-zinc-200">
                  Claim this map and use WolfGrid to find your next job.
                </p>
                <Button
                  type="button"
                  onClick={onStartOnboarding}
                  className="mt-3 h-14 w-full rounded-2xl bg-red-500 text-sm font-black text-white shadow-[0_16px_40px_rgba(239,68,68,0.28)] hover:bg-red-400"
                >
                  <LockKeyhole className="size-4" />
                  Claim This Map Free
                </Button>
                <p className="mt-3 text-center text-[10px] font-medium text-zinc-500">
                  No credit card required. Your first campaign is included.
                </p>
              </>
            ) : (
              <>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-red-300">
                      {previewRevealed ? 'Territory fully worked' : 'Your isolated 3D territory'}
                    </p>
                    <h2 className="mt-1 text-xl font-black tracking-tight">
                      {previewRevealed
                        ? 'Every door has been hit.'
                        : previewRevealInProgress
                          ? 'Watch the door outcomes fill in.'
                          : 'Your selected homes are now 3D.'}
                    </h2>
                  </div>
                  {previewRevealed ? <CheckCircle2 className="size-6 shrink-0 text-emerald-300" /> : <ShieldCheck className="size-6 shrink-0 text-[#8293aa]" />}
                </div>

                {!previewRevealed ? (
                  <>
                    <p className="mt-3 text-sm font-medium leading-6 text-zinc-400">
                      Every selected home is extruded in blue-grey. Fill in the map to simulate a rep working every door.
                    </p>
                    <div className="mt-4 overflow-hidden rounded-full bg-white/8">
                      <div
                        className="h-2 rounded-full bg-gradient-to-r from-red-500 via-green-500 to-blue-500 transition-[width] duration-200"
                        style={{ width: `${selectedCount > 0 ? Math.round((previewRevealCount / selectedCount) * 100) : 0}%` }}
                      />
                    </div>
                    <p className="mt-2 text-center text-[10px] font-black uppercase tracking-[0.14em] text-zinc-500">
                      {previewRevealInProgress ? `${previewRevealCount} of ${selectedCount} doors hit` : `${selectedCount} blue-grey 3D homes ready`}
                    </p>
                    <Button
                      type="button"
                      onClick={onRevealPreview}
                      disabled={previewRevealInProgress}
                      className="mt-4 h-14 w-full rounded-2xl bg-red-500 text-sm font-black text-white shadow-[0_16px_40px_rgba(239,68,68,0.28)] hover:bg-red-400"
                    >
                      <DoorOpen className="size-5" />
                      {previewRevealInProgress ? 'Working Every Door…' : 'Fill In Door Results'}
                    </Button>
                  </>
                ) : (
                  <>
                    <div className="mt-4 grid grid-cols-5 gap-1">
                      {doorOutcomeLegend.map(([label, percentage, color]) => (
                        <div key={label} className="rounded-xl bg-white/5 px-1.5 py-2 text-center">
                          <span className={`mx-auto block size-2.5 rounded-full ${color}`} />
                          <p className="mt-1.5 text-[7px] font-bold uppercase leading-tight tracking-wide text-zinc-400">{label}</p>
                          <p className="mt-1 text-[8px] font-black text-white">{percentage}</p>
                        </div>
                      ))}
                    </div>
                    <Button
                      type="button"
                      onClick={() => setShowResults(true)}
                      className="mt-4 h-14 w-full rounded-2xl bg-red-500 text-sm font-black text-white shadow-[0_16px_40px_rgba(239,68,68,0.28)] hover:bg-red-400"
                    >
                      <BarChart3 className="size-5" />
                      See Campaign Results
                      <ArrowRight className="size-4" />
                    </Button>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
