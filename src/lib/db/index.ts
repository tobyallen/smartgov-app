import { drizzle } from 'drizzle-orm/neon-serverless';
import * as schema from './schema';

// Use the Neon POOLED connection string here, not the direct one — this
// workload is 100 concurrent short-lived serverless invocations, exactly
// the case connection pooling exists for.
export const db = drizzle(process.env.DATABASE_URL!, { schema });
