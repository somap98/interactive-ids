/**
 * Sidebar controls: day selector, feature picker, BOCD parameters, toggles.
 */

const Controls = (() => {
    let onChangeCallback = null;

    function init(onStateChange) {
        onChangeCallback = onStateChange;

        // Hazard rate slider (maps 1-100 to 1/500 - 1/10 on log scale)
        const hazardSlider = document.getElementById('hazard-slider');
        const hazardDisplay = document.getElementById('hazard-display');
        hazardSlider.addEventListener('input', () => {
            const val = parseInt(hazardSlider.value);
            const rate = mapHazardRate(val);
            hazardDisplay.textContent = `1/${Math.round(1 / rate)}`;
            debouncedChange();
        });

        // Threshold slider
        const thresholdSlider = document.getElementById('threshold-slider');
        const thresholdDisplay = document.getElementById('threshold-display');
        thresholdSlider.addEventListener('input', () => {
            const val = parseInt(thresholdSlider.value) / 100;
            thresholdDisplay.textContent = val.toFixed(2);
            debouncedChange();
        });

        // Bin size selector
        document.getElementById('bin-size-selector').addEventListener('change', () => {
            if (onChangeCallback) onChangeCallback('bin_size');
        });

        // Feature selector
        document.getElementById('feature-selector').addEventListener('change', () => {
            if (onChangeCallback) onChangeCallback('feature');
        });

        // Display toggles
        document.getElementById('toggle-attacks').addEventListener('change', () => {
            TimeSeriesChart.updateAttackRegions();
        });
        document.getElementById('toggle-bands').addEventListener('change', () => {
            TimeSeriesChart.updateConfidenceBand();
        });
        document.getElementById('toggle-changepoints').addEventListener('change', () => {
            if (onChangeCallback) onChangeCallback('display');
        });
    }

    const debouncedChange = debounce(() => {
        if (onChangeCallback) onChangeCallback('bocd_params');
    }, 500);

    function mapHazardRate(sliderVal) {
        // Map 1-100 to 1/500 - 1/10 on log scale
        const logMin = Math.log(1 / 500);
        const logMax = Math.log(1 / 10);
        return Math.exp(logMin + (sliderVal / 100) * (logMax - logMin));
    }

    function populateDays(days, activeDay) {
        const container = document.getElementById('day-selector');
        container.innerHTML = '';
        days.forEach(day => {
            const btn = document.createElement('button');
            btn.textContent = day;
            btn.dataset.day = day;
            if (day === activeDay) btn.classList.add('active');
            btn.addEventListener('click', () => {
                container.querySelectorAll('button').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                if (onChangeCallback) onChangeCallback('day');
            });
            container.appendChild(btn);
        });
    }

    function populateFeatures(features, defaultFeatures) {
        const selector = document.getElementById('feature-selector');
        selector.innerHTML = '';
        features.forEach(feat => {
            const opt = document.createElement('option');
            opt.value = feat;
            opt.textContent = feat;
            if (defaultFeatures.includes(feat)) opt.style.fontWeight = 'bold';
            selector.appendChild(opt);
        });
        // Select first default feature
        if (defaultFeatures.length > 0 && features.includes(defaultFeatures[0])) {
            selector.value = defaultFeatures[0];
        }
    }

    function populateFeatureRanking(rankings) {
        const container = document.getElementById('feature-ranking');
        container.innerHTML = '';

        if (!rankings || rankings.length === 0) return;

        const maxCorr = rankings[0].correlation;
        rankings.forEach(({ feature, correlation }) => {
            const bar = document.createElement('div');
            bar.className = 'ranking-bar';
            bar.innerHTML = `
                <span class="name" title="${feature}">${feature}</span>
                <span class="bar" style="width: ${(correlation / maxCorr) * 60}px"></span>
                <span class="score">${correlation.toFixed(3)}</span>
            `;
            bar.addEventListener('click', () => {
                document.getElementById('feature-selector').value = feature;
                if (onChangeCallback) onChangeCallback('feature');
            });
            container.appendChild(bar);
        });
    }

    function populateAttackSummary(summary) {
        const container = document.getElementById('attack-summary');
        if (!summary || !summary.labels) {
            container.innerHTML = '';
            return;
        }

        const entries = Object.entries(summary.labels)
            .filter(([label]) => label !== 'BENIGN')
            .sort((a, b) => b[1] - a[1]);

        if (entries.length === 0) {
            container.innerHTML = '<span style="color:#8899aa;font-size:12px">No attacks in this range</span>';
            return;
        }

        container.innerHTML = entries.map(([label, count]) =>
            `<span class="attack-badge" style="background:${getAttackColor(label)}33;color:${getAttackColor(label)}">${label}: ${formatNumber(count)}</span>`
        ).join('');
    }

    function getSelectedDay() {
        const active = document.querySelector('#day-selector button.active');
        return active ? active.dataset.day : 'Tuesday';
    }

    function getSelectedFeature() {
        return document.getElementById('feature-selector').value;
    }

    function getBinSize() {
        return document.getElementById('bin-size-selector').value;
    }

    function getHazardRate() {
        const val = parseInt(document.getElementById('hazard-slider').value);
        return mapHazardRate(val);
    }

    function getThreshold() {
        return parseInt(document.getElementById('threshold-slider').value) / 100;
    }

    return {
        init,
        populateDays,
        populateFeatures,
        populateFeatureRanking,
        populateAttackSummary,
        getSelectedDay,
        getSelectedFeature,
        getBinSize,
        getHazardRate,
        getThreshold,
    };
})();
