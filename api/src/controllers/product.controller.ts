import { Request, Response, NextFunction } from "express";
import { FindFilteredProductsPayloadDto } from "../dtos/product_dtos/get_products.dto";
import IProductService from "../interfaces/product_interfaces/product_service.interface";

class ProductController {
  constructor(private productService: IProductService) {}

  create = async (req: Request, res: Response, next: NextFunction) => {
    const result = await this.productService.createProduct(req.body);
    if (result.isLeft()) {
      return next(result.value); 
    }
    return res.status(201).json(result.value);
  };

  getById = async (req: Request, res: Response, next: NextFunction) => {
    const result = await this.productService.findProductById(req.params.id as string);
    if (result.isLeft()) {
      return next(result.value);
    }
    return res.status(200).json(result.value);
  };

  getAll = async (req: Request, res: Response, next: NextFunction) => {
    const page = Number(req.query.page ?? 1);
    const amount = Number(req.query.amount ?? 20);
    const result = await this.productService.getProducts(page, amount);
    if (result.isLeft()) {
      return next(result.value);
    }
    return res.status(200).json(result.value);
  };

  update = async (req: Request, res: Response, next: NextFunction) => {
    const result = await this.productService.updateProduct(req.body);
    if (result.isLeft()) {
      return next(result.value);
    }
    return res.status(204).send(); // no body — matches Either<BaseAppError, null>
  };

  delete = async (req: Request, res: Response, next: NextFunction) => {
    const result = await this.productService.deleteProduct(req.params.id as string);
    if (result.isLeft()) {
      return next(result.value);
    }
    return res.status(204).send();
  };

  deactivate = async (req: Request, res: Response, next: NextFunction) => {
    const result = await this.productService.deactivateProduct(req.params.id as string);
    if (result.isLeft()) {
      return next(result.value);
    }
    return res.status(204).send();
  };

  getByFilter = async (req: Request, res: Response, next: NextFunction) => {
    const amount = Number(req.query.amount ?? 20);
    const includeParams = req.query as unknown as FindFilteredProductsPayloadDto;

    const result = await this.productService.findProductsByFilter(amount, includeParams);
    if (result.isLeft()) {
      return next(result.value);
    }
    return res.status(200).json(result.value);
  };

  getToDownload = async (req: Request, res: Response, next: NextFunction) => {
    const page = Number(req.query.page ?? 1);
    const amount = Number(req.query.amount ?? 20);
    const includeParams = req.query as unknown as FindFilteredProductsPayloadDto;

    const result = await this.productService.findProductsToDownload(amount, page, includeParams);
    if (result.isLeft()) {
      return next(result.value);
    }
    return res.status(200).json(result.value);
  };

   archiveCategory: (id: string) => Promise<Either<BaseAppError, null>>;
}

export default ProductController;
