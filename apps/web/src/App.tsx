import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router';

import { ErroRequisicao } from './api/cliente';
import { ProvedorSessao } from './auth/sessao';
import { Shell } from './layout/Shell';
import { Estoque } from './paginas/Estoque';
import { Inicio } from './paginas/Inicio';
import { Lojas } from './paginas/Lojas';
import { Login } from './paginas/Login';
import { NovoProduto } from './paginas/NovoProduto';
import { Pdv } from './paginas/Pdv';
import { Produto } from './paginas/Produto';
import { Produtos } from './paginas/Produtos';
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

export function App() {
  return (
    <QueryClientProvider client={cliente}>
      <BrowserRouter>
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
      </BrowserRouter>
    </QueryClientProvider>
  );
}
