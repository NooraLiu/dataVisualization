let table;
let points = [];
let hoverIndex = -1;
let hoverCol = ''; // 'url' or 'text' when hovering

// UI elements
let xDimSelect, yDimSelect;
let allDimNames = [];
let scatterplotX = 100; // Left margin for scatterplot
let scatterplotY = 100; // Top margin for scatterplot
let scatterplotSize = 600; // Square size for scatterplot

function preload() {
  table = loadTable('data.csv', 'csv', 'header');
}

function setup() {
  createCanvas(800, 1000);
  noStroke();
  textAlign(LEFT, TOP);
  textSize(12);

  // detect all dimensions
  allDimNames = table.columns.filter(c => c.startsWith('d'));

  // extract points
  for (let r = 0; r < table.getRowCount(); r++) {
    let id = table.getString(r, 'id');
    let url = table.getString(r, 'url');
    let title = table.getString(r, 'title');
    let text = table.getString(r, 'text');
    let dims = allDimNames.map(d => float(table.getString(r, d)));
    points.push({ id, url, title, text, dims });
  }

  // scatterplot dimension selectors
  xDimSelect = createSelect();
  yDimSelect = createSelect();
  xDimSelect.position(scatterplotX, 20);
  yDimSelect.position(scatterplotX + 160, 20);
  for (let name of allDimNames) {
    xDimSelect.option(name);
    yDimSelect.option(name);
  }
  xDimSelect.selected(allDimNames[0]);
  yDimSelect.selected(allDimNames[1]);

  // Initial population of DataTable
  populateDataTable();
}

function draw() {
  background(250);
  hoverCol = '';

  let xName = xDimSelect.value();
  let yName = yDimSelect.value();

  let xIndex = allDimNames.indexOf(xName);
  let yIndex = allDimNames.indexOf(yName);

  detectHover(xIndex, yIndex);

  // Highlight the row that matches the hovered point's id
  let dt = $('#data-table').DataTable();
  dt.rows().deselect(); // Remove previous selection
  if (hoverIndex !== -1) {
    let hoveredId = points[hoverIndex].id;
    dt.rows(function(idx, data, node) {
      return String(data[0]) === String(hoveredId);
    }).select();
  }

  drawScatterplot(xIndex, yIndex);
}

function detectHover(xIndex, yIndex) {
  hoverIndex = -1; // Reset hoverIndex

  let xVals = points.map(p => p.dims[xIndex]);
  let yVals = points.map(p => p.dims[yIndex]);
  let minX = min(xVals), maxX = max(xVals);
  let minY = min(yVals), maxY = max(yVals);

  for (let i = 0; i < points.length; i++) {
    let p = points[i];
    let x = map(p.dims[xIndex], minX, maxX, scatterplotX, scatterplotX + scatterplotSize);
    let y = map(p.dims[yIndex], minY, maxY, scatterplotY + scatterplotSize, scatterplotY); // Invert y-axis

    if (dist(mouseX, mouseY, x, y) < 6) {
      hoverIndex = i;
      break;
    }
  }
}

// --- Scatterplot ---
function drawScatterplot(xIndex, yIndex) {
  fill(0);
  textSize(14);
  text(`Scatterplot: ${allDimNames[xIndex]} vs ${allDimNames[yIndex]}`, scatterplotX+40, scatterplotY - 40);

  let xVals = points.map(p => p.dims[xIndex]);
  let yVals = points.map(p => p.dims[yIndex]);
  let minX = min(xVals), maxX = max(xVals);
  let minY = min(yVals), maxY = max(yVals);

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
    let xValue = nf(lerp(minX, maxX, i / numTicks), 1, 2);
    stroke(80);
    line(xTick, scatterplotY + scatterplotSize, xTick, scatterplotY + scatterplotSize + 6);
    noStroke();
    fill(80);
    textAlign(CENTER, TOP);
    text(xValue, xTick, scatterplotY + scatterplotSize + 8);

    // Y axis ticks
    let yTick = scatterplotY + scatterplotSize - (i / numTicks) * scatterplotSize;
    let yValue = nf(lerp(minY, maxY, i / numTicks), 1, 2);
    stroke(80);
    line(scatterplotX - 6, yTick, scatterplotX, yTick);
    noStroke();
    fill(80);
    textAlign(RIGHT, CENTER);
    text(yValue, scatterplotX - 8, yTick);
  }

  // --- Axis labels ---
  textSize(12);
  fill(0);
  textAlign(CENTER, TOP);
  text(allDimNames[xIndex], scatterplotX + scatterplotSize / 2, scatterplotY + scatterplotSize + 32);
  textAlign(RIGHT, CENTER);
  text(allDimNames[yIndex], scatterplotX - 32, scatterplotY + scatterplotSize / 2);

  // --- Draw points ---
  for (let i = 0; i < points.length; i++) {
    let p = points[i];
    let x = map(p.dims[xIndex], minX, maxX, scatterplotX, scatterplotX + scatterplotSize);
    let y = map(p.dims[yIndex], minY, maxY, scatterplotY + scatterplotSize, scatterplotY);

    fill(hoverIndex === i ? 'orange' : 'steelblue');
    ellipse(x, y, 10, 10);
  }

  // --- Hover box logic (reset strokeWeight and stroke) ---
  if (hoverIndex !== -1 && hoverCol === '') {
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
    // Position text with padding inside the box
    text(p.title, boxX+boxWidth-10, boxY+boxHeight/2);
  }
}

// --- DataTables population ---
function populateDataTable() {
  // Show all dimensions, let DataTables handle scrolling/visibility
  let dimHeaders = allDimNames;
  let headers = ['id', 'title', 'url', 'text', ...dimHeaders];

  let tableRows = points.map(p => {
    // Split text into lines and keep only the first 4
    let textLines = p.text.split('\n').slice(0, 4);
    let trimmedText = textLines.join('\n');
    if (textLines.length === 4 && p.text.split('\n').length > 4) {
      trimmedText += '\n...';
    }

    let row = [
      p.id,
      p.title,
      p.url,
      trimmedText,
      ...dimHeaders.map(dim => p.dims[allDimNames.indexOf(dim)].toFixed(2))
    ];
    return row;
  });

  let thead = '<thead><tr>' + headers.map(h => `<th>${h}</th>`).join('') + '</tr></thead>';
  let tbody = '<tbody>' + tableRows.map(row =>
    '<tr>' + row.map(cell => `<td>${cell}</td>`).join('') + '</tr>'
  ).join('') + '</tbody>';

  $('#data-table').html(thead + tbody);

  // Destroy previous DataTable if exists
  if ($.fn.DataTable.isDataTable('#data-table')) {
    $('#data-table').DataTable().destroy();
  }

  // Initialize DataTables with horizontal scroll and column visibility
  $('#data-table').DataTable({
    scrollX: true,
    select: {
      style: 'single'
    },
    columnDefs: [
      { width: "600px", targets: 3 },
      // Hide dimension columns except the first 3
      ...allDimNames.slice(3).map((_, i) => ({
        visible: false,
        targets: i + 4 // 0-based index: id, title, url, text, then dims
      }))
    ],
    dom: 'Bfrtip',
    buttons: ['colvis']
  });
}