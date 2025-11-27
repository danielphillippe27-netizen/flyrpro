'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Home, Map, Plus, TrendingUp, Trophy, Users, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

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
    <div className="flex flex-col h-screen">
      {/* Top Tab Bar */}
      <nav className="fixed top-0 left-0 right-0 bg-white border-b border-gray-200 z-50">
        <div className="flex justify-around items-center h-16">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = pathname === tab.href || pathname?.startsWith(tab.href + '/');
            
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  'flex flex-col items-center justify-center flex-1 h-full transition-colors',
                  isActive
                    ? 'text-blue-600'
                    : 'text-gray-500 hover:text-gray-700'
                )}
              >
                <Icon className="w-6 h-6 mb-1" />
                <span className="text-xs font-medium">{tab.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
      
      <main className="flex-1 overflow-auto pt-20">{children}</main>
    </div>
  );
}

