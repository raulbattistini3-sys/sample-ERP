import Config from "../configs/app_config";
import AppLogger from "../utils/logger/pino_logger.util";
import CategoriaRepository from "../repositories/categoria.repository";
import ImportacaoRepository from "../repositories/importacao.repository";
import ProductRepository from "../repositories/product.repository";
import ProductService from "../services/product.service";
import ProdutoValidator from "../validators/produto.validator";
import CategoriaValidator from "../validators/categoria.validator";
import ImportacaoWorker from "./importacoes.worker";

// Entry point of an import process, forked by ImportacaoCluster. It has its own database pool.
const db = Config.getInstance().getDb();
const logger = AppLogger.getInstance();

const worker = new ImportacaoWorker(
  new ImportacaoRepository(db),
  new ProductService(new ProductRepository(db), new CategoriaRepository(db), new ProdutoValidator(), new CategoriaValidator()),
  logger,
);

process.on("message", async (mensagem) => {
  if (mensagem === "acordar") worker.acordar();
  if (mensagem === "parar") {
    await worker.stop();
    process.exit(0);
  }
});

worker.start();
