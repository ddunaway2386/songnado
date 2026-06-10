#!/usr/bin/env node
/**
 * Generate a self-contained HTML preview player from a substitutions CSV.
 *
 * Each row gets an inline <audio> element pointing at the Deezer CDN MP3
 * directly. No Deezer login, no opening new tabs, no Google Sheets
 * formula gymnastics. Just open the HTML, click play, decide.
 *
 * Features:
 *  - Inline 30-second audio player per row (HTML5 <audio controls>)
 *  - Approve / Skip buttons with localStorage persistence
 *  - Progress counter (X / N reviewed)
 *  - Filter to Unreviewed / Approved / Skipped / All
 *  - Export Approved decisions as CSV (download)
 *
 * Usage:
 *   node scripts/generate-preview-player.mjs <substitutions-csv>
 *
 * Output:
 *   scripts/preview-player-<id>.html
 *
 * Then double-click the HTML file (or right-click → Open with → Chrome).
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: node scripts/generate-preview-player.mjs <substitutions-csv>');
  process.exit(1);
}
if (!existsSync(inputPath)) {
  console.error(`✗ File not found: ${inputPath}`);
  process.exit(1);
}

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        current += c;
      }
    } else {
      if (c === ',') {
        result.push(current);
        current = '';
      } else if (c === '"' && current.length === 0) {
        inQuotes = true;
      } else {
        current += c;
      }
    }
  }
  result.push(current);
  return result;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const fields = parseCsvLine(line);
    const row = {};
    headers.forEach((h, j) => (row[h] = fields[j] ?? ''));
    return row;
  });
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const text = readFileSync(inputPath, 'utf8');
const rows = parseCsv(text).filter((r) => r.AlternativeDeezerId && r.AlternativePreviewUrl);

console.log(`Loaded ${rows.length} substitutions with previews.`);

const inputBase = basename(inputPath, '.csv').replace(/^preview-substitutions-/, '');
const outPath = join(__dirname, `preview-player-${inputBase}.html`);

const storageKey = `songnado-preview-decisions-${inputBase}`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Songnado Preview Review — ${inputBase}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root {
    --bg: #14171F;
    --surface: #1E232E;
    --surface-alt: #2A303D;
    --border: #353B4A;
    --primary: #6B7BFF;
    --success: #5CD68E;
    --danger: #FF6F6F;
    --text-primary: #ECEEF3;
    --text-muted: #9098A8;
  }
  * { box-sizing: border-box; }
  body {
    background: var(--bg);
    color: var(--text-primary);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    margin: 0;
    padding: 0;
  }
  header {
    position: sticky;
    top: 0;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    padding: 16px 24px;
    z-index: 10;
    box-shadow: 0 2px 8px rgba(0,0,0,0.4);
  }
  header h1 {
    margin: 0 0 4px;
    font-size: 1.2em;
  }
  header .stats {
    color: var(--text-muted);
    font-size: 0.85em;
  }
  .controls {
    margin-top: 12px;
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .controls button {
    background: var(--surface-alt);
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 6px 12px;
    cursor: pointer;
    font-size: 0.85em;
  }
  .controls button:hover { background: var(--border); }
  .controls button.active {
    background: var(--primary);
    border-color: var(--primary);
  }
  .controls button.export {
    background: var(--success);
    color: #1B1F25;
    font-weight: 600;
    border-color: var(--success);
  }
  main { padding: 16px 24px; max-width: 900px; margin: 0 auto; }
  .row {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 12px 16px;
    margin-bottom: 10px;
  }
  .row.approved { border-color: var(--success); }
  .row.skipped { opacity: 0.5; border-color: var(--danger); }
  .row.hidden { display: none; }
  .row-head {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    font-size: 0.75em;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-bottom: 4px;
  }
  .row-num { color: var(--text-muted); }
  .conf-exact { color: var(--success); }
  .conf-loose { color: #E0B057; }
  .row-original {
    color: var(--text-muted);
    font-size: 0.85em;
    margin-bottom: 4px;
  }
  .row-original::before { content: 'wanted: '; }
  .row-alt {
    font-size: 1.05em;
    color: var(--text-primary);
    font-weight: 600;
    margin-bottom: 8px;
  }
  .row-album {
    color: var(--text-muted);
    font-size: 0.85em;
    margin-bottom: 8px;
  }
  audio {
    width: 100%;
    margin: 8px 0;
    height: 36px;
  }
  .row-actions {
    display: flex;
    gap: 8px;
    margin-top: 8px;
  }
  .row-actions button {
    flex: 1;
    padding: 8px 12px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--surface-alt);
    color: var(--text-primary);
    cursor: pointer;
    font-weight: 600;
  }
  .row-actions button.approve:hover,
  .row-actions button.approve.active {
    background: var(--success);
    color: #1B1F25;
    border-color: var(--success);
  }
  .row-actions button.skip:hover,
  .row-actions button.skip.active {
    background: var(--danger);
    color: #1B1F25;
    border-color: var(--danger);
  }
  .row-actions button.reset {
    flex: 0 0 auto;
    background: transparent;
    color: var(--text-muted);
  }
  .empty {
    text-align: center;
    color: var(--text-muted);
    padding: 60px 16px;
    font-style: italic;
  }
</style>
</head>
<body>
<header>
  <h1>Preview Substitutions Review</h1>
  <div class="stats">
    <span id="reviewedCount">0</span> of ${rows.length} reviewed —
    <span id="approvedCount">0</span> approved,
    <span id="skippedCount">0</span> skipped
  </div>
  <div class="controls">
    <button data-filter="all" class="active">All (${rows.length})</button>
    <button data-filter="unreviewed">Unreviewed</button>
    <button data-filter="approved">Approved</button>
    <button data-filter="skipped">Skipped</button>
    <button class="export" id="exportBtn">⬇ Export approved CSV</button>
    <button id="resetAllBtn">Reset all</button>
  </div>
</header>
<main id="list">
${rows
  .map((r, i) => {
    const confClass = r.ConfidenceNote === 'Exact title match' ? 'conf-exact' : 'conf-loose';
    return `<div class="row" data-id="${escapeHtml(r.AlternativeDeezerId)}">
    <div class="row-head">
      <span class="row-num">#${i + 1}</span>
      <span class="${confClass}">${escapeHtml(r.ConfidenceNote)}</span>
    </div>
    <div class="row-original">${escapeHtml(r.OriginalTitle)} — ${escapeHtml(r.OriginalArtist)}</div>
    <div class="row-alt">▶ ${escapeHtml(r.AlternativeTitle)} — ${escapeHtml(r.AlternativeArtist)}</div>
    <div class="row-album">${escapeHtml(r.AlternativeAlbum)} · ${r.AlternativeDurationSec}s · rank ${r.AlternativeRank}</div>
    <audio controls preload="none" src="${escapeHtml(r.AlternativePreviewUrl)}"></audio>
    <div class="row-actions">
      <button class="approve" data-action="approve">✓ Approve</button>
      <button class="skip" data-action="skip">✗ Skip</button>
      <button class="reset" data-action="reset">Reset</button>
    </div>
    <!-- Hidden data for export -->
    <span hidden class="original-title">${escapeHtml(r.OriginalTitle)}</span>
    <span hidden class="original-artist">${escapeHtml(r.OriginalArtist)}</span>
    <span hidden class="original-id">${escapeHtml(r.OriginalDeezerId)}</span>
    <span hidden class="alt-title">${escapeHtml(r.AlternativeTitle)}</span>
    <span hidden class="alt-artist">${escapeHtml(r.AlternativeArtist)}</span>
    <span hidden class="alt-id">${escapeHtml(r.AlternativeDeezerId)}</span>
  </div>`;
  })
  .join('\n')}
</main>
<div class="empty hidden" id="emptyState">No matching rows in current filter.</div>

<script>
const STORAGE_KEY = '${storageKey}';
const decisions = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');

function saveDecisions() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(decisions));
}

function applyDecisionToRow(rowEl) {
  const id = rowEl.dataset.id;
  const decision = decisions[id];
  rowEl.classList.remove('approved', 'skipped');
  const approveBtn = rowEl.querySelector('[data-action="approve"]');
  const skipBtn = rowEl.querySelector('[data-action="skip"]');
  approveBtn.classList.remove('active');
  skipBtn.classList.remove('active');
  if (decision === 'approve') {
    rowEl.classList.add('approved');
    approveBtn.classList.add('active');
  } else if (decision === 'skip') {
    rowEl.classList.add('skipped');
    skipBtn.classList.add('active');
  }
}

function updateStats() {
  const total = ${rows.length};
  const approved = Object.values(decisions).filter((d) => d === 'approve').length;
  const skipped = Object.values(decisions).filter((d) => d === 'skip').length;
  document.getElementById('reviewedCount').textContent = approved + skipped;
  document.getElementById('approvedCount').textContent = approved;
  document.getElementById('skippedCount').textContent = skipped;
}

function applyFilter(filter) {
  const rowEls = document.querySelectorAll('.row');
  let visible = 0;
  rowEls.forEach((el) => {
    const id = el.dataset.id;
    const decision = decisions[id];
    let show = false;
    if (filter === 'all') show = true;
    else if (filter === 'unreviewed') show = !decision;
    else if (filter === 'approved') show = decision === 'approve';
    else if (filter === 'skipped') show = decision === 'skip';
    el.classList.toggle('hidden', !show);
    if (show) visible++;
  });
  document.getElementById('emptyState').classList.toggle('hidden', visible > 0);
}

// Initialize
document.querySelectorAll('.row').forEach(applyDecisionToRow);
updateStats();

// Action buttons
document.querySelectorAll('.row').forEach((rowEl) => {
  rowEl.querySelector('[data-action="approve"]').addEventListener('click', () => {
    decisions[rowEl.dataset.id] = 'approve';
    saveDecisions();
    applyDecisionToRow(rowEl);
    updateStats();
  });
  rowEl.querySelector('[data-action="skip"]').addEventListener('click', () => {
    decisions[rowEl.dataset.id] = 'skip';
    saveDecisions();
    applyDecisionToRow(rowEl);
    updateStats();
  });
  rowEl.querySelector('[data-action="reset"]').addEventListener('click', () => {
    delete decisions[rowEl.dataset.id];
    saveDecisions();
    applyDecisionToRow(rowEl);
    updateStats();
  });
});

// Filter buttons
document.querySelectorAll('.controls button[data-filter]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.controls button[data-filter]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    applyFilter(btn.dataset.filter);
  });
});

// Export
document.getElementById('exportBtn').addEventListener('click', () => {
  const headers = ['OriginalTitle', 'OriginalArtist', 'OriginalDeezerId', 'AlternativeTitle', 'AlternativeArtist', 'AlternativeDeezerId'];
  let csv = headers.join(',') + '\\n';
  document.querySelectorAll('.row').forEach((rowEl) => {
    if (decisions[rowEl.dataset.id] === 'approve') {
      const cell = (cls) => '"' + (rowEl.querySelector('.' + cls)?.textContent ?? '').replace(/"/g, '""') + '"';
      csv += [
        cell('original-title'),
        cell('original-artist'),
        cell('original-id'),
        cell('alt-title'),
        cell('alt-artist'),
        cell('alt-id'),
      ].join(',') + '\\n';
    }
  });
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'approved-substitutions-${inputBase}.csv';
  a.click();
  URL.revokeObjectURL(url);
});

// Reset all
document.getElementById('resetAllBtn').addEventListener('click', () => {
  if (!confirm('Clear ALL decisions? This cannot be undone.')) return;
  Object.keys(decisions).forEach((k) => delete decisions[k]);
  saveDecisions();
  document.querySelectorAll('.row').forEach(applyDecisionToRow);
  updateStats();
});
</script>
</body>
</html>
`;

writeFileSync(outPath, html);
console.log(`✓ Wrote ${outPath}`);
console.log(`\nDouble-click the file to open in your browser, or:`);
console.log(`  start ${outPath}    (Windows)`);
console.log(`  open ${outPath}     (Mac)`);
