import { useEffect } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ListResponse } from "../lib/api-client";
import { lastPageOf, LIST_PAGE_SIZE, parsePage } from "../lib/pagination";

type ListState = { listSearch?: string };

// the current list page lives in ?page= so refresh, back/forward and shared links keep it
export const useListPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const page = parsePage(searchParams.get("page"));

  // page 1 is the bare URL; replace skips the history entry for automatic corrections
  const setPage = (next: number, replace = false) =>
    setSearchParams(next > 1 ? { page: String(next) } : {}, { replace });

  // the form/detail page uses this to send the user back to the same ?page=
  const openItem = (path: string) => navigate(path, { state: { listSearch: location.search } satisfies ListState });

  return { page, setPage, openItem };
};

// steps back when the current page empties out (e.g. its last row was deleted)
export const useClampPage = (
  page: number,
  setPage: (page: number, replace?: boolean) => void,
  data: ListResponse<unknown> | undefined,
  isPlaceholderData: boolean,
  pageSize = LIST_PAGE_SIZE,
) => {
  const lastPage = data ? lastPageOf(data.totalItems, pageSize) : 1;
  useEffect(() => {
    if (data && !isPlaceholderData && page > lastPage) setPage(lastPage, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setPage is recreated each render
  }, [data, isPlaceholderData, page, lastPage]);
};

// for form/detail pages: returns to the list on the page the user came from
export const useBackToList = (listPath: string) => {
  const navigate = useNavigate();
  const location = useLocation();
  const listSearch = (location.state as ListState | null)?.listSearch ?? "";
  return () => navigate(`${listPath}${listSearch}`);
};
