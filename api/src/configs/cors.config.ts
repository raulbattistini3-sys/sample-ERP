import "dotenv/config";
import { CorsOptions } from "cors";

// comma-separated, e.g. CORS_ORIGINS=http://localhost:5173,https://erp.example.com
const DEFAULT_ORIGINS = ["http://localhost:5173"];

export const allowedOrigins = (process.env.CORS_ORIGINS ?? "")
   .split(",")
   .map((origin) => origin.trim().replace(/\/$/, ""))
   .filter(Boolean);

const origins = allowedOrigins.length > 0 ? allowedOrigins : DEFAULT_ORIGINS;

// browsers only get CORS headers for the listed origins, so pages anywhere else can't read responses.
// Requests without an Origin header (curl, server-to-server) aren't browser cross-origin calls and pass;
// AuthMiddleware still guards them.
export const corsOptions: CorsOptions = {
   origin: (origin, callback) => callback(null, !origin || origins.includes(origin)),
   methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
   allowedHeaders: ["Content-Type", "Authorization"],
   maxAge: 600, // cache preflights for 10 minutes
};
