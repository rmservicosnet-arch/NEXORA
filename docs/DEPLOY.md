# Subir em servidor

> **Não testado em execução.** Os arquivos desta pasta foram escritos com
> cuidado, mas a máquina onde o projeto foi desenvolvido não tem Docker
> instalado — nenhuma imagem chegou a ser construída. Conte com ajustes na
> primeira execução e veja §7, que lista exatamente o que eu não pude verificar.

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

## 7. O que eu não pude verificar

Sem Docker na máquina de desenvolvimento, nenhuma imagem foi construída.

**O que deu para verificar sem Docker, e está verificado:**

- `compose.yaml` foi validado por um parser de YAML de verdade — e o parser
  pegou um erro real: `ex.: https://…` dentro de um escalar sem aspas vira um
  mapa aninhado, e o arquivo não carregava.
- `prisma generate` com `DIRECT_URL` falsa: roda, porque gerar não conecta.
- Todos os caminhos copiados nos Dockerfiles existem no repositório.
- Os binários que o Compose invoca (`tsx`, `prisma`) estão em
  `node_modules/.bin`.
- `npm run db:generate:ci` funciona sem `.env`.

**O que só a primeira execução mostra:**

1. **Se o `npm ci` completa dentro da imagem.** O projeto usa
   `engine-strict=true`; `node:24` satisfaz `>=24.0.0`, mas não foi comprovado
   na prática.
2. **Se `@node-rs/argon2` carrega.** Escolhi `bookworm-slim` (glibc) em vez de
   Alpine justamente por causa dos binários pré-compilados, mas a carga só se
   confirma na primeira tentativa de login.
3. **Se o `pg_isready` do healthcheck cobre a primeira inicialização.**
4. **Se o ICU `pt-BR` existe na imagem do Postgres 18** para
   `POSTGRES_INITDB_ARGS`. Se não existir, o banco não inicializa e a saída do
   contêiner diz qual localidade usar. É o ajuste mais provável de ser
   necessário.
5. **Se o encaminhamento `/api` do nginx preserva o cookie de refresh** no
   caminho de renovação.
6. **Se o volume `midia` fica gravável.** O `chown` no Dockerfile existe
   justamente para isso — volume nomeado nasce de root e o processo roda como
   `node` —, mas o comportamento de cópia de dono só se confirma rodando.

O primeiro `docker compose up --build` é o teste. Rode-o antes de apontar
qualquer domínio para isto.

## 8. O que ainda falta para chamar de produção

Nada disto está feito, e nenhum é opcional:

- **Backup do PostgreSQL, com restauração testada.** Backup que nunca foi
  restaurado não é backup.
- **Segredos em cofre**, não em arquivo no servidor.
- **Integração contínua**: `typecheck`, `lint` e `test` a cada commit, contra
  um banco descartável — hoje a suíte roda contra o banco de desenvolvimento e
  deixa produtos de teste nele.
- **Observabilidade**: para onde vão os logs, quem avisa quando a API cai.
- **Limites de CPU e memória** nos serviços.
- **Rotina de limpeza** das imagens em `PROCESSANDO` que nunca foram enviadas
  e dos objetos de imagens excluídas logicamente ([MEDIA.md §3](MEDIA.md)).
