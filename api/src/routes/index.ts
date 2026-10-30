import { Router } from "express";
import { auditoriaRoutes } from "./auditoria.routes";
import { productRoutes } from "./product.routes";
import { detalhamentoAuditoriaRoutes } from "./detalhamento_auditoria.routes";
import { publicUsuarioRoutes, usuarioRoutes } from "./usuario.routes";
import { categoriaRoutes } from "./categoria.routes";
import { authMiddleware } from "./auth_middleware.instance";
import { integracaoRoutes, publicIntegracaoRoutes } from "./integracao.routes";
import { clienteRoutes } from "./cliente.routes";
import { billingRoutes } from "./billing.routes";
const router = Router();

// POST /user/register and /user/login
router.use("/user", publicUsuarioRoutes);
// OAuth callbacks: the provider redirects the browser here without our token
router.use("/integracoes", publicIntegracaoRoutes);
// the billing service, with its own internal token
router.use("/internal/billing", billingRoutes);

// everything below requires a valid token from an active usuario
router.use(authMiddleware.authenticate);

router.use("/user", usuarioRoutes);
router.use("/auditoria", auditoriaRoutes);
router.use("/products", productRoutes);
router.use("/categorias", categoriaRoutes);
router.use("/detalhamento-auditoria", detalhamentoAuditoriaRoutes);
router.use("/integracoes", integracaoRoutes);
router.use("/clientes", clienteRoutes);

export default router;
