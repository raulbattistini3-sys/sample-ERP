import { Router } from "express";
import { auditoriaRoutes } from "./auditoria.routes";
import { productRoutes } from "./product.routes";
import { detalhamentoAuditoriaRoutes } from "./detalhamento_auditoria.routes";
import { usuarioRoutes } from "./usuario.routes";

const router = Router();

router.use("/user", usuarioRoutes);
router.use("/auditoria", auditoriaRoutes);
router.use("/products", productRoutes);
router.use("/detalhamento-auditoria", detalhamentoAuditoriaRoutes);
router.use("/auditoria", auditoriaRoutes);

export default router;
