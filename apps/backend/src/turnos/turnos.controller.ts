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
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { CobrarReservaDto } from './dto/cobrar-reserva.dto';
import { ConfirmarCobroReservaDto } from './dto/confirmar-cobro-reserva.dto';
import { CreateAgendaDto } from './dto/create-agenda.dto';
import { CreateBloqueoDto } from './dto/create-bloqueo.dto';
import { CreateReservaDto } from './dto/create-reserva.dto';
import { CreateReservaFijaDto } from './dto/create-reserva-fija.dto';
import { ListBloqueosQueryDto } from './dto/list-bloqueos-query.dto';
import { ListReservasQueryDto } from './dto/list-reservas-query.dto';
import { ListReservasFijasQueryDto } from './dto/list-reservas-fijas-query.dto';
import { ListSlotsQueryDto } from './dto/list-slots-query.dto';
import { ListTurnosSucursalQueryDto } from './dto/list-turnos-query.dto';
import { UpdateAgendaDto } from './dto/update-agenda.dto';
import { UpdateReservaDto } from './dto/update-reserva.dto';
import { TurnosAgendasService } from './turnos-agendas.service';
import { TurnosBloqueosService } from './turnos-bloqueos.service';
import { TurnosReservasFijasService } from './turnos-reservas-fijas.service';
import { TurnosReservasService } from './turnos-reservas.service';
import { TurnosSlotsService } from './turnos-slots.service';

@ApiTags('turnos')
@ApiBearerAuth('access-token')
@Controller('turnos')
export class TurnosController {
  constructor(
    private readonly agendasService: TurnosAgendasService,
    private readonly bloqueosService: TurnosBloqueosService,
    private readonly reservasService: TurnosReservasService,
    private readonly reservasFijasService: TurnosReservasFijasService,
    private readonly slotsService: TurnosSlotsService,
  ) {}

  @Get('agendas')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({ summary: 'Listar agendas', description: 'Paridad GET /api/turnos/agendas' })
  listAgendas(@Query() query: ListTurnosSucursalQueryDto) {
    return this.agendasService.list(query);
  }

  @Post('agendas')
  @Roles('admin', 'operador')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear agenda', description: 'Paridad POST /api/turnos/agendas' })
  createAgenda(@Body() dto: CreateAgendaDto, @CurrentUser() user: AccessTokenPayload) {
    return this.agendasService.create(dto, user);
  }

  @Patch('agendas/:id')
  @Roles('admin', 'operador')
  @ApiOperation({ summary: 'Actualizar agenda', description: 'Paridad PATCH /api/turnos/agendas/[id]' })
  updateAgenda(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAgendaDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.agendasService.update(id, dto, user);
  }

  @Delete('agendas/:id')
  @Roles('admin', 'operador')
  @ApiOperation({ summary: 'Desactivar agenda', description: 'Paridad DELETE /api/turnos/agendas/[id]' })
  deleteAgenda(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AccessTokenPayload) {
    return this.agendasService.softDelete(id, user);
  }

  @Get('bloqueos')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({ summary: 'Listar bloqueos', description: 'Paridad GET /api/turnos/bloqueos' })
  listBloqueos(@Query() query: ListBloqueosQueryDto) {
    return this.bloqueosService.list(query);
  }

  @Post('bloqueos')
  @Roles('admin', 'operador')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear bloqueo', description: 'Paridad POST /api/turnos/bloqueos' })
  createBloqueo(@Body() dto: CreateBloqueoDto, @CurrentUser() user: AccessTokenPayload) {
    return this.bloqueosService.create(dto, user);
  }

  @Delete('bloqueos/:id')
  @Roles('admin', 'operador')
  @ApiOperation({ summary: 'Eliminar bloqueo', description: 'Paridad DELETE /api/turnos/bloqueos/[id]' })
  deleteBloqueo(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AccessTokenPayload) {
    return this.bloqueosService.delete(id, user);
  }

  @Get('reservas')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({ summary: 'Listar reservas', description: 'Paridad GET /api/turnos/reservas' })
  listReservas(@Query() query: ListReservasQueryDto) {
    return this.reservasService.list(query);
  }

  @Post('reservas')
  @Roles('admin', 'operador')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear reserva', description: 'Paridad POST /api/turnos/reservas' })
  createReserva(@Body() dto: CreateReservaDto, @CurrentUser() user: AccessTokenPayload) {
    return this.reservasService.create(dto, user);
  }

  @Patch('reservas/:id')
  @Roles('admin', 'operador')
  @ApiOperation({ summary: 'Editar reserva', description: 'Paridad PATCH /api/turnos/reservas/[id]' })
  patchReserva(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateReservaDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.reservasService.patch(id, dto, user);
  }

  @Post('reservas/:id/cancelar')
  @Roles('admin', 'operador')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancelar reserva', description: 'Paridad POST /api/turnos/reservas/[id]/cancelar' })
  cancelarReserva(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AccessTokenPayload) {
    return this.reservasService.cancelar(id, user);
  }

  @Post('reservas/:id/cobrar')
  @Roles('admin', 'operador')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Cobrar reserva', description: 'Paridad POST /api/turnos/reservas/[id]/cobrar' })
  cobrarReserva(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CobrarReservaDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.reservasService.cobrar(id, dto, user);
  }

  @Post('reservas/:id/confirmar-cobro')
  @Roles('admin', 'operador')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirmar cobro POS',
    description: 'Paridad POST /api/turnos/reservas/[id]/confirmar-cobro',
  })
  confirmarCobro(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmarCobroReservaDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.reservasService.confirmarCobro(id, dto, user);
  }

  @Get('reservas-fijas')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({ summary: 'Listar reservas fijas', description: 'Paridad GET /api/turnos/reservas-fijas' })
  listReservasFijas(@Query() query: ListReservasFijasQueryDto) {
    return this.reservasFijasService.list(query);
  }

  @Post('reservas-fijas')
  @Roles('admin', 'operador')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear reserva fija', description: 'Paridad POST /api/turnos/reservas-fijas' })
  createReservaFija(@Body() dto: CreateReservaFijaDto, @CurrentUser() user: AccessTokenPayload) {
    return this.reservasFijasService.create(dto, user);
  }

  @Delete('reservas-fijas/:id')
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Desactivar reserva fija',
    description: 'Paridad DELETE /api/turnos/reservas-fijas/[id]',
  })
  deleteReservaFija(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AccessTokenPayload) {
    return this.reservasFijasService.softDelete(id, user);
  }

  @Get('slots')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({ summary: 'Slots disponibles', description: 'Paridad GET /api/turnos/slots' })
  listSlots(@Query() query: ListSlotsQueryDto) {
    return this.slotsService.list(query);
  }
}
