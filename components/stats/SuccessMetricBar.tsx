'use client';

import type { ReactNode } from 'react';

interface SuccessMetricBarProps {
  title: string;
  value: number;
  icon: ReactNode;
  color: string;
  description?: string;
}

export function SuccessMetricBar({
  title,
  value,
  icon,
  color,
  description,
}: SuccessMetricBarProps) {
  const progress = Math.min(value / 100, 1);
  return (
    <div className="flex flex-col gap-2 py-1">
      <div className="flex items-center gap-2">
        <span className="text-base" style={{ color }}>{icon}</span>
        <span className="text-sm font-medium text-gray-900 dark:text-gray-100 flex-1">
          {title}
        </span>
        <span className="text-sm font-semibold text-gray-500 dark:text-gray-400">
          {value.toFixed(1)}%
        </span>
      </div>
      {description && (
        <span className="text-xs text-gray-500 dark:text-gray-400">{description}</span>
      )}
      <div className="h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${progress * 100}%`, background: color }}
        />
      </div>
    </div>
  );
}
