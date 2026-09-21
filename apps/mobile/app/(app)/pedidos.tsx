import type { PaginaPedidos, Pedido } from '@estoque/contracts';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';

import { ErroDeRede, ErroRequisicao, pedir } from '../../src/api/cliente';
import { useSessao } from '../../src/auth/sessao';
import { brl } from '../../src/pdv/dinheiro';
import { Cabecalho } from '../../src/ui/cabecalho';
import { Aviso, Corpo, Numero, Pilula, Vazio } from '../../src/ui/componentes';
import { cor, espaco, fonte, raio } from '../../src/ui/tema';

/**
 * A fila de pedidos, do artboard `AppEquipePedidos`.
 *
 * Cada aba lista EXATAMENTE o que a contagem dela conta. É a armadilha que
 * o web já pagou: "Aguardando confirmação" consultava `apenasFila`, que
 * inclui o confirmado, enquanto o número ao lado contava só os aguardando.
 *
 * Os números vêm de `contagens`, que o servidor calcula sobre o CONJUNTO —
 * contar a página carregada daria uma aba "Faturados 30" que na verdade são
 * 240.
 */

const ABAS = [
  {
    chave: 'aguardando',
    rotulo: 'Aguardando',
    status: 'AGUARDANDO_CONFIRMACAO',
    conta: (c: PaginaPedidos['contagens']) => c.aguardando,
  },
  {
    chave: 'confirmados',
    rotulo: 'Confirmados',
    status: 'CONFIRMADO,CONFIRMADO_PARCIALMENTE',
    conta: (c: PaginaPedidos['contagens']) => c.confirmados,
  },
  {
    chave: 'devolvidos',
    rotulo: 'Devolvidos',
    status: 'DEVOLVIDO',
    conta: (c: PaginaPedidos['contagens']) => c.devolvidos,
  },
] as const;

function quando(iso: string | null): string {
  if (!iso) return 'sem data';

  /*
    Sem `Math.round`: o lint o proíbe, e com razão — em código monetário ele
    arredonda sem política explícita. Aqui é tempo, e a comparação de faixa
    não precisa de arredondamento nenhum.
  */
  const minutos = (Date.now() - new Date(iso).getTime()) / 60_000;

  // Sem piso zero: relógio adiantado dá negativo e não cairia em faixa
  // nenhuma. A primeira faixa não tem piso.
  if (minutos < 60) return 'agora mesmo';
  if (minutos < 1_440) return `há ${String(Math.floor(minutos / 60))} h`;
  if (minutos < 2_880) return 'ontem';
  return `há ${String(Math.floor(minutos / 1_440))} dias`;
}

export default function Pedidos() {
  const { usuario, pode } = useSessao();
  const [aba, setAba] = useState<string>(ABAS[0].chave);

  const escolhida = ABAS.find((a) => a.chave === aba) ?? ABAS[0];

  const consulta = useQuery({
    queryKey: ['pedidos', aba],
    queryFn: () => pedir<PaginaPedidos>(`/pedidos?statusEm=${escolhida.status}&limite=30`),
    enabled: pode('pedido.visualizar_fila'),
  });

  if (!pode('pedido.visualizar_fila')) {
    return (
      <View style={e.tela}>
        <Cabecalho titulo="Pedidos" subtitulo={usuario?.nome ?? ''} />
        <View style={e.semPermissao}>
          <Aviso tom="marca" titulo="Você não vê a fila de pedidos">
            Seu perfil não tem a permissão `pedido.visualizar_fila`. Quem pode conceder é o
            administrador da sua empresa.
          </Aviso>
        </View>
      </View>
    );
  }

  const dados = consulta.data;

  return (
    <View style={e.tela}>
      <Cabecalho
        titulo="Pedidos"
        subtitulo={usuario?.nome ?? ''}
        {...(dados ? { selo: dados.naFila } : {})}
      />

      <View style={e.abas}>
        {ABAS.map((a) => {
          const ativa = a.chave === aba;
          return (
            <Pressable
              key={a.chave}
              accessibilityRole="tab"
              accessibilityState={{ selected: ativa }}
              onPress={() => setAba(a.chave)}
              style={[e.aba, ativa && e.abaAtiva]}
            >
              <Corpo style={[e.abaTexto, ativa && e.abaTextoAtivo]}>{a.rotulo}</Corpo>
              {dados ? (
                <View style={[e.abaSelo, ativa && e.abaSeloAtivo]}>
                  <Numero tamanho={10.5} style={ativa ? e.abaSeloNumeroAtivo : e.abaSeloNumero}>
                    {a.conta(dados.contagens)}
                  </Numero>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      {consulta.isPending ? (
        <View style={e.centro}>
          <ActivityIndicator color={cor.marca} />
        </View>
      ) : null}

      {consulta.isError ? (
        <View style={e.erro}>
          <Aviso
            tom={consulta.error instanceof ErroDeRede ? 'atencao' : 'perigo'}
            titulo={
              consulta.error instanceof ErroDeRede
                ? 'Sem conexão'
                : 'Não foi possível carregar a fila'
            }
          >
            {consulta.error instanceof ErroRequisicao
              ? consulta.error.corpo.mensagem
              : 'Puxe a lista para baixo para tentar de novo.'}
          </Aviso>
        </View>
      ) : null}

      {dados ? (
        <FlatList
          data={dados.itens}
          keyExtractor={(p) => p.id}
          contentContainerStyle={e.lista}
          refreshControl={
            <RefreshControl
              refreshing={consulta.isFetching && !consulta.isPending}
              onRefresh={() => void consulta.refetch()}
              tintColor={cor.marca}
            />
          }
          ListEmptyComponent={
            <Vazio
              titulo="Nada nesta aba"
              descricao={
                aba === 'aguardando'
                  ? 'Quando um cliente enviar um pedido, ele aparece aqui.'
                  : 'Nenhum pedido nesta situação agora.'
              }
            />
          }
          renderItem={({ item }) => <Cartao pedido={item} />}
        />
      ) : null}
    </View>
  );
}

function Cartao({ pedido }: { readonly pedido: Pedido }) {
  /*
    "Sem saldo" compara o solicitado com o DISPONÍVEL AGORA — não existe um
    campo `faltando` no contrato, e inventar um daria um número que nada
    calcula. `disponivelAgora` só vem para a equipe; no portal o cliente vê
    disponível/indisponível, nunca a quantidade.
  */
  const semSaldo = pedido.itens.filter((i) => {
    if (i.disponivelAgora === undefined) return false;
    return Number(i.quantidadeSolicitada) > Number(i.disponivelAgora);
  }).length;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(`/pedido/${pedido.id}`)}
      style={({ pressed }) => [
        e.cartao,
        semSaldo > 0 && e.cartaoComFalta,
        pressed && e.cartaoPressionado,
      ]}
    >
      <View style={e.cartaoTopo}>
        <Numero tamanho={12.5} tom="apagado">
          PD-{String(pedido.numero).padStart(5, '0')}
        </Numero>
        <View style={e.ponto} />
        <Corpo tom="apagado" style={e.quando}>
          {quando(pedido.enviadoEm)}
        </Corpo>
        <View style={e.espaco} />
        {semSaldo > 0 ? (
          <Pilula tom="atencao">
            {semSaldo === 1 ? '1 sem saldo' : `${String(semSaldo)} sem saldo`}
          </Pilula>
        ) : null}
      </View>

      <Corpo style={e.cliente} numeroDeLinhas={2}>
        {pedido.cliente}
      </Corpo>
      <Corpo tom="apagado" style={e.detalhe}>
        {pedido.tabelaPreco ?? 'Sem tabela'} · {pedido.itens.length}{' '}
        {pedido.itens.length === 1 ? 'item' : 'itens'}
      </Corpo>

      <View style={e.cartaoRodape}>
        <View style={e.espaco}>
          <Corpo tom="fraco" style={e.rotuloValor}>
            Valor solicitado
          </Corpo>
          <Numero tamanho={16}>{brl(pedido.valorSolicitado)}</Numero>
        </View>
        <View style={e.conferir}>
          <Corpo style={e.conferirTexto}>Conferir</Corpo>
        </View>
      </View>
    </Pressable>
  );
}

const e = StyleSheet.create({
  tela: { flex: 1, backgroundColor: cor.fundo },
  semPermissao: { padding: espaco.g },
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  erro: { padding: espaco.g },

  abas: { flexDirection: 'row', gap: 6, paddingHorizontal: 14, paddingTop: espaco.m },
  aba: {
    height: 36,
    paddingHorizontal: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: raio.pilula,
    borderWidth: 1,
    borderColor: cor.borda,
    backgroundColor: cor.papel,
  },
  abaAtiva: { backgroundColor: cor.marca, borderColor: cor.marca },
  abaTexto: { fontSize: fonte.apoio, fontWeight: '500', color: cor.texto },
  abaTextoAtivo: { color: cor.papel },
  abaSelo: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: raio.pilula,
    backgroundColor: cor.linhaFraca,
    alignItems: 'center',
    justifyContent: 'center',
  },
  abaSeloAtivo: { backgroundColor: 'rgba(255,255,255,0.22)' },
  abaSeloNumero: { color: cor.apagado },
  abaSeloNumeroAtivo: { color: cor.papel },

  lista: { padding: 14, gap: 10, flexGrow: 1 },
  cartao: {
    padding: 13,
    backgroundColor: cor.papel,
    borderWidth: 1,
    borderColor: cor.linha,
    borderRadius: raio.g,
  },
  cartaoComFalta: { borderColor: cor.atencaoBorda },
  cartaoPressionado: { opacity: 0.9 },
  cartaoTopo: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  ponto: { width: 3, height: 3, borderRadius: 999, backgroundColor: cor.fraco },
  quando: { fontSize: fonte.miudo },
  espaco: { flex: 1 },
  cliente: { marginTop: espaco.s, fontSize: fonte.subtitulo, fontWeight: '600', lineHeight: 20 },
  detalhe: { marginTop: 2, fontSize: fonte.apoio },
  cartaoRodape: {
    marginTop: 11,
    paddingTop: 11,
    borderTopWidth: 1,
    borderTopColor: cor.linhaFraca,
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.s,
  },
  rotuloValor: { fontSize: 11 },
  conferir: {
    height: 40,
    paddingHorizontal: 15,
    borderRadius: raio.m,
    backgroundColor: cor.marca,
    alignItems: 'center',
    justifyContent: 'center',
  },
  conferirTexto: { fontSize: 13, fontWeight: '600', color: cor.papel },
});
