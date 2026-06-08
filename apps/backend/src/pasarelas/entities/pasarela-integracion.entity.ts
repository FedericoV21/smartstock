import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type PasarelaCanal = 'qr' | 'terminal';
export type PasarelaEstado = 'activa' | 'inactiva' | 'incompleta';

@Entity({ name: 'pasarela_integracion' })
export class PasarelaIntegracion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'sucursal_id', type: 'uuid' })
  sucursalId: string;

  @Column({ type: 'text' })
  proveedor: string;

  @Column({ type: 'text' })
  canal: PasarelaCanal;

  @Column({ type: 'text' })
  tipo: string;

  @Column({ type: 'text' })
  nombre: string;

  @Column({ type: 'text', default: 'incompleta' })
  estado: PasarelaEstado;

  @Column({ name: 'config_publica', type: 'jsonb', default: {} })
  configPublica: Record<string, unknown>;

  @Column({ name: 'secretos_cifrados', type: 'jsonb', default: {} })
  secretosCifrados: Record<string, unknown>;

  @Column({ name: 'webhook_public_id', type: 'uuid' })
  webhookPublicId: string;

  @Column({ name: 'origen_legacy', type: 'text', nullable: true })
  origenLegacy: string | null;

  @Column({ name: 'legacy_config_id', type: 'uuid', nullable: true })
  legacyConfigId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
