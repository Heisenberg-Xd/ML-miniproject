"""
services/clustering_service.py
-------------------------------
Reusable RFM clustering pipeline for Cue-X.

Call run_clustering() from:
  - routes/upload.py      (manual CSV upload)
  - routes/integrations.py (Google Sheets sync, webhook, manual refresh)
  - scheduler.py           (hourly auto-sync)
"""

import logging
import numpy as np
import pandas as pd
from datetime import datetime

from database import get_connection
from models import (
    insert_dataset, insert_customers, insert_model_metadata,
    update_data_source_sync_time,
)
from services.ml_service import rfm_model, rfm_scaler, rfm_segment_map

logger = logging.getLogger(__name__)


def _build_fallback_segment_map(cluster_ids):
    return {
        str(int(cid)): {
            "Segment_Name": f"Segment {int(cid)}",
            "Campaign_Strategy": "Standard engagement",
        }
        for cid in sorted(cluster_ids)
    }


def run_clustering(
    df: pd.DataFrame,
    workspace_id: int,
    filename: str,
    source_id: int = None,
    ingestion_type: str = "manual",
) -> dict:
    """
    Execute the full RFM clustering pipeline on a pre-loaded DataFrame.

    Parameters
    ----------
    df            : Raw pandas DataFrame (must contain customer_id, transaction_date, amount columns
                    OR be already column-mapped by the caller via map_sales_columns).
    workspace_id  : Owning workspace.
    filename      : Logical name for the dataset record (e.g. CSV filename or sheet title).
    source_id     : FK to data_sources (None for uncategorised manual upload).
    ingestion_type: "manual" or "auto".

    Returns
    -------
    dict with keys: dataset_id, total_customers, segments_found, column_mapping (if mapped here)
    """
    today = datetime.now()

    # ── Step 1: RFM aggregation ───────────────────────────────────────────────
    required_cols = {"customer_id", "transaction_date", "amount"}
    if not required_cols.issubset(set(df.columns)):
        missing = required_cols - set(df.columns)
        raise ValueError(f"DataFrame is missing required columns: {missing}")

    df["transaction_date"] = pd.to_datetime(df["transaction_date"], errors="coerce")
    df["amount"] = pd.to_numeric(df["amount"], errors="coerce")

    original_len = len(df)
    df = df.dropna(subset=["customer_id", "transaction_date", "amount"]).copy()
    if df.empty:
        raise ValueError(f"No valid rows after cleaning (had {original_len} rows before).")

    agg_dict = {
        "Recency":   ("transaction_date", lambda x: (today - x.max()).days),
        "Frequency": ("transaction_date", "count"),
        "Monetary":  ("amount", "sum"),
    }
    if "season" in df.columns:
        agg_dict["season"] = ("season", lambda x: x.mode()[0] if not x.mode().empty else "Unknown")

    rfm = df.groupby("customer_id").agg(**agg_dict).reset_index()

    # ── Step 2: Scale & predict ───────────────────────────────────────────────
    rfm_features = ["Recency", "Frequency", "Monetary"]
    active_model   = rfm_model
    active_scaler  = rfm_scaler
    active_seg_map = rfm_segment_map

    if active_scaler is None or active_model is None:
        from sklearn.cluster import KMeans
        from sklearn.preprocessing import StandardScaler

        active_scaler = StandardScaler()
        rfm_scaled = active_scaler.fit_transform(rfm[rfm_features])

        n = len(rfm)
        if n < 2:
            rfm["Cluster"] = 0
            active_seg_map = _build_fallback_segment_map([0])
        else:
            k = min(4, n)
            active_model = KMeans(n_clusters=k, random_state=42, n_init=10)
            rfm["Cluster"] = active_model.fit_predict(rfm_scaled)
            active_seg_map = _build_fallback_segment_map(rfm["Cluster"].unique())
    else:
        rfm_scaled = active_scaler.transform(rfm[rfm_features])
        rfm["Cluster"] = active_model.predict(rfm_scaled)

    # ── Step 3: RFM quintile scoring ──────────────────────────────────────────
    def score_quintile(series, ascending=True):
        pct = series.rank(method="average", pct=True, ascending=ascending)
        return np.ceil(pct * 5).clip(1, 5).astype(int)

    rfm["R_Score"] = score_quintile(rfm["Recency"],   ascending=False)
    rfm["F_Score"] = score_quintile(rfm["Frequency"], ascending=True)
    rfm["M_Score"] = score_quintile(rfm["Monetary"],  ascending=True)
    rfm["RFM_Score"] = rfm["R_Score"].astype(str) + rfm["F_Score"].astype(str) + rfm["M_Score"].astype(str)

    # ── Step 4: Map cluster → segment name ────────────────────────────────────
    rfm["Segment_Name"] = rfm["Cluster"].apply(
        lambda c: active_seg_map.get(str(c), {}).get("Segment_Name", f"Segment {c}")
    )
    rfm["Campaign_Strategy"] = rfm["Cluster"].apply(
        lambda c: active_seg_map.get(str(c), {}).get("Campaign_Strategy", "Standard engagement")
    )

    # ── Step 5: Silhouette score ──────────────────────────────────────────────
    sil_score = None
    try:
        from sklearn.metrics import silhouette_score as sk_silhouette
        if len(rfm) > 1 and rfm["Cluster"].nunique() > 1:
            sil_score = float(sk_silhouette(rfm_scaled, rfm["Cluster"]))
    except Exception:
        pass

    # ── Step 6: Persist to DB ─────────────────────────────────────────────────
    dataset_id = None
    try:
        with get_connection() as conn:
            if conn is not None:
                dataset_id = insert_dataset(
                    conn,
                    filename=filename,
                    row_count=len(df),
                    workspace_id=workspace_id,
                    source_id=source_id,
                    ingestion_type=ingestion_type,
                )
                if dataset_id:
                    rfm_db = rfm.rename(columns={"customer_id": "Customer_ID", "season": "Season"})
                    insert_customers(conn, rfm_db, dataset_id)
                    insert_model_metadata(
                        conn,
                        dataset_id=dataset_id,
                        model_name="kmeans",
                        parameters=f"k={getattr(active_model, 'n_clusters', 1)}",
                        silhouette_score=sil_score,
                    )
                    if source_id:
                        update_data_source_sync_time(conn, source_id)
    except Exception as db_err:
        logger.warning(f"[Clustering] DB persistence error: {db_err}")

    return {
        "dataset_id":      dataset_id,
        "total_customers": int(rfm["customer_id"].nunique()),
        "segments_found":  rfm["Segment_Name"].unique().tolist(),
    }
