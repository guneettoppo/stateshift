-- StateShift control-plane schema (YugabyteDB YSQL / Postgres compatible).
-- Applied automatically on startup when --db=pg|yugabyte.

CREATE TABLE IF NOT EXISTS jobs (
    id          TEXT PRIMARY KEY,
    workload    TEXT        NOT NULL,
    epoch       INT         NOT NULL DEFAULT 0,
    seq         INT         NOT NULL DEFAULT 0,
    total_steps INT         NOT NULL DEFAULT 0,
    status      TEXT        NOT NULL,
    owner       TEXT        NOT NULL DEFAULT '',
    state       BYTEA,
    state_hash  TEXT        NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    pause_ms    INT         NOT NULL DEFAULT 0,
    bytes_total BIGINT      NOT NULL DEFAULT 0,
    ops         INT         NOT NULL DEFAULT 0,
    checksum    TEXT        NOT NULL DEFAULT ''
);

-- Exactly-once proof: the primary key makes a replayed step a no-op.
CREATE TABLE IF NOT EXISTS oplog (
    job_id     TEXT NOT NULL,
    seq        INT  NOT NULL,
    epoch      INT  NOT NULL,
    op_id      TEXT NOT NULL,
    result     TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (job_id, seq, op_id)
);

CREATE TABLE IF NOT EXISTS checkpoints (
    job_id          TEXT NOT NULL,
    seq             INT  NOT NULL,
    epoch           INT  NOT NULL,
    manifest_key    TEXT NOT NULL,
    state_hash      TEXT NOT NULL,
    size            INT  NOT NULL,
    chunks          INT  NOT NULL,
    chunks_uploaded INT  NOT NULL,
    chunks_skipped  INT  NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (job_id, seq)
);

CREATE TABLE IF NOT EXISTS migrations (
    id                BIGSERIAL PRIMARY KEY,
    job_id            TEXT NOT NULL,
    from_node         TEXT NOT NULL,
    to_node           TEXT NOT NULL,
    started_at        TIMESTAMPTZ NOT NULL,
    quiesced_at       TIMESTAMPTZ NOT NULL,
    restored_at       TIMESTAMPTZ NOT NULL,
    pause_ms          INT  NOT NULL,
    bytes_transferred BIGINT NOT NULL DEFAULT 0,
    chunks_sent       INT  NOT NULL DEFAULT 0,
    chunks_skipped    INT  NOT NULL DEFAULT 0,
    outcome           TEXT NOT NULL,
    epoch_from        INT  NOT NULL,
    epoch_to          INT  NOT NULL
);
