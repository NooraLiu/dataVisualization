// ── Global state ─────────────────────────────────────────────────────────
let table;          // influence_data.csv
let hotspotTable;   // article_hotspots.csv
let qwenSectionVarianceTable;
let qwenArticleVarianceTable;
let points = [];
let articleHotspots = [];
let hoverIndex = -1;
let qwenSectionStats = {};
let qwenArticleStats = {};

// UI elements
let xDimSelect, yDimSelect, scoringSelect, pcaToggle, viewModeSelect;
let allDimNames = [];
let scatterplotX = 60;
let scatterplotY = 60;
let scatterplotSize = 600;
let ROW_HEIGHT = 150;
let POINT_SIZE = 5;

// Zoom state
let isZoomed = false;
let zoomedHotspot = null;
let originalXRange = { min: 0, max: 1 };
let originalYRange = { min: 0, max: 1 };
let zoomedXRange  = { min: 0, max: 1 };
let zoomedYRange  = { min: 0, max: 1 };

// Current PCA mode: 'base' or 'instruct'
let pcaMode = 'base';

// Qwen Contour Map state
const CONTOUR_RES    = 80;
const CONTOUR_BW_MIN = 0.025;   // article view: low variancePctile  → narrow spike
const CONTOUR_BW_MAX = 0.065;   // article view: high variancePctile → wide flat hill
const CONTOUR_BW_MIN_SECTION = 0.009;  // section view: tighter, more local variation
const CONTOUR_BW_MAX_SECTION = 0.030;  // section view: even high-variance stays fairly sharp
const CONTOUR_LEVELS = Array.from({length: 40}, (_, i) => parseFloat(((i + 1) / 41).toFixed(4)));
let contourGrid     = null;   // float[row][col], null = no data
let contourBuf      = null;   // p5.Graphics offscreen buffer
let contourCacheKey = '';

// View mode: 'sections' or 'articles'
let viewMode = 'sections';
let zoomedFromArticles = false;  // Track if zoom came from articles view

// Scoring / color modes
let selectedScoring = 'Article Groups';

// Table sync
let lastHoveredId = null;
let tableHoverId = null;

// Selected point & nearest neighbours (from table row click)
let selectedPointId = null;
let neighbourIds    = [];

// Wikipedia-map tab reference
let wikiMapWindow = null;
let wikiMapArticles = [];

// ── Dimension whitelist ──────────────────────────────────────────────────
const DIMENSION_NAMES = [
  'base_pca1', 'base_pca2',
  'instruct_pca1', 'instruct_pca2',
  'bert_umap1', 'bert_umap2',
  'base_total_influence', 'instruct_total_influence',
  'influence_diff',
  'norm_base_influence', 'norm_instruct_influence',
  'base_hub_score', 'instruct_hub_score',
];

// ── preload ──────────────────────────────────────────────────────────────
function preload() {
  table = loadTable('influence_data.csv', 'csv', 'header');
  hotspotTable = loadTable('article_hotspots.csv', 'csv', 'header');
  qwenSectionVarianceTable = loadTable('qwen_l2_value_variance_sections.csv', 'csv', 'header');
  qwenArticleVarianceTable = loadTable('qwen_l2_value_variance_articles.csv', 'csv', 'header');
}

// ── setup ────────────────────────────────────────────────────────────────
function setup() {
  let cnv = createCanvas(800, 1000);
  cnv.parent('scatterplot-holder');
  cnv.style('position', 'relative');
  cnv.style('z-index', '1000');
  noStroke();
  textAlign(LEFT, TOP);
  textSize(12);

  // Detect available numeric dimensions from CSV header
  allDimNames = table.columns.filter(c => DIMENSION_NAMES.includes(c));
  qwenSectionStats = buildQwenStatsByKey(qwenSectionVarianceTable, 'section_id');
  qwenArticleStats = buildQwenStatsByKey(qwenArticleVarianceTable, 'article_id');

  // Extract points
  for (let r = 0; r < table.getRowCount(); r++) {
    let dims = allDimNames.map(d => float(table.getString(r, d)));
    let id = table.getString(r, 'id');
    points.push({
      id:                     id,
      articleId:              table.getString(r, 'article_id'),
      articleTitle:           table.getString(r, 'article_title'),
      sectionPath:            table.getString(r, 'section_path'),
      heading:                table.getString(r, 'heading'),
      level:                  int(table.getString(r, 'level')),
      question:               table.getString(r, 'question'),
      baseInfluence:          float(table.getString(r, 'base_total_influence')),
      instructInfluence:      float(table.getString(r, 'instruct_total_influence')),
      normBase:               float(table.getString(r, 'norm_base_influence')),
      normInstruct:           float(table.getString(r, 'norm_instruct_influence')),
      influenceDiff:          float(table.getString(r, 'influence_diff')),
      baseTopK:               int(table.getString(r, 'base_top_k_count')),
      instructTopK:           int(table.getString(r, 'instruct_top_k_count')),
      baseHubScore:           float(table.getString(r, 'base_hub_score')),
      instructHubScore:       float(table.getString(r, 'instruct_hub_score')),
      qwenStats:              qwenSectionStats[String(id)] || blankQwenStats(),
      dims,
    });
  }

  // Parse article hotspots
  let hotspotCols = hotspotTable.columns;
  let hasBert = hotspotCols.includes('bert_x');
  for (let r = 0; r < hotspotTable.getRowCount(); r++) {
    articleHotspots.push({
      id:           hotspotTable.getString(r, 'id'),
      baseX:        float(hotspotTable.getString(r, 'base_x')),
      baseY:        float(hotspotTable.getString(r, 'base_y')),
      instructX:    float(hotspotTable.getString(r, 'instruct_x')),
      instructY:    float(hotspotTable.getString(r, 'instruct_y')),
      bertX:        hasBert ? float(hotspotTable.getString(r, 'bert_x')) : 0,
      bertY:        hasBert ? float(hotspotTable.getString(r, 'bert_y')) : 0,
      size:         float(hotspotTable.getString(r, 'size')),
      label:        hotspotTable.getString(r, 'label'),
      articleId:    hotspotTable.getString(r, 'article_id'),
      sectionCount: int(hotspotTable.getString(r, 'section_count')),
    });
  }

  // ── Build article-level aggregated points ────────────────────────────────
  buildArticlePoints();

  // ── X / Y dimension selectors ──────────────────────────────────────────
  xDimSelect = createSelect();
  yDimSelect = createSelect();
  xDimSelect.position(scatterplotX + scatterplotSize + 35, scatterplotY + scatterplotSize + 65);
  yDimSelect.position(scatterplotX - 40, scatterplotY + 30);
  xDimSelect.style('position', 'fixed');
  yDimSelect.style('position', 'fixed');
  xDimSelect.style('z-index', '1001');
  yDimSelect.style('z-index', '1001');
  xDimSelect.style('width', '110px');
  yDimSelect.style('width', '110px');

  populateDimensionDropdowns();
  xDimSelect.selected('base_pca1');
  yDimSelect.selected('base_pca2');

  // ── PCA layout toggle ─────────────────────────────────────────────────
  pcaToggle = createSelect();
  pcaToggle.option('Base Model');
  pcaToggle.option('Instruct Model');
  pcaToggle.option('BERT Embeddings');
  pcaToggle.selected('Base Model');
  pcaToggle.position(670, 80);
  pcaToggle.style('position', 'fixed');
  pcaToggle.style('z-index', '1001');
  pcaToggle.style('width', '150px');
  pcaToggle.changed(handlePCAToggle);

  // ── Scoring / color mode selector ──────────────────────────────────────
  scoringSelect = createSelect();
  scoringSelect.option('Article Groups');
  scoringSelect.option('Groups + Base Influence');
  scoringSelect.option('Groups + Instruct Influence');
  scoringSelect.option('Base Influence');
  scoringSelect.option('Instruct Influence');
  scoringSelect.option('Influence Diff');
  scoringSelect.option('Base Hub Score');
  scoringSelect.option('Instruct Hub Score');
  scoringSelect.option('Qwen Base Value Cloud');
  scoringSelect.option('Qwen Instruct Value Cloud');
  scoringSelect.option('Qwen Base Contour');
  scoringSelect.option('Qwen Instruct Contour');
  scoringSelect.option('Section Level');
  scoringSelect.selected('Article Groups');
  scoringSelect.position(670, 115);
  scoringSelect.style('position', 'fixed');
  scoringSelect.style('z-index', '1001');
  scoringSelect.style('width', '150px');
  scoringSelect.changed(() => {
    selectedScoring = scoringSelect.value();
    if (isQwenCloudMode() || isQwenContourMode()) {
      pcaToggle.selected('BERT Embeddings');
      handlePCAToggle();
    }
  });

  // ── View mode toggle (Sections vs Articles) ───────────────────────────
  viewModeSelect = createSelect();
  viewModeSelect.option('Sections');
  viewModeSelect.option('Articles');
  viewModeSelect.selected('Sections');
  viewModeSelect.position(670, 150);
  viewModeSelect.style('position', 'fixed');
  viewModeSelect.style('z-index', '1001');
  viewModeSelect.style('width', '150px');
  viewModeSelect.changed(() => {
    viewMode = viewModeSelect.value().toLowerCase();
    isZoomed = false;
    zoomedHotspot = null;
  });

  // DataTable
  populateDataTable();
}

// ── PCA toggle handler ───────────────────────────────────────────────────
function handlePCAToggle() {
  let val = pcaToggle.value();
  if (val === 'Base Model') {
    pcaMode = 'base';
    xDimSelect.selected('base_pca1');
    yDimSelect.selected('base_pca2');
  } else if (val === 'Instruct Model') {
    pcaMode = 'instruct';
    xDimSelect.selected('instruct_pca1');
    yDimSelect.selected('instruct_pca2');
  } else {
    pcaMode = 'bert';
    xDimSelect.selected('bert_umap1');
    yDimSelect.selected('bert_umap2');
  }
  isZoomed = false;
  zoomedHotspot = null;
}

// ── draw loop ────────────────────────────────────────────────────────────
function draw() {
  background(250);

  let xName = xDimSelect.value();
  let yName = yDimSelect.value();
  let xIndex = allDimNames.indexOf(xName);
  let yIndex = allDimNames.indexOf(yName);

  if (!isZoomed) {
    updateDataRanges(xIndex, yIndex);
  }

  detectHover(xIndex, yIndex);

  // Table row sync (only in sections view)
  if (hoverIndex !== -1 && viewMode === 'sections') {
    let hoveredId = points[hoverIndex].id;
    if (hoveredId !== lastHoveredId) {
      locateRowById(hoveredId);
      lastHoveredId = hoveredId;
    }
  } else {
    lastHoveredId = null;
  }

  drawScatterplot(xIndex, yIndex);
  drawLabels();
}

// ── helpers ──────────────────────────────────────────────────────────────
function activePoints() {
  return viewMode === 'articles' ? articlePoints : points;
}

function parseOptionalFloat(row, name, fallback = 0) {
  if (!row) return fallback;
  let raw = row.getString(name);
  if (raw === null || raw === undefined || raw === '') return fallback;
  let v = float(raw);
  return Number.isFinite(v) ? v : fallback;
}

function parseOptionalInt(row, name, fallback = 0) {
  if (!row) return fallback;
  let raw = row.getString(name);
  if (raw === null || raw === undefined || raw === '') return fallback;
  let v = int(raw);
  return Number.isFinite(v) ? v : fallback;
}

function blankQwenStats() {
  return {
    base: {
      mean: 0,
      std: 0,
      nRuns: 0,
      valuePctile: 0.5,
      variancePctile: 0,
    },
    instruct: {
      mean: 0,
      std: 0,
      nRuns: 0,
      valuePctile: 0.5,
      variancePctile: 0,
    },
  };
}

function buildQwenStatsByKey(srcTable, keyColumn) {
  let out = {};
  if (!srcTable) return out;
  for (let r = 0; r < srcTable.getRowCount(); r++) {
    let row = srcTable.getRow(r);
    let key = String(row.getString(keyColumn));
    out[key] = {
      base: {
        mean: parseOptionalFloat(row, 'base_value_mean'),
        std: parseOptionalFloat(row, 'base_value_std'),
        nRuns: parseOptionalInt(row, 'base_n_runs'),
        valuePctile: parseOptionalFloat(row, 'base_value_pctile', 0.5),
        variancePctile: parseOptionalFloat(row, 'base_variance_pctile', 0),
      },
      instruct: {
        mean: parseOptionalFloat(row, 'instruct_value_mean'),
        std: parseOptionalFloat(row, 'instruct_value_std'),
        nRuns: parseOptionalInt(row, 'instruct_n_runs'),
        valuePctile: parseOptionalFloat(row, 'instruct_value_pctile', 0.5),
        variancePctile: parseOptionalFloat(row, 'instruct_variance_pctile', 0),
      },
    };
  }
  return out;
}

function isQwenCloudMode() {
  return selectedScoring === 'Qwen Base Value Cloud' ||
         selectedScoring === 'Qwen Instruct Value Cloud';
}

function activeQwenModelType() {
  return selectedScoring === 'Qwen Instruct Value Cloud' ? 'instruct' : 'base';
}

function activeQwenStats(p) {
  if (!p || !p.qwenStats) return blankQwenStats()[activeQwenModelType()];
  return p.qwenStats[activeQwenModelType()] || blankQwenStats()[activeQwenModelType()];
}

function qwenValueColorFromStats(stats) {
  let v = constrain(stats.valuePctile, 0, 1);
  return lerpColor(color(45, 95, 190), color(220, 45, 45), v);
}

function qwenDotSize(stats, isArticle) {
  let v = constrain(stats.valuePctile, 0, 1);
  return isArticle ? map(v, 0, 1, 12, 42) : map(v, 0, 1, 4, 11);
}

function drawQwenCloudPoint(x, y, stats, isArticle) {
  let col = qwenValueColorFromStats(stats);
  let variance = constrain(stats.variancePctile, 0, 1);
  let dotSize = qwenDotSize(stats, isArticle);
  let maxHalo = isArticle ? map(variance, 0, 1, dotSize + 8, dotSize + 58)
                          : map(variance, 0, 1, dotSize + 6, dotSize + 36);
  let baseAlpha = map(variance, 0, 1, 8, 44);

  noStroke();
  for (let i = 3; i >= 1; i--) {
    let t = i / 3;
    let haloSize = lerp(dotSize + 4, maxHalo, t);
    let alpha = baseAlpha * (1.1 - 0.25 * i);
    fill(red(col), green(col), blue(col), alpha);
    ellipse(x, y, haloSize, haloSize);
  }

  fill(red(col), green(col), blue(col), map(variance, 0, 1, 240, 125));
  stroke(255, map(variance, 0, 1, 170, 80));
  strokeWeight(isArticle ? 1.4 : 0.7);
  ellipse(x, y, dotSize, dotSize);
}

function formatStat(v) {
  if (!Number.isFinite(v)) return 'NA';
  let a = abs(v);
  if (a >= 1000000 || (a > 0 && a < 0.01)) return v.toExponential(2);
  if (a >= 1000) return v.toFixed(0);
  return v.toFixed(2);
}

function qwenHoverLines(p) {
  let model = activeQwenModelType();
  let stats = activeQwenStats(p);
  let label = model === 'base' ? 'Qwen Base' : 'Qwen Instruct';
  return [
    `${label} value: ${formatStat(stats.mean)} ± ${formatStat(stats.std)} (${stats.nRuns} seeds)`,
    `Value pctile: ${(100 * stats.valuePctile).toFixed(0)}  |  Variance pctile: ${(100 * stats.variancePctile).toFixed(0)}`,
  ];
}

// ── Qwen Contour Map helpers ─────────────────────────────────────────────
function isQwenContourMode() {
  return selectedScoring === 'Qwen Base Contour' ||
         selectedScoring === 'Qwen Instruct Contour';
}

function contourModelType() {
  return selectedScoring === 'Qwen Instruct Contour' ? 'instruct' : 'base';
}

function getContourStats(p) {
  if (!p || !p.qwenStats) return blankQwenStats()['base'];
  return p.qwenStats[contourModelType()] || blankQwenStats()['base'];
}

function contourCacheKeyFor(xi, yi, xr, yr) {
  return [xi, yi, xr.min.toFixed(4), xr.max.toFixed(4),
          yr.min.toFixed(4), yr.max.toFixed(4),
          contourModelType(), viewMode].join(',');
}

// Topographic color ramp: pale blue (low) → mint → yellow → orange → dark red (high)
function topoColor(v) {
  if (v === null) return color(240, 242, 245);
  let e = constrain(v, 0, 1);
  if (e < 0.25) return lerpColor(color(195, 210, 242), color(145, 210, 175), e / 0.25);
  if (e < 0.5)  return lerpColor(color(145, 210, 175), color(235, 220, 115), (e - 0.25) / 0.25);
  if (e < 0.75) return lerpColor(color(235, 220, 115), color(210, 130,  60), (e - 0.5)  / 0.25);
  return            lerpColor(color(210, 130,  60), color(170,  30,  40), (e - 0.75) / 0.25);
}

// Build KDE-weighted elevation grid and render it into contourBuf
function buildContourGrid(xIndex, yIndex, xRange, yRange) {
  let key = contourCacheKeyFor(xIndex, yIndex, xRange, yRange);
  if (key === contourCacheKey && contourGrid) return; // already up-to-date

  let pts   = activePoints();
  let G     = CONTOUR_RES;
  // Section view uses tighter bandwidths so individual sections each form
  // their own distinct peak/valley instead of merging into broad hills.
  const bwMin = (viewMode === 'sections') ? CONTOUR_BW_MIN_SECTION : CONTOUR_BW_MIN;
  const bwMax = (viewMode === 'sections') ? CONTOUR_BW_MAX_SECTION : CONTOUR_BW_MAX;
  const BW_MAX_SQ9 = 9 * bwMax * bwMax; // conservative outer cutoff
  let xSpan = (xRange.max - xRange.min) || 1;
  let ySpan = (yRange.max - yRange.min) || 1;

  contourGrid = [];
  for (let row = 0; row < G; row++) {
    contourGrid[row] = [];
    let yd = map(row, 0, G - 1, yRange.max, yRange.min); // row 0 = top = yMax
    for (let col = 0; col < G; col++) {
      let xd    = map(col, 0, G - 1, xRange.min, xRange.max);
      let wSum  = 0, wTotal = 0;
      for (let p of pts) {
        let dx = (p.dims[xIndex] - xd) / xSpan;
        let dy = (p.dims[yIndex] - yd) / ySpan;
        let d2 = dx * dx + dy * dy;
        if (d2 > BW_MAX_SQ9) continue; // fast outer reject
        let stats = getContourStats(p);
        let vp  = stats.valuePctile;
        // Per-point bandwidth driven by variancePctile:
        //   low variance  → tight spike (certain, well-defined peak)
        //   high variance → wide flat hill (uncertain, diffuse influence)
        let bwi = lerp(bwMin, bwMax,
                       constrain(stats.variancePctile, 0, 1));
        if (d2 > 9 * bwi * bwi) continue;
        let w  = Math.exp(-d2 / (2 * bwi * bwi));
        // Equal spatial weight: every point contributes its spread fairly.
        // Elevation = weighted average of valuePctile → blue dots form valleys,
        // red dots form peaks, bandwidth (variance) controls each one's footprint.
        wSum   += vp * w;
        wTotal += w;
      }
      contourGrid[row][col] = wTotal > 0.005 ? wSum / wTotal : null;
    }
  }

  // Render filled terrain into offscreen buffer using bilinear interpolation
  // per pixel so there are no blocky rectangle edges.
  if (!contourBuf) contourBuf = createGraphics(scatterplotSize, scatterplotSize);
  let gbuf = contourBuf;
  gbuf.loadPixels();
  let pd = gbuf.pixelDensity();
  let W  = scatterplotSize;
  let H  = scatterplotSize;
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      // Map pixel → fractional grid coordinates
      let gc = (px / (W - 1)) * (G - 1);
      let gr = (py / (H - 1)) * (G - 1);
      let ci = Math.min(Math.floor(gc), G - 2);
      let ri = Math.min(Math.floor(gr), G - 2);
      let fc = gc - ci, fr = gr - ri;
      let tl = contourGrid[ri][ci],     tr = contourGrid[ri][ci + 1];
      let bl = contourGrid[ri + 1][ci], br = contourGrid[ri + 1][ci + 1];
      let v;
      if (tl === null || tr === null || bl === null || br === null) {
        v = null;
      } else {
        v = tl * (1 - fc) * (1 - fr) + tr * fc * (1 - fr) +
            bl * (1 - fc) * fr       + br * fc * fr;
      }
      let [r, gg, b] = topoColorRGB(v);
      for (let sy = 0; sy < pd; sy++) {
        for (let sx = 0; sx < pd; sx++) {
          let idx = 4 * ((py * pd + sy) * W * pd + (px * pd + sx));
          gbuf.pixels[idx]     = r;
          gbuf.pixels[idx + 1] = gg;
          gbuf.pixels[idx + 2] = b;
          gbuf.pixels[idx + 3] = 255;
        }
      }
    }
  }
  gbuf.updatePixels();
  contourCacheKey = key;
}

// Raw RGB version of topoColor for fast pixel-level rendering (no p5 objects)
function topoColorRGB(v) {
  if (v === null) return [240, 242, 245];
  const e = Math.min(Math.max(v, 0), 1);
  const stops = [
    [195, 210, 242],
    [145, 210, 175],
    [235, 220, 115],
    [210, 130,  60],
    [170,  30,  40],
  ];
  const t = e * (stops.length - 1);
  const i = Math.min(Math.floor(t), stops.length - 2);
  const f = t - i;
  return [
    Math.round(stops[i][0] + (stops[i + 1][0] - stops[i][0]) * f),
    Math.round(stops[i][1] + (stops[i + 1][1] - stops[i][1]) * f),
    Math.round(stops[i][2] + (stops[i + 1][2] - stops[i][2]) * f),
  ];
}

// Marching squares: edge indices 0=top, 1=right, 2=bottom, 3=left
// Bit encoding: TL=8, TR=4, BR=2, BL=1
const MS_SEGS = [
  [],                  // 0:  none
  [[3, 2]],            // 1:  BL
  [[2, 1]],            // 2:  BR
  [[3, 1]],            // 3:  BL+BR
  [[0, 1]],            // 4:  TR
  [[0, 3], [1, 2]],    // 5:  TR+BL  (saddle)
  [[0, 2]],            // 6:  TR+BR
  [[0, 3]],            // 7:  TR+BR+BL
  [[0, 3]],            // 8:  TL
  [[0, 2]],            // 9:  TL+BL
  [[0, 1], [2, 3]],    // 10: TL+BR  (saddle)
  [[0, 1]],            // 11: TL+BL+BR
  [[3, 1]],            // 12: TL+TR
  [[1, 2]],            // 13: TL+TR+BL
  [[2, 3]],            // 14: TL+TR+BR
  [],                  // 15: all
];

// Returns the screen-space crossing point for 'edge' at 'thresh'
function edgePt(edge, tl, tr, br, bl, x0, y0, x1, y1, thresh) {
  let t;
  switch (edge) {
    case 0: t = (tr === tl) ? 0.5 : constrain((thresh - tl) / (tr - tl), 0, 1);
            return { x: lerp(x0, x1, t), y: y0 };
    case 1: t = (br === tr) ? 0.5 : constrain((thresh - tr) / (br - tr), 0, 1);
            return { x: x1, y: lerp(y0, y1, t) };
    case 2: t = (br === bl) ? 0.5 : constrain((thresh - bl) / (br - bl), 0, 1);
            return { x: lerp(x0, x1, t), y: y1 };
    case 3: t = (bl === tl) ? 0.5 : constrain((thresh - tl) / (bl - tl), 0, 1);
            return { x: x0, y: lerp(y0, y1, t) };
  }
}

function drawContourLines() {
  if (!contourGrid) return;
  let G  = CONTOUR_RES;
  let cw = scatterplotSize / G;
  let ch = scatterplotSize / G;

  for (let level of CONTOUR_LEVELS) {
    // Major every ~10 lines (near 0.25, 0.5, 0.75)
    let isMajor = (level > 0.23 && level < 0.27) ||
                  (level > 0.48 && level < 0.52) ||
                  (level > 0.73 && level < 0.77);
    stroke(40, 25, 10, isMajor ? 220 : 160);
    strokeWeight(isMajor ? 2.0 : 0.9);

    for (let row = 0; row < G - 1; row++) {
      for (let col = 0; col < G - 1; col++) {
        let tl = contourGrid[row][col];
        let tr = contourGrid[row][col + 1];
        let br = contourGrid[row + 1][col + 1];
        let bl = contourGrid[row + 1][col];
        if (tl === null || tr === null || br === null || bl === null) continue;

        let idx = (tl > level ? 8 : 0) | (tr > level ? 4 : 0) |
                  (br > level ? 2 : 0) | (bl > level ? 1 : 0);
        let segs = MS_SEGS[idx];
        if (!segs || segs.length === 0) continue;

        let x0 = scatterplotX + col * cw;
        let y0 = scatterplotY + row * ch;
        let x1 = x0 + cw;
        let y1 = y0 + ch;

        for (let [ea, eb] of segs) {
          let pa = edgePt(ea, tl, tr, br, bl, x0, y0, x1, y1, level);
          let pb = edgePt(eb, tl, tr, br, bl, x0, y0, x1, y1, level);
          line(pa.x, pa.y, pb.x, pb.y);
        }
      }
    }
  }
}

function drawContourMap(xIndex, yIndex, xRange, yRange) {
  buildContourGrid(xIndex, yIndex, xRange, yRange);
  image(contourBuf, scatterplotX, scatterplotY);
  drawContourLines();
}

function updateDataRanges(xIndex, yIndex) {
  // Use the active point set for range calculation so articles view isn't squished
  let pts = activePoints();
  let xVals = pts.map(p => p.dims[xIndex]);
  let yVals = pts.map(p => p.dims[yIndex]);
  originalXRange.min = min(xVals);
  originalXRange.max = max(xVals);
  originalYRange.min = min(yVals);
  originalYRange.max = max(yVals);
}

function detectHover(xIndex, yIndex) {
  hoverIndex = -1;
  let currentXRange = isZoomed ? zoomedXRange : originalXRange;
  let currentYRange = isZoomed ? zoomedYRange : originalYRange;
  let pts = activePoints();
  let hoverRadius = viewMode === 'articles'
    ? (isQwenCloudMode() ? 24 : 12)
    : (isQwenCloudMode() ? 9 : 6);

  for (let i = 0; i < pts.length; i++) {
    let p = pts[i];
    if (isZoomed) {
      if (p.dims[xIndex] < currentXRange.min || p.dims[xIndex] > currentXRange.max ||
          p.dims[yIndex] < currentYRange.min || p.dims[yIndex] > currentYRange.max) continue;
    }
    let x = map(p.dims[xIndex], currentXRange.min, currentXRange.max,
                scatterplotX, scatterplotX + scatterplotSize);
    let y = map(p.dims[yIndex], currentYRange.min, currentYRange.max,
                scatterplotY + scatterplotSize, scatterplotY);
    if (dist(mouseX, mouseY, x, y) < hoverRadius) {
      hoverIndex = i;
      break;
    }
  }
}

// ── populate dimension dropdowns ─────────────────────────────────────────
function populateDimensionDropdowns() {
  xDimSelect.html('');
  yDimSelect.html('');
  for (let name of allDimNames) {
    xDimSelect.option(name);
    yDimSelect.option(name);
  }
}

// ── Build article-level aggregated points ────────────────────────────────
let articlePoints = [];
function buildArticlePoints() {
  // Group sections by articleId
  let byArticle = {};
  for (let p of points) {
    if (!byArticle[p.articleId]) byArticle[p.articleId] = [];
    byArticle[p.articleId].push(p);
  }

  articlePoints = [];
  for (let aid of Object.keys(byArticle)) {
    let secs = byArticle[aid];
    let n = secs.length;

    // For spatial dims (pca, umap): average to get centroid
    // For metric dims (influence, hub): sum to get article-level aggregate
    let sumDims = new Array(allDimNames.length).fill(0);
    for (let s of secs) {
      for (let d = 0; d < s.dims.length; d++) {
        sumDims[d] += s.dims[d];
      }
    }
    let spatialDims = ['base_pca1','base_pca2','instruct_pca1','instruct_pca2','bert_umap1','bert_umap2'];
    let avgDims = sumDims.map((v, d) => spatialDims.includes(allDimNames[d]) ? v / n : v);

    // Aggregate influence metrics (sum across sections)
    let baseInf = secs.reduce((s, p) => s + p.baseInfluence, 0);
    let instrInf = secs.reduce((s, p) => s + p.instructInfluence, 0);
    let baseHub = secs.reduce((s, p) => s + p.baseHubScore, 0);
    let instrHub = secs.reduce((s, p) => s + p.instructHubScore, 0);
    let infDiff = instrInf - baseInf;

    articlePoints.push({
      articleId:         aid,
      articleTitle:      secs[0].articleTitle,
      sectionCount:      n,
      dims:              avgDims,
      baseInfluence:     baseInf,
      instructInfluence: instrInf,
      normBase:          0,  // normalized below
      normInstruct:      0,
      influenceDiff:     infDiff,
      baseHubScore:      baseHub,
      instructHubScore:  instrHub,
      qwenStats:         qwenArticleStats[String(aid)] || blankQwenStats(),
      level:             0,
    });
  }

  // Normalize influence to [0, 1]
  let maxBase = Math.max(...articlePoints.map(a => a.baseInfluence), 1e-8);
  let maxInstr = Math.max(...articlePoints.map(a => a.instructInfluence), 1e-8);
  for (let a of articlePoints) {
    a.normBase = a.baseInfluence / maxBase;
    a.normInstruct = a.instructInfluence / maxInstr;
  }
}

// ── draw labels ──────────────────────────────────────────────────────────
function drawLabels() {
  fill(0);
  textAlign(RIGHT, CENTER);
  textSize(12);
  text('Layout:', 645, 15);
  text('View:', 645, 85); 
}

// ── Level colors ─────────────────────────────────────────────────────────
const LEVEL_COLORS = {
  0: [76, 116, 190],   // steelblue  – Introduction
  2: [220, 120, 50],   // orange     – H2
  3: [80, 180, 80],    // green      – H3
  4: [180, 80, 180],   // purple     – H4
};
function levelColor(lvl) {
  let c = LEVEL_COLORS[lvl] || [150, 150, 150];
  return color(c[0], c[1], c[2]);
}

// ── Does current scoring mode show article group hotspots? ───────────────
function showsArticleGroups() {
  return selectedScoring === 'Article Groups' ||
         selectedScoring === 'Groups + Base Influence' ||
         selectedScoring === 'Groups + Instruct Influence';
}

// ── point color based on scoring mode ────────────────────────────────────
function pointColor(p) {
  switch (selectedScoring) {
    case 'Base Influence': {
      let v = constrain(p.normBase, 0, 1);
      return lerpColor(color(200, 240, 200), color(220, 20, 20), v);
    }
    case 'Instruct Influence': {
      let v = constrain(p.normInstruct, 0, 1);
      return lerpColor(color(195, 210, 242), color(20, 75, 180), v);
    }
    case 'Influence Diff': {
      // Diverging: red (base higher) → white → blue (instruct higher)
      let maxAbs = 0;
      for (let pt of points) {
        let a = abs(pt.influenceDiff);
        if (a > maxAbs) maxAbs = a;
      }
      if (maxAbs === 0) return color(255);
      let norm = p.influenceDiff / maxAbs; // [-1, 1]
      if (norm < 0) {
        return lerpColor(color(255, 255, 255), color(220, 40, 40), -norm);
      } else {
        return lerpColor(color(255, 255, 255), color(25, 95, 220), norm);
      }
    }
    case 'Base Hub Score':
    case 'Instruct Hub Score': {
      let isBase = selectedScoring === 'Base Hub Score';
      let hub = isBase ? p.baseHubScore : p.instructHubScore;
      // Diverging: gray (sink, negative) → white (neutral) → hot pink (hub, positive)
      let maxAbs = 0;
      for (let pt of points) {
        let h = isBase ? pt.baseHubScore : pt.instructHubScore;
        if (abs(h) > maxAbs) maxAbs = abs(h);
      }
      if (maxAbs === 0) return color(180);
      let norm = hub / maxAbs; // [-1, 1]
      if (norm < 0) {
        return lerpColor(color(240, 240, 240), color(80, 80, 80), -norm);
      } else {
        return lerpColor(color(240, 240, 240), color(255, 20, 100), norm);
      }
    }
    case 'Qwen Base Value Cloud':
    case 'Qwen Instruct Value Cloud':
      return qwenValueColorFromStats(activeQwenStats(p));
    case 'Qwen Base Contour':
    case 'Qwen Instruct Contour':
      return color(255); // white; actual rendering overrides this
    case 'Section Level':
      return levelColor(p.level);
    case 'Groups + Base Influence': {
      let v = constrain(p.normBase, 0, 1);
      return lerpColor(color(200, 240, 200), color(220, 20, 20), v);
    }
    case 'Groups + Instruct Influence': {
      let v = constrain(p.normInstruct, 0, 1);
      return lerpColor(color(195, 210, 242), color(20, 75, 180), v);
    }
    default: // 'Article Groups' or anything else
      return color(76, 116, 190); // steelblue
  }
}

// ── main scatterplot drawing ─────────────────────────────────────────────
function drawScatterplot(xIndex, yIndex) {
  fill(0);
  textSize(14);

  let titleSuffix = isZoomed ? ' (ZOOMED)' : '';
  let title = `${allDimNames[xIndex]} vs ${allDimNames[yIndex]}${titleSuffix}`;
  textAlign(CENTER, TOP);
  text(title, scatterplotX + scatterplotSize / 2, scatterplotY - 40);

  let currentXRange = isZoomed ? zoomedXRange : originalXRange;
  let currentYRange = isZoomed ? zoomedYRange : originalYRange;

  // ── Axes ───────────────────────────────────────────────────────────────
  stroke(80);
  strokeWeight(2);
  line(scatterplotX, scatterplotY + scatterplotSize,
       scatterplotX + scatterplotSize, scatterplotY + scatterplotSize);
  line(scatterplotX, scatterplotY, scatterplotX, scatterplotY + scatterplotSize);

  // ── Tick marks ─────────────────────────────────────────────────────────
  const SPATIAL_DIMS = new Set(['base_pca1','base_pca2','instruct_pca1','instruct_pca2','bert_umap1','bert_umap2']);
  let xIsSpatial = SPATIAL_DIMS.has(allDimNames[xIndex]);
  let yIsSpatial = SPATIAL_DIMS.has(allDimNames[yIndex]);

  textSize(10);
  noStroke();
  let numTicks = 5;
  for (let i = 0; i <= numTicks; i++) {
    let xTick = scatterplotX + (i / numTicks) * scatterplotSize;
    stroke(80);
    line(xTick, scatterplotY + scatterplotSize, xTick, scatterplotY + scatterplotSize + 6);
    if (!xIsSpatial) {
      let xValue = nf(lerp(currentXRange.min, currentXRange.max, i / numTicks), 1, 2);
      noStroke();
      fill(80);
      textAlign(CENTER, TOP);
      text(xValue, xTick, scatterplotY + scatterplotSize + 8);
    }

    let yTick = scatterplotY + scatterplotSize - (i / numTicks) * scatterplotSize;
    stroke(80);
    line(scatterplotX - 6, yTick, scatterplotX, yTick);
    if (!yIsSpatial) {
      let yValue = nf(lerp(currentYRange.min, currentYRange.max, i / numTicks), 1, 2);
      noStroke();
      fill(80);
      textAlign(RIGHT, CENTER);
      text(yValue, scatterplotX - 8, yTick);
    }
  }

  // ── Contour terrain map (draws behind points) ─────────────────────────
  if (isQwenContourMode() && !isZoomed) {
    drawContourMap(xIndex, yIndex, currentXRange, currentYRange);
  }

  // ── Article group hotspots (draw behind points, sections view only) ────
  if (viewMode === 'sections' && showsArticleGroups() && !isZoomed) {
    drawArticleHotspots(xIndex, yIndex, currentXRange, currentYRange);
  }

  // ── Points ─────────────────────────────────────────────────────────────
  if (viewMode === 'articles') {
    drawArticleView(xIndex, yIndex, currentXRange, currentYRange);
  } else {
    drawSectionView(xIndex, yIndex, currentXRange, currentYRange);
  }

  // ── Hover box ──────────────────────────────────────────────────────────
  if (hoverIndex !== -1) {
    let pts = activePoints();
    let p = pts[hoverIndex];
    strokeWeight(1);
    stroke(0);
    fill(255);

    let hoverLines;
    if (viewMode === 'articles') {
      hoverLines = [
        p.articleTitle + ` (${p.sectionCount} sections)`,
        `Base influence: ${p.baseInfluence.toFixed(2)}  |  Instruct: ${p.instructInfluence.toFixed(2)}`,
        `Hub: ${p.baseHubScore.toFixed(0)} (base)  |  ${p.instructHubScore.toFixed(0)} (instruct)`,
      ];
    } else {
      hoverLines = [
        `${p.articleTitle} > ${p.heading}`,
        `Base: ${p.baseInfluence.toFixed(3)}  |  Instruct: ${p.instructInfluence.toFixed(3)}`,
        `Hub: ${p.baseHubScore.toFixed(0)} (base)  |  ${p.instructHubScore.toFixed(0)} (instruct)`,
      ];
    }
    if (isQwenCloudMode()) {
      hoverLines = hoverLines.concat(qwenHoverLines(p));
    }

    let boxW = max(...hoverLines.map(l => textWidth(l))) + 24;
    let boxH = 14 + hoverLines.length * 16;
    let boxX = mouseX - boxW - 10;
    let boxY = mouseY - 24;
    if (boxX < 4) boxX = mouseX + 10;
    if (boxY < 4) boxY = 4;
    rect(boxX, boxY, boxW, boxH, 4);
    noStroke();
    textAlign(LEFT, TOP);
    for (let li = 0; li < hoverLines.length; li++) {
      fill(li === 0 ? 0 : li === 1 ? 80 : color(140, 40, 80));
      textSize(li === 0 ? 12 : 11);
      text(hoverLines[li], boxX + 10, boxY + 6 + li * 16);
    }
  }

  // ── Zoom out instruction ───────────────────────────────────────────────
  if (isZoomed) {
    fill(100);
    textSize(12);
    textAlign(LEFT, TOP);
    text("Click outside the plot area to zoom out", scatterplotX, scatterplotY - 20);
  }

  // ── Legend for color modes ─────────────────────────────────────────────
  drawLegend();
}

// ── Section-level point drawing (original behavior) ─────────────────────
function drawSectionView(xIndex, yIndex, currentXRange, currentYRange) {
  for (let i = 0; i < points.length; i++) {
    let p = points[i];
    if (isZoomed) {
      if (p.dims[xIndex] < currentXRange.min || p.dims[xIndex] > currentXRange.max ||
          p.dims[yIndex] < currentYRange.min || p.dims[yIndex] > currentYRange.max) continue;
    }
    let x = map(p.dims[xIndex], currentXRange.min, currentXRange.max,
                scatterplotX, scatterplotX + scatterplotSize);
    let y = map(p.dims[yIndex], currentYRange.min, currentYRange.max,
                scatterplotY + scatterplotSize, scatterplotY);

    let col;
    let showHighlight = false;
    let highlightColor, highlightSize, highlightStrokeWeight;
    let cloudMode = isQwenCloudMode();
    let qwenStats = activeQwenStats(p);
    let baseDrawSize = cloudMode ? qwenDotSize(qwenStats, false) : POINT_SIZE;

    if (hoverIndex === i) {
      col = color(255, 165, 0);
      showHighlight = true;
      highlightColor = color(255, 165, 0);
      highlightSize = baseDrawSize + 12;
      highlightStrokeWeight = 2;
    } else if (tableHoverId && String(p.id) === tableHoverId) {
      col = color(80, 200, 120);
      showHighlight = true;
      highlightColor = color(80, 200, 120);
      highlightSize = baseDrawSize + 16;
      highlightStrokeWeight = 3;
    } else if (selectedPointId && String(p.id) === selectedPointId) {
      col = color(220, 60, 20);
      showHighlight = true;
      highlightColor = color(220, 60, 20);
      highlightSize = baseDrawSize + 18;
      highlightStrokeWeight = 3;
    } else {
      col = pointColor(p);
    }

    if (showHighlight) {
      noFill();
      stroke(highlightColor);
      strokeWeight(highlightStrokeWeight);
      ellipse(x, y, highlightSize, highlightSize);
    }

    if (cloudMode && !showHighlight) {
      drawQwenCloudPoint(x, y, qwenStats, false);
    } else if (cloudMode && showHighlight) {
      drawQwenCloudPoint(x, y, qwenStats, false);
    } else if (isQwenContourMode()) {
      // Color matches the topo terrain ramp
      let tc = topoColor(getContourStats(p).valuePctile);
      stroke(20, 20, 20, 200);
      strokeWeight(0.8);
      fill(tc);
      ellipse(x, y, 6, 6);
    } else {
      noStroke();
      fill(col);
      ellipse(x, y, POINT_SIZE, POINT_SIZE);
    }
  }
}

// ── Article-level aggregated dot drawing ─────────────────────────────────
function drawArticleView(xIndex, yIndex, currentXRange, currentYRange) {
  // Dot size: proportional to sqrt(sectionCount), scaled for visibility
  let maxSections = Math.max(...articlePoints.map(a => a.sectionCount));
  let MIN_DOT = 10;
  let MAX_DOT = 40;

  for (let i = 0; i < articlePoints.length; i++) {
    let a = articlePoints[i];
    let x = map(a.dims[xIndex], currentXRange.min, currentXRange.max,
                scatterplotX, scatterplotX + scatterplotSize);
    let y = map(a.dims[yIndex], currentYRange.min, currentYRange.max,
                scatterplotY + scatterplotSize, scatterplotY);

    let cloudMode    = isQwenCloudMode();
    let contourMode  = isQwenContourMode();
    let qwenStats    = activeQwenStats(a);
    let dotSize = cloudMode ? qwenDotSize(qwenStats, true)
                : contourMode ? 12
                : map(Math.sqrt(a.sectionCount), 1, Math.sqrt(maxSections), MIN_DOT, MAX_DOT);
    let col = pointColor(a);

    // Hover highlight
    if (hoverIndex === i) {
      noFill();
      stroke(255, 165, 0);
      strokeWeight(2.5);
      ellipse(x, y, dotSize + 8, dotSize + 8);
    }

    if (cloudMode) {
      drawQwenCloudPoint(x, y, qwenStats, true);
    } else if (contourMode) {
      // Color matches the topo terrain ramp
      let tc = topoColor(getContourStats(a).valuePctile);
      stroke(20, 20, 20, 200);
      strokeWeight(1);
      fill(tc);
      ellipse(x, y, dotSize, dotSize);
    } else {
      // Main dot — semi-transparent fill with solid outline
      fill(red(col), green(col), blue(col), 180);
      stroke(red(col), green(col), blue(col));
      strokeWeight(1.5);
      ellipse(x, y, dotSize, dotSize);
    }

    // Label inside/below the dot
    noStroke();
    fill(0);
    textAlign(CENTER, CENTER);
    textSize(8);
    let lbl = a.articleTitle.length > 16 ? a.articleTitle.substring(0, 15) + '\u2026' : a.articleTitle;
    text(lbl, x, y + dotSize / 2 + 8);
  }

  textAlign(LEFT, TOP);
}

// ── Hotspot radius: use 75th-percentile of section distances, capped ─────
function articleHotspotRadius(h, xIndex, yIndex, cx, cy, currentXRange, currentYRange) {
  let secs = points.filter(p => p.articleId === h.articleId);
  if (secs.length === 0) return 15;

  let dists = [];
  for (let s of secs) {
    let sx = map(s.dims[xIndex], currentXRange.min, currentXRange.max,
                 scatterplotX, scatterplotX + scatterplotSize);
    let sy = map(s.dims[yIndex], currentYRange.min, currentYRange.max,
                 scatterplotY + scatterplotSize, scatterplotY);
    dists.push(dist(cx, cy, sx, sy));
  }
  dists.sort((a, b) => a - b);
  let p75 = dists[Math.floor(dists.length * 0.75)];
  return constrain(p75 + 6, 15, 60);
}

// ── Article hotspot rendering ────────────────────────────────────────────
function drawArticleHotspots(xIndex, yIndex, currentXRange, currentYRange) {
  let xKey, yKey;
  if (pcaMode === 'base') { xKey = 'baseX'; yKey = 'baseY'; }
  else if (pcaMode === 'instruct') { xKey = 'instructX'; yKey = 'instructY'; }
  else { xKey = 'bertX'; yKey = 'bertY'; }

  // Only render hotspots when axes match the current layout mode
  let xName = allDimNames[xIndex];
  let yName = allDimNames[yIndex];
  let expectedX, expectedY;
  if (pcaMode === 'base') { expectedX = 'base_pca1'; expectedY = 'base_pca2'; }
  else if (pcaMode === 'instruct') { expectedX = 'instruct_pca1'; expectedY = 'instruct_pca2'; }
  else { expectedX = 'bert_umap1'; expectedY = 'bert_umap2'; }
  if (xName !== expectedX || yName !== expectedY) return;

  for (let h of articleHotspots) {
    let cx = map(h[xKey], currentXRange.min, currentXRange.max,
                 scatterplotX, scatterplotX + scatterplotSize);
    let cy = map(h[yKey], currentYRange.min, currentYRange.max,
                 scatterplotY + scatterplotSize, scatterplotY);

    let radius = articleHotspotRadius(h, xIndex, yIndex, cx, cy, currentXRange, currentYRange);

    fill(255, 192, 203, 50);
    stroke(255, 105, 180, 100);
    strokeWeight(1.5);
    ellipse(cx, cy, radius * 2, radius * 2);

    // Label (truncate to 14 chars)
    noStroke();
    fill(180, 50, 100);
    textAlign(CENTER, CENTER);
    textSize(9);
    let lbl = h.label.length > 14 ? h.label.substring(0, 13) + '…' : h.label;
    text(lbl, cx, cy);
  }

  textAlign(LEFT, TOP);
}

// ── Legend ────────────────────────────────────────────────────────────────
function drawLegend() {
  let lx = scatterplotX + scatterplotSize - 160;
  let ly = scatterplotY + 10;

  if (isQwenContourMode()) {
    // Topographic gradient bar
    noStroke();
    let stops = [color(195,210,242), color(145,210,175), color(235,220,115), color(210,130,60), color(170,30,40)];
    for (let i = 0; i < 80; i++) {
      let t = i / 79;
      let seg = constrain(floor(t * (stops.length - 1)), 0, stops.length - 2);
      let segT = (t * (stops.length - 1)) - seg;
      fill(lerpColor(stops[seg], stops[seg + 1], segT));
      rect(lx + i, ly, 1, 10);
    }
    fill(0);
    textSize(9);
    textAlign(LEFT, TOP);
    text('Low', lx, ly + 13);
    textAlign(RIGHT, TOP);
    text('High', lx + 80, ly + 13);
    textAlign(CENTER, TOP);
    text('value pctile', lx + 40, ly + 13);
    // Contour line samples
    stroke(60, 40, 20, 80);
    strokeWeight(0.7);
    line(lx, ly + 30, lx + 80, ly + 30);
    stroke(60, 40, 20, 140);
    strokeWeight(1.6);
    line(lx, ly + 38, lx + 80, ly + 38);
    noStroke();
    fill(80);
    textSize(9);
    textAlign(LEFT, CENTER);
    text('minor / major contours', lx + 3, ly + 48);
    // White dot marker sample
    stroke(60, 60, 60, 140);
    strokeWeight(0.8);
    fill(255, 255, 255, 200);
    ellipse(lx + 10, ly + 62, 4, 4);
    noStroke();
    fill(80);
    textAlign(LEFT, CENTER);
    text('= data point location', lx + 18, ly + 62);
    textAlign(LEFT, TOP);
    return;
  }

  if (isQwenCloudMode()) {
    noStroke();
    for (let i = 0; i < 80; i++) {
      fill(lerpColor(color(45, 95, 190), color(220, 45, 45), i / 79));
      rect(lx + i, ly, 1, 10);
    }
    fill(0);
    textSize(9);
    textAlign(LEFT, TOP);
    text('Low value', lx, ly + 13);
    textAlign(RIGHT, TOP);
    text('High', lx + 80, ly + 13);
    textAlign(CENTER, TOP);
    text(selectedScoring.replace(' Value Cloud', ''), lx + 40, ly + 24);

    noStroke();
    fill(45, 95, 190, 22);
    ellipse(lx + 18, ly + 55, 24, 24);
    fill(45, 95, 190, 135);
    ellipse(lx + 18, ly + 55, 8, 8);
    fill(180, 70, 70, 28);
    ellipse(lx + 62, ly + 55, 44, 44);
    fill(180, 70, 70, 105);
    ellipse(lx + 62, ly + 55, 10, 10);
    fill(0);
    textAlign(CENTER, TOP);
    textSize(9);
    text('cloud = seed variance', lx + 40, ly + 78);
  } else if (selectedScoring === 'Base Influence' || selectedScoring === 'Instruct Influence' ||
      selectedScoring === 'Groups + Base Influence' || selectedScoring === 'Groups + Instruct Influence') {
    let isBase = selectedScoring === 'Base Influence' || selectedScoring === 'Groups + Base Influence';
    let lowCol = isBase ? color(200, 240, 200) : color(195, 210, 242);
    let highCol = isBase ? color(220, 20, 20) : color(20, 75, 180);

    noStroke();
    for (let i = 0; i < 80; i++) {
      fill(lerpColor(lowCol, highCol, i / 79));
      rect(lx + i, ly, 1, 10);
    }
    fill(0);
    textSize(9);
    textAlign(LEFT, TOP);
    text('Low', lx, ly + 13);
    textAlign(RIGHT, TOP);
    text('High', lx + 80, ly + 13);
    textAlign(CENTER, TOP);
    text(isBase ? 'Base Influence' : 'Instruct Influence', lx + 40, ly + 24);
  } else if (selectedScoring === 'Influence Diff') {
    noStroke();
    for (let i = 0; i < 80; i++) {
      let t = i / 79;
      let c;
      if (t < 0.5) {
        c = lerpColor(color(220, 40, 40), color(255, 255, 255), t * 2);
      } else {
        c = lerpColor(color(255, 255, 255), color(25, 95, 220), (t - 0.5) * 2);
      }
      fill(c);
      rect(lx + i, ly, 1, 10);
    }
    fill(0);
    textSize(9);
    textAlign(LEFT, TOP);
    text('Base >', lx, ly + 13);
    textAlign(RIGHT, TOP);
    text('Instruct >', lx + 80, ly + 13);
    textAlign(CENTER, TOP);
    text('Influence Diff', lx + 40, ly + 24);
  } else if (selectedScoring === 'Base Hub Score' || selectedScoring === 'Instruct Hub Score') {
    noStroke();
    for (let i = 0; i < 80; i++) {
      let t = i / 79;
      let c;
      if (t < 0.5) {
        c = lerpColor(color(80, 80, 80), color(240, 240, 240), t * 2);
      } else {
        c = lerpColor(color(240, 240, 240), color(255, 20, 100), (t - 0.5) * 2);
      }
      fill(c);
      rect(lx + i, ly, 1, 10);
    }
    fill(0);
    textSize(9);
    textAlign(LEFT, TOP);
    text('Sink', lx, ly + 13);
    textAlign(RIGHT, TOP);
    text('Hub', lx + 80, ly + 13);
    textAlign(CENTER, TOP);
    text(selectedScoring, lx + 40, ly + 24);
  } else if (selectedScoring === 'Section Level') {
    let levels = [0, 2, 3, 4];
    let labels = ['Intro', 'H2', 'H3', 'H4'];
    let bx = lx;
    for (let i = 0; i < levels.length; i++) {
      noStroke();
      fill(levelColor(levels[i]));
      ellipse(bx + 6, ly + 5, 10, 10);
      fill(0);
      textSize(9);
      textAlign(LEFT, CENTER);
      text(labels[i], bx + 14, ly + 5);
      bx += 40;
    }
  }
  textAlign(LEFT, TOP);
}

// ── keyboard interaction ──────────────────────────────────────────────────
function keyPressed() {
  if (key === ' ' && hoverIndex !== -1) {
    // Prevent default scrolling behavior
    if (document.activeElement) document.activeElement.blur();

    let pts = activePoints();
    let p = pts[hoverIndex];
    let title = p.articleTitle;
    if (!title) return;

    // Add this article to the list (avoid duplicates)
    if (!wikiMapArticles.includes(title)) {
      wikiMapArticles.push(title);
    }

    // Build URL with all accumulated articles
    let articlesParam = wikiMapArticles.map(a => encodeURIComponent(a)).join(',');
    let url = 'wikipedia-map/index.html?articles=' + articlesParam;

    if (!wikiMapWindow || wikiMapWindow.closed) {
      wikiMapWindow = window.open(url, 'wikiMap');
    } else {
      wikiMapWindow.location.href = url;
      wikiMapWindow.focus();
    }
    return false; // prevent default
  }
}

// ── mouse interaction ────────────────────────────────────────────────────
function mousePressed() {
  // Click outside scatterplot area
  if (mouseX < scatterplotX || mouseX > scatterplotX + scatterplotSize ||
      mouseY < scatterplotY || mouseY > scatterplotY + scatterplotSize) {
    if (isZoomed) {
      zoomOut();
    }
    return;
  }

  // Click on article dot (articles view) — zoom into sections
  if (viewMode === 'articles' && !isZoomed) {
    let xIndex = allDimNames.indexOf(xDimSelect.value());
    let yIndex = allDimNames.indexOf(yDimSelect.value());
    let maxSections = Math.max(...articlePoints.map(a => a.sectionCount));

    for (let i = 0; i < articlePoints.length; i++) {
      let a = articlePoints[i];
      let ax = map(a.dims[xIndex], originalXRange.min, originalXRange.max,
                   scatterplotX, scatterplotX + scatterplotSize);
      let ay = map(a.dims[yIndex], originalYRange.min, originalYRange.max,
                   scatterplotY + scatterplotSize, scatterplotY);
      let dotSize = isQwenCloudMode()
        ? qwenDotSize(activeQwenStats(a), true)
        : isQwenContourMode() ? 12
        : map(Math.sqrt(a.sectionCount), 1, Math.sqrt(maxSections), 10, 40);

      if (dist(mouseX, mouseY, ax, ay) <= dotSize / 2 + 4) {
        // Switch to sections view zoomed into this article
        zoomedFromArticles = true;
        viewMode = 'sections';
        viewModeSelect.selected('Sections');
        let fakeHotspot = { articleId: a.articleId, label: a.articleTitle };
        zoomIntoArticle(fakeHotspot, xIndex, yIndex);
        return;
      }
    }
    return;
  }

  // Click on article hotspot to zoom (sections view)
  if (viewMode === 'sections' && showsArticleGroups() && !isZoomed) {
    let xName = xDimSelect.value();
    let yName = yDimSelect.value();
    let xIndex = allDimNames.indexOf(xName);
    let yIndex = allDimNames.indexOf(yName);
    let currentXRange = originalXRange;
    let currentYRange = originalYRange;
    let xKey, yKey;
    if (pcaMode === 'base') { xKey = 'baseX'; yKey = 'baseY'; }
    else if (pcaMode === 'instruct') { xKey = 'instructX'; yKey = 'instructY'; }
    else { xKey = 'bertX'; yKey = 'bertY'; }

    let expectedX, expectedY;
    if (pcaMode === 'base') { expectedX = 'base_pca1'; expectedY = 'base_pca2'; }
    else if (pcaMode === 'instruct') { expectedX = 'instruct_pca1'; expectedY = 'instruct_pca2'; }
    else { expectedX = 'bert_umap1'; expectedY = 'bert_umap2'; }
    if (xName !== expectedX || yName !== expectedY) return;

    for (let h of articleHotspots) {
      let cx = map(h[xKey], currentXRange.min, currentXRange.max,
                   scatterplotX, scatterplotX + scatterplotSize);
      let cy = map(h[yKey], currentYRange.min, currentYRange.max,
                   scatterplotY + scatterplotSize, scatterplotY);

      let radius = articleHotspotRadius(h, xIndex, yIndex, cx, cy, currentXRange, currentYRange);

      if (dist(mouseX, mouseY, cx, cy) <= radius) {
        zoomIntoArticle(h, xIndex, yIndex);
        return;
      }
    }
  }
}

function zoomIntoArticle(hotspot, xIndex, yIndex) {
  let secs = points.filter(p => p.articleId === hotspot.articleId);
  if (secs.length === 0) return;

  let xVals = secs.map(s => s.dims[xIndex]);
  let yVals = secs.map(s => s.dims[yIndex]);
  let xPad = (max(xVals) - min(xVals)) * 0.2 || 0.01;
  let yPad = (max(yVals) - min(yVals)) * 0.2 || 0.01;

  isZoomed = true;
  zoomedHotspot = hotspot;
  zoomedXRange.min = min(xVals) - xPad;
  zoomedXRange.max = max(xVals) + xPad;
  zoomedYRange.min = min(yVals) - yPad;
  zoomedYRange.max = max(yVals) + yPad;

  console.log(`Zoomed into "${hotspot.label}" (${secs.length} sections)`);
}

function zoomOut() {
  isZoomed = false;
  zoomedHotspot = null;
  // Return to articles view if zoom came from there
  if (zoomedFromArticles) {
    viewMode = 'articles';
    viewModeSelect.selected('Articles');
    zoomedFromArticles = false;
  }
  console.log("Zoomed out to original view");
}

// ── DataTable ────────────────────────────────────────────────────────────
function populateDataTable() {
  // Columns to display
  // Include bert_umap columns if present in the CSV
  let allCols = table.columns;
  let colNames = [
    'id', 'article_title', 'section_path', 'heading', 'question',
    'base_pca1', 'base_pca2', 'instruct_pca1', 'instruct_pca2',
    ...(allCols.includes('bert_umap1') ? ['bert_umap1', 'bert_umap2'] : []),
    'base_total_influence', 'instruct_total_influence', 'influence_diff',
    'base_top_k_count', 'instruct_top_k_count',
    'base_hub_score', 'instruct_hub_score', 'level',
  ];

  let headers = colNames.slice();

  // Short display labels for headers (full name kept in title tooltip)
  const COL_LABELS = {
    'base_total_influence':    'base inf',
    'instruct_total_influence':'inst inf',
    'influence_diff':          'inf diff',
    'base_hub_score':          'base hub',
    'instruct_hub_score':      'inst hub',
    'base_top_k_count':        'base topk',
    'instruct_top_k_count':    'inst topk',
    'base_pca1':               'base pc1',
    'base_pca2':               'base pc2',
    'instruct_pca1':           'inst pc1',
    'instruct_pca2':           'inst pc2',
    'bert_umap1':              'bert u1',
    'bert_umap2':              'bert u2',
    'article_title':           'article',
    'section_path':            'section path',
  };

  let tableRows = [];
  for (let r = 0; r < table.getRowCount(); r++) {
    let row = colNames.map(c => {
      let val = table.getString(r, c);
      // Format floats to 3 decimal places
      if (['base_pca1','base_pca2','instruct_pca1','instruct_pca2',
           'bert_umap1','bert_umap2',
           'base_total_influence','instruct_total_influence','influence_diff'].includes(c)) {
        let f = parseFloat(val);
        return isNaN(f) ? val : f.toFixed(3);
      }
      return val;
    });
    tableRows.push(row);
  }

  let thead = '<thead><tr>' + headers.map(h => {
    let w = '80px';
    if (h === 'question' || h === 'section_path') w = '200px';
    else if (h === 'article_title' || h === 'heading') w = '130px';
    let label = COL_LABELS[h] || h;
    return `<th style="width:${w};min-width:${w};max-width:${w};" title="${h}">${label}</th>`;
  }).join('') + '</tr></thead>';

  let tbody = '<tbody>' + tableRows.map(row =>
    '<tr>' + row.map((cell, idx) => {
      let h = headers[idx];
      let w = '80px';
      if (h === 'question' || h === 'section_path') w = '200px';
      else if (h === 'article_title' || h === 'heading') w = '130px';
      let cls = (h === 'question' || h === 'section_path' || h === 'heading') ? ' class="question-cell"' : '';
      return `<td${cls} style="width:${w};min-width:${w};max-width:${w};" title="${cell}">${cell}</td>`;
    }).join('') + '</tr>'
  ).join('') + '</tbody>';

  $('#data-table').html(thead + tbody);

  if ($.fn.DataTable.isDataTable('#data-table')) {
    $('#data-table').DataTable().destroy();
  }

  // Columns hidden by default (togglable via the ColVis button)
  const hiddenByDefault = new Set([
    'base_pca1','base_pca2','instruct_pca1','instruct_pca2',
    'bert_umap1','bert_umap2',
    'base_top_k_count','instruct_top_k_count','level',
  ]);
  let hiddenTargets = colNames.reduce((acc, name, i) => {
    if (hiddenByDefault.has(name)) acc.push(i);
    return acc;
  }, []);

  $('#data-table').DataTable({
    scrollX: true,
    paging: true,
    pageLength: 25,
    lengthMenu: [[10, 25, 50, 100, -1], [10, 25, 50, 100, "All"]],
    select: { style: 'single' },
    dom: 'Blfrtip',
    buttons: ['colvis'],
    columnDefs: [{ visible: false, targets: hiddenTargets }],
    createdRow: function(row, data) {
      $(row).css('height', `${ROW_HEIGHT}px`);
      $(row).css('cursor', 'pointer');
      $(row).on('mouseenter', function() {
        tableHoverId = String(data[0]);
      });
      $(row).on('mouseleave', function() {
        tableHoverId = null;
      });
      $(row).on('click', function() {
        // data indices: 0=id, 1=article_title, 2=section_path, 3=heading
        selectPointAndNeighbours(data[0]);
        showWikiPopup(data[0], data[1], data[2], data[3]);
      });
    }
  });
}

// ── Wikipedia link popup ──────────────────────────────────────────────────
function buildWikiUrl(articleTitle, heading) {
  // Convert article title to Wikipedia URL format
  let titleSlug = articleTitle.replace(/ /g, '_');
  let anchor = '';
  if (heading && heading !== 'Introduction') {
    anchor = '#' + heading.replace(/ /g, '_');
  }
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(titleSlug)}${anchor}`;
}

function showWikiPopup(pointId, articleTitle, sectionPath, heading) {
  let url = buildWikiUrl(articleTitle, heading);
  let popup = document.getElementById('wiki-popup');
  document.getElementById('wiki-popup-title').textContent = articleTitle;
  document.getElementById('wiki-popup-section').textContent = sectionPath || heading;
  let link = document.getElementById('wiki-popup-link');
  link.href = url;
  link.textContent = `Open: ${articleTitle} > ${heading}`;

  // Populate nearest neighbours list
  let neighboursList = document.getElementById('wiki-popup-neighbours-list');
  let neighboursArea = document.getElementById('wiki-popup-neighbours-area');
  if (neighbourIds.length > 0) {
    neighboursList.innerHTML = neighbourIds.map(nid => {
      let np = points.find(p => String(p.id) === nid);
      if (!np) return '';
      let url = buildWikiUrl(np.articleTitle, np.heading);
      return `<li><a href="${url}" target="_blank"
                style="color:#1a73e8; text-decoration:none;"
                onmouseover="this.style.textDecoration='underline'"
                onmouseout="this.style.textDecoration='none'"
              >${np.articleTitle} &rsaquo; ${np.heading}</a></li>`;
    }).filter(Boolean).join('');
    neighboursArea.style.display = 'block';
  } else {
    neighboursArea.style.display = 'none';
  }

  // Show links area in loading state
  let linksArea    = document.getElementById('wiki-popup-links-area');
  let linksLoading = document.getElementById('wiki-popup-links-loading');
  let linksList    = document.getElementById('wiki-popup-links-list');
  linksLoading.textContent = 'Loading…';
  linksLoading.style.display = 'block';
  linksList.style.display = 'none';
  linksList.innerHTML = '';
  linksArea.style.display = 'block';

  popup.style.display = 'flex';

  fetchWikiSectionLinks(articleTitle, heading).then(links => {
    linksLoading.style.display = 'none';
    if (!links || links.length === 0) {
      linksLoading.textContent = 'No links found in this section.';
      linksLoading.style.display = 'block';
      return;
    }
    linksList.innerHTML = links.slice(0, 5).map(title => {
      let href = `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
      return `<li><a href="${href}" target="_blank" style="color:#1a73e8;">${title}</a></li>`;
    }).join('');
    linksList.style.display = 'block';
  }).catch(() => {
    linksLoading.textContent = 'Could not load links.';
    linksLoading.style.display = 'block';
  });
}

async function fetchWikiSectionLinks(articleTitle, heading) {
  let base = 'https://en.wikipedia.org/w/api.php';
  // Step 1: find the section index for this heading
  let secRes = await fetch(
    `${base}?action=parse&page=${encodeURIComponent(articleTitle)}&prop=sections&format=json&origin=*`
  );
  let secData = await secRes.json();
  let sections = (secData.parse && secData.parse.sections) || [];
  let sec = sections.find(s =>
    s.line === heading || s.anchor === heading.replace(/ /g, '_')
  );
  let sectionIdx = sec ? sec.index : '0';
  // Step 2: get rendered HTML of that section — preserves order of appearance
  let htmlRes = await fetch(
    `${base}?action=parse&page=${encodeURIComponent(articleTitle)}&section=${sectionIdx}&prop=text&format=json&origin=*`
  );
  let htmlData = await htmlRes.json();
  let html = (htmlData.parse && htmlData.parse.text && htmlData.parse.text['*']) || '';
  // Extract /wiki/ links in DOM order, skipping special namespaces
  let doc = new DOMParser().parseFromString(html, 'text/html');
  let seen = new Set();
  let links = [];
  doc.querySelectorAll('a[href^="/wiki/"]').forEach(a => {
    let href = a.getAttribute('href');
    if (/\/wiki\/(Special|File|Category|Wikipedia|Help|Template|Portal):/.test(href)) return;
    if (href.includes('#')) return;
    let title = decodeURIComponent(href.replace('/wiki/', '')).replace(/_/g, ' ');
    if (!seen.has(title)) {
      seen.add(title);
      links.push(title);
    }
  });
  return links;
}

function selectPointAndNeighbours(id) {
  selectedPointId = String(id);
  let xIdx = allDimNames.indexOf(xDimSelect.value());
  let yIdx = allDimNames.indexOf(yDimSelect.value());
  let self = points.find(p => String(p.id) === selectedPointId);
  if (!self) { neighbourIds = []; return; }

  let dists = points
    .filter(p => String(p.id) !== selectedPointId)
    .map(p => ({
      id: p.id,
      d: Math.hypot(p.dims[xIdx] - self.dims[xIdx], p.dims[yIdx] - self.dims[yIdx])
    }))
    .sort((a, b) => a.d - b.d);

  neighbourIds = dists.slice(0, 3).map(d => String(d.id));
}

// ── Locate row by ID ─────────────────────────────────────────────────────
function locateRowById(hoveredId) {
  let dt = $('#data-table').DataTable();
  let row = dt.row(function(idx, data) {
    return String(data[0]) === String(hoveredId);
  });

  if (row.any()) {
    row.select();
    let rowIndexInView = dt.rows({ order: 'applied' }).indexes().toArray().indexOf(row.index());
    let pageLength = dt.page.len();
    let pageNumber = Math.floor(rowIndexInView / pageLength);
    dt.page(pageNumber).draw('page');
    setTimeout(() => {
      let rowNode = row.node();
      if (rowNode) {
        rowNode.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 100);
  }
}
