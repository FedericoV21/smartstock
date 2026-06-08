import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { DespieceCalculoService } from './despiece-calculo.service';
import { DespieceIngresosService } from './despiece-ingresos.service';
import { DespiecePlantillasService } from './despiece-plantillas.service';
import { DespiecePredeterminadasService } from './despiece-predeterminadas.service';
import { DespieceProductosCorteService } from './despiece-productos-corte.service';

@ApiTags('despiece')
@ApiBearerAuth('access-token')
@Controller('despiece')
export class DespieceController {
  constructor(
    private readonly calculoService: DespieceCalculoService,
    private readonly plantillasService: DespiecePlantillasService,
    private readonly ingresosService: DespieceIngresosService,
    private readonly productosCorteService: DespieceProductosCorteService,
    private readonly predeterminadasService: DespiecePredeterminadasService,
  ) {}

  @Post('calcular')
  @Roles('admin', 'operador', 'visor')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Calcular estrategias', description: 'Paridad POST /api/despiece/calcular' })
  calcular(@Body() body: unknown, @CurrentUser() user: AccessTokenPayload) {
    return this.calculoService.calcular(body, user);
  }

  @Get('plantillas')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({ summary: 'Listar plantillas', description: 'Paridad GET /api/despiece/plantillas' })
  listPlantillas(
    @Query('activo') activo: string | undefined,
    @Query('q') q: string | undefined,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.plantillasService.list({ activo, q }, user);
  }

  @Post('plantillas')
  @Roles('admin', 'operador')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear plantilla', description: 'Paridad POST /api/despiece/plantillas' })
  createPlantilla(@Body() body: unknown, @CurrentUser() user: AccessTokenPayload) {
    return this.plantillasService.create(body, user);
  }

  @Get('plantillas/:id')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({ summary: 'Obtener plantilla', description: 'Paridad GET /api/despiece/plantillas/[id]' })
  getPlantilla(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AccessTokenPayload) {
    return this.plantillasService.getById(id, user);
  }

  @Put('plantillas/:id')
  @Roles('admin', 'operador')
  @ApiOperation({ summary: 'Actualizar plantilla', description: 'Paridad PUT /api/despiece/plantillas/[id]' })
  updatePlantilla(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.plantillasService.update(id, body, user);
  }

  @Delete('plantillas/:id')
  @Roles('admin', 'operador')
  @ApiOperation({ summary: 'Desactivar plantilla', description: 'Paridad DELETE /api/despiece/plantillas/[id]' })
  deletePlantilla(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AccessTokenPayload) {
    return this.plantillasService.softDelete(id, user);
  }

  @Post('plantillas/:id/aplicar')
  @Roles('admin', 'operador')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Aplicar precios', description: 'Paridad POST /api/despiece/plantillas/[id]/aplicar' })
  aplicarPlantilla(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.plantillasService.aplicar(id, body, user);
  }

  @Post('plantillas/:id/sincronizar-catalogo')
  @Roles('admin', 'operador')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sincronizar catálogo',
    description: 'Paridad POST /api/despiece/plantillas/[id]/sincronizar-catalogo',
  })
  sincronizarCatalogo(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.plantillasService.sincronizarCatalogo(id, body, user);
  }

  @Post('ingresos')
  @Roles('admin', 'operador')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Registrar ingreso', description: 'Paridad POST /api/despiece/ingresos' })
  registrarIngreso(@Body() body: unknown, @CurrentUser() user: AccessTokenPayload) {
    return this.ingresosService.registrar(body, user);
  }

  @Get('productos-corte')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({ summary: 'Productos elegibles', description: 'Paridad GET /api/despiece/productos-corte' })
  listProductosCorte(@Query('q') q: string | undefined, @CurrentUser() user: AccessTokenPayload) {
    return this.productosCorteService.list(q, user);
  }

  @Post('predeterminadas')
  @Roles('admin', 'operador')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cargar predeterminadas', description: 'Paridad POST /api/despiece/predeterminadas' })
  cargarPredeterminadas(@Body() body: unknown, @CurrentUser() user: AccessTokenPayload) {
    return this.predeterminadasService.cargar(body, user);
  }
}
