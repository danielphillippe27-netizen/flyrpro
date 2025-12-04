'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Home, Map, Plus, TrendingUp, Trophy, Users, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import Image from 'next/image';

const tabs = [
  { href: '/home', icon: Home, label: 'Home' },
  { href: '/map', icon: Map, label: 'Map' },
  { href: '/crm', icon: Users, label: 'CRM' },
  { href: '/create', icon: Plus, label: 'Create' },
  { href: '/analytics', icon: TrendingUp, label: 'Analytics' },
  { href: '/leaderboard', icon: Trophy, label: 'Leaderboard' },
  { href: '/settings', icon: Settings, label: 'Settings' },
];

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  
  // Temporary session logging for debugging
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      console.log("SESSION DEBUG (Layout):", session);
    });
  }, []);

  return (
    <div className="flex flex-row h-screen">
      {/* Left Sidebar */}
      <nav className="fixed left-0 top-0 bottom-0 w-20 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 z-50">
        <div className="flex flex-col items-center h-full py-4">
          {/* Logo */}
          <div className="mb-6 flex items-center justify-center">
            <Image 
              src="/flyr-logo-black.svg" 
              alt="FLYR" 
              width={32} 
              height={32}
              className="h-8 w-8 dark:invert"
            />
          </div>
          <div className="flex flex-col items-center justify-start flex-1 gap-2">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = pathname === tab.href || pathname?.startsWith(tab.href + '/');
            
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  'flex flex-col items-center justify-center w-full py-3 transition-colors',
                  isActive
                    ? 'text-red-600 dark:text-red-500'
                    : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
                )}
                title={tab.label}
              >
                <Icon className="w-6 h-6 mb-1" />
                <span className="text-xs font-medium">{tab.label}</span>
              </Link>
            );
          })}
          </div>
        </div>
      </nav>
      
      <main className="flex-1 overflow-auto ml-20">{children}</main>
    </div>
  );
}

