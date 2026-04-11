'use client';

import { useEffect, useRef, useState } from 'react';

type ExclusiveOfferArcadeEmbedProps = {
  variant?: 'default' | 'iphone';
  instance?: number;
  demo?: 'team' | 'ig-dm';
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

function ArcadeFrame({
  src,
  title,
  paddingBottom,
}: {
  src: string;
  title: string;
  paddingBottom: string;
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
    <div style={{ position: 'relative', paddingBottom, height: '0', width: '100%' }}>
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

export function ExclusiveOfferArcadeEmbed({
  variant = 'default',
  instance = 0,
  demo = 'team',
}: ExclusiveOfferArcadeEmbedProps) {
  const defaultDemoConfig =
    demo === 'ig-dm'
      ? {
          src: 'https://demo.arcade.software/8ccpKIGdJB6eW0WNy4W0?embed&embed_mobile=inline&embed_desktop=inline&show_copy_link=false',
          title: 'FLYR IG DM onboarding demo',
        }
      : {
          src: 'https://demo.arcade.software/nbvH4JKdrqCGt8a0O8pi?embed&embed_mobile=inline&embed_desktop=inline&show_copy_link=false',
          title: 'FLYR team prospecting dashboard',
        };

  if (variant === 'iphone') {
    return (
      <ArcadeFrame
        key={instance}
        src="https://demo.arcade.software/QugJLQYJyeeaM0JPVgZL?embed&embed_mobile=inline&embed_desktop=inline&show_copy_link=false"
        title="FLYR iPhone demo"
        paddingBottom="calc(62.5% + 41px)"
      />
    );
  }

  return (
    <ArcadeFrame
      key={instance}
      src={defaultDemoConfig.src}
      title={defaultDemoConfig.title}
      paddingBottom="calc(64.94708994708994% + 41px)"
    />
  );
}
