import type { ContextoPdv, ItemParaVenda } from '@estoque/contracts';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ErroRequisicao, pedir } from '../../src/api/cliente';
import { useSessao } from '../../src/auth/sessao';
import { brl, quantidade as fmtQtd } from '../../src/pdv/dinheiro';
import { Leitor } from '../../src/pdv/leitor';
import { Cabecalho } from '../../src/ui/cabecalho';
import { Aviso, Botao, Corpo, Numero, Pilula, Vazio } from '../../src/ui/componentes';
import { cor, espaco, fonte, raio, TOQUE_MINIMO } from '../../src/ui/tema';

/**
 * O PDV do balcão, do artboard `PdvMobile`.
 *
 * ## O que esta tela NÃO faz
 *
 * **Conta de dinheiro.** O total mostrado aqui é uma soma de apoio para a
 * pessoa conferir com o cliente; quem calcula a venda é o servidor, com
 * `Decimal`. Fechar a venda manda os itens e recebe os valores — somar
 * `number` no celular reintroduziria o ponto flutuante que o projeto inteiro
 * evita, e o número da tela divergiria do gravado.
 *
 * **Cortar pela disponibilidade.** Saldo é aviso, não teto: quem bipou dois
 * de um item com um só no balcão recebe o aviso e decide. Cortar sozinho
 * faria a falta de estoque devolver o item ao cliente sem ninguém saber.
 */

interface ItemDoCarrinho {
  readonly item: ItemParaVenda;
  readonly quantidade: number;
}

export default function Escanear() {
  const { usuario, pode } = useSessao();
  const margens = useSafeAreaInsets();

  const [carrinho, setCarrinho] = useState<readonly ItemDoCarrinho[]>([]);
  const [digitando, setDigitando] = useState(false);
  const [codigoDigitado, setCodigoDigitado] = useState('');
  const [aviso, setAviso] = useState<{
    tom: 'atencao' | 'perigo';
    titulo: string;
    texto: string;
  } | null>(null);
  const [buscando, setBuscando] = useState(false);

  const podeVender = pode('venda.criar');

  const contexto = useQuery({
    queryKey: ['pdv', 'contexto'],
    queryFn: () => pedir<ContextoPdv>('/vendas/contexto'),
    enabled: podeVender,
  });

  const loja = contexto.data?.lojas[0] ?? null;

  /*
    O preço vem da tabela DAQUELE atendimento.

    Buscar na tabela padrão e gravar noutra já custou caro no web: a tela
    mostrava R$ 129,90 e o pedido gravava R$ 110,42. Aqui só existe a padrão
    por enquanto — mas o id vai na busca desde já, para o dia em que a tela
    deixar escolher.
  */
  const tabela = contexto.data?.tabelas.find((t) => t.padrao) ?? contexto.data?.tabelas[0] ?? null;

  const buscarPorCodigo = useCallback(
    async (codigo: string) => {
      if (!loja) {
        setAviso({
          tom: 'perigo',
          titulo: 'Sem loja',
          texto: 'Seu usuário não tem vínculo com nenhuma loja — e sem loja não há balcão.',
        });
        return;
      }

      setBuscando(true);
      setAviso(null);

      try {
        const parametros = new URLSearchParams({
          termo: codigo,
          lojaId: loja.id,
          limite: '5',
        });
        if (tabela) parametros.set('tabelaPrecoId', tabela.id);

        const achados = await pedir<ItemParaVenda[]>(`/vendas/itens?${parametros.toString()}`);

        /*
          Casar pelo CÓDIGO DE BARRAS, não pelo primeiro da lista.

          A busca é por termo: um código digitado parcialmente traz vários, e
          "eleger o primeiro" poria no carrinho um item que ninguém escolheu.
          Com uma leitura de câmera, `casouCodigoBarras` é o que distingue a
          etiqueta lida de um SKU parecido.
        */
        const exato = achados.find((a) => a.casouCodigoBarras) ?? null;

        if (!exato) {
          setAviso({
            tom: 'atencao',
            titulo: 'Código não encontrado',
            texto:
              achados.length > 0
                ? `Nada com este código de barras. ${String(achados.length)} item(ns) parecido(s) — procure pelo nome na busca.`
                : 'Nenhum produto com este código de barras nesta loja.',
          });
          return;
        }

        acrescentar(exato);
      } catch (erro) {
        setAviso({
          tom: 'perigo',
          titulo: 'Não foi possível buscar',
          texto: erro instanceof ErroRequisicao ? erro.corpo.mensagem : 'Tente de novo.',
        });
      } finally {
        setBuscando(false);
      }
    },
    [loja, tabela],
  );

  const acrescentar = useCallback((item: ItemParaVenda) => {
    setCarrinho((atual) => {
      const jaTem = atual.findIndex((c) => c.item.variacaoId === item.variacaoId);

      if (jaTem >= 0) {
        // Bipar de novo soma 1 — é o que a mão espera ao passar dois iguais.
        return atual.map((c, i) => (i === jaTem ? { ...c, quantidade: c.quantidade + 1 } : c));
      }

      // O novo entra no TOPO: é o que acabou de ser lido, e é o que a pessoa
      // confere. Acrescentar no fim faria o item sumir abaixo da dobra.
      return [{ item, quantidade: 1 }, ...atual];
    });
  }, []);

  const mudarQuantidade = useCallback((variacaoId: string, delta: number) => {
    setCarrinho((atual) =>
      atual
        .map((c) =>
          c.item.variacaoId === variacaoId ? { ...c, quantidade: c.quantidade + delta } : c,
        )
        .filter((c) => c.quantidade > 0),
    );
  }, []);

  const totalItens = carrinho.reduce((t, c) => t + c.quantidade, 0);

  /*
    Soma de APOIO, para conferir com o cliente. Quem calcula a venda é o
    servidor — este número nunca é gravado.
  */
  const totalAproximado = useMemo(
    () =>
      carrinho.reduce((t, c) => {
        const preco = c.item.preco === null ? 0 : Number(c.item.preco);
        return t + preco * c.quantidade;
      }, 0),
    [carrinho],
  );

  const semPreco = carrinho.filter((c) => c.item.preco === null).length;
  const semSaldo = carrinho.filter((c) => Number(c.item.saldo) < c.quantidade).length;

  if (!podeVender) {
    return (
      <View style={e.tela}>
        <Cabecalho titulo="Venda rápida" subtitulo={usuario?.nome ?? ''} />
        <View style={e.padding}>
          <Aviso tom="marca" titulo="Você não opera o PDV">
            Seu perfil não tem `venda.criar`. Quem concede é o administrador da sua empresa.
          </Aviso>
        </View>
      </View>
    );
  }

  return (
    <View style={e.tela}>
      <Cabecalho
        titulo="Venda rápida"
        subtitulo={loja ? `${loja.nome} · ${usuario?.nome ?? ''}` : (usuario?.nome ?? '')}
      />

      <Leitor
        aoLer={(codigo) => void buscarPorCodigo(codigo)}
        pausado={digitando}
        aoPedirDigitacao={() => setDigitando(true)}
      />

      {aviso ? (
        <View style={e.padding}>
          <Aviso tom={aviso.tom} titulo={aviso.titulo}>
            {aviso.texto}
          </Aviso>
        </View>
      ) : null}

      <View style={e.tituloCarrinho}>
        <Corpo style={e.tituloTexto}>
          No carrinho{' '}
          <Text style={e.contagem}>
            ({totalItens} {totalItens === 1 ? 'item' : 'itens'})
          </Text>
        </Corpo>
        {carrinho.length > 0 ? (
          <Pressable accessibilityRole="button" onPress={() => setCarrinho([])} hitSlop={8}>
            <Corpo style={e.limpar}>Limpar</Corpo>
          </Pressable>
        ) : null}
      </View>

      <FlatList
        data={carrinho}
        keyExtractor={(c) => c.item.variacaoId}
        style={e.lista}
        contentContainerStyle={carrinho.length === 0 ? e.listaVazia : undefined}
        ListEmptyComponent={
          <Vazio
            titulo="Nada lido ainda"
            descricao="Aponte a câmera para o código de barras do produto."
          />
        }
        renderItem={({ item: c }) => (
          <LinhaCarrinho
            entrada={c}
            aoMudar={(delta) => mudarQuantidade(c.item.variacaoId, delta)}
          />
        )}
      />

      {buscando ? (
        <View style={e.buscando}>
          <ActivityIndicator color={cor.marca} size="small" />
          <Corpo tom="apagado">Procurando…</Corpo>
        </View>
      ) : null}

      <View style={[e.rodape, { paddingBottom: espaco.m }]}>
        {semPreco > 0 ? (
          <Corpo tom="perigo" style={e.alerta}>
            {semPreco} {semPreco === 1 ? 'item sem preço' : 'itens sem preço'} nesta tabela — a
            venda vai recusar.
          </Corpo>
        ) : null}
        {semSaldo > 0 ? (
          <Corpo tom="atencao" style={e.alerta}>
            {semSaldo} {semSaldo === 1 ? 'item' : 'itens'} sem saldo suficiente. Saldo é aviso, não
            teto: decida você.
          </Corpo>
        ) : null}

        <View style={e.linhaTotal}>
          <Corpo style={e.totalRotulo}>Total</Corpo>
          <Numero tamanho={fonte.numeroGrande}>{brl(totalAproximado)}</Numero>
        </View>
        <Corpo tom="fraco" style={e.notaTotal}>
          Soma de apoio. Quem calcula a venda é o servidor.
        </Corpo>

        <Botao
          aoTocar={() => {
            setAviso({
              tom: 'atencao',
              titulo: 'Pagamento ainda não',
              texto:
                'A tela de pagamento é o próximo passo: formas, troco e fechamento de caixa. ' +
                'O carrinho já está pronto e a venda será enviada com Idempotency-Key.',
            });
          }}
          desabilitado={carrinho.length === 0}
          style={e.pagar}
        >
          Ir para pagamento
        </Botao>
      </View>

      <Modal
        visible={digitando}
        animationType="slide"
        transparent
        onRequestClose={() => setDigitando(false)}
      >
        <View style={e.fundoModal}>
          <View style={[e.painel, { paddingBottom: margens.bottom + espaco.g }]}>
            <Corpo style={e.painelTitulo}>Digitar código</Corpo>
            <Corpo tom="apagado" style={e.painelTexto}>
              Para etiqueta rasgada ou quando a câmera não alcança.
            </Corpo>
            <TextInput
              value={codigoDigitado}
              onChangeText={setCodigoDigitado}
              autoFocus
              keyboardType="number-pad"
              placeholder="7891000000011"
              placeholderTextColor={cor.fraco}
              style={e.entrada}
            />
            <View style={e.painelBotoes}>
              <Botao
                aoTocar={() => {
                  const codigo = codigoDigitado.trim();
                  setDigitando(false);
                  setCodigoDigitado('');
                  if (codigo) void buscarPorCodigo(codigo);
                }}
                desabilitado={codigoDigitado.trim().length < 4}
                style={e.painelBotao}
              >
                Buscar
              </Botao>
              <Botao
                variante="secundario"
                aoTocar={() => {
                  setDigitando(false);
                  setCodigoDigitado('');
                }}
                style={e.painelBotao}
              >
                Cancelar
              </Botao>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function LinhaCarrinho({
  entrada,
  aoMudar,
}: {
  readonly entrada: ItemDoCarrinho;
  readonly aoMudar: (delta: number) => void;
}) {
  const { item, quantidade } = entrada;
  const saldo = Number(item.saldo);
  const faltando = quantidade > saldo;
  const preco = item.preco === null ? null : Number(item.preco);

  return (
    <View style={[e.linha, faltando && e.linhaFalta]}>
      <View style={e.linhaTexto}>
        <Corpo numeroDeLinhas={1} style={e.nome}>
          {item.produto} {item.descricaoVariacao}
        </Corpo>
        <Numero tamanho={11} tom="apagado">
          {item.sku}
        </Numero>
        {faltando ? (
          <View style={e.selos}>
            <Pilula tom="perigo">
              Saldo {fmtQtd(item.saldo)} · pedindo {quantidade}
            </Pilula>
          </View>
        ) : null}
        {preco === null ? (
          <View style={e.selos}>
            <Pilula tom="perigo">Sem preço nesta tabela</Pilula>
          </View>
        ) : null}
      </View>

      <View style={e.contador}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Tirar um"
          onPress={() => aoMudar(-1)}
          style={e.passo}
        >
          <Text style={e.passoTexto}>−</Text>
        </Pressable>
        <Numero tamanho={15} style={e.passoValor}>
          {quantidade}
        </Numero>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Somar um"
          onPress={() => aoMudar(1)}
          style={e.passo}
        >
          <Text style={e.passoTexto}>+</Text>
        </Pressable>
      </View>

      <View style={e.linhaValor}>
        <Numero tamanho={14}>{preco === null ? '—' : brl(preco * quantidade)}</Numero>
        {preco !== null && quantidade > 1 ? (
          <Numero tamanho={11} tom="apagado">
            {quantidade} × {brl(preco)}
          </Numero>
        ) : null}
      </View>
    </View>
  );
}

const e = StyleSheet.create({
  tela: { flex: 1, backgroundColor: cor.fundo },
  padding: { padding: espaco.g },

  tituloCarrinho: {
    paddingHorizontal: espaco.g,
    paddingTop: 13,
    paddingBottom: 9,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  tituloTexto: { fontSize: fonte.subtitulo, fontWeight: '600' },
  contagem: { fontFamily: 'monospace', fontSize: 13, color: cor.apagado },
  limpar: { fontSize: 13, fontWeight: '500', color: cor.marca },

  lista: { flex: 1 },
  listaVazia: { flexGrow: 1, justifyContent: 'center' },

  linha: {
    paddingVertical: 10,
    paddingHorizontal: espaco.g,
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.m,
    backgroundColor: cor.papel,
    borderBottomWidth: 1,
    borderBottomColor: cor.linhaFraca,
  },
  linhaFalta: { backgroundColor: cor.perigoFundo },
  linhaTexto: { flex: 1, minWidth: 0, gap: 2 },
  nome: { fontSize: fonte.corpo, fontWeight: '500' },
  selos: { flexDirection: 'row', marginTop: 4 },

  contador: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  passo: {
    width: TOQUE_MINIMO - 6,
    height: TOQUE_MINIMO - 6,
    borderRadius: raio.s,
    borderWidth: 1,
    borderColor: cor.borda,
    backgroundColor: cor.papel,
    alignItems: 'center',
    justifyContent: 'center',
  },
  passoTexto: { fontSize: 18, fontWeight: '600', color: cor.texto },
  passoValor: { minWidth: 26, textAlign: 'center' },

  linhaValor: { alignItems: 'flex-end', minWidth: 74 },

  buscando: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: espaco.s,
    paddingVertical: espaco.s,
  },

  rodape: {
    paddingHorizontal: espaco.g,
    paddingTop: espaco.m,
    backgroundColor: cor.papel,
    borderTopWidth: 1,
    borderTopColor: cor.linha,
    gap: 4,
  },
  alerta: { fontSize: fonte.miudo, lineHeight: 16 },
  linhaTotal: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  totalRotulo: { fontSize: fonte.subtitulo, fontWeight: '600' },
  notaTotal: { fontSize: 11 },
  pagar: { marginTop: espaco.s, minHeight: 52 },

  fundoModal: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(26,25,23,0.5)' },
  painel: {
    padding: espaco.g,
    backgroundColor: cor.papel,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    gap: espaco.s,
  },
  painelTitulo: { fontSize: fonte.subtitulo, fontWeight: '600' },
  painelTexto: { fontSize: fonte.apoio },
  entrada: {
    minHeight: TOQUE_MINIMO + 4,
    paddingHorizontal: espaco.m,
    borderRadius: raio.m,
    borderWidth: 1,
    borderColor: cor.borda,
    fontFamily: 'monospace',
    fontSize: 16,
    color: cor.tinta,
  },
  painelBotoes: { flexDirection: 'row', gap: espaco.s, marginTop: espaco.xs },
  painelBotao: { flex: 1 },
});
