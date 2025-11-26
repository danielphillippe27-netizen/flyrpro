'use client';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';

interface FontSelectorProps {
  label?: string;
  value: string;
  onChange: (font: string) => void;
  className?: string;
}

const FONTS = [
  'Arial, sans-serif',
  'Helvetica, sans-serif',
  'Times New Roman, serif',
  'Georgia, serif',
  'Courier New, monospace',
  'Verdana, sans-serif',
  'Inter, sans-serif',
  'Roboto, sans-serif',
  'Open Sans, sans-serif',
  'Lato, sans-serif',
];

export function FontSelector({ label, value, onChange, className }: FontSelectorProps) {
  return (
    <div className={className}>
      {label && <Label className="text-xs text-slate-300 mb-1.5 block">{label}</Label>}
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {FONTS.map((font) => (
            <SelectItem key={font} value={font}>
              <span style={{ fontFamily: font }}>{font.split(',')[0]}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

