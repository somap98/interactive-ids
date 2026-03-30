/**
 * D3.js PPD Heatmap - Run-Length Posterior Distribution visualization.
 *
 * Shows the BOCD run-length posterior as a heatmap with:
 * - Log color scale to reveal sparse probability structure
 * - MAP run-length trace overlay (bright line showing most likely run-length)
 * - Changepoint probability bar at the top
 */

const HeatmapChart = (() => {
    const margin = { top: 40, right: 80, bottom: 40, left: 60 };
    let svg, canvas, ctx;
    let xScale, yScale;
    let width, height;
    let currentMatrix = null;
    let currentTimestamps = null;

    function init(container) {
        const el = document.querySelector(container);
        const rect = el.getBoundingClientRect();
        width = Math.max(rect.width, 350) - margin.left - margin.right;
        height = 280;

        el.style.position = 'relative';

        const wrapper = d3.select(container);

        // Canvas for pixel rendering
        const canvasEl = wrapper.append('canvas')
            .attr('width', width)
            .attr('height', height)
            .style('margin-left', margin.left + 'px')
            .style('margin-top', margin.top + 'px')
            .style('display', 'block');

        canvas = canvasEl.node();
        ctx = canvas.getContext('2d');

        // SVG overlay for axes, MAP trace, and CP bar
        svg = wrapper.append('svg')
            .attr('width', width + margin.left + margin.right)
            .attr('height', height + margin.top + margin.bottom)
            .style('position', 'absolute')
            .style('top', '30px')
            .style('left', '0')
            .style('pointer-events', 'none')
            .append('g')
            .attr('transform', `translate(${margin.left},${margin.top})`);

        // Changepoint probability bar (above heatmap)
        svg.append('g').attr('class', 'cp-bar').attr('transform', 'translate(0,-20)');

        svg.append('g').attr('class', 'x-axis axis').attr('transform', `translate(0,${height})`);
        svg.append('g').attr('class', 'y-axis axis');
        svg.append('g').attr('class', 'map-trace');

        // Y-axis label
        svg.append('text')
            .attr('class', 'y-label')
            .attr('transform', 'rotate(-90)')
            .attr('y', -45)
            .attr('x', -height / 2)
            .attr('text-anchor', 'middle')
            .attr('fill', '#8899aa')
            .attr('font-size', '11px')
            .text('Run Length');

        // Color legend
        const legendWidth = 15;
        const legendGroup = svg.append('g')
            .attr('transform', `translate(${width + 10}, 0)`);

        const defs = svg.append('defs');
        const gradient = defs.append('linearGradient')
            .attr('id', 'heatmap-gradient')
            .attr('x1', '0%').attr('y1', '100%')
            .attr('x2', '0%').attr('y2', '0%');

        for (let i = 0; i <= 10; i++) {
            gradient.append('stop')
                .attr('offset', `${i * 10}%`)
                .attr('stop-color', d3.interpolateInferno(i / 10));
        }

        legendGroup.append('rect')
            .attr('width', legendWidth)
            .attr('height', height)
            .style('fill', 'url(#heatmap-gradient)');

        legendGroup.append('g')
            .attr('class', 'legend-axis')
            .attr('transform', `translate(${legendWidth}, 0)`);

        xScale = d3.scaleTime().range([0, width]);
        yScale = d3.scaleLinear().range([0, height]);

        // Tooltip
        if (!document.getElementById('hm-tooltip')) {
            d3.select('body').append('div')
                .attr('class', 'tooltip')
                .attr('id', 'hm-tooltip')
                .style('opacity', 0);
        }

        canvasEl
            .on('mousemove', onMouseMove)
            .on('mouseout', () => d3.select('#hm-tooltip').style('opacity', 0));
    }

    function update(posteriorMatrix, timestamps, mapRunLengths, changepointProbs) {
        if (!posteriorMatrix || posteriorMatrix.length === 0) return;
        if (!canvas || !ctx) return;

        // Re-read actual canvas dimensions (init may have run before layout)
        width = canvas.width;
        height = canvas.height;
        if (width <= 0 || height <= 0) return;

        currentMatrix = posteriorMatrix;
        currentTimestamps = timestamps.map(t => new Date(t));

        const T = posteriorMatrix.length;
        const R = posteriorMatrix[0].length;

        // Find the highest run-length that has meaningful probability
        // This crops the y-axis tightly so no black space is wasted
        let maxUsedR = 0;
        for (let t = 0; t < T; t++) {
            for (let r = R - 1; r > 0; r--) {
                if (posteriorMatrix[t][r] > 1e-6) {
                    if (r > maxUsedR) maxUsedR = r;
                    break;
                }
            }
        }
        // Add a small padding above the highest signal
        const effectiveR = Math.min(Math.max(maxUsedR + 10, 20), R);

        // ---- Render heatmap to canvas ----
        // Use a "softened" log scale: blend the log-transformed matrix
        // with the MAP trace to make the structure clearly visible.

        // Step 1: Find per-column (per-timestep) max for relative scaling
        const colMax = new Float64Array(T);
        for (let t = 0; t < T; t++) {
            let mx = 0;
            for (let r = 0; r < effectiveR; r++) {
                if (posteriorMatrix[t][r] > mx) mx = posteriorMatrix[t][r];
            }
            colMax[t] = mx;
        }

        // Step 2: Render using per-column normalization
        // This makes each column's structure visible regardless of concentration
        const imageData = ctx.createImageData(width, height);

        for (let px = 0; px < width; px++) {
            const ti = Math.min(Math.floor((px / width) * T), T - 1);
            const cm = colMax[ti];

            for (let py = 0; py < height; py++) {
                const ri = Math.min(Math.floor((py / height) * effectiveR), effectiveR - 1);
                const val = posteriorMatrix[ti][ri];

                // Per-column log normalization
                let normalized = 0;
                if (cm > 0 && val > 0) {
                    // Log ratio: how far is this cell from the column max?
                    const logRatio = Math.log10(val / cm);
                    // Map range [-4, 0] to [0, 1] (show 4 orders of magnitude)
                    normalized = Math.max(0, (logRatio + 4) / 4);
                }

                const color = d3.color(d3.interpolateInferno(normalized));
                const idx = (py * width + px) * 4;
                if (color) {
                    imageData.data[idx] = color.r;
                    imageData.data[idx + 1] = color.g;
                    imageData.data[idx + 2] = color.b;
                } else {
                    // Fallback: very dark
                    imageData.data[idx] = 0;
                    imageData.data[idx + 1] = 0;
                    imageData.data[idx + 2] = 4;
                }
                imageData.data[idx + 3] = 255;
            }
        }
        // ---- SVG overlays (must be set up BEFORE canvas putImageData) ----
        xScale.domain(d3.extent(currentTimestamps));
        yScale.domain([0, effectiveR]);

        // Axes
        svg.select('.x-axis')
            .transition().duration(300)
            .call(d3.axisBottom(xScale).ticks(6).tickFormat(d3.timeFormat('%H:%M')));

        svg.select('.y-axis')
            .transition().duration(300)
            .call(d3.axisLeft(yScale).ticks(6));

        // MAP run-length trace (bright cyan line)
        if (mapRunLengths && mapRunLengths.length === T) {
            const traceData = currentTimestamps.map((t, i) => ({
                x: t,
                y: mapRunLengths[i],
            }));

            const traceLine = d3.line()
                .x(d => xScale(d.x))
                .y(d => yScale(d.y))
                .curve(d3.curveStepAfter);

            const traceGroup = svg.select('.map-trace');
            traceGroup.selectAll('*').remove();
            traceGroup.append('path')
                .datum(traceData)
                .attr('fill', 'none')
                .attr('stroke', '#00b4d8')
                .attr('stroke-width', 1.5)
                .attr('stroke-opacity', 0.8)
                .attr('d', traceLine);
        }

        // Changepoint probability bar (top of heatmap)
        if (changepointProbs && changepointProbs.length > 0) {
            const barHeight = 12;
            const cpBar = svg.select('.cp-bar');
            cpBar.selectAll('*').remove();

            // Background
            cpBar.append('rect')
                .attr('width', width)
                .attr('height', barHeight)
                .attr('fill', '#0f1923');

            // CP probability bars
            const barWidth = Math.max(1, width / changepointProbs.length);
            changepointProbs.forEach((p, i) => {
                if (p > 0.01) {
                    cpBar.append('rect')
                        .attr('x', (i / changepointProbs.length) * width)
                        .attr('width', barWidth)
                        .attr('height', barHeight)
                        .attr('fill', '#ef476f')
                        .attr('opacity', Math.min(1, p));
                }
            });

            // Label
            cpBar.append('text')
                .attr('x', -4)
                .attr('y', barHeight - 2)
                .attr('text-anchor', 'end')
                .attr('font-size', '8px')
                .attr('fill', '#ef476f')
                .text('CP');
        }

        // Legend - show relative scale
        const legendScale = d3.scaleLinear()
            .domain([1, 1e-4])
            .range([0, height]);

        svg.select('.legend-axis')
            .transition().duration(300)
            .call(d3.axisRight(legendScale).ticks(5).tickFormat(d => {
                if (d >= 0.01) return d.toFixed(2);
                return d.toExponential(0);
            }));

        // Paint canvas LAST, after all SVG updates, to prevent it being cleared
        // by DOM mutations. Use requestAnimationFrame for reliable timing.
        requestAnimationFrame(() => {
            ctx.putImageData(imageData, 0, 0);
        });
    }

    function onMouseMove(event) {
        if (!currentMatrix || !currentTimestamps) return;
        const [mx, my] = d3.pointer(event);

        const T = currentMatrix.length;
        const R = currentMatrix[0].length;
        const ti = Math.min(Math.floor((mx / width) * T), T - 1);
        const ri = Math.min(Math.floor((my / height) * R), R - 1);

        if (ti < 0 || ti >= T || ri < 0 || ri >= R) return;

        const prob = currentMatrix[ti][ri];
        const time = currentTimestamps[Math.min(ti, currentTimestamps.length - 1)];

        const tooltip = d3.select('#hm-tooltip');
        tooltip
            .style('opacity', 1)
            .style('left', (event.pageX + 15) + 'px')
            .style('top', (event.pageY - 30) + 'px')
            .html(`
                <div class="label">${formatTimestamp(time)}</div>
                <div class="value">Run Length: ${ri}</div>
                <div class="value">P(r_t=${ri}): ${prob > 0.001 ? prob.toFixed(4) : prob.toExponential(2)}</div>
            `);
    }

    return { init, update };
})();
