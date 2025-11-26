'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface NumericInputProps {
  label?: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  className?: string;
}

export function NumericInput({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  className,
}: NumericInputProps) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const numValue = parseFloat(e.target.value);
    if (!isNaN(numValue)) {
      let clamped = numValue;
      if (min !== undefined) clamped = Math.max(min, clamped);
      if (max !== undefined) clamped = Math.min(max, clamped);
      onChange(clamped);
    }
  };

  return (
    <div className={className}>
      {label && <Label className="text-xs text-slate-300 mb-1.5 block">{label}</Label>}
      <div className="relative">
        <Input
          type="number"
          value={value}
          onChange={handleChange}
          min={min}
          max={max}
          step={step}
          className="h-9 pr-8"
        />
        {unit && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 pointer-events-none">
            {unit}
          </span>
        )}
      </div>
    </div>
  );
}

