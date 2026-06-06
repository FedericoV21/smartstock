import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AiLimitService } from '../../ai/ai-limit.service';
import { GeminiError, llamarGeminiTexto } from '../../ai/utils/gemini';
import { PROMPT_REPORTE_EJECUTIVO } from '../../ai/utils/prompts';
import { TenantContext } from '../../auth/tenant-context.service';
import { Proveedor } from '../../catalog/entities/proveedor.entity';
import { ImportacionLog } from '../../importaciones/entities/importacion-log.entity';
import { ListaPreciosItem } from './entities/lista-precios-item.entity';
import { ListaPrecios } from './entities/lista-precios.entity';
import { EstadoListaPrecios } from './enums/estado-lista-precios.enum';

export type ReporteEjecutivo = {
  resumen: string;
  observaciones: string[];
  recomendaciones: string[];
  alertas: string[];
  patron_proveedor: string | null;
  categorias_mas_afectadas: string[];
};

@Injectable()
export class PriceListReportService {
  constructor(
    @InjectRepository(ListaPrecios) private readonly listaRepo: Repository<ListaPrecios>,
    @InjectRepository(ListaPreciosItem) private readonly itemRepo: Repository<ListaPreciosItem>,
    @InjectRepository(Proveedor) private readonly proveedorRepo: Repository<Proveedor>,
    @InjectRepository(ImportacionLog) private readonly importLogRepo: Repository<ImportacionLog>,
    private readonly aiLimitService: AiLimitService,
    private readonly tenantContext: TenantContext,
  ) {}

  async generarReporte(listaId: string, userId: string) {
    const tenantId = this.tenantContext.getTenantId();

    const lista = await this.listaRepo.findOne({ where: { id: listaId, tenantId } });
    if (!lista) throw new NotFoundException('Lista no encontrada');

    if (lista.estado === EstadoListaPrecios.Pendiente) {
      throw new BadRequestException(
        'La lista debe estar analizada antes de generar el reporte. Ejecut├í el an├ílisis primero.',
      );
    }

    const limite = await this.aiLimitService.verificarLimiteIA('ia_pdf');
    if (!limite.permitido && limite.limite != null) {
      throw new HttpException(
        {
          error: `L├¡mite mensual de extracciones IA alcanzado (${limite.usadas}/${limite.limite}).`,
          usadas: limite.usadas,
          limite: limite.limite,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const contexto = await this.construirContexto(tenantId, lista);
    const prompt = `${PROMPT_REPORTE_EJECUTIVO}\n\nDatos de la lista:\n${JSON.stringify(contexto, null, 2)}`;

    let reporte: ReporteEjecutivo;
    try {
      const respuesta = await llamarGeminiTexto(prompt);
      try {
        reporte = JSON.parse(respuesta) as ReporteEjecutivo;
      } catch {
        const jsonMatch = respuesta.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          throw new BadRequestException('La IA no devolvi├│ un JSON v├ílido para el reporte');
        }
        reporte = JSON.parse(jsonMatch[0]) as ReporteEjecutivo;
      }
    } catch (e) {
      if (e instanceof GeminiError) {
        if (e.code === 'config' || e.code === 'api_key') {
          throw new ServiceUnavailableException(e.message);
        }
        if (e.code === 'timeout') {
          throw new HttpException(e.message, HttpStatus.GATEWAY_TIMEOUT);
        }
        throw new HttpException(`Error de IA: ${e.message}`, HttpStatus.BAD_GATEWAY);
      }
      throw e;
    }

    reporte = {
      resumen: typeof reporte.resumen === 'string' ? reporte.resumen : '',
      observaciones: Array.isArray(reporte.observaciones) ? reporte.observaciones.slice(0, 5) : [],
      recomendaciones: Array.isArray(reporte.recomendaciones)
        ? reporte.recomendaciones.slice(0, 5)
        : [],
      alertas: Array.isArray(reporte.alertas) ? reporte.alertas.slice(0, 5) : [],
      patron_proveedor:
        typeof reporte.patron_proveedor === 'string' ? reporte.patron_proveedor : null,
      categorias_mas_afectadas: Array.isArray(reporte.categorias_mas_afectadas)
        ? reporte.categorias_mas_afectadas.slice(0, 5)
        : [],
    };

    lista.resumenIa = reporte as unknown as Record<string, unknown>;
    await this.listaRepo.save(lista);

    await this.importLogRepo.save(
      this.importLogRepo.create({
        tenantId,
        proveedorId: null,
        archivoNombre: `[IA reporte] lista ${listaId}`,
        origen: 'ia_pdf',
        totalFilas: 0,
        filasExitosas: 0,
        filasConError: 0,
        productosCreados: 0,
        productosActualizados: 0,
        detalleErrores: null,
        usuarioId: userId,
      }),
    );

    return { reporte };
  }

  private async construirContexto(tenantId: string, lista: ListaPrecios) {
    const proveedor = await this.proveedorRepo.findOne({
      where: { id: lista.proveedorId, tenantId },
      select: { id: true, nombre: true },
    });

    const items = await this.itemRepo
      .createQueryBuilder('i')
      .where('i.lista_id = :listaId', { listaId: lista.id })
      .andWhere('i.tenant_id = :tenantId', { tenantId })
      .andWhere('i.producto_id IS NOT NULL')
      .orderBy('i.variacion_pct', 'DESC', 'NULLS LAST')
      .limit(15)
      .getMany();

    const listasAnteriores = await this.listaRepo.find({
      where: {
        tenantId,
        proveedorId: lista.proveedorId,
        estado: EstadoListaPrecios.Analizada,
      },
      select: {
        id: true,
        nombre: true,
        createdAt: true,
        variacionPromedioPct: true,
        margenGlobalAnteriorPct: true,
        margenGlobalNuevoPct: true,
        totalItems: true,
        itemsConAumento: true,
      },
      order: { createdAt: 'DESC' },
      take: 6,
    });

    const historial = listasAnteriores
      .filter((l) => l.id !== lista.id)
      .slice(0, 5)
      .map((l) => ({
        fecha: l.createdAt.toISOString().slice(0, 10),
        variacion_promedio_pct:
          l.variacionPromedioPct != null ? Number(l.variacionPromedioPct) : null,
        items: l.totalItems,
        items_con_aumento: l.itemsConAumento,
      }));

    return {
      proveedor_nombre: proveedor?.nombre ?? 'Desconocido',
      lista: {
        nombre_archivo: lista.nombre,
        fecha_recepcion: lista.createdAt.toISOString().slice(0, 10),
        total_items: lista.totalItems,
        variacion_promedio_pct:
          lista.variacionPromedioPct != null ? Number(lista.variacionPromedioPct) : null,
        margen_global_anterior_pct:
          lista.margenGlobalAnteriorPct != null ? Number(lista.margenGlobalAnteriorPct) : null,
        margen_global_nuevo_pct:
          lista.margenGlobalNuevoPct != null ? Number(lista.margenGlobalNuevoPct) : null,
        items_con_aumento: lista.itemsConAumento,
        items_con_baja: 0,
        items_sin_cambio: 0,
        impacto_por_categoria: null,
      },
      items_top_variacion: items.map((i) => ({
        nombre: i.nombreProveedor,
        variacion_pct: i.variacionPct != null ? Number(i.variacionPct) : null,
        margen_anterior: i.margenActualPct != null ? Number(i.margenActualPct) : null,
        margen_nuevo: i.margenNuevoPct != null ? Number(i.margenNuevoPct) : null,
      })),
      historial_proveedor: historial,
    };
  }
}
