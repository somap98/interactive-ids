/**
 * Main application - state management and view coordination.
 */

const App = (() => {
    let bocdResults = null;

    async function init() {
        try {
            showLoading();

            // Initialize controls with change handler
            Controls.init(onControlChange);

            // Initialize charts
            TimeSeriesChart.init('#timeseries-chart', '#context-chart', onBrush);
            HeatmapChart.init('#heatmap-chart');
            NetworkChart.init('#network-chart', null);

            // Load initial data
            const day = 'Wednesday'; // Wednesday has DoS attacks - good for demo

            // Fetch features and time range in parallel
            const [featuresResp, timeRangeResp] = await Promise.all([
                apiGet('/features', { day }),
                apiGet('/time-range', { day }),
            ]);

            // Populate controls
            Controls.populateDays(timeRangeResp.days, day);
            Controls.populateFeatures(featuresResp.features, featuresResp.default_features);

            updateStatus('dataset', `CIC-IDS2017 - ${day}`);

            // Load feature ranking in background
            loadFeatureRanking(day);

            // Load initial visualization
            await loadAllData();

            hideLoading();
        } catch (err) {
            hideLoading();
            console.error('Initialization error:', err);
            alert('Error loading data. Make sure the Flask server is running on port 5000.\n\n' + err.message);
        }
    }

    async function loadAllData() {
        const day = Controls.getSelectedDay();
        const feature = Controls.getSelectedFeature();
        const binSize = Controls.getBinSize();
        const hazardRate = Controls.getHazardRate();

        showLoading();

        try {
            // Fetch timeseries data
            const tsData = await apiGet('/timeseries', { day, feature, bin_size: binSize });

            // Transform for chart
            const chartData = tsData.timestamps.map((t, i) => ({
                timestamp: t,
                value: tsData.values[i],
                std: tsData.stds[i],
                label: tsData.dominant_labels[i],
                attackFraction: tsData.attack_fractions[i],
            }));

            TimeSeriesChart.update(chartData);
            updateStatus('points', tsData.metadata.total_points);
            document.getElementById('ts-feature-label').textContent = `[${feature}]`;

            // Run BOCD
            const bocdResp = await apiPost('/bocd', {
                day, feature, bin_size: binSize, hazard_rate: hazardRate,
            });

            bocdResults = bocdResp;
            updateStatus('time', `${bocdResp.computation_time_ms.toFixed(0)}ms`);

            // Update heatmap with posterior matrix, MAP trace, and CP probs
            HeatmapChart.update(
                bocdResp.posterior_matrix,
                bocdResp.timestamps,
                bocdResp.map_run_lengths,
                bocdResp.changepoint_probs
            );

            // Update changepoints on timeseries
            const threshold = Controls.getThreshold();
            TimeSeriesChart.updateChangepoints(
                bocdResp.changepoint_probs,
                bocdResp.timestamps,
                threshold
            );

            // Load network flows and attack summary in parallel
            const [networkData, attackSummary] = await Promise.all([
                apiGet('/network-flows', { day, top_n: 50 }),
                apiGet('/attack-summary', { day }),
            ]);

            NetworkChart.update(networkData);
            Controls.populateAttackSummary(attackSummary);

        } catch (err) {
            console.error('Data load error:', err);
        } finally {
            hideLoading();
        }
    }

    async function loadFeatureRanking(day) {
        try {
            const resp = await apiGet('/feature-ranking', { day, top_n: 12 });
            Controls.populateFeatureRanking(resp.rankings);
        } catch (err) {
            console.error('Feature ranking error:', err);
        }
    }

    async function onControlChange(changeType) {
        if (changeType === 'day') {
            const day = Controls.getSelectedDay();
            updateStatus('dataset', `CIC-IDS2017 - ${day}`);

            // Reload features for new day
            try {
                const featResp = await apiGet('/features', { day });
                Controls.populateFeatures(featResp.features, featResp.default_features);
                loadFeatureRanking(day);
            } catch (err) {
                console.error('Feature reload error:', err);
            }

            await loadAllData();
        } else if (changeType === 'feature' || changeType === 'bin_size') {
            await loadAllData();
        } else if (changeType === 'bocd_params') {
            // Re-run BOCD with new parameters without refetching timeseries
            await rerunBOCD();
        } else if (changeType === 'display') {
            // Just update changepoint display with current results
            if (bocdResults) {
                TimeSeriesChart.updateChangepoints(
                    bocdResults.changepoint_probs,
                    bocdResults.timestamps,
                    Controls.getThreshold()
                );
            }
        }
    }

    async function rerunBOCD() {
        const day = Controls.getSelectedDay();
        const feature = Controls.getSelectedFeature();
        const binSize = Controls.getBinSize();
        const hazardRate = Controls.getHazardRate();

        showLoading();
        try {
            const bocdResp = await apiPost('/bocd', {
                day, feature, bin_size: binSize, hazard_rate: hazardRate,
            });

            bocdResults = bocdResp;
            updateStatus('time', `${bocdResp.computation_time_ms.toFixed(0)}ms`);

            HeatmapChart.update(bocdResp.posterior_matrix, bocdResp.timestamps, bocdResp.map_run_lengths, bocdResp.changepoint_probs);
            TimeSeriesChart.updateChangepoints(
                bocdResp.changepoint_probs,
                bocdResp.timestamps,
                Controls.getThreshold()
            );
        } catch (err) {
            console.error('BOCD rerun error:', err);
        } finally {
            hideLoading();
        }
    }

    const onBrush = debounce(async (startISO, endISO) => {
        // When user brushes a time range, reload data for that range
        const day = Controls.getSelectedDay();
        const feature = Controls.getSelectedFeature();
        const binSize = Controls.getBinSize();
        const hazardRate = Controls.getHazardRate();

        try {
            // Run BOCD for the brushed range
            const bocdResp = await apiPost('/bocd', {
                day, feature, bin_size: binSize, hazard_rate: hazardRate,
                start: startISO, end: endISO,
            });

            bocdResults = bocdResp;
            updateStatus('time', `${bocdResp.computation_time_ms.toFixed(0)}ms`);

            HeatmapChart.update(bocdResp.posterior_matrix, bocdResp.timestamps, bocdResp.map_run_lengths, bocdResp.changepoint_probs);
            TimeSeriesChart.updateChangepoints(
                bocdResp.changepoint_probs,
                bocdResp.timestamps,
                Controls.getThreshold()
            );

            // Update network for brushed range
            const networkData = await apiGet('/network-flows', {
                day, start: startISO, end: endISO, top_n: 50,
            });
            NetworkChart.update(networkData);

        } catch (err) {
            console.error('Brush update error:', err);
        }
    }, 300);

    return { init };
})();

// Start the application when DOM is ready
document.addEventListener('DOMContentLoaded', App.init);
