import { describe, expect, it } from 'vitest';

import { diaISO } from './dia';

describe('diaISO', () => {
  it('devolve o dia do calendário de quem opera, não o dia em UTC', () => {
    // 23h30 do dia 20. Em qualquer fuso a oeste de Greenwich, `toISOString`
    // já diz 21 — e era assim que "pago em" nascia com a data de amanhã.
    expect(diaISO(new Date(2026, 8, 20, 23, 30))).toBe('2026-09-20');
    expect(diaISO(new Date(2026, 8, 20, 0, 5))).toBe('2026-09-20');
  });

  it('preenche mês e dia com zero à esquerda', () => {
    expect(diaISO(new Date(2026, 0, 3))).toBe('2026-01-03');
  });

  it('atravessa a virada do ano', () => {
    expect(diaISO(new Date(2026, 11, 31, 22, 0))).toBe('2026-12-31');
  });
});
