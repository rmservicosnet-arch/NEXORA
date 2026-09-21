import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { baseAtual } from '../../src/api/cliente';
import { useSessao } from '../../src/auth/sessao';
import { Cabecalho } from '../../src/ui/cabecalho';
import { Aviso, Botao, Cartao, Corpo, Numero, Rotulo } from '../../src/ui/componentes';
import { cor, espaco, fonte } from '../../src/ui/tema';

/**
 * Quem está usando, onde, e a saída.
 *
 * "Sair" revoga no SERVIDOR: manda o refresh no corpo e espera o 204. Só
 * apagar o token local deixaria a sessão viva pelos 30 dias do refresh — era
 * exatamente o defeito do logout antes de setembro de 2026, e aparelho
 * perdido era sessão viva.
 */
export default function Conta() {
  const { usuario, sair } = useSessao();
  const [saindo, setSaindo] = useState(false);

  if (!usuario) return null;

  return (
    <View style={e.tela}>
      <Cabecalho titulo="Conta" subtitulo={usuario.email} />

      <ScrollView contentContainerStyle={e.conteudo}>
        {/*
          Sessão de suporte da plataforma: quem está usando NÃO é o dono da
          conta. Dizer isso em voz alta é o que impede um acesso de fora que
          ninguém vê na tela.
        */}
        {usuario.suporteDe ? (
          <Aviso tom="perigo" titulo="Sessão de suporte da plataforma">
            Esta sessão foi aberta por alguém da plataforma em nome de {usuario.nome}, com prazo e
            motivo registrados na auditoria da sua empresa.
          </Aviso>
        ) : null}

        <Cartao style={e.cartao}>
          <Rotulo>Quem</Rotulo>
          <Corpo style={e.nome}>{usuario.nome}</Corpo>
          <Corpo tom="apagado">{usuario.email}</Corpo>
        </Cartao>

        <Cartao style={e.cartao}>
          <Rotulo>Onde</Rotulo>
          <Corpo tom="apagado">
            {usuario.lojaIds.length === 0
              ? 'Nenhuma loja vinculada — e nenhuma loja não é "todas", é nenhuma: as telas vêm vazias.'
              : `${usuario.lojaIds.length} ${usuario.lojaIds.length === 1 ? 'loja vinculada' : 'lojas vinculadas'}`}
          </Corpo>
        </Cartao>

        <Cartao style={e.cartao}>
          <Rotulo>O que você pode</Rotulo>
          <Corpo tom="apagado" style={e.permissoes}>
            {usuario.permissoes.length} permissões. As telas deste aplicativo aparecem conforme elas
            — e toda ação é revalidada no servidor.
          </Corpo>
        </Cartao>

        <Cartao style={e.cartao}>
          <Rotulo>Servidor</Rotulo>
          <Numero tamanho={fonte.apoio} tom="apagado">
            {baseAtual()}
          </Numero>
        </Cartao>

        <Botao
          variante="perigo"
          ocupado={saindo}
          aoTocar={() => {
            setSaindo(true);
            void sair().finally(() => setSaindo(false));
          }}
          style={e.sair}
        >
          Sair
        </Botao>

        <Corpo tom="fraco" style={e.nota}>
          Sair revoga a sessão no servidor, não só neste aparelho.
        </Corpo>
      </ScrollView>
    </View>
  );
}

const e = StyleSheet.create({
  tela: { flex: 1, backgroundColor: cor.fundo },
  conteudo: { padding: espaco.g, gap: espaco.m },
  cartao: { gap: 3 },
  nome: { fontSize: fonte.subtitulo, fontWeight: '600' },
  permissoes: { fontSize: fonte.apoio, lineHeight: 17 },
  sair: { marginTop: espaco.s },
  nota: { textAlign: 'center', fontSize: fonte.miudo },
});
