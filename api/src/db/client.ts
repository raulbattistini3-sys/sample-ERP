// The database handle repositories receive (Config.getDb(), or a transaction inside it).
// The tables in ./schema are declared with drizzle's mysql-core builders while the app runs on
// Postgres, so they don't type-check against NodePgDatabase; until the schema moves to pg-core the
// handle stays untyped. Queries are the same at runtime either way.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DrizzleDB = any;
