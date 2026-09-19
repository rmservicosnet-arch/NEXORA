import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Junta classes resolvendo conflitos do Tailwind.
 *
 * Sem o `twMerge`, `cn('p-2', 'p-4')` produziria as duas e o resultado
 * dependeria da ordem no CSS gerado — que não é a ordem em que foram
 * escritas. Com ele, a última vence, como se espera.
 */
export function juntar(...classes: ClassValue[]): string {
  return twMerge(clsx(classes));
}
