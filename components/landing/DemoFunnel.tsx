'use client';

import type { FormEvent, ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  BarChart3,
  Check,
  Flag,
  Medal,
  Play,
  Route,
  Sparkles,
} from 'lucide-react';

type TeamSize = 'solo' | '2-5' | '6-20' | '20-plus';

type FunnelStep = {
  eyebrow?: string;
  headline: string;
  body?: string;
  cta: string;
  render: () => ReactNode;
};

const TEAM_SIZE_OPTIONS: Array<{ value: TeamSize; label: string }> = [
  { value: 'solo', label: 'Just me' },
  { value: '2-5', label: '2-5 reps' },
  { value: '6-20', label: '6-20 reps' },
  { value: '20-plus', label: '20+ reps' },
];

const PROBLEM_CARDS = [
  {
    title: 'Reps forget the CRM',
    text: 'Doors get knocked, conversations happen, and the record is still blank at the end of the day.',
  },
  {
    title: 'Managers fly blind',
    text: 'You cannot coach the team if you cannot see routes, coverage, and follow-up in real time.',
  },
  {
    title: 'Leads fall through',
    text: 'Hot callbacks sit in someone’s notes instead of moving into the next sales motion.',
  },
];

const DASHBOARD_FEATURES = [
  {
    icon: Route,
    title: 'Breadcrumb Tracking',
    text: 'See the exact route every rep walked and which doors were covered. Review performance without chasing screenshots.',
  },
  {
    icon: Flag,
    title: 'Assign Campaigns',
    text: 'Give every rep a clear territory before they start. Keep coverage tight across blocks, streets, and teams.',
  },
  {
    icon: BarChart3,
    title: 'Reporting',
    text: 'Turn field activity into daily numbers you can read fast. Spot missed doors, lead volume, and conversion trends.',
  },
  {
    icon: Medal,
    title: 'Leaderboard',
    text: 'Make activity visible without extra admin work. Reps see momentum and managers see who is producing.',
  },
];

const MAP_BUILDINGS = [
  { x: 22, y: 20, w: 20, h: 11, color: '#22c55e' },
  { x: 48, y: 20, w: 16, h: 13, color: '#06b6d4' },
  { x: 72, y: 19, w: 20, h: 12, color: '#ef4444' },
  { x: 104, y: 21, w: 18, h: 12, color: '#f59e0b' },
  { x: 24, y: 54, w: 18, h: 12, color: '#06b6d4' },
  { x: 52, y: 55, w: 18, h: 12, color: '#22c55e' },
  { x: 82, y: 54, w: 16, h: 13, color: '#22c55e' },
  { x: 108, y: 55, w: 19, h: 12, color: '#ef4444' },
  { x: 24, y: 90, w: 17, h: 12, color: '#f59e0b' },
  { x: 52, y: 88, w: 20, h: 13, color: '#22c55e' },
  { x: 84, y: 90, w: 18, h: 12, color: '#06b6d4' },
  { x: 112, y: 88, w: 16, h: 13, color: '#22c55e' },
  { x: 24, y: 126, w: 18, h: 12, color: '#ef4444' },
  { x: 54, y: 126, w: 17, h: 13, color: '#22c55e' },
  { x: 84, y: 126, w: 19, h: 12, color: '#22c55e' },
  { x: 112, y: 126, w: 16, h: 13, color: '#06b6d4' },
];

function FlyrWordmark() {
  return (
    <div className="pointer-events-none absolute left-0 right-0 top-0 z-20 flex justify-center px-6 pt-[max(18px,env(safe-area-inset-top))]">
      <div className="rounded-sm border border-white/10 px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.28em] text-white/55">WolfGrid</div>
    </div>
  );
}

function VideoPlaceholder({ label }: { label: string }) {
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-white/12 bg-[#101012] shadow-[0_18px_70px_rgba(0,0,0,0.32)]">
      <div className="absolute inset-0 opacity-70">
        <div className="grid h-full w-full grid-cols-6 grid-rows-4">
          {Array.from({ length: 24 }).map((_, index) => (
            <span key={index} className="border border-white/[0.025]" />
          ))}
        </div>
      </div>
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white shadow-[0_16px_50px_rgba(0,0,0,0.45)] backdrop-blur">
          <Play className="ml-1 h-7 w-7 fill-current" />
        </div>
      </div>
      <div className="absolute bottom-3 left-3 rounded-md border border-white/10 bg-black/50 px-3 py-1.5 text-xs font-semibold text-white/80 backdrop-blur">
        {label}
      </div>
    </div>
  );
}

function StepShell({
  step,
  active,
  canContinue = true,
  onContinue,
  renderContent,
  children,
}: {
  step: FunnelStep;
  active: boolean;
  canContinue?: boolean;
  onContinue: () => void;
  renderContent: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={`relative h-[100dvh] w-screen shrink-0 overflow-hidden bg-[#060607] text-white ${
        active ? 'pointer-events-auto' : 'pointer-events-none'
      }`}
      aria-hidden={!active}
    >
      <FlyrWordmark />
      {renderContent ? (
        <div className="mx-auto flex h-full w-full max-w-[680px] flex-col px-6">
          <div className="min-h-0 flex-1 overflow-y-auto pb-28 pt-[max(76px,calc(env(safe-area-inset-top)+64px))] [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="flex min-h-full flex-col justify-center py-5">
              {step.eyebrow ? (
                <p className="mb-4 text-center text-[11px] font-bold uppercase tracking-[0.2em] text-red-300/85">
                  {step.eyebrow}
                </p>
              ) : null}
              <h1 className="text-balance text-center text-[clamp(2rem,10vw,3.6rem)] font-black leading-[0.95] tracking-normal text-white">
                {step.headline}
              </h1>
              {step.body ? (
                <p className="mx-auto mt-5 max-w-md text-center text-base leading-7 text-zinc-400">
                  {step.body}
                </p>
              ) : null}
              <div className="mt-7">{children}</div>
            </div>
          </div>
          <div className="absolute bottom-0 left-0 right-0 z-30 mx-auto w-full max-w-[680px] px-6 pb-[max(24px,env(safe-area-inset-bottom))] pt-4">
            <button
              type="button"
              onClick={onContinue}
              disabled={!canContinue}
              className="h-14 w-full rounded-md border border-red-400/70 bg-red-500 px-5 text-base font-black text-white shadow-[0_14px_42px_rgba(239,68,68,0.22)] transition hover:bg-red-400 focus:outline-none focus:ring-2 focus:ring-red-300/70 disabled:translate-y-2 disabled:cursor-not-allowed disabled:opacity-0"
            >
              {step.cta}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ProblemCards() {
  return (
    <div className="space-y-3">
      {PROBLEM_CARDS.map((card) => (
        <div key={card.title} className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
          <h2 className="text-lg font-black text-white">{card.title}</h2>
          <p className="mt-1 text-sm leading-6 text-zinc-400">{card.text}</p>
        </div>
      ))}
    </div>
  );
}

function FeatureChips() {
  return (
    <div className="-mx-6 flex gap-2 overflow-x-auto px-6 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {['Auto Record', 'Auto Proximity', 'Push to CRM'].map((chip) => (
        <div
          key={chip}
          className="flex h-10 shrink-0 items-center gap-2 rounded-full border border-white/10 bg-white/[0.035] px-4 text-sm font-bold text-white/85"
        >
          <span className="h-2 w-2 rounded-full bg-cyan-300" />
          {chip}
        </div>
      ))}
    </div>
  );
}

function MapVisualization() {
  return (
    <div className="relative overflow-hidden rounded-lg border border-white/10 bg-[#0d0d10]">
      <svg className="block h-auto w-full" viewBox="0 0 150 170" role="img" aria-label="Campaign map result">
        <rect width="150" height="170" fill="#0d0d10" />
        {[38, 76, 114].map((x) => (
          <path key={`v-${x}`} d={`M${x} 6V164`} stroke="#ffffff" strokeOpacity="0.09" strokeWidth="5" />
        ))}
        {[42, 78, 114, 150].map((y) => (
          <path key={`h-${y}`} d={`M8 ${y}H142`} stroke="#ffffff" strokeOpacity="0.09" strokeWidth="5" />
        ))}
        {MAP_BUILDINGS.map((building, index) => (
          <rect
            key={`${building.x}-${building.y}-${index}`}
            x={building.x}
            y={building.y}
            width={building.w}
            height={building.h}
            rx="2"
            fill={building.color}
            opacity="0.86"
          />
        ))}
        <path
          d="M31 28C49 42 56 52 60 64C66 84 98 76 105 92C114 114 83 116 79 134C76 148 99 150 116 139"
          fill="none"
          stroke="#f8fafc"
          strokeDasharray="4 4"
          strokeLinecap="round"
          strokeWidth="2.5"
          opacity="0.86"
        />
        <circle cx="116" cy="139" r="9" fill="#06b6d4" opacity="0.18" />
        <circle cx="116" cy="139" r="4" fill="#67e8f9" />
      </svg>
      <div className="absolute left-3 top-3 rounded-md border border-white/10 bg-black/55 px-3 py-2 text-xs text-white/80 backdrop-blur">
        <div className="font-black text-white">128 doors</div>
        <div className="text-zinc-400">19 leads captured</div>
      </div>
      <div className="absolute bottom-3 left-3 right-3 grid grid-cols-2 gap-1.5 rounded-md border border-white/10 bg-black/55 p-2 text-[11px] font-semibold text-zinc-300 backdrop-blur">
        {[
          ['#22c55e', 'Contacted'],
          ['#06b6d4', 'Interested'],
          ['#ef4444', 'Not home'],
          ['#f59e0b', 'Callback'],
        ].map(([color, label]) => (
          <div key={label} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />
            {label}
          </div>
        ))}
      </div>
      <span className="absolute left-[76%] top-[80%] h-6 w-6 rounded-full border border-cyan-200/70 bg-cyan-300/20 animate-ping" />
    </div>
  );
}

function DashboardGrid() {
  const [active, setActive] = useState(DASHBOARD_FEATURES[0].title);

  return (
    <div className="grid grid-cols-2 gap-3">
      {DASHBOARD_FEATURES.map((feature) => {
        const Icon = feature.icon;
        const isActive = active === feature.title;
        return (
          <button
            key={feature.title}
            type="button"
            onClick={() => setActive(feature.title)}
            className={`aspect-square rounded-lg border p-3 text-left transition ${
              isActive
                ? 'border-red-300 bg-red-500/12 shadow-[0_0_0_1px_rgba(252,165,165,0.35)]'
                : 'border-white/10 bg-white/[0.035] hover:border-white/20'
            }`}
          >
            <Icon className={`h-5 w-5 ${isActive ? 'text-red-200' : 'text-zinc-400'}`} />
            <h2 className="mt-3 text-sm font-black leading-tight text-white">{feature.title}</h2>
            <p className="mt-2 line-clamp-4 text-[11px] leading-4 text-zinc-400">{feature.text}</p>
          </button>
        );
      })}
    </div>
  );
}

function TrustLines() {
  return (
    <div className="space-y-2">
      {['Free onboarding call', 'Dedicated support', 'One campaign included'].map((line) => (
        <div key={line} className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.035] px-4 py-3">
          <Check className="h-4 w-4 text-emerald-300" />
          <span className="text-sm font-bold text-white/85">{line}</span>
        </div>
      ))}
    </div>
  );
}

function TrialForm({ onSubmit }: { onSubmit: (data: { firstName: string; lastName: string; email: string; teamSize: TeamSize }) => void }) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [teamSize, setTeamSize] = useState<TeamSize>('2-5');
  const [error, setError] = useState('');

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!firstName.trim() || !lastName.trim() || !normalizedEmail) {
      setError('Enter your name and email to start onboarding.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError('Enter a valid email address.');
      return;
    }
    setError('');
    onSubmit({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: normalizedEmail,
      teamSize,
    });
  };

  const fieldClass =
    'h-[52px] w-full rounded-md border border-white/12 bg-white/[0.055] px-4 text-base font-semibold text-white outline-none transition placeholder:text-zinc-500 focus:border-red-200 focus:ring-2 focus:ring-red-200/30';

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <input
          value={firstName}
          onChange={(event) => setFirstName(event.target.value)}
          className={fieldClass}
          placeholder="First name"
          autoComplete="given-name"
        />
        <input
          value={lastName}
          onChange={(event) => setLastName(event.target.value)}
          className={fieldClass}
          placeholder="Last name"
          autoComplete="family-name"
        />
      </div>
      <input
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        className={`${fieldClass} mt-3`}
        placeholder="Work email"
        type="email"
        autoComplete="email"
      />
      <select
        value={teamSize}
        onChange={(event) => setTeamSize(event.target.value as TeamSize)}
        className={`${fieldClass} mt-3 appearance-none`}
      >
        {TEAM_SIZE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value} className="bg-[#121214] text-white">
            {option.label}
          </option>
        ))}
      </select>
      {error ? <p className="mt-3 text-sm font-semibold text-red-300">{error}</p> : null}
      <button
        type="submit"
        className="mt-4 h-14 w-full rounded-md border border-red-400/70 bg-red-500 px-5 text-base font-black text-white shadow-[0_14px_42px_rgba(239,68,68,0.22)] transition hover:bg-red-400 focus:outline-none focus:ring-2 focus:ring-red-300/70"
      >
        Start with one campaign included →
      </button>
    </form>
  );
}

export function DemoFunnel() {
  const router = useRouter();
  const [activeStep, setActiveStep] = useState(0);
  const [introReady, setIntroReady] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setIntroReady(true), 5000);
    return () => window.clearTimeout(timer);
  }, []);

  const handleFormSubmit = (data: { firstName: string; lastName: string; email: string; teamSize: TeamSize }) => {
    const params = new URLSearchParams({
      source: 'demo',
      firstName: data.firstName,
      lastName: data.lastName,
      workEmail: data.email,
      teamSize: data.teamSize,
    });
    router.push(`/onboarding?${params.toString()}`);
  };

  const steps: FunnelStep[] = [
    {
      eyebrow: 'See what WolfGrid does in 90 seconds',
      headline: 'Your field team, finally visible.',
      body: 'Launch campaigns, guide reps, track every door, and move leads into follow-up without the end-of-day scramble.',
      cta: 'Watch the demo →',
      render: () => <VideoPlaceholder label="Intro — 90 sec" />,
    },
    {
      headline: 'The field breaks when the CRM depends on memory.',
      body: 'WolfGrid removes the manual gaps that make canvassing teams hard to manage.',
      cta: 'Sound familiar? →',
      render: () => <ProblemCards />,
    },
    {
      eyebrow: 'Step 1 of 3',
      headline: 'Launch a campaign in seconds.',
      body: 'Draw the area, define the goal, and give the team a clear route before anyone hits the street.',
      cta: 'See it in action →',
      render: () => <VideoPlaceholder label="Create campaign — 60 sec" />,
    },
    {
      eyebrow: 'Step 2 of 3',
      headline: 'Hit every door. Miss nothing.',
      body: 'Reps work from the phone while WolfGrid records coverage, proximity, outcomes, and CRM-ready follow-up.',
      cta: 'See the results →',
      render: () => (
        <div className="space-y-4">
          <VideoPlaceholder label="Live session — 2 min" />
          <FeatureChips />
        </div>
      ),
    },
    {
      eyebrow: 'Step 3 of 3',
      headline: 'The full picture.',
      body: 'After every shift, managers see coverage, door outcomes, lead volume, and the exact route walked.',
      cta: 'Meet your dashboard →',
      render: () => <MapVisualization />,
    },
    {
      headline: 'Your team, fully in view.',
      body: 'Tap a card to see what WolfGrid gives team leads the moment reps start working.',
      cta: "Here's the offer →",
      render: () => <DashboardGrid />,
    },
    {
      headline: 'We built this for you.',
      body: 'WolfGrid is built for teams that need real field accountability without adding more admin work. Start with a guided trial and see the workflow with your team.',
      cta: 'Claim my included campaign →',
      render: () => (
        <div className="space-y-4">
          <VideoPlaceholder label="From the founder — 2 min" />
          <TrustLines />
        </div>
      ),
    },
    {
      headline: 'Try WolfGrid free.',
      body: "No credit card. We'll onboard you personally.",
      cta: '',
      render: () => <TrialForm onSubmit={handleFormSubmit} />,
    },
  ];

  const goNext = () => {
    setActiveStep((current) => Math.min(current + 1, steps.length - 1));
  };

  return (
    <main className="h-[100dvh] overflow-hidden bg-[#060607] text-white">
      <div
        className="flex h-full transition-transform duration-[280ms] ease-in-out"
        style={{ transform: `translateX(-${activeStep * 100}vw)` }}
      >
        {steps.map((step, index) => {
          const renderContent = activeStep === index || activeStep - 1 === index;
          return (
            <StepShell
              key={step.headline}
              step={step}
              active={activeStep === index}
              canContinue={index === 0 ? introReady : index < steps.length - 1}
              onContinue={goNext}
              renderContent={renderContent}
            >
              {index === 0 && !introReady ? (
                <div className="mb-4 flex items-center justify-center gap-2 text-sm font-semibold text-zinc-500">
                  <Sparkles className="h-4 w-4" />
                  Watch for a moment
                </div>
              ) : null}
              {renderContent ? step.render() : null}
            </StepShell>
          );
        })}
      </div>
      <div className="sr-only" aria-live="polite">
        Step {activeStep + 1} of {steps.length}
      </div>
    </main>
  );
}
