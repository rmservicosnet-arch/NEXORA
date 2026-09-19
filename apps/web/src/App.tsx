import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router';

import { ErroRequisicao } from './api/cliente';
import { ProvedorSessao } from './auth/sessao';
import { ProvedorSessaoPortal } from './auth/sessaoPortal';
import { PortalShell } from './layout/PortalShell';
import { Shell } from './layout/Shell';
import { Caixa } from './paginas/Caixa';
import { Carteiras } from './paginas/Carteiras';
import { Cliente } from './paginas/Cliente';
import { Clientes } from './paginas/Clientes';
import { Estoque } from './paginas/Estoque';
import { Inicio } from './paginas/Inicio';
import { Lojas } from './paginas/Lojas';
import { Login } from './paginas/Login';
import { NovoProduto } from './paginas/NovoProduto';
import { Pdv } from './paginas/Pdv';
import { PedidoDetalhe } from './paginas/PedidoDetalhe';
import { Pedidos } from './paginas/Pedidos';
import { Produto } from './paginas/Produto';
import { Produtos } from './paginas/Produtos';
import { PortalCarrinho } from './paginas/portal/Carrinho';
import { PortalCatalogo } from './paginas/portal/Catalogo';
import { PortalEntrar } from './paginas/portal/Entrar';
import { PortalMeuPedido } from './paginas/portal/MeuPedido';
import { PortalMeusPedidos } from './paginas/portal/MeusPedidos';
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
        </Route>
      </Routes>
    </ProvedorSessaoPortal>
  );
}

function AreaDaEquipe() {
  return (
    <ProvedorSessao>
      <Routes>
        <Route path="/entrar" element={<Login />} />
        <Route element={<Shell />}>
          <Route index element={<Inicio />} />
          <Route path="lojas" element={<Lojas />} />
          <Route path="produtos" element={<Produtos />} />
          <Route path="produtos/novo" element={<NovoProduto />} />
          <Route path="produtos/:produtoId" element={<Produto />} />
          <Route path="estoque" element={<Estoque />} />
          <Route path="pdv" element={<Pdv />} />
          <Route path="caixa" element={<Caixa />} />
          <Route path="carteiras" element={<Carteiras />} />
          <Route path="clientes" element={<Clientes />} />
          <Route path="clientes/:clienteId" element={<Cliente />} />
          <Route path="pedidos" element={<Pedidos />} />
          <Route path="pedidos/:pedidoId" element={<PedidoDetalhe />} />
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
