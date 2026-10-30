import { StackMemoryCache } from "./stack-cache";
import { Either, right } from "../../globals/errors/left_right_either.error";

// the lists load this many rows at a time; only the first load is cached
export const FIRST_PAGE_SIZE = 30;
// rolling: every hit starts the 30 minutes again
const TTL_MS = 30 * 60 * 1000;

type Entry = { stack: StackMemoryCache; offset: number; expiresAt: number };

// The first page of one list, per session and only in this process's memory. StackMemoryCache only
// appends, so each session gets its own and a new page replaces the old one.
class FirstPageCache<T> {
  private readonly sessions = new Map<string, Entry>();
  private version = 0;

  constructor(private readonly sizeInBytes: number) {}

  async read<E>(session: string, cacheable: boolean, load: () => Promise<Either<E, T>>): Promise<Either<E, T>> {
    if (!cacheable) return load();
    this.sweep();
    const cached = this.get(session);
    if (cached) return right(cached);
    const version = this.version;
    const result = await load();
    // a clear() during the load means this result may already be out of date
    if (result.isRight() && version === this.version) this.set(session, result.value);
    return result;
  }

  // every session's copy: a write in one has to show up in the others
  clear() {
    this.version += 1;
    this.sessions.clear();
  }

  private sweep() {
    const now = Date.now();
    for (const [session, { expiresAt }] of this.sessions) {
      if (now >= expiresAt) this.sessions.delete(session);
    }
  }

  private get(session: string): T | null {
    const entry = this.sessions.get(session);
    if (!entry) return null;
    entry.expiresAt = Date.now() + TTL_MS;
    return entry.stack.peekAt(entry.offset).value as T;
  }

  private set(session: string, value: T) {
    const stack = new StackMemoryCache(this.sizeInBytes);
    try {
      this.sessions.set(session, { stack, offset: stack.push(value, "json"), expiresAt: Date.now() + TTL_MS });
    } catch {
      // bigger than the buffer: the list just keeps loading from its source
    }
  }
}

export default FirstPageCache;
