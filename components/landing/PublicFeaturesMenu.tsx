'use client';

import Link from 'next/link';
import { ChevronDown, CloudLightning } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function PublicFeaturesMenu({ active = false }: { active?: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={`flex items-center gap-1.5 rounded-sm text-sm transition hover:text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-red-600 ${active ? 'font-semibold text-zinc-950' : 'font-medium text-zinc-600'}`}
        >
          Features <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" sideOffset={16} className="w-64 rounded-2xl border-zinc-200 bg-white p-2 text-zinc-950 shadow-xl">
        <DropdownMenuItem asChild className="rounded-xl p-3 focus:bg-zinc-100 focus:text-zinc-950">
          <Link href="/features/storms" aria-current={active ? 'page' : undefined}>
            <CloudLightning className="mr-2 size-5 text-red-600" aria-hidden="true" />
            <span>
              <span className="block font-bold">Storms</span>
              <span className="mt-1 block text-xs text-zinc-500">From storm map to field campaign.</span>
            </span>
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
