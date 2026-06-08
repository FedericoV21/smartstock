import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, In, Repository } from 'typeorm';

import { llamarGeminiTexto } from '../ai/utils/gemini';
import { Cliente } from '../catalog/entities/cliente.entity';
import { Proveedor } from '../catalog/entities/proveedor.entity';
import { CuentaCorriente } from '../importaciones/entities/cuenta-corriente.entity';
import { Producto } from '../products/entities/producto.entity';
import { StockSucursal } from '../branches/entities/stock-sucursal.entity';
import { ReportsAdvancedService } from '../reports/reports-advanced.service';
import { ReportsService } from '../reports/reports.service';
import { WhatsappAgentTurnLog } from './entities/whatsapp-agent-turn-log.entity';
import {
  detectIntentByRules,
  type AgentIntent,
  type IntentDetection,
} from './utils/whatsapp-sandbox-intent.util';

export type ReadOnlyAgentResult = {
  reply: string;
  intent: AgentIntent;
  confidence: number;
  tool: string | null;
  fallbackReason: string | null;
};

function formatAmount(value: number): string {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(value);
}

function formatStockQty(value: number): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return '0';
  const isInteger = Math.abs(n - Math.trunc(n)) < 0.0005;
  return new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: isInteger ? 0 : 3,
    maximumFractionDigits: 3,
  }).format(n);
}

function sanitizeLike(text: string): string {
  return text.replace(/[%_,]/g, ' ').replace(/\s+/g, ' ').trim();
}

@Injectable()
export class WhatsappReadOnlyAgentService {
  constructor(
    private readonly config: ConfigService,
    private readonly reports: ReportsService,
    private readonly reportsAdvanced: ReportsAdvancedService,
    @InjectRepository(Producto) private readonly productoRepo: Repository<Producto>,
    @InjectRepository(Cliente) private readonly clienteRepo: Repository<Cliente>,
    @InjectRepository(Proveedor) private readonly proveedorRepo: Repository<Proveedor>,
    @InjectRepository(CuentaCorriente) private readonly cuentaRepo: Repository<CuentaCorriente>,
    @InjectRepository(StockSucursal) private readonly stockSucursalRepo: Repository<StockSucursal>,
    @InjectRepository(WhatsappAgentTurnLog) private readonly turnLogRepo: Repository<WhatsappAgentTurnLog>,
  ) {}

  async run(params: {
    tenantId: string;
    textBody: string;
    channel: 'sandbox' | 'live';
    source: string;
    actorId?: string | null;
    usuarioId?: string | null;
    inboundMessageId?: string | null;
    fromWaId?: string | null;
  }): Promise<ReadOnlyAgentResult> {
    const startedAt = Date.now();
    const detection = detectIntentByRules(params.textBody);
    let tool: string | null = null;
    let status = 'success';
    let reply = '';
    let errorDetail: string | null = null;

    try {
      const executed = await this.executeIntent(detection, params.tenantId);
      tool = executed.tool;
      reply = executed.reply;
    } catch (e) {
      status = 'error';
      errorDetail = e instanceof Error ? e.message : String(e);
      reply = `No pude completar la consulta: ${errorDetail}`;
    }

    if (!reply) {
      status = 'fallback';
      reply = this.fallbackReply(detection);
    }

    reply = await this.maybePolishReply(reply, params.textBody, detection.intent);

    await this.logTurn({
      ...params,
      detection,
      reply,
      tool,
      status,
      errorDetail,
      durationMs: Date.now() - startedAt,
    });

    return {
      reply,
      intent: detection.intent,
      confidence: detection.confidence,
      tool,
      fallbackReason: detection.fallbackReason ?? null,
    };
  }

  private async executeIntent(
    detection: IntentDetection,
    tenantId: string,
  ): Promise<{ reply: string; tool: string | null }> {
    switch (detection.intent) {
      case 'assistant_greeting':
        return {
          tool: null,
          reply:
            'Hola. Soy el asistente de consultas de SmartStock. Puedo ayudarte con stock, deudas y resumen comercial.',
        };
      case 'assistant_help':
        return {
          tool: null,
          reply: [
            'Puedo consultar:',
            '- Stock de un producto (ej: "stock de coca")',
            '- Deuda de cliente o proveedor',
            '- Resumen comercial del dia o mes',
            '- Listado de deudas de clientes o proveedores',
          ].join('\n'),
        };
      case 'unsupported_action':
        return {
          tool: null,
          reply:
            'Esa accion modifica datos y no esta disponible por chat en este MVP. Usa la app web para registrar pagos, cobros o ajustes.',
        };
      case 'stock_producto':
        return this.toolStockProducto(tenantId, detection.targetName);
      case 'cliente_deuda':
        return this.toolClienteDeuda(tenantId, detection.targetName);
      case 'proveedor_deuda':
        return this.toolProveedorDeuda(tenantId, detection.targetName);
      case 'reporte_resumen':
        return this.toolReporteResumen();
      case 'reporte_deuda_clientes':
        return this.toolReporteDeudaClientes();
      case 'reporte_deuda_proveedores':
        return this.toolReporteDeudaProveedores(tenantId);
      default:
        return { tool: null, reply: '' };
    }
  }

  private async toolStockProducto(
    tenantId: string,
    targetName: string | null,
  ): Promise<{ reply: string; tool: string }> {
    if (!targetName?.trim()) {
      return { tool: 'stock_producto', reply: 'Decime que producto queres consultar, por ejemplo: "stock de arroz".' };
    }
    const like = `%${sanitizeLike(targetName)}%`;
    const rows = await this.productoRepo.find({
      where: { tenantId, activo: true, nombre: ILike(like) },
      select: { id: true, nombre: true, codigo: true, stockActual: true, unidad: true },
      order: { nombre: 'ASC' },
      take: 5,
    });
    let products = rows;
    if (products.length === 0) {
      products = await this.productoRepo.find({
        where: { tenantId, activo: true, codigo: ILike(like) },
        select: { id: true, nombre: true, codigo: true, stockActual: true, unidad: true },
        order: { nombre: 'ASC' },
        take: 5,
      });
    }
    if (products.length === 0) {
      return { tool: 'stock_producto', reply: `No encontre productos que coincidan con "${targetName}".` };
    }
    if (products.length > 1) {
      const options = products
        .map((p, i) => `${i + 1}. ${p.nombre}${p.codigo ? ` (${p.codigo})` : ''}`)
        .join('\n');
      return {
        tool: 'stock_producto',
        reply: `Encontre varios productos:\n${options}\n\nReformula la consulta con mas detalle.`,
      };
    }
    const p = products[0]!;
    const stockRows = await this.stockSucursalRepo.find({
      where: { tenantId, productoId: p.id },
      select: { stockActual: true, sucursalId: true },
    });
    const stockTotal =
      stockRows.length > 0
        ? stockRows.reduce((acc, s) => acc + Number(s.stockActual), 0)
        : Number(p.stockActual);
    return {
      tool: 'stock_producto',
      reply: `Stock de ${p.nombre}: ${formatStockQty(stockTotal)} ${p.unidad ?? 'u'}.`,
    };
  }

  private async toolClienteDeuda(
    tenantId: string,
    targetName: string | null,
  ): Promise<{ reply: string; tool: string }> {
    if (!targetName?.trim()) {
      return { tool: 'cliente_deuda', reply: 'Decime el nombre del cliente, por ejemplo: "cuanto me debe Juan".' };
    }
    const like = `%${sanitizeLike(targetName)}%`;
    const clientes = await this.clienteRepo.find({
      where: [
        { tenantId, activo: true, nombre: ILike(like) },
        { tenantId, activo: true, razonSocial: ILike(like) },
      ],
      select: { id: true, nombre: true, razonSocial: true },
      take: 5,
    });
    if (clientes.length === 0) {
      return { tool: 'cliente_deuda', reply: `No encontre clientes que coincidan con "${targetName}".` };
    }
    if (clientes.length > 1) {
      const options = clientes.map((c, i) => `${i + 1}. ${c.razonSocial || c.nombre}`).join('\n');
      return { tool: 'cliente_deuda', reply: `Varios clientes:\n${options}\n\nEspecifica mejor el nombre.` };
    }
    const cliente = clientes[0]!;
    const cuenta = await this.cuentaRepo.findOne({
      where: { tenantId, clienteId: cliente.id, tipoCuenta: 'cliente' },
      select: { saldo: true },
    });
    const saldo = Number(cuenta?.saldo ?? 0);
    const nombre = cliente.razonSocial || cliente.nombre;
    if (saldo <= 0.01) {
      return { tool: 'cliente_deuda', reply: `${nombre} no registra deuda pendiente.` };
    }
    return { tool: 'cliente_deuda', reply: `${nombre} debe ${formatAmount(saldo)}.` };
  }

  private async toolProveedorDeuda(
    tenantId: string,
    targetName: string | null,
  ): Promise<{ reply: string; tool: string }> {
    if (!targetName?.trim()) {
      return {
        tool: 'proveedor_deuda',
        reply: 'Decime el nombre del proveedor, por ejemplo: "cuanto le debo a Acme".',
      };
    }
    const like = `%${sanitizeLike(targetName)}%`;
    const proveedores = await this.proveedorRepo.find({
      where: { tenantId, activo: true, nombre: ILike(like) },
      select: { id: true, nombre: true },
      take: 5,
    });
    if (proveedores.length === 0) {
      return { tool: 'proveedor_deuda', reply: `No encontre proveedores que coincidan con "${targetName}".` };
    }
    if (proveedores.length > 1) {
      const options = proveedores.map((p, i) => `${i + 1}. ${p.nombre}`).join('\n');
      return { tool: 'proveedor_deuda', reply: `Varios proveedores:\n${options}\n\nEspecifica mejor el nombre.` };
    }
    const proveedor = proveedores[0]!;
    const cuenta = await this.cuentaRepo.findOne({
      where: { tenantId, proveedorId: proveedor.id, tipoCuenta: 'proveedor' },
      select: { saldo: true },
    });
    const saldo = Number(cuenta?.saldo ?? 0);
    if (saldo <= 0.01) {
      return { tool: 'proveedor_deuda', reply: `No registras deuda con ${proveedor.nombre}.` };
    }
    return { tool: 'proveedor_deuda', reply: `Le debes a ${proveedor.nombre}: ${formatAmount(saldo)}.` };
  }

  private async toolReporteResumen(): Promise<{ reply: string; tool: string }> {
    const result = await this.reports.getSummary({ periodo: 'hoy' });
    const data = 'data' in result ? result.data : null;
    if (!data) {
      return { tool: 'reporte_resumen', reply: 'No pude generar el resumen comercial.' };
    }
    const kpis = data.kpis as Record<string, number>;
    const periodo = data.periodo as { label?: string };
    return {
      tool: 'reporte_resumen',
      reply: [
        `Resumen ${periodo.label ?? 'hoy'}:`,
        `Facturado: ${formatAmount(Number(kpis.facturado ?? 0))}`,
        `Tickets POS: ${formatAmount(Number(kpis.monto_tickets_pos ?? 0))}`,
        `Deuda Cta Cte clientes: ${formatAmount(Number(kpis.deuda_cta_cte ?? 0))}`,
        `Gasto proveedores: ${formatAmount(Number(kpis.gasto_proveedores ?? 0))}`,
      ].join('\n'),
    };
  }

  private async toolReporteDeudaClientes(): Promise<{ reply: string; tool: string }> {
    const result = await this.reportsAdvanced.getCustomerDebt({});
    const data = 'data' in result ? result.data : null;
    if (!data) return { tool: 'reporte_deuda_clientes', reply: 'No pude consultar deudas de clientes.' };
    const resumen = data.resumen as {
      deuda_total: number;
      clientes_deudores: number;
    };
    const items = (data.items as { cliente_nombre: string; saldo_total: number }[]).slice(0, 5);
    const lines = [
      `Deuda total clientes: ${formatAmount(Number(resumen.deuda_total ?? 0))}`,
      `Clientes deudores: ${resumen.clientes_deudores ?? 0}`,
    ];
    if (items.length > 0) {
      lines.push('Top deudores:');
      for (const it of items) {
        if (it.saldo_total > 0) lines.push(`- ${it.cliente_nombre}: ${formatAmount(it.saldo_total)}`);
      }
    }
    return { tool: 'reporte_deuda_clientes', reply: lines.join('\n') };
  }

  private async toolReporteDeudaProveedores(tenantId: string): Promise<{ reply: string; tool: string }> {
    const cuentas = await this.cuentaRepo.find({
      where: { tenantId, tipoCuenta: 'proveedor' },
      select: { proveedorId: true, saldo: true },
    });
    const provIds = cuentas.map((c) => c.proveedorId).filter(Boolean) as string[];
    const proveedores =
      provIds.length > 0
        ? await this.proveedorRepo.find({
            where: { tenantId, id: In(provIds) },
            select: { id: true, nombre: true },
          })
        : [];
    const nombres = new Map(proveedores.map((p) => [p.id, p.nombre]));
    const items = cuentas
      .map((c) => ({
        nombre: nombres.get(c.proveedorId!) ?? 'Proveedor',
        saldo: Number(c.saldo),
      }))
      .filter((c) => c.saldo > 0.01)
      .sort((a, b) => b.saldo - a.saldo);
    const total = items.reduce((acc, it) => acc + it.saldo, 0);
    const lines = [
      `Deuda total proveedores: ${formatAmount(total)}`,
      `Proveedores con saldo: ${items.length}`,
    ];
    for (const it of items.slice(0, 5)) {
      lines.push(`- ${it.nombre}: ${formatAmount(it.saldo)}`);
    }
    return { tool: 'reporte_deuda_proveedores', reply: lines.join('\n') };
  }

  private fallbackReply(detection: IntentDetection): string {
    if (detection.fallbackReason === 'outside_read_only_catalog') {
      return 'Esa consulta no esta disponible en el asistente MVP. Proba "ayuda" para ver ejemplos.';
    }
    return [
      'No entendi la consulta.',
      'Ejemplos: "stock de arroz", "cuanto me debe Juan", "resumen de hoy", "deuda de proveedores".',
    ].join('\n');
  }

  private async maybePolishReply(reply: string, userText: string, intent: AgentIntent): Promise<string> {
    if (!process.env.GEMINI_API_KEY?.trim()) return reply;
    if (intent === 'unsupported_action' || intent === 'unknown') return reply;
    try {
      const polished = await llamarGeminiTexto(
        [
          'Reescribi la respuesta del asistente SmartStock en espanol rioplatense, breve y clara.',
          'No inventes datos. Mantene numeros y nombres exactos.',
          `Usuario: ${userText}`,
          `Respuesta base: ${reply}`,
        ].join('\n'),
      );
      const clean = polished.trim();
      return clean.length > 20 ? clean : reply;
    } catch {
      return reply;
    }
  }

  private async logTurn(params: {
    tenantId: string;
    textBody: string;
    channel: 'sandbox' | 'live';
    source: string;
    actorId?: string | null;
    usuarioId?: string | null;
    inboundMessageId?: string | null;
    fromWaId?: string | null;
    detection: IntentDetection;
    reply: string;
    tool: string | null;
    status: string;
    errorDetail: string | null;
    durationMs: number;
  }): Promise<void> {
    const retentionDays = Number(this.config.get('WHATSAPP_AGENT_LOG_RETENTION_DAYS') ?? 30);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + (Number.isFinite(retentionDays) ? retentionDays : 30));

    await this.turnLogRepo.save(
      this.turnLogRepo.create({
        tenantId: params.tenantId,
        actorId: params.actorId ?? null,
        usuarioId: params.usuarioId ?? null,
        inboundMessageId: params.inboundMessageId ?? null,
        fromWaId: params.fromWaId ?? null,
        channel: params.channel,
        source: params.source,
        inputBody: params.textBody.slice(0, 4000),
        replyBody: params.reply.slice(0, 4000),
        intent: params.detection.intent,
        confidence: String(params.detection.confidence),
        fallbackReason: params.detection.fallbackReason ?? null,
        status: params.status,
        toolName: params.tool,
        durationMs: params.durationMs,
        errorDetail: params.errorDetail,
        expiresAt,
        processingTrace: {},
        replies: [{ body: params.reply, messageType: 'text' }],
      }),
    );
  }
}
