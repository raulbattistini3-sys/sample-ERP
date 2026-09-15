import { Entity, PrimaryGeneratedColumn, Column, OneToOne } from "typeorm";
import permissoesUsuarioEnum, { PermissoesUsuarioEnum } from "../enums/usuarios_permissoes.enum";
import { AuditoriaEntity } from "./auditoria.entity";

@Entity("usuarios")
class UsuarioEntity {
   @PrimaryGeneratedColumn("uuid")
   id: string;

   @Column("text")
   nome: string;

   @Column("text")
   permissoes = permissoesUsuarioEnum.Values.Estoque // or ADM — pick your actual default
   
   @Column("text", { nullable: false })
   email: string;

   @Column("text")
   senha: string;

   @Column()
   ativo: boolean;

   @OneToOne(
      () => AuditoriaEntity,
      (auditoriaEntity) => auditoriaEntity.nome_do_auditor,
   )
   auditorias_realizadas: AuditoriaEntity;
}

export { UsuarioEntity };
