'use client';

import { Briefcase, QrCode } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export type ViewMode = 'standard' | 'qr';

export function ViewModeToggle({
  mode,
  onModeChange,
}: {
  mode: ViewMode;
  onModeChange: (mode: ViewMode) => void;
}) {
  const modeConfig = {
    standard: { icon: Briefcase, label: 'Work View' },
    qr: { icon: QrCode, label: 'QR View' },
  };

  const CurrentIcon = modeConfig[mode].icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="bg-white">
          <CurrentIcon className="w-4 h-4 mr-2" />
          {modeConfig[mode].label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {Object.entries(modeConfig).map(([key, config]) => {
          const Icon = config.icon;
          return (
            <DropdownMenuItem
              key={key}
              onClick={() => onModeChange(key as ViewMode)}
              className={mode === key ? 'bg-gray-100' : ''}
            >
              <Icon className="w-4 h-4 mr-2" />
              {config.label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
