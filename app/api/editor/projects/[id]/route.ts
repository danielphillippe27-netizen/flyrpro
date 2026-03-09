import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { db } from '@/lib/editor-db/drizzle';
import { editorProjects } from '@/lib/editor-db/schema';
import { eq, and } from 'drizzle-orm';
import { getSupabaseAnonKey, getSupabaseUrl } from '@/lib/supabase/env';

function isDatabaseConfigError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('DATABASE_URL') || message.includes('must be set');
}

// Get single project
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
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
      const [project] = await db
        .select()
        .from(editorProjects)
        .where(and(
          eq(editorProjects.id, id),
          eq(editorProjects.userId, user.id)
        ))
        .limit(1);

      if (!project) {
        return NextResponse.json({ error: 'Project not found' }, { status: 404 });
      }

      return NextResponse.json({ data: project });
    } catch (dbError) {
      // If database is not configured, return 503
      if (isDatabaseConfigError(dbError)) {
        return NextResponse.json({ 
          error: 'Database not configured. Please set DATABASE_URL in environment variables.' 
        }, { status: 503 });
      }
      throw dbError;
    }
  } catch (error) {
    console.error('Error fetching project:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// Update project
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
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

    try {
      const [project] = await db
        .update(editorProjects)
        .set({
          ...body,
          updatedAt: new Date(),
        })
        .where(and(
          eq(editorProjects.id, id),
          eq(editorProjects.userId, user.id)
        ))
        .returning();

      if (!project) {
        return NextResponse.json({ error: 'Project not found' }, { status: 404 });
      }

      return NextResponse.json({ data: project });
    } catch (dbError) {
      // If database is not configured, return 503
      if (isDatabaseConfigError(dbError)) {
        return NextResponse.json({ 
          error: 'Database not configured. Please set DATABASE_URL in environment variables.' 
        }, { status: 503 });
      }
      throw dbError;
    }
  } catch (error) {
    console.error('Error updating project:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// Delete project
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
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
      await db
        .delete(editorProjects)
        .where(and(
          eq(editorProjects.id, id),
          eq(editorProjects.userId, user.id)
        ));

      return NextResponse.json({ data: { id } });
    } catch (dbError) {
      // If database is not configured, return 503
      if (isDatabaseConfigError(dbError)) {
        return NextResponse.json({ 
          error: 'Database not configured. Please set DATABASE_URL in environment variables.' 
        }, { status: 503 });
      }
      throw dbError;
    }
  } catch (error) {
    console.error('Error deleting project:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
