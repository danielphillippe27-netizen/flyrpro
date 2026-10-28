import { NextRequest, NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';

export const dynamic = 'force-dynamic';

type Holiday = { date?: string; observedDate?: string; global?: boolean; counties?: string[] | null; types?: string[] };

export async function GET(request: NextRequest) {
  if (!(await resolveUserFromRequest(request))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const country = request.nextUrl.searchParams.get('country')?.toUpperCase() ?? '';
  const region = request.nextUrl.searchParams.get('region')?.toUpperCase() ?? '';
  const year = Number(request.nextUrl.searchParams.get('year'));
  if (!/^[A-Z]{2}$/.test(country) || !/^[A-Z]{2,3}$/.test(region) || !Number.isInteger(year) || year < 1900 || year > 2100) {
    return NextResponse.json({ error: 'Choose a valid country and region.' }, { status: 400 });
  }
  try {
    const results = await Promise.all(Array.from({ length: 11 }, async (_, i) => {
      const response = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year + i}/${country}`, { next: { revalidate: 86400 } });
      if (!response.ok) throw new Error('Holiday data unavailable');
      const holidays: Holiday[] = await response.json();
      if (!Array.isArray(holidays) || holidays.length === 0) throw new Error('Holiday data unavailable');
      return holidays.filter(item => item.types?.includes('Public') && (item.global || item.counties?.includes(`${country}-${region}`)))
        .map(item => item.observedDate || item.date).filter((date): date is string => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date));
    }));
    return NextResponse.json({ dates: [...new Set(results.flat())].sort() });
  } catch {
    return NextResponse.json({ error: 'Local holidays are unavailable. Try another region or turn holidays off.' }, { status: 503 });
  }
}
