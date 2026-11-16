// The compiled executable's entry point (bun build --compile src/entry.ts → api.exe). One executable, two
// processes: API_ROLE=worker runs the pg-boss consumers (src/worker.ts) without HTTP; anything else is the
// API (src/index.ts; API_ROLE=api leaves the consumers to that worker process). The launcher / polyvisor
// start api.exe twice, each in its own job object with its own memory limit, so the jobs' allocations never
// count against the API's heap or its limit.
const role = (process.env.API_ROLE ?? "").trim().toLowerCase();
void (role === "worker" ? import("./worker") : import("./index"));
