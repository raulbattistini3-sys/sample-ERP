import type { Server } from "node:http";

// How many ports past the configured one a development server tries before giving up.
export const MAX_PORT_ATTEMPTS = 20;

const PORT_TAKEN = new Set(["EADDRINUSE", "EACCES"]);

type ListenOptions = {
   host: string;
   port: number;
   // only in development: production must bind the port it was given (the platform routes to it)
   fallback: boolean;
   log: (message: string) => void;
};

// Binds `server` to options.port. In development, when that port is taken (another API, a stale process,
// a Windows reserved range), it tries the next one, up to MAX_PORT_ATTEMPTS, and logs each move. Resolves
// with the port actually bound; rejects with the bind error otherwise.
export function listenWithFallback(server: Server, { host, port, fallback, log }: ListenOptions): Promise<number> {
   return new Promise((resolve, reject) => {
      let attempt = port;
      const tryListen = () => {
         const onError = (error: NodeJS.ErrnoException) => {
            server.off("listening", onListening);
            const next = attempt + 1;
            if (fallback && PORT_TAKEN.has(error.code ?? "") && next <= 65535 && next - port < MAX_PORT_ATTEMPTS) {
               log(`[dev] port ${attempt} on ${host} is unavailable (${error.code}); trying ${next}`);
               attempt = next;
               tryListen();
               return;
            }
            reject(error);
         };
         const onListening = () => {
            server.off("error", onError);
            if (attempt !== port) {
               log(`[dev] port ${port} was unavailable; listening on ${attempt} instead. Point the web's VITE_API_URL (and the launcher) at it.`);
            }
            resolve(attempt);
         };
         server.once("error", onError);
         server.once("listening", onListening);
         server.listen(attempt, host);
      };
      tryListen();
   });
}
