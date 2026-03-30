import os
import numpy as np
import pandas as pd
from backend.config import (
    DATA_DIR,
    PARQUET_FILES,
    DAY_TIME_RANGES,
    LABEL_COL,
)


def load_raw_data(day=None):
    """Load CIC-IDS2017 parquet files and add synthetic timestamps.

    Args:
        day: Optional day key (e.g., 'Tuesday'). If None, loads all files.

    Returns:
        Cleaned pandas DataFrame with a synthetic Timestamp column.
    """
    if day:
        files = {day: PARQUET_FILES[day]} if day in PARQUET_FILES else {}
    else:
        files = PARQUET_FILES

    frames = []
    for key, filename in files.items():
        path = os.path.join(DATA_DIR, filename)
        if not os.path.exists(path):
            print(f"Warning: {path} not found, skipping")
            continue

        df = pd.read_parquet(path)

        # Add synthetic timestamp spanning the day's time range
        start_str, end_str = DAY_TIME_RANGES.get(key, ("2017-07-03 09:00:00", "2017-07-03 17:00:00"))
        start = pd.Timestamp(start_str)
        end = pd.Timestamp(end_str)
        n = len(df)
        df["Timestamp"] = pd.date_range(start=start, end=end, periods=n)
        df["_day"] = key

        frames.append(df)

    if not frames:
        raise FileNotFoundError(f"No parquet files found in {DATA_DIR}")

    df = pd.concat(frames, ignore_index=True)

    # Replace infinity with NaN in numeric columns
    numeric_cols = df.select_dtypes(include=[np.number]).columns
    df[numeric_cols] = df[numeric_cols].replace([np.inf, -np.inf], np.nan)

    # Strip label whitespace if any
    df[LABEL_COL] = df[LABEL_COL].astype(str).str.strip()

    # Sort by timestamp
    df = df.sort_values("Timestamp").reset_index(drop=True)

    return df


def aggregate_time_bins(df, feature, bin_size=1000):
    """Aggregate a feature into fixed-size row bins with statistics.

    Since timestamps are synthetic (evenly spaced), we bin by row count
    which maps directly to equal time intervals.

    Args:
        df: DataFrame with Timestamp and Label columns.
        feature: Numeric column name to aggregate.
        bin_size: Number of rows per bin.

    Returns:
        DataFrame with columns: timestamp, value_mean, value_std, count,
        attack_fraction, dominant_label.
    """
    if feature not in df.columns:
        raise ValueError(f"Feature '{feature}' not found in data")

    subset = df[["Timestamp", feature, LABEL_COL]].copy()
    subset[feature] = pd.to_numeric(subset[feature], errors="coerce")
    subset = subset.dropna(subset=[feature])

    # Create bin indices
    n = len(subset)
    subset["bin"] = np.arange(n) // bin_size

    # Aggregate per bin
    grouped = subset.groupby("bin")

    agg = grouped.agg(
        timestamp=("Timestamp", "first"),
        value_mean=(feature, "mean"),
        value_std=(feature, "std"),
        count=(feature, "count"),
    )

    # Attack fraction per bin
    def attack_frac(group):
        return (group[LABEL_COL] != "Benign").mean()

    def dominant_label(group):
        if len(group) == 0:
            return "Benign"
        mode = group[LABEL_COL].mode()
        return mode.iloc[0] if len(mode) > 0 else "Benign"

    agg["attack_fraction"] = grouped.apply(attack_frac, include_groups=False).values
    agg["dominant_label"] = grouped.apply(dominant_label, include_groups=False).values

    # Clean up
    agg["value_std"] = agg["value_std"].fillna(0)
    agg = agg.reset_index(drop=True)

    return agg


def get_available_features(df):
    """Return list of numeric column names suitable for analysis."""
    exclude = {"Timestamp", LABEL_COL, "_day"}
    numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist()
    return [c for c in numeric_cols if c not in exclude]


def get_time_range(df):
    """Return the min and max timestamps as ISO format strings."""
    return {
        "min": df["Timestamp"].min().isoformat(),
        "max": df["Timestamp"].max().isoformat(),
    }


def get_available_days():
    """Return list of days that have parquet files in the data directory."""
    available = []
    for key, filename in PARQUET_FILES.items():
        if os.path.exists(os.path.join(DATA_DIR, filename)):
            available.append(key)
    return available


def get_network_flows(df, start=None, end=None, top_n=50):
    """Generate pseudo network flows from the data.

    Since the parquet files lack IP columns, we group by label and
    create a simplified flow topology based on attack types.
    """
    subset = df.copy()
    if start:
        subset = subset[subset["Timestamp"] >= pd.to_datetime(start)]
    if end:
        subset = subset[subset["Timestamp"] <= pd.to_datetime(end)]

    if len(subset) == 0:
        return {"nodes": [], "links": []}

    # Create nodes from label types and synthetic network segments
    label_counts = subset[LABEL_COL].value_counts().head(top_n)
    nodes = []
    links = []

    # Create a "Network" hub node
    nodes.append({"id": "Network", "type": "internal", "totalFlows": int(len(subset))})

    for label, count in label_counts.items():
        node_type = "internal" if label == "Benign" else "external"
        nodes.append({"id": label, "type": node_type, "totalFlows": int(count)})
        links.append({
            "source": "Network",
            "target": label,
            "flowCount": int(count),
            "attackFraction": 0.0 if label == "Benign" else 1.0,
        })

    return {"nodes": nodes, "links": links}
