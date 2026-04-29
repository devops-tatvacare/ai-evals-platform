"""Alembic environment for ai-evals-platform.

- Async-only: the app uses asyncpg via SQLAlchemy's async engine, so
  Alembic also runs against the same engine to avoid a parallel sync driver.
- DATABASE_URL is read from app.config.settings, never from alembic.ini.
- target_metadata = Base.metadata so `alembic revision --autogenerate`
  diffs the same model tree the app boots with.

Two autogen filters are wired here so future ``alembic revision
--autogenerate`` produces clean output:

1. ``include_object`` skips bucket-C accepted-drift indexes by name (see
   ``backend/alembic/baseline/drift_accepted.md``). Without this filter,
   autogen would emit ``op.drop_index`` for every trigram / partial
   expression index — applying that migration would wipe Sherlock's
   search/cost-query indexes.

2. ``process_revision_directives`` strips ``alter_column`` ops whose only
   change is dropping a manifest-driven column comment (the
   ``pg_description`` rows applied by ``scripts.sync_column_comments``).
   ``Base.metadata`` does not carry those comments, so autogen always
   tries to drop them; without this filter, every routine migration
   would silently wipe Sherlock's column semantics.
"""
from __future__ import annotations

import asyncio
from logging.config import fileConfig

from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from alembic import context
from alembic.operations import ops

from app.config import settings
from app.models import Base  # app/models/__init__.py side-effect-loads every model module

# alembic.ini points at this env.py; pull its [loggers] section into stdlib logging.
config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Inject the runtime DB URL after the file is parsed so secrets never live in alembic.ini.
config.set_main_option("sqlalchemy.url", settings.DATABASE_URL)

target_metadata = Base.metadata


# Bucket-C indexes from drift_accepted.md — present in DB, not declared on
# any model because SQLAlchemy can't cleanly express their gin_trgm_ops /
# expression / partial-WHERE shape. Treat them as invisible to autogen.
_AUTOGEN_IGNORED_INDEXES = frozenset(
    {
        "idx_evaluation_runs_search_id_trgm",
        "idx_evaluation_runs_search_summary_evaluator_trgm",
        "idx_evaluation_runs_search_config_evaluator_trgm",
        "idx_evaluation_runs_search_batch_name_trgm",
        "idx_background_jobs_submission_context_gin",
        "idx_llm_usage_correlation_id",
        "idx_llm_usage_status_error",
    }
)


def _include_object(object_, name, type_, reflected, compare_to):
    """Filter that hides bucket-C drift from autogen.

    ``include_object`` is called once per database object Alembic considers
    for the diff. Returning False excludes the object entirely.

    With ``include_schemas=True`` (Roadmap 01 §9.5), ``name`` for an index
    may arrive as either ``"idx_…"`` or ``"<schema>.idx_…"`` depending on
    SQLAlchemy version and reflection path. Match on the trailing identifier
    so the bucket-C filter keeps working as application tables move from
    ``public`` to ``platform`` / ``analytics``.
    """
    if type_ == "index":
        bare_name = name.rsplit(".", 1)[-1] if name else name
        if bare_name in _AUTOGEN_IGNORED_INDEXES:
            return False
    return True


def _process_revision_directives(context_, revision, directives):
    """Post-process autogen output before it's written to a migration file.

    Removes ``alter_column`` ops whose only change is dropping the manifest
    comment Alembic sees on the live column but not in ``Base.metadata``.
    These ops would clear ``pg_description`` rows and silently degrade
    Sherlock — they are never the actual intent of a model change.

    Autogen groups operations into ``ModifyTableOps`` containers (one per
    affected table), so we recurse into every ``OpContainer`` to reach
    the leaf ``AlterColumnOp`` instances.
    """
    if not directives:
        return
    script = directives[0]
    if not isinstance(script, ops.MigrationScript):
        return

    for op_container in (script.upgrade_ops, script.downgrade_ops):
        if op_container is not None:
            _filter_container(op_container)


def _filter_container(container) -> None:
    """In-place filter every leaf op inside an ``OpContainer`` tree."""
    new_children: list = []
    for child in container.ops:
        if isinstance(child, ops.OpContainer):
            _filter_container(child)
            # Drop now-empty containers so the migration body stays clean.
            if child.ops:
                new_children.append(child)
            continue
        if _is_pure_comment_op(child):
            continue
        new_children.append(child)
    container.ops = new_children


def _is_pure_comment_op(op_obj) -> bool:
    """True iff this op is an ``alter_column`` that only touches the comment.

    Autogen emits these in both directions for every column with a
    manifest-emitted ``pg_description`` row that ``Base.metadata`` doesn't
    declare:
      - upgrade(): ``modify_comment=None`` (clear), ``existing_comment="..."``
      - downgrade(): ``modify_comment="..."`` (restore), ``existing_comment=None``

    Sentinel quirk: ``modify_comment`` uses ``False`` to mean "no change"
    because ``None`` is a valid value (clear). Same for
    ``modify_server_default``. ``modify_type`` and ``modify_nullable`` use
    ``None`` to mean "no change".

    The predicate: comment IS being modified AND nothing else is. That
    catches the manifest-comment case in both directions and leaves
    legitimate column shape changes alone.

    Edge case to flag: if a future model declares ``comment="..."`` on a
    column, autogen would emit a similar pure-comment op which this filter
    would also drop. The codebase manages column comments via the manifest
    sync, not via model ``comment=`` args, so this is fine for now. If
    that changes, narrow this predicate to also check ``existing_comment``.
    """
    if not isinstance(op_obj, ops.AlterColumnOp):
        return False
    if op_obj.modify_comment is False:
        return False  # comment is not being changed
    return (
        op_obj.modify_type is None
        and op_obj.modify_nullable is None
        and op_obj.modify_server_default is False
    )


def run_migrations_offline() -> None:
    """Generate SQL without connecting (`alembic upgrade --sql`).

    Output goes to stdout; useful for review before applying via psql.
    """
    context.configure(
        url=settings.DATABASE_URL,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
        include_schemas=True,
        version_table_schema="public",
        include_object=_include_object,
        process_revision_directives=_process_revision_directives,
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    """Sync helper invoked from inside `connection.run_sync(...)`.

    Roadmap 01 groundwork: ``include_schemas=True`` so future revisions
    (rename chain, OLTP/OLAP split) can address ``platform`` and
    ``analytics`` schemas. ``version_table_schema='public'`` pins
    ``alembic_version`` to ``public`` for the duration of Roadmap 01 — see
    docs/plans/2026-04-24-implementation-sequence/roadmap-01-foundation-postgres-two-schemas.md
    §9.5. Moving the version table out of ``public`` is explicitly out of
    scope for this roadmap (§18).
    """
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
        compare_server_default=True,
        include_schemas=True,
        version_table_schema="public",
        include_object=_include_object,
        process_revision_directives=_process_revision_directives,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    """Connect via asyncpg and run migrations inside a transaction."""
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
