"""
verify_db.py — run once to confirm tables and test a round-trip insert.
"""
from database import engine, init_db
from sqlalchemy import text

init_db()

with engine.connect() as conn:
    # 1. List tables
    tables = conn.execute(text(
        "SELECT table_name FROM information_schema.tables "
        "WHERE table_schema='public' AND table_name IN ('datasets','customers','models_used') "
        "ORDER BY table_name"
    )).fetchall()
    print("Tables found:", [r[0] for r in tables])

    # 2. Show columns
    cols = conn.execute(text(
        "SELECT table_name, column_name, data_type "
        "FROM information_schema.columns "
        "WHERE table_schema='public' AND table_name IN ('datasets','customers','models_used') "
        "ORDER BY table_name, ordinal_position"
    )).fetchall()
    print()
    for row in cols:
        print(f"  {row[0]}.{row[1]} : {row[2]}")

    # 3. Round-trip test insert
    print("\n--- Round-trip test ---")
    ds_id = conn.execute(text(
        "INSERT INTO datasets (filename, row_count) VALUES (:f, :r) RETURNING id"
    ), {"f": "test_verify.csv", "r": 42}).fetchone()[0]
    print(f"  datasets row id = {ds_id}")

    conn.execute(text(
        "INSERT INTO customers (dataset_id, customer_id, recency, frequency, monetary, cluster_id, segment_label) "
        "VALUES (:d, :c, :r, :f, :m, :k, :s)"
    ), {"d": ds_id, "c": "C001", "r": 10.0, "f": 5.0, "m": 250.0, "k": 0, "s": "Champions"})
    print("  customers row inserted")

    conn.execute(text(
        "INSERT INTO models_used (dataset_id, model_name, parameters, silhouette_score) "
        "VALUES (:d, :n, :p, :s)"
    ), {"d": ds_id, "n": "kmeans", "p": "k=4", "s": 0.42})
    print("  models_used row inserted")

    conn.commit()

    # 4. Read back
    row = conn.execute(text("SELECT id, filename, row_count FROM datasets WHERE id=:id"), {"id": ds_id}).fetchone()
    print(f"\n  datasets read-back: id={row[0]}, file={row[1]}, rows={row[2]}")

    cnt = conn.execute(text("SELECT COUNT(*) FROM customers WHERE dataset_id=:id"), {"id": ds_id}).fetchone()[0]
    print(f"  customers count for dataset {ds_id}: {cnt}")

    m = conn.execute(text("SELECT model_name, parameters, silhouette_score FROM models_used WHERE dataset_id=:id"), {"id": ds_id}).fetchone()
    print(f"  models_used: {m[0]}, {m[1]}, sil={m[2]}")

    # 5. Cleanup test data
    conn.execute(text("DELETE FROM datasets WHERE id=:id"), {"id": ds_id})
    conn.commit()
    print("\n  Test data cleaned up.")

print("\nAll checks passed!")
