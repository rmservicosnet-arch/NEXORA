/**
 * O dia do CALENDÁRIO local, em ISO.
 *
 * `new Date().toISOString().slice(0, 10)` devolve o dia em UTC. Depois das
 * 21h em Brasília já é o dia seguinte lá: "hoje" virava amanhã, e um recorte
 * de relatório que diz "últimos 7 dias" passava a começar e terminar um dia
 * à frente — sem erro nenhum, só números de outro período.
 *
 * O dia do negócio é o dia de quem opera, e é ele que a API grava à
 * meia-noite UTC.
 */
export function diaISO(data: Date = new Date()): string {
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  return `${String(data.getFullYear())}-${mes}-${dia}`;
}

/** `2026-09-20` → 20/09/2026 às 00:00:00.000 no fuso de quem opera. */
export function inicioDoDia(dia: string): Date {
  const [ano, mes, d] = dia.split('-').map(Number);
  return new Date(ano ?? 0, (mes ?? 1) - 1, d ?? 1, 0, 0, 0, 0);
}

/**
 * `2026-09-20` → 20/09/2026 às 23:59:59.999 no fuso de quem opera.
 *
 * O fim do dia é o detalhe que decide se o filtro mente. `new Date('2026-09-20')`
 * é meia-noite em UTC — que em Brasília é 21h do dia 19. Usado como teto,
 * "até 20/09" escondia o dia 20 INTEIRO e ainda três horas do dia anterior,
 * sem erro nenhum: a lista simplesmente vinha mais curta.
 */
export function fimDoDia(dia: string): Date {
  const [ano, mes, d] = dia.split('-').map(Number);
  return new Date(ano ?? 0, (mes ?? 1) - 1, d ?? 1, 23, 59, 59, 999);
}
