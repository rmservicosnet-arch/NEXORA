-- ===========================================================================
-- A PLATAFORMA: o terceiro principal, e o unico sem empresa.
--
-- Ate aqui uma empresa so nascia pelo seed, que APAGA a anterior, ou por SQL
-- cru com o papel migrator. `docs/TENANCY.md` §2 ja previa um administrador de
-- plataforma desde o inicio, e dos tres requisitos que escreveu -- perfil
-- proprio, auditoria sempre, codigo confinado -- so o terceiro existia: uma
-- regra de lint guardando um simbolo que nunca foi criado.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Quem age
-- ---------------------------------------------------------------------------

-- Em PG 18 isto roda dentro da transacao da migracao. O valor novo nao pode
-- ser USADO aqui, e nao e: so passa a existir.
ALTER TYPE "AtorTipo" ADD VALUE IF NOT EXISTS 'PLATAFORMA';

-- Fica sozinho nesta migracao de proposito. O PostgreSQL recusa usar um valor
-- de enum na mesma transacao em que ele foi criado ("unsafe use of new value"),
-- e `plataforma_auditoria` filtra por 'PLATAFORMA' no corpo. Cada migracao roda
-- na sua transacao: separar e o que faz a seguinte enxergar o valor.
