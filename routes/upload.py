import os
import logging
import numpy as np
import pandas as pd
import re
from datetime import datetime
from flask import Blueprint, request, jsonify, send_file
from sqlalchemy import text
from services.ml_service import rfm_model, rfm_scaler, rfm_segment_map
from services.session_store import UPLOAD_FOLDER, load_session
from config import BASE_URL
from database import get_connection
from models import insert_dataset, insert_customers, insert_model_metadata
from utils.auth import login_required

logger = logging.getLogger(__name__)

upload_bp = Blueprint('upload', __name__)


def _normalize_col_name(name: str) -> str:
    return re.sub(r'[^a-z0-9]+', '', str(name).strip().lower())


CANONICAL_ALIASES = {
    "customer_id": {
        "customerid", "customer", "customerkey", "customercode", "custid", "custno",
        "clientid", "clientno", "buyerid", "userid", "memberid"
    },
    "transaction_date": {
        "purchasedate", "transactiondate", "orderdate", "invoicedate", "date", "datetime",
        "billdate", "saledate"
    },
    "amount": {
        "totalprice", "amount", "totalsales", "sales", "revenue", "value", "spend",
        "netsales", "grosssales", "ordertotal"
    },
    "quantity": {"quantity", "qty", "units", "itemcount"},
    "unit_price": {"unitprice", "priceperitem", "price", "itemprice", "sellingprice"},
    "season": {"season"},
}


def _find_by_alias(columns, alias_set):
    for col in columns:
        if _normalize_col_name(col) in alias_set:
            return col
    return None


def _infer_numeric_column(df: pd.DataFrame, name_hints: tuple[str, ...]):
    for col in df.columns:
        norm = _normalize_col_name(col)
        if not any(hint in norm for hint in name_hints):
            continue
        numeric_ratio = pd.to_numeric(df[col], errors="coerce").notna().mean()
        if numeric_ratio >= 0.8:
            return col
    return None


def _infer_date_column(df: pd.DataFrame):
    for col in df.columns:
        norm = _normalize_col_name(col)
        if not any(hint in norm for hint in ("date", "time", "invoice", "order", "purchase")):
            continue
        parsed_ratio = pd.to_datetime(df[col], errors="coerce").notna().mean()
        if parsed_ratio >= 0.8:
            return col
    return None


def _infer_customer_column(df: pd.DataFrame):
    for col in df.columns:
        norm = _normalize_col_name(col)
        if not any(hint in norm for hint in ("customer", "cust", "client", "buyer", "user", "member")):
            continue
        non_null = df[col].notna().mean()
        if non_null >= 0.8:
            return col
    return None


def map_sales_columns(raw: pd.DataFrame):
    mapping = {}
    columns = list(raw.columns)

    for canonical, aliases in CANONICAL_ALIASES.items():
        mapped = _find_by_alias(columns, aliases)
        if mapped:
            mapping[canonical] = mapped

    if "customer_id" not in mapping:
        inferred = _infer_customer_column(raw)
        if inferred:
            mapping["customer_id"] = inferred

    if "transaction_date" not in mapping:
        inferred = _infer_date_column(raw)
        if inferred:
            mapping["transaction_date"] = inferred

    if "amount" not in mapping:
        inferred = _infer_numeric_column(raw, ("amount", "total", "sales", "revenue", "price", "value", "spend"))
        if inferred:
            mapping["amount"] = inferred

    missing = [field for field in ("customer_id", "transaction_date", "amount") if field not in mapping]
    if missing:
        available_columns = ", ".join(list(raw.columns))
        raise ValueError(
            "Could not map required sales fields: "
            f"{', '.join(missing)}. Required meaning is customer id, transaction date, and amount. "
            f"Available columns: {available_columns}"
        )

    standardized = raw.copy()
    standardized["customer_id"] = standardized[mapping["customer_id"]]
    standardized["transaction_date"] = standardized[mapping["transaction_date"]]

    amount_source = mapping.get("amount")
    if amount_source in {mapping.get("unit_price"), mapping.get("quantity")}:
        amount_source = None

    if amount_source:
        mapping["amount"] = amount_source
    elif mapping.get("quantity") and mapping.get("unit_price"):
        mapping["amount"] = "__derived_quantity_x_unit_price__"

    if "amount" in mapping and mapping["amount"] != "__derived_quantity_x_unit_price__":
        standardized["amount"] = pd.to_numeric(standardized[mapping["amount"]], errors="coerce")
    else:
        standardized["amount"] = np.nan

    quantity_col = mapping.get("quantity")
    unit_price_col = mapping.get("unit_price")
    if quantity_col:
        standardized["quantity"] = standardized[quantity_col]
    if unit_price_col:
        standardized["unit_price"] = standardized[unit_price_col]
    if (mapping.get("amount") == "__derived_quantity_x_unit_price__" or standardized["amount"].isna().all()) and quantity_col and unit_price_col:
        qty = pd.to_numeric(standardized[quantity_col], errors="coerce")
        unit_price = pd.to_numeric(standardized[unit_price_col], errors="coerce")
        standardized["amount"] = qty * unit_price

    if "season" in mapping:
        standardized["season"] = standardized[mapping["season"]]

    return standardized, mapping


def _build_fallback_segment_map(cluster_ids):
    return {
        str(int(cluster_id)): {
            "Segment_Name": f"Segment {int(cluster_id)}",
            "Campaign_Strategy": "Standard engagement"
        }
        for cluster_id in sorted(cluster_ids)
    }


def _validation_error(message: str, details: dict | None = None):
    payload = {"error": message}
    if details:
        payload["details"] = details
    return jsonify(payload), 400

@upload_bp.route('/')
def home():
    return jsonify({"status": "CUE-X API running", "version": "2.0-RFM"})


# ── Upload & Segment ──────────────────────────────────────────────────────────
@upload_bp.route('/upload', methods=['POST'])
@login_required
def upload_file(user_id):
    if 'file' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400

    workspace_id = request.form.get('workspace_id')
    if not workspace_id:
        return jsonify({'error': 'workspace_id is required'}), 400

    # Verify workspace belongs to user
    with get_connection() as conn:
        if conn is None:
             return jsonify({'error': 'Database connection failed'}), 500
        ws = conn.execute(text("SELECT id FROM workspaces WHERE id = :id AND user_id = :user_id"), {"id": workspace_id, "user_id": user_id}).fetchone()
        if not ws:
            return jsonify({'error': 'Workspace not found or unauthorized'}), 403

    filename  = f"{datetime.now().timestamp()}_{file.filename}"
    filepath  = os.path.join(UPLOAD_FOLDER, filename)
    file.save(filepath)

    try:
        # ── Step 1: Load ──────────────────────────────────────────────────────
        raw = pd.read_csv(filepath)
        raw, column_mapping = map_sales_columns(raw)

        invalid_counts = {
            "customer_id_null_rows": int(raw["customer_id"].isna().sum()),
            "transaction_date_invalid_rows": int(pd.to_datetime(raw["transaction_date"], errors="coerce").isna().sum()),
            "amount_invalid_rows": int(pd.to_numeric(raw["amount"], errors="coerce").isna().sum()),
        }

        if raw["customer_id"].isna().all():
            return _validation_error(
                "Mapped customer_id is empty for all rows.",
                {"column_mapping": column_mapping, "invalid_counts": invalid_counts},
            )

        raw['transaction_date'] = pd.to_datetime(raw['transaction_date'], errors='coerce')
        if raw['transaction_date'].isna().all():
            return _validation_error(
                "Mapped transaction_date could not be parsed as dates.",
                {"column_mapping": column_mapping, "invalid_counts": invalid_counts},
            )

        raw["amount"] = pd.to_numeric(raw["amount"], errors="coerce")
        if raw["amount"].isna().all():
            return _validation_error(
                "Mapped amount is non-numeric or empty for all rows.",
                {"column_mapping": column_mapping, "invalid_counts": invalid_counts},
            )

        original_row_count = len(raw)
        raw = raw.dropna(subset=['customer_id', 'transaction_date', 'amount']).copy()
        if raw.empty:
            return _validation_error(
                "No valid rows left after cleaning required fields.",
                {
                    "column_mapping": column_mapping,
                    "invalid_counts": invalid_counts,
                    "original_row_count": original_row_count,
                },
            )

        today = datetime.now()

        # ── Step 2: RFM feature engineering per customer ──────────────────────
        agg_dict = {
            'Recency': ('transaction_date', lambda x: (today - x.max()).days),
            'Frequency': ('transaction_date', 'count'),
            'Monetary': ('amount', 'sum')
        }
        if 'season' in raw.columns:
            agg_dict['season'] = ('season', lambda x: x.mode()[0] if not x.mode().empty else 'Unknown')

        rfm = raw.groupby('customer_id').agg(**agg_dict).reset_index()

        rfm_features = ['Recency', 'Frequency', 'Monetary']
        active_model = rfm_model
        active_scaler = rfm_scaler
        active_segment_map = rfm_segment_map

        # ── Step 3: Scale & predict (fallback to on-the-fly training) ────────
        if active_scaler is None or active_model is None:
            from sklearn.cluster import KMeans
            from sklearn.preprocessing import StandardScaler

            active_scaler = StandardScaler()
            rfm_scaled = active_scaler.fit_transform(rfm[rfm_features])

            n_customers = len(rfm)
            if n_customers < 2:
                rfm['Cluster'] = 0
                active_segment_map = _build_fallback_segment_map([0])
            else:
                n_clusters = min(4, n_customers)
                active_model = KMeans(n_clusters=n_clusters, random_state=42, n_init=10)
                rfm['Cluster'] = active_model.fit_predict(rfm_scaled)
                active_segment_map = _build_fallback_segment_map(rfm['Cluster'].unique())
        else:
            rfm_scaled = active_scaler.transform(rfm[rfm_features])
            rfm['Cluster'] = active_model.predict(rfm_scaled)

        # ── Step 4: RFM quintile scoring (1-5) ───────────────────────────────
        def score_quintile(series, ascending=True):
            pct = series.rank(method='average', pct=True, ascending=ascending)
            return np.ceil(pct * 5).clip(1, 5).astype(int)

        rfm['R_Score'] = score_quintile(rfm['Recency'],   ascending=False) # lower recency = better
        rfm['F_Score'] = score_quintile(rfm['Frequency'], ascending=True)  # higher freq = better
        rfm['M_Score'] = score_quintile(rfm['Monetary'],  ascending=True)  # higher monetary = better
        rfm['RFM_Score'] = rfm['R_Score'].astype(str) + rfm['F_Score'].astype(str) + rfm['M_Score'].astype(str)

        # ── Step 5: Map cluster → segment name ───────────────────────────────
        rfm['Segment_Name']      = rfm['Cluster'].apply(
            lambda c: active_segment_map.get(str(c), {}).get('Segment_Name', f'Segment {c}'))
        rfm['Campaign_Strategy'] = rfm['Cluster'].apply(
            lambda c: active_segment_map.get(str(c), {}).get('Campaign_Strategy', 'Standard engagement'))

        # ── Step 6: Merge back onto raw (row-level, one row per transaction) ──
        customer_df = raw.merge(
            rfm[['customer_id','Recency','Frequency','Monetary',
                  'R_Score','F_Score','M_Score','RFM_Score',
                  'Cluster','Segment_Name','Campaign_Strategy']],
            on='customer_id', how='left'
        )

        # Keep extra columns if present
        if 'quantity' in customer_df.columns:
            customer_df['Avg_Order_Value'] = (
                customer_df['amount'] / pd.to_numeric(customer_df['quantity'], errors='coerce').fillna(0).replace(0, 1)
            )

        # ── Step 7: Save outputs ──────────────────────────────────────────────
        output_path  = os.path.join(UPLOAD_FOLDER, 'output.csv')
        customer_df.to_csv(output_path, index=False)

        session_id   = datetime.now().strftime("%Y%m%d%H%M%S")
        session_path = os.path.join(UPLOAD_FOLDER, f'session_{session_id}.csv')
        customer_df.to_csv(session_path, index=False)

        # ── Step 8: Persist to PostgreSQL (non-blocking) ──────────────────────
        dataset_id = None
        
        try:
            # Silhouette score — measures cluster quality (−1 to 1, higher is better)
            from sklearn.metrics import silhouette_score as sk_silhouette
            sil_score = None
            if len(rfm) > 1 and rfm['Cluster'].nunique() > 1:
                sil_score = float(sk_silhouette(rfm_scaled, rfm['Cluster']))

            with get_connection() as conn:
                if conn is not None:
                    dataset_id = insert_dataset(
                        conn,
                        filename=file.filename,
                        row_count=len(raw),
                        workspace_id=int(workspace_id) if workspace_id else None
                    )
                    if dataset_id:
                        rfm_db = rfm.rename(columns={'customer_id': 'Customer_ID', 'season': 'Season'})
                        insert_customers(conn, rfm_db, dataset_id)
                        insert_model_metadata(
                            conn,
                            dataset_id=dataset_id,
                            model_name='kmeans',
                            parameters=f'k={getattr(active_model, "n_clusters", 1)}',
                            silhouette_score=sil_score,
                        )
        except Exception as db_err:
            logger.warning(f"[DB] Persistence skipped due to error: {db_err}")

        # BASE_URL from config is already imported, avoid shadowing
        return jsonify({
            'message':           'File processed successfully!',
            'download_url':      f'{BASE_URL}/download',
            'session_id':        session_id,
            'visualization_url': f'/visualization/{session_id}',
            'total_customers':   int(rfm['customer_id'].nunique()),
            'segments_found':    rfm['Segment_Name'].unique().tolist(),
            'column_mapping':    column_mapping,
            'dataset_id':        dataset_id,
            'workspace_id':      workspace_id
        }), 200

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


# ── Download ─────────────────────────────────────────────────────────────────
@upload_bp.route('/download')
@login_required
def download_file(user_id):
    # TODO: Could restrict download based on ownership
    output_path = os.path.join(UPLOAD_FOLDER, 'output.csv')
    if os.path.exists(output_path):
        return send_file(output_path, as_attachment=True)
    return jsonify({'error': 'File not found'}), 404
