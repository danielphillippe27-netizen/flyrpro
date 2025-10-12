export default function TestPage() {
  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <h1>FLYR PRO - Test Page</h1>
      <p>If you can see this, the basic Next.js app is working!</p>
      <p>Environment check:</p>
      <ul>
        <li>NEXT_PUBLIC_SUPABASE_URL: {process.env.NEXT_PUBLIC_SUPABASE_URL ? '✅ Set' : '❌ Missing'}</li>
        <li>NEXT_PUBLIC_SUPABASE_ANON_KEY: {process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? '✅ Set' : '❌ Missing'}</li>
        <li>NODE_ENV: {process.env.NODE_ENV}</li>
      </ul>
    </div>
  );
}
