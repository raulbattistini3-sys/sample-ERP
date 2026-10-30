// rows per page on every list screen
export const LIST_PAGE_SIZE = 20;

// rows per load on the lazy lists; the API caches the first load of exactly this size
export const LAZY_PAGE_SIZE = 30;

// the next page of a lazy list, undefined once every row is loaded
export const nextLazyPage = <T extends { totalItems: number }>(lastPage: T, pages: T[]) =>
  pages.length * LAZY_PAGE_SIZE < lastPage.totalItems ? pages.length + 1 : undefined;

// for dropdowns and lookups that need every row in one request (the API pages every list)
export const ALL_ITEMS_AMOUNT = 1000;

// anything missing, non-numeric or below 1 falls back to the first page
export const parsePage = (value: string | null) => {
  const page = Number(value);
  return Number.isInteger(page) && page >= 1 ? page : 1;
};

export const lastPageOf = (totalItems: number, pageSize: number) => Math.max(1, Math.ceil(totalItems / pageSize));
