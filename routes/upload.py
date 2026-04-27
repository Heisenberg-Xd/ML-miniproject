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
        ws = conn.execute(
            text("SELECT id FROM workspaces WHERE id = :id AND user_id = :user_id"),
            {"id": workspace_id, "user_id": user_id}
        ).fetchone()
        if not ws:
            return jsonify({'error': 'Workspace not found or unauthorized'}), 403

    filename  = f"{datetime.now().timestamp()}_{file.filename}"
    filepath  = os.path.join(UPLOAD_FOLDER, filename)
    file.save(filepath)

    try:
        # ── Load and map columns ──────────────────────────────────────────────
        raw = pd.read_csv(filepath)
        raw, column_mapping = map_sales_columns(raw)

        # Basic validation feedback
        invalid_counts = {
            "customer_id_null_rows":          int(raw["customer_id"].isna().sum()),
            "transaction_date_invalid_rows":  int(pd.to_datetime(raw["transaction_date"], errors="coerce").isna().sum()),
            "amount_invalid_rows":            int(pd.to_numeric(raw["amount"], errors="coerce").isna().sum()),
        }
        if raw["customer_id"].isna().all():
            return _validation_error("Mapped customer_id is empty for all rows.",
                                     {"column_mapping": column_mapping, "invalid_counts": invalid_counts})
        if pd.to_datetime(raw["transaction_date"], errors="coerce").isna().all():
            return _validation_error("Mapped transaction_date could not be parsed as dates.",
                                     {"column_mapping": column_mapping, "invalid_counts": invalid_counts})
        raw["amount"] = pd.to_numeric(raw["amount"], errors="coerce")
        if raw["amount"].isna().all():
            return _validation_error("Mapped amount is non-numeric or empty for all rows.",
                                     {"column_mapping": column_mapping, "invalid_counts": invalid_counts})

        # ── Create manual data_source entry ───────────────────────────────────
        source_id = None
        try:
            from models import insert_data_source
            with get_connection() as conn:
                if conn is not None:
                    source_id = insert_data_source(
                        conn,
                        workspace_id=int(workspace_id),
                        source_type="manual",
                        config={"original_filename": file.filename},
                        auto_sync_enabled=False,
                    )
        except Exception as src_err:
            logger.warning(f"[Upload] Could not create data_source entry: {src_err}")

        # ── Save output CSV for backward-compat download ───────────────────────
        session_id = datetime.now().strftime("%Y%m%d%H%M%S")

        # ── Run clustering pipeline ───────────────────────────────────────────
        from services.clustering_service import run_clustering
        result = run_clustering(
            df=raw,
            workspace_id=int(workspace_id),
            filename=file.filename,
            source_id=source_id,
            ingestion_type="manual",
        )

        # Save output CSV for /download endpoint (backward compat)
        output_path  = os.path.join(UPLOAD_FOLDER, 'output.csv')
        session_path = os.path.join(UPLOAD_FOLDER, f'session_{session_id}.csv')
        raw.to_csv(output_path, index=False)
        raw.to_csv(session_path, index=False)

        return jsonify({
            'message':           'File processed successfully!',
            'download_url':      f'{BASE_URL}/download',
            'session_id':        session_id,
            'visualization_url': f'/visualization/{session_id}',
            'total_customers':   result.get("total_customers"),
            'segments_found':    result.get("segments_found"),
            'column_mapping':    column_mapping,
            'dataset_id':        result.get("dataset_id"),
            'workspace_id':      workspace_id,
            'source_id':         source_id,
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
