import { BaseAppError } from "../../errors/global_error.error";

export type SerializedError = {
   name: string;
   message: string;
   code?: string;
   detail?: string;
   constraint?: string;
   table?: string;
   column?: string;
   statusCode?: string;
   status?: string;
   isOperational?: boolean;
   stack?: string;
   cause?: SerializedError;
};

// guards against cyclic or absurdly deep cause chains
const MAX_CAUSE_DEPTH = 5;

// what pg's DatabaseError exposes about a failed statement (e.g. 23505 + users_email_unique)
const DRIVER_FIELDS = ["code", "detail", "constraint", "table", "column"] as const;

// DrizzleQueryError's message embeds the bound params (emails, password hashes, ...); keep only the SQL
const describe = (error: Error) => {
   const { query, params } = error as { query?: unknown; params?: unknown };
   if (typeof query === "string" && Array.isArray(params)) {
      return `Failed query: ${query}`;
   }
   return error.message;
};

// flattens an error and the chain of lower-layer errors it wraps into plain JSON for the logger
const serializeError = (error: unknown, depth = 0): SerializedError => {
   if (!(error instanceof Error)) {
      return { name: typeof error, message: String(error) };
   }

   const serialized: SerializedError = {
      // libraries often leave name as "Error"; the class name says more (e.g. DrizzleQueryError)
      name: error.name.toLowerCase() === "error" ? error.constructor.name : error.name,
      message: describe(error),
      stack: error.stack,
   };

   for (const field of DRIVER_FIELDS) {
      const value = (error as Partial<Record<typeof field, unknown>>)[field];
      if (typeof value === "string") serialized[field] = value;
   }

   if (error instanceof BaseAppError) {
      serialized.statusCode = error.statusCode;
      serialized.status = error.status;
      serialized.isOperational = error.isOperational;
   }

   // follows both our own `cause` and library ones (DrizzleQueryError -> pg DatabaseError)
   const cause = (error as { cause?: unknown }).cause;
   if (cause !== undefined && depth < MAX_CAUSE_DEPTH) {
      serialized.cause = serializeError(cause, depth + 1);
   }

   return serialized;
};

export default serializeError;
