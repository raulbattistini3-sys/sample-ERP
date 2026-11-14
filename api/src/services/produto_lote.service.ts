import ProductRepository from "../repositories/product.repository";
import ProdutoMarcacaoRepository, { Marcacao } from "../repositories/produto_marcacao.repository";
import { BaseAppError } from "../errors/global_error.error";
import { ValidationError } from "../errors/client_errors/four_xx.error";
import { ServerError } from "../errors/server_errors/five_xx.error";
import { Either, left, right } from "../globals/errors/left_right_either.error";
import { avisarProdutosAlterados } from "../utils/cache/produtos_alterados";
import { AcaoEmLote } from "../utils/schemas/produto_lote.schema";
import ProdutoLoteValidator from "../validators/produto_lote.validator";

export { ACOES } from "../utils/schemas/produto_lote.schema";
export type { AcaoEmLote };

export type ResultadoEmLote = { acao: AcaoEmLote; selecionados: number; alterados: number };

const MARCACAO: Partial<Record<AcaoEmLote, { tipo: Marcacao; marcar: boolean }>> = {
  favoritar: { tipo: "favorito", marcar: true },
  desfavoritar: { tipo: "favorito", marcar: false },
  salvar_depois: { tipo: "depois", marcar: true },
  tirar_depois: { tipo: "depois", marcar: false },
};

class ProdutoLoteService {
  private readonly validator = new ProdutoLoteValidator();
  constructor(
    private readonly products: ProductRepository,
    private readonly marcacoes: ProdutoMarcacaoRepository,
  ) {}

  // podeReativar: only ADM/SU see inactive products, so only they can bring them back
  async executar(payload: unknown, usuarioId: string, podeReativar: boolean): Promise<Either<BaseAppError, ResultadoEmLote>> {
    const parsed = this.validator.parseAcao(payload);
    if (parsed.isLeft()) return left(parsed.value);
    const { acao, ids } = parsed.value;

    if (acao === "inativar" || acao === "ativar") {
      if (acao === "ativar" && !podeReativar) return left(new ValidationError("403", "Só administradores reativam produtos."));
      const feito = await this.products.setAtivoEmLote(ids, acao === "ativar", usuarioId);
      if (feito.isLeft()) return left(feito.value);
      avisarProdutosAlterados();
      return right({ acao, selecionados: ids.length, alterados: feito.value.length });
    }

    const marcacao = MARCACAO[acao]!;
    try {
      const alterados = marcacao.marcar
        ? await this.marcacoes.marcar(usuarioId, ids, marcacao.tipo)
        : await this.marcacoes.desmarcar(usuarioId, ids, marcacao.tipo);
      return right({ acao, selecionados: ids.length, alterados });
    } catch (error) {
      return left(new ServerError("500", true, "internal server error", error));
    }
  }

  async listarMarcacoes(usuarioId: string): Promise<Either<BaseAppError, Record<Marcacao, string[]>>> {
    try {
      return right(await this.marcacoes.listar(usuarioId));
    } catch (error) {
      return left(new ServerError("500", true, "internal server error", error));
    }
  }
}

export default ProdutoLoteService;
