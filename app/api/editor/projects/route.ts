import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { db } from '@/lib/editor-db/drizzle';
import { editorProjects } from '@/lib/editor-db/schema';
import { eq, desc } from 'drizzle-orm';
import { getSupabaseAnonKey, getSupabaseUrl } from '@/lib/supabase/env';

function isDatabaseConfigError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('DATABASE_URL') || message.includes('must be set');
}

// Get all projects
export async function GET() {
  try {
    const cookieStore = await cookies();
    
    const supabase = createServerClient(
      getSupabaseUrl(),
      getSupabaseAnonKey(),
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          },
        },
      }
    );

    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
      const projects = await db
        .select()
        .from(editorProjects)
        .where(eq(editorProjects.userId, user.id))
        .orderBy(desc(editorProjects.updatedAt));

      return NextResponse.json({ data: projects });
    } catch (dbError) {
      // If database is not configured, return empty array
      if (isDatabaseConfigError(dbError)) {
        console.warn('Database not configured, returning empty projects list');
        return NextResponse.json({ data: [] });
      }
      throw dbError;
    }
  } catch (error) {
    console.error('Error fetching projects:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// Create new project
export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    
    const supabase = createServerClient(
      getSupabaseUrl(),
      getSupabaseAnonKey(),
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          },
        },
      }
    );

    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { name, json, height, width } = body;

    try {
      const [project] = await db
        .insert(editorProjects)
        .values({
          name: name || 'Untitled',
          userId: user.id,
          json: json || JSON.stringify({ version: '5.3.0', objects: [] }),
          height: height || 1080,
          width: width || 1920,
          isTemplate: false,
          isPro: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      return NextResponse.json({ data: project });
    } catch (dbError) {
      // If database is not configured, return error
      if (isDatabaseConfigError(dbError)) {
        return NextResponse.json({ 
          error: 'Database not configured. Please set DATABASE_URL in environment variables.' 
        }, { status: 503 });
      }
      throw dbError;
    }
  } catch (error) {
    console.error('Error creating project:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
