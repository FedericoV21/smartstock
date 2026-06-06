import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Roles } from '../auth/decorators/roles.decorator';
import { CreateMedioPagoDto, UpdateMedioPagoDto } from './dto/upsert-medio-pago.dto';
import { UpsertRapidosDto } from './dto/upsert-rapidos.dto';
import { PaymentMethodsService } from './payment-methods.service';

@ApiTags('config')
@ApiBearerAuth('access-token')
@Controller('config/payment-methods')
export class PaymentMethodsController {
  constructor(private readonly paymentMethodsService: PaymentMethodsService) {}

  @Get()
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({
    summary: 'Medios de pago + atajos r├ípidos',
    description: 'Paridad GET /api/configuracion/medios-de-pago',
  })
  listAll() {
    return this.paymentMethodsService.listAll();
  }

  @Get('quick')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({
    summary: 'Atajos r├ípidos POS (recargo % por c├│digo)',
    description: 'Paridad GET /api/configuracion/medios-de-pago/rapidos',
  })
  listQuick() {
    return this.paymentMethodsService.listRapidosOnly();
  }

  @Put('quick')
  @Roles('admin')
  @ApiOperation({
    summary: 'Actualizar atajos r├ípidos POS',
    description: 'Paridad PUT /api/configuracion/medios-de-pago/rapidos. Solo admin.',
  })
  upsertQuick(@Body() dto: UpsertRapidosDto) {
    return this.paymentMethodsService.upsertRapidos(dto);
  }

  @Post()
  @Roles('admin')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Crear medio de pago con opciones de cuotas',
    description: 'Paridad POST /api/configuracion/medios-de-pago. Solo admin.',
  })
  create(@Body() dto: CreateMedioPagoDto) {
    return this.paymentMethodsService.create(dto);
  }

  @Patch(':id')
  @Roles('admin')
  @ApiOperation({
    summary: 'Actualizar medio de pago y/o reemplazar opciones',
    description: 'Paridad PATCH /api/configuracion/medios-de-pago/:id. Solo admin.',
  })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMedioPagoDto) {
    return this.paymentMethodsService.update(id, dto);
  }

  @Delete(':id')
  @Roles('admin')
  @ApiOperation({
    summary: 'Eliminar medio de pago',
    description: 'Paridad DELETE /api/configuracion/medios-de-pago/:id. Solo admin.',
  })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.paymentMethodsService.remove(id);
  }
}
