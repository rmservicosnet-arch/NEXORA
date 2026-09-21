/**
 * Perfis e permissões.
 *
 * Um perfil é uma **lista explícita** de permissões. "Marcar o grupo" marca as
 * permissões de hoje, uma a uma — não é curinga. Um perfil montado com "todo o
 * grupo carteira" passaria a conceder cada permissão que aparecesse ali
 * depois, sem ninguém decidir; foi assim que o perfil Financeiro ganhou
 * `carteira.ajustar` duas vezes.
 *
 * Perfil de sistema é só leitura: `db:sync-perfis` reescreve as permissões
 * dele a partir de `docs/`, e uma edição feita aqui voltaria atrás na próxima
 * sincronização. Quem precisa de algo diferente duplica e ajusta a cópia.
 */
export declare function Perfis(): import("react").JSX.Element;
//# sourceMappingURL=Perfis.d.ts.map