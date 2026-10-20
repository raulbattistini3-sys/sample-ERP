import { CreateProductDto } from "./create_product.dto";

// PUT /products/:id body (snake_case, like create); id comes from the URL
type PayloadUpdateProductDto = CreateProductDto & {
   id: string;
   ativo?: boolean;
};

export { PayloadUpdateProductDto };
