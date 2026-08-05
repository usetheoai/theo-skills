# Runbook — theo-skills

What to do when something breaks. Every section starts with the **symptom**, because that is
what you have in your hands at three in the morning.

## The service answers `200` on `/v1/health` but fails at everything else

**Almost certainly:** the database has no schema.

This happened on the first real deploy (2026-07-30). `/v1/health` is **deliberately** static —
it answers "the process is alive", not "the database is up", so a 30-second Postgres blip does
not kill the container.

The image applies its own migrations at boot, under an advisory lock. Check the boot log first:

```bash
docker logs <container> 2>&1 | grep 'schema aplicado'
```

**A `schema aplicado` line is NOT proof that every migration ran.** The migrator reads
`meta/_journal.json`, not the directory: a `.sql` file with no journal entry is invisible to
it, and the boot reports success having skipped it. Measured on 2026-08-05 —
`0015_unique_skill_version.sql` was hand-written instead of generated, never entered the
journal, and the boot logged success while the unique index was never created.

Compare the two counts before believing the log:

```bash
docker exec <container> sh -c \
  'D=/app/packages/core/dist/infrastructure/db/migrations; \
   echo "journal: $(grep -c \"idx\" $D/meta/_journal.json)"; \
   echo "files:   $(ls $D/*.sql | wc -l)"'
```

They must be equal. `tests/repo/migrations.test.ts` now guards this in CI, so a mismatch
should never reach a deploy again — but the command above is what tells you, on the host,
whether the boot line meant anything.

To apply by hand from a checkout:

```bash
THEOSKILL_PG_URI=… pnpm -C packages/core db:migrate
```

## Mass `429` from a single client

The rate limit is **per principal**, and the distribution quota is **per token**. One careless
client does not take the others down — if that is happening, the bucket key is wrong.

```bash
# Confirm the budgets are distinct:
curl -i -H "authorization: Bearer <token-A>" .../v1/distribution/bundle
curl -i -H "authorization: Bearer <token-B>" .../v1/distribution/bundle   # should pass
```

`Retry-After` is mandatory in the response. Without it the client retries immediately and the
limit becomes a load amplifier — if it is missing, that is a bug, not configuration.

## A client says a skill "vanished" from a bundle

Bundles reference skills **by channel**, not by revision. Check where the channel points:

```sql
SELECT channel, revision_id, previous_revision_id
FROM skill_channels WHERE workspace_id = $1 AND skill_id = $2;
```

If someone promoted the wrong thing, reverting is an operation, not an investigation — the
previous target is recorded on the same row.

## `404` on everything for one distribution client

By design, the four cases are **indistinguishable**: token does not exist, revoked, expired, or
belongs to another publisher. Telling them apart would let someone discover other people's
bundles by trial.

```sql
SELECT token_id, revoked_at, expires_at FROM distribution_tokens
WHERE token_hash = encode(sha256($1::bytea), 'hex');
```

The raw token is **not recoverable** — only the hash is stored. If the client lost the value,
issue a new one and revoke the old.

## A workspace ended up with no `owner`

**This should not be possible** — there is a transactional invariant with `SELECT … FOR UPDATE`.
If it happened, someone wrote to the database directly, outside the API.

```sql
UPDATE workspace_users SET role = 'owner'
WHERE workspace_id = $1 AND user_id = $2;
```

Record it as an incident: the path that allowed it needs closing.

## Publishing a version is refused with `duplicate`

Expected. One semantic version resolves to exactly one revision — the guard refuses a
duplicate or a regression, and the partial unique index on `(workspace_id, skill_id, version)`
closes the race the guard alone cannot see.

The publish path is **asynchronous**, so the refusal reaches the publisher as a failed
operation, not as a synchronous 409. It is non-retriable on purpose: republishing `1.2.0`
would be refused on the tenth attempt exactly as on the first, and retrying would only delay
the message.

```sql
SELECT workspace_id, skill_id, version, count(*)
FROM skill_revisions WHERE version IS NOT NULL
GROUP BY 1,2,3 HAVING count(*) > 1;
```

An empty result is the healthy state.

## The `/status` panel shows the wrong version

`GET /v1/version` reads provenance from the environment, not from the image. The dev host's
reconciler converges on three axes — image, `State.Running` and **provenance**. If the `.env`
freezes, the endpoint lies permanently, because the image already matches and nothing triggers
a correction.

```bash
journalctl --user -u theoskill-reconcile -n 30
curl -s localhost:18087/v1/version     # git_sha must match the deployed commit
```

## Credential rotation

See `docs/credential-rotation.md`.
