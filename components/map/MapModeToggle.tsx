'use client';

import { Sun, Moon, Satellite } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type MapMode = 'light' | 'dark' | 'satellite';

export function MapModeToggle({
  mode,
  onModeChange,
}: {
  mode: MapMode;
  onModeChange: (mode: MapMode) => void;
}) {
  const modeConfig = {
    light: { icon: Sun, label: 'Light' },
    dark: { icon: Moon, label: 'Dark' },
    satellite: { icon: Satellite, label: 'Satellite' },
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
              onClick={() => onModeChange(key as MapMode)}
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

