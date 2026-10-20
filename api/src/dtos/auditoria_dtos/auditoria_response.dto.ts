import { AuditoriaEntity } from "../../entities/auditoria.entity";

// how every auditoria endpoint returns an auditoria: snake_case, matching the request payloads
type AuditoriaResponseDto = {
    id: string;
    acao_efetuada: AuditoriaEntity["acaoEfetuada"];
    data_de_audicao: Date;
    nome_do_auditor: string; // the auditor's usuario id
    detalhamento_auditoria_id: string | null;
};

export { AuditoriaResponseDto };
