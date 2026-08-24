"""Postgres access — a pool and three helpers. No ORM.

The schema lives in sql/*.sql and is applied by the postgres container's
docker-entrypoint-initdb.d. The application connects as `app_rw`, which owns
nothing and cannot UPDATE or DELETE audit rows, so it deliberately does not run
DDL itself — it only verifies the schema is present and fails fast if not.
"""

from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

import config

pool: AsyncConnectionPool | None = None

REQUIRED_TABLES = [
    ("public", "secrets"),
    ("public", "senders"),
    ("public", "users"),  # 003_accounts.sql — the likeliest cutover miss, since
                          # docker-entrypoint-initdb.d only runs on an empty volume
    ("audit", "events"),
]


async def connect() -> None:
    global pool
    pool = AsyncConnectionPool(
        config.DATABASE_URL, min_size=1, max_size=10, open=False, kwargs={"row_factory": dict_row}
    )
    await pool.open(wait=True, timeout=30)
    await verify_schema()


async def close() -> None:
    if pool:
        await pool.close()


async def verify_schema() -> None:
    """Fail loudly at startup rather than mysteriously on the first request."""
    missing = []
    for schema, table in REQUIRED_TABLES:
        row = await fetchrow(
            "SELECT to_regclass(%s) AS t", (f"{schema}.{table}",)
        )
        if not row or row["t"] is None:
            missing.append(f"{schema}.{table}")
    if missing:
        raise RuntimeError(
            f"Database schema missing: {', '.join(missing)}. "
            "Start postgres via docker compose (it applies sql/ on first boot), or apply by hand: "
            "docker compose exec -T postgres psql -U appuser -d secretshare < sql/001_schema.sql"
        )


async def execute(query: str, params: tuple = ()) -> None:
    async with pool.connection() as conn:
        await conn.execute(query, params)


async def fetchrow(query: str, params: tuple = ()) -> dict | None:
    async with pool.connection() as conn:
        cur = await conn.execute(query, params)
        return await cur.fetchone()


async def fetch(query: str, params: tuple = ()) -> list[dict]:
    async with pool.connection() as conn:
        cur = await conn.execute(query, params)
        return await cur.fetchall()


async def healthy() -> bool:
    try:
        await fetchrow("SELECT 1")
        return True
    except Exception:
        return False
