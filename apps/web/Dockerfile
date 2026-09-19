# Imagem da aplicação web. Construída a partir da RAIZ do repositório:
#
#   docker build -f apps/web/Dockerfile -t estoque-web .

FROM node:24-bookworm-slim AS base
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false

FROM base AS deps

COPY package.json package-lock.json .npmrc ./
COPY packages/core/package.json      packages/core/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json        packages/db/
COPY apps/api/package.json           apps/api/
COPY apps/web/package.json           apps/web/

RUN npm ci

FROM deps AS build

COPY . .

# Caminho relativo por padrão: o nginx desta mesma imagem encaminha /api para
# a API. Ver o comentário em nginx.conf — com origem única o cookie de refresh
# deixa de ser de terceiros e CORS some do caminho.
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL

ENV DIRECT_URL=postgresql://build:build@localhost:5432/build

# O `tsc -b` do build da web compila o projeto inteiro por referência de
# projeto, então o cliente Prisma precisa existir mesmo sem a web usá-lo.
RUN npm run db:generate:ci \
 && npm run build -w @estoque/contracts \
 && npm run build -w @estoque/core \
 && npm run build -w @estoque/db \
 && npm run build -w @estoque/web

# ---------------------------------------------------------------------------
# Execução: só arquivos estáticos e um nginx na frente
# ---------------------------------------------------------------------------
FROM nginx:1.29-alpine AS runtime

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

# 8080 e não 80: porta acima de 1024 não exige privilégio, o que permite rodar
# o contêiner sem root em qualquer orquestrador.
EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
