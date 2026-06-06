import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'comprobante_item' })
export class ComprobanteItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'comprobante_id', type: 'uuid' })
  comprobanteId: string;

  @Column({ name: 'producto_id', type: 'uuid' })
  productoId: string;

  @Column({ type: 'numeric', precision: 12, scale: 3 })
  cantidad: string;

  @Column({ name: 'precio_unitario', type: 'numeric', precision: 18, scale: 2 })
  precioUnitario: string;

  @Column({ name: 'precio_costo', type: 'numeric', precision: 18, scale: 6, nullable: true })
  precioCosto: string | null;

  @Column({ type: 'numeric', precision: 18, scale: 2 })
  subtotal: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
