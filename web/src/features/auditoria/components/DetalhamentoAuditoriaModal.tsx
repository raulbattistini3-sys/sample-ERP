import { Modal } from "../../../components/ui/Modal";
import { Button } from "../../../components/ui/Button";
import { DetalhamentoAuditoriaDetails } from "./DetalhamentoAuditoriaDetails";

type DetalhamentoAuditoriaModalProps = {
  detalhamentoId: string | null;
  onClose: () => void;
};

export function DetalhamentoAuditoriaModal({ detalhamentoId, onClose }: DetalhamentoAuditoriaModalProps) {
  return (
    <Modal
      open={!!detalhamentoId}
      onClose={onClose}
      title="Detalhamento da auditoria"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Fechar
        </Button>
      }
    >
      {detalhamentoId && <DetalhamentoAuditoriaDetails id={detalhamentoId} />}
    </Modal>
  );
}
