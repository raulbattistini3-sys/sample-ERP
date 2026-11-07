import { Router } from "express";
import { z } from "zod";
import { recordWebEvents, telemetryEnabled } from "../utils/telemetry/telemetry";

// POST /telemetry: batches from the web's telemetry bus (pkg/telemetry fetchExporter): which thread ran a
// search, how long it took, long animation frames. Signed-in users only (mounted after authenticate).
// Timings only, never row data; anything not shaped like an event is a 400.

const EventSchema = z.object({
   source: z.string().min(1).max(64),
   type: z.string().min(1).max(64),
   ts: z.number().finite(),
   data: z.record(z.string(), z.unknown()),
});
// fetch keepalive caps a request at 64 KB, so the web sends small batches; this is the ceiling
const BatchSchema = z.array(EventSchema).min(1).max(200);

const telemetryRoutes = Router();

telemetryRoutes.post("/", (req, res) => {
   const batch = BatchSchema.safeParse(req.body);
   if (!batch.success) {
      return res.status(400).json({ message: "Lote de telemetria inválido." });
   }
   recordWebEvents(req.user!.id, batch.data);
   // 204 even when TELEMETRY_DIR is unset: the web can't do anything about it, and shouldn't retry
   res.setHeader("X-Telemetry", telemetryEnabled ? "stored" : "dropped");
   return res.status(204).end();
});

export { telemetryRoutes };
