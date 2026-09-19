# Imagens de produto e catálogo

> Fase 2. Documentado na Fase 1 porque a escolha de armazenamento afeta o
> modelo de dados e a API, que vêm antes.

## 1. Onde as imagens ficam

**Em armazenamento de objetos compatível com S3. Nunca no PostgreSQL.**

Binário em banco relacional destrói o backup (dump de 40 GB por causa de
fotos), estoura a memória do servidor no upload e impede cache de borda. O
banco guarda apenas **metadados e a chave do objeto**.

```
s3://<bucket>/tenants/<tenant_id>/produtos/<produto_id>/<imagem_id>/<variante>.webp
```

O `tenant_id` no caminho não é organização — é isolamento. Uma política de
bucket por prefixo impede que credencial de uma empresa alcance a mídia de
outra, replicando no armazenamento a garantia que o RLS dá no banco.

## 2. Derivadas geradas no upload

Uma foto enviada gera um conjunto fixo de variantes. O original é preservado.

| Variante | Lado maior | Uso |
|---|---|---|
| `thumb` | 96 px | Linha da listagem de produtos, item do carrinho |
| `card` | 400 px | Card do catálogo e do PDV |
| `zoom` | 1200 px | Detalhe do produto, catálogo externo |
| `original` | como enviado | Reprocessamento futuro |

Formato: **WebP** com fallback JPEG. AVIF fica para quando houver medição que
justifique o custo de CPU na geração.

Geração é **assíncrona**, em fila. O upload responde assim que o original está
salvo; as derivadas aparecem em seguida. A interface mostra o estado
`processando` — não trava o cadastro do produto esperando redimensionamento.

> **Estado atual (Fase 2):** as derivadas **ainda não são geradas**. A imagem
> vai a `PRONTA` com o original salvo, e `GET /midia/:id` devolve o original em
> qualquer tamanho. A fila e o redimensionamento entram junto com o catálogo
> público, que é quem sofre com foto de 3 MB no celular. O contrato já prevê a
> variante no caminho, então a mudança não alcança quem consome.

## 3. Modelo de dados

```
produto_imagem
  id                uuid (v7)
  tenant_id         uuid        → RLS
  produto_id        uuid
  variacao_id       uuid NULL   → NULL = foto do produto; preenchido = foto da variação
  chave_objeto      text        → prefixo no bucket
  ordem             int         → ordenação manual
  principal         boolean     → exatamente uma por produto
  texto_alternativo text        → acessibilidade e SEO do catálogo
  largura, altura   int
  bytes             bigint
  hash_conteudo     text        → deduplicação
  status            enum(PROCESSANDO, PRONTA, FALHA)
  criado_em, criado_por
```

Regras:

- Índice único parcial garantindo **uma única** imagem `principal` por produto.
- `variacao_id` permite foto específica por cor. O kimono azul mostra o azul,
  não a foto genérica.
- Fallback definido: variação sem foto própria usa a `principal` do produto.
- `hash_conteudo` evita armazenar cinco vezes a mesma foto enviada por
  vendedores diferentes.
- Exclusão é **lógica**. O objeto no bucket só é removido por rotina posterior,
  depois de confirmado que nenhuma venda ou catálogo publicado o referencia.

## 4. Upload

Upload direto do cliente para o bucket com **URL pré-assinada**. O arquivo não
passa pela API.

```
1. Cliente  → API : POST /produtos/:id/imagens/upload-url  (tipo, bytes)
2. API           : valida permissão, tenant, tipo e tamanho; gera chave
3. API      → Cliente : URL pré-assinada (expira em 5 min) + imagem_id
4. Cliente  → Bucket  : PUT do arquivo
5. Cliente  → API : POST /produtos/:id/imagens/:imagem_id/confirmar
6. API           : enfileira geração das derivadas
```

O passo 2 é onde a segurança acontece: tipo MIME permitido (`image/jpeg`,
`image/png`, `image/webp`), limite de **10 MB**, e a chave do objeto é montada
pelo servidor a partir do tenant da sessão — **nunca** aceita do cliente.

Validação de conteúdo no passo 6: o arquivo é lido e confirmado como imagem
real antes de virar derivada. Extensão e MIME declarados pelo cliente não são
prova de nada. Quem faz essa leitura é `lerImagem` em `@estoque/core`, a partir
do cabeçalho do arquivo — PNG, JPEG e WebP, sem biblioteca externa.

### O driver local

Em desenvolvimento, `STORAGE_DRIVER="local"` grava em disco. Ele **imita o
mesmo fluxo de três passos**, inclusive a autorização de curta duração: o que
no S3 seria uma URL pré-assinada é aqui `PUT /midia/enviar?bilhete=…`, com um
bilhete assinado em HMAC que carrega a chave, o tipo e o limite de bytes.

A rota de envio é pública, e é assim de propósito: no S3 quem recebe o arquivo
é o bucket, que não conhece a sessão do usuário. A autorização é o bilhete.

Manter o contrato idêntico não é purismo. Se o modo local expusesse um `POST`
multipart mais simples, trocar para S3 deixaria de ser trocar um provedor e
passaria a ser reescrever a tela, o aplicativo e os testes.

### A capa é eleita na confirmação

Nunca na autorização. Uma imagem que foi autorizada e nunca chegou — ou que
chegou corrompida — não pode ser a capa do produto no catálogo.

Quem arrasta quatro fotos dispara quatro confirmações em paralelo: todas veem
"este produto não tem capa" antes de qualquer uma gravar, e o índice único
parcial derruba as perdedoras. **Perder essa eleição é resultado correto**, e é
engolido; o que não pode é a exceção abortar a confirmação e deixar a foto
presa em `PROCESSANDO` para sempre. Fixado em teste.

## 5. Entrega

- Catálogo interno e PDV: URLs assinadas de vida curta.
- Catálogo público (link compartilhável, WhatsApp): URLs estáveis em CDN, sem
  assinatura — são públicas por definição. Só produtos marcados como
  `publicado_no_catalogo` recebem URL pública.

A separação importa: publicar o catálogo não pode expor, por descuido, a mídia
de um produto que a loja não quis publicar.

## 6. Requisitos apresentados ao usuário

Exibidos na tela de cadastro, não escondidos em documentação:

- JPEG, PNG ou WebP, até 10 MB.
- Mínimo 800 × 800 px. Abaixo disso o catálogo fica ruim no celular.
- Proporção recomendada 1:1 — é a que o card do catálogo usa.
- Fundo branco ou neutro para o catálogo compartilhável.
- Até 8 fotos por produto, mais 1 por variação.

## 7. Texto alternativo

Campo obrigatório na prática: se vazio, é preenchido automaticamente com
`<nome do produto> — <variação>`. Serve acessibilidade e o SEO do catálogo
público, e custa quase nada ao operador.
