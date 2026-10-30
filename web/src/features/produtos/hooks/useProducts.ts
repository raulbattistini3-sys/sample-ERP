import { keepPreviousData, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { LIST_PAGE_SIZE } from "../../../lib/pagination";
import { downloadTextFile } from "../../../lib/csv";
import { fetchProductsForDownload, productsFileName, productsToCsv } from "../utils/productsSpreadsheet";
import {
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deactivateProduct,
  deleteProduct,
  importProducts,
  startProductImport,
  getProductImport,
  isProductImportFinished,
} from "../api/product.api";

const IMPORT_POLL_MS = 1000;

// keeps the current page on screen while the next one loads
export const useProducts = (page = 1, amount = LIST_PAGE_SIZE) =>
  useQuery({
    queryKey: ["products", "list", page, amount],
    queryFn: () => getProducts(page, amount),
    placeholderData: keepPreviousData,
  });

export const useProduct = (id: string) =>
  useQuery({ queryKey: ["products", id], queryFn: () => getProductById(id), enabled: !!id });

export const useCreateProduct = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createProduct,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["products"] }),
  });
};

export const useUpdateProduct = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateProduct,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["products"] }),
  });
};

export const useDeactivateProduct = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deactivateProduct,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["products"] }),
  });
};

export const useDeleteProduct = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteProduct,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["products"] }),
  });
};

// fetches every product the signed-in user can see and saves them as a spreadsheet (CSV)
export const useDownloadProducts = () =>
  useMutation({
    mutationFn: async () => {
      const { products, totals } = await fetchProductsForDownload();
      downloadTextFile(productsFileName(), productsToCsv(products, totals));
    },
  });

export const useImportProducts = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: importProducts,
    onSuccess: (result) => {
      if (result.errors.length === 0) queryClient.invalidateQueries({ queryKey: ["products"] });
    },
  });
};

// hands the chosen file to the importer; the result comes from useProductImport
export const useStartProductImport = () => useMutation({ mutationFn: startProductImport });

// polls an import every second until it is concluida, rejeitada or falhou; a concluded one refreshes
// the product lists
export const useProductImport = (id: string | undefined) => {
  const queryClient = useQueryClient();
  return useQuery({
    // outside ["products"]: invalidating the lists must not refetch this query (and invalidate them again)
    queryKey: ["product-imports", id],
    queryFn: async () => {
      const importacao = await getProductImport(id!);
      if (importacao.status === "concluida") queryClient.invalidateQueries({ queryKey: ["products"] });
      return importacao;
    },
    enabled: !!id,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && isProductImportFinished(status) ? false : IMPORT_POLL_MS;
    },
  });
};
