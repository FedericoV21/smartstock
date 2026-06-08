import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';

import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { SucursalContext } from '../branches/sucursal-context.service';
import { LectorFacturasBaseService } from './lector-facturas-base.service';
import { LectorConfirmacionImportadoService } from './lector-confirmacion-importado.service';
import {
  parseConfirmarImportadoLectorJson,
  validarCombinacionConfirmar,
  validarItemsConfirmarImportado,
} from './utils/confirmar-importado.util';

@Injectable()
export class LectorFacturasConfirmService {
  constructor(
    private readonly base: LectorFacturasBaseService,
    private readonly confirmacion: LectorConfirmacionImportadoService,
    private readonly sucursalContext: SucursalContext,
  ) {}

  async confirmar(body: unknown, user: AccessTokenPayload) {
    await this.base.assertModuloLector();
    this.base.assertNotVisor(user);

    const parsed = parseConfirmarImportadoLectorJson(body);
    if (!parsed) {
      throw new BadRequestException('Body inválido');
    }

    const comboErr = validarCombinacionConfirmar(parsed);
    if (comboErr) {
      throw new BadRequestException(comboErr);
    }

    const errItems = validarItemsConfirmarImportado(parsed);
    if (errItems) {
      throw new BadRequestException(errItems);
    }

    const tenantId = this.base.getTenantId();
    const sucursalId = parsed.sucursal_id ?? (await this.sucursalContext.requireSucursalId());
    if (!sucursalId) {
      throw new BadRequestException('No hay sucursal operativa seleccionada.');
    }

    const result = await this.confirmacion.ejecutar({
      tenantId,
      sucursalId,
      userId: user.sub,
      body: parsed,
      origen: 'lector',
    });

    return {
      comprobante_id: result.comprobante_id,
      actualizaciones_costos: result.actualizaciones_costos.map((a) => ({
        producto_id: a.producto_id,
        codigo: a.codigo,
        nombre: a.nombre,
        precio_costo_anterior: a.precio_costo_anterior,
        precio_costo_nuevo: a.precio_costo_nuevo,
        precio_venta_anterior: a.precio_venta_anterior,
        precio_venta_nuevo: a.precio_venta_nuevo,
        variacion_pct: a.variacion_pct,
      })),
      pdf_url: result.pdf_url,
    };
  }
}
