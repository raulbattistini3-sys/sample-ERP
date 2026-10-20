import { keepPreviousData, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { LIST_PAGE_SIZE } from "../../../lib/pagination";
import { getProducts, getProductById, createProduct, updateProduct, deactivateProduct, deleteProduct } from "../api/product.api";

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
