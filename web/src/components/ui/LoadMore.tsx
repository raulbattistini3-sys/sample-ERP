import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "./Button";

type LoadMoreProps = {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isFetchNextPageError: boolean;
  fetchNextPage: () => unknown;
};

// sits under a list and loads the next rows as it scrolls into view; a failure waits for a click
export function LoadMore({ hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage }: LoadMoreProps) {
  const sentinel = useRef<HTMLDivElement>(null);
  const armed = hasNextPage && !isFetchingNextPage && !isFetchNextPageError;

  useEffect(() => {
    if (!armed || !sentinel.current) return;
    const observer = new IntersectionObserver(([entry]) => entry.isIntersecting && fetchNextPage(), { rootMargin: "200px" });
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [armed, fetchNextPage]);

  if (!hasNextPage) return null;
  return (
    <div ref={sentinel} className="flex min-h-10 items-center justify-center py-4">
      {isFetchingNextPage && <Loader2 className="h-5 w-5 animate-spin text-muted" aria-label="Carregando mais" />}
      {isFetchNextPageError && (
        <Button variant="ghost" onClick={() => fetchNextPage()}>
          Tentar novamente
        </Button>
      )}
    </div>
  );
}
