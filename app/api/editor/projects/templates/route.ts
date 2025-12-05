import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/editor-db/drizzle';
import { editorProjects } from '@/lib/editor-db/schema';
import { eq, asc, desc } from 'drizzle-orm';

// Get templates
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '10');

    try {
      const templates = await db
        .select()
        .from(editorProjects)
        .where(eq(editorProjects.isTemplate, true))
        .limit(limit)
        .offset((page - 1) * limit)
        .orderBy(asc(editorProjects.isPro), desc(editorProjects.updatedAt));

      return NextResponse.json({ data: templates });
    } catch (dbError: any) {
      // If database is not configured, return empty array
      if (dbError.message?.includes('DATABASE_URL') || dbError.message?.includes('must be set')) {
        console.warn('Database not configured, returning empty templates list');
        return NextResponse.json({ data: [] });
      }
      throw dbError;
    }
  } catch (error) {
    console.error('Error fetching templates:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

