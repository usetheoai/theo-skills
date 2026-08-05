-- M-sweep / T4.2 — one semantic version, one revision.
--
-- Closes code-review finding #2: `assertPublishable` (version.ts:101) has never had a
-- production caller, and `skill_revisions.version` carries no constraint, so two revisions
-- with different content could occupy the same `1.2.0`. A consumer on `^1.2.0` would then
-- receive different bytes on different days, with no error and no way to tell which.
--
-- The guard in the domain and this index cover DIFFERENT failures and neither replaces the
-- other: the guard produces a typed 409 with a readable cause, the index is what survives two
-- concurrent publishes (read-then-write outside a constraint is TOCTOU).
--
-- ------------------------------------------------------------------------------------------
-- STEP 1 — de-duplicate, under the rule decided by the owner on 2026-08-05.
--
-- Deleting a revision is NOT free: `skill_channels.revision_id`, `install_events.revision_id`
-- and `skills.latest_revision_id` all point at a revision WITHOUT a foreign key and WITHOUT
-- cascade (schema.ts:378, :464, :73). Only `embeddings` cascades. So a naive "keep the newest"
-- can leave a `stable` channel pointing at a revision that no longer exists — the consumer
-- gets an error instead of content, which is worse than the duplicate we set out to fix.
--
-- The rule therefore keeps whichever duplicate is REFERENCED:
--   exactly one referenced -> delete the others
--   none referenced        -> keep the newest, delete the rest
--   two or more referenced -> ABORT; a human decides which channel moves
-- ------------------------------------------------------------------------------------------

DO $$
DECLARE
  conflicted integer;
BEGIN
  -- Abort before touching anything if any duplicate group has 2+ referenced revisions.
  SELECT count(*) INTO conflicted
  FROM (
    SELECT r.workspace_id, r.skill_id, r.version
    FROM skill_revisions r
    WHERE r.version IS NOT NULL
      AND (
        EXISTS (SELECT 1 FROM skill_channels c WHERE c.revision_id = r.revision_id)
        OR EXISTS (SELECT 1 FROM install_events e WHERE e.revision_id = r.revision_id)
        OR EXISTS (SELECT 1 FROM skills s WHERE s.latest_revision_id = r.revision_id)
      )
    GROUP BY r.workspace_id, r.skill_id, r.version
    HAVING count(*) > 1
  ) AS conflicts;

  IF conflicted > 0 THEN
    RAISE EXCEPTION
      'skill_revisions: % (workspace_id, skill_id, version) group(s) have TWO OR MORE '
      'referenced revisions. Deleting either one would leave a channel, an install event or a '
      'skill.latest_revision_id dangling. Resolve by hand — decide which revision each channel '
      'should point at — then re-run this migration.', conflicted;
  END IF;
END $$;

-- Delete the duplicates that nothing points at. `ORDER BY referenced DESC, create_time DESC`
-- makes the survivor the referenced one when there is one, and otherwise the newest.
WITH ranked AS (
  SELECT
    r.revision_id,
    row_number() OVER (
      PARTITION BY r.workspace_id, r.skill_id, r.version
      ORDER BY
        (
          EXISTS (SELECT 1 FROM skill_channels c WHERE c.revision_id = r.revision_id)
          OR EXISTS (SELECT 1 FROM install_events e WHERE e.revision_id = r.revision_id)
          OR EXISTS (SELECT 1 FROM skills s WHERE s.latest_revision_id = r.revision_id)
        ) DESC,
        r.create_time DESC
    ) AS rank_in_group
  FROM skill_revisions r
  WHERE r.version IS NOT NULL
)
DELETE FROM skill_revisions
WHERE revision_id IN (SELECT revision_id FROM ranked WHERE rank_in_group > 1);

--> statement-breakpoint

-- ------------------------------------------------------------------------------------------
-- STEP 2 — the constraint.
--
-- PARTIAL (`WHERE version IS NOT NULL`) because a revision without a version is legitimate:
-- everything published before M19 has `version NULL` (schema.ts:167-168), and not every skill
-- uses channels. A plain unique index would collapse all of those into one row per skill.
-- ------------------------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS "skill_revisions_ws_skill_version_uq"
  ON "skill_revisions" ("workspace_id", "skill_id", "version")
  WHERE "version" IS NOT NULL;
