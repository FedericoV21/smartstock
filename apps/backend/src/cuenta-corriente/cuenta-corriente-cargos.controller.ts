import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Roles } from '../auth/decorators/roles.decorator';
import { ClienteCuentaCorrienteService } from './cliente-cuenta-corriente.service';

@ApiTags('cuenta-corriente')
@ApiBearerAuth('access-token')
@Controller('cuenta-corriente')
export class CuentaCorrienteCargosController {
  constructor(private readonly service: ClienteCuentaCorrienteService) {}

  @Get('cargos-hoy')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({
    summary: 'Conteo de cargos CC del día por cliente',
    description: 'Paridad GET /api/cuenta-corriente/cargos-hoy.',
  })
  getCargosHoy() {
    return this.service.getCargosHoy();
  }
}
