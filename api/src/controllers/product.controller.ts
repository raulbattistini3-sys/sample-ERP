import { Request, Response, NextFunction } from "express";
import BaseController from "./base.controller";
import LoggerInterface from "../interfaces/logger_interfaces/logger_interface.interface";
import IProductService from "../interfaces/product_interfaces/product_service.interface";

class ProductController extends BaseController {
  constructor(
    private productService: IProductService,
    logger: LoggerInterface,
  ) {
    super(logger);
  }

  create = async (req: Request, res: Response, next: NextFunction) => {
    const result = await this.productService.createProduct(req.body);
    if (result.isLeft()) {
      return this.fail(req, next, result.value);
    }
    return res.status(201).json(result.value);
  };

  getById = async (req: Request, res: Response, next: NextFunction) => {
    const result = await this.productService.findProductById(req.params.id as string);
    if (result.isLeft()) {
      return this.fail(req, next, result.value);
    }
    return res.status(200).json(result.value);
  };

  getAll = async (req: Request, res: Response, next: NextFunction) => {
    const page = Number(req.query.page ?? 1);
    const amount = Number(req.query.amount ?? 20);
    const result = await this.productService.getProducts(page, amount);
    if (result.isLeft()) {
      return this.fail(req, next, result.value);
    }
    return res.status(200).json(result.value);
  };

  update = async (req: Request, res: Response, next: NextFunction) => {
    // the URL decides which product is updated, not the body
    const result = await this.productService.updateProduct({ ...req.body, id: req.params.id });
    if (result.isLeft()) {
      return this.fail(req, next, result.value);
    }
    return res.status(204).send(); // no body — matches Either<BaseAppError, null>
  };

  delete = async (req: Request, res: Response, next: NextFunction) => {
    const result = await this.productService.deleteProduct(req.params.id as string);
    if (result.isLeft()) {
      return this.fail(req, next, result.value);
    }
    return res.status(204).send();
  };

  deactivate = async (req: Request, res: Response, next: NextFunction) => {
    const result = await this.productService.deactivateProduct(req.params.id as string);
    if (result.isLeft()) {
      return this.fail(req, next, result.value);
    }
    return res.status(204).send();
  };

  getByFilter = async (req: Request, res: Response, next: NextFunction) => {
    const page = Number(req.query.page ?? 1);
    const amount = Number(req.query.amount ?? 20);

    const result = await this.productService.findProductsByFilter(page, amount, req.query);
    if (result.isLeft()) {
      return this.fail(req, next, result.value);
    }
    return res.status(200).json(result.value);
  };

  getToDownload = async (req: Request, res: Response, next: NextFunction) => {
    const page = Number(req.query.page ?? 1);
    const amount = Number(req.query.amount ?? 20);

    const result = await this.productService.findProductsToDownload(page, amount, req.query);
    if (result.isLeft()) {
      return this.fail(req, next, result.value);
    }
    return res.status(200).json(result.value);
  };

   archiveCategory: (id: string) => Promise<Either<BaseAppError, null>>;
}

export default ProductController;
