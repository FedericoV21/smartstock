import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'cierre_z_medio_pago' })
export class CierreZMedioPago {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'cierre_z_id', type: 'uuid' })
  cierreZId: string;

  @Column({ name: 'metodo_pago', type: 'text' })
  metodoPago: string;

  @Column({ name: 'monto_neto', type: 'numeric', precision: 18, scale: 6, default: '0' })
  montoNeto: string;

  @Column({ name: 'cantidad_comprobantes', type: 'integer', default: 0 })
  cantidadComprobantes: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
