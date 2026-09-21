import type { VariacaoParaMovimento } from '@estoque/contracts';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ErroRequisicao, pedir } from '../../src/api/cliente';
import { useSessao } from '../../src/auth/sessao';
import { quantidade as fmtQtd } from '../../src/pdv/dinheiro';
import { Leitor } from '../../src/pdv/leitor';
import { Cabecalho } from '../../src/ui/cabecalho';
import { Aviso, Cartao, Corpo, Numero, Pilula, Vazio } from '../../src/ui/componentes';
import { cor, espaco, fonte, raio, TOQUE_MINIMO } from '../../src/ui/tema';

/**
 * Consulta de saldo por leitura.
 *
 * A pergunta do balcão é "tem?", e ela precisa de resposta em dois segundos,
 * com a mercadoria na mão. Esta tela só LÊ: entrada, ajuste e transferência
 * ficam para depois, e cada uma tem permissão própria.
 *
 * O saldo aparece POR LOCAL, não somado. "12 na rede" não ajuda quem está no
 * balcão do Centro se os doze estão no depósito da Norte — somar esconderia
 * exatamente o que a pergunta quer saber.
 */
export default function Estoque() {
  const { usuario, pode } = useSessao();

  const [termo, setTermo] = useState('');
  const [achados, setAchados] = useState<readonly VariacaoParaMovimento[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [digitando, setDigitando] = useState(false);

  const podeVer = pode('estoque.visualizar');

  const buscar = async (valor: string) => {
    const limpo = valor.trim();
    if (limpo.length < 2) return;

    setBuscando(true);
    setErro(null);
    try {
      const r = await pedir<VariacaoParaMovimento[]>(
        `/estoque/variacoes?termo=${encodeURIComponent(limpo)}&limite=20`,
      );
      setAchados(r);
    } catch (e) {
      setErro(e instanceof ErroRequisicao ? e.corpo.mensagem : 'Não foi possível buscar.');
    } finally {
      setBuscando(false);
    }
  };

  if (!podeVer) {
    return (
      <View style={e.tela}>
        <Cabecalho titulo="Estoque" subtitulo={usuario?.nome ?? ''} />
        <View style={e.padding}>
          <Aviso tom="marca" titulo="Você não consulta estoque">
            Seu perfil não tem `estoque.visualizar`.
          </Aviso>
        </View>
      </View>
    );
  }

  return (
    <View style={e.tela}>
      <Cabecalho titulo="Estoque" subtitulo="Quanto tem, e onde" />

      {digitando ? null : (
        <Leitor
          aoLer={(codigo) => {
            setTermo(codigo);
            void buscar(codigo);
          }}
          aoPedirDigitacao={() => setDigitando(true)}
        />
      )}

      <View style={e.busca}>
        <TextInput
          value={termo}
          onChangeText={setTermo}
          onSubmitEditing={() => void buscar(termo)}
          onFocus={() => setDigitando(true)}
          placeholder="Nome, SKU ou código de barras"
          placeholderTextColor={cor.fraco}
          style={e.entrada}
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
        />
        {digitando ? (
          <Pressable accessibilityRole="button" onPress={() => setDigitando(false)} hitSlop={8}>
            <Corpo tom="apagado" style={e.voltarCamera}>
              Usar a câmera
            </Corpo>
          </Pressable>
        ) : null}
      </View>

      {erro ? (
        <View style={e.padding}>
          <Aviso tom="perigo" titulo="Não foi possível buscar">
            {erro}
          </Aviso>
        </View>
      ) : null}

      {buscando ? (
        <View style={e.centro}>
          <ActivityIndicator color={cor.marca} />
        </View>
      ) : null}

      <FlatList
        data={achados ?? []}
        keyExtractor={(v) => v.id}
        contentContainerStyle={e.lista}
        /* `ListEmptyComponent` não aceita `null` de um ternário: a lista
           some inteira em vez de mostrar nada. Um fragmento vazio, sim. */
        ListEmptyComponent={
          buscando ? (
            <></>
          ) : (
            <Vazio
              titulo={achados === null ? 'Aponte ou digite' : 'Nada encontrado'}
              descricao={
                achados === null
                  ? 'Leia o código de barras do produto, ou procure pelo nome.'
                  : 'Nenhuma variação com este termo nesta empresa.'
              }
            />
          )
        }
        renderItem={({ item }) => <Resultado variacao={item} />}
      />
    </View>
  );
}

function Resultado({ variacao }: { readonly variacao: VariacaoParaMovimento }) {
  return (
    <Cartao style={e.cartao}>
      <Corpo style={e.nome} numeroDeLinhas={2}>
        {variacao.produto} {variacao.descricao}
      </Corpo>
      <View style={e.identificadores}>
        <Numero tamanho={11} tom="apagado">
          {variacao.sku}
        </Numero>
        {variacao.codigoBarras ? (
          <>
            <View style={e.ponto} />
            <Numero tamanho={11} tom="apagado">
              {variacao.codigoBarras}
            </Numero>
          </>
        ) : null}
      </View>

      {/*
        Por LOCAL. Somar daria "12 na rede" a quem está no balcão do Centro
        com os doze no depósito da Norte.
      */}
      <View style={e.saldos}>
        {variacao.saldosPorLocal.length === 0 ? (
          <Pilula tom="perigo">Sem saldo em nenhum local</Pilula>
        ) : (
          variacao.saldosPorLocal.map((s) => (
            <View key={`${s.lojaId}-${s.localId}`} style={e.saldo}>
              <Corpo tom="apagado" style={e.local} numeroDeLinhas={1}>
                {s.loja} · {s.local}
              </Corpo>
              <Numero tamanho={14} tom={Number(s.quantidade) <= 0 ? 'perigo' : 'normal'}>
                {fmtQtd(s.quantidade)}
              </Numero>
            </View>
          ))
        )}
      </View>
    </Cartao>
  );
}

const e = StyleSheet.create({
  tela: { flex: 1, backgroundColor: cor.fundo },
  padding: { padding: espaco.g },
  centro: { paddingVertical: espaco.gg, alignItems: 'center' },

  busca: { padding: espaco.m, gap: 6 },
  entrada: {
    minHeight: TOQUE_MINIMO,
    paddingHorizontal: espaco.m,
    borderRadius: raio.m,
    borderWidth: 1,
    borderColor: cor.borda,
    backgroundColor: cor.papel,
    fontSize: 15,
    color: cor.tinta,
  },
  voltarCamera: { fontSize: fonte.apoio, color: cor.marca, paddingVertical: 4 },

  lista: { padding: espaco.m, gap: espaco.s, flexGrow: 1 },
  cartao: { gap: 4 },
  nome: { fontSize: fonte.corpo, fontWeight: '500' },
  identificadores: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ponto: { width: 3, height: 3, borderRadius: 999, backgroundColor: cor.fraco },
  saldos: { marginTop: espaco.s, gap: 4 },
  saldo: { flexDirection: 'row', alignItems: 'center', gap: espaco.s },
  local: { flex: 1, fontSize: fonte.apoio },
});
