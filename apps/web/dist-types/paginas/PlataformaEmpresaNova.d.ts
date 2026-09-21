/**
 * Nova empresa.
 *
 * Cria a empresa e o administrador dela — mais os oito perfis de sistema e a
 * linha de configuração, que não são opcionais: sem `ADMIN_EMPRESA` não há
 * perfil para atribuir, e sem a configuração a tela de configuração morre.
 *
 * **Sem loja e sem tabela de preço**, e a tela diz isso em voz alta. A
 * empresa nasce no estado que a tela de Equipe chama de *inerte*: quem entra
 * vê telas vazias até a primeira loja existir. O administrador consegue
 * criá-la, porque `loja.criar` é permissão de empresa e não de loja — mas
 * até lá o sistema parece quebrado, e descobrir isso sozinho é pior do que
 * ler aqui.
 */
export declare function PlataformaEmpresaNova(): import("react").JSX.Element;
//# sourceMappingURL=PlataformaEmpresaNova.d.ts.map