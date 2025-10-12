import Link from 'next/link';

export default function LoginPage() {
  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <h1>FLYR PRO - Login</h1>
      <p>This is a minimal login page to test if the app loads.</p>
      <p>Environment check:</p>
      <ul>
        <li>NEXT_PUBLIC_SUPABASE_URL: {process.env.NEXT_PUBLIC_SUPABASE_URL ? '✅ Set' : '❌ Missing'}</li>
        <li>NEXT_PUBLIC_SUPABASE_ANON_KEY: {process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? '✅ Set' : '❌ Missing'}</li>
        <li>NODE_ENV: {process.env.NODE_ENV}</li>
      </ul>
      <p><Link href="/">Go to Home</Link></p>
      <p><Link href="/test">Go to Test Page</Link></p>
    </div>
  );
}

