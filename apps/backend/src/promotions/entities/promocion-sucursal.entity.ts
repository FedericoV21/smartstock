import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'promocion_sucursal' })
export class PromocionSucursal {
  @PrimaryColumn({ name: 'promocion_id', type: 'uuid' })
  promocionId: string;

  @PrimaryColumn({ name: 'sucursal_id', type: 'uuid' })
  sucursalId: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
