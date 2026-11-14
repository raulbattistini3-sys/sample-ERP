import { Request, Response, NextFunction } from "express";
import BaseController from "./base.controller";
import LoggerInterface from "../interfaces/logger_interfaces/logger_interface.interface";
import GrpcImportadorClient from "../integrations/importador/importador.client";
import { ImportacaoDto } from "../dtos/importacao_dtos/importacao.dto";
import { ValidationError } from "../errors/client_errors/four_xx.error";
import { ServerError } from "../errors/server_errors/five_xx.error";

const FINAIS = new Set(["concluida", "rejeitada", "falhou"]);
const LIMITE_ERROS = 500;
const MAX_ERROS = 5000;

// Clientes and Empresas spreadsheets (up to 500,000 rows) go to the Go importer only: it streams the file,
// saves to HubSpot in batches of 100 and records its progress, so a restart resumes where it stopped. This
// API only hands the file over and relays the progress. Without IMPORTER_GRPC_URL there's no one to do it: 503.
// One instance per tipo: each only shows its own imports.
class ClienteImportacaoController extends BaseController {
  constructor(
    private readonly tipo: "clientes" | "empresas",
    private readonly importador: GrpcImportadorClient | null,
    private readonly aoTerminar: () => void,
    logger: LoggerInterface,
  ) {
    super(logger);
  }

  private semImportador(req: Request, next: NextFunction) {
    return this.fail(
      req,
      next,
      new ServerError("503", false, "O importador não está disponível. Configure IMPORTER_GRPC_URL e suba o serviço importer."),
    );
  }

  start = async (req: Request, res: Response, next: NextFunction) => {
    if (!this.importador) return this.semImportador(req, next);
    if (!req.file || req.file.buffer.length === 0) {
      return this.fail(req, next, new ValidationError("400", 'Envie a planilha (.xlsx ou .csv) no campo "planilha".'));
    }
    const result = await this.importador.iniciarImportacao({
      planilha: req.file.buffer,
      nomeArquivo: req.file.originalname,
      usuarioId: req.user!.id,
      tipo: this.tipo,
    });
    if (result.isLeft()) return this.fail(req, next, result.value);
    return res.status(202).location(`${req.baseUrl}/importacoes/${result.value.id}`).json({ data: result.value });
  };

  getById = async (req: Request, res: Response, next: NextFunction) => {
    if (!this.importador) return this.semImportador(req, next);
    const result = await this.importador.obterImportacao(String(req.params.id));
    if (result.isLeft()) return this.fail(req, next, result.value);
    if (!this.eDoTipo(result.value)) return this.fail(req, next, new ValidationError("404", "Importação não encontrada."));
    // the lists cache their first page; once the import is over, the next read must see the new clients
    if (FINAIS.has(result.value.status)) this.aoTerminar();
    return res.status(200).json({ data: result.value });
  };

  // ?depois=<seq>: only the errors after the last one the page already has, so a 500,000-row import with
  // many failures is never sent twice
  getErros = async (req: Request, res: Response, next: NextFunction) => {
    if (!this.importador) return this.semImportador(req, next);
    const depois = Math.max(0, Math.trunc(Number(req.query.depois) || 0));
    const limite = Math.min(Math.max(1, Math.trunc(Number(req.query.limite) || LIMITE_ERROS)), MAX_ERROS);
    const result = await this.importador.listarErros(String(req.params.id), depois, limite);
    if (result.isLeft()) return this.fail(req, next, result.value);
    const erros = result.value;
    return res.status(200).json({ data: erros, proximo: erros.length === limite ? erros[erros.length - 1].seq : null });
  };

  private eDoTipo(importacao: ImportacaoDto) {
    return importacao.tipo === this.tipo;
  }
}

export default ClienteImportacaoController;
