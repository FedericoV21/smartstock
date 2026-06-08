import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'super_admin_contexto_log' })
export class SuperAdminContextoLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'usuario_id', type: 'uuid' })
  usuarioId: string;

  @Column({ name: 'tenant_id_prev', type: 'uuid', nullable: true })
  tenantIdPrev: string | null;

  @Column({ name: 'tenant_id_next', type: 'uuid', nullable: true })
  tenantIdNext: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
