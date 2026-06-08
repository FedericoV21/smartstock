import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

import { PlanTipo } from '../enums/plan-tipo.enum';

export class ActivatePlanDto {
  @ApiProperty({ enum: [PlanTipo.base, PlanTipo.completo] })
  @IsIn([PlanTipo.base, PlanTipo.completo])
  plan: PlanTipo.base | PlanTipo.completo;
}

export class SetIaIlimitadaDto {
  @ApiProperty({ enum: ['lector_factura', 'ia_pdf'] })
  @IsIn(['lector_factura', 'ia_pdf'])
  ia_ilimitada_origen: 'lector_factura' | 'ia_pdf';
}
