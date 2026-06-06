import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { Promocion } from './promocion.entity';

@Entity({ name: 'producto_promocion' })
export class ProductoPromocion {
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

  @ManyToOne(() => Promocion, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'promocion_id' })
  promocion?: Promocion;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
