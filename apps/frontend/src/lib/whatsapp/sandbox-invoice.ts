import { randomUUID } from 'node:crypto';

import {
  prepararConfirmacionLectorFacturaDesdeResultado,
} from '@/lib/lector-facturas/confirmacion-chatbot';
import {
  procesarFacturaIa,
  validarArchivosFacturaIa,
  type ArchivoFacturaEntrada,
} from '@/lib/lector-facturas/procesar-factura-ia';
import { resolverBorradorUrlWhatsapp } from '@/lib/lector-facturas/borradores-whatsapp';
import {
  buildWhatsAppSandboxInvoiceTicketSnapshot,
  buildWhatsAppInvoiceTicketChatSummary,
  createOrReuseInvoiceAction,
  ensureWhatsAppSandboxActor,
  insertWhatsAppSandboxInvoiceTicket,
  insertWhatsAppSandboxMessage,
  loadWhatsAppSandboxMessages,
  type SandboxInvoiceTicket,
  type WhatsAppSandboxMessage,
  type WhatsAppSandboxRole,
} from '@/lib/whatsapp/sandbox';

function uploadedFilesSummary(archivos: ArchivoFacturaEntrada[]): string {
  const names = archivos.map((archivo) => archivo.name || 'factura').slice(0, 4);
  const rest = archivos.length > names.length ? ` y ${archivos.length - names.length} mas` : '';
  return `${names.join(', ')}${rest}`;
}

function jobFilesFromPreview(result: unknown) {
  const obj = result && typeof result === 'object' && !Array.isArray(result)
    ? (result as Record<string, unknown>)
    : {};
  const multipagina = obj.multipagina && typeof obj.multipagina === 'object' && !Array.isArray(obj.multipagina)
    ? (obj.multipagina as Record<string, unknown>)
    : {};
  const archivos = Array.isArray(multipagina.archivos) ? multipagina.archivos : [];
  return archivos
    .map((archivo) => {
      const row = archivo && typeof archivo === 'object' && !Array.isArray(archivo)
        ? (archivo as Record<string, unknown>)
        : {};
      const storagePath = typeof row.storagePath === 'string' ? row.storagePath : '';
      if (!storagePath) return null;
      return {
        nombre: typeof row.nombre === 'string' ? row.nombre : 'factura',
        mimeType: typeof row.mimeType === 'string' ? row.mimeType : 'application/octet-stream',
        size: Number.isFinite(Number(row.size)) ? Number(row.size) : 0,
        storageBucket: 'facturas-recibidas',
        storagePath,
      };
    })
    .filter((row): row is {
      nombre: string;
      mimeType: string;
      size: number;
      storageBucket: string;
      storagePath: string;
    } => row != null);
}

function rawIaSnippet(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, 600) : null;
}

export async function processWhatsAppSandboxInvoiceUpload(params: {
  db: any;
  tenantId: string;
  userId: string;
  role: WhatsAppSandboxRole;
  sucursalId: string;
  archivos: ArchivoFacturaEntrada[];
}): Promise<{
  ok: true;
  messages: WhatsAppSandboxMessage[];
  job_id: string | null;
  impact_hash: string | null;
  action_id: string | null;
  ticket: SandboxInvoiceTicket;
} | {
  ok: false;
  status: number;
  error: string;
  messages: WhatsAppSandboxMessage[];
}> {
  const validacion = validarArchivosFacturaIa(params.archivos);
  if (!validacion.ok) {
    return {
      ok: false,
      status: validacion.status,
      error: validacion.error,
      messages: await loadWhatsAppSandboxMessages(params),
    };
  }

  const actor = await ensureWhatsAppSandboxActor({
    db: params.db,
    tenantId: params.tenantId,
    userId: params.userId,
    role: params.role,
  });

  await insertWhatsAppSandboxMessage({
    db: params.db,
    tenantId: params.tenantId,
    userId: params.userId,
    actorId: actor.id,
    role: 'user',
    content: `Subi una factura: ${uploadedFilesSummary(params.archivos)}`,
    metadata: {
      kind: 'sandbox_invoice_upload',
      filenames: params.archivos.map((archivo) => archivo.name),
    },
  });

  const result = await procesarFacturaIa({
    supabase: params.db,
    tenantId: params.tenantId,
    userId: params.userId,
    archivos: params.archivos,
    source: 'whatsapp',
  });

  if (!result.ok) {
    const rawSnippet = rawIaSnippet(result.respuesta_raw);
    await insertWhatsAppSandboxMessage({
      db: params.db,
      tenantId: params.tenantId,
      userId: params.userId,
      actorId: actor.id,
      role: 'assistant',
      content: [
        `No pude procesar la factura con IA: ${result.error}`,
        rawSnippet ? `Respuesta IA recibida: ${rawSnippet}` : null,
      ].filter(Boolean).join('\n'),
      metadata: {
        kind: 'sandbox_invoice_error',
        status: result.status,
        raw_snippet: rawSnippet,
      },
    });
    return {
      ok: false,
      status: result.status,
      error: result.error,
      messages: await loadWhatsAppSandboxMessages(params),
    };
  }

  const prepared = await prepararConfirmacionLectorFacturaDesdeResultado({
    db: params.db,
    tenantId: params.tenantId,
    sucursalId: params.sucursalId,
    resultado: result.payload,
  });
  const snapshot = buildWhatsAppSandboxInvoiceTicketSnapshot({
    resultado: result.payload,
    prepared,
  });

  const { data: job, error: jobErr } = await params.db
    .from('lector_factura_job' as any)
    .insert({
      tenant_id: params.tenantId,
      sucursal_id: params.sucursalId,
      usuario_id: params.userId,
      source: 'whatsapp',
      status: 'completed',
      external_id: `sandbox:${randomUUID()}`,
      archivos: jobFilesFromPreview(result.payload),
      lector_factura_log_id: result.payload.log_id,
      resultado: result.payload,
      error_code: null,
      error_detail: null,
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      impacto_preview: prepared.impacto,
      impact_hash: prepared.impactHash,
      confirm_payload: prepared.confirmPayload,
      application_status: snapshot.status === 'ready' ? 'pending' : 'blocked',
      applied_error:
        snapshot.status === 'ready' ? null : snapshot.blockingReasons.join(' | '),
    })
    .select('id')
    .single();
  if (jobErr || !job?.id) {
    throw new Error(jobErr?.message ?? 'No se pudo crear el job de factura del sandbox');
  }

  let token: string | undefined;
  let actionId: string | null = null;
  if (snapshot.status === 'ready') {
    const action = await createOrReuseInvoiceAction({
      db: params.db,
      tenantId: params.tenantId,
      actorId: actor.id,
      fromWaId: actor.fromWaId,
      lectorJobId: String(job.id),
      impactHash: prepared.impactHash,
    });
    token = action.token;
    actionId = action.actionId;
  }

  const ticket = await insertWhatsAppSandboxInvoiceTicket({
    db: params.db,
    tenantId: params.tenantId,
    userId: params.userId,
    actorId: actor.id,
    fromWaId: actor.fromWaId,
    lectorFacturaJobId: String(job.id),
    actionLogId: actionId,
    snapshot,
  });

  const borradorUrl = await resolverBorradorUrlWhatsapp({
    db: params.db,
    tenantId: params.tenantId,
    snapshot,
    resultado: result.payload,
    meta: {
      lectorFacturaJobId: String(job.id),
      whatsappTicketId: ticket.id,
    },
  });

  await insertWhatsAppSandboxMessage({
    db: params.db,
    tenantId: params.tenantId,
    userId: params.userId,
    actorId: actor.id,
    role: 'assistant',
    content: buildWhatsAppInvoiceTicketChatSummary(ticket, token, borradorUrl),
    metadata: {
      kind: 'sandbox_invoice_ticket',
      ticket_id: ticket.id,
      lector_factura_job_id: String(job.id),
      impact_hash: prepared.impactHash,
      action_id: actionId,
      real_confirmation: Boolean(token),
    },
  });

  return {
    ok: true,
    messages: await loadWhatsAppSandboxMessages(params),
    job_id: String(job.id),
    impact_hash: prepared.impactHash,
    action_id: actionId,
    ticket,
  };
}
