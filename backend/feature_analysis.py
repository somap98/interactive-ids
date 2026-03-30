"""Feature analysis utilities for ranking and selecting network traffic features."""

import numpy as np
import pandas as pd
from scipy.stats import pointbiserialr
from backend.config import LABEL_COL


def compute_feature_stats(df, features):
    """Compute basic statistics for each feature.

    Returns dict mapping feature name to {min, max, mean, std, skew}.
    """
    stats = {}
    for feat in features:
        if feat not in df.columns:
            continue
        col = pd.to_numeric(df[feat], errors="coerce").dropna()
        if len(col) == 0:
            continue
        stats[feat] = {
            "min": float(col.min()),
            "max": float(col.max()),
            "mean": float(col.mean()),
            "std": float(col.std()),
            "skew": float(col.skew()),
        }
    return stats


def rank_features(df, features=None):
    """Rank features by point-biserial correlation with the attack label.

    Higher absolute correlation means the feature better discriminates
    between attack and benign traffic.

    Returns:
        List of (feature_name, correlation) tuples, sorted by |correlation| descending.
    """
    if features is None:
        from backend.data_loader import get_available_features

        features = get_available_features(df)

    # Binary attack indicator
    is_attack = (df[LABEL_COL] != "Benign").astype(int).values

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
