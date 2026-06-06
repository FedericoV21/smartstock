import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { Proveedor } from '../catalog/entities/proveedor.entity';
import { CreateSupplierObligationDto, SupplierObligationModo } from './dto/create-supplier-obligation.dto';
import { CuentaCorriente } from './entities/cuenta-corriente.entity';
import { PagoProveedorFactura } from './entities/pago-proveedor-factura.entity';
import {
  calcularSaldoPendienteNuevoCargo,
  calcularVencimientoDia,
  proveedorTieneCondicionPagoCargada,
  vencimientoDefaultPersonalizado,
  vencimientoTimestamptzDesdeDia,
} from './utils/pago-proveedor-vencimiento.util';

@Injectable()
export class ImportSupplierObligationService {
  constructor(
    @InjectRepository(Proveedor)
    private readonly proveedorRepo: Repository<Proveedor>,
    @InjectRepository(CuentaCorriente)
    private readonly cuentaRepo: Repository<CuentaCorriente>,
    @InjectRepository(PagoProveedorFactura)
    private readonly obligacionRepo: Repository<PagoProveedorFactura>,
    private readonly tenantContext: TenantContext,
  ) {}

  async create(dto: CreateSupplierObligationDto) {
    const tenantId = this.tenantContext.getTenantId();

    if (!dto.proveedorId) {
      throw new BadRequestException('Falta el proveedor');
    }
    if (dto.monto == null || dto.monto <= 0) {
      throw new BadRequestException('El monto de la obligaci├│n debe ser mayor a cero');
    }

    const fechaOperacionYmd = (dto.fechaOperacionYmd ?? new Date().toISOString().slice(0, 10)).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaOperacionYmd)) {
      throw new BadRequestException('La fecha de operaci├│n debe ser YYYY-MM-DD');
    }

    if (dto.modo === SupplierObligationModo.FECHA_FIJA) {
      const v = dto.vencimientoYmd;
      if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
        throw new BadRequestException('Indic├í la fecha de vencimiento de pago');
      }
    }

    const proveedor = await this.proveedorRepo.findOne({
      where: { id: dto.proveedorId, tenantId },
    });
    if (!proveedor) {
      throw new NotFoundException('Proveedor no encontrado');
    }

    const provCondicion = {
      condicionPagoDefault: proveedor.condicionPagoDefault,
      plazoPagoDias: proveedor.plazoPagoDias,
    };

    if (dto.modo === SupplierObligationModo.CONDICION && !proveedorTieneCondicionPagoCargada(provCondicion)) {
      throw new BadRequestException(
        'Carg├í la condici├│n de pago en la ficha del proveedor, o us├í vencimiento con fecha fija.',
      );
    }

    const estadoUi =
      dto.modo === SupplierObligationModo.FECHA_FIJA ? 'pendiente_fecha_custom' : 'pendiente_condicion';

    let vencCustom = dto.vencimientoYmd ?? undefined;
    if (estadoUi === 'pendiente_fecha_custom' && (vencCustom == null || vencCustom.length < 10)) {
      vencCustom = vencimientoDefaultPersonalizado(fechaOperacionYmd, null);
    }

    const { vencimientoDiaYmd, condicion } = calcularVencimientoDia({
      estado: estadoUi,
      fechaFacturaYmd: fechaOperacionYmd,
      proveedor: provCondicion,
      vencimientoCustomYmd: estadoUi === 'pendiente_fecha_custom' ? vencCustom : null,
    });

    if (vencimientoDiaYmd < fechaOperacionYmd) {
      throw new BadRequestException('El vencimiento no puede ser anterior a la fecha de la operaci├│n');
    }

    const montoR = Math.round(dto.monto * 100) / 100;
    const cuenta = await this.cuentaRepo.findOne({
      where: { tenantId, proveedorId: dto.proveedorId },
    });
    const saldoPendienteInicial = calcularSaldoPendienteNuevoCargo(
      cuenta ? Number(cuenta.saldo) : montoR,
      montoR,
    );
    const estadoInicial =
      saldoPendienteInicial <= 0
        ? 'pagada'
        : saldoPendienteInicial < montoR - 0.01
          ? 'parcial'
          : 'pendiente';

    const ref = (dto.referencia ?? 'Importaci├│n de lista').trim().slice(0, 500);
    const saved = await this.obligacionRepo.save(
      this.obligacionRepo.create({
        tenantId,
        comprobanteId: null,
        proveedorId: dto.proveedorId,
        montoOriginal: montoR.toFixed(6),
        saldoPendiente: saldoPendienteInicial.toFixed(6),
        vencimientoAt: vencimientoTimestamptzDesdeDia(vencimientoDiaYmd),
        condicionPago: condicion,
        estado: estadoInicial,
        origen: 'import_lista',
        referencia: ref || null,
      }),
    );

    return { data: { id: saved.id } };
  }
}
