// Package grpcserver implements importador.v1.ImportadorService on top of the importacoes queue. It only
// receives files and reports on them; importacao.Worker does the processing in the background.
//
// The caller is trusted: the API authenticates the user, checks they may import (ADM/SU) and passes
// their id, so the importer stays on a private network and is never exposed to browsers.
package grpcserver

import (
	"context"
	"errors"
	"log/slog"
	"path/filepath"
	"strings"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"

	importadorv1 "github.com/raulbattistini3-sys/sample-ERP/gen/go/importador/v1"
	"github.com/raulbattistini3-sys/sample-ERP/importer/planilha"
	"github.com/raulbattistini3-sys/sample-ERP/importer/postgres"
)

type Server struct {
	importadorv1.UnimplementedImportadorServiceServer
	repo *postgres.Importacoes
}

func New(repo *postgres.Importacoes) *Server {
	return &Server{repo: repo}
}

func (s *Server) IniciarImportacao(ctx context.Context, req *importadorv1.IniciarImportacaoRequest) (*importadorv1.IniciarImportacaoResponse, error) {
	nome := strings.TrimSpace(req.GetNomeArquivo())
	switch {
	case len(req.GetPlanilha()) == 0:
		return nil, status.Error(codes.InvalidArgument, "Envie a planilha.")
	case nome == "":
		return nil, status.Error(codes.InvalidArgument, "Informe o nome do arquivo.")
	case req.GetUsuarioId() == "":
		return nil, status.Error(codes.InvalidArgument, "Informe o usuário que está importando.")
	}
	switch strings.ToLower(filepath.Ext(nome)) {
	case ".xlsx", ".csv":
	default:
		return nil, status.Error(codes.InvalidArgument, planilha.ErrFormato.Error())
	}

	imp, err := s.repo.Criar(ctx, req.GetUsuarioId(), nome, req.GetPlanilha())
	switch {
	case errors.Is(err, postgres.ErrUsuarioNaoEncontrado):
		return nil, status.Error(codes.NotFound, "Usuário não encontrado.")
	case errors.Is(err, postgres.ErrIDInvalido):
		return nil, status.Error(codes.InvalidArgument, "usuario_id não é um UUID válido.")
	case err != nil:
		slog.Error("creating importacao", "err", err)
		return nil, status.Error(codes.Internal, "Não foi possível registrar a importação.")
	}
	return &importadorv1.IniciarImportacaoResponse{Importacao: toProto(imp)}, nil
}

func (s *Server) ObterImportacao(ctx context.Context, req *importadorv1.ObterImportacaoRequest) (*importadorv1.ObterImportacaoResponse, error) {
	imp, err := s.repo.Obter(ctx, req.GetId())
	switch {
	case errors.Is(err, postgres.ErrNaoEncontrada):
		return nil, status.Error(codes.NotFound, "Importação não encontrada.")
	case errors.Is(err, postgres.ErrIDInvalido):
		return nil, status.Error(codes.InvalidArgument, "id não é um UUID válido.")
	case err != nil:
		slog.Error("reading importacao", "id", req.GetId(), "err", err)
		return nil, status.Error(codes.Internal, "Não foi possível consultar a importação.")
	}
	return &importadorv1.ObterImportacaoResponse{Importacao: toProto(imp)}, nil
}

var statusProto = map[postgres.Status]importadorv1.StatusImportacao{
	postgres.StatusPendente:    importadorv1.StatusImportacao_STATUS_IMPORTACAO_PENDENTE,
	postgres.StatusProcessando: importadorv1.StatusImportacao_STATUS_IMPORTACAO_PROCESSANDO,
	postgres.StatusConcluida:   importadorv1.StatusImportacao_STATUS_IMPORTACAO_CONCLUIDA,
	postgres.StatusRejeitada:   importadorv1.StatusImportacao_STATUS_IMPORTACAO_REJEITADA,
	postgres.StatusFalhou:      importadorv1.StatusImportacao_STATUS_IMPORTACAO_FALHOU,
}

func toProto(imp postgres.Importacao) *importadorv1.Importacao {
	erros := make([]*importadorv1.ErroLinha, len(imp.Erros))
	for i, e := range imp.Erros {
		erros[i] = &importadorv1.ErroLinha{Linha: e.Linha, Campo: e.Campo, Mensagem: e.Mensagem}
	}
	return &importadorv1.Importacao{
		Id:               imp.ID,
		Status:           statusProto[imp.Status],
		NomeArquivo:      imp.NomeArquivo,
		TotalLinhas:      imp.TotalLinhas,
		LinhasImportadas: imp.LinhasImportadas,
		Erros:            erros,
		Mensagem:         imp.Mensagem,
		CriadaEm:         timestamppb.New(imp.CriadaEm),
		FinalizadaEm:     timestampOuNil(imp.FinalizadaEm),
	}
}

func timestampOuNil(t *time.Time) *timestamppb.Timestamp {
	if t == nil {
		return nil
	}
	return timestamppb.New(*t)
}
