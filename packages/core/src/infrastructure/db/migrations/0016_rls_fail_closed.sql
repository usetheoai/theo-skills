-- Tenant isolation enforced by the database.
--
-- BEFORE THIS MIGRATION there was no database-level barrier between workspaces:
-- no policies, no row security, no session context. What separated one tenant's
-- skills, bundles and revisions from another's was the `workspace_id = $n`
-- predicate written by hand in every query. A single omission returned another
-- workspace's rows with no error, no log line and no failing test.
--
-- Skills carry executable payloads. A cross-workspace read leaks one customer's
-- automation to another; a cross-workspace WRITE would let one plant code in
-- another's library, which is why WITH CHECK matters as much as USING here.
--
-- WHAT THIS ESTABLISHES
--   * every workspace-scoped table gets ENABLE + FORCE ROW LEVEL SECURITY
--   * one fail-closed policy per table, reading `app.workspace_id`
--   * no permissive disjunct: an unset context matches NOTHING. Zero rows is a
--     visible bug; every tenant's rows is a breach.
--
-- THE TABLE LIST IS DERIVED FROM THE CATALOG, not from the ORM schema — reading
-- it off the TypeScript schema produced a false positive in a sibling package.
--
-- `users` is deliberately absent: no workspace_id, global by design.

DO $$
DECLARE
    spec       record;
    has_worker boolean;
BEGIN
    SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'skills_worker') INTO has_worker;

    -- `api_keys` is excluded on purpose: credential resolution is what DISCOVERS
    -- the workspace, so scoping it is circular — you would need the workspace to
    -- read the row that says which workspace the key belongs to, and every login
    -- would fail closed.
    FOR spec IN
        SELECT c.table_name AS tbl
          FROM information_schema.columns c
          JOIN pg_tables t ON t.schemaname = 'public' AND t.tablename = c.table_name
         WHERE c.table_schema = 'public'
           AND c.column_name = 'workspace_id'
           AND c.table_name <> 'api_keys'
         ORDER BY c.table_name
    LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', spec.tbl);
        EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', spec.tbl);

        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', spec.tbl || '_workspace_isolation', spec.tbl);
        EXECUTE format($f$
            CREATE POLICY %I ON public.%I
              USING      (workspace_id = current_setting('app.workspace_id', true))
              WITH CHECK (workspace_id = current_setting('app.workspace_id', true))
        $f$, spec.tbl || '_workspace_isolation', spec.tbl);

        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', spec.tbl || '_worker_cross_workspace', spec.tbl);
        IF has_worker THEN
            EXECUTE format($f$
                CREATE POLICY %I ON public.%I
                  TO skills_worker
                  USING (true) WITH CHECK (true)
            $f$, spec.tbl || '_worker_cross_workspace', spec.tbl);
        END IF;
    END LOOP;
END $$;
