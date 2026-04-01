const API_BASE = 'http://localhost:5000/api';

const ATTACK_COLORS = {
    'Benign': '#4CAF50', 'DoS Hulk': '#F44336', 'DoS GoldenEye': '#E91E63',
    'DoS slowloris': '#FF5722', 'DoS Slowhttptest': '#FF9800', 'DDoS': '#9C27B0',
    'PortScan': '#2196F3', 'FTP-Patator': '#00BCD4', 'SSH-Patator': '#009688',
    'Bot': '#795548', 'Web Attack - Brute Force': '#FFEB3B',
    'Web Attack - XSS': '#FFC107', 'Web Attack - Sql Injection': '#FF9800',
    'Infiltration': '#607D8B', 'Heartbleed': '#D50000',
};

function getAttackColor(label) { return ATTACK_COLORS[label] || '#888888'; }

function formatTimestamp(date) {
    if (typeof date === 'string') date = new Date(date);
    return d3.timeFormat('%H:%M:%S')(date);
}

function formatNumber(n) {
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return n.toFixed(1);
}

function debounce(fn, ms) {
    let timer;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), ms);
    };
}

async function apiGet(endpoint, params = {}) {
    const url = new URL(`${API_BASE}${endpoint}`);
    Object.entries(params).forEach(([k, v]) => {
        if (v !== null && v !== undefined) url.searchParams.set(k, v);
    });
    const resp = await fetch(url);
    if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: resp.statusText }));
        throw new Error(err.error || resp.statusText);
    }
    return resp.json();
}

async function apiPost(endpoint, body = {}) {
    const resp = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: resp.statusText }));
        throw new Error(err.error || resp.statusText);
    }
    return resp.json();
}

function showLoading() { document.getElementById('loading-overlay').classList.remove('hidden'); }
function hideLoading() { document.getElementById('loading-overlay').classList.add('hidden'); }

function updateStatus(key, value) {
    const el = document.getElementById(`status-${key}`);
    if (el) {
        const labels = { dataset: 'Dataset', points: 'Points', time: 'Computation' };
        el.textContent = `${labels[key] || key}: ${value}`;
    }
}

function groupAttackSegments(timestamps, labels) {
    const segments = [];
    let current = null;
    for (let i = 0; i < timestamps.length; i++) {
        const label = labels[i];
        if (label === 'Benign') {
            if (current) { current.end = timestamps[i]; segments.push(current); current = null; }
            continue;
        }
        if (!current || current.label !== label) {
            if (current) { current.end = timestamps[i]; segments.push(current); }
            current = { label, start: timestamps[i], end: timestamps[i] };
        } else {
            current.end = timestamps[i];
        }
    }
    if (current) { current.end = timestamps[timestamps.length - 1]; segments.push(current); }
    return segments;
}

const TimeSeriesChart = (() => {
    const margin = { top: 20, right: 30, bottom: 40, left: 70 };
    let svg, xScale, yScale, line;
    let width, height;
    let currentData = null;

    function init(container) {
        const el = document.querySelector(container);
        const rect = el.getBoundingClientRect();
        width = Math.max(rect.width, 600) - margin.left - margin.right;
        height = 250 - margin.top - margin.bottom;

        svg = d3.select(container).append('svg')
            .attr('width', width + margin.left + margin.right)
            .attr('height', height + margin.top + margin.bottom)
            .append('g').attr('transform', `translate(${margin.left},${margin.top})`);

        svg.append('defs').append('clipPath').attr('id', 'clip')
            .append('rect').attr('width', width).attr('height', height);

        svg.append('g').attr('class', 'line-group').attr('clip-path', 'url(#clip)');
        svg.append('g').attr('class', 'changepoint-group').attr('clip-path', 'url(#clip)');
        svg.append('g').attr('class', 'x-axis axis').attr('transform', `translate(0,${height})`);
        svg.append('g').attr('class', 'y-axis axis');

        xScale = d3.scaleTime().range([0, width]);
        yScale = d3.scaleLinear().range([height, 0]);

        line = d3.line().x(d => xScale(d.timestamp)).y(d => yScale(d.value))
            .curve(d3.curveMonotoneX).defined(d => d.value != null && !isNaN(d.value));

        if (!document.getElementById('ts-tooltip'))
            d3.select('body').append('div').attr('class', 'tooltip').attr('id', 'ts-tooltip').style('opacity', 0);

        svg.append('rect').attr('class', 'hover-overlay').attr('width', width).attr('height', height)
            .attr('fill', 'none').attr('pointer-events', 'all')
            .on('mousemove', onMouseMove)
            .on('mouseout', () => d3.select('#ts-tooltip').style('opacity', 0));
    }

    function update(data) {
        if (!data || data.length === 0) return;
        currentData = data.map(d => ({
            ...d, timestamp: new Date(d.timestamp),
            value: d.value != null ? d.value : 0,
        }));
        const timeExtent = d3.extent(currentData, d => d.timestamp);
        const values = currentData.map(d => d.value).filter(v => !isNaN(v));
        const valueExtent = d3.extent(values);
        const padding = (valueExtent[1] - valueExtent[0]) * 0.1 || 1;
        xScale.domain(timeExtent);
        yScale.domain([Math.max(0, valueExtent[0] - padding), valueExtent[1] + padding]);
        svg.select('.x-axis').transition().duration(300)
            .call(d3.axisBottom(xScale).ticks(8).tickFormat(d3.timeFormat('%H:%M')));
        svg.select('.y-axis').transition().duration(300)
            .call(d3.axisLeft(yScale).ticks(6).tickFormat(formatNumber));
        const lineGroup = svg.select('.line-group');
        const linePath = lineGroup.selectAll('.ts-line').data([currentData]);
        linePath.enter().append('path').attr('class', 'ts-line')
            .attr('fill', 'none').attr('stroke', '#00b4d8').attr('stroke-width', 1.5)
            .merge(linePath).transition().duration(300).attr('d', line);
    }

    function updateChangepoints(probs, timestamps, threshold) {
        if (!currentData) return;
        const cpData = [];
        if (probs && timestamps) {
            for (let i = 0; i < probs.length; i++) {
                if (probs[i] > threshold) cpData.push(new Date(timestamps[i]));
            }
        }
        const cpGroup = svg.select('.changepoint-group');
        const lines = cpGroup.selectAll('.changepoint-line').data(cpData);
        lines.exit().transition().duration(200).attr('opacity', 0).remove();
        lines.enter().append('line').attr('class', 'changepoint-line').merge(lines)
            .transition().duration(300)
            .attr('x1', d => xScale(d)).attr('x2', d => xScale(d))
            .attr('y1', 0).attr('y2', height).attr('opacity', 1);
    }

    function onMouseMove(event) {
        if (!currentData || currentData.length === 0) return;
        const [mx] = d3.pointer(event);
        const x0 = xScale.invert(mx);
        const i = Math.min(d3.bisector(d => d.timestamp).left(currentData, x0), currentData.length - 1);
        const d = currentData[i];
        if (!d) return;
        d3.select('#ts-tooltip').style('opacity', 1)
            .style('left', (event.pageX + 15) + 'px').style('top', (event.pageY - 30) + 'px')
            .html(`<div class="label">${formatTimestamp(d.timestamp)}</div>
                <div class="value">Value: ${formatNumber(d.value)}</div>
                <div class="value">Label: <span style="color:${getAttackColor(d.label)}">${d.label}</span></div>
                <div class="value">Attack: ${(d.attackFraction * 100).toFixed(0)}%</div>`);
    }

    return { init, update, updateChangepoints };
})();

const HeatmapChart = (() => {
    const margin = { top: 40, right: 80, bottom: 40, left: 60 };
    let svg, canvas, ctx, xScale, yScale, width, height;
    let currentMatrix = null, currentTimestamps = null;

    function init(container) {
        const el = document.querySelector(container);
        const rect = el.getBoundingClientRect();
        width = Math.max(rect.width, 350) - margin.left - margin.right;
        height = 280;
        el.style.position = 'relative';
        const wrapper = d3.select(container);
        const canvasEl = wrapper.append('canvas').attr('width', width).attr('height', height)
            .style('margin-left', margin.left + 'px').style('margin-top', margin.top + 'px').style('display', 'block');
        canvas = canvasEl.node();
        ctx = canvas.getContext('2d');
        svg = wrapper.append('svg')
            .attr('width', width + margin.left + margin.right).attr('height', height + margin.top + margin.bottom)
            .style('position', 'absolute').style('top', '30px').style('left', '0').style('pointer-events', 'none')
            .append('g').attr('transform', `translate(${margin.left},${margin.top})`);
        svg.append('g').attr('class', 'cp-bar').attr('transform', 'translate(0,-20)');
        svg.append('g').attr('class', 'x-axis axis').attr('transform', `translate(0,${height})`);
        svg.append('g').attr('class', 'y-axis axis');
        svg.append('g').attr('class', 'map-trace');
        svg.append('text').attr('class', 'y-label').attr('transform', 'rotate(-90)')
            .attr('y', -45).attr('x', -height / 2).attr('text-anchor', 'middle')
            .attr('fill', '#8899aa').attr('font-size', '11px').text('Run Length');
        const legendWidth = 15;
        const legendGroup = svg.append('g').attr('transform', `translate(${width + 10}, 0)`);
        const defs = svg.append('defs');
        const gradient = defs.append('linearGradient').attr('id', 'heatmap-gradient')
            .attr('x1', '0%').attr('y1', '100%').attr('x2', '0%').attr('y2', '0%');
        for (let i = 0; i <= 10; i++)
            gradient.append('stop').attr('offset', `${i * 10}%`).attr('stop-color', d3.interpolateInferno(i / 10));
        legendGroup.append('rect').attr('width', legendWidth).attr('height', height).style('fill', 'url(#heatmap-gradient)');
        legendGroup.append('g').attr('class', 'legend-axis').attr('transform', `translate(${legendWidth}, 0)`);
        xScale = d3.scaleTime().range([0, width]);
        yScale = d3.scaleLinear().range([0, height]);
        if (!document.getElementById('hm-tooltip'))
            d3.select('body').append('div').attr('class', 'tooltip').attr('id', 'hm-tooltip').style('opacity', 0);
        canvasEl.on('mousemove', onMouseMove)
            .on('mouseout', () => d3.select('#hm-tooltip').style('opacity', 0));
    }

    function update(posteriorMatrix, timestamps, mapRunLengths, changepointProbs) {
        if (!posteriorMatrix || posteriorMatrix.length === 0 || !canvas || !ctx) return;
        width = canvas.width;
        height = canvas.height;
        if (width <= 0 || height <= 0) return;
        currentMatrix = posteriorMatrix;
        currentTimestamps = timestamps.map(t => new Date(t));
        const T = posteriorMatrix.length, R = posteriorMatrix[0].length;
        let maxUsedR = 0;
        for (let t = 0; t < T; t++)
            for (let r = R - 1; r > 0; r--)
                if (posteriorMatrix[t][r] > 1e-6) { if (r > maxUsedR) maxUsedR = r; break; }
        const effectiveR = Math.min(Math.max(maxUsedR + 10, 20), R);
        const colMax = new Float64Array(T);
        for (let t = 0; t < T; t++) {
            let mx = 0;
            for (let r = 0; r < effectiveR; r++) if (posteriorMatrix[t][r] > mx) mx = posteriorMatrix[t][r];
            colMax[t] = mx;
        }
        const imageData = ctx.createImageData(width, height);
        for (let px = 0; px < width; px++) {
            const ti = Math.min(Math.floor((px / width) * T), T - 1);
            const cm = colMax[ti];
            for (let py = 0; py < height; py++) {
                const ri = Math.min(Math.floor((py / height) * effectiveR), effectiveR - 1);
                const val = posteriorMatrix[ti][ri];
                let normalized = 0;
                if (cm > 0 && val > 0) normalized = Math.max(0, (Math.log10(val / cm) + 4) / 4);
                const color = d3.color(d3.interpolateInferno(normalized));
                const idx = (py * width + px) * 4;
                if (color) { imageData.data[idx] = color.r; imageData.data[idx+1] = color.g; imageData.data[idx+2] = color.b; }
                else { imageData.data[idx] = 0; imageData.data[idx+1] = 0; imageData.data[idx+2] = 4; }
                imageData.data[idx+3] = 255;
            }
        }
        xScale.domain(d3.extent(currentTimestamps));
        yScale.domain([0, effectiveR]);
        svg.select('.x-axis').transition().duration(300)
            .call(d3.axisBottom(xScale).ticks(6).tickFormat(d3.timeFormat('%H:%M')));
        svg.select('.y-axis').transition().duration(300).call(d3.axisLeft(yScale).ticks(6));
        if (mapRunLengths && mapRunLengths.length === T) {
            const traceData = currentTimestamps.map((t, i) => ({ x: t, y: mapRunLengths[i] }));
            const traceLine = d3.line().x(d => xScale(d.x)).y(d => yScale(d.y)).curve(d3.curveStepAfter);
            const traceGroup = svg.select('.map-trace');
            traceGroup.selectAll('*').remove();
            traceGroup.append('path').datum(traceData).attr('fill', 'none')
                .attr('stroke', '#00b4d8').attr('stroke-width', 1.5).attr('stroke-opacity', 0.8).attr('d', traceLine);
        }
        if (changepointProbs && changepointProbs.length > 0) {
            const barHeight = 12;
            const cpBar = svg.select('.cp-bar');
            cpBar.selectAll('*').remove();
            cpBar.append('rect').attr('width', width).attr('height', barHeight).attr('fill', '#0f1923');
            const barWidth = Math.max(1, width / changepointProbs.length);
            changepointProbs.forEach((p, i) => {
                if (p > 0.01) cpBar.append('rect')
                    .attr('x', (i / changepointProbs.length) * width).attr('width', barWidth)
                    .attr('height', barHeight).attr('fill', '#ef476f').attr('opacity', Math.min(1, p));
            });
            cpBar.append('text').attr('x', -4).attr('y', barHeight - 2).attr('text-anchor', 'end')
                .attr('font-size', '8px').attr('fill', '#ef476f').text('CP');
        }
        const legendScale = d3.scaleLinear().domain([1, 1e-4]).range([0, height]);
        svg.select('.legend-axis').transition().duration(300)
            .call(d3.axisRight(legendScale).ticks(5).tickFormat(d => d >= 0.01 ? d.toFixed(2) : d.toExponential(0)));
        requestAnimationFrame(() => { ctx.putImageData(imageData, 0, 0); });
    }

    function onMouseMove(event) {
        if (!currentMatrix || !currentTimestamps) return;
        const [mx, my] = d3.pointer(event);
        const T = currentMatrix.length, R = currentMatrix[0].length;
        const ti = Math.min(Math.floor((mx / width) * T), T - 1);
        const ri = Math.min(Math.floor((my / height) * R), R - 1);
        if (ti < 0 || ti >= T || ri < 0 || ri >= R) return;
        const prob = currentMatrix[ti][ri];
        const time = currentTimestamps[Math.min(ti, currentTimestamps.length - 1)];
        d3.select('#hm-tooltip').style('opacity', 1)
            .style('left', (event.pageX + 15) + 'px').style('top', (event.pageY - 30) + 'px')
            .html(`<div class="label">${formatTimestamp(time)}</div>
                <div class="value">Run Length: ${ri}</div>
                <div class="value">P(r_t=${ri}): ${prob > 0.001 ? prob.toFixed(4) : prob.toExponential(2)}</div>`);
    }

    return { init, update };
})();

const NetworkChart = (() => {
    let svg, simulation, width, height, nodeGroup, linkGroup, labelGroup;
    let selectedNode = null, onNodeSelectCallback = null;

    function init(container, onNodeSelect) {
        onNodeSelectCallback = onNodeSelect;
        const el = document.querySelector(container);
        const rect = el.getBoundingClientRect();
        width = Math.max(rect.width, 300) - 20;
        height = 250;
        svg = d3.select(container).append('svg').attr('width', width).attr('height', height);
        svg.append('defs').append('marker').attr('id', 'arrowhead')
            .attr('viewBox', '0 -5 10 10').attr('refX', 20).attr('refY', 0)
            .attr('markerWidth', 6).attr('markerHeight', 6).attr('orient', 'auto')
            .append('path').attr('d', 'M0,-5L10,0L0,5').attr('fill', '#666');
        linkGroup = svg.append('g').attr('class', 'links');
        nodeGroup = svg.append('g').attr('class', 'nodes');
        labelGroup = svg.append('g').attr('class', 'labels');
        if (!document.getElementById('net-tooltip'))
            d3.select('body').append('div').attr('class', 'tooltip').attr('id', 'net-tooltip').style('opacity', 0);
        svg.on('click', (event) => { if (event.target === svg.node()) deselectAll(); });
        simulation = d3.forceSimulation()
            .force('link', d3.forceLink().id(d => d.id).distance(80))
            .force('charge', d3.forceManyBody().strength(-200))
            .force('center', d3.forceCenter(width / 2, height / 2))
            .force('collide', d3.forceCollide().radius(30));
    }

    function update(data) {
        if (!data || !data.nodes || data.nodes.length === 0) {
            linkGroup.selectAll('*').remove(); nodeGroup.selectAll('*').remove(); labelGroup.selectAll('*').remove();
            return;
        }
        const nodes = data.nodes.map(d => ({ ...d }));
        const links = data.links.map(d => ({ ...d }));
        const maxFlows = d3.max(links, d => d.flowCount) || 1;
        const radiusScale = d3.scaleSqrt().domain([0, maxFlows]).range([8, 28]);
        const linkWidthScale = d3.scaleLinear().domain([0, maxFlows]).range([1, 8]);
        linkGroup.selectAll('*').remove();
        const linkEnter = linkGroup.selectAll('.link').data(links).enter().append('line')
            .attr('class', 'link').attr('stroke-opacity', 0.6)
            .attr('stroke', d => d.attackFraction > 0.3 ? '#ef476f' : '#06d6a0')
            .attr('stroke-width', d => linkWidthScale(d.flowCount)).attr('marker-end', 'url(#arrowhead)');
        nodeGroup.selectAll('*').remove();
        const nodeEnter = nodeGroup.selectAll('.node').data(nodes).enter().append('circle')
            .attr('class', 'node').attr('r', d => radiusScale(d.totalFlows || 1))
            .attr('fill', d => d.type === 'internal' ? '#2196F3' : '#ef476f')
            .attr('stroke', '#1a2332').attr('stroke-width', 2).style('cursor', 'pointer')
            .call(d3.drag().on('start', dragStart).on('drag', dragging).on('end', dragEnd))
            .on('mouseover', onNodeHover)
            .on('mouseout', () => d3.select('#net-tooltip').style('opacity', 0))
            .on('click', onNodeClick);
        labelGroup.selectAll('*').remove();
        const labelEnter = labelGroup.selectAll('.node-label').data(nodes).enter().append('text')
            .attr('class', 'node-label').attr('font-size', '10px').attr('fill', '#ccc')
            .attr('text-anchor', 'middle').attr('dy', d => radiusScale(d.totalFlows || 1) + 14)
            .style('pointer-events', 'none')
            .text(d => d.id.length > 18 ? d.id.substring(0, 18) + '...' : d.id);
        simulation.nodes(nodes).on('tick', () => {
            linkEnter.attr('x1', d => d.source.x).attr('y1', d => d.source.y)
                .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
            nodeEnter.attr('cx', d => d.x = Math.max(20, Math.min(width - 20, d.x)))
                .attr('cy', d => d.y = Math.max(20, Math.min(height - 20, d.y)));
            labelEnter.attr('x', d => d.x).attr('y', d => d.y);
        });
        simulation.force('link').links(links);
        simulation.alpha(0.8).restart();
    }

    function onNodeClick(event, d) {
        event.stopPropagation();
        selectedNode = d;
        nodeGroup.selectAll('.node')
            .attr('stroke', n => n.id === d.id ? '#ffd166' : '#1a2332')
            .attr('stroke-width', n => n.id === d.id ? 3 : 2);
        linkGroup.selectAll('.link').attr('stroke-opacity', l => {
            const src = typeof l.source === 'object' ? l.source.id : l.source;
            const tgt = typeof l.target === 'object' ? l.target.id : l.target;
            return (src === d.id || tgt === d.id) ? 0.9 : 0.15;
        });
        showNodeDetail(d);
    }

    function deselectAll() {
        selectedNode = null;
        nodeGroup.selectAll('.node').attr('stroke', '#1a2332').attr('stroke-width', 2);
        linkGroup.selectAll('.link').attr('stroke-opacity', 0.6);
        const container = document.getElementById('attack-summary');
        if (container) container.innerHTML = '';
    }

    function showNodeDetail(d) {
        const container = document.getElementById('attack-summary');
        if (!container) return;
        const isAttack = d.type === 'external';
        const pct = d.totalFlows ? ((d.totalFlows / getTotalFlows()) * 100).toFixed(1) : '?';
        container.innerHTML = `
            <div style="border: 1px solid ${isAttack ? '#ef476f' : '#2196F3'}; border-radius: 6px; padding: 8px; margin-top: 4px;">
                <div style="font-weight: 600; color: ${isAttack ? '#ef476f' : '#06d6a0'}; margin-bottom: 4px;">${d.id}</div>
                <div style="font-size: 11px; color: #8899aa; line-height: 1.6;">
                    Type: <span style="color: #e0e6ed">${d.type === 'internal' ? 'Benign Traffic' : 'Attack Traffic'}</span><br>
                    Total flows: <span style="color: #e0e6ed">${formatNumber(d.totalFlows || 0)}</span><br>
                    Share: <span style="color: #e0e6ed">${pct}%</span><br>
                    ${isAttack ? '<span style="color: #ef476f">&#9888; Anomalous activity detected</span>' : '<span style="color: #06d6a0">&#10003; Normal traffic pattern</span>'}
                </div>
            </div>`;
    }

    function getTotalFlows() {
        let total = 0;
        nodeGroup.selectAll('.node').each(d => { total += d.totalFlows || 0; });
        return total || 1;
    }

    function onNodeHover(event, d) {
        if (selectedNode) return;
        const isAttack = d.type === 'external';
        d3.select('#net-tooltip').style('opacity', 1)
            .style('left', (event.pageX + 15) + 'px').style('top', (event.pageY - 30) + 'px')
            .html(`<div class="label" style="color:${isAttack ? '#ef476f' : '#06d6a0'}">${d.id}</div>
                <div class="value">Type: ${d.type}</div>
                <div class="value">Flows: ${formatNumber(d.totalFlows || 0)}</div>
                <div class="value" style="font-size:10px;color:#666">Click for details</div>`);
    }

    function dragStart(event, d) { if (!event.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; }
    function dragging(event, d) { d.fx = event.x; d.fy = event.y; }
    function dragEnd(event, d) { if (!event.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; }

    return { init, update };
})();

const Controls = (() => {
    let onChangeCallback = null;

    function init(onStateChange) {
        onChangeCallback = onStateChange;
        document.getElementById('hazard-slider').addEventListener('input', function() {
            document.getElementById('hazard-display').textContent = `1/${Math.round(1 / mapHazardRate(parseInt(this.value)))}`;
            debouncedChange();
        });
        document.getElementById('threshold-slider').addEventListener('input', function() {
            document.getElementById('threshold-display').textContent = (parseInt(this.value) / 100).toFixed(2);
            debouncedChange();
        });
        document.getElementById('bin-size-selector').addEventListener('change', () => { if (onChangeCallback) onChangeCallback('bin_size'); });
        document.getElementById('feature-selector').addEventListener('change', () => { if (onChangeCallback) onChangeCallback('feature'); });
    }

    const debouncedChange = debounce(() => { if (onChangeCallback) onChangeCallback('bocd_params'); }, 500);

    function mapHazardRate(val) {
        const logMin = Math.log(1 / 500), logMax = Math.log(1 / 10);
        return Math.exp(logMin + (val / 100) * (logMax - logMin));
    }

    function populateDays(days, activeDay) {
        const container = document.getElementById('day-selector');
        container.innerHTML = '';
        days.forEach(day => {
            const btn = document.createElement('button');
            btn.textContent = day; btn.dataset.day = day;
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
            opt.value = feat; opt.textContent = feat;
            if (defaultFeatures.includes(feat)) opt.style.fontWeight = 'bold';
            selector.appendChild(opt);
        });
        if (defaultFeatures.length > 0 && features.includes(defaultFeatures[0])) selector.value = defaultFeatures[0];
    }

    function populateFeatureRanking(rankings) {
        const container = document.getElementById('feature-ranking');
        container.innerHTML = '';
        if (!rankings || rankings.length === 0) return;
        const maxCorr = rankings[0].correlation;
        rankings.forEach(({ feature, correlation }) => {
            const bar = document.createElement('div');
            bar.className = 'ranking-bar';
            bar.innerHTML = `<span class="name" title="${feature}">${feature}</span>
                <span class="bar" style="width: ${(correlation / maxCorr) * 60}px"></span>
                <span class="score">${correlation.toFixed(3)}</span>`;
            bar.addEventListener('click', () => {
                document.getElementById('feature-selector').value = feature;
                if (onChangeCallback) onChangeCallback('feature');
            });
            container.appendChild(bar);
        });
    }

    function populateAttackSummary(summary) {
        const container = document.getElementById('attack-summary');
        if (!summary || !summary.labels) { container.innerHTML = ''; return; }
        const entries = Object.entries(summary.labels).filter(([label]) => label !== 'BENIGN').sort((a, b) => b[1] - a[1]);
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

    return {
        init, populateDays, populateFeatures, populateFeatureRanking, populateAttackSummary,
        getSelectedDay,
        getSelectedFeature: () => document.getElementById('feature-selector').value,
        getBinSize: () => document.getElementById('bin-size-selector').value,
        getHazardRate: () => mapHazardRate(parseInt(document.getElementById('hazard-slider').value)),
        getThreshold: () => parseInt(document.getElementById('threshold-slider').value) / 100,
    };
})();

const App = (() => {
    let bocdResults = null;

    async function init() {
        try {
            showLoading();
            Controls.init(onControlChange);
            TimeSeriesChart.init('#timeseries-chart');
            HeatmapChart.init('#heatmap-chart');
            NetworkChart.init('#network-chart', null);
            const day = 'Wednesday';
            const [featuresResp, timeRangeResp] = await Promise.all([
                apiGet('/features', { day }), apiGet('/time-range', { day }),
            ]);
            Controls.populateDays(timeRangeResp.days, day);
            Controls.populateFeatures(featuresResp.features, featuresResp.default_features);
            updateStatus('dataset', `CIC-IDS2017 - ${day}`);
            loadFeatureRanking(day);
            await loadAllData();
            hideLoading();
        } catch (err) {
            hideLoading();
            console.error('Initialization error:', err);
            alert('Error loading data. Make sure the Flask server is running on port 5000.\n\n' + err.message);
        }
    }

    async function loadAllData() {
        const day = Controls.getSelectedDay(), feature = Controls.getSelectedFeature();
        const binSize = Controls.getBinSize(), hazardRate = Controls.getHazardRate();
        showLoading();
        try {
            const tsData = await apiGet('/timeseries', { day, feature, bin_size: binSize });
            const chartData = tsData.timestamps.map((t, i) => ({
                timestamp: t, value: tsData.values[i], std: tsData.stds[i],
                label: tsData.dominant_labels[i], attackFraction: tsData.attack_fractions[i],
            }));
            TimeSeriesChart.update(chartData);
            const bocdResp = await apiPost('/bocd', { day, feature, bin_size: binSize, hazard_rate: hazardRate });
            bocdResults = bocdResp;
            HeatmapChart.update(bocdResp.posterior_matrix, bocdResp.timestamps, bocdResp.map_run_lengths, bocdResp.changepoint_probs);
            TimeSeriesChart.updateChangepoints(bocdResp.changepoint_probs, bocdResp.timestamps, Controls.getThreshold());
            const [networkData, attackSummary] = await Promise.all([
                apiGet('/network-flows', { day, top_n: 50 }), apiGet('/attack-summary', { day }),
            ]);
            NetworkChart.update(networkData);
            Controls.populateAttackSummary(attackSummary);
        } catch (err) { console.error('Data load error:', err); }
        finally { hideLoading(); }
    }

    async function loadFeatureRanking(day) {
        try {
            const resp = await apiGet('/feature-ranking', { day, top_n: 12 });
            Controls.populateFeatureRanking(resp.rankings);
        } catch (err) { console.error('Feature ranking error:', err); }
    }

    async function onControlChange(changeType) {
        if (changeType === 'day') {
            const day = Controls.getSelectedDay();
            updateStatus('dataset', `CIC-IDS2017 - ${day}`);
            try {
                const featResp = await apiGet('/features', { day });
                Controls.populateFeatures(featResp.features, featResp.default_features);
                loadFeatureRanking(day);
            } catch (err) { console.error('Feature reload error:', err); }
            await loadAllData();
        } else if (changeType === 'feature' || changeType === 'bin_size') {
            await loadAllData();
        } else if (changeType === 'bocd_params') {
            await rerunBOCD();
        }
    }

    async function rerunBOCD() {
        showLoading();
        try {
            const bocdResp = await apiPost('/bocd', {
                day: Controls.getSelectedDay(), feature: Controls.getSelectedFeature(),
                bin_size: Controls.getBinSize(), hazard_rate: Controls.getHazardRate(),
            });
            bocdResults = bocdResp;
            HeatmapChart.update(bocdResp.posterior_matrix, bocdResp.timestamps, bocdResp.map_run_lengths, bocdResp.changepoint_probs);
            TimeSeriesChart.updateChangepoints(bocdResp.changepoint_probs, bocdResp.timestamps, Controls.getThreshold());
        } catch (err) { console.error('BOCD rerun error:', err); }
        finally { hideLoading(); }
    }

    return { init };
})();

document.addEventListener('DOMContentLoaded', App.init);
