'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface ColorPickerProps {
  label?: string;
  value: string;
  onChange: (color: string) => void;
  className?: string;
}

export function ColorPicker({ label, value, onChange, className }: ColorPickerProps) {
  return (
    <div className={className}>
      {label && <Label className="text-xs text-slate-300 mb-1.5 block">{label}</Label>}
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-16 rounded border border-slate-700 bg-slate-800 cursor-pointer"
        />
        <Input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 h-9 text-sm font-mono"
          placeholder="#000000"
        />
      </div>
    </div>
  );
}

