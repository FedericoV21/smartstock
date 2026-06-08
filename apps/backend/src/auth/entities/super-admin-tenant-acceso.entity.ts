import { CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'super_admin_tenant_acceso' })
export class SuperAdminTenantAcceso {
  @PrimaryColumn({ name: 'usuario_id', type: 'uuid' })
  usuarioId: string;

  @PrimaryColumn({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
