import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { EstadoPedido } from '../enums/estado-pedido.enum';

@Entity({ name: 'pedido' })
export class Pedido {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'cliente_id', type: 'uuid', nullable: true })
  clienteId: string | null;

  @Column({ name: 'sucursal_id', type: 'uuid', nullable: true })
  sucursalId: string | null;

  @Column({ name: 'numero_orden', type: 'integer', nullable: true })
  numeroOrden: number | null;

  @Column({ type: 'enum', enum: EstadoPedido, enumName: 'estado_pedido' })
  estado: EstadoPedido;

  @Column({ type: 'date' })
  fecha: string;

  @Column({ type: 'numeric', precision: 18, scale: 2 })
  total: string;

  @Column({ type: 'text', nullable: true })
  notas: string | null;

  @Column({ name: 'comprobante_id', type: 'uuid', nullable: true })
  comprobanteId: string | null;

  @Column({ name: 'usuario_id', type: 'uuid', nullable: true })
  usuarioId: string | null;

  @Column({ name: 'workflow_estado_id', type: 'uuid', nullable: true })
  workflowEstadoId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
