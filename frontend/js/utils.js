/**
 * Shared utilities for the Interactive IDS Dashboard.
 */

const API_BASE = 'http://localhost:5000/api';

// Attack type colors (must match backend/config.py)
const ATTACK_COLORS = {
    'Benign': '#4CAF50',
    'DoS Hulk': '#F44336',
    'DoS GoldenEye': '#E91E63',
    'DoS slowloris': '#FF5722',
    'DoS Slowhttptest': '#FF9800',
    'DDoS': '#9C27B0',
    'PortScan': '#2196F3',
    'FTP-Patator': '#00BCD4',
    'SSH-Patator': '#009688',
    'Bot': '#795548',
    'Web Attack - Brute Force': '#FFEB3B',
    'Web Attack - XSS': '#FFC107',
    'Web Attack - Sql Injection': '#FF9800',
    'Infiltration': '#607D8B',
    'Heartbleed': '#D50000',
};

function getAttackColor(label) {
    return ATTACK_COLORS[label] || '#888888';
}

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

function showLoading() {
    document.getElementById('loading-overlay').classList.remove('hidden');
}

function hideLoading() {
    document.getElementById('loading-overlay').classList.add('hidden');
}

function updateStatus(key, value) {
    const el = document.getElementById(`status-${key}`);
    if (el) {
        const labels = { dataset: 'Dataset', points: 'Points', time: 'Computation' };
        el.textContent = `${labels[key] || key}: ${value}`;
    }
}

/**
 * Group contiguous timestamps with the same attack label into segments.
 */
function groupAttackSegments(timestamps, labels) {
    const segments = [];
    let current = null;

    for (let i = 0; i < timestamps.length; i++) {
        const label = labels[i];
        if (label === 'Benign') {
            if (current) {
                current.end = timestamps[i];
                segments.push(current);
                current = null;
            }
            continue;
        }
        if (!current || current.label !== label) {
            if (current) {
                current.end = timestamps[i];
                segments.push(current);
            }
            current = { label, start: timestamps[i], end: timestamps[i] };
        } else {
            current.end = timestamps[i];
        }
    }
    if (current) {
        current.end = timestamps[timestamps.length - 1];
        segments.push(current);
    }
    return segments;
}
