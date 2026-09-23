import { Router } from "express";
import Config from "../configs/app_config";
import ProductController from "../controllers/product.controller";
import ProductService from "../services/product.service";
import ProductRepository from "../repositories/product.repository";
import CategoriaRepository from "../repositories/categoria.repository";
import ProdutoValidator from "../validators/produto.validator";
import CategoriaValidator from "../validators/categoria.validator";


const config = Config.getInstance();
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

const productController = new ProductController(productService);

const productRoutes = Router();

productRoutes.get("/filter", productController.getByFilter);
productRoutes.get("/download", productController.getToDownload);

productRoutes.post("/", productController.create);
productRoutes.get("/", productController.getAll);
productRoutes.get("/:id", productController.getById);
productRoutes.put("/:id", productController.update);
productRoutes.delete("/:id", productController.delete);
productRoutes.patch("/:id/deactivate", productController.deactivate);

export { productRoutes };
