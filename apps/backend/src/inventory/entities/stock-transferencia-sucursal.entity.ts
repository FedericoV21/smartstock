import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'stock_transferencia_sucursal' })
export class StockTransferenciaSucursal {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'producto_id', type: 'uuid' })
  productoId: string;

  @Column({ name: 'sucursal_origen_id', type: 'uuid' })
  sucursalOrigenId: string;

  @Column({ name: 'sucursal_destino_id', type: 'uuid' })
  sucursalDestinoId: string;

  @Column({ type: 'numeric', precision: 12, scale: 3 })
  cantidad: string;

  @Column({ type: 'text', nullable: true })
  motivo: string | null;

  @Column({ type: 'text', default: 'pendiente' })
  estado: string;

  @Column({ name: 'usuario_envio_id', type: 'uuid', nullable: true })
  usuarioEnvioId: string | null;

  @Column({ name: 'usuario_recepcion_id', type: 'uuid', nullable: true })
  usuarioRecepcionId: string | null;

  @Column({ name: 'movimiento_salida_id', type: 'uuid', nullable: true })
  movimientoSalidaId: string | null;

  @Column({ name: 'movimiento_entrada_id', type: 'uuid', nullable: true })
  movimientoEntradaId: string | null;

  @Column({ name: 'deposito_destino_existia', type: 'boolean', default: false })
  depositoDestinoExistia: boolean;

  @Column({ name: 'deposito_destino_creado', type: 'boolean', default: false })
  depositoDestinoCreado: boolean;

  @Column({ name: 'enviado_at', type: 'timestamptz' })
  enviadoAt: Date;

  @Column({ name: 'recibido_at', type: 'timestamptz', nullable: true })
  recibidoAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
