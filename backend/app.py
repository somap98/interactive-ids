import os
import time
import numpy as np
import pandas as pd
from flask import Flask, jsonify, request
from flask_cors import CORS
from scipy.stats import t as student_t, pointbiserialr

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")

PARQUET_FILES = {
    "Monday": "Benign-Monday-no-metadata.parquet",
    "Tuesday": "Bruteforce-Tuesday-no-metadata.parquet",
    "Wednesday": "DoS-Wednesday-no-metadata.parquet",
    "Thursday-Web": "WebAttacks-Thursday-no-metadata.parquet",
    "Thursday-Infil": "Infiltration-Thursday-no-metadata.parquet",
    "Friday-Bot": "Botnet-Friday-no-metadata.parquet",
    "Friday-Port": "Portscan-Friday-no-metadata.parquet",
    "Friday-DDoS": "DDoS-Friday-no-metadata.parquet",
}

DAY_TIME_RANGES = {
    "Monday": ("2017-07-03 09:00:00", "2017-07-03 17:00:00"),
    "Tuesday": ("2017-07-04 09:00:00", "2017-07-04 17:00:00"),
    "Wednesday": ("2017-07-05 09:00:00", "2017-07-05 17:00:00"),
    "Thursday-Web": ("2017-07-06 09:00:00", "2017-07-06 12:00:00"),
    "Thursday-Infil": ("2017-07-06 13:00:00", "2017-07-06 17:00:00"),
    "Friday-Bot": ("2017-07-07 09:00:00", "2017-07-07 11:00:00"),
    "Friday-Port": ("2017-07-07 11:00:00", "2017-07-07 14:00:00"),
    "Friday-DDoS": ("2017-07-07 14:00:00", "2017-07-07 17:00:00"),
}

DEFAULT_FEATURES = [
    "Flow Duration", "Total Fwd Packets", "Total Backward Packets",
    "Flow Bytes/s", "Flow Packets/s", "Fwd Packet Length Mean",
    "Bwd Packet Length Mean", "Flow IAT Mean", "Fwd IAT Mean",
    "Avg Packet Size", "Packet Length Variance", "Subflow Fwd Bytes",
]

ATTACK_COLORS = {
    "Benign": "#4CAF50", "DoS Hulk": "#F44336", "DoS GoldenEye": "#E91E63",
    "DoS slowloris": "#FF5722", "DoS Slowhttptest": "#FF9800", "DDoS": "#9C27B0",
    "PortScan": "#2196F3", "FTP-Patator": "#00BCD4", "SSH-Patator": "#009688",
    "Bot": "#795548", "Web Attack - Brute Force": "#FFEB3B",
    "Web Attack - XSS": "#FFC107", "Web Attack - Sql Injection": "#FF9800",
    "Infiltration": "#607D8B", "Heartbleed": "#D50000",
}

DEFAULT_HAZARD_RATE = 1 / 200
MAX_RUN_LENGTH = 500
HEATMAP_DOWNSAMPLE = 200
BIN_SIZES = {"100": 100, "500": 500, "1000": 1000, "2000": 2000, "5000": 5000}
DEFAULT_BIN_SIZE = "1000"


def load_raw_data(day=None):
    files = {day: PARQUET_FILES[day]} if day and day in PARQUET_FILES else PARQUET_FILES if not day else {}
    frames = []
    for key, filename in files.items():
        path = os.path.join(DATA_DIR, filename)
        if not os.path.exists(path):
            continue
        df = pd.read_parquet(path)
        start_str, end_str = DAY_TIME_RANGES.get(key, ("2017-07-03 09:00:00", "2017-07-03 17:00:00"))
        df["Timestamp"] = pd.date_range(start=pd.Timestamp(start_str), end=pd.Timestamp(end_str), periods=len(df))
        df["_day"] = key
        frames.append(df)
    if not frames:
        raise FileNotFoundError(f"No parquet files found in {DATA_DIR}")
    df = pd.concat(frames, ignore_index=True)
    numeric_cols = df.select_dtypes(include=[np.number]).columns
    df[numeric_cols] = df[numeric_cols].replace([np.inf, -np.inf], np.nan)
    df["Label"] = df["Label"].astype(str).str.strip()
    return df.sort_values("Timestamp").reset_index(drop=True)


def aggregate_time_bins(df, feature, bin_size=1000):
    if feature not in df.columns:
        raise ValueError(f"Feature '{feature}' not found in data")
    subset = df[["Timestamp", feature, "Label"]].copy()
    subset[feature] = pd.to_numeric(subset[feature], errors="coerce")
    subset = subset.dropna(subset=[feature])
    subset["bin"] = np.arange(len(subset)) // bin_size
    grouped = subset.groupby("bin")
    agg = grouped.agg(
        timestamp=("Timestamp", "first"),
        value_mean=(feature, "mean"),
        value_std=(feature, "std"),
        count=(feature, "count"),
    )
    agg["attack_fraction"] = grouped.apply(lambda g: (g["Label"] != "Benign").mean(), include_groups=False).values
    agg["dominant_label"] = grouped.apply(
        lambda g: g["Label"].mode().iloc[0] if len(g["Label"].mode()) > 0 else "Benign", include_groups=False
    ).values
    agg["value_std"] = agg["value_std"].fillna(0)
    return agg.reset_index(drop=True)


def get_available_features(df):
    exclude = {"Timestamp", "Label", "_day"}
    return [c for c in df.select_dtypes(include=[np.number]).columns if c not in exclude]


def get_available_days():
    return [k for k, v in PARQUET_FILES.items() if os.path.exists(os.path.join(DATA_DIR, v))]


def get_network_flows(df, start=None, end=None, top_n=50):
    subset = df.copy()
    if start:
        subset = subset[subset["Timestamp"] >= pd.to_datetime(start)]
    if end:
        subset = subset[subset["Timestamp"] <= pd.to_datetime(end)]
    if len(subset) == 0:
        return {"nodes": [], "links": []}
    label_counts = subset["Label"].value_counts().head(top_n)
    nodes = [{"id": "Network", "type": "internal", "totalFlows": int(len(subset))}]
    links = []
    for label, count in label_counts.items():
        node_type = "internal" if label == "Benign" else "external"
        nodes.append({"id": label, "type": node_type, "totalFlows": int(count)})
        links.append({"source": "Network", "target": label, "flowCount": int(count),
                       "attackFraction": 0.0 if label == "Benign" else 1.0})
    return {"nodes": nodes, "links": links}


def rank_features(df, features=None):
    if features is None:
        features = get_available_features(df)
    is_attack = (df["Label"] != "Benign").astype(int).values
    rankings = []
    for feat in features:
        if feat not in df.columns:
            continue
        values = pd.to_numeric(df[feat], errors="coerce")
        mask = values.notna()
        if mask.sum() < 10:
            continue
        try:
            corr, _ = pointbiserialr(is_attack[mask], values[mask].values)
            if not np.isnan(corr):
                rankings.append((feat, float(abs(corr))))
        except Exception:
            continue
    rankings.sort(key=lambda x: x[1], reverse=True)
    return rankings


class BOCD:
    def __init__(self, hazard_rate=1/200, mu0=0.0, kappa0=1.0, alpha0=0.1, beta0=0.1):
        self.hazard_rate = hazard_rate
        self.mu0 = mu0
        self.kappa0 = kappa0
        self.alpha0 = alpha0
        self.beta0 = beta0
        self._reset()

    def _reset(self):
        self.mu_params = np.array([self.mu0])
        self.kappa_params = np.array([self.kappa0])
        self.alpha_params = np.array([self.alpha0])
        self.beta_params = np.array([self.beta0])
        self.run_length_posterior = np.array([1.0])
        self.t = 0

    def _predictive_prob(self, x):
        df = 2 * self.alpha_params
        loc = self.mu_params
        scale = np.sqrt(self.beta_params * (self.kappa_params + 1) / (self.alpha_params * self.kappa_params))
        return student_t.pdf(x, df=df, loc=loc, scale=scale)

    def update(self, x):
        pred_probs = self._predictive_prob(x)
        growth = self.run_length_posterior * pred_probs * (1 - self.hazard_rate)
        changepoint = np.sum(self.run_length_posterior * pred_probs * self.hazard_rate)
        new_posterior = np.append(changepoint, growth)
        evidence = new_posterior.sum()
        if evidence > 0:
            new_posterior /= evidence
        if len(new_posterior) > MAX_RUN_LENGTH:
            new_posterior[MAX_RUN_LENGTH - 1] += new_posterior[MAX_RUN_LENGTH:].sum()
            new_posterior = new_posterior[:MAX_RUN_LENGTH]
        mu_new = (self.kappa_params * self.mu_params + x) / (self.kappa_params + 1)
        kappa_new = self.kappa_params + 1
        alpha_new = self.alpha_params + 0.5
        beta_new = self.beta_params + self.kappa_params * (x - self.mu_params) ** 2 / (2 * (self.kappa_params + 1))
        self.mu_params = np.append([self.mu0], mu_new)
        self.kappa_params = np.append([self.kappa0], kappa_new)
        self.alpha_params = np.append([self.alpha0], alpha_new)
        self.beta_params = np.append([self.beta0], beta_new)
        if len(self.mu_params) > MAX_RUN_LENGTH:
            self.mu_params = self.mu_params[:MAX_RUN_LENGTH]
            self.kappa_params = self.kappa_params[:MAX_RUN_LENGTH]
            self.alpha_params = self.alpha_params[:MAX_RUN_LENGTH]
            self.beta_params = self.beta_params[:MAX_RUN_LENGTH]
        self.run_length_posterior = new_posterior
        self.t += 1
        return new_posterior

    def run(self, data):
        self._reset()
        data = np.asarray(data, dtype=np.float64)
        data_mean = np.nanmean(data)
        data_std = np.nanstd(data)
        if data_std == 0:
            data_std = 1.0
        standardized = (data - data_mean) / data_std
        T = len(data)
        max_rl = min(MAX_RUN_LENGTH, T + 1)
        posterior_matrix = np.zeros((T, max_rl))
        changepoint_probs = np.zeros(T)
        map_run_lengths = np.zeros(T, dtype=int)
        for i in range(T):
            posterior = self.update(standardized[i])
            length = min(len(posterior), max_rl)
            posterior_matrix[i, :length] = posterior[:length]
            changepoint_probs[i] = posterior[0]
            map_run_lengths[i] = np.argmax(posterior)
        combined_scores = np.copy(changepoint_probs)
        for i in range(1, T):
            if map_run_lengths[i] < map_run_lengths[i - 1]:
                drop = map_run_lengths[i - 1] - map_run_lengths[i]
                drop_score = min(1.0, drop / max(map_run_lengths[i - 1], 1))
                combined_scores[i] = max(combined_scores[i], drop_score)
        return {
            "posterior_matrix": posterior_matrix,
            "changepoint_probs": combined_scores,
            "raw_cp_probs": changepoint_probs,
            "map_run_lengths": map_run_lengths,
        }

    @staticmethod
    def downsample_matrix(matrix, target_rows=HEATMAP_DOWNSAMPLE, target_cols=HEATMAP_DOWNSAMPLE):
        T, R = matrix.shape
        if T <= target_rows and R <= target_cols:
            return matrix
        if T > target_rows:
            row_bins = np.array_split(range(T), target_rows)
            downsampled = np.zeros((target_rows, R))
            for i, bin_indices in enumerate(row_bins):
                downsampled[i] = matrix[bin_indices].max(axis=0)
        else:
            downsampled = matrix
        if R > target_cols:
            col_bins = np.array_split(range(R), target_cols)
            result = np.zeros((downsampled.shape[0], target_cols))
            for j, bin_indices in enumerate(col_bins):
                result[:, j] = downsampled[:, bin_indices].max(axis=1)
            downsampled = result
        return downsampled


_frontend_dir = os.path.join(BASE_DIR, "frontend")
app = Flask(__name__, static_folder=_frontend_dir, static_url_path="")
CORS(app)
_data_cache = {}


def get_data(day=None):
    key = day or "all"
    if key not in _data_cache:
        _data_cache[key] = load_raw_data(day)
    return _data_cache[key]


@app.route("/api/features", methods=["GET"])
def api_features():
    day = request.args.get("day", "Wednesday")
    try:
        df = get_data(day)
        features = get_available_features(df)
        return jsonify({"features": features, "default_features": [f for f in DEFAULT_FEATURES if f in features]})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/time-range", methods=["GET"])
def api_time_range():
    day = request.args.get("day", "Wednesday")
    try:
        df = get_data(day)
        return jsonify({"min": df["Timestamp"].min().isoformat(), "max": df["Timestamp"].max().isoformat(), "days": get_available_days()})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/timeseries", methods=["GET"])
def api_timeseries():
    feature = request.args.get("feature", "Flow Bytes/s")
    day = request.args.get("day", "Wednesday")
    start = request.args.get("start")
    end = request.args.get("end")
    bin_size = BIN_SIZES.get(request.args.get("bin_size", DEFAULT_BIN_SIZE), BIN_SIZES[DEFAULT_BIN_SIZE])
    try:
        df = get_data(day)
        if start:
            df = df[df["Timestamp"] >= pd.to_datetime(start)]
        if end:
            df = df[df["Timestamp"] <= pd.to_datetime(end)]
        agg = aggregate_time_bins(df, feature, bin_size)
        return jsonify({
            "timestamps": agg["timestamp"].dt.strftime("%Y-%m-%dT%H:%M:%S").tolist(),
            "values": agg["value_mean"].fillna(0).round(4).tolist(),
            "stds": agg["value_std"].fillna(0).round(4).tolist(),
            "counts": agg["count"].tolist(),
            "attack_fractions": agg["attack_fraction"].round(4).tolist(),
            "dominant_labels": agg["dominant_label"].tolist(),
            "metadata": {"total_points": len(agg), "bin_size": request.args.get("bin_size", DEFAULT_BIN_SIZE), "feature": feature},
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/bocd", methods=["POST"])
def api_bocd():
    body = request.get_json()
    feature = body.get("feature", "Flow Bytes/s")
    day = body.get("day", "Wednesday")
    start = body.get("start")
    end = body.get("end")
    bin_size = BIN_SIZES.get(body.get("bin_size", DEFAULT_BIN_SIZE), BIN_SIZES[DEFAULT_BIN_SIZE])
    hazard_rate = body.get("hazard_rate", DEFAULT_HAZARD_RATE)
    try:
        t0 = time.time()
        df = get_data(day)
        if start:
            df = df[df["Timestamp"] >= pd.to_datetime(start)]
        if end:
            df = df[df["Timestamp"] <= pd.to_datetime(end)]
        agg = aggregate_time_bins(df, feature, bin_size)
        values = np.nan_to_num(agg["value_mean"].values, nan=0.0)
        if len(values) < 2:
            return jsonify({"error": "Not enough data points for BOCD"}), 400
        model = BOCD(hazard_rate=hazard_rate)
        results = model.run(values)
        downsampled = BOCD.downsample_matrix(
            results["posterior_matrix"],
            target_rows=min(HEATMAP_DOWNSAMPLE, len(values)),
            target_cols=HEATMAP_DOWNSAMPLE,
        )
        return jsonify({
            "posterior_matrix": downsampled.round(6).tolist(),
            "matrix_shape": list(downsampled.shape),
            "changepoint_probs": results["changepoint_probs"].round(6).tolist(),
            "map_run_lengths": results["map_run_lengths"].tolist(),
            "timestamps": agg["timestamp"].dt.strftime("%Y-%m-%dT%H:%M:%S").tolist(),
            "computation_time_ms": round((time.time() - t0) * 1000, 1),
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/network-flows", methods=["GET"])
def api_network_flows():
    day = request.args.get("day", "Wednesday")
    try:
        df = get_data(day)
        return jsonify(get_network_flows(df, request.args.get("start"), request.args.get("end"), int(request.args.get("top_n", 50))))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/attack-summary", methods=["GET"])
def api_attack_summary():
    day = request.args.get("day", "Wednesday")
    start = request.args.get("start")
    end = request.args.get("end")
    try:
        df = get_data(day)
        if start:
            df = df[df["Timestamp"] >= pd.to_datetime(start)]
        if end:
            df = df[df["Timestamp"] <= pd.to_datetime(end)]
        label_counts = {k: int(v) for k, v in df["Label"].value_counts().to_dict().items()}
        return jsonify({"labels": label_counts, "total": int(len(df)), "attack_colors": ATTACK_COLORS})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/feature-ranking", methods=["GET"])
def api_feature_ranking():
    day = request.args.get("day", "Wednesday")
    top_n = int(request.args.get("top_n", 15))
    try:
        df = get_data(day)
        rankings = rank_features(df)[:top_n]
        return jsonify({"rankings": [{"feature": f, "correlation": c} for f, c in rankings]})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/")
def index():
    return app.send_static_file("index.html")


if __name__ == "__main__":
    print(f"Serving frontend from: {_frontend_dir}")
    print("Loading data... (this may take a moment on first run)")
    print("Open http://localhost:5000 in your browser")
    app.run(debug=True, port=5000)
