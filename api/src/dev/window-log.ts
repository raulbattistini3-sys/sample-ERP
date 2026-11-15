import { createReadStream, createWriteStream, mkdirSync, rmSync, type WriteStream } from "node:fs";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";

// A child's output kept in files instead of the terminal, one file per fixed 5-minute window
// (<dir>/<name>-YYYYMMDD-HHMM.log, local time, aligned to :00, :05, ...). When a window closes its file is
// gzipped to .log.gz and the plain one removed. Used for the TCC, whose server + dashboard output would
// otherwise drown the stack's own lines.

export const WINDOW_MS = 5 * 60 * 1000;

const pad = (n: number) => String(n).padStart(2, "0");

function windowName(name: string, start: number): string {
   const d = new Date(start);
   return `${name}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.log`;
}

async function gzipAndRemove(file: string) {
   try {
      await pipeline(createReadStream(file), createGzip(), createWriteStream(`${file}.gz`));
      rmSync(file, { force: true });
   } catch (err) {
      console.warn(`[api] could not compress ${file}: ${(err as Error).message}`);
   }
}

export class WindowLog {
   private out: WriteStream | null = null;
   private file = "";
   private windowStart = 0;
   private readonly pending: Promise<void>[] = [];

   constructor(
      readonly dir: string,
      readonly name: string,
   ) {
      mkdirSync(dir, { recursive: true });
   }

   write(line: string) {
      const now = Date.now();
      const start = now - (now % WINDOW_MS);
      if (start !== this.windowStart) this.rotate(start);
      this.out!.write(`${new Date(now).toISOString()} ${line}\n`);
   }

   private rotate(start: number) {
      this.closeCurrent();
      this.windowStart = start;
      this.file = join(this.dir, windowName(this.name, start));
      this.out = createWriteStream(this.file, { flags: "a" });
   }

   private closeCurrent() {
      if (!this.out) return;
      const file = this.file;
      const out = this.out;
      this.out = null;
      this.pending.push(new Promise<void>((done) => out.end(done)).then(() => gzipAndRemove(file)));
   }

   /** closes and compresses the current window; waits for every compression still running */
   async close() {
      this.closeCurrent();
      await Promise.all(this.pending);
   }
}
