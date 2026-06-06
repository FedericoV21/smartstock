import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'pedido_item' })
export class PedidoItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'pedido_id', type: 'uuid' })
  pedidoId: string;

  @Column({ name: 'producto_id', type: 'uuid' })
  productoId: string;

  @Column({ type: 'numeric', precision: 12, scale: 3 })
  cantidad: string;

  @Column({ name: 'precio_unitario', type: 'numeric', precision: 18, scale: 2 })
  precioUnitario: string;

  @Column({ type: 'numeric', precision: 18, scale: 2 })
  subtotal: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
