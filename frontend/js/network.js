/**
 * D3.js Force-Directed Network Topology Graph.
 *
 * Displays network flow topology with nodes (labels/IPs) and links (flows),
 * color-coded by attack/benign traffic. Nodes are clickable to show detail panels.
 */

const NetworkChart = (() => {
    let svg, simulation;
    let width, height;
    let nodeGroup, linkGroup, labelGroup;
    let selectedNode = null;
    let onNodeSelectCallback = null;

    function init(container, onNodeSelect) {
        onNodeSelectCallback = onNodeSelect;
        const el = document.querySelector(container);
        const rect = el.getBoundingClientRect();
        width = Math.max(rect.width, 300) - 20;
        height = 250;

        svg = d3.select(container)
            .append('svg')
            .attr('width', width)
            .attr('height', height);

        // Arrow marker for directed edges
        svg.append('defs').append('marker')
            .attr('id', 'arrowhead')
            .attr('viewBox', '0 -5 10 10')
            .attr('refX', 20)
            .attr('refY', 0)
            .attr('markerWidth', 6)
            .attr('markerHeight', 6)
            .attr('orient', 'auto')
            .append('path')
            .attr('d', 'M0,-5L10,0L0,5')
            .attr('fill', '#666');

        linkGroup = svg.append('g').attr('class', 'links');
        nodeGroup = svg.append('g').attr('class', 'nodes');
        labelGroup = svg.append('g').attr('class', 'labels');

        // Tooltip
        if (!document.getElementById('net-tooltip')) {
            d3.select('body').append('div')
                .attr('class', 'tooltip')
                .attr('id', 'net-tooltip')
                .style('opacity', 0);
        }

        // Click on background to deselect
        svg.on('click', (event) => {
            if (event.target === svg.node()) {
                deselectAll();
            }
        });

        simulation = d3.forceSimulation()
            .force('link', d3.forceLink().id(d => d.id).distance(80))
            .force('charge', d3.forceManyBody().strength(-200))
            .force('center', d3.forceCenter(width / 2, height / 2))
            .force('collide', d3.forceCollide().radius(30));
    }

    function update(data) {
        if (!data || !data.nodes || data.nodes.length === 0) {
            linkGroup.selectAll('*').remove();
            nodeGroup.selectAll('*').remove();
            labelGroup.selectAll('*').remove();
            return;
        }

        // Deep copy to avoid d3 force mutation
        const nodes = data.nodes.map(d => ({ ...d }));
        const links = data.links.map(d => ({ ...d }));

        const maxFlows = d3.max(links, d => d.flowCount) || 1;
        const radiusScale = d3.scaleSqrt().domain([0, maxFlows]).range([8, 28]);
        const linkWidthScale = d3.scaleLinear().domain([0, maxFlows]).range([1, 8]);

        // Links
        linkGroup.selectAll('*').remove();
        const linkEnter = linkGroup.selectAll('.link').data(links)
            .enter()
            .append('line')
            .attr('class', 'link')
            .attr('stroke-opacity', 0.6)
            .attr('stroke', d => d.attackFraction > 0.3 ? '#ef476f' : '#06d6a0')
            .attr('stroke-width', d => linkWidthScale(d.flowCount))
            .attr('marker-end', 'url(#arrowhead)');

        // Nodes
        nodeGroup.selectAll('*').remove();
        const nodeEnter = nodeGroup.selectAll('.node').data(nodes)
            .enter()
            .append('circle')
            .attr('class', 'node')
            .attr('r', d => radiusScale(d.totalFlows || 1))
            .attr('fill', d => d.type === 'internal' ? '#2196F3' : '#ef476f')
            .attr('stroke', '#1a2332')
            .attr('stroke-width', 2)
            .style('cursor', 'pointer')
            .call(d3.drag()
                .on('start', dragStart)
                .on('drag', dragging)
                .on('end', dragEnd))
            .on('mouseover', onNodeHover)
            .on('mouseout', () => d3.select('#net-tooltip').style('opacity', 0))
            .on('click', onNodeClick);

        // Labels
        labelGroup.selectAll('*').remove();
        const labelEnter = labelGroup.selectAll('.node-label').data(nodes)
            .enter()
            .append('text')
            .attr('class', 'node-label')
            .attr('font-size', '10px')
            .attr('fill', '#ccc')
            .attr('text-anchor', 'middle')
            .attr('dy', d => radiusScale(d.totalFlows || 1) + 14)
            .style('pointer-events', 'none')
            .text(d => d.id.length > 18 ? d.id.substring(0, 18) + '...' : d.id);

        // Tick
        simulation.nodes(nodes).on('tick', () => {
            linkEnter
                .attr('x1', d => d.source.x)
                .attr('y1', d => d.source.y)
                .attr('x2', d => d.target.x)
                .attr('y2', d => d.target.y);

            nodeEnter
                .attr('cx', d => d.x = Math.max(20, Math.min(width - 20, d.x)))
                .attr('cy', d => d.y = Math.max(20, Math.min(height - 20, d.y)));

            labelEnter
                .attr('x', d => d.x)
                .attr('y', d => d.y);
        });

        simulation.force('link').links(links);
        simulation.alpha(0.8).restart();
    }

    function onNodeClick(event, d) {
        event.stopPropagation();
        selectedNode = d;

        // Highlight selected node
        nodeGroup.selectAll('.node')
            .attr('stroke', n => n.id === d.id ? '#ffd166' : '#1a2332')
            .attr('stroke-width', n => n.id === d.id ? 3 : 2);

        // Dim unconnected links
        linkGroup.selectAll('.link')
            .attr('stroke-opacity', l => {
                const src = typeof l.source === 'object' ? l.source.id : l.source;
                const tgt = typeof l.target === 'object' ? l.target.id : l.target;
                return (src === d.id || tgt === d.id) ? 0.9 : 0.15;
            });

        // Show detail panel
        showNodeDetail(d);
    }

    function deselectAll() {
        selectedNode = null;
        nodeGroup.selectAll('.node')
            .attr('stroke', '#1a2332')
            .attr('stroke-width', 2);
        linkGroup.selectAll('.link')
            .attr('stroke-opacity', 0.6);
        hideNodeDetail();
    }

    function showNodeDetail(d) {
        const container = document.getElementById('attack-summary');
        if (!container) return;

        const isAttack = d.type === 'external';
        const pct = d.totalFlows ? ((d.totalFlows / getTotalFlows()) * 100).toFixed(1) : '?';

        container.innerHTML = `
            <div style="border: 1px solid ${isAttack ? '#ef476f' : '#2196F3'}; border-radius: 6px; padding: 8px; margin-top: 4px;">
                <div style="font-weight: 600; color: ${isAttack ? '#ef476f' : '#06d6a0'}; margin-bottom: 4px;">
                    ${d.id}
                </div>
                <div style="font-size: 11px; color: #8899aa; line-height: 1.6;">
                    Type: <span style="color: #e0e6ed">${d.type === 'internal' ? 'Benign Traffic' : 'Attack Traffic'}</span><br>
                    Total flows: <span style="color: #e0e6ed">${formatNumber(d.totalFlows || 0)}</span><br>
                    Share: <span style="color: #e0e6ed">${pct}%</span><br>
                    ${isAttack ? '<span style="color: #ef476f">&#9888; Anomalous activity detected</span>' : '<span style="color: #06d6a0">&#10003; Normal traffic pattern</span>'}
                </div>
            </div>
        `;
    }

    function hideNodeDetail() {
        const container = document.getElementById('attack-summary');
        if (container) container.innerHTML = '';
    }

    function getTotalFlows() {
        let total = 0;
        nodeGroup.selectAll('.node').each(d => { total += d.totalFlows || 0; });
        return total || 1;
    }

    function onNodeHover(event, d) {
        if (selectedNode) return; // Don't show tooltip while a node is selected
        const tooltip = d3.select('#net-tooltip');
        const isAttack = d.type === 'external';
        tooltip
            .style('opacity', 1)
            .style('left', (event.pageX + 15) + 'px')
            .style('top', (event.pageY - 30) + 'px')
            .html(`
                <div class="label" style="color:${isAttack ? '#ef476f' : '#06d6a0'}">${d.id}</div>
                <div class="value">Type: ${d.type}</div>
                <div class="value">Flows: ${formatNumber(d.totalFlows || 0)}</div>
                <div class="value" style="font-size:10px;color:#666">Click for details</div>
            `);
    }

    function dragStart(event, d) {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
    }

    function dragging(event, d) {
        d.fx = event.x;
        d.fy = event.y;
    }

    function dragEnd(event, d) {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
    }

    return { init, update };
})();
