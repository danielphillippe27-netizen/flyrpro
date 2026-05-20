'use client';

import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import type { TerritoryCreatePhase } from '@/lib/territory/use-territory-create-phase';

export function CreateTerritoryCta({
  onClick,
  disabled,
  label = 'Create campaign',
}: {
  onClick: () => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <div className="absolute top-5 left-1/2 z-20 w-full max-w-md -translate-x-1/2 px-4 pointer-events-none">
      <Button
        type="button"
        size="lg"
        disabled={disabled}
        onClick={onClick}
        className="pointer-events-auto h-14 w-full rounded-2xl text-base font-semibold shadow-xl"
      >
        <Plus className="mr-2 size-5" />
        {label}
      </Button>
    </div>
  );
}

export function TerritoryDrawHint({ visible }: { visible: boolean }) {
  if (!visible) return null;

  return (
    <div className="absolute bottom-6 left-1/2 z-10 -translate-x-1/2 rounded-full border border-border bg-card px-5 py-2.5 shadow-lg">
      <p className="text-sm text-foreground whitespace-nowrap">
        <span className="font-semibold">Click</span> to draw •{' '}
        <span className="font-semibold">Double-click</span> to finish
      </p>
    </div>
  );
}

export function TerritoryNamingSheet({
  open,
  title,
  description,
  children,
  onCancel,
  onSubmit,
  submitLabel,
  submitDisabled,
  isSubmitting,
}: {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  onCancel: () => void;
  onSubmit: () => void;
  submitLabel: string;
  submitDisabled?: boolean;
  isSubmitting?: boolean;
}) {
  if (!open) return null;

  return (
    <div className="absolute inset-x-0 bottom-0 z-20 flex justify-center px-4 pb-6 pointer-events-none">
      <div className="pointer-events-auto w-full max-w-lg rounded-2xl border border-border bg-card p-5 shadow-2xl">
        <div className="mb-4 space-y-1">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          {description ? (
            <p className="text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        <div className="space-y-4">{children}</div>
        <div className="mt-5 flex gap-3">
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            Back
          </Button>
          <Button
            type="button"
            className="flex-1"
            onClick={onSubmit}
            disabled={submitDisabled || isSubmitting}
          >
            {isSubmitting ? 'Creating...' : submitLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function showMapControlsForPhase(phase: TerritoryCreatePhase): boolean {
  return phase === 'drawing' || phase === 'naming';
}
