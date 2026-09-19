import { z } from 'zod';

export const lojaResumoSchema = z.object({
  id: z.string(),
  nome: z.string(),
  codigo: z.string(),
  locais: z.number().int().nonnegative(),
});

export type LojaResumo = z.infer<typeof lojaResumoSchema>;
