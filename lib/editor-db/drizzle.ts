import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

// Use FLYR's Supabase database connection
// DATABASE_URL should be set in environment variables
// Format: postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres

let dbInstance: ReturnType<typeof drizzle> | null = null;
let client: ReturnType<typeof postgres> | null = null;

function getDb() {
  const connectionString = process.env.DATABASE_URL;
  
  if (!connectionString) {
    // During build time, return a proxy that will fail gracefully
    // This allows the build to succeed even without DATABASE_URL
    if (typeof window === 'undefined') {
      // Server-side: create a minimal proxy that throws helpful errors at runtime
      return new Proxy({} as any, {
        get() {
          throw new Error(
            'DATABASE_URL must be set. Get it from Supabase Dashboard > Settings > Database > Connection string (URI)'
          );
        }
      });
    }
    // Client-side: should never happen, but return empty object
    return {} as any;
  }

  // Lazy initialization - only create connection when actually needed
  if (!client) {
    client = postgres(connectionString);
  }
  if (!dbInstance) {
    dbInstance = drizzle(client);
  }
  
  return dbInstance;
}

// Export a proxy that lazily initializes the database
export const db = new Proxy({} as ReturnType<typeof drizzle>, {
  get(target, prop) {
    const db = getDb();
    const value = db[prop as keyof typeof db];
    if (typeof value === 'function') {
      return value.bind(db);
    }
    return value;
  }
});
