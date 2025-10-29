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
let ROW_HEIGHT = 150; // Global variable for row height
let POINT_SIZE = 5; // Default point size

function preload() {
  table = loadTable('data.csv', 'csv', 'header');
}

function setup() {
  let cnv = createCanvas(800, 1000);
  cnv.parent('scatterplot-holder'); // Attach canvas to a container div
  cnv.style('position', 'fixed');   // Fix the canvas position
  cnv.style('top', '0px');          // Lock it to the top
  cnv.style('left', '0px');         // Lock it to the left
  cnv.style('z-index', '1000');     // Ensure it stays above other elements
  noStroke();
  textAlign(LEFT, TOP);
  textSize(12);

  // Detect all dimensions
  allDimNames = table.columns.filter(c => c.startsWith('d'));

  // Extract points
  for (let r = 0; r < table.getRowCount(); r++) {
    let id = table.getString(r, 'id');
    let url = table.getString(r, 'url');
    let title = table.getString(r, 'title');
    let text = table.getString(r, 'text');
    let dims = allDimNames.map(d => float(table.getString(r, d)));
    points.push({ id, url, title, text, dims });
  }

  // Scatterplot dimension selectors
  xDimSelect = createSelect();
  yDimSelect = createSelect();

  // Position dropdowns and make them fixed
  xDimSelect.position(120, 20); // Adjusted for visibility
  yDimSelect.position(280, 20); // Adjusted for visibility
  xDimSelect.style('position', 'fixed'); // Fix the dropdown position
  yDimSelect.style('position', 'fixed');
  xDimSelect.style('z-index', '1001');   // Ensure dropdowns appear above the canvas
  yDimSelect.style('z-index', '1001');

  // Populate dropdowns with dimension names
  for (let name of allDimNames) {
    xDimSelect.option(name);
    yDimSelect.option(name);
  }
  xDimSelect.selected(allDimNames[0]);
  yDimSelect.selected(allDimNames[1]);

  // Initial population of DataTable
  populateDataTable();
}

let lastHoveredId = null; // Track the last hovered ID
let tableHoverId = null; // Track which row is hovered in the table

function draw() {
  background(250);
  hoverCol = '';

  let xName = xDimSelect.value();
  let yName = yDimSelect.value();

  let xIndex = allDimNames.indexOf(xName);
  let yIndex = allDimNames.indexOf(yName);

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

    // Determine point color and highlight based on hover state
    let pointColor;
    let showHighlight = false;
    let highlightColor;
    let highlightSize;
    let highlightStrokeWeight;

    if (hoverIndex === i) {
      // Scatterplot hover
      pointColor = 'orange';
      showHighlight = true;
      highlightColor = color(255, 165, 0); // Orange
      highlightSize = POINT_SIZE + 10;
      highlightStrokeWeight = 2;
    } else if (tableHoverId && String(p.id) === tableHoverId) {
      // Table row hover
      pointColor = 'orange';
      showHighlight = true;
      highlightColor = color(255, 165, 0); // Orange
      highlightSize = POINT_SIZE + 15;
      highlightStrokeWeight = 3;
    } else {
      // Default
      pointColor = 'steelblue';
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

  // Initialize DataTables with Scroller enabled
  $('#data-table').DataTable({
    scrollX: true,
    scrollY: '700px',
    scroller: {
      rowHeight: ROW_HEIGHT
    },
    select: {
      style: 'single'
    },
    columnDefs: [
      { width: "600px", targets: 3 },
      ...allDimNames.slice(3).map((_, i) => ({
        visible: false,
        targets: i + 4
      }))
    ],
    dom: 'Bfrtip',
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

    // Use DataTables Scroller API to scroll to the row
    if ($.fn.DataTable.isDataTable('#data-table') && dt.scroller) {
      // Scroll to the row and align it to the top
      dt.scroller().scrollToRow(rowIndexInView, true, function() {
        console.log(`Scrolled to row with ID ${hoveredId} and aligned it to the top.`);
      });
    } else {
      console.log('Scroller extension is not enabled. Cannot scroll to the row.');
    }
  } else {
    console.log(`Row with ID ${hoveredId} not found.`);
  }
}