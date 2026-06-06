import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

import { ReferenciaTipo } from '../enums/referencia-tipo.enum';
import { TipoMovimiento } from '../enums/tipo-movimiento.enum';

@Entity({ name: 'movimiento' })
export class Movimiento {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'producto_id', type: 'uuid' })
  productoId: string;

  @Column({ name: 'producto_variante_id', type: 'uuid', nullable: true })
  productoVarianteId: string | null;

  @Column({ name: 'producto_variante_etiqueta', type: 'text', nullable: true })
  productoVarianteEtiqueta: string | null;

  @Column({ name: 'sucursal_id', type: 'uuid', nullable: true })
  sucursalId: string | null;

  @Column({
    type: 'enum',
    enum: TipoMovimiento,
    enumName: 'tipo_movimiento',
  })
  tipo: TipoMovimiento;

  @Column({ type: 'numeric', precision: 12, scale: 3 })
  cantidad: string;

  @Column({ name: 'stock_anterior', type: 'numeric', precision: 12, scale: 3 })
  stockAnterior: string;

  @Column({ name: 'stock_posterior', type: 'numeric', precision: 12, scale: 3 })
  stockPosterior: string;

  @Column({ type: 'text', nullable: true })
  motivo: string | null;

  @Column({
    name: 'referencia_tipo',
    type: 'enum',
    enum: ReferenciaTipo,
    enumName: 'referencia_tipo',
    nullable: true,
  })
  referenciaTipo: ReferenciaTipo | null;

  @Column({ name: 'referencia_id', type: 'uuid', nullable: true })
  referenciaId: string | null;

  @Column({ name: 'usuario_id', type: 'uuid', nullable: true })
  usuarioId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
