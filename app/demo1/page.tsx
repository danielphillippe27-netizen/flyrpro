import { redirect } from 'next/navigation';
import FullDemoPage from '../interactive-demo/page';

type DemoPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

// Keep links already shared by email, SMS, and the mobile apps on the primary demo.
export default async function DemoPage({ searchParams }: DemoPageProps) {
  const params = await searchParams;
  const full = Array.isArray(params?.full) ? params.full[0] : params?.full;
  if (full === '1') return <FullDemoPage searchParams={Promise.resolve(params ?? {})} />;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (Array.isArray(value)) value.forEach((item) => query.append(key, item));
    else if (value !== undefined) query.set(key, value);
  }
  const search = query.toString();
  redirect(`/${search ? `?${search}` : ''}#demo`);
}
