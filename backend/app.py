"""Flask API server for the Interactive Intrusion Detection System."""

import time
import numpy as np
import pandas as pd
from flask import Flask, jsonify, request
from flask_cors import CORS

from backend.config import (
    DEFAULT_FEATURES,
    DEFAULT_BIN_SIZE,
    DEFAULT_HAZARD_RATE,
    ATTACK_COLORS,
    BIN_SIZES,
    HEATMAP_DOWNSAMPLE,
)
from backend.data_loader import (
    load_raw_data,
    aggregate_time_bins,
    get_available_features,
    get_time_range,
    get_available_days,
    get_network_flows,
)
from backend.bocd import BOCD
from backend.feature_analysis import rank_features

import os as _os
_frontend_dir = _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), "frontend")

app = Flask(__name__, static_folder=_frontend_dir, static_url_path="")
CORS(app)

# Global data cache
_data_cache = {}


def get_data(day=None):
    """Load data with caching."""
    key = day or "all"
    if key not in _data_cache:
        _data_cache[key] = load_raw_data(day)
    return _data_cache[key]


@app.route("/api/features", methods=["GET"])
def api_features():
    """Return available features and recommended defaults."""
    day = request.args.get("day", "Wednesday")
    try:
        df = get_data(day)
        features = get_available_features(df)
        return jsonify(
            {
                "features": features,
                "default_features": [f for f in DEFAULT_FEATURES if f in features],
            }
        )
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/time-range", methods=["GET"])
def api_time_range():
    """Return dataset time boundaries."""
    day = request.args.get("day", "Wednesday")
    try:
        df = get_data(day)
        time_range = get_time_range(df)
        time_range["days"] = get_available_days()
        return jsonify(time_range)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/timeseries", methods=["GET"])
def api_timeseries():
    """Return aggregated time-series data for a feature."""
    feature = request.args.get("feature", "Flow Bytes/s")
    day = request.args.get("day", "Wednesday")
    start = request.args.get("start")
    end = request.args.get("end")
    bin_size_str = request.args.get("bin_size", DEFAULT_BIN_SIZE)

    bin_size = BIN_SIZES.get(bin_size_str, BIN_SIZES[DEFAULT_BIN_SIZE])

    try:
        df = get_data(day)

        # Filter time range if specified
        if start:
            df = df[df["Timestamp"] >= pd.to_datetime(start)]
        if end:
            df = df[df["Timestamp"] <= pd.to_datetime(end)]

        agg = aggregate_time_bins(df, feature, bin_size)

        # Handle NaN in JSON output
        values = agg["value_mean"].fillna(0).round(4).tolist()
        stds = agg["value_std"].fillna(0).round(4).tolist()

        return jsonify(
            {
                "timestamps": agg["timestamp"].dt.strftime("%Y-%m-%dT%H:%M:%S").tolist(),
                "values": values,
                "stds": stds,
                "counts": agg["count"].tolist(),
                "attack_fractions": agg["attack_fraction"].round(4).tolist(),
                "dominant_labels": agg["dominant_label"].tolist(),
                "metadata": {
                    "total_points": len(agg),
                    "bin_size": bin_size_str,
                    "feature": feature,
                },
            }
        )
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/bocd", methods=["POST"])
def api_bocd():
    """Run BOCD on a feature and return posterior distribution."""
    body = request.get_json()
    feature = body.get("feature", "Flow Bytes/s")
    day = body.get("day", "Wednesday")
    start = body.get("start")
    end = body.get("end")
    bin_size_str = body.get("bin_size", DEFAULT_BIN_SIZE)
    hazard_rate = body.get("hazard_rate", DEFAULT_HAZARD_RATE)

    bin_size = BIN_SIZES.get(bin_size_str, BIN_SIZES[DEFAULT_BIN_SIZE])

    try:
        t0 = time.time()

        df = get_data(day)

        # Filter time range
        if start:
            df = df[df["Timestamp"] >= pd.to_datetime(start)]
        if end:
            df = df[df["Timestamp"] <= pd.to_datetime(end)]

        # Aggregate
        agg = aggregate_time_bins(df, feature, bin_size)
        values = agg["value_mean"].values

        # Handle NaN values
        values = np.nan_to_num(values, nan=0.0)

        if len(values) < 2:
            return jsonify({"error": "Not enough data points for BOCD"}), 400

        # Run BOCD
        model = BOCD(hazard_rate=hazard_rate)
        results = model.run(values)

        # Downsample posterior matrix for transfer
        downsampled = BOCD.downsample_matrix(
            results["posterior_matrix"],
            target_rows=min(HEATMAP_DOWNSAMPLE, len(values)),
            target_cols=HEATMAP_DOWNSAMPLE,
        )

        computation_time = (time.time() - t0) * 1000

        return jsonify(
            {
                "posterior_matrix": downsampled.round(6).tolist(),
                "matrix_shape": list(downsampled.shape),
                "changepoint_probs": results["changepoint_probs"].round(6).tolist(),
                "map_run_lengths": results["map_run_lengths"].tolist(),
                "timestamps": agg["timestamp"].dt.strftime("%Y-%m-%dT%H:%M:%S").tolist(),
                "computation_time_ms": round(computation_time, 1),
            }
        )
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/network-flows", methods=["GET"])
def api_network_flows():
    """Return aggregated network flows for topology visualization."""
    day = request.args.get("day", "Wednesday")
    start = request.args.get("start")
    end = request.args.get("end")
    top_n = int(request.args.get("top_n", 50))

    try:
        df = get_data(day)
        flows = get_network_flows(df, start, end, top_n)
        return jsonify(flows)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/attack-summary", methods=["GET"])
def api_attack_summary():
    """Return attack label distribution for the selected time range."""
    day = request.args.get("day", "Wednesday")
    start = request.args.get("start")
    end = request.args.get("end")

    try:
        df = get_data(day)

        if start:
            df = df[df["Timestamp"] >= pd.to_datetime(start)]
        if end:
            df = df[df["Timestamp"] <= pd.to_datetime(end)]

        label_counts = df["Label"].value_counts().to_dict()
        label_counts = {k: int(v) for k, v in label_counts.items()}

        return jsonify(
            {
                "labels": label_counts,
                "total": int(len(df)),
                "attack_colors": ATTACK_COLORS,
            }
        )
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/feature-ranking", methods=["GET"])
def api_feature_ranking():
    """Return features ranked by attack correlation."""
    day = request.args.get("day", "Wednesday")
    top_n = int(request.args.get("top_n", 15))

    try:
        df = get_data(day)
        rankings = rank_features(df)[:top_n]
        return jsonify(
            {
                "rankings": [{"feature": f, "correlation": c} for f, c in rankings],
            }
        )
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/")
def index():
    """Serve the frontend."""
    return app.send_static_file("index.html")


if __name__ == "__main__":
    print(f"Serving frontend from: {_frontend_dir}")
    print("Loading data... (this may take a moment on first run)")
    print("Open http://localhost:5000 in your browser")
    app.run(debug=True, port=5000)
