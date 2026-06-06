import { Body, Controller, Headers, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { ExecuteImportRequestDto } from './dto/execute-import-request.dto';
import { ImportPreviewRequestDto } from './dto/import-preview-request.dto';
import { ImportacionesService } from './importaciones.service';

@ApiTags('importaciones')
@ApiBearerAuth('access-token')
@Controller('importaciones')
export class ImportacionesController {
  constructor(private readonly importacionesService: ImportacionesService) {}

  @Post('preview')
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Preview server-side de importaci├│n',
    description:
      'Valida filas, detecta errores por campo/fila y estima si cada fila crea o actualiza producto por c├│digo/barcode.',
  })
  preview(@Body() dto: ImportPreviewRequestDto) {
    return this.importacionesService.previewImport(dto);
  }

  @Post('ejecutar')
  @Roles('admin', 'operador')
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'Clave ├║nica por request para evitar ejecuciones duplicadas',
  })
  @ApiOperation({
    summary: 'Ejecutar importaci├│n (upsert transaccional)',
    description:
      'Aplica filas v├ílidas en transacci├│n, registra movimientos/historial de precio y respeta Idempotency-Key.',
  })
  ejecutar(
    @Body() dto: ExecuteImportRequestDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.importacionesService.executeImport(dto, idempotencyKey ?? '', user);
  }
}
