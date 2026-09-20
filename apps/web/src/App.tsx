import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router';

import { ErroRequisicao } from './api/cliente';
import { ProvedorSessao, useSessao } from './auth/sessao';
import { ProvedorSessaoPortal } from './auth/sessaoPortal';
import { PortalShell } from './layout/PortalShell';
import { Shell } from './layout/Shell';
import { Caixa } from './paginas/Caixa';
import { Compras } from './paginas/Compras';
import { Contas } from './paginas/Contas';
import { CarteiraDoCliente, Carteiras } from './paginas/Carteiras';
import { Catalogo } from './paginas/Catalogo';
import { Cliente } from './paginas/Cliente';
import { Clientes } from './paginas/Clientes';
import { Configuracoes } from './paginas/Configuracoes';
import { Estoque } from './paginas/Estoque';
import { Inicio } from './paginas/Inicio';
import { Lojas } from './paginas/Lojas';
import { Login } from './paginas/Login';
import { NovoProduto } from './paginas/NovoProduto';
import { Pdv } from './paginas/Pdv';
import { PrecosDaTabela } from './paginas/PrecosDaTabela';
import { PedidoDetalhe } from './paginas/PedidoDetalhe';
import { Pedidos } from './paginas/Pedidos';
import { Produto } from './paginas/Produto';
import { Produtos } from './paginas/Produtos';
import { RelatorioAbertosTela } from './paginas/RelatorioAbertos';
import { RelatorioAgingTela } from './paginas/RelatorioAging';
import { RelatorioAReceberTela } from './paginas/RelatorioAReceber';
import { RelatorioCustoAquisicaoTela } from './paginas/RelatorioCustoAquisicao';
import { RelatorioFluxoTela } from './paginas/RelatorioFluxo';
import { RelatorioFornecedoresTela } from './paginas/RelatorioFornecedores';
import { RelatorioAcessosTela } from './paginas/RelatorioAcessos';
import { RelatorioAceitesTela } from './paginas/RelatorioAceites';
import { RelatorioAjustesTela } from './paginas/RelatorioAjustes';
import { RelatorioAlteracoesTela } from './paginas/RelatorioAlteracoes';
import { RelatorioCancelamentosTela } from './paginas/RelatorioCancelamentos';
import { RelatorioComparativoTela } from './paginas/RelatorioComparativo';
import { RelatorioConfirmacaoTela } from './paginas/RelatorioConfirmacao';
import { RelatorioDescontosTela } from './paginas/RelatorioDescontos';
import { RelatorioEstoque } from './paginas/RelatorioEstoque';
import { RelatorioFechamentosTela } from './paginas/RelatorioFechamentos';
import { RelatorioFilaTela } from './paginas/RelatorioFila';
import { RelatorioLimiteTela } from './paginas/RelatorioLimite';
import { RelatorioRupturaTela } from './paginas/RelatorioRuptura';
import { RelatorioSensiveisTela } from './paginas/RelatorioSensiveis';
import { RelatorioTrilhaTela } from './paginas/RelatorioTrilha';
import { RelatorioFormasTela } from './paginas/RelatorioFormas';
import { RelatorioGiroTela } from './paginas/RelatorioGiro';
import { RelatorioInventarioTela } from './paginas/RelatorioInventario';
import { RelatorioTransferenciasTela } from './paginas/RelatorioTransferencias';
import { RelatorioVendas } from './paginas/RelatorioVendas';
import { Relatorios } from './paginas/Relatorios';
import { TabelasPreco } from './paginas/TabelasPreco';
import { PortalCarrinho } from './paginas/portal/Carrinho';
import { PortalCatalogo } from './paginas/portal/Catalogo';
import { PortalEntrar } from './paginas/portal/Entrar';
import { PortalMeuPedido } from './paginas/portal/MeuPedido';
import { PortalMeusPedidos } from './paginas/portal/MeusPedidos';
import { PortalSenha } from './paginas/portal/Senha';
import { EstadoVazio } from './ui/Estados';

const cliente = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Não insistir em 401 e 403: o cliente da API já tentou renovar uma
      // vez, e repetir só gasta tentativa de rate limit.
      retry: (tentativas, erro) => {
        if (erro instanceof ErroRequisicao && [401, 403, 404].includes(erro.status)) {
          return false;
        }
        return tentativas < 2;
      },
    },
  },
});

/**
 * O portal do cliente vive fora do provedor de sessão da equipe.
 *
 * Aninhar os dois faria toda tela da equipe carregar uma restauração de
 * sessão do portal — e vice-versa: dois `POST /…/refresh` em todo
 * carregamento, um deles fadado a falhar. São dois domínios de autenticação
 * independentes (ADR-009), e a árvore reflete isso.
 */
function AreaDoPortal() {
  return (
    <ProvedorSessaoPortal>
      <Routes>
        <Route path="entrar" element={<PortalEntrar />} />
        <Route element={<PortalShell />}>
          <Route index element={<PortalCatalogo />} />
          <Route path="carrinho" element={<PortalCarrinho />} />
          <Route path="pedidos" element={<PortalMeusPedidos />} />
          <Route path="pedidos/:pedidoId" element={<PortalMeuPedido />} />
          <Route path="senha" element={<PortalSenha />} />
        </Route>
      </Routes>
    </ProvedorSessaoPortal>
  );
}

/**
 * Sessão exigida, sem o Shell.
 *
 * É a mesma guarda do Shell — a tela de tela cheia não pode ser a porta
 * aberta. Quem não entrou vai para o login e volta para onde queria.
 */
function ExigeSessao() {
  const { usuario, restaurando } = useSessao();
  const local = useLocation();

  if (restaurando) {
    return <div className="min-h-dvh bg-neutral-25" />;
  }

  if (!usuario) {
    return <Navigate to="/entrar" replace state={{ de: local.pathname }} />;
  }

  return <Outlet />;
}

function AreaDaEquipe() {
  return (
    <ProvedorSessao>
      <Routes>
        <Route path="/entrar" element={<Login />} />
        {/*
          O PDV fica FORA do Shell: ocupa a tela inteira, sem menu lateral.
          Quem está no balcão não navega o sistema — vende, e sai por uma
          porta só. A sessão continua exigida, pelo `ExigeSessao`.
        */}
        <Route element={<ExigeSessao />}>
          <Route path="pdv" element={<Pdv />} />
        </Route>
        <Route element={<Shell />}>
          <Route index element={<Inicio />} />
          <Route path="lojas" element={<Lojas />} />
          <Route path="catalogo" element={<Catalogo />} />
          <Route path="produtos" element={<Produtos />} />
          <Route path="produtos/novo" element={<NovoProduto />} />
          <Route path="produtos/:produtoId" element={<Produto />} />
          <Route path="tabelas-preco" element={<TabelasPreco />} />
          <Route path="tabelas-preco/:tabelaId" element={<PrecosDaTabela />} />
          <Route path="configuracoes" element={<Configuracoes />} />
          <Route path="compras" element={<Compras />} />
          <Route path="financeiro" element={<Contas />} />
          <Route path="estoque" element={<Estoque />} />
          <Route path="caixa" element={<Caixa />} />
          <Route path="carteiras" element={<Carteiras />} />
          <Route path="carteiras/:clienteId" element={<CarteiraDoCliente />} />
          <Route path="clientes" element={<Clientes />} />
          <Route path="clientes/:clienteId" element={<Cliente />} />
          <Route path="pedidos" element={<Pedidos />} />
          <Route path="pedidos/:pedidoId" element={<PedidoDetalhe />} />
          <Route path="relatorios" element={<Relatorios />} />
          <Route path="relatorios/estoque" element={<RelatorioEstoque />} />
          <Route path="relatorios/vendas" element={<RelatorioVendas />} />
          <Route path="relatorios/giro" element={<RelatorioGiroTela />} />
          <Route path="relatorios/formas-pagamento" element={<RelatorioFormasTela />} />
          <Route path="relatorios/descontos" element={<RelatorioDescontosTela />} />
          <Route path="relatorios/cancelamentos" element={<RelatorioCancelamentosTela />} />
          <Route path="relatorios/comparativo-lojas" element={<RelatorioComparativoTela />} />
          <Route path="relatorios/pedidos/fila" element={<RelatorioFilaTela />} />
          <Route path="relatorios/pedidos/confirmacao" element={<RelatorioConfirmacaoTela />} />
          <Route path="relatorios/pedidos/ruptura" element={<RelatorioRupturaTela />} />
          <Route path="relatorios/pedidos/alteracoes" element={<RelatorioAlteracoesTela />} />
          <Route path="relatorios/pedidos/aceites" element={<RelatorioAceitesTela />} />
          <Route path="relatorios/carteira/abertos" element={<RelatorioAbertosTela />} />
          <Route path="relatorios/carteira/limite" element={<RelatorioLimiteTela />} />
          <Route path="relatorios/carteira/ajustes" element={<RelatorioAjustesTela />} />
          <Route path="relatorios/auditoria/trilha" element={<RelatorioTrilhaTela />} />
          <Route path="relatorios/auditoria/sensiveis" element={<RelatorioSensiveisTela />} />
          <Route path="relatorios/auditoria/acessos" element={<RelatorioAcessosTela />} />
          <Route path="relatorios/fechamento-caixa" element={<RelatorioFechamentosTela />} />
          <Route path="relatorios/transferencias" element={<RelatorioTransferenciasTela />} />
          <Route path="relatorios/inventario" element={<RelatorioInventarioTela />} />
          <Route path="relatorios/financeiro/aging" element={<RelatorioAgingTela />} />
          <Route path="relatorios/financeiro/fluxo" element={<RelatorioFluxoTela />} />
          <Route path="relatorios/compras/fornecedores" element={<RelatorioFornecedoresTela />} />
          <Route
            path="relatorios/compras/custo-aquisicao"
            element={<RelatorioCustoAquisicaoTela />}
          />
          <Route path="relatorios/compras/a-receber" element={<RelatorioAReceberTela />} />
          <Route
            path="*"
            element={
              <EstadoVazio
                titulo="Página não encontrada"
                descricao="O endereço não existe ou ainda não foi construído."
              />
            }
          />
        </Route>
      </Routes>
    </ProvedorSessao>
  );
}

export function App() {
  return (
    <QueryClientProvider client={cliente}>
      <BrowserRouter>
        <Routes>
          <Route path="/portal/*" element={<AreaDoPortal />} />
          <Route path="/*" element={<AreaDaEquipe />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
