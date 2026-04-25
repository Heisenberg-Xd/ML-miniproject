"""
migrate_db.py
-------------
One-time migration: align the existing `datasets` and `customers` tables
to the schema expected by CUE-X v2.

Run once:  python migrate_db.py
"""
from database import engine
from sqlalchemy import text

migrations = [
    # datasets: add filename (if 'name' column exists, rename it; otherwise add fresh)
    # Safely add filename if it doesn't exist yet
    """
    DO $$
    BEGIN
        -- rename legacy 'name' -> 'filename' if present
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name='datasets' AND column_name='name'
        ) AND NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name='datasets' AND column_name='filename'
        ) THEN
            ALTER TABLE datasets RENAME COLUMN name TO filename;
        END IF;

        -- add filename if still missing
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name='datasets' AND column_name='filename'
        ) THEN
            ALTER TABLE datasets ADD COLUMN filename TEXT;
        END IF;

        -- add row_count if missing
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name='datasets' AND column_name='row_count'
        ) THEN
            ALTER TABLE datasets ADD COLUMN row_count INTEGER;
        END IF;

        -- add uploaded_at if missing
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name='datasets' AND column_name='uploaded_at'
        ) THEN
            ALTER TABLE datasets ADD COLUMN uploaded_at TIMESTAMP DEFAULT now();
        END IF;
    END
    $$;
    """,

    # customers: recency/frequency stored as INTEGER in old schema – widen to FLOAT
    """
    DO $$
    BEGIN
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name='customers' AND column_name='recency'
              AND data_type='integer'
        ) THEN
            ALTER TABLE customers
                ALTER COLUMN recency   TYPE FLOAT USING recency::float,
                ALTER COLUMN frequency TYPE FLOAT USING frequency::float;
        END IF;
    END
    $$;
    """,
]

with engine.connect() as conn:
    for i, sql in enumerate(migrations, 1):
        try:
            conn.execute(text(sql))
            conn.commit()
            print(f"[OK] Migration {i} applied.")
        except Exception as e:
            conn.rollback()
            print(f"[WARN] Migration {i} skipped/failed: {e}")

print("\nMigration complete. Current datasets columns:")
with engine.connect() as conn:
    rows = conn.execute(text(
        "SELECT column_name, data_type FROM information_schema.columns "
        "WHERE table_name='datasets' ORDER BY ordinal_position"
    )).fetchall()
    for r in rows:
        print(f"  {r[0]} : {r[1]}")

print("\nCurrent customers columns:")
with engine.connect() as conn:
    rows = conn.execute(text(
        "SELECT column_name, data_type FROM information_schema.columns "
        "WHERE table_name='customers' ORDER BY ordinal_position"
    )).fetchall()
    for r in rows:
        print(f"  {r[0]} : {r[1]}")
