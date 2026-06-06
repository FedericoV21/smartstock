import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'modulo_config' })
export class ModuloConfig {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'boolean', default: true })
  stock: boolean;

  @Column({ name: 'importador_excel', type: 'boolean', default: true })
  importadorExcel: boolean;

  @Column({ name: 'facturador_simple', type: 'boolean', default: false })
  facturadorSimple: boolean;

  @Column({ name: 'facturador_arca', type: 'boolean', default: false })
  facturadorArca: boolean;

  @Column({ name: 'facturador_pos', type: 'boolean', default: false })
  facturadorPos: boolean;

  @Column({ type: 'boolean', default: false })
  pedidos: boolean;

  @Column({ type: 'boolean', default: false })
  presupuestos: boolean;

  @Column({ name: 'ia_precios', type: 'boolean', default: false })
  iaPrecios: boolean;

  @Column({ name: 'analizador_rentabilidad', type: 'boolean', default: false })
  analizadorRentabilidad: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
