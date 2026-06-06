import * as forge from 'node-forge';

export type CertificadoInfo = {
  valido: boolean;
  diasRestantes: number;
  fechaVencimiento: Date | null;
  subject: string | null;
  error?: string;
};

export function verificarVencimientoCertificado(pem: string): CertificadoInfo {
  try {
    const cert = forge.pki.certificateFromPem(pem);
    const ahora = new Date();
    const vencimiento = cert.validity.notAfter;
    const diffMs = vencimiento.getTime() - ahora.getTime();
    const diasRestantes = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    const subjectCN = cert.subject.getField('CN');
    const subject = subjectCN ? String(subjectCN.value) : null;

    return {
      valido: diasRestantes > 0,
      diasRestantes,
      fechaVencimiento: vencimiento,
      subject,
    };
  } catch (err) {
    return {
      valido: false,
      diasRestantes: 0,
      fechaVencimiento: null,
      subject: null,
      error: err instanceof Error ? err.message : 'Error al leer el certificado',
    };
  }
}
