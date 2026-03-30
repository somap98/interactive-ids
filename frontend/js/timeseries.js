/**
 * D3.js Time-Series Line Chart with brush/zoom and attack overlays.
 */

const TimeSeriesChart = (() => {
    const margin = { top: 20, right: 30, bottom: 40, left: 70 };
    let svg, focusSvg, xScale, yScale, line, area;
    let brush, contextXScale, contextYScale, contextLine;
    let width, height, contextHeight;
    let currentData = null;
    let changepointData = null;
    let onBrushCallback = null;

    function init(container, contextContainer, onBrush) {
        onBrushCallback = onBrush;

        // Use fixed width based on available space, with fallback
        const el = document.querySelector(container);
        const rect = el.getBoundingClientRect();
        width = Math.max(rect.width, 600) - margin.left - margin.right;
        height = 250 - margin.top - margin.bottom;
        contextHeight = 50;

        // Main chart
        svg = d3.select(container)
            .append('svg')
            .attr('width', width + margin.left + margin.right)
            .attr('height', height + margin.top + margin.bottom)
            .append('g')
            .attr('transform', `translate(${margin.left},${margin.top})`);

        // Clip path
        svg.append('defs')
            .append('clipPath')
            .attr('id', 'clip')
            .append('rect')
            .attr('width', width)
            .attr('height', height);

        // Groups for layering
        svg.append('g').attr('class', 'attack-regions').attr('clip-path', 'url(#clip)');
        svg.append('g').attr('class', 'confidence-band').attr('clip-path', 'url(#clip)');
        svg.append('g').attr('class', 'line-group').attr('clip-path', 'url(#clip)');
        svg.append('g').attr('class', 'changepoint-group').attr('clip-path', 'url(#clip)');
        svg.append('g').attr('class', 'x-axis axis').attr('transform', `translate(0,${height})`);
        svg.append('g').attr('class', 'y-axis axis');

        // Scales
        xScale = d3.scaleTime().range([0, width]);
        yScale = d3.scaleLinear().range([height, 0]);

        // Line generator
        line = d3.line()
            .x(d => xScale(d.timestamp))
            .y(d => yScale(d.value))
            .curve(d3.curveMonotoneX)
            .defined(d => d.value != null && !isNaN(d.value));

        // Area generator for confidence bands
        area = d3.area()
            .x(d => xScale(d.timestamp))
            .y0(d => yScale(Math.max(0, d.value - d.std)))
            .y1(d => yScale(d.value + d.std))
            .curve(d3.curveMonotoneX)
            .defined(d => d.value != null && !isNaN(d.value));

        // Tooltip
        if (!document.getElementById('ts-tooltip')) {
            d3.select('body').append('div').attr('class', 'tooltip').attr('id', 'ts-tooltip').style('opacity', 0);
        }

        // Hover overlay
        svg.append('rect')
            .attr('class', 'hover-overlay')
            .attr('width', width)
            .attr('height', height)
            .attr('fill', 'none')
            .attr('pointer-events', 'all')
            .on('mousemove', onMouseMove)
            .on('mouseout', () => d3.select('#ts-tooltip').style('opacity', 0));

        // Context chart (brush overview)
        focusSvg = d3.select(contextContainer)
            .append('svg')
            .attr('width', width + margin.left + margin.right)
            .attr('height', contextHeight + 20)
            .append('g')
            .attr('transform', `translate(${margin.left},10)`);

        contextXScale = d3.scaleTime().range([0, width]);
        contextYScale = d3.scaleLinear().range([contextHeight, 0]);

        contextLine = d3.line()
            .x(d => contextXScale(d.timestamp))
            .y(d => contextYScale(d.value))
            .curve(d3.curveMonotoneX)
            .defined(d => d.value != null && !isNaN(d.value));

        focusSvg.append('g').attr('class', 'context-line');
        focusSvg.append('g').attr('class', 'x-axis axis').attr('transform', `translate(0,${contextHeight})`);

        brush = d3.brushX()
            .extent([[0, 0], [width, contextHeight]])
            .on('end', onBrushEnd);

        focusSvg.append('g').attr('class', 'brush').call(brush);
    }

    function update(data) {
        if (!data || data.length === 0) return;

        currentData = data.map(d => ({
            ...d,
            timestamp: new Date(d.timestamp),
            value: d.value != null ? d.value : 0,
            std: d.std != null ? d.std : 0,
        }));

        const timeExtent = d3.extent(currentData, d => d.timestamp);
        const values = currentData.map(d => d.value).filter(v => !isNaN(v));
        const valueExtent = d3.extent(values);
        const padding = (valueExtent[1] - valueExtent[0]) * 0.1 || 1;

        xScale.domain(timeExtent);
        yScale.domain([Math.max(0, valueExtent[0] - padding), valueExtent[1] + padding]);
        contextXScale.domain(timeExtent);
        contextYScale.domain(yScale.domain());

        // Update axes
        svg.select('.x-axis')
            .transition().duration(300)
            .call(d3.axisBottom(xScale).ticks(8).tickFormat(d3.timeFormat('%H:%M')));

        svg.select('.y-axis')
            .transition().duration(300)
            .call(d3.axisLeft(yScale).ticks(6).tickFormat(formatNumber));

        // Update main line
        const lineGroup = svg.select('.line-group');
        const linePath = lineGroup.selectAll('.ts-line').data([currentData]);
        linePath.enter()
            .append('path')
            .attr('class', 'ts-line')
            .attr('fill', 'none')
            .attr('stroke', '#00b4d8')
            .attr('stroke-width', 1.5)
            .merge(linePath)
            .transition().duration(300)
            .attr('d', line);

        // Confidence band
        updateConfidenceBand();

        // Attack regions
        updateAttackRegions();

        // Context chart
        const ctxPath = focusSvg.select('.context-line').selectAll('.ctx-line').data([currentData]);
        ctxPath.enter()
            .append('path')
            .attr('class', 'ctx-line')
            .attr('fill', 'none')
            .attr('stroke', '#00b4d8')
            .attr('stroke-width', 1)
            .attr('opacity', 0.5)
            .merge(ctxPath)
            .attr('d', contextLine);

        focusSvg.select('.x-axis')
            .call(d3.axisBottom(contextXScale).ticks(6).tickFormat(d3.timeFormat('%H:%M')));
    }

    function updateConfidenceBand() {
        if (!currentData) return;
        const show = document.getElementById('toggle-bands')?.checked;
        const bandGroup = svg.select('.confidence-band');
        const band = bandGroup.selectAll('.band').data(show ? [currentData] : []);
        band.exit().remove();
        band.enter()
            .append('path')
            .attr('class', 'band')
            .attr('fill', '#00b4d8')
            .attr('opacity', 0.1)
            .merge(band)
            .transition().duration(300)
            .attr('d', area);
    }

    function updateAttackRegions() {
        if (!currentData) return;
        const show = document.getElementById('toggle-attacks')?.checked;
        const timestamps = currentData.map(d => d.timestamp);
        const labels = currentData.map(d => d.label);
        const segments = show ? groupAttackSegments(timestamps, labels) : [];

        const regionGroup = svg.select('.attack-regions');
        const rects = regionGroup.selectAll('.attack-region').data(segments, d => d.start + d.label);

        rects.exit().transition().duration(200).attr('opacity', 0).remove();

        rects.enter()
            .append('rect')
            .attr('class', 'attack-region')
            .merge(rects)
            .transition().duration(300)
            .attr('x', d => xScale(d.start))
            .attr('width', d => Math.max(1, xScale(d.end) - xScale(d.start)))
            .attr('y', 0)
            .attr('height', height)
            .attr('fill', d => getAttackColor(d.label))
            .attr('opacity', 0.15);

        // Attack labels
        const labelTexts = regionGroup.selectAll('.attack-text').data(segments, d => d.start + d.label);
        labelTexts.exit().remove();
        labelTexts.enter()
            .append('text')
            .attr('class', 'attack-text')
            .attr('font-size', '10px')
            .attr('fill', d => getAttackColor(d.label))
            .merge(labelTexts)
            .attr('x', d => xScale(d.start) + 4)
            .attr('y', 14)
            .text(d => d.label);
    }

    function updateChangepoints(probs, timestamps, threshold) {
        if (!currentData) return;
        const show = document.getElementById('toggle-changepoints')?.checked;

        const cpData = [];
        if (show && probs && timestamps) {
            for (let i = 0; i < probs.length; i++) {
                if (probs[i] > threshold) {
                    cpData.push(new Date(timestamps[i]));
                }
            }
        }

        changepointData = cpData;
        const cpGroup = svg.select('.changepoint-group');
        const lines = cpGroup.selectAll('.changepoint-line').data(cpData);

        lines.exit().transition().duration(200).attr('opacity', 0).remove();

        lines.enter()
            .append('line')
            .attr('class', 'changepoint-line')
            .merge(lines)
            .transition().duration(300)
            .attr('x1', d => xScale(d))
            .attr('x2', d => xScale(d))
            .attr('y1', 0)
            .attr('y2', height)
            .attr('opacity', 1);
    }

    function onMouseMove(event) {
        if (!currentData || currentData.length === 0) return;
        const [mx] = d3.pointer(event);
        const x0 = xScale.invert(mx);
        const bisect = d3.bisector(d => d.timestamp).left;
        const i = Math.min(bisect(currentData, x0), currentData.length - 1);
        const d = currentData[i];
        if (!d) return;

        const tooltip = d3.select('#ts-tooltip');
        tooltip
            .style('opacity', 1)
            .style('left', (event.pageX + 15) + 'px')
            .style('top', (event.pageY - 30) + 'px')
            .html(`
                <div class="label">${formatTimestamp(d.timestamp)}</div>
                <div class="value">Value: ${formatNumber(d.value)}</div>
                <div class="value">Label: <span style="color:${getAttackColor(d.label)}">${d.label}</span></div>
                <div class="value">Attack: ${(d.attackFraction * 100).toFixed(0)}%</div>
            `);
    }

    function onBrushEnd(event) {
        if (!event.selection) return;
        const [x0, x1] = event.selection.map(contextXScale.invert);
        xScale.domain([x0, x1]);

        svg.select('.x-axis').transition().duration(300)
            .call(d3.axisBottom(xScale).ticks(8).tickFormat(d3.timeFormat('%H:%M')));

        svg.select('.line-group').selectAll('.ts-line')
            .transition().duration(300).attr('d', line);

        updateConfidenceBand();
        updateAttackRegions();

        if (changepointData) {
            svg.select('.changepoint-group').selectAll('.changepoint-line')
                .transition().duration(300)
                .attr('x1', d => xScale(d))
                .attr('x2', d => xScale(d));
        }

        if (onBrushCallback) {
            onBrushCallback(x0.toISOString(), x1.toISOString());
        }
    }

    function resetBrush() {
        if (!currentData) return;
        focusSvg.select('.brush').call(brush.move, null);
        xScale.domain(d3.extent(currentData, d => d.timestamp));
        svg.select('.x-axis').transition().duration(300)
            .call(d3.axisBottom(xScale).ticks(8).tickFormat(d3.timeFormat('%H:%M')));
        svg.select('.line-group').selectAll('.ts-line')
            .transition().duration(300).attr('d', line);
        updateConfidenceBand();
        updateAttackRegions();
    }

    return { init, update, updateChangepoints, updateConfidenceBand, updateAttackRegions, resetBrush };
})();
