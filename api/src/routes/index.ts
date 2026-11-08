import { Router } from "express";
import { auditoriaRoutes } from "./auditoria.routes";
import { productRoutes } from "./product.routes";
import { detalhamentoAuditoriaRoutes } from "./detalhamento_auditoria.routes";
import { publicUsuarioRoutes, sessionUsuarioRoutes, usuarioRoutes } from "./usuario.routes";
import { categoriaRoutes } from "./categoria.routes";
import { authMiddleware } from "./auth_middleware.instance";
import { integracaoRoutes, publicIntegracaoRoutes } from "./integracao.routes";
import { clienteRoutes } from "./cliente.routes";
import { billingRoutes } from "./billing.routes";
import { cobrancaRoutes, stripeRoutes } from "./cobranca.routes";
import { databaseConnection } from "../configs/database_connection";
import { telemetryRoutes } from "./telemetry.routes";
const router = Router();

// POST /user/register and /user/login
router.use("/user", publicUsuarioRoutes);
// OAuth callbacks: the provider redirects the browser here without our token
router.use("/integracoes", publicIntegracaoRoutes);
// the billing service, with its own internal token
router.use("/internal/billing", billingRoutes);

// everything below requires a valid token from an active usuario
router.use(authMiddleware.authenticate);

// refresh-token and change-password; the only routes open to a usuario that must change its senha
router.use("/user", sessionUsuarioRoutes);
router.use(authMiddleware.requirePasswordChanged);

router.use("/user", usuarioRoutes);
router.use("/auditoria", auditoriaRoutes);
router.use("/products", productRoutes);
router.use("/categorias", categoriaRoutes);
router.use("/detalhamento-auditoria", detalhamentoAuditoriaRoutes);
// before the generic /integracoes/:provider routes
router.use("/integracoes/stripe", stripeRoutes);
router.use("/integracoes", integracaoRoutes);
router.use("/clientes", clienteRoutes);
router.use("/cobrancas", cobrancaRoutes);
router.use("/telemetry", telemetryRoutes);

// the web's "Gerar dados fictícios" buttons; never mounted in production, so those requests are a 404.
// Required lazily, so a production API doesn't even load the module.
if (databaseConnection().apiEnv === "development") {
   // eslint-disable-next-line @typescript-eslint/no-require-imports
   router.use("/dev/fake-data", require("../fake_data/fake_data.routes").fakeDataRoutes);
}

export default router;
