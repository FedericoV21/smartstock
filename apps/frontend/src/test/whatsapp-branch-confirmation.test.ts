import { describe, expect, it } from 'vitest';

import type { WhatsAppInboundMessage } from '@/lib/whatsapp/inbound';
import {
  branchSelectionReplyMatches,
  sortInboundMessagesForBranchHandling,
} from '@/lib/whatsapp/branch-confirmation';
import { resolveBranchFromTextReply } from '@/lib/whatsapp/branch-resolution';

const CANDIDATES = [
  { id: 'branch-a', nombre: 'Centro', codigo: 'CEN' },
  { id: 'branch-b', nombre: 'Norte', codigo: null },
];

describe('sortInboundMessagesForBranchHandling', () => {
  it('procesa adjuntos antes que texto en el mismo webhook', () => {
    const image: WhatsAppInboundMessage = {
      messageId: 'img-1',
      fromWaId: '54911',
      phoneNumberId: 'pn-1',
      messageType: 'image',
      textBody: null,
      metadata: {},
      messageRaw: {},
      attachment: {
        mediaId: 'm1',
        mimeType: 'image/jpeg',
        filename: null,
        sha256: 'abc',
        raw: {},
      },
    };
    const text: WhatsAppInboundMessage = {
      messageId: 'txt-1',
      fromWaId: '54911',
      phoneNumberId: 'pn-1',
      messageType: 'text',
      textBody: '1',
      metadata: {},
      messageRaw: {},
      attachment: null,
    };

    const sorted = sortInboundMessagesForBranchHandling([text, image]);
    expect(sorted[0]?.messageType).toBe('image');
    expect(sorted[1]?.messageType).toBe('text');
  });
});

describe('branchSelectionReplyMatches', () => {
  it('acepta respuesta numerica de sucursal', () => {
    expect(branchSelectionReplyMatches('1', CANDIDATES)).toBe('branch-a');
    expect(branchSelectionReplyMatches('2', CANDIDATES)).toBe('branch-b');
  });

  it('no confunde hola con seleccion de sucursal', () => {
    expect(branchSelectionReplyMatches('hola', CANDIDATES)).toBeNull();
    expect(resolveBranchFromTextReply('hola', CANDIDATES)).toBeNull();
  });

  it('acepta nombre o codigo de sucursal', () => {
    expect(branchSelectionReplyMatches('centro', CANDIDATES)).toBe('branch-a');
    expect(branchSelectionReplyMatches('cen', CANDIDATES)).toBe('branch-a');
  });
});
