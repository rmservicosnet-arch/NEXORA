# Imagem da API. Construída a partir da RAIZ do repositório:
#
#   docker build -f apps/api/Dockerfile -t estoque-api .
#
# O contexto é a raiz porque isto é um monorepo com workspaces do npm: o
# `package-lock.json` é um só, e os pacotes `@estoque/*` são ligados por
# symlink dentro de `node_modules`.

# `bookworm-slim`, não `alpine`.
#
# `@node-rs/argon2` distribui binários pré-compilados por plataforma. A
# variante do Alpine é musl, e já houve versão sem ela publicada — o build
# quebraria na hora de compilar Rust dentro da imagem. Hashing de senha não é
# lugar para economizar 80 MB.
FROM node:24-bookworm-slim AS base
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false

# ---------------------------------------------------------------------------
# Dependências
#
# Só os manifestos primeiro. Assim a camada de `npm ci` só é refeita quando
# uma dependência muda de verdade — e não a cada linha de código alterada.
# ---------------------------------------------------------------------------
FROM base AS deps

COPY package.json package-lock.json .npmrc ./
COPY packages/core/package.json      packages/core/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json        packages/db/
COPY apps/api/package.json           apps/api/
COPY apps/web/package.json           apps/web/

RUN npm ci

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
FROM deps AS build

COPY . .

# `prisma generate` lê `prisma.config.ts`, que exige `DIRECT_URL`. Aqui ela é
# só um espaço reservado: gerar o cliente não conecta em banco nenhum. A URL
# de verdade chega por ambiente, na execução.
ENV DIRECT_URL=postgresql://build:build@localhost:5432/build

RUN npm run db:generate:ci \
 && npm run build -w @estoque/contracts \
 && npm run build -w @estoque/core \
 && npm run build -w @estoque/db \
 && npm run build -w @estoque/api

# ---------------------------------------------------------------------------
# Execução
# ---------------------------------------------------------------------------
FROM base AS runtime

ENV NODE_ENV=production

# `node_modules` vem inteiro do build, com as dependências de desenvolvimento.
#
# É maior do que precisaria ser, e é deliberado até existir um ambiente onde
# eu consiga MEDIR a imagem enxuta funcionando: `npm ci --omit=dev` num
# monorepo com workspaces e cliente Prisma gerado tem armadilhas (symlink que
# some, engine que falta) que só aparecem na primeira execução real — e a
# primeira execução real seria em produção.
#
# Enxugar isto é uma tarefa em aberto, registrada em docs/DEPLOY.md §6.
COPY --from=build /app/node_modules       ./node_modules
COPY --from=build /app/package.json       ./package.json

COPY --from=build /app/packages/core/dist       ./packages/core/dist
COPY --from=build /app/packages/core/package.json ./packages/core/package.json

COPY --from=build /app/packages/contracts/dist  ./packages/contracts/dist
COPY --from=build /app/packages/contracts/package.json ./packages/contracts/package.json

COPY --from=build /app/packages/db/dist         ./packages/db/dist
COPY --from=build /app/packages/db/generated    ./packages/db/generated
COPY --from=build /app/packages/db/package.json ./packages/db/package.json
# As migrações vão junto: é o serviço de migração desta mesma imagem que as
# aplica. Duas imagens diferentes para código e migração abrem a chance de
# aplicar uma migração que o código ainda não conhece.
COPY --from=build /app/packages/db/prisma       ./packages/db/prisma
COPY --from=build /app/packages/db/prisma.config.ts ./packages/db/prisma.config.ts

COPY --from=build /app/apps/api/dist            ./apps/api/dist
COPY --from=build /app/apps/api/package.json    ./apps/api/package.json

COPY --from=build /app/scripts                  ./scripts

# O diretório das fotos precisa existir na IMAGEM, e pertencer ao usuário que
# vai escrever nele.
#
# Volume nomeado do Docker nasce pertencendo ao root. Quando ele é montado
# vazio sobre um caminho que já existe na imagem, o Docker copia o conteúdo
# **e o dono** daquele caminho para dentro do volume. Sem este `chown`, o
# volume ficaria de root, o processo roda como `node`, e o primeiro envio de
# foto falharia com `EACCES` — bem depois do deploy parecer bem-sucedido.
RUN mkdir -p /dados/midia && chown -R node:node /dados

# Não roda como root. Um processo que só precisa ler dist e falar com o banco
# não tem por que poder escrever em qualquer lugar do sistema de arquivos.
USER node

EXPOSE 3333

# Sem npm no meio: `npm start` vira um processo pai que não repassa SIGTERM,
# e o desligamento gracioso do NestJS — que fecha o pool do Prisma — nunca
# acontece. Conexão pendurada a cada reinício é o que vem depois.
CMD ["node", "apps/api/dist/main.js"]
