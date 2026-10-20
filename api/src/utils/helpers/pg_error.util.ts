// Postgres SQLSTATE of a failed query; Drizzle wraps the driver error in `cause`
export const pgErrorCode = (error: unknown): string | undefined => {
   let current: unknown = error;
   while (current && typeof current === "object") {
      const code = (current as { code?: unknown }).code;
      if (typeof code === "string") return code;
      current = (current as { cause?: unknown }).cause;
   }
   return undefined;
};
