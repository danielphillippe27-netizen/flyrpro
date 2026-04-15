'use client';

import type { FarmTouchType } from '@/types/database';
import { Button } from '@/components/ui/button';
import { FARM_TOUCH_TYPE_OPTIONS } from '@/lib/farms/config';
import { cn } from '@/lib/utils';

interface FarmTouchTypePickerProps {
  value: FarmTouchType[];
  onChange: (next: FarmTouchType[]) => void;
  disabled?: boolean;
}

export function FarmTouchTypePicker({
  value,
  onChange,
  disabled = false,
}: FarmTouchTypePickerProps) {
  const selected = new Set(value);

  const toggle = (touchType: FarmTouchType) => {
    if (disabled) return;
    const next = new Set(selected);
    if (next.has(touchType)) {
      next.delete(touchType);
    } else {
      next.add(touchType);
    }
    onChange(Array.from(next));
  };

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {FARM_TOUCH_TYPE_OPTIONS.map((option) => {
        const isSelected = selected.has(option.value);
        return (
          <Button
            key={option.value}
            type="button"
            variant={isSelected ? 'default' : 'outline'}
            disabled={disabled}
            className={cn('justify-start', !isSelected && 'text-muted-foreground')}
            onClick={() => toggle(option.value)}
          >
            {option.label}
          </Button>
        );
      })}
    </div>
  );
}
