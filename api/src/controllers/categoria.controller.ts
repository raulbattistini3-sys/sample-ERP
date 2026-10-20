import { Request, Response, NextFunction } from "express";
import BaseController from "./base.controller";
import LoggerInterface from "../interfaces/logger_interfaces/logger_interface.interface";
import { ICategoryService } from "../interfaces/category_interfaces/categoria_service.interface";

class CategoriaController extends BaseController {
  constructor(
    private categoriaService: ICategoryService,
    logger: LoggerInterface,
  ) {
    super(logger);
  }

  create = async (req: Request, res: Response, next: NextFunction) => {
    const result = await this.categoriaService.createCategoria(req.body);
    if (result.isLeft()) {
      return this.fail(req, next, result.value);
    }
    return res.status(201).json(result.value);
  };

  getById = async (req: Request, res: Response, next: NextFunction) => {
    const result = await this.categoriaService.findCategoryById(req.params.id as string);
    if (result.isLeft()) {
      return this.fail(req, next, result.value);
    }
    return res.status(200).json(result.value);
  };

  getAll = async (req: Request, res: Response, next: NextFunction) => {
    const page = Number(req.query.page ?? 1);
    const amount = Number(req.query.amount ?? 20);
    const result = await this.categoriaService.getCategories(page, amount);
    if (result.isLeft()) {
      return this.fail(req, next, result.value);
    }
    return res.status(200).json(result.value);
  };

  update = async (req: Request, res: Response, next: NextFunction) => {
    const result = await this.categoriaService.updateCategory(req.body, req.user!.id);
    if (result.isLeft()) {
      return this.fail(req, next, result.value);
    }
    return res.status(204).send(); // no body — matches Either<BaseAppError, null>
  };

  delete = async (req: Request, res: Response, next: NextFunction) => {
    const result = await this.categoriaService.deleteCategory(req.params.id as string);
    if (result.isLeft()) {
      return this.fail(req, next, result.value);
    }
    return res.status(204).send();
  };

  archiveCategory = async (req: Request, res: Response, next: NextFunction) => {
    const result = await this.categoriaService.archiveCategory(req.params.id as string, req.user!.id);
    if (result.isLeft()) {
      return this.fail(req, next, result.value);
    }
    return res.status(200).json(result.value);
  };
}

export default CategoriaController;
