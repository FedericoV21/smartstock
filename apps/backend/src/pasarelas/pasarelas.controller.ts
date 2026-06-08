import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import {
  CajaPasarelasQueryDto,
  MpQrPasarelaSetupDto,
  MpQrPasarelaStoresDto,
  PatchCajaPasarelasDto,
} from './dto/pasarela-caja.dto';
import { PasarelasCajaService } from './pasarelas-caja.service';
import { PasarelasMpQrService } from './pasarelas-mp-qr.service';

@ApiTags('pasarelas')
@ApiBearerAuth('access-token')
@Controller('configuracion/cajas/:cajaId/pasarelas')
export class CajaPasarelasController {
  constructor(private readonly service: PasarelasCajaService) {}

  @Get()
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({ summary: 'Pasarelas vinculadas a una caja' })
  list(
    @CurrentUser() user: AccessTokenPayload,
    @Param('cajaId') cajaId: string,
    @Query() query: CajaPasarelasQueryDto,
  ) {
    const solo = query.solo_habilitadas === '1';
    return this.service.listForCaja(user, cajaId, solo);
  }

  @Patch()
  @Roles('admin')
  @ApiOperation({ summary: 'Vincular pasarelas a caja' })
  patch(
    @CurrentUser() user: AccessTokenPayload,
    @Param('cajaId') cajaId: string,
    @Body() dto: PatchCajaPasarelasDto,
  ) {
    return this.service.patchForCaja(user, cajaId, dto);
  }
}

@ApiTags('pasarelas')
@ApiBearerAuth('access-token')
@Controller('pasarelas/mp-qr')
export class PasarelasMpQrController {
  constructor(private readonly service: PasarelasMpQrService) {}

  @Post('stores')
  @Roles('admin')
  @ApiOperation({ summary: 'Listar locales MP para setup QR' })
  stores(@Body() dto: MpQrPasarelaStoresDto) {
    return this.service.listStores(dto);
  }

  @Post('setup')
  @Roles('admin')
  @ApiOperation({ summary: 'Setup asistido MP QR → pasarela_integracion' })
  setup(@Body() dto: MpQrPasarelaSetupDto) {
    return this.service.setup(dto);
  }
}
