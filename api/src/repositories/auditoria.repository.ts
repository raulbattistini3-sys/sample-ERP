import { desc, eq, isNull } from "drizzle-orm";
import { DrizzleDB } from "../db/client";
import { auditorias } from "../db/schema/auditoria.schema";
import { detalhamentosAuditoria } from "../db/schema/detalhamento_auditoria.schema";
import { produtosPorAuditoria } from "../db/schema/produtos_por_auditoria.schema";
import { produtos } from "../db/schema/product.schema";
import { categorias } from "../db/schema/categoria.schema";
import { AuditoriaEntity } from "../entities/auditoria.entity";
import IAuditoryRepository from "../interfaces/auditory_interfaces/auditoria_repository.interface";
import { RepositoryError } from "../globals/errors/global_repository_error.error";
import { Either, right, left } from "../globals/errors/left_right_either.error";
import { BaseAppError } from "../errors/global_error.error";
import { ValidationError } from "../errors/client_errors/four_xx.error";
import { pgErrorCode } from "../utils/helpers/pg_error.util";
import { enqueueForProducts } from "./integracao_envios.repository";
import { diffCategoria, diffProduct, insertLinkedAuditoria } from "./audit_trail.repository";
import { NewAuditoriaManual, NewAuditoriaWithItens } from "../dtos/auditoria_dtos/create_auditoria.dto";
import { GetUserPreviousAudictionsDto } from "../dtos/auditoria_dtos/get_auditoria.dto";

class AuditoriaRepository implements IAuditoryRepository {
  constructor(private readonly db: DrizzleDB) {}

  async getAuditorias(): Promise<Either<RepositoryError, AuditoriaEntity[]>> {
    try {
      // newest first, so paging walks back in time
      const auditoriasData = await this.db
        .select()
        .from(auditorias)
        .where(isNull(auditorias.deletedAt))
        .orderBy(desc(auditorias.dataDeAudicao));
      return right(auditoriasData);
    } catch (error) {
      return left(new RepositoryError("Database error", error));
    }
  }

  async getAuditoriaById(id: string): Promise<Either<BaseAppError, AuditoriaEntity>> {
    try {
      const [auditoria] = await this.db.select().from(auditorias).where(eq(auditorias.id, id)).limit(1);
      if (!auditoria) {
        return left(new ValidationError("404", "Auditoria n√£o encontrada"));
      }
      return right(auditoria);
    } catch (error) {
      return left(new RepositoryError("Database error", error));
    }
  }

  // detalhamento, auditoria and its produtos are written together or not at all
  async createAuditoria({
    auditoria,
    detalhamento,
    produtoIds,
  }: NewAuditoriaWithItens): Promise<Either<BaseAppError, AuditoriaEntity>> {
    try {
      const created = await this.db.transaction(async (tx: DrizzleDB) => {
        const [detalhamentoRow] = await tx.insert(detalhamentosAuditoria).values(detalhamento).returning();
        const [auditoriaRow] = await tx
          .insert(auditorias)
          .values({ ...auditoria, detalhamentoAuditoriaId: detalhamentoRow.id })
          .returning();
        await tx
          .insert(produtosPorAuditoria)
          .values(produtoIds.map((produtoId) => ({ auditoriaId: auditoriaRow.id, produtoId })));
        // per connected integration, one issue/item per categoria of these products, created after commit
        await enqueueForProducts(tx, auditoriaRow.id, produtoIds);
        return auditoriaRow;
      });
      return right(created);
    } catch (error) {
      // foreign key violation: the usuario or one of the produtos doesn't exist
      if (pgErrorCode(error) === "23503") {
        return left(new ValidationError("404", "Usu√°rio auditor ou produto n√£o encontrado", error));
      }
      return left(new RepositoryError("Database error", error));
    }
  }

  // A manual auditoria that applies its own changes: locks the product or categoria, saves the new
  // values and records every changed field, all in one transaction. The auditoria is created already
  // vinculada (see audit_trail.repository), so no other change can claim it.
  async createAuditoriaManual(input: NewAuditoriaManual): Promise<Either<BaseAppError, AuditoriaEntity>> {
    try {
      const auditoriaId: string = await this.db.transaction((tx: DrizzleDB) =>
        input.alvo.tipo === "produto"
          ? this.applyToProduct(tx, input, input.alvo)
          : this.applyToCategoria(tx, input, input.alvo),
      );
      return this.getAuditoriaById(auditoriaId);
    } catch (error) {
      // thrown inside the transaction so it rolls back: 404 target, 400 nothing changed
      if (error instanceof ValidationError) {
        return left(error);
      }
      if (pgErrorCode(error) === "23505") {
        return left(new ValidationError("409", "J· existe um registro com esse nome ou SKU", error));
      }
      if (pgErrorCode(error) === "23503") {
        return left(new ValidationError("404", "Usu·rio auditor n„o encontrado", error));
      }
      return left(new RepositoryError("Database error", error));
    }
  }

  private async applyToProduct(
    tx: DrizzleDB,
    input: NewAuditoriaManual,
    alvo: Extract<NewAuditoriaManual["alvo"], { tipo: "produto" }>,
  ): Promise<string> {
    const [before] = await tx.select().from(produtos).where(eq(produtos.id, alvo.id)).for("update");
    if (!before || (!input.includeInactive && !before.ativo)) {
      throw new ValidationError("404", "Produto n„o encontrado");
    }

    const categoriaRows: { id: string; nome: string; ativo: boolean }[] = await tx
      .select({ id: categorias.id, nome: categorias.nome, ativo: categorias.ativo })
      .from(categorias);
    const { valores } = alvo;
    const categoria = categoriaRows.find((c) => c.nome === valores.categoria.nome);
    // moving to an inactive categoria isn't allowed (like PUT /products/:id); staying in one is
    if (!categoria || (!categoria.ativo && categoria.id !== before.categoriaId)) {
      throw new ValidationError("404", `Categoria "${valores.categoria.nome}" n„o encontrada ou inativa`);
    }

    const values = {
      name: valores.name,
      sku: valores.sku,
      categoriaId: categoria.id,
      valorDeCusto: valores.valor_de_custo,
      icms: valores.icms,
      valorDeVenda: valores.valor_de_venda,
      quantidadeEmEstoque: valores.quantidade_em_estoque,
      // only ADM/SU change the status, like PUT /products/:id
      ativo: input.includeInactive ? valores.ativo : before.ativo,
    };
    const after = { ...before, ...values };
    const nomeDe = (categoriaId: string) => categoriaRows.find((c) => c.id === categoriaId)?.nome ?? categoriaId;
    const changes = diffProduct(
      { ...before, categoriaNome: nomeDe(before.categoriaId) },
      { ...after, categoriaNome: nomeDe(after.categoriaId) },
    );
    if (changes.length === 0) {
      throw new ValidationError("400", "Nenhum campo do produto foi alterado");
    }

    await tx.update(produtos).set(values).where(eq(produtos.id, alvo.id));
    return insertLinkedAuditoria(tx, {
      acao: input.acao,
      dataDeAudicao: input.dataDeAudicao,
      usuarioId: input.usuarioId,
      nome: after.name,
      valorAnterior: Number(before.valorDeVenda).toFixed(2),
      valorAtual: Number(after.valorDeVenda).toFixed(2),
      observacoes: input.observacoes,
      changes,
      produtoIds: [alvo.id],
      categoriaId: null,
    });
  }

  private async applyToCategoria(
    tx: DrizzleDB,
    input: NewAuditoriaManual,
    alvo: Extract<NewAuditoriaManual["alvo"], { tipo: "categoria" }>,
  ): Promise<string> {
    const [before] = await tx.select().from(categorias).where(eq(categorias.id, alvo.id)).for("update");
    if (!before) {
      throw new ValidationError("404", "Categoria n„o encontrada");
    }

    const values = { nome: alvo.valores.nome, tipo: alvo.valores.tipo, ativo: alvo.valores.ativo };
    const changes = diffCategoria(before, { ...before, ...values });
    if (changes.length === 0) {
      throw new ValidationError("400", "Nenhum campo da categoria foi alterado");
    }

    await tx.update(categorias).set(values).where(eq(categorias.id, alvo.id));
    // the categoria's products, so the auditoria shows up for each of them
    const produtosDaCategoria: { id: string }[] = await tx
      .select({ id: produtos.id })
      .from(produtos)
      .where(eq(produtos.categoriaId, alvo.id));
    return insertLinkedAuditoria(tx, {
      acao: input.acao,
      dataDeAudicao: input.dataDeAudicao,
      usuarioId: input.usuarioId,
      nome: `Categoria: ${values.nome}`,
      valorAnterior: "0.00",
      valorAtual: "0.00",
      observacoes: input.observacoes,
      changes,
      produtoIds: produtosDaCategoria.map((p) => p.id),
      categoriaId: alvo.id,
    });
  }

  async updateAuditoria(auditoria: AuditoriaEntity): Promise<Either<RepositoryError, null>> {
    try {
      if (!auditoria) {
        return left(new RepositoryError("No payload found"));
      }
      const [existing] = await this.db.select().from(auditorias).where(eq(auditorias.id, auditoria.id)).limit(1);
      if (!existing) {
        return left(new RepositoryError("No auditoria found"));
      }
      await this.db.update(auditorias).set(auditoria).where(eq(auditorias.id, auditoria.id));
      return right(null);
    } catch (error) {
      return left(new RepositoryError("error message", error));
    }
  }

  async userPreviousAudictions(userId: string): Promise<Either<RepositoryError, AuditoriaEntity[]>> {
    try {
      if (!userId) {
        return left(new RepositoryError("No userId provided"));
      }
      const auditoriasData = await this.db
        .select()
        .from(auditorias)
        .where(eq(auditorias.usuarioId, userId));
      if (!auditoriasData || auditoriasData.length === 0) {
        return left(new RepositoryError("No auditorias found"));
      }
      return right(auditoriasData);
    } catch (error) {
      return left(new RepositoryError("error message", error));
    }
  }

  async getRespectivoDetalhamentosAuditoriaById(id: string): Promise<Either<RepositoryError, AuditoriaEntity>> {
    try {
      if (!id) {
        return left(new RepositoryError("No id provided"));
      }
      const auditoria = await this.db.query.auditorias.findFirst({
        where: (auditorias, { eq }) => eq(auditorias.id, id),
        with: { detalhamento: true },
      });
      if (!auditoria) {
        return left(new RepositoryError("No auditoria found"));
      }
      return right(auditoria);
    } catch (error) {
      return left(new RepositoryError("error message", error));
    }
  }

  async deleteAuditoria(id: string): Promise<Either<RepositoryError, null>> {
    try {
      if (!id) {
        return left(new RepositoryError("No id provided"));
      }
      const [auditoria] = await this.db.select().from(auditorias).where(eq(auditorias.id, id)).limit(1);
      if (!auditoria) {
        return left(new RepositoryError("No auditoria found"));
      }
      await this.db.delete(auditorias).where(eq(auditorias.id, id));
      return right(null);
    } catch (error) {
      return left(new RepositoryError("error message", error));
    }
  }

  async softDeleteAuditoria(id: string): Promise<Either<RepositoryError, null>> {
    try {
      if (!id) {
        return left(new RepositoryError("No id provided"));
      }
      const [auditoria] = await this.db.select().from(auditorias).where(eq(auditorias.id, id)).limit(1);
      if (!auditoria) {
        return left(new RepositoryError("No auditoria found"));
      }
      await this.db.update(auditorias).set({ deletedAt: new Date() }).where(eq(auditorias.id, id));
      return right(null);
    } catch (error) {
      return left(new RepositoryError("error message", error));
    }
  }
}

export default AuditoriaRepository;
