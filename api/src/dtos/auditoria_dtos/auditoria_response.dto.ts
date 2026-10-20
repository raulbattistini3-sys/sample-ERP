import { AuditoriaEntity } from "../../entities/auditoria.entity";

// how every auditoria endpoint returns an auditoria: snake_case, matching the request payloads
type AuditoriaResponseDto = {
    id: string;
    acao_efetuada: AuditoriaEntity["acaoEfetuada"];
    data_de_audicao: Date;
    usuario_id: string; // the auditor; the web resolves the name through the usuarios endpoint
    detalhamento_auditoria_id: string | null;
};

export { AuditoriaResponseDto };
