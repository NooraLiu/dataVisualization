// ── Global state ─────────────────────────────────────────────────────────
let table;          // influence_data.csv
let hotspotTable;   // article_hotspots.csv
let points = [];
let articleHotspots = [];
let hoverIndex = -1;

// UI elements
let xDimSelect, yDimSelect, scoringSelect, pcaToggle;
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

// Scoring / color modes
let selectedScoring = 'Article Groups';

// Table sync
let lastHoveredId = null;
let tableHoverId = null;

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

  // Extract points
  for (let r = 0; r < table.getRowCount(); r++) {
    let dims = allDimNames.map(d => float(table.getString(r, d)));
    points.push({
      id:                     table.getString(r, 'id'),
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

  // ── X / Y dimension selectors ──────────────────────────────────────────
  xDimSelect = createSelect();
  yDimSelect = createSelect();
  xDimSelect.position(scatterplotX + scatterplotSize + 35, scatterplotY + scatterplotSize + 65);
  yDimSelect.position(scatterplotX - 40, scatterplotY + 30);
  xDimSelect.style('position', 'fixed');
  yDimSelect.style('position', 'fixed');
  xDimSelect.style('z-index', '1001');
  yDimSelect.style('z-index', '1001');

  populateDimensionDropdowns();
  xDimSelect.selected('base_pca1');
  yDimSelect.selected('base_pca2');

  // ── PCA layout toggle ─────────────────────────────────────────────────
  pcaToggle = createSelect();
  pcaToggle.option('Base Model');
  pcaToggle.option('Instruct Model');
  pcaToggle.option('BERT Embeddings');
  pcaToggle.selected('Base Model');
  pcaToggle.position(440, 80);
  pcaToggle.style('position', 'fixed');
  pcaToggle.style('z-index', '1001');
  pcaToggle.changed(handlePCAToggle);

  // ── Scoring / color mode selector ──────────────────────────────────────
  scoringSelect = createSelect();
  scoringSelect.option('Article Groups');
  scoringSelect.option('Base Influence');
  scoringSelect.option('Instruct Influence');
  scoringSelect.option('Influence Diff');
  scoringSelect.option('Base Hub Score');
  scoringSelect.option('Instruct Hub Score');
  scoringSelect.option('Section Level');
  scoringSelect.selected('Article Groups');
  scoringSelect.position(440, 115);
  scoringSelect.style('position', 'fixed');
  scoringSelect.style('z-index', '1001');
  scoringSelect.changed(() => { selectedScoring = scoringSelect.value(); });

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

  // Table row sync
  if (hoverIndex !== -1) {
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
function updateDataRanges(xIndex, yIndex) {
  let xVals = points.map(p => p.dims[xIndex]);
  let yVals = points.map(p => p.dims[yIndex]);
  originalXRange.min = min(xVals);
  originalXRange.max = max(xVals);
  originalYRange.min = min(yVals);
  originalYRange.max = max(yVals);
}

function detectHover(xIndex, yIndex) {
  hoverIndex = -1;
  let currentXRange = isZoomed ? zoomedXRange : originalXRange;
  let currentYRange = isZoomed ? zoomedYRange : originalYRange;

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
    if (dist(mouseX, mouseY, x, y) < 6) {
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

// ── draw labels ──────────────────────────────────────────────────────────
function drawLabels() {
  fill(0);
  textAlign(LEFT, CENTER);
  textSize(12);
  let layoutLabel = pcaToggle.value();
  if (layoutLabel === 'BERT Embeddings') layoutLabel += ' (bge-large-en-v1.5 UMAP)';
  text(`Layout: ${layoutLabel}`, 440, 70);
}

// ── Level colors ─────────────────────────────────────────────────────────
const LEVEL_COLORS = {
  0: [70, 130, 180],   // steelblue  – Introduction
  2: [220, 120, 50],   // orange     – H2
  3: [80, 180, 80],    // green      – H3
  4: [180, 80, 180],   // purple     – H4
};
function levelColor(lvl) {
  let c = LEVEL_COLORS[lvl] || [150, 150, 150];
  return color(c[0], c[1], c[2]);
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
      return lerpColor(color(200, 210, 240), color(20, 20, 180), v);
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
        return lerpColor(color(255, 255, 255), color(40, 40, 220), norm);
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
    case 'Section Level':
      return levelColor(p.level);
    default: // 'Article Groups' or anything else
      return color(70, 130, 180); // steelblue
  }
}

// ── main scatterplot drawing ─────────────────────────────────────────────
function drawScatterplot(xIndex, yIndex) {
  fill(0);
  textSize(14);

  let titleSuffix = isZoomed ? ' (ZOOMED)' : '';
  let title = `${allDimNames[xIndex]} vs ${allDimNames[yIndex]}${titleSuffix}`;
  textAlign(LEFT, TOP);
  text(title, scatterplotX + 40, scatterplotY - 40);

  let currentXRange = isZoomed ? zoomedXRange : originalXRange;
  let currentYRange = isZoomed ? zoomedYRange : originalYRange;

  // ── Axes ───────────────────────────────────────────────────────────────
  stroke(80);
  strokeWeight(2);
  line(scatterplotX, scatterplotY + scatterplotSize,
       scatterplotX + scatterplotSize, scatterplotY + scatterplotSize);
  line(scatterplotX, scatterplotY, scatterplotX, scatterplotY + scatterplotSize);

  // ── Tick marks ─────────────────────────────────────────────────────────
  textSize(10);
  noStroke();
  let numTicks = 5;
  for (let i = 0; i <= numTicks; i++) {
    let xTick = scatterplotX + (i / numTicks) * scatterplotSize;
    let xValue = nf(lerp(currentXRange.min, currentXRange.max, i / numTicks), 1, 2);
    stroke(80);
    line(xTick, scatterplotY + scatterplotSize, xTick, scatterplotY + scatterplotSize + 6);
    noStroke();
    fill(80);
    textAlign(CENTER, TOP);
    text(xValue, xTick, scatterplotY + scatterplotSize + 8);

    let yTick = scatterplotY + scatterplotSize - (i / numTicks) * scatterplotSize;
    let yValue = nf(lerp(currentYRange.min, currentYRange.max, i / numTicks), 1, 2);
    stroke(80);
    line(scatterplotX - 6, yTick, scatterplotX, yTick);
    noStroke();
    fill(80);
    textAlign(RIGHT, CENTER);
    text(yValue, scatterplotX - 8, yTick);
  }

  // ── Article group hotspots (draw behind points) ────────────────────────
  if (selectedScoring === 'Article Groups' && !isZoomed) {
    drawArticleHotspots(xIndex, yIndex, currentXRange, currentYRange);
  }

  // ── Points ─────────────────────────────────────────────────────────────
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

    if (hoverIndex === i) {
      col = color(255, 165, 0);
      showHighlight = true;
      highlightColor = color(255, 165, 0);
      highlightSize = POINT_SIZE + 10;
      highlightStrokeWeight = 2;
    } else if (tableHoverId && String(p.id) === tableHoverId) {
      col = color(80, 200, 120);
      showHighlight = true;
      highlightColor = color(80, 200, 120);
      highlightSize = POINT_SIZE + 15;
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

    noStroke();
    fill(col);
    ellipse(x, y, POINT_SIZE, POINT_SIZE);
  }

  // ── Hover box ──────────────────────────────────────────────────────────
  if (hoverIndex !== -1) {
    let p = points[hoverIndex];
    strokeWeight(1);
    stroke(0);
    fill(255);
    let line1 = `${p.articleTitle} > ${p.heading}`;
    let line2 = `Base: ${p.baseInfluence.toFixed(3)}  |  Instruct: ${p.instructInfluence.toFixed(3)}`;
    let line3 = `Hub: ${p.baseHubScore.toFixed(0)} (base)  |  ${p.instructHubScore.toFixed(0)} (instruct)`;
    let boxW = max(textWidth(line1), textWidth(line2), textWidth(line3)) + 24;
    let boxH = 58;
    let boxX = mouseX - boxW - 10;
    let boxY = mouseY - 24;
    // Keep box inside canvas
    if (boxX < 4) boxX = mouseX + 10;
    if (boxY < 4) boxY = 4;
    rect(boxX, boxY, boxW, boxH, 4);
    noStroke();
    fill(0);
    textAlign(LEFT, TOP);
    textSize(12);
    text(line1, boxX + 10, boxY + 6);
    fill(80);
    textSize(11);
    text(line2, boxX + 10, boxY + 24);
    fill(140, 40, 80);
    text(line3, boxX + 10, boxY + 38);
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

  if (selectedScoring === 'Base Influence' || selectedScoring === 'Instruct Influence') {
    let isBase = selectedScoring === 'Base Influence';
    let lowCol = isBase ? color(200, 240, 200) : color(200, 210, 240);
    let highCol = isBase ? color(220, 20, 20) : color(20, 20, 180);

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
        c = lerpColor(color(255, 255, 255), color(40, 40, 220), (t - 0.5) * 2);
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

  // Click on article hotspot to zoom
  if (selectedScoring === 'Article Groups' && !isZoomed) {
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
    return `<th style="width:${w};min-width:${w};max-width:${w};" title="${h}">${h}</th>`;
  }).join('') + '</tr></thead>';

  let tbody = '<tbody>' + tableRows.map(row =>
    '<tr>' + row.map((cell, idx) => {
      let h = headers[idx];
      let w = '80px';
      if (h === 'question' || h === 'section_path') w = '200px';
      else if (h === 'article_title' || h === 'heading') w = '130px';
      return `<td style="width:${w};min-width:${w};max-width:${w};" title="${cell}">${cell}</td>`;
    }).join('') + '</tr>'
  ).join('') + '</tbody>';

  $('#data-table').html(thead + tbody);

  if ($.fn.DataTable.isDataTable('#data-table')) {
    $('#data-table').DataTable().destroy();
  }

  $('#data-table').DataTable({
    scrollX: true,
    paging: true,
    pageLength: 25,
    lengthMenu: [[10, 25, 50, 100, -1], [10, 25, 50, 100, "All"]],
    select: { style: 'single' },
    dom: 'Blfrtip',
    buttons: ['colvis'],
    createdRow: function(row, data) {
      $(row).css('height', `${ROW_HEIGHT}px`);
      $(row).on('mouseenter', function() {
        tableHoverId = String(data[0]);
      });
      $(row).on('mouseleave', function() {
        tableHoverId = null;
      });
    }
  });
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
