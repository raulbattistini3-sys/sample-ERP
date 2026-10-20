import { BaseAppError } from "../../errors/global_error.error";

export type SerializedError = {
   name: string;
   message: string;
   code?: string;
   statusCode?: string;
   status?: string;
   isOperational?: boolean;
   stack?: string;
   cause?: SerializedError;
};

// guards against cyclic or absurdly deep cause chains
const MAX_CAUSE_DEPTH = 5;

// flattens an error and the chain of lower-layer errors it wraps into plain JSON for the logger
const serializeError = (error: unknown, depth = 0): SerializedError => {
   if (!(error instanceof Error)) {
      return { name: typeof error, message: String(error) };
   }

   const serialized: SerializedError = {
      name: error.name,
      message: error.message,
      stack: error.stack,
   };

   // driver errors (e.g. pg) carry a machine-readable code such as 42P01 or 23505
   const code = (error as { code?: unknown }).code;
   if (typeof code === "string") serialized.code = code;

   if (error instanceof BaseAppError) {
      serialized.statusCode = error.statusCode;
      serialized.status = error.status;
      serialized.isOperational = error.isOperational;
      if (error.cause !== undefined && depth < MAX_CAUSE_DEPTH) {
         serialized.cause = serializeError(error.cause, depth + 1);
      }
   }

   return serialized;
};

export default serializeError;
