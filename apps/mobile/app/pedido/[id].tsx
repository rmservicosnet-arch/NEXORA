import type { Pedido, PedidoItem } from '@estoque/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ErroRequisicao, novaChaveIdempotencia, pedir } from '../../src/api/cliente';
import { useSessao } from '../../src/auth/sessao';
import { brl, quantidade as fmtQtd } from '../../src/pdv/dinheiro';
import { Aviso, Botao, Corpo, Numero, Pilula } from '../../src/ui/componentes';
import { cor, espaco, fonte, raio, TOQUE_MINIMO } from '../../src/ui/tema';

/**
 * Conferir um pedido, do artboard `AppEquipeConfirmar`.
 *
 * ## Um controle por item, e ele LIBERA
 *
 * O stepper é sempre o controle; não há um segundo campo de edição ao lado.
 * Dois controles para a mesma coisa na mesma tela já custou caro no web: um
 * sempre ativo, o outro só no modo, e o botão "Editar" parecendo BLOQUEAR.
 *
 * ## O teto vem do ACORDO, não do envio
 *
 * Confirmar mais do que o cliente pediu é legítimo quando foi combinado — a
 * API aceita, e o cliente recebe para aceitar. O que a tela NÃO faz é cortar
 * pela disponibilidade: saldo é aviso, não teto. Cortar sozinho devolveria o
 * item ao cliente sem ninguém decidir.
 *
 * ## Sem saldo exige justificativa
 *
 * `justificativaSemSaldo` é obrigatória quando algum item passa do
 * disponível. Permitido quando autorizado, nunca silencioso.
 */
export default function ConferirPedido() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { pode } = useSessao();
  const fila = useQueryClient();
  const margens = useSafeAreaInsets();

  const [quantidades, setQuantidades] = useState<Record<string, number>>({});
  const [justificativa, setJustificativa] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  /*
    A chave de idempotência nasce com a TELA e não muda.

    É o ponto: se a conexão cair no meio da confirmação e a pessoa apertar de
    novo, o servidor reconhece a mesma operação e devolve a mesma resposta.
    Gerá-la no clique daria uma chave nova por tentativa — e duas
    confirmações são dois movimentos de estoque.
  */
  const [chave] = useState(novaChaveIdempotencia);

  const consulta = useQuery({
    queryKey: ['pedido', id],
    queryFn: () => pedir<Pedido>(`/pedidos/${id}`),
    enabled: Boolean(id),
  });

  const pedido = consulta.data;

  /* O estado carrega o id do DONO: a rota é a mesma e só o parâmetro muda. */
  const [dono, setDono] = useState(id);
  if (dono !== id) {
    setDono(id);
    setQuantidades({});
    setJustificativa('');
    setErro(null);
  }

  const confirmar = useMutation({
    mutationFn: () => {
      const itens = (pedido?.itens ?? []).map((i) => ({
        itemId: i.id,
        quantidadeConfirmada: String(quantidadeDe(i)),
      }));

      return pedir<Pedido>(`/pedidos/${id}/confirmar`, {
        method: 'POST',
        body: {
          itens,
          ...(justificativa.trim() ? { justificativaSemSaldo: justificativa.trim() } : {}),
        },
        chaveIdempotencia: chave,
      });
    },
    onSuccess: async () => {
      setErro(null);
      await fila.invalidateQueries({ queryKey: ['pedidos'] });
      await fila.invalidateQueries({ queryKey: ['pedido', id] });
      router.back();
    },
    onError: (e) => {
      setErro(e instanceof ErroRequisicao ? e.corpo.mensagem : 'Não foi possível confirmar.');
    },
  });

  function quantidadeDe(item: PedidoItem): number {
    const escolhida = quantidades[item.id];
    if (escolhida !== undefined) return escolhida;

    /*
      O padrão é o SOLICITADO, não o disponível.

      Pré-preencher cortando pelo estoque faria a falta devolver o item ao
      cliente sozinha — o oposto de "nunca silencioso". Sugere-se o que foi
      pedido, e a falta aparece em vermelho ao lado.
    */
    return Number(item.quantidadeSolicitada);
  }

  const semSaldo = useMemo(() => {
    if (!pedido) return [];
    return pedido.itens.filter((i) => {
      const disponivel = i.disponivelAgora === undefined ? null : Number(i.disponivelAgora);
      return disponivel !== null && quantidadeDe(i) > disponivel;
    });
  }, [pedido, quantidades]);

  const precisaJustificar = semSaldo.length > 0;
  const podeConfirmar =
    pode('pedido.confirmar') && (!precisaJustificar || justificativa.trim().length >= 5);

  if (consulta.isPending) {
    return (
      <View style={e.centro}>
        <ActivityIndicator color={cor.marca} size="large" />
      </View>
    );
  }

  if (consulta.isError || !pedido) {
    return (
      <View style={e.telaErro}>
        <Aviso tom="perigo" titulo="Não foi possível abrir o pedido">
          {consulta.error instanceof ErroRequisicao
            ? consulta.error.corpo.mensagem
            : 'Tente de novo em instantes.'}
        </Aviso>
        <Botao variante="secundario" aoTocar={() => router.back()}>
          Voltar
        </Botao>
      </View>
    );
  }

  const totalConfirmado = pedido.itens.reduce(
    (t, i) => t + quantidadeDe(i) * Number(i.precoUnitario),
    0,
  );
  const solicitado = Number(pedido.valorSolicitado);
  const diferenca = totalConfirmado - solicitado;

  return (
    <View style={e.tela}>
      <View style={[e.topo, { paddingTop: margens.top + espaco.s }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Voltar"
          onPress={() => router.back()}
          style={e.voltar}
        >
          <Text style={e.voltarTexto}>‹</Text>
        </Pressable>
        <View style={e.topoTextos}>
          <Text style={e.topoTitulo}>PD-{String(pedido.numero).padStart(5, '0')}</Text>
          <Text style={e.topoSub} numberOfLines={1}>
            {pedido.cliente}
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={e.conteudo}>
        {erro ? (
          <Aviso tom="perigo" titulo="Não foi possível confirmar">
            {erro}
          </Aviso>
        ) : null}

        {!pode('pedido.confirmar') ? (
          <Aviso tom="marca" titulo="Você pode ver, não confirmar">
            Seu perfil não tem `pedido.confirmar`. A conferência abaixo é só leitura.
          </Aviso>
        ) : null}

        <View style={e.resumo}>
          <Corpo tom="apagado" style={e.resumoLinha}>
            {pedido.tabelaPreco ?? 'Sem tabela'} · {pedido.itens.length}{' '}
            {pedido.itens.length === 1 ? 'item' : 'itens'}
          </Corpo>
        </View>

        {pedido.itens.map((item) => (
          <LinhaItem
            key={item.id}
            item={item}
            quantidade={quantidadeDe(item)}
            editavel={pode('pedido.confirmar')}
            aoMudar={(valor) =>
              setQuantidades((atual) => ({ ...atual, [item.id]: Math.max(0, valor) }))
            }
          />
        ))}

        {precisaJustificar ? (
          <View style={e.justificativa}>
            <Aviso tom="atencao" titulo={`${String(semSaldo.length)} item(ns) acima do disponível`}>
              Confirmar mais do que existe é permitido — e nunca silencioso. Diga por quê: vai para
              a linha do tempo do pedido.
            </Aviso>
            <TextInput
              value={justificativa}
              onChangeText={setJustificativa}
              placeholder="Chega amanhã pela transferência da Norte"
              placeholderTextColor={cor.fraco}
              multiline
              style={e.entradaJustificativa}
            />
          </View>
        ) : null}
      </ScrollView>

      <View style={[e.rodape, { paddingBottom: margens.bottom + espaco.m }]}>
        <View style={e.linhaValor}>
          <Corpo tom="apagado">Solicitado</Corpo>
          <Numero tamanho={fonte.apoio} tom="apagado">
            {brl(solicitado)}
          </Numero>
        </View>
        <View style={e.linhaValor}>
          <Corpo style={e.totalRotulo}>A confirmar</Corpo>
          <Numero tamanho={22}>{brl(totalConfirmado)}</Numero>
        </View>

        {/*
          Diferença POSITIVA exige aceite do cliente — e dizer isso aqui, antes
          de confirmar, evita a surpresa de um pedido que "some" para o
          cliente em vez de ser faturado.
        */}
        {Math.abs(diferenca) >= 0.01 ? (
          <Corpo tom={diferenca > 0 ? 'atencao' : 'bom'} style={e.diferenca}>
            {diferenca > 0
              ? `${brl(diferenca)} acima do pedido — vai para o cliente aceitar.`
              : `${brl(Math.abs(diferenca))} abaixo do pedido.`}
          </Corpo>
        ) : null}

        <Botao
          aoTocar={() => confirmar.mutate()}
          ocupado={confirmar.isPending}
          desabilitado={!podeConfirmar}
          style={e.confirmar}
        >
          Confirmar pedido
        </Botao>
      </View>
    </View>
  );
}

function LinhaItem({
  item,
  quantidade,
  editavel,
  aoMudar,
}: {
  readonly item: PedidoItem;
  readonly quantidade: number;
  readonly editavel: boolean;
  readonly aoMudar: (valor: number) => void;
}) {
  const solicitada = Number(item.quantidadeSolicitada);
  const disponivel = item.disponivelAgora === undefined ? null : Number(item.disponivelAgora);
  const falta = disponivel !== null && quantidade > disponivel;
  const devolvido = quantidade === 0;

  return (
    <View style={[e.item, falta && e.itemFalta, devolvido && e.itemDevolvido]}>
      <View style={e.itemTexto}>
        <Corpo style={e.itemNome} numeroDeLinhas={2}>
          {item.produto} {item.descricaoVariacao}
        </Corpo>
        <Numero tamanho={11} tom="apagado">
          {item.sku}
        </Numero>

        <View style={e.itemSelos}>
          {devolvido ? <Pilula tom="perigo">Devolvido ao cliente</Pilula> : null}
          {falta ? (
            <Pilula tom="atencao">
              Disponível {fmtQtd(disponivel ?? 0)} · confirmando {fmtQtd(quantidade)}
            </Pilula>
          ) : null}
          {quantidade > solicitada ? <Pilula tom="marca">Acima do pedido</Pilula> : null}
        </View>

        <Corpo tom="fraco" style={e.itemPreco}>
          Pedido: {fmtQtd(item.quantidadeSolicitada)} × {brl(item.precoUnitario)}
        </Corpo>
      </View>

      {/*
        UM controle. Sem campo de edição ao lado: dois controles para a mesma
        coisa fazem os dois parecerem decorativos, e o "Editar" parecer
        bloqueio.
      */}
      <View style={e.contador}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Tirar um"
          disabled={!editavel || quantidade <= 0}
          onPress={() => aoMudar(quantidade - 1)}
          style={[e.passo, (!editavel || quantidade <= 0) && e.passoInerte]}
        >
          <Text style={e.passoTexto}>−</Text>
        </Pressable>
        <Numero tamanho={16} style={e.passoValor}>
          {fmtQtd(quantidade)}
        </Numero>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Somar um"
          disabled={!editavel}
          onPress={() => aoMudar(quantidade + 1)}
          style={[e.passo, !editavel && e.passoInerte]}
        >
          <Text style={e.passoTexto}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

const e = StyleSheet.create({
  tela: { flex: 1, backgroundColor: cor.fundo },
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: cor.fundo },
  telaErro: { flex: 1, justifyContent: 'center', padding: espaco.g, gap: espaco.m },

  topo: {
    paddingHorizontal: espaco.s,
    paddingBottom: espaco.m,
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.xs,
    backgroundColor: cor.marcaTopo,
  },
  voltar: {
    width: TOQUE_MINIMO,
    height: TOQUE_MINIMO,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voltarTexto: { fontSize: 30, lineHeight: 32, color: cor.papel },
  topoTextos: { flex: 1, minWidth: 0 },
  topoTitulo: { fontSize: fonte.titulo, fontWeight: '700', color: cor.papel },
  topoSub: { fontSize: fonte.miudo, color: cor.marcaApagada },

  conteudo: { padding: espaco.m, gap: espaco.s },
  resumo: { paddingHorizontal: espaco.xs },
  resumoLinha: { fontSize: fonte.apoio },

  item: {
    padding: espaco.m,
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.m,
    backgroundColor: cor.papel,
    borderWidth: 1,
    borderColor: cor.linha,
    borderRadius: raio.g,
  },
  itemFalta: { borderColor: cor.atencaoBorda, backgroundColor: cor.atencaoFundo },
  itemDevolvido: { borderColor: cor.perigoBorda, backgroundColor: cor.perigoFundo },
  itemTexto: { flex: 1, minWidth: 0, gap: 2 },
  itemNome: { fontSize: fonte.corpo, fontWeight: '500' },
  itemSelos: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  itemPreco: { marginTop: 4, fontSize: fonte.miudo },

  contador: { alignItems: 'center', gap: 2 },
  passo: {
    width: TOQUE_MINIMO,
    height: TOQUE_MINIMO - 8,
    borderRadius: raio.s,
    borderWidth: 1,
    borderColor: cor.borda,
    backgroundColor: cor.papel,
    alignItems: 'center',
    justifyContent: 'center',
  },
  passoInerte: { opacity: 0.35 },
  passoTexto: { fontSize: 20, fontWeight: '600', color: cor.texto },
  passoValor: { minWidth: 40, textAlign: 'center' },

  justificativa: { gap: espaco.s, marginTop: espaco.xs },
  entradaJustificativa: {
    minHeight: 72,
    padding: espaco.m,
    borderRadius: raio.m,
    borderWidth: 1,
    borderColor: cor.atencaoBorda,
    backgroundColor: cor.papel,
    fontSize: fonte.corpo,
    color: cor.tinta,
    textAlignVertical: 'top',
  },

  rodape: {
    paddingHorizontal: espaco.g,
    paddingTop: espaco.m,
    backgroundColor: cor.papel,
    borderTopWidth: 1,
    borderTopColor: cor.linha,
    gap: 2,
  },
  linhaValor: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  totalRotulo: { fontSize: fonte.subtitulo, fontWeight: '600' },
  diferenca: { marginTop: 2, fontSize: fonte.miudo },
  confirmar: { marginTop: espaco.s, minHeight: 52 },
});
