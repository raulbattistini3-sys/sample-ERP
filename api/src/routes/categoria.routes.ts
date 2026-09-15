import { Router } from "express";
import CategoriaController from "../controllers/categoria.controller";
import { CategoriaService } from "../services/categoria.service";
import CategoriaRepository from "../repositories/categoria.repository";
import CategoriaValidator from "../validators/categoria.validator";
import postgresConnection from "../db/postgres_connection";

const categoriaRepository = new CategoriaRepository(postgresConnection);
const categoriaValidator = new CategoriaValidator();

const categoriaService = new CategoriaService(
  categoriaRepository,
  categoriaValidator,
);

const categoriaController = new CategoriaController(categoriaService);

const categoriaRoutes = Router();


categoriaRoutes.post("/", categoriaController.create);
categoriaRoutes.get("/", categoriaController.getAll);
categoriaRoutes.get("/:id", categoriaController.getById);
categoriaRoutes.put("/:id", categoriaController.update);
categoriaRoutes.delete("/:id", categoriaController.delete);
categoriaRoutes.patch("/:id/archive", categoriaController.archiveCategory);

export { categoriaRoutes };
