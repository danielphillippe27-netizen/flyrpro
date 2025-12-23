'use client';

import { Box } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function ThreeDToggle({
  enabled,
  onToggle,
}: {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => onToggle(!enabled)}
      className={`bg-white ${enabled ? 'bg-gray-100' : ''}`}
      title={enabled ? 'Disable 3D Buildings' : 'Enable 3D Buildings'}
    >
      <Box className="w-4 h-4 mr-2" />
      3D Buildings
    </Button>
  );
}




