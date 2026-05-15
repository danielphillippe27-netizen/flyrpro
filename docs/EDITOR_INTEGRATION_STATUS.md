# Canva Clone Editor Integration Status

## ✅ Completed

1. **Dependencies Merged** - Added all required packages to `package.json`:
   - Fabric.js, React Query, Drizzle ORM, postgres
   - UI components (Radix UI, Sonner, etc.)
   - Editor dependencies (react-color, material-colors, etc.)

2. **Database Schema Created**:
   - `lib/editor-db/schema.ts` - Editor projects table schema
   - `lib/editor-db/drizzle.ts` - Database connection using FLYR's Supabase
   - `drizzle.config.ts` - Drizzle configuration

3. **Editor Files Copied**:
   - All editor components → `lib/editor-canva/features/editor/`
   - UI components → `lib/editor-canva/components/`
   - Projects/images features → `lib/editor-canva/features/`
   - Lib utilities → `lib/editor-canva/lib/`

4. **Import Paths Updated**:
   - Changed `@/features/` → `@/lib/editor-canva/features/`
   - Changed `@/components/` → `@/lib/editor-canva/components/`
   - Changed `@/lib/` → `@/lib/editor-canva/lib/`
   - Changed `@/db/` → `@/lib/editor-db/`

5. **Basic Structure Created**:
   - Query provider for React Query
   - Editor route at `/app/editor-canva/page.tsx`

## ⚠️ Needs Work

### 1. Install Dependencies
```bash
npm install
```

### 2. Database Setup
- Add `DATABASE_URL` to `.env.local` (Supabase connection string)
- Run migrations: `npm run db:migrate`
- Create the `editor_project` table in Supabase

### 3. API Routes
The editor uses Hono API routes that need to be adapted for FLYR:

**Current Issue**: Editor hooks use Hono client (`@/lib/editor-canva/lib/hono`) which expects Hono API routes.

**Options**:
- **Option A**: Create Next.js API routes at `/app/api/editor/` that mirror the Hono routes
- **Option B**: Replace Hono client with direct Supabase calls in the hooks
- **Option C**: Keep Hono but create adapter routes

**Files needing API routes**:
- `/app/api/editor/projects/` - CRUD for projects
- `/app/api/editor/images/` - Image fetching (Unsplash)
- `/app/api/editor/ai/` - AI features (Replicate)

### 4. Authentication Integration
- Editor currently expects NextAuth, but FLYR uses Supabase Auth
- Need to:
  - Update auth checks in API routes to use Supabase
  - Update `userId` references to use Supabase user IDs
  - Remove NextAuth dependencies

### 5. Tailwind Compatibility
- FLYR uses Tailwind v4 (new CSS-based config)
- Editor uses Tailwind v3 (traditional config)
- May need to:
  - Add Tailwind v3 config alongside v4
  - Or update editor components to use v4 syntax
  - Check for class name conflicts

### 6. Missing Dependencies
Some features may need additional setup:
- **UploadThing**: For image uploads (needs API keys)
- **Replicate**: For AI features (needs API key)
- **Unsplash**: For stock images (needs API key)

### 7. Type Fixes
- Update TypeScript types to match FLYR's structure
- Fix any import/export issues
- Resolve React 19 compatibility (editor uses React 18 types)

## 🚀 Quick Start (After Dependencies Installed)

1. **Test the editor route**:
   ```
   http://localhost:3000/editor-canva
   ```

2. **If you see errors**, check:
   - Are all dependencies installed?
   - Is DATABASE_URL set in `.env.local`?
   - Are API routes created?

## 📝 Next Steps Priority

1. **Install dependencies** (`npm install`)
2. **Set up database** (add DATABASE_URL, run migrations)
3. **Create basic API route** for projects (at least GET/POST)
4. **Test editor loads** without errors
5. **Fix authentication** to use Supabase
6. **Add remaining API routes** as needed

## 🔧 Files to Create/Update

### API Routes Needed:
- `app/api/editor/projects/route.ts` - Project CRUD
- `app/api/editor/projects/[id]/route.ts` - Single project
- `app/api/editor/projects/templates/route.ts` - Templates
- `app/api/editor/images/route.ts` - Image search (Unsplash)

### Hooks to Update:
- `lib/editor-canva/features/projects/api/*.ts` - Update to use Next.js API routes instead of Hono

### Components to Check:
- All editor components for Tailwind class compatibility
- Auth-dependent components for Supabase integration




