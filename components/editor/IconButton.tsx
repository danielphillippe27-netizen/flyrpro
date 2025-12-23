'use client';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface IconButtonProps {
  icon: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  title?: string;
  variant?: 'default' | 'ghost' | 'outline';
  size?: 'sm' | 'default' | 'lg';
  className?: string;
}

export function IconButton({
  icon,
  onClick,
  disabled,
  active,
  title,
  variant = 'ghost',
  size = 'default',
  className,
}: IconButtonProps) {
  return (
    <Button
      variant={variant}
      size={size === 'sm' ? 'icon-sm' : size === 'lg' ? 'icon-lg' : 'icon'}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'text-slate-300 hover:text-slate-50',
        active && 'bg-slate-700 text-slate-50',
        className
      )}
    >
      {icon}
    </Button>
  );
}






