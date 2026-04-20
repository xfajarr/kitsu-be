import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

const connectionString = process.env.DATABASE_URL || 'postgresql://localhost:5432/kitsu';

// For queries
export const client = postgres(connectionString);

// Drizzle ORM instance
export const db = drizzle(client, { schema });

// Raw query helper for health checks
export const executeRaw = async (sql: string) => {
  return client.unsafe(sql);
};

export * from './schema.js';
