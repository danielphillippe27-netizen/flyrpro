'use client';

import { useEffect, useRef, useState } from 'react';
import { Play, X } from 'lucide-react';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

type ExclusiveOfferArcadeEmbedProps = {
  variant?: 'default' | 'iphone';
  instance?: number;
  demo?: 'team' | 'ig-dm';
  mode?: 'inline' | 'modal';
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

type ArcadeStep = {
  id: string;
  order: number;
  isActive: boolean;
};

type ArcadeStateUpdate = {
  event: string;
  arcade?: {
    steps?: ArcadeStep[];
  };
};

const ARCADE_ORIGIN = 'https://demo.arcade.software';

function getArcadeConfig(variant: 'default' | 'iphone', demo: 'team' | 'ig-dm') {
  if (variant === 'iphone') {
    return {
      src: 'https://demo.arcade.software/QugJLQYJyeeaM0JPVgZL?embed&embed_mobile=inline&embed_desktop=inline&show_copy_link=false',
      title: 'WolfGrid iPhone demo',
      paddingBottom: 'calc(62.5% + 41px)',
    };
  }

  if (demo === 'ig-dm') {
    return {
      src: 'https://demo.arcade.software/8ccpKIGdJB6eW0WNy4W0?embed&embed_mobile=inline&embed_desktop=inline&show_copy_link=false',
      title: 'WolfGrid IG DM onboarding demo',
      paddingBottom: 'calc(64.94708994708994% + 41px)',
    };
  }

  return {
    src: 'https://demo.arcade.software/nbvH4JKdrqCGt8a0O8pi?embed&embed_mobile=inline&embed_desktop=inline&show_copy_link=false',
    title: 'WolfGrid team prospecting dashboard',
    paddingBottom: 'calc(64.94708994708994% + 41px)',
  };
}

function ArcadeFrame({
  src,
  title,
  paddingBottom,
  height,
}: {
  src: string;
  title: string;
  paddingBottom: string;
  height?: string;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [hasAutoStarted, setHasAutoStarted] = useState(false);

  useEffect(() => {
    const processIncomingMessage = (event: MessageEvent<ArcadeStateUpdate>) => {
      if (event.origin !== ARCADE_ORIGIN) return;

      const eventName = event.data?.event;
      if (eventName !== 'state-update' && eventName !== 'arcade-state-update') return;

      const steps = [...(event.data.arcade?.steps ?? [])].sort((a, b) => a.order - b.order);
      if (steps.length < 2) return;

      if (hasAutoStarted) return;

      const activeStep = steps.find((step) => step.isActive);
      if (!activeStep || activeStep.id !== steps[0]?.id) {
        setHasAutoStarted(true);
        return;
      }

      iframeRef.current?.contentWindow?.postMessage(
        {
          event: 'navigate-to-step',
          stepId: steps[1]?.id,
        },
        ARCADE_ORIGIN
      );
      setHasAutoStarted(true);
    };

    window.addEventListener('message', processIncomingMessage);
    return () => window.removeEventListener('message', processIncomingMessage);
  }, [hasAutoStarted]);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: height ?? '0',
        paddingBottom: height ? undefined : paddingBottom,
      }}
    >
      <iframe
        ref={iframeRef}
        src={src}
        title={title}
        frameBorder="0"
        loading="lazy"
        allowFullScreen
        allow="clipboard-write"
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', colorScheme: 'light' }}
      />
    </div>
  );
}

function IphoneDemoPoster() {
  return (
    <div className="relative overflow-hidden rounded-[24px] border border-white/10 bg-[#050507] px-4 py-8 sm:px-6 sm:py-10">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(239,68,68,0.16),_rgba(5,5,7,0.98)_52%)]" />
      <div className="absolute inset-x-0 top-0 h-28 bg-[linear-gradient(180deg,_rgba(255,255,255,0.06),_transparent)]" />

      <div className="relative mx-auto flex max-w-[250px] justify-center">
        <div className="relative h-[430px] w-[215px] rounded-[38px] border border-white/15 bg-[#0b0b10] p-2 shadow-[0_30px_80px_rgba(0,0,0,0.55)]">
          <div className="absolute left-1/2 top-3 h-1.5 w-16 -translate-x-1/2 rounded-full bg-white/10" />
          <div className="absolute left-5 right-5 top-5 flex items-center justify-between text-[10px] font-semibold text-white/75">
            <span>9:41</span>
            <span>WolfGrid</span>
          </div>

          <div className="flex h-full flex-col justify-between rounded-[30px] border border-white/8 bg-[linear-gradient(180deg,_#020203_0%,_#07070a_55%,_#0c1220_100%)] px-4 pb-5 pt-14">
            <div className="space-y-2 text-center">
              <div className="mx-auto inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.18em] text-white/60">
                New campaign
              </div>
            </div>

            <div className="space-y-4 text-center">
              <div className="mx-auto inline-flex rounded-md border-2 border-red-500/80 px-3 py-1 shadow-[0_0_24px_rgba(239,68,68,0.18)]">
                <span className="text-4xl font-black tracking-tight text-white sm:text-[2.75rem]">WolfGrid</span>
              </div>
              <p className="text-sm text-white/80">Creating campaign</p>
            </div>

            <div className="flex items-center justify-between px-1 text-white/80">
              <Play className="h-7 w-7 fill-current" />
              <div className="h-3 w-3 rounded-full bg-white" />
              <div className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-white/70" />
                <span className="h-1.5 w-1.5 rounded-full bg-white/40" />
                <span className="h-1.5 w-1.5 rounded-full bg-white/40" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="relative mt-6 flex justify-center">
        <div className="inline-flex items-center rounded-full border border-red-400/30 bg-red-500/15 px-4 py-2 text-sm font-semibold text-white shadow-[0_18px_40px_rgba(239,68,68,0.18)]">
          <Play className="mr-2 h-4 w-4 fill-current" />
          Press for demo
        </div>
      </div>
    </div>
  );
}

export function ExclusiveOfferArcadeEmbed({
  variant = 'default',
  instance = 0,
  demo = 'team',
  mode = 'inline',
  open,
  onOpenChange,
}: ExclusiveOfferArcadeEmbedProps) {
  const config = getArcadeConfig(variant, demo);
  const [internalOpen, setInternalOpen] = useState(false);
  const [modalInstance, setModalInstance] = useState(0);
  const isControlled = typeof open === 'boolean';
  const isOpen = isControlled ? open : internalOpen;

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setModalInstance((current) => current + 1);
    }

    if (!isControlled) {
      setInternalOpen(nextOpen);
    }

    onOpenChange?.(nextOpen);
  };

  if (mode === 'modal') {
    return (
      <Dialog open={isOpen} onOpenChange={handleOpenChange}>
        <DialogTrigger asChild>
          <button
            type="button"
            className="block w-full text-left transition hover:scale-[1.01] focus:outline-none focus:ring-2 focus:ring-red-400/60 focus:ring-offset-2 focus:ring-offset-[#18181b]"
            aria-label={`Open ${config.title}`}
          >
            <IphoneDemoPoster />
          </button>
        </DialogTrigger>

        <DialogContent
          showCloseButton={false}
          className="left-0 top-0 h-screen max-h-screen w-screen max-w-none translate-x-0 translate-y-0 overflow-hidden rounded-none border-0 bg-[#050507] p-0 text-white shadow-none"
        >
          <DialogTitle className="sr-only">{config.title}</DialogTitle>
          <DialogDescription className="sr-only">
            Interactive Arcade demo opened in a modal.
          </DialogDescription>

          <div
            className="flex items-start justify-between border-b border-white/10 px-4 py-3 sm:px-6"
            style={{
              paddingTop: 'max(0.75rem, env(safe-area-inset-top))',
              paddingLeft: 'max(1rem, env(safe-area-inset-left))',
              paddingRight: 'max(1rem, env(safe-area-inset-right))',
            }}
          >
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-red-200">Interactive demo</p>
              <p className="mt-1 max-w-xs text-sm text-zinc-400 sm:max-w-none">
                Tap through the just-listed walkthrough.
              </p>
            </div>
            <DialogClose className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white transition hover:bg-white/10">
              <X className="h-5 w-5" />
              <span className="sr-only">Close demo</span>
            </DialogClose>
          </div>

          <div
            className="flex h-[calc(100vh-89px)] items-center justify-center overflow-hidden px-3 pb-3 pt-2 sm:h-[calc(100vh-77px)] sm:px-6 sm:py-6"
            style={{
              paddingLeft: 'max(0.75rem, env(safe-area-inset-left))',
              paddingRight: 'max(0.75rem, env(safe-area-inset-right))',
              paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
            }}
          >
            <div
              className={
                variant === 'iphone'
                  ? 'mx-auto flex h-full w-full max-w-[430px] items-center justify-center'
                  : 'mx-auto h-full w-full max-w-6xl'
              }
            >
              <ArcadeFrame
                key={`modal-${instance}-${modalInstance}`}
                src={config.src}
                title={config.title}
                paddingBottom={config.paddingBottom}
                height={variant === 'iphone' ? 'min(100%, 820px)' : 'calc(100vh - 125px)'}
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <ArcadeFrame
      key={instance}
      src={config.src}
      title={config.title}
      paddingBottom={config.paddingBottom}
    />
  );
}
