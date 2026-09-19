# Subir em servidor

> **Construído e executado.** A pilha inteira foi levantada com
> `docker compose` numa máquina real: banco zerado, sete migrações aplicadas,
> seed, login, venda e envio de foto. O que foi corrigido nesse primeiro
> levantamento está em §7.

## 1. O que sobe

| Serviço | Imagem | Papel |
|---|---|---|
| `postgres` | `postgres:18-bookworm` | banco |
| `migracao` | a mesma da API | cria os papéis e aplica as migrações; roda e termina |
| `api` | `apps/api/Dockerfile` | NestJS na 3333, só na rede interna |
| `web` | `apps/web/Dockerfile` | nginx na 8080, publica o site e encaminha `/api` |

**PostgreSQL 18 não é preferência.** As chaves primárias usam `uuidv7()`
nativo, que só existe a partir dessa versão. Em 17 a criação das tabelas falha
na primeira migração.

## 2. Subir

```bash
cp .env.docker.example .env.docker
# preencha os segredos
docker compose --env-file .env.docker up -d --build
```

O `--env-file` **não é opcional**. Sem ele o Compose lê o `.env` da raiz — o do
desenvolvimento, com URLs apontando para `localhost`, que dentro de um
contêiner é o próprio contêiner.

Primeiro acesso, com os dados de demonstração:

```bash
docker compose --env-file .env.docker run --rm migracao npm run db:seed:ci
```

## 3. Por que a API e a web saem pela mesma origem

O nginx da web encaminha `/api` para a API. Isso resolve três coisas de uma vez:

1. O cookie de refresh deixa de ser de terceiros — nenhum navegador precisa
   decidir se o bloqueia.
2. CORS deixa de existir como problema.
3. `VITE_API_URL` é embutido no *bundle* em tempo de build. Apontando para
   `/api`, a **mesma imagem** serve homologação e produção; o que muda é para
   onde o nginx encaminha.

A API não é publicada para fora. Só o nginx tem porta na máquina.

## 4. HTTPS não é detalhe

A aplicação **se recusa a subir** com `NODE_ENV=production` e
`COOKIE_SECURE=false`. É deliberado: sem HTTPS o cookie de refresh trafega em
claro, e quem o intercepta tem a sessão.

Ponha um proxy com TLS na frente (Caddy, Traefik, nginx, o balanceador da
nuvem) apontando para a porta 8080 do serviço `web`.

Para experimentar em `http://localhost:8080`, na sua máquina e em nenhum
servidor, baixe os **dois** juntos no `.env.docker`:

```
NODE_ENV=development
COOKIE_SECURE=false
WEB_ORIGIN=http://localhost:8080
COOKIE_DOMAIN=localhost
```

Ter de mexer nos dois é o que impede que isso aconteça por descuido.

## 5. As fotos ainda prendem a API a uma máquina

`STORAGE_DRIVER=local` grava em disco, no volume `midia`. Funciona com **uma**
instância da API.

Com duas, a foto enviada pela instância A não existe para a B: metade das
requisições devolve imagem quebrada, de forma intermitente — o pior tipo de
defeito para diagnosticar.

Antes de escalar horizontalmente, o driver S3 precisa existir. O contrato já é
o dele (`apps/api/src/armazenamento/armazenamento.ts`); falta a implementação.
Ver [MEDIA.md §4](MEDIA.md).

## 6. A imagem da API está maior do que precisa

O `node_modules` é copiado inteiro do estágio de build, com as dependências de
desenvolvimento.

Isso é deliberado **até existir um ambiente onde eu consiga medir a imagem
enxuta funcionando**: `npm ci --omit=dev` num monorepo com workspaces e cliente
Prisma gerado tem armadilhas — symlink de workspace que some, engine do Prisma
que falta — que só aparecem na primeira execução real. E a primeira execução
real seria em produção.

Enxugar é tarefa em aberto, não esquecimento.

## 7. O que o primeiro levantamento corrigiu

Escrever isto sem Docker na máquina produziu quatro defeitos. Nenhum apareceria
em revisão de código; todos apareceram no primeiro `docker compose up`.

**1. Volume do PostgreSQL no caminho errado.** A imagem 18 passou a guardar os
dados em subdiretório por versão (`/var/lib/postgresql/18/docker`), para que
`pg_upgrade --link` não cruze fronteira de montagem. Montar em
`/var/lib/postgresql/data`, como se fazia até a 17, faz o contêiner **recusar a
subir** com uma mensagem sobre "unused mount/volume" que não diz o que fazer.

**2. Localidade inexistente na imagem.** `LANG=pt_BR.UTF-8` não está gerada no
`postgres:18-bookworm`: o `initdb` falha com "invalid locale settings" e o
contêiner entra em laço de reinício. A ordenação em português vem do **ICU**
(`--icu-locale=pt-BR`), que é embutido; o `LANG` fica em `C.UTF-8`.

**3. Seed sem as fontes de que depende.** `seed.ts` é rodado por `tsx` e importa
`../src/client` — a fonte, não o `dist`. A imagem de execução não levava
`packages/db/src`, então o primeiro ambiente novo subiria com o banco vazio.

**4. URL de envio de imagem com `localhost` fixo.** O driver local montava
`http://localhost:3333/api/midia/enviar`, que dentro de um contêiner é o
próprio contêiner. **O envio de foto estava quebrado em qualquer implantação em
contêiner**, e só quem tentasse enviar uma foto descobriria. Existe agora
`API_PUBLIC_URL`, que aceita caminho relativo (`/api`) — o navegador resolve
contra a origem da página e passa pelo nginx.

### O que ficou comprovado rodando

- `npm ci` completa na imagem; `@node-rs/argon2` carrega — o login funciona.
- As sete migrações aplicam num banco zerado, com as políticas de RLS.
- O seed popula a empresa de demonstração.
- Login **e renovação por cookie** atravessam o proxy do nginx.
- O ciclo de foto inteiro — autorizar, enviar, confirmar, servir — funciona, e
  o volume de mídia é gravável pelo usuário `node`.

## 8. Integração contínua

`.github/workflows/ci.yml` roda a cada push e pull request, em dois jobs
paralelos:

- **Tipos, lint e testes**, contra um PostgreSQL 18 **descartável** que nasce e
  morre com o job. É a diferença que importa: na máquina de quem desenvolve a
  suíte roda contra o banco de desenvolvimento e deixa produtos de teste nele —
  já passaram de cem.
- **Imagens Docker**, as duas. Quatro defeitos do Dockerfile e do compose só
  apareceram no primeiro `build`/`up` de verdade (§7); construir a cada commit
  é o que impede o quinto.

A sequência inteira foi validada localmente contra um contêiner Postgres
descartável, com configuração **só por variável de ambiente**: `db:setup:ci`,
`db:deploy:ci`, `db:seed:ci` e os 169 testes, num banco zerado.

O repositório ainda **não tem remoto**. O arquivo está pronto e nada o executa
até existir um `origin` no GitHub.

## 9. O que ainda falta para chamar de produção

Nada disto está feito, e nenhum é opcional:

- **Backup do PostgreSQL, com restauração testada.** Backup que nunca foi
  restaurado não é backup.
- **Segredos em cofre**, não em arquivo no servidor.
- **Observabilidade**: para onde vão os logs, quem avisa quando a API cai.
- **Limites de CPU e memória** nos serviços.
- **Rotina de limpeza** das imagens em `PROCESSANDO` que nunca foram enviadas
  e dos objetos de imagens excluídas logicamente ([MEDIA.md §3](MEDIA.md)).
