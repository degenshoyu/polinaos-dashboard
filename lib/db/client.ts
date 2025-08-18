// lib/db/client.ts
// Server-only Drizzle client for Vercel Postgres
import { drizzle } from "drizzle-orm/vercel-postgres";
import { sql } from "@vercel/postgres";
import * as schema from "./schema";

export const db = drizzle(sql, { schema });

// Helper to run raw SQL if ever needed:
// export const $ = sql;
