import { redirect } from 'next/navigation';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Redirecting...',
};

export default function DashboardPage() {
  // Server-side redirect - this happens before the page renders
  redirect('/home');
}

