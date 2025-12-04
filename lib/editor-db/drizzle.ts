import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

// Use FLYR's Supabase database connection
// DATABASE_URL should be set in .env.local with format:
// postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL must be set in .env.local. Get it from Supabase Dashboard > Settings > Database > Connection string (URI)");
}

const client = postgres(connectionString);
export const db = drizzle(client);

