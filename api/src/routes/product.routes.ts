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
import LocalImportadorClient from "../integrations/importador/local_importador.client";
import IImportadorClient from "../interfaces/importacao_interfaces/importador_client.interface";
import ImportacaoRepository from "../repositories/importacao.repository";
import ImportacaoCluster from "../queues/importacoes.cluster";
import { uploadPlanilha } from "../middlewares/upload.middleware";
import ProductSnapshotService from "../services/product_snapshot.service";
import ProductSnapshotController from "../controllers/product_snapshot.controller";
import ProdutoLoteController from "../controllers/produto_lote.controller";
import ProdutoLoteService from "../services/produto_lote.service";
import ProdutoMarcacaoRepository from "../repositories/produto_marcacao.repository";
import { rede } from "../integrations/network/network.client";


const config = Config.getInstance();
const logger = AppLogger.getInstance();
const  db = config.getDb();
const productRepository = new ProductRepository(db);
const categoriaRepository = new CategoriaRepository(db);
const produtoValidator = new ProdutoValidator();
const categoriaValidator = new CategoriaValidator();

// exported for the product socket (sockets/produtos.socket.ts), which serves the same scroll as GET /scroll
export const productService = new ProductService(
  productRepository,
  categoriaRepository,
  produtoValidator,
  categoriaValidator,
);

const productController = new ProductController(productService, logger);
// the whole visible list as one binary file, for the web's local search (pkg/tablecore)
const productSnapshotController = new ProductSnapshotController(new ProductSnapshotService(productRepository), logger);

// The Go importer does the work when it can be found: on the network service by name ("importer", when
// NETWORK_URL is set; IMPORTER_GRPC_URL is then the fallback while none is registered) or at
// IMPORTER_GRPC_URL. With neither (or IMPORTER_LOCAL=true), this API does. Both are closed on shutdown
// by index.ts
const grpcUrl = process.env.IMPORTER_GRPC_URL;
const usaImportadorGo = process.env.IMPORTER_LOCAL !== "true" && (!!grpcUrl || !!rede);
export const importacaoCluster = usaImportadorGo ? null : new ImportacaoCluster(logger);
export const importadorClient: IImportadorClient = importacaoCluster
  ? new LocalImportadorClient(new ImportacaoRepository(db), () => importacaoCluster.acordar())
  : new GrpcImportadorClient(rede ? async () => (await rede!.endereco("importer")) ?? grpcUrl ?? null : (grpcUrl as string));
// clientes imports exist only in the Go importer (HubSpot, 500,000 rows): null when it isn't configured
export const grpcImportador = importadorClient instanceof GrpcImportadorClient ? importadorClient : null;
const importacaoController = new ImportacaoController(new ImportacaoService(importadorClient), logger);

// select several products, then inactivate / favourite / save for later all of them
const produtoLoteController = new ProdutoLoteController(
  new ProdutoLoteService(productRepository, new ProdutoMarcacaoRepository(db)),
  logger,
);

const productRoutes = Router();

productRoutes.post("/lote", produtoLoteController.executar);
productRoutes.get("/marcacoes", produtoLoteController.getMarcacoes);
productRoutes.get("/scroll", productController.getScroll);
productRoutes.get("/snapshot", productSnapshotController.get);
productRoutes.get("/filter", productController.getByFilter);
productRoutes.get("/download", productController.getToDownload);
// bulk create/update from a spreadsheet: ADM and SU only. /imports queues the file for the importer
// (202, then poll /imports/:id); /import takes the rows the web already read and answers at once,
// and is what the web falls back to when /imports answers 503 (the Go importer isn't reachable)
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
