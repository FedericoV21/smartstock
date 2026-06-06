import { Column, Entity, PrimaryColumn } from 'typeorm';

import { CodigoMedioRapido } from '../enums/codigo-medio-rapido.enum';

@Entity({ name: 'medio_pago_rapido' })
export class MedioPagoRapido {
  @PrimaryColumn({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @PrimaryColumn({ type: 'varchar', length: 20 })
  codigo: CodigoMedioRapido;

  @Column({ name: 'recargo_porcentaje', type: 'numeric', precision: 12, scale: 4, default: '0' })
  recargoPorcentaje: string;
}
