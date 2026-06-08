import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'usuario_credencial_local' })
export class UsuarioCredencialLocal {
  @PrimaryColumn({ name: 'usuario_id', type: 'uuid' })
  usuarioId: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'username_local', type: 'text' })
  usernameLocal: string;

  @Column({ name: 'pin_hash', type: 'text' })
  pinHash: string;

  @Column({ name: 'pin_temporal', type: 'boolean', default: true })
  pinTemporal: boolean;

  @Column({ type: 'boolean', default: true })
  activo: boolean;

  @Column({ name: 'intentos_fallidos', type: 'smallint', default: 0 })
  intentosFallidos: number;

  @Column({ name: 'bloqueado_hasta', type: 'timestamptz', nullable: true })
  bloqueadoHasta: Date | null;

  @Column({ name: 'ultimo_login_at', type: 'timestamptz', nullable: true })
  ultimoLoginAt: Date | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
