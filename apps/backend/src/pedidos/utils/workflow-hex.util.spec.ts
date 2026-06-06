import { normalizeWorkflowHexColor } from './workflow-hex.util';

describe('normalizeWorkflowHexColor', () => {
  it('normaliza sin hash y a may├║sculas', () => {
    expect(normalizeWorkflowHexColor('3b82f6')).toBe('#3B82F6');
  });

  it('retorna null para vac├¡o o inv├ílido', () => {
    expect(normalizeWorkflowHexColor('')).toBeNull();
    expect(normalizeWorkflowHexColor('xyz')).toBeNull();
    expect(normalizeWorkflowHexColor(null)).toBeNull();
  });
});
