/**
 * O dia do CALENDÁRIO de quem está na frente da tela, em ISO.
 *
 * `new Date().toISOString().slice(0, 10)` devolve o dia em UTC. Às 21h de
 * Brasília já é o dia seguinte lá, então o campo "pago em" de uma baixa feita
 * às 21h30 nascia preenchido com AMANHÃ — e uma data de pagamento errada não
 * dá erro em lugar nenhum, só desloca o fluxo de caixa de um dia.
 *
 * A API faz a mesma conta do outro lado (`ContasService.hoje`): o dia do
 * negócio é o dia local, gravado à meia-noite UTC.
 */
export declare function diaISO(data?: Date): string;
//# sourceMappingURL=datas.d.ts.map