"""Bayesian Online Changepoint Detection (Adams & MacKay, 2007).

Implements the BOCD algorithm with a Normal-Gamma conjugate prior,
producing run-length posterior distributions that can be visualized
as heatmaps to identify changepoints in network traffic data.

Reference: Adams, R. P., & MacKay, D. J. C. (2007).
    Bayesian online changepoint detection. arXiv:0710.3742.
"""

import numpy as np
from scipy.stats import t as student_t
from backend.config import MAX_RUN_LENGTH, HEATMAP_DOWNSAMPLE


class BOCD:
    """Bayesian Online Changepoint Detection with Gaussian likelihood.

    Uses a Normal-Gamma conjugate prior for efficient online updates.
    The hazard function is constant (geometric prior on run lengths).

    Key insight: at each timestep, we maintain the predictive distribution
    conditioned on each possible run length. A changepoint resets to r=0,
    using the prior predictive; growth increments the run length, using
    the updated predictive.
    """

    def __init__(self, hazard_rate=1 / 200, mu0=0.0, kappa0=1.0, alpha0=0.1, beta0=0.1):
        """Initialize BOCD model.

        Args:
            hazard_rate: Prior probability of a changepoint at any step.
            mu0: Prior mean.
            kappa0: Prior pseudo-count for mean.
            alpha0: Prior shape for precision (Gamma).
            beta0: Prior rate for precision (Gamma).
        """
        self.hazard_rate = hazard_rate
        self.mu0 = mu0
        self.kappa0 = kappa0
        self.alpha0 = alpha0
        self.beta0 = beta0
        self._reset()

    def _reset(self):
        """Reset internal state for a new run."""
        self.mu_params = np.array([self.mu0])
        self.kappa_params = np.array([self.kappa0])
        self.alpha_params = np.array([self.alpha0])
        self.beta_params = np.array([self.beta0])
        self.run_length_posterior = np.array([1.0])
        self.t = 0

    def _predictive_prob(self, x):
        """Compute predictive probability of x under each run-length hypothesis.

        Uses Student-t as the marginal likelihood under Normal-Gamma prior.
        Returns one probability per current run-length hypothesis.
        """
        df = 2 * self.alpha_params
        loc = self.mu_params
        scale = np.sqrt(
            self.beta_params * (self.kappa_params + 1) / (self.alpha_params * self.kappa_params)
        )
        return student_t.pdf(x, df=df, loc=loc, scale=scale)

    def update(self, x):
        """Process a single observation and return the updated run-length posterior.

        The key step (Adams & MacKay Eq. 1-3):
        1. Evaluate predictive prob of x under each run-length
        2. Growth: P(r_t = r+1, x_{1:t}) = P(x_t|r) * P(r_{t-1}=r) * (1-H)
        3. Changepoint: P(r_t = 0, x_{1:t}) = sum_r P(x_t|r) * P(r_{t-1}=r) * H
        4. Normalize

        The changepoint probability CAN exceed the hazard rate when the data
        under existing run-lengths is much less probable than under a fresh start.
        This happens because growth probabilities drop (pred under long run is low)
        while changepoint mass collects from all run-lengths weighted by their
        predictive probs.
        """
        # Predictive probabilities under each current run-length
        pred_probs = self._predictive_prob(x)

        # Growth probabilities: existing run-lengths continue
        growth = self.run_length_posterior * pred_probs * (1 - self.hazard_rate)

        # Changepoint: all run-lengths contribute mass to r=0
        changepoint = np.sum(self.run_length_posterior * pred_probs * self.hazard_rate)

        # New joint distribution
        new_posterior = np.append(changepoint, growth)

        # Normalize to get posterior
        evidence = new_posterior.sum()
        if evidence > 0:
            new_posterior /= evidence

        # Truncate for memory
        if len(new_posterior) > MAX_RUN_LENGTH:
            new_posterior[MAX_RUN_LENGTH - 1] += new_posterior[MAX_RUN_LENGTH:].sum()
            new_posterior = new_posterior[:MAX_RUN_LENGTH]

        # Update sufficient statistics AFTER computing posterior
        # New params for run-length 0 use the prior (fresh segment)
        mu_new = (self.kappa_params * self.mu_params + x) / (self.kappa_params + 1)
        kappa_new = self.kappa_params + 1
        alpha_new = self.alpha_params + 0.5
        beta_new = (
            self.beta_params
            + self.kappa_params * (x - self.mu_params) ** 2 / (2 * (self.kappa_params + 1))
        )

        # Prepend prior for r=0 (new segment starts fresh)
        self.mu_params = np.append([self.mu0], mu_new)
        self.kappa_params = np.append([self.kappa0], kappa_new)
        self.alpha_params = np.append([self.alpha0], alpha_new)
        self.beta_params = np.append([self.beta0], beta_new)

        # Truncate params
        if len(self.mu_params) > MAX_RUN_LENGTH:
            self.mu_params = self.mu_params[:MAX_RUN_LENGTH]
            self.kappa_params = self.kappa_params[:MAX_RUN_LENGTH]
            self.alpha_params = self.alpha_params[:MAX_RUN_LENGTH]
            self.beta_params = self.beta_params[:MAX_RUN_LENGTH]

        self.run_length_posterior = new_posterior
        self.t += 1
        return new_posterior

    def run(self, data):
        """Run BOCD on an entire data array.

        Args:
            data: 1D numpy array of observations.

        Returns:
            Dictionary with:
                - posterior_matrix: 2D array (T x max_rl) of run-length posteriors
                - changepoint_probs: 1D array of P(r_t=0) per timestep
                - map_run_lengths: 1D array of MAP run length per timestep
        """
        self._reset()
        data = np.asarray(data, dtype=np.float64)

        # Standardize for numerical stability
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

        # Combine two changepoint signals:
        # 1. P(r_t=0): direct Bayesian probability of a changepoint
        # 2. MAP drops: when the most likely run length drops sharply
        # The combined score catches both gradual and sudden regime changes.
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
        """Downsample the posterior matrix for efficient transfer to frontend."""
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
