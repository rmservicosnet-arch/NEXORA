/**
 * As empresas da plataforma.
 *
 * Tudo aqui cruza empresas — é a única parte do sistema que lê fora do RLS, e
 * por isso a leitura passa por funções `SECURITY DEFINER` que devolvem só
 * nome, contagem e situação. Nenhum dado de negócio: quem precisa ver a venda
 * de uma empresa entra pelo suporte, e essa entrada vira linha na auditoria
 * DELA.
 */
export declare function Plataforma(): import("react").JSX.Element;
//# sourceMappingURL=Plataforma.d.ts.map