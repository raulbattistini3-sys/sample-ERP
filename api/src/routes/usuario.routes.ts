import { Router } from "express";
import UsuarioController from "../controllers/usuario.controller";
import UsuarioService from "../services/usuario.service";
import UsuarioRepository from "../repositories/usuario.repository";
import UsuarioValidator from "../validators/usuario.validator";
import { db } from "../db/client";
const usuarioRepository = new UsuarioRepository(db);

const usuarioValidator = new UsuarioValidator();

const usuarioService = new UsuarioService(usuarioRepository, usuarioValidator);

const usuarioController = new UsuarioController(usuarioService);

const usuarioRoutes = Router();

// auth routes — no :id, must come before or independent of /:id anyway since path differs
usuarioRoutes.post("/register", usuarioController.register);
usuarioRoutes.post("/login", usuarioController.login);

usuarioRoutes.post("/", usuarioController.create);
usuarioRoutes.get("/", usuarioController.getAll);
usuarioRoutes.get("/:id", usuarioController.getById);
usuarioRoutes.put("/:id", usuarioController.update);
usuarioRoutes.delete("/:id", usuarioController.delete);
usuarioRoutes.patch("/:id/archive", usuarioController.archive);

export { usuarioRoutes };
