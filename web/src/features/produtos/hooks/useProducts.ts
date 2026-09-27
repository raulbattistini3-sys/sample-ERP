import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getProducts, getProductById, createProduct, updateProduct, deactivateProduct, deleteProduct } from "../api/product.api";

export const useProducts = () =>
  useQuery({ queryKey: ["products"], queryFn: getProducts });

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
