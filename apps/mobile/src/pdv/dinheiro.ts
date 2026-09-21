/**
 * Formatação de dinheiro, em pt-BR.
 *
 * `R$ ${x.toFixed(2)}` sai "R$ 250.00" — ponto decimal, formato de outro
 * país, na tela que o vendedor lê no balcão. Já aconteceu em quinze
 * mensagens de cinco serviços.
 *
 * O aplicativo NÃO faz conta de dinheiro: quem soma é o servidor, com
 * `Decimal`. Aqui só se formata o que veio pronto — somar `number` no
 * celular reintroduziria o ponto flutuante que o projeto inteiro evita.
 */
export function brl(valor: string | number): string {
  const numero = typeof valor === 'number' ? valor : Number(valor);

  if (!Number.isFinite(numero)) {
    return String(valor);
  }

  return numero.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** "3" ou "1,5" — quantidade com até três casas, sem zeros à toa. */
export function quantidade(valor: string | number): string {
  const numero = typeof valor === 'number' ? valor : Number(valor);
  if (!Number.isFinite(numero)) return String(valor);
  return numero.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
}
