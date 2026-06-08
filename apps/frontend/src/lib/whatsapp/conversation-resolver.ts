import type { WhatsAppConversationState } from '@/lib/whatsapp/conversation-memory';
import { resolveFollowupFromConversationMemory } from '@/lib/whatsapp/conversation-followup-memory';
import {
  conversationStateToIntentContext,
  expandMessageWithIntentContext,
} from '@/lib/whatsapp/intent-context';

export type ResolvedConversationMessage = {
  message: string;
  interpreted: boolean;
  source: 'raw' | 'memory' | 'intent_context';
};

/**
 * Unifica expansión de follow-ups: memoria de slots + contexto LLM (intent-context).
 */
export function resolveConversationMessage(params: {
  text: string;
  state: WhatsAppConversationState | null;
}): ResolvedConversationMessage {
  const { text, state } = params;

  const memory = resolveFollowupFromConversationMemory({ text, state });
  if (memory.interpreted) {
    return { message: memory.message, interpreted: true, source: 'memory' };
  }

  const expanded = expandMessageWithIntentContext(
    memory.message,
    conversationStateToIntentContext(state),
  );
  if (expanded) {
    return { message: expanded, interpreted: true, source: 'intent_context' };
  }

  return { message: text, interpreted: false, source: 'raw' };
}
