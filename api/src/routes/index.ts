import { Router } from "express";
import { auditoriaRoutes } from "./auditoria.routes";
import { productRoutes } from "./product.routes";
import { detalhamentoAuditoriaRoutes } from "./detalhamento_auditoria.routes";
import { publicUsuarioRoutes, usuarioRoutes } from "./usuario.routes";
import { categoriaRoutes } from "./categoria.routes";
import { authMiddleware } from "./auth_middleware.instance";
const router = Router();

// POST /user/register and /user/login
router.use("/user", publicUsuarioRoutes);

// everything below requires a valid token from an active usuario
router.use(authMiddleware.authenticate);

router.use("/user", usuarioRoutes);
router.use("/auditoria", auditoriaRoutes);
router.use("/products", productRoutes);
router.use("/categorias", categoriaRoutes);
router.use("/detalhamento-auditoria", detalhamentoAuditoriaRoutes);

export default router;
