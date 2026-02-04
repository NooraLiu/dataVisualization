let table;
let points = [];
let hoverIndex = -1;
let hoverCol = ''; // 'url' or 'text' when hovering

// UI elements
let xDimSelect, yDimSelect, hotspotSlider, umapToggle;
let allDimNames = [];
let scatterplotX = 60; // Left margin for scatterplot
let scatterplotY = 60; // Top margin for scatterplot
let scatterplotSize = 600; // Square size for scatterplot
let ROW_HEIGHT = 150; // Global variable for row height
let POINT_SIZE = 5; // Default point size

// Hotspot and zoom variables
let hotspots = [];
let isZoomed = false;
let zoomedHotspot = null;
let originalXRange = { min: 0, max: 1 };
let originalYRange = { min: 0, max: 1 };
let zoomedXRange = { min: 0, max: 1 };
let zoomedYRange = { min: 0, max: 1 };
let HOTSPOT_THRESHOLD = 40; // Will be controlled by slider
let MIN_CLUSTER_SIZE = 10; // Minimum number of points to form a hotspot (increased from 3)

// UMAP background variables
let umapImage;
let showUMAP = false;
let umapHotspots = []; // User-created hotspots on UMAP
let selectedUmapHotspot = -1; // Index of currently selected UMAP hotspot
let exportButton, importToggle;
let importHotspots = false;
let isDraggingHotspot = false; // Track if we're currently dragging a hotspot
let dragOffset = { x: 0, y: 0 }; // Offset from hotspot center to mouse when dragging starts
let lastClickTime = 0; // For detecting double-clicks
let showPlaceholder = false; // Track if placeholder image is being shown
let placeholderImage; // Placeholder image to display

// Question visualization variables
let showQuestions = false;
let questionToggle;

// Scoring visualization variables
let showScoring = false;
let scoringSelect;
let selectedScoring = 'Hotspots';

// Old data visualization variables
let oldTable;
let oldPoints = [];
let showOldData = false;
let oldAllDimNames = [];

// Wikipedia link matching variables
let matchedPointIndices = []; // Track which points match Wikipedia links
let lastClickedPointIndex = -1; // Track which point was last clicked for Wikipedia links

function preload() {
  table = loadTable('KZLcryPBDv.csv', 'csv', 'header');
  oldTable = loadTable('data.csv', 'csv', 'header');
  umapImage = loadImage('wikiClustersStaticVisual/wiki_umap_full.png');
  placeholderImage = loadImage('PlaceHolder.png');
}

function setup() {
  let cnv = createCanvas(800, 1000);
  cnv.parent('scatterplot-holder');
  cnv.style('position', 'relative');
  cnv.style('z-index', '1000');
  noStroke();
  textAlign(LEFT, TOP);
  textSize(12);

  // Detect all dimensions
  allDimNames = table.columns.filter(c => c.startsWith('d'));
  oldAllDimNames = oldTable.columns.filter(c => c.startsWith('d'));

  // Extract points from new CSV
  for (let r = 0; r < table.getRowCount(); r++) {
    let id = table.getString(r, 'id');
    let url = table.getString(r, 'url');
    let title = table.getString(r, 'title');
    let text = table.getString(r, 'text');
    let dims = allDimNames.map(d => float(table.getString(r, d)));
    let questionExists = table.columns.includes('QuestionExists') ? table.getString(r, 'QuestionExists') : '0';
    let u01 = table.columns.includes('u01') ? float(table.getString(r, 'u01')) : 0;
    points.push({ id, url, title, text, dims, questionExists, u01 });
  }

  // Extract points from old CSV
  for (let r = 0; r < oldTable.getRowCount(); r++) {
    let id = oldTable.getString(r, 'id');
    let url = oldTable.getString(r, 'url');
    let title = oldTable.getString(r, 'title');
    let text = oldTable.getString(r, 'text');
    let dims = oldAllDimNames.map(d => float(oldTable.getString(r, d)));
    oldPoints.push({ id, url, title, text, dims });
  }

  // Scatterplot dimension selectors
  xDimSelect = createSelect();
  yDimSelect = createSelect();

  // Position dropdowns and make them fixed
  // X selector at end of x-axis (right side)
  xDimSelect.position(scatterplotX + scatterplotSize + 35, scatterplotY + scatterplotSize + 65);
  // Y selector at end of y-axis (top)
  yDimSelect.position(scatterplotX -40, scatterplotY + 30);
  xDimSelect.style('position', 'fixed');
  yDimSelect.style('position', 'fixed');
  xDimSelect.style('z-index', '1001');
  yDimSelect.style('z-index', '1001');

  // Create hotspot threshold slider
  hotspotSlider = createSlider(20, 80, 40, 5);
  hotspotSlider.position(440, 125);
  hotspotSlider.style('position', 'fixed');
  hotspotSlider.style('z-index', '1001');
  hotspotSlider.style('width', '150px');

  // Create UMAP toggle
  umapToggle = createCheckbox('Show UMAP', false);
  umapToggle.position(630, 110);
  umapToggle.style('position', 'fixed');
  umapToggle.style('z-index', '1001');
  umapToggle.style('color', 'black');
  umapToggle.changed(toggleUMAP);

  // Create Question toggle
  questionToggle = createCheckbox('Show Questions', false);
  questionToggle.position(630, 135);
  questionToggle.style('position', 'fixed');
  questionToggle.style('z-index', '1001');
  questionToggle.style('color', 'black');
  questionToggle.changed(toggleQuestions);

  // Create scoring dropdown
  scoringSelect = createSelect();
  scoringSelect.option('Hotspots');
  scoringSelect.option('Uniqueness Score');
  scoringSelect.option('Influence Score');
  scoringSelect.option('Pagerank');
  scoringSelect.option('Total Pageviews');
  scoringSelect.selected('Hotspots');
  scoringSelect.position(630, 160);
  scoringSelect.style('position', 'fixed');
  scoringSelect.style('z-index', '1001');
  scoringSelect.changed(handleScoringChange);

  // Create export button (initially hidden)
  exportButton = createButton('Export Hotspots');
  exportButton.position(scatterplotX + 20, scatterplotY + scatterplotSize + 125);
  exportButton.style('position', 'fixed');
  exportButton.style('z-index', '1001');
  exportButton.style('display', 'none');
  exportButton.mousePressed(exportUmapHotspots);

  // Create import toggle (initially hidden)
  importToggle = createCheckbox('Import Hotspots', false);
  importToggle.position(scatterplotX + 180, scatterplotY + scatterplotSize + 132);
  importToggle.style('position', 'fixed');
  importToggle.style('z-index', '1001');
  importToggle.style('color', 'black');
  importToggle.style('display', 'none');
  importToggle.changed(toggleImport);

  // Populate dropdowns with dimension names
  populateDimensionDropdowns();
  xDimSelect.selected(allDimNames[0]);
  yDimSelect.selected(allDimNames[1]);

  // Initial population of DataTable
  populateDataTable();
}

let lastHoveredId = null; // Track the last hovered ID
let tableHoverId = null; // Track which row is hovered in the table
let oldDataHoverIndex = -1; // Track hovered point in old data

function draw() {
  background(250);
  hoverCol = '';

  let xName = xDimSelect.value();
  let yName = yDimSelect.value();

  // Use appropriate indices based on whether showing old data
  let xIndex, yIndex;
  if (showOldData) {
    xIndex = 0; // Always d1
    yIndex = 1; // Always d2
  } else {
    xIndex = allDimNames.indexOf(xName);
    yIndex = allDimNames.indexOf(yName);
  }

  // Update HOTSPOT_THRESHOLD from slider
  HOTSPOT_THRESHOLD = hotspotSlider.value();
  
  // Update selected UMAP hotspot size if one is selected (real-time control)
  if (showUMAP && selectedUmapHotspot !== -1 && selectedUmapHotspot < umapHotspots.length) {
    umapHotspots[selectedUmapHotspot].size = HOTSPOT_THRESHOLD;
  }

  // Update data ranges and hotspots when not zoomed and not in UMAP mode and not showing old data
  if (!isZoomed && !showUMAP && !showOldData) {
    updateDataRanges(xIndex, yIndex);
    detectHotspots(xIndex, yIndex);
  }

  // Detect hover only when not in UMAP mode
  if (!showUMAP && !showOldData) {
    detectHover(xIndex, yIndex);

    // Highlight the row that matches the hovered point's id
    if (hoverIndex !== -1) {
      let hoveredId = points[hoverIndex].id;

      // Only call locateRowById if the hovered ID has changed
      if (hoveredId !== lastHoveredId) {
        console.log(`Hovered ID: ${hoveredId}`);
        locateRowById(hoveredId);
        lastHoveredId = hoveredId; // Update the last hovered ID
      }
    } else {
      lastHoveredId = null; // Reset when no point is hovered
    }
  }
  
  // Detect hover on old data points
  if (showOldData && showPlaceholder) {
    detectOldDataHover(xIndex, yIndex);
  }

  drawScatterplot(xIndex, yIndex);
  drawSliderLabel();
  
  // Handle hotspot dragging
  if (showUMAP && isDraggingHotspot && selectedUmapHotspot !== -1) {
    handleHotspotDragging();
  }
}

function detectHover(xIndex, yIndex) {
  hoverIndex = -1; // Reset hoverIndex

  let xVals = points.map(p => p.dims[xIndex]);
  let yVals = points.map(p => p.dims[yIndex]);
  
  let currentXRange = isZoomed ? zoomedXRange : originalXRange;
  let currentYRange = isZoomed ? zoomedYRange : originalYRange;

  for (let i = 0; i < points.length; i++) {
    let p = points[i];
    
    // Skip points outside current zoom range
    if (isZoomed) {
      if (p.dims[xIndex] < currentXRange.min || p.dims[xIndex] > currentXRange.max ||
          p.dims[yIndex] < currentYRange.min || p.dims[yIndex] > currentYRange.max) {
        continue;
      }
    }
    
    let x = map(p.dims[xIndex], currentXRange.min, currentXRange.max, scatterplotX, scatterplotX + scatterplotSize);
    let y = map(p.dims[yIndex], currentYRange.min, currentYRange.max, scatterplotY + scatterplotSize, scatterplotY);

    if (dist(mouseX, mouseY, x, y) < 6) {
      hoverIndex = i;
      break;
    }
  }
}

function detectOldDataHover(xIndex, yIndex) {
  oldDataHoverIndex = -1; // Reset hover index
  
  for (let i = 0; i < oldPoints.length; i++) {
    let p = oldPoints[i];
    
    let x = map(p.dims[xIndex], min(oldPoints.map(pt => pt.dims[xIndex])), max(oldPoints.map(pt => pt.dims[xIndex])), scatterplotX, scatterplotX + scatterplotSize);
    let y = map(p.dims[yIndex], min(oldPoints.map(pt => pt.dims[yIndex])), max(oldPoints.map(pt => pt.dims[yIndex])), scatterplotY + scatterplotSize, scatterplotY);
    
    if (dist(mouseX, mouseY, x, y) < 6) {
      oldDataHoverIndex = i;
      break;
    }
  }
}

function updateDataRanges(xIndex, yIndex) {
  let xVals = points.map(p => p.dims[xIndex]);
  let yVals = points.map(p => p.dims[yIndex]);
  
  originalXRange.min = min(xVals);
  originalXRange.max = max(xVals);
  originalYRange.min = min(yVals);
  originalYRange.max = max(yVals);
}

function detectHotspots(xIndex, yIndex) {
  hotspots = [];
  let clusteredPoints = new Set();
  
  for (let i = 0; i < points.length; i++) {
    if (clusteredPoints.has(i)) continue;
    
    let cluster = [i];
    let centerX = map(points[i].dims[xIndex], originalXRange.min, originalXRange.max, scatterplotX, scatterplotX + scatterplotSize);
    let centerY = map(points[i].dims[yIndex], originalYRange.min, originalYRange.max, scatterplotY + scatterplotSize, scatterplotY);
    
    // Find nearby points
    for (let j = i + 1; j < points.length; j++) {
      if (clusteredPoints.has(j)) continue;
      
      let x = map(points[j].dims[xIndex], originalXRange.min, originalXRange.max, scatterplotX, scatterplotX + scatterplotSize);
      let y = map(points[j].dims[yIndex], originalYRange.min, originalYRange.max, scatterplotY + scatterplotSize, scatterplotY);
      
      if (dist(centerX, centerY, x, y) < HOTSPOT_THRESHOLD) {
        cluster.push(j);
        clusteredPoints.add(j);
      }
    }
    
    // Create hotspot if cluster is large enough
    if (cluster.length >= MIN_CLUSTER_SIZE) {
      clusteredPoints.add(i);
      
      // Calculate hotspot bounds
      let clusterXVals = cluster.map(idx => points[idx].dims[xIndex]);
      let clusterYVals = cluster.map(idx => points[idx].dims[yIndex]);
      
      let hotspot = {
        centerX: centerX,
        centerY: centerY,
        radius: HOTSPOT_THRESHOLD,
        pointIndices: cluster,
        dataXRange: { min: min(clusterXVals), max: max(clusterXVals) },
        dataYRange: { min: min(clusterYVals), max: max(clusterYVals) }
      };
      
      hotspots.push(hotspot);
    }
  }
}

// --- Scatterplot ---
function drawScatterplot(xIndex, yIndex) {
  fill(0);
  textSize(14);
  
  // Use appropriate data source and title
  let currentPoints = showOldData ? oldPoints : points;
  let currentDimNames = showOldData ? oldAllDimNames : allDimNames;
  
  let title;
  if (isZoomed) {
    title = `Scatterplot: ${allDimNames[xIndex]} vs ${allDimNames[yIndex]} (ZOOMED)`;
  } else {
    title = `Scatterplot: ${allDimNames[xIndex]} vs ${allDimNames[yIndex]}`;
  }
  text(title, scatterplotX+40, scatterplotY - 40);

  let currentXRange = isZoomed ? zoomedXRange : originalXRange;
  let currentYRange = isZoomed ? zoomedYRange : originalYRange;

  // --- Draw UMAP background (if enabled) - draw first so it's behind everything ---
  if (showUMAP && umapImage) {
    drawUMAPBackground();
  }

  // --- Draw axes ---
  stroke(80);
  strokeWeight(2);
  // X axis
  line(scatterplotX, scatterplotY + scatterplotSize, scatterplotX + scatterplotSize, scatterplotY + scatterplotSize);
  // Y axis
  line(scatterplotX, scatterplotY, scatterplotX, scatterplotY + scatterplotSize);

  // --- Draw tick marks and labels ---
  textSize(10);
  noStroke();
  let numTicks = 5;
  for (let i = 0; i <= numTicks; i++) {
    // X axis ticks
    let xTick = scatterplotX + (i / numTicks) * scatterplotSize;
    let xValue = nf(lerp(currentXRange.min, currentXRange.max, i / numTicks), 1, 2);
    stroke(80);
    line(xTick, scatterplotY + scatterplotSize, xTick, scatterplotY + scatterplotSize + 6);
    noStroke();
    fill(80);
    textAlign(CENTER, TOP);
    text(xValue, xTick, scatterplotY + scatterplotSize + 8);

    // Y axis ticks
    let yTick = scatterplotY + scatterplotSize - (i / numTicks) * scatterplotSize;
    let yValue = nf(lerp(currentYRange.min, currentYRange.max, i / numTicks), 1, 2);
    stroke(80);
    line(scatterplotX - 6, yTick, scatterplotX, yTick);
    noStroke();
    fill(80);
    textAlign(RIGHT, CENTER);
    text(yValue, scatterplotX - 8, yTick);
  }

  // --- Axis labels ---
  // Labels are now replaced by dropdown selectors, so we don't draw text here anymore
  /*
  textSize(12);
  fill(0);
  textAlign(CENTER, TOP);
  text(allDimNames[xIndex], scatterplotX + scatterplotSize / 2, scatterplotY + scatterplotSize + 32);
  textAlign(RIGHT, CENTER);
  text(allDimNames[yIndex], scatterplotX - 32, scatterplotY + scatterplotSize / 2);
  */

  // --- Draw hotspots (only when not zoomed and UMAP is off and questions mode is off and scoring mode is off) ---
  if (!isZoomed && !showUMAP && !showQuestions && !showScoring && hotspots.length > 0) {
    drawHotspots();
  }

  // --- Draw UMAP hotspots (only when UMAP is on) ---
  if (showUMAP) {
    drawUmapHotspots();
  }

  // --- Draw placeholder image overlay (when activated) ---
  if (showPlaceholder && placeholderImage) {
    drawPlaceholderOverlay();
  }
  
  // --- Draw old data points on top of placeholder ---
  if (showOldData && showPlaceholder) {
    for (let i = 0; i < oldPoints.length; i++) {
      let p = oldPoints[i];
      
      let x = map(p.dims[xIndex], min(oldPoints.map(pt => pt.dims[xIndex])), max(oldPoints.map(pt => pt.dims[xIndex])), scatterplotX, scatterplotX + scatterplotSize);
      let y = map(p.dims[yIndex], min(oldPoints.map(pt => pt.dims[yIndex])), max(oldPoints.map(pt => pt.dims[yIndex])), scatterplotY + scatterplotSize, scatterplotY);

      // Draw the point
      noStroke();
      fill('steelblue');
      ellipse(x, y, POINT_SIZE, POINT_SIZE);
    }
  }

  // --- Draw points (only when UMAP is off) ---
  if (!showUMAP && !showOldData) {
    for (let i = 0; i < points.length; i++) {
      let p = points[i];
      
      // Skip points outside current zoom range
      if (isZoomed) {
        if (p.dims[xIndex] < currentXRange.min || p.dims[xIndex] > currentXRange.max ||
            p.dims[yIndex] < currentYRange.min || p.dims[yIndex] > currentYRange.max) {
          continue;
        }
      }
      
      let x = map(p.dims[xIndex], currentXRange.min, currentXRange.max, scatterplotX, scatterplotX + scatterplotSize);
      let y = map(p.dims[yIndex], currentYRange.min, currentYRange.max, scatterplotY + scatterplotSize, scatterplotY);

      // Determine point color and highlight based on hover state
      let pointColor;
      let showHighlight = false;
      let highlightColor;
      let highlightSize;
      let highlightStrokeWeight;

      if (showQuestions) {
        // Question visualization mode: color based on QuestionExists column
        if (hoverIndex === i) {
          // Scatterplot hover
          pointColor = p.questionExists !== '0' ? 'orange' : color(150, 150, 150);
          showHighlight = true;
          highlightColor = p.questionExists !== '0' ? color(255, 165, 0) : color(100, 100, 100);
          highlightSize = POINT_SIZE + 10;
          highlightStrokeWeight = 2;
        } else if (tableHoverId && String(p.id) === tableHoverId) {
          // Table row hover
          pointColor = color(80, 200, 120); // Green
          showHighlight = true;
          highlightColor = color(80, 200, 120); // Green
          highlightSize = POINT_SIZE + 15;
          highlightStrokeWeight = 3;
        } else {
          // Default: orange if question exists, grey otherwise
          pointColor = p.questionExists !== '0' ? color(255, 165, 0) : color(150, 150, 150);
          // Add circle around orange points to make them more obvious
          if (p.questionExists !== '0') {
            showHighlight = true;
            highlightColor = color(255, 165, 0);
            highlightSize = POINT_SIZE + 6;
            highlightStrokeWeight = 1;
          }
        }
      } else if (showScoring && selectedScoring === 'Uniqueness Score') {
        // Uniqueness Score visualization mode: color based on u01 value (0=green, 1=red)
        let u01Value = constrain(p.u01, 0, 1);
        let greenAmount = (1 - u01Value) * 255;
        let redAmount = u01Value * 255;
        
        if (hoverIndex === i) {
          // Scatterplot hover
          pointColor = color(redAmount, greenAmount, 0);
          showHighlight = true;
          highlightColor = color(redAmount, greenAmount, 0);
          highlightSize = POINT_SIZE + 10;
          highlightStrokeWeight = 2;
        } else if (tableHoverId && String(p.id) === tableHoverId) {
          // Table row hover
          pointColor = color(80, 200, 120); // Green
          showHighlight = true;
          highlightColor = color(80, 200, 120); // Green
          highlightSize = POINT_SIZE + 15;
          highlightStrokeWeight = 3;
        } else {
          // Default: gradient from green (0) to red (1)
          pointColor = color(redAmount, greenAmount, 0);
        }
      } else {
        // Normal mode
        if (hoverIndex === i) {
          // Scatterplot hover
          pointColor = 'orange';
          showHighlight = true;
          highlightColor = color(255, 165, 0); // Orange
          highlightSize = POINT_SIZE + 10;
          highlightStrokeWeight = 2;
        } else if (tableHoverId && String(p.id) === tableHoverId) {
          // Table row hover
          pointColor = color(80, 200, 120); // Green
          showHighlight = true;
          highlightColor = color(80, 200, 120); // Green
          highlightSize = POINT_SIZE + 15;
          highlightStrokeWeight = 3;
        } else if (matchedPointIndices.includes(i)) {
          // Wikipedia link match - highlight in purple
          pointColor = color(147, 51, 234); // Purple
          showHighlight = true;
          highlightColor = color(147, 51, 234); // Purple
          highlightSize = POINT_SIZE + 12;
          highlightStrokeWeight = 3;
        } else {
          // Default
          pointColor = 'steelblue';
        }
      }

      // Draw highlight circle if needed
      if (showHighlight) {
        noFill();
        stroke(highlightColor);
        strokeWeight(highlightStrokeWeight);
        ellipse(x, y, highlightSize, highlightSize);
      }

      // Draw the actual point with the determined color
      noStroke();
      fill(pointColor);
      ellipse(x, y, POINT_SIZE, POINT_SIZE);
    }
  }

  // --- Hover box logic (reset strokeWeight and stroke) ---
  if (!showUMAP && hoverIndex !== -1 && hoverCol === '' && !showOldData) {
    let p = points[hoverIndex];
    strokeWeight(1); // Thin border
    stroke(0);       // Black border
    fill(255);
    let boxWidth = min(textWidth(p.title) + 20, 400);
    let boxHeight = 30;
    // Position box to the left of the mouse
    let boxX = mouseX - boxWidth - 10;
    let boxY = mouseY - 20;
    rect(boxX, boxY, boxWidth, boxHeight);
    noStroke();
    fill(0);
    textAlign(LEFT, CENTER);
    // Position text with padding inside the box
    text(p.title, boxX + 10, boxY + boxHeight/2);
  }
  
  // --- Hover box for old data points ---
  if (showOldData && oldDataHoverIndex !== -1) {
    let p = oldPoints[oldDataHoverIndex];
    strokeWeight(1); // Thin border
    stroke(0);       // Black border
    fill(255);
    let boxWidth = min(textWidth(p.title) + 20, 400);
    let boxHeight = 30;
    // Position box to the left of the mouse
    let boxX = mouseX - boxWidth - 10;
    let boxY = mouseY - 20;
    rect(boxX, boxY, boxWidth, boxHeight);
    noStroke();
    fill(0);
    textAlign(LEFT, CENTER);
    // Position text with padding inside the box
    text(p.title, boxX + 10, boxY + boxHeight/2);
  }

  // --- Draw zoom out instruction when zoomed ---
  if (isZoomed) {
    fill(100);
    textSize(12);
    textAlign(LEFT, TOP);
    text("Click outside the plot area to zoom out", scatterplotX, scatterplotY - 20);
  }
}

function drawHotspots() {
  for (let hotspot of hotspots) {
    // Draw semi-transparent pink circle
    fill(255, 192, 203, 100); // Pink with transparency
    stroke(255, 105, 180, 150); // Darker pink border
    strokeWeight(2);
    ellipse(hotspot.centerX, hotspot.centerY, hotspot.radius * 2, hotspot.radius * 2);
    
    // Draw number of points in the hotspot
    fill(255, 105, 180);
    noStroke();
    textAlign(CENTER, CENTER);
    textSize(10);
    text(hotspot.pointIndices.length, hotspot.centerX, hotspot.centerY);
  }
  
  // Reset text alignment to default for other text elements
  textAlign(LEFT, TOP);
}

function mousePressed() {
  // If placeholder is showing, click inside shows old data overlay, click outside closes it
  if (showPlaceholder) {
    if (mouseX >= scatterplotX && mouseX <= scatterplotX + scatterplotSize &&
        mouseY >= scatterplotY && mouseY <= scatterplotY + scatterplotSize) {
      // Click inside placeholder - show old data overlay
      showOldData = true;
      console.log("Showing old data.csv scatterplot (d1 vs d2) over placeholder");
      return;
    } else {
      // Click outside - close placeholder and old data
      showPlaceholder = false;
      showOldData = false;
      console.log("Closed placeholder image");
      return;
    }
  }
  
  // If showing old data, click outside closes it and placeholder
  if (showOldData) {
    if (mouseX < scatterplotX || mouseX > scatterplotX + scatterplotSize || 
        mouseY < scatterplotY || mouseY > scatterplotY + scatterplotSize) {
      showOldData = false;
      showPlaceholder = false;
      console.log("Closed old data view and placeholder");
      return;
    }
  }
  
  // Don't process mouse events if they're on UI elements
  if (mouseX < scatterplotX || mouseX > scatterplotX + scatterplotSize || 
      mouseY < scatterplotY || mouseY > scatterplotY + scatterplotSize) {
    // Only deselect if we're clearly outside the scatterplot area and not on UI controls
    if (showUMAP && mouseY > scatterplotY + scatterplotSize + 30) { // Give some buffer for UI elements
      selectedUmapHotspot = -1;
      console.log("Deselected hotspot - clicked outside plot area");
    } else if (!showUMAP && isZoomed) {
      zoomOut();
    }
    return;
  }

  // Check if click is within scatterplot area
  if (mouseX >= scatterplotX && mouseX <= scatterplotX + scatterplotSize &&
      mouseY >= scatterplotY && mouseY <= scatterplotY + scatterplotSize) {
    
    // Don't allow interactions when placeholder is showing
    if (showPlaceholder) {
      return;
    }
    
    if (showUMAP) {
      // UMAP mode: handle hotspot creation and selection
      if (!importHotspots) {
        // Check if clicking on existing UMAP hotspot
        let clickedHotspot = -1;
        let clickedOnLabel = false;
        for (let i = 0; i < umapHotspots.length; i++) {
          let hotspot = umapHotspots[i];
          if (dist(mouseX, mouseY, hotspot.x, hotspot.y) <= hotspot.size) {
            clickedHotspot = i;
            
            // Check if click is specifically on the label text area (center of hotspot)
            if (dist(mouseX, mouseY, hotspot.x, hotspot.y) <= 15) {
              clickedOnLabel = true;
            }
            break;
          }
        }
        
        if (clickedHotspot !== -1) {
          // Check for double-click on label
          let currentTime = millis();
          if (clickedOnLabel && currentTime - lastClickTime < 300 && selectedUmapHotspot === clickedHotspot) {
            // Double-click on label - prompt for new label
            editHotspotLabel(clickedHotspot);
            lastClickTime = 0; // Reset to prevent triple-click
            return;
          }
          lastClickTime = currentTime;
          
          // Select existing hotspot and update slider to match its size
          selectedUmapHotspot = clickedHotspot;
          hotspotSlider.value(umapHotspots[clickedHotspot].size); // Set slider to match hotspot size
          
          // Prepare for potential dragging
          isDraggingHotspot = true;
          dragOffset.x = mouseX - umapHotspots[clickedHotspot].x;
          dragOffset.y = mouseY - umapHotspots[clickedHotspot].y;
          
          console.log(`Selected UMAP hotspot ${clickedHotspot + 1} with size ${umapHotspots[clickedHotspot].size}px`);
        } else {
          // Create new hotspot with current slider value
          let newHotspot = {
            x: mouseX,
            y: mouseY,
            size: HOTSPOT_THRESHOLD,  // Use current slider value
            label: `H${umapHotspots.length + 1}`  // Default label
          };
          umapHotspots.push(newHotspot);
          selectedUmapHotspot = umapHotspots.length - 1; // Auto-select the newly created hotspot
          
          // Prepare for potential dragging of the new hotspot
          isDraggingHotspot = true;
          dragOffset.x = 0; // Mouse is at center of new hotspot
          dragOffset.y = 0;
          
          console.log(`Created new UMAP hotspot at (${mouseX}, ${mouseY}) with size ${HOTSPOT_THRESHOLD}px - automatically selected for slider control`);
          console.log(`Selected hotspot index: ${selectedUmapHotspot}, Total hotspots: ${umapHotspots.length}`);
        }
      }
    } else {
      // Original mode: handle data point hotspots or individual points
      if (!isZoomed) {
        // Check if click is on a hotspot
        for (let hotspot of hotspots) {
          if (dist(mouseX, mouseY, hotspot.centerX, hotspot.centerY) <= hotspot.radius) {
            zoomIntoHotspot(hotspot);
            return;
          }
        }
      }
      
      // Check if clicking on an individual point to get Wikipedia links
      let xName = xDimSelect.value();
      let yName = yDimSelect.value();
      let xIndex = allDimNames.indexOf(xName);
      let yIndex = allDimNames.indexOf(yName);
      let currentXRange = isZoomed ? zoomedXRange : originalXRange;
      let currentYRange = isZoomed ? zoomedYRange : originalYRange;
      
      for (let i = 0; i < points.length; i++) {
        let p = points[i];
        
        // Skip points outside current zoom range
        if (isZoomed) {
          if (p.dims[xIndex] < currentXRange.min || p.dims[xIndex] > currentXRange.max ||
              p.dims[yIndex] < currentYRange.min || p.dims[yIndex] > currentYRange.max) {
            continue;
          }
        }
        
        let x = map(p.dims[xIndex], currentXRange.min, currentXRange.max, scatterplotX, scatterplotX + scatterplotSize);
        let y = map(p.dims[yIndex], currentYRange.min, currentYRange.max, scatterplotY + scatterplotSize, scatterplotY);

        if (dist(mouseX, mouseY, x, y) < 10) {
          // Point clicked - check if it's the same point as before
          if (lastClickedPointIndex === i) {
            // Same point clicked again - turn off visualization
            console.log('Turning off Wikipedia link visualization');
            matchedPointIndices = [];
            lastClickedPointIndex = -1;
            return;
          }
          
          // Different point - fetch Wikipedia links
          lastClickedPointIndex = i;
          console.log('Clicked on:', p.title);
          console.log('Fetching Wikipedia links for:', p.title);
          getSubPages(p.title).then(({ redirectedTo, links }) => {
            console.log('Article (after redirect):', redirectedTo);
            console.log('First paragraph links:', links);
            console.log('Number of links:', links.length);
            
            // Check for matches in dataset
            matchedPointIndices = []; // Clear previous matches
            let matchedTitles = [];
            
            for (let j = 0; j < points.length; j++) {
              let pointTitle = points[j].title.toLowerCase().trim();
              
              // Check if any Wikipedia link matches this point's title
              for (let link of links) {
                let linkLower = link.toLowerCase().trim();
                if (pointTitle === linkLower || pointTitle.includes(linkLower) || linkLower.includes(pointTitle)) {
                  matchedPointIndices.push(j);
                  matchedTitles.push(points[j].title);
                  break; // Found a match for this point, move to next point
                }
              }
            }
            
            // Console output
            console.log('---');
            if (matchedPointIndices.length > 0) {
              console.log(`✓ Found ${matchedPointIndices.length} matching points in dataset:`);
              matchedTitles.forEach((title, idx) => {
                console.log(`  ${idx + 1}. ${title}`);
              });
            } else {
              console.log('✗ No matching points found in dataset');
            }
            console.log('---');
          }).catch(err => {
            console.error('Error fetching Wikipedia links:', err);
          });
          return;
        }
      }
    }
  }
}

function mouseReleased() {
  // Stop dragging when mouse is released
  if (isDraggingHotspot) {
    isDraggingHotspot = false;
    console.log("Stopped dragging hotspot");
  }
}

function keyPressed() {
  // Delete selected hotspot when Backspace key is pressed
  if (showUMAP && selectedUmapHotspot !== -1 && keyCode === BACKSPACE && !showPlaceholder) {
    let deletedIndex = selectedUmapHotspot;
    umapHotspots.splice(selectedUmapHotspot, 1);
    selectedUmapHotspot = -1; // Clear selection after deletion
    console.log(`Deleted UMAP hotspot ${deletedIndex + 1}. Remaining hotspots: ${umapHotspots.length}`);
  }
  
  // Show placeholder image when Enter key is pressed on selected hotspot
  if (showUMAP && selectedUmapHotspot !== -1 && keyCode === ENTER && !showPlaceholder) {
    showPlaceholder = true;
    console.log(`Showing placeholder image for hotspot ${selectedUmapHotspot + 1}`);
  }
}

function handleHotspotDragging() {
  // Update hotspot position while dragging, constrained to scatterplot area
  if (selectedUmapHotspot < umapHotspots.length) {
    let newX = mouseX - dragOffset.x;
    let newY = mouseY - dragOffset.y;
    
    // Constrain to scatterplot boundaries
    newX = constrain(newX, scatterplotX, scatterplotX + scatterplotSize);
    newY = constrain(newY, scatterplotY, scatterplotY + scatterplotSize);
    
    umapHotspots[selectedUmapHotspot].x = newX;
    umapHotspots[selectedUmapHotspot].y = newY;
  }
}

function zoomIntoHotspot(hotspot) {
  isZoomed = true;
  zoomedHotspot = hotspot;
  
  // Add some padding around the hotspot data range
  let xPadding = (hotspot.dataXRange.max - hotspot.dataXRange.min) * 0.1;
  let yPadding = (hotspot.dataYRange.max - hotspot.dataYRange.min) * 0.1;
  
  zoomedXRange.min = hotspot.dataXRange.min - xPadding;
  zoomedXRange.max = hotspot.dataXRange.max + xPadding;
  zoomedYRange.min = hotspot.dataYRange.min - yPadding;
  zoomedYRange.max = hotspot.dataYRange.max + yPadding;
  
  console.log(`Zoomed into hotspot with ${hotspot.pointIndices.length} points`);
}

function zoomOut() {
  isZoomed = false;
  zoomedHotspot = null;
  console.log("Zoomed out to original view");
}

function drawSliderLabel() {
  // Draw label for the hotspot slider
  fill(0);
  textAlign(LEFT, CENTER);
  textSize(12);
  let labelText = `Hotspot Size: ${HOTSPOT_THRESHOLD}px`;
  
  text(labelText, 460, 70);
}

function toggleUMAP() {
  showUMAP = umapToggle.checked();
  console.log('UMAP background:', showUMAP ? 'ON' : 'OFF');
  
  // Turn off Questions and U01 when UMAP is enabled
  if (showUMAP) {
    if (showQuestions) {
      showQuestions = false;
      questionToggle.checked(false);
    }
    if (showScoring) {
      showScoring = false;
      scoringSelect.selected('None');
    }
    exportButton.style('display', 'block');
    importToggle.style('display', 'block');
  } else {
    exportButton.style('display', 'none');
    importToggle.style('display', 'none');
    selectedUmapHotspot = -1; // Clear selection when UMAP is turned off
  }
}

function drawUMAPBackground() {
  // Draw the UMAP image to fit exactly within the scatterplot area
  // The image will be drawn behind everything else (axes, points, hotspots will be on top)
  tint(255, 180); // Make it slightly transparent so axes and points are visible
  image(umapImage, scatterplotX, scatterplotY, scatterplotSize, scatterplotSize);
  noTint(); // Reset tint for other elements
}

function drawUmapHotspots() {
  // Only show hotspots when import is ON, or when import is OFF (creation mode)
  // This means hotspots are always visible in creation mode, and only visible in import mode when toggled
  if (!importHotspots || importToggle.checked()) {
    for (let i = 0; i < umapHotspots.length; i++) {
      let hotspot = umapHotspots[i];
      
      // Determine if this hotspot is selected
      let isSelected = (selectedUmapHotspot === i);
      
      // Draw orange hotspot circle
      fill(255, 165, 0, 100); // Orange with transparency
      stroke(255, 140, 0, isSelected ? 255 : 150); // Darker orange border, brighter if selected
      strokeWeight(isSelected ? 4 : 2); // Thicker border if selected
      ellipse(hotspot.x, hotspot.y, hotspot.size * 2, hotspot.size * 2);
      
      // Draw hotspot label
      fill(200, 80, 0); // Deeper orange for better readability
      noStroke();
      textAlign(CENTER, CENTER);
      textSize(12);
      textStyle(BOLD);
      let label = hotspot.label || `H${i + 1}`; // Use custom label or default
      text(label, hotspot.x, hotspot.y);
      textStyle(NORMAL); // Reset to normal style
    }
  }
  
  // Reset text alignment
  textAlign(LEFT, TOP);
}

function toggleImport() {
  importHotspots = importToggle.checked();
  console.log('Import hotspots:', importHotspots ? 'ON' : 'OFF');
  
  if (importHotspots) {
    loadUmapHotspots();
  }
}

function exportUmapHotspots() {
  if (umapHotspots.length === 0) {
    console.log('No hotspots to export');
    return;
  }
  
  // Create CSV content
  let csvContent = 'id,x,y,size,label\n';
  for (let i = 0; i < umapHotspots.length; i++) {
    let hotspot = umapHotspots[i];
    // Convert screen coordinates to relative coordinates (0-1)
    let relX = (hotspot.x - scatterplotX) / scatterplotSize;
    let relY = (hotspot.y - scatterplotY) / scatterplotSize;
    let label = hotspot.label || `H${i + 1}`;
    csvContent += `${i + 1},${relX.toFixed(4)},${relY.toFixed(4)},${hotspot.size},"${label}"\n`;
  }
  
  // Create and download the file
  let blob = new Blob([csvContent], { type: 'text/csv' });
  let url = URL.createObjectURL(blob);
  let a = document.createElement('a');
  a.href = url;
  a.download = 'umap_hotspots.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  console.log(`Exported ${umapHotspots.length} hotspots to umap_hotspots.csv`);
}

function loadUmapHotspots() {
  // Create a file input element
  let input = document.createElement('input');
  input.type = 'file';
  input.accept = '.csv';
  
  input.onchange = function(event) {
    let file = event.target.files[0];
    if (!file) return;
    
    let reader = new FileReader();
    reader.onload = function(e) {
      let csvContent = e.target.result;
      parseUmapHotspots(csvContent);
    };
    reader.readAsText(file);
  };
  
  input.click();
}

function parseUmapHotspots(csvContent) {
  let lines = csvContent.trim().split('\n');
  if (lines.length < 2) {
    console.log('Invalid CSV file');
    return;
  }
  
  // Clear existing hotspots
  umapHotspots = [];
  
  // Parse CSV (skip header)
  for (let i = 1; i < lines.length; i++) {
    // Handle CSV with quoted labels
    let match = lines[i].match(/^([^,]+),([^,]+),([^,]+),([^,]+),"?([^"]*)"?$/);
    if (match) {
      let relX = parseFloat(match[2]);
      let relY = parseFloat(match[3]);
      let size = parseFloat(match[4]);
      let label = match[5] || `H${i}`;
      
      // Convert relative coordinates back to screen coordinates
      let x = scatterplotX + relX * scatterplotSize;
      let y = scatterplotY + relY * scatterplotSize;
      
      umapHotspots.push({ x: x, y: y, size: size, label: label });
    } else {
      // Fallback for old CSV format without labels
      let parts = lines[i].split(',');
      if (parts.length >= 4) {
        let relX = parseFloat(parts[1]);
        let relY = parseFloat(parts[2]);
        let size = parseFloat(parts[3]);
        
        // Convert relative coordinates back to screen coordinates
        let x = scatterplotX + relX * scatterplotSize;
        let y = scatterplotY + relY * scatterplotSize;
        
        umapHotspots.push({ x: x, y: y, size: size, label: `H${i}` });
      }
    }
  }
  
  console.log(`Loaded ${umapHotspots.length} hotspots from CSV`);
}

function editHotspotLabel(hotspotIndex) {
  if (hotspotIndex < 0 || hotspotIndex >= umapHotspots.length) return;
  
  let currentLabel = umapHotspots[hotspotIndex].label || `H${hotspotIndex + 1}`;
  let newLabel = prompt('Enter custom label for this hotspot:', currentLabel);
  
  if (newLabel !== null && newLabel.trim() !== '') {
    umapHotspots[hotspotIndex].label = newLabel.trim();
    console.log(`Updated hotspot ${hotspotIndex + 1} label to: "${newLabel.trim()}"`);
  }
}

function drawPlaceholderOverlay() {
  // Draw semi-transparent overlay to dim the background
  fill(0, 0, 0, 150);
  noStroke();
  rect(scatterplotX, scatterplotY, scatterplotSize, scatterplotSize);
  
  // Draw the placeholder image centered in the scatterplot area
  image(placeholderImage, scatterplotX, scatterplotY, scatterplotSize, scatterplotSize);
  
  // Draw instruction text
  fill(255);
  textSize(14);
  textAlign(CENTER, TOP);
  textStyle(BOLD);
  if (showOldData) {
    text('Old data overlay active - Click outside to return to UMAP', scatterplotX + scatterplotSize / 2, scatterplotY + scatterplotSize + 10);
  } else {
    text('Click image to view old data, click outside to return to UMAP', scatterplotX + scatterplotSize / 2, scatterplotY + scatterplotSize + 10);
  }
  textStyle(NORMAL);
}

function populateDimensionDropdowns() {
  // Clear existing options
  xDimSelect.html('');
  yDimSelect.html('');
  
  // Use appropriate dimension names
  let dimNames = showOldData ? oldAllDimNames : allDimNames;
  
  // Populate dropdowns
  for (let name of dimNames) {
    xDimSelect.option(name);
    yDimSelect.option(name);
  }
}

function toggleQuestions() {
  showQuestions = questionToggle.checked();
  console.log('Question visualization:', showQuestions ? 'ON' : 'OFF');
  
  // Turn off UMAP and U01 when questions mode is enabled
  if (showQuestions) {
    if (showUMAP) {
      showUMAP = false;
      umapToggle.checked(false);
      exportButton.style('display', 'none');
      importToggle.style('display', 'none');
      selectedUmapHotspot = -1;
    }
    if (showScoring) {
      showScoring = false;
      scoringSelect.selected('None');
    }
  }
}

function handleScoringChange() {
  selectedScoring = scoringSelect.value();
  showScoring = selectedScoring !== 'Hotspots';
  console.log('Scoring visualization:', selectedScoring);
  
  // Turn off UMAP and Questions when scoring mode is enabled
  if (showScoring) {
    if (showUMAP) {
      showUMAP = false;
      umapToggle.checked(false);
      exportButton.style('display', 'none');
      importToggle.style('display', 'none');
      selectedUmapHotspot = -1;
    }
    if (showQuestions) {
      showQuestions = false;
      questionToggle.checked(false);
    }
  }
}

// --- DataTables population ---
function populateDataTable() {
  // Get all column names from the CSV
  let allColumns = table.columns;
  // Replace 'u01' with 'Uniqueness' in the headers
  let headers = allColumns.map(col => col === 'u01' ? 'Uniqueness' : col);
  
  console.log('Column order:', allColumns);
  console.log('text column index:', allColumns.indexOf('text'));
  console.log('d1 column index:', allColumns.indexOf('d1'));

  let tableRows = points.map(p => {
    // Split text into lines and keep only the first 4
    let textLines = p.text.split('\n').slice(0, 4);
    let trimmedText = textLines.join('\n');
    if (textLines.length === 4 && p.text.split('\n').length > 4) {
      trimmedText += '\n...';
    }

    // Build row with all columns from the CSV
    let row = [
      p.id,
      p.title,
      p.url
    ];
    
    // Add dimension values
    row.push(...p.dims.map(d => d.toFixed(2)));
    
    // Add additional columns (uniq_z, u01, QuestionExists, text)
    // Extract these from the table for this row index
    let rowIndex = points.indexOf(p);
    if (table.columns.includes('uniq_z')) {
      row.push(table.getString(rowIndex, 'uniq_z'));
    }
    if (table.columns.includes('u01')) {
      row.push(table.getString(rowIndex, 'u01'));
    }
    if (table.columns.includes('text')) {
      row.push(trimmedText);
    }
    if (table.columns.includes('QuestionExists')) {
      row.push(table.getString(rowIndex, 'QuestionExists'));
    }
    
    return row;
  });

  let thead = '<thead><tr>' + headers.map(h => {
    let width = '80px'; // default width
    if (h.startsWith('d')) {
      width = '70px'; // dimension columns
    } else if (h === 'url') {
      width = '80px';
    }
    return `<th style="width: ${width}; min-width: ${width}; max-width: ${width};" title="${h}">${h}</th>`;
  }).join('') + '</tr></thead>';
  let tbody = '<tbody>' + tableRows.map(row =>
    '<tr>' + row.map((cell, idx) => {
      let width = '80px'; // default width
      let colName = headers[idx];
      if (colName.startsWith('d')) {
        width = '70px'; // dimension columns
      } else if (colName === 'url') {
        width = '80px';
      }
      return `<td style="width: ${width}; min-width: ${width}; max-width: ${width};" title="${cell}">${cell}</td>`;
    }).join('') + '</tr>'
  ).join('') + '</tbody>';

  $('#data-table').html(thead + tbody);

  // Destroy previous DataTable if exists
  if ($.fn.DataTable.isDataTable('#data-table')) {
    $('#data-table').DataTable().destroy();
  }

  // Initialize DataTables with pagination enabled
  $('#data-table').DataTable({
    scrollX: true,
    paging: true,
    pageLength: 25,
    lengthMenu: [[10, 25, 50, 100, -1], [10, 25, 50, 100, "All"]],
    select: {
      style: 'single'
    },
    columnDefs: [
      {
        width: "80px",
        targets: allColumns.indexOf('url') >= 0 ? allColumns.indexOf('url') : -1
      },
      {
        width: "70px",
        targets: allDimNames.map(dimName => allColumns.indexOf(dimName)).filter(idx => idx >= 0)
      }
    ],
    dom: 'Blfrtip',
    buttons: ['colvis'],
    createdRow: function(row, data, dataIndex) {
      $(row).css('height', `${ROW_HEIGHT}px`);
      
      // Add hover event listeners to each row
      $(row).on('mouseenter', function() {
        tableHoverId = String(data[0]); // Set the hovered ID (first column is ID)
      });
      
      $(row).on('mouseleave', function() {
        tableHoverId = null; // Clear the hovered ID
      });
    }
  });
  
  // Add double-click handler for URL column
  let urlColumnIndex = allColumns.indexOf('url');
  if (urlColumnIndex >= 0) {
    $('#data-table').on('dblclick', `td:nth-child(${urlColumnIndex + 1})`, function() {
      let urlText = $(this).text();
      navigator.clipboard.writeText(urlText).then(() => {
        console.log('URL copied to clipboard:', urlText);
        // Visual feedback
        let originalBg = $(this).css('background-color');
        $(this).css('background-color', '#90EE90');
        setTimeout(() => {
          $(this).css('background-color', originalBg);
        }, 300);
      }).catch(err => {
        console.error('Failed to copy URL:', err);
      });
    });
  }
}

// --- Locate row by ID ---
function locateRowById(hoveredId) {
  let dt = $('#data-table').DataTable();

  // Locate the row by its id
  let row = dt.row(function(idx, data, node) {
    return String(data[0]) === String(hoveredId); // Match the id column
  });

  if (row.any()) {
    // Highlight the row
    row.select();

    // Get the row's position in the current view (after sorting/filtering)
    let rowIndexInView = dt.rows({ order: 'applied' }).indexes().toArray().indexOf(row.index());
    console.log(`Row Index in Current View: ${rowIndexInView}`);

    // Calculate which page the row is on and navigate to it
    let pageLength = dt.page.len();
    let pageNumber = Math.floor(rowIndexInView / pageLength);
    
    // Navigate to the page containing the row
    dt.page(pageNumber).draw(false);
    console.log(`Navigated to page ${pageNumber} for row with ID ${hoveredId}.`);
  } else {
    console.log(`Row with ID ${hoveredId} not found.`);
  }
}