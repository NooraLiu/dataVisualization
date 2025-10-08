let table;
let points = [];
let hoverIndex = -1;
let hoverCol = ''; // 'url' or 'text' when hovering

// UI elements
let xDimSelect, yDimSelect, middleDimSelect;
let allDimNames = [];
let tableX = 800;
let rowHeight = 20;

function preload() {
  table = loadTable('data.csv', 'csv', 'header');
}

function setup() {
  createCanvas(2200, 2100);
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
  xDimSelect.position(20, 20);
  yDimSelect.position(180, 20);
  for (let name of allDimNames) {
    xDimSelect.option(name);
    yDimSelect.option(name);
  }
  xDimSelect.selected(allDimNames[0]);
  yDimSelect.selected(allDimNames[1]);

  // middle dimension selector for table
  middleDimSelect = createSelect();

  // Dynamically calculate the position of the middleDimSelect dropdown
  let colWidths = [100, 400, 100, 350]; // Widths for 'id', 'title', 'url', 'text'
  let defaultColWidth = 100; // Default width for the remaining columns
  let middleColIndex = 7; // The middle column is the 8th column (index 7)
  let middleColX = tableX + colWidths.reduce((sum, width, i) => (i < 4 ? sum + width : sum), 0) + (middleColIndex - 4) * defaultColWidth;

  middleDimSelect.position(middleColX, 20); // Position the dropdown over the middle column header
  for (let i = 3; i < allDimNames.length - 3; i++) {
    middleDimSelect.option(allDimNames[i]);
  }
  middleDimSelect.selected(allDimNames[3]);

  // Add an event listener to update the table when the dropdown value changes
  middleDimSelect.changed(() => {
    redraw(); // Trigger a redraw of the canvas
  });
}

function draw() {
  background(250);
  hoverCol = '';

  let xName = xDimSelect.value();
  let yName = yDimSelect.value();
  let middleName = middleDimSelect.value();

  let xIndex = allDimNames.indexOf(xName);
  let yIndex = allDimNames.indexOf(yName);
  let middleIndex = allDimNames.indexOf(middleName);

  detectHover(xIndex, yIndex); // Update hoverIndex before drawing anything

  drawTable(middleIndex); // Draw the table first
  drawScatterplot(xIndex, yIndex); // Draw the scatterplot after
}

function detectHover(xIndex, yIndex) {
  hoverIndex = -1; // Reset hoverIndex

  let xVals = points.map(p => p.dims[xIndex]);
  let yVals = points.map(p => p.dims[yIndex]);
  let minX = min(xVals), maxX = max(xVals);
  let minY = min(yVals), maxY = max(yVals);

  let scatterWidth = 600; // Width of the scatterplot
  let scatterHeight = 600; // Make it a square

  for (let i = 0; i < points.length; i++) {
    let p = points[i];
    let x = map(p.dims[xIndex], minX, maxX, 100, 100 + scatterWidth);
    let y = map(p.dims[yIndex], minY, maxY, scatterHeight + 100, 100); // Invert y-axis

    if (dist(mouseX, mouseY, x, y) < 6) {
      hoverIndex = i; // Update hoverIndex if the mouse is near a point
      break; // Stop checking after finding the hovered point
    }
  }
}

// --- Scatterplot ---
function drawScatterplot(xIndex, yIndex) {
  fill(0);
  textSize(14);
  text(`Scatterplot: ${allDimNames[xIndex]} vs ${allDimNames[yIndex]}`, 20, 60);

  let xVals = points.map(p => p.dims[xIndex]);
  let yVals = points.map(p => p.dims[yIndex]);
  let minX = min(xVals), maxX = max(xVals);
  let minY = min(yVals), maxY = max(yVals);

  // Calculate scatterplot dimensions
  let scatterWidth = 600; // Width of the scatterplot
  let scatterHeight = 600; // Make it a square
  let scatterTop = 100; // Top margin
  let scatterBottom = scatterTop + scatterHeight; // Bottom of the square

  for (let i = 0; i < points.length; i++) {
    let p = points[i];
    let x = map(p.dims[xIndex], minX, maxX, 100, 100 + scatterWidth);
    let y = map(p.dims[yIndex], minY, maxY, scatterBottom, scatterTop); // Invert y-axis

    if (dist(mouseX, mouseY, x, y) < 6) {
      hoverIndex = i; // Set hoverIndex to the index of the hovered point
    }

    fill(hoverIndex === i ? 'orange' : 'steelblue');
    ellipse(x, y, 10, 10);
  }

  // Only show the scatterplot hover card if not hovering over the table
  if (hoverIndex !== -1 && hoverCol === '') {
    let p = points[hoverIndex];
    fill(255);
    stroke(0);
    rect(mouseX + 10, mouseY - 20, min(textWidth(p.title) + 20, 400), 30);
    noStroke();
    fill(0);
    text(p.title, mouseX + 15, mouseY - 15);
  }
}

// --- Table ---
function drawTable(middleIndex) {
  let startY = 20;

  // Manually assign widths for the first 4 columns
  let colWidths = [100, 400, 100, 350]; // Widths for 'id', 'title', 'url', 'text'
  let defaultColWidth = 100; // Default width for the remaining columns

  let last3Dims = allDimNames.slice(-3);

  // Update headers to include the last 3 dimensions
  let headers = ['id', 'title', 'url', 'text', 'd1', 'd2', 'd3', middleDimSelect.value(), ...last3Dims];

  // Draw header
  fill(0);
  textSize(12);
  let colX = tableX;
  for (let i = 0; i < headers.length; i++) {
    let colWidth = i < colWidths.length ? colWidths[i] : defaultColWidth; // Use manual widths for the first 4 columns
    text(headers[i], colX, startY);
    colX += colWidth;
  }

  // Draw rows
  for (let r = 0; r < points.length; r++) {
    let p = points[r];
    let y = startY + (r + 1) * rowHeight;

    // Highlight row if hovering over scatterplot point
    if (r === hoverIndex) {
      fill(255, 255, 150, 150);
      rect(tableX, y - 2, colX - tableX, rowHeight);
    }

    fill(0);
    colX = tableX;

    // Draw the first 4 columns with manual widths
    text(p.id, colX, y);
    colX += colWidths[0];
    text(p.title, colX, y);
    colX += colWidths[1];

    let urlPreview = p.url.length > 15 ? p.url.substring(0, 15) + '...' : p.url;
    text(urlPreview, colX, y);
    colX += colWidths[2];

    let textPreview = p.text.length > 45 ? p.text.substring(0, 45) + '...' : p.text;
    text(textPreview, colX, y);
    colX += colWidths[3];

    // Check if hovering on url/text cell
    if (mouseX > tableX + colWidths[0] + colWidths[1] && mouseX < tableX + colWidths[0] + colWidths[1] + colWidths[2] && mouseY > y && mouseY < y + rowHeight) hoverCol = 'url', hoverIndex = r;
    if (mouseX > tableX + colWidths[0] + colWidths[1] + colWidths[2] && mouseX < tableX + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] && mouseY > y && mouseY < y + rowHeight) hoverCol = 'text', hoverIndex = r;

    // Draw the remaining columns with the default width
    for (let i = 4; i < headers.length; i++) {
      let value;
      if (i === 7) {
        // Middle column (use middleIndex to fetch the correct value)
        value = p.dims[middleIndex].toFixed(2);
      } else if (i >= 8) {
        // Last 3 dimensions
        value = p.dims[allDimNames.indexOf(headers[i])].toFixed(2);
      } else {
        // Other dimensions
        value = p.dims[i - 4].toFixed(2);
      }
      text(value, colX, y);
      colX += defaultColWidth;
    }
  }

  // Hover card for url/text
  if (hoverCol !== '' && hoverIndex !== -1) {
    let p = points[hoverIndex];
    let cardText, cardWidth, cardHeight;

    if (hoverCol === 'url') {
      cardText = `URL: ${p.url}`;
      cardWidth = min(textWidth(cardText) + 30, 700);
      cardHeight = 28; // Smaller height for URL
    } else {
      // Text hover card
      cardText = `Text: ${p.text}`;
      cardWidth = 400; // Fixed width for Text
      textSize(12);
      let lineHeight = 20; // Height of each line
      let charsPerLine = floor(cardWidth / textWidth('H')); // Estimate characters per line
      let lines = ceil(cardText.length / charsPerLine); // Calculate number of lines
      cardHeight = lines * lineHeight + 12; // Dynamic height based on lines
    }

    let cardX = mouseX + 10;
    let cardY = mouseY + 10;
    fill(255);
    stroke(0);
    rect(cardX, cardY, cardWidth, cardHeight);
    noStroke();
    fill(0);
    textSize(12);

    if (hoverCol === 'url') {
      text(cardText, cardX + 10, cardY + 8);
    } else {
      // Display text as a single column without wrapping
      let charsPerLine = floor(cardWidth / textWidth('a'));
      for (let i = 0; i < cardText.length; i += charsPerLine) {
        let line = cardText.substring(i, i + charsPerLine);
        text(line, cardX + 10, cardY + 8 + (i / charsPerLine) * 18);
      }
    }
  }
}