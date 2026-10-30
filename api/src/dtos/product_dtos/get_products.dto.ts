import { z } from "zod";
import { ProductResponseDto } from "./product_response.dto";
import { BaseMessageGet, BaseMessageGetOne } from "../global_get.dto";
import { FilterProdutoSchema } from "../../utils/schemas/produto.schema";

type ResponseGetProductDto = BaseMessageGetOne<ProductResponseDto>;

type ResponseGetProductsDto = BaseMessageGet<ProductResponseDto>;

// where a scroll stopped: the last row's position in the name, id order
type ProductCursor = { name: string; id: string };

// no totalItems: counting the table costs more than reading the page
type ResponseScrollProductsDto = { data: ProductResponseDto[]; pageSize: number; nextCursor: string | null };

// parsed /products/filter and /products/download query params
type ProductFilterDto = z.infer<typeof FilterProdutoSchema>;

type ResponseFindFilteredProductsDto = BaseMessageGet<ProductResponseDto>;

interface ResponseFindProductsToDownloadDto
   extends BaseMessageGet<ProductResponseDto> {
   // sum of valor_de_venda per categoria nome, over every filtered product (not just this page)
   aggregated_value: Record<string, number>;
}

export {
   ResponseGetProductsDto,
   ResponseScrollProductsDto,
   ProductCursor,
   ResponseGetProductDto,
   ProductFilterDto,
   ResponseFindFilteredProductsDto,
   ResponseFindProductsToDownloadDto,
};
