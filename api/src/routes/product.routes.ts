import { Router } from "express";
import AppLogger from "../utils/logger/pino_logger.util";
import Config from "../configs/app_config";
import ProductController from "../controllers/product.controller";
import ProductService from "../services/product.service";
import ProductRepository from "../repositories/product.repository";
import CategoriaRepository from "../repositories/categoria.repository";
import ProdutoValidator from "../validators/produto.validator";
import CategoriaValidator from "../validators/categoria.validator";
import { authMiddleware } from "./auth_middleware.instance";
import ImportacaoController from "../controllers/importacao.controller";
import { ImportacaoService } from "../services/importacao.service";
import GrpcImportadorClient from "../integrations/importador/importador.client";
import { uploadPlanilha } from "../middlewares/upload.middleware";


const config = Config.getInstance();
const logger = AppLogger.getInstance();
const  db = config.getDb();
const productRepository = new ProductRepository(db);
const categoriaRepository = new CategoriaRepository(db);
const produtoValidator = new ProdutoValidator();
const categoriaValidator = new CategoriaValidator();

const productService = new ProductService(
  productRepository,
  categoriaRepository,
  produtoValidator,
  categoriaValidator,
);

const productController = new ProductController(productService, logger);

// closed on shutdown by index.ts
export const importadorClient = new GrpcImportadorClient();
const importacaoController = new ImportacaoController(new ImportacaoService(importadorClient), logger);

const productRoutes = Router();

productRoutes.get("/filter", productController.getByFilter);
productRoutes.get("/download", productController.getToDownload);
// bulk create/update from a spreadsheet: ADM and SU only. /imports hands the file to the Go importer
// (202, then poll /imports/:id); /import takes the rows the web already read and answers at once,
// and is what the web falls back to when /imports answers 503 (no importer configured or reachable)
productRoutes.post("/imports", authMiddleware.requireAdminRole, uploadPlanilha, importacaoController.start);
productRoutes.get("/imports/:id", authMiddleware.requireAdminRole, importacaoController.getById);
productRoutes.post("/import", authMiddleware.requireAdminRole, productController.importSpreadsheet);

productRoutes.post("/", productController.create);
productRoutes.get("/", productController.getAll);
productRoutes.get("/:id", productController.getById);
productRoutes.put("/:id", productController.update);
productRoutes.delete("/:id", productController.delete);
productRoutes.patch("/:id/deactivate", productController.deactivate);

export { productRoutes };
