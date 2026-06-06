import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'promocion_combo_item' })
export class PromocionComboItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'promocion_id', type: 'uuid' })
  promocionId: string;

  @Column({ name: 'producto_id', type: 'uuid' })
  productoId: string;

  @Column({ name: 'producto_variante_id', type: 'uuid', nullable: true })
  productoVarianteId: string | null;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'numeric', precision: 18, scale: 6 })
  cantidad: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
