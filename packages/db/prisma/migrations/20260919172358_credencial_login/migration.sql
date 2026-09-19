-- CreateTable
CREATE TABLE "credencial_login" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "dominio" "TipoPrincipal" NOT NULL,
    "email" VARCHAR(180) NOT NULL,
    "empresa_id" UUID NOT NULL,
    "principal_id" UUID NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alterado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credencial_login_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "credencial_login_empresa_id_idx" ON "credencial_login"("empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX "credencial_login_dominio_email_key" ON "credencial_login"("dominio", "email");
