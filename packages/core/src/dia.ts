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
