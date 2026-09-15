// routes/index.ts
import { Router } from "express";
import { auditoriaRoutes } from "./auditoria.routes";
import { productRoutes } from "./product.routes";

const router = Router();

router.use("/auditoria", auditoriaRoutes);
router.use("/products", productRoutes);

export default router;
