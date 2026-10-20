import { Categoria } from "../../entities/categoria.entity";
import { ProductResponseDto } from "./product_response.dto";
import { ProductEntity } from "../../entities/product.entity";
import { BaseMessageGet, BaseMessageGetOne } from "../global_get.dto";

interface MessageGetUniqueProduct<T> extends BaseMessageGetOne<T> {
   message: string;
   status: boolean;
   data: T;
}

type ResponseGetProductDto = BaseMessageGetOne<ProductResponseDto>;

type ResponseGetProductsDto = BaseMessageGet<ProductResponseDto>;

type FindFilteredProductsPayloadDto = Partial<
   Omit<ProductEntity, "categoria" & { categoria: Pick<Categoria, "nome"> }>
>;

type ResponseFindFilteredProductsDto = BaseMessageGet<
   Omit<ProductEntity, "id">
>;

interface ResponseFindProductsToDownloadDto<ProductEntity>
   extends BaseMessageGet<ProductEntity> {
   aggregated_value: Map<Categoria, number>;
}

export {
   ResponseGetProductsDto,
   ResponseGetProductDto,
   FindFilteredProductsPayloadDto,
   ResponseFindFilteredProductsDto,
   ResponseFindProductsToDownloadDto,
};
