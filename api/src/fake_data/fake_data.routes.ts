import { NextFunction, Request, Response, Router } from "express";
import { Pool } from "pg";
import { z } from "zod";
import Config from "../configs/app_config";
import { databaseConnection } from "../configs/database_connection";
import ProductService from "../services/product.service";
import ProductRepository from "../repositories/product.repository";
import CategoriaRepository from "../repositories/categoria.repository";
import ProdutoValidator from "../validators/produto.validator";
import CategoriaValidator from "../validators/categoria.validator";
import { ValidationError } from "../errors/client_errors/four_xx.error";
import { authMiddleware } from "../routes/auth_middleware.instance";
import FakeDataService from "./fake_data.service";

// /dev/fake-data: the web's "Gerar dados fictícios" buttons. routes/index.ts mounts it only with
// API_ENV=development, so a production API answers 404 here and the web hides the buttons.
//
//   GET  /dev/fake-data              200 when available (the web's visibility check)
//   POST /dev/fake-data/produtos     { quantidade?: 1-20000, default 500 }
//   POST /dev/fake-data/usuarios     { quantidade?: 1-200, default 5 }  password senha123
//   POST /dev/fake-data/categorias   creates whichever of the ten fixed categorias are missing
//   POST /dev/fake-data/auditorias   { quantidade?: 1-200, default 10 } edits N products and restores them

const db = Config.getInstance().getDb();
const productRepository = new ProductRepository(db);
const service = new FakeDataService(
   // its own small pool for the bulk inserts, with the API's TLS rules
   new Pool({ ...databaseConnection(), max: 2 }),
   new ProductService(productRepository, new CategoriaRepository(db), new ProdutoValidator(), new CategoriaValidator()),
   productRepository,
);

const quantidade = (padrao: number, maximo: number) =>
   z.object({
      quantidade: z.coerce
         .number({ invalid_type_error: "quantidade deve ser um número" })
         .int("quantidade deve ser inteira")
         .min(1, "quantidade deve ser pelo menos 1")
         .max(maximo, `quantidade deve ser no máximo ${maximo}`)
         .default(padrao),
   });

const lerQuantidade = (req: Request, padrao: number, maximo: number) => {
   const parsed = quantidade(padrao, maximo).safeParse(req.body ?? {});
   if (!parsed.success) throw new ValidationError("400", parsed.error.errors.map((e) => e.message).join(", "));
   return parsed.data.quantidade;
};

// async handler: errors (validation or database) go to the global error middleware
const handle =
   (fn: (req: Request) => Promise<unknown>) => async (req: Request, res: Response, next: NextFunction) => {
      try {
         res.status(201).json({ data: await fn(req) });
      } catch (error) {
         next(error);
      }
   };

const fakeDataRoutes = Router();
fakeDataRoutes.use(authMiddleware.requireAdminRole);
fakeDataRoutes.get("/", (_req, res) => {
   res.status(200).json({ data: { disponivel: true } });
});
fakeDataRoutes.post("/produtos", handle((req) => service.produtos(lerQuantidade(req, 500, 20_000))));
fakeDataRoutes.post("/usuarios", handle((req) => service.usuarios(lerQuantidade(req, 5, 200))));
fakeDataRoutes.post("/categorias", handle(() => service.categorias()));
fakeDataRoutes.post("/auditorias", handle((req) => service.auditorias(lerQuantidade(req, 10, 200), req.user!.id)));

export { fakeDataRoutes };
