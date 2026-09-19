/**
 * Primitivas de dinheiro e quantidade.
 *
 * Regra do projeto: nenhum valor monetário ou de quantidade existe como
 * `number` em ponto flutuante. Ver docs/ARCHITECTURE.md §7 e
 * docs/COST_POLICY.md §1.
 */

import { Decimal as DecimalCtor } from 'decimal.js';
import { ValorImprecisoError } from './erros';

/** Instância decimal. Use este tipo — nunca `number` — para dinheiro. */
export type Dec = DecimalCtor;

/** O que `dec()` aceita como entrada. */
export type ValorEntrada = string | number | Dec;

/**
 * Escalas do sistema.
 *
 * Custo tem 6 casas porque é resultado de divisão: truncar em 2 acumularia
 * erro a cada movimentação. Valor tem 2 porque é o que se cobra de fato.
 */
export const ESCALA_VALOR = 2;
export const ESCALA_CUSTO = 6;
export const ESCALA_QUANTIDADE = 6;

const ARREDONDAMENTO = DecimalCtor.ROUND_HALF_UP;

/**
 * Construtor configurado. `precision` alta o bastante para que as contas
 * intermediárias não percam dígitos antes do arredondamento explícito.
 */
const D = DecimalCtor.clone({
  precision: 34,
  rounding: ARREDONDAMENTO,
  toExpNeg: -15,
  toExpPos: 30,
});

/**
 * Constrói um decimal.
 *
 * **Recusa `number` com casas decimais.** `dec(0.1)` lança; `dec('0.1')` e
 * `dec(10)` funcionam. O erro é deliberado e está explicado em
 * `ValorImprecisoError`.
 */
export function dec(valor: ValorEntrada): Dec {
  if (typeof valor === 'number' && !Number.isSafeInteger(valor)) {
    throw new ValorImprecisoError(valor);
  }
  return new D(valor as DecimalCtor.Value);
}

export const ZERO: Dec = dec(0);

export function arredondarValor(valor: Dec): Dec {
  return valor.toDecimalPlaces(ESCALA_VALOR, ARREDONDAMENTO);
}

export function arredondarCusto(valor: Dec): Dec {
  return valor.toDecimalPlaces(ESCALA_CUSTO, ARREDONDAMENTO);
}

export function arredondarQuantidade(valor: Dec): Dec {
  return valor.toDecimalPlaces(ESCALA_QUANTIDADE, ARREDONDAMENTO);
}

export function menor(a: Dec, b: Dec): Dec {
  return a.lessThan(b) ? a : b;
}

export function maior(a: Dec, b: Dec): Dec {
  return a.greaterThan(b) ? a : b;
}

export function ehZero(valor: Dec): boolean {
  return valor.isZero();
}

export function ehNegativo(valor: Dec): boolean {
  return valor.isNegative() && !valor.isZero();
}

/**
 * Formata no padrão brasileiro: `R$ 1.234,56`, negativo com sinal de menos
 * tipográfico à esquerda (`− R$ 460,80`).
 *
 * Implementado à mão em vez de `Intl` porque `Intl` recebe `number`, e
 * converter um Decimal em `number` para formatar reintroduz o problema que
 * este arquivo inteiro existe para evitar.
 */
export function formatarBRL(valor: Dec): string {
  const negativo = ehNegativo(valor);
  const texto = arredondarValor(valor.abs()).toFixed(ESCALA_VALOR);
  const partes = texto.split('.');
  const inteiro = partes[0] ?? '0';
  const centavos = partes[1] ?? '00';
  const comSeparador = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negativo ? '− ' : ''}R$ ${comSeparador},${centavos}`;
}

/** Formata quantidade sem casas supérfluas: `12`, `1,5`, `−12`. */
export function formatarQuantidade(valor: Dec): string {
  const negativo = ehNegativo(valor);
  const texto = arredondarQuantidade(valor.abs()).toString().replace('.', ',');
  return `${negativo ? '−' : ''}${texto}`;
}
