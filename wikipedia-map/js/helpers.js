/* global vis, network, nodes, edges */
// This script contains helper functions that are used by other scripts to
// perform simple common actions.


// -- MISCELLANEOUS FUNCTIONS -- //

// Get the level of the highest level node that exists in the graph
function maxLevel() {
  const ids = nodes.getIds();
  const levels = ids.map(x => nodes.get(x).level);
  return Math.max.apply(null, levels);
}

// Convert a hex value to RGB
function hexToRGB(hex) {
  // eslint-disable-next-line no-param-reassign
  if (hex.startsWith('#')) hex = hex.slice(1, hex.length); // Remove leading #
  const strips = [hex.slice(0, 2), hex.slice(2, 4), hex.slice(4, 6)]; // Cut up into 2-digit strips
  return strips.map(x => parseInt(x, 16)); // To RGB
}
function rgbToHex(rgb) {
  const hexvals = rgb
    .map(x => Math.round(x).toString(16))
    .map(x => (x.length === 1 ? `0${x}` : x));
  // Add leading 0s to make a valid 6 digit hex
  return `#${hexvals.join('')}`;
}

// Lighten a given hex color by %
function lightenHex(hex, percent) {
  const rgb = hexToRGB(hex); // Convert to RGB
  const newRgb = rgb.map(x => x + ((Math.min(percent, 100) / 100) * (255 - x)));
  return rgbToHex(newRgb); // and back to hex
}

// Color palette for node types (darkest to lightest) - Green theme (Mode B, user requested)
// root (main article) -> primarySection -> secondarySection -> link
const NODE_TYPE_COLORS = {
  root: '#4B7A3E',           // Deeper green - main article
  primarySection: '#A2CB8B', // Lighter green - primary sections
  secondarySection: '#C7EABB', // Even lighter green - secondary sections
  link: '#E8F5BD',           // Lightest green - links
};

// Multi-color palette for node types (Mode C) - user requested colors
// root (main article) -> primarySection -> secondarySection -> link
const NODE_TYPE_COLORS_MULTI = {
  root: '#FE9EC7',           // Pink - main article
  primarySection: '#F9F6C4', // Light yellow - primary sections
  secondarySection: '#89D4FF', // Light blue - secondary sections
  link: '#44ACFF',           // Blue - links
};

// Shape palette for node types (Mode A only)
const NODE_TYPE_SHAPES = {
  root: 'star',              // Star for main article
  primarySection: 'diamond', // Diamond for primary sections
  secondarySection: 'triangle', // Triangle for secondary sections
  link: 'dot',               // Dot for links
};

// Get the current mode
function getCurrentMode() {
  const modeSelect = document.getElementById('mode-select');
  return modeSelect ? modeSelect.value : 'A';
}

// Get the color for a node based on its type and current mode
function getColorByNodeType(nodeType) {
  const mode = getCurrentMode();
  if (mode === 'C') {
    return NODE_TYPE_COLORS_MULTI[nodeType] || NODE_TYPE_COLORS_MULTI.link;
  }
  return NODE_TYPE_COLORS[nodeType] || NODE_TYPE_COLORS.link;
}

// Get the shape for a node based on its type (Mode A only)
function getShapeByNodeType(nodeType) {
  return NODE_TYPE_SHAPES[nodeType] || NODE_TYPE_SHAPES.link;
}

// Check if current mode is A (shape mode)
function isShapeMode() {
  const modeSelect = document.getElementById('mode-select');
  return modeSelect && modeSelect.value === 'A';
}

// Check if current mode uses sections ↔ links pattern (Mode A or C)
function isSectionsLinksMode() {
  const mode = getCurrentMode();
  return mode === 'A' || mode === 'C';
}

// Get the color for a node, lighten a green based on level. Subtle.
// Legacy function for backwards compatibility
function getColor(level) {
  return lightenHex('#58d68d', 5 * level); // Gets 5% lighter for each level
}
// Get the highlighted color for a node, lighten a yellow based on level. Subtle.
function getYellowColor(level) {
  return lightenHex('#FFC107', 5 * level); // Gets 5% lighter for each level
}
// Get the color that an edge should be pointing to a certain level
function getEdgeColor(level) {
  const nodecolor = getColor(level);
  return vis.util.parseColor(nodecolor).border;
}

// Get edge color based on node type
function getEdgeColorByNodeType(nodeType) {
  const nodecolor = getColorByNodeType(nodeType);
  return vis.util.parseColor(nodecolor).border;
}


// Break a sentence into separate lines, trying to fit each line within `limit`
// characters. Only break at spaces, never break in the middle of words.
function wordwrap(text, limit) {
  const words = text.split(' ');
  const lines = [words[0]];
  words.slice(1).forEach((word) => {
    // Start a new line if adding this word to the previous line would overflow character limit
    if (lines[lines.length - 1].length + word.length > limit) lines.push(word);
    else lines[lines.length - 1] += ` ${word}`;
  });
  return lines.join('\n'); // Trim because the first line will start with a space
}
// Un-word wrap a sentence by replacing line breaks with spaces.
function unwrap(text) { return text.replace(/\n/g, ' '); }

// Get a "normalized" form of a page name to use as an ID. This is designed to
// minimize the number of duplicate nodes found in the network.
function getNormalizedId(id) {
  return id
    .toLowerCase() // Lowercase
    .replace(/\s+/g, ' ') // Reduce spaces
    .replace(/[^A-Za-z\d% ]/g, '') // Remove non-alphanumeric characters
    .replace(/s$/, ''); // Remove trailing s
}

// A cross-browser compatible alternative to Math.sign, because support is atrocious
function sign(x) {
  if (x === 0) return 0;
  return x > 0 ? 1 : -1;
}


// == NETWORK SHORTCUTS == //

// Color nodes from a list based on their type. If color=1, highlight color will be used.
function colorNodes(ns, color) {
  for (let i = 0; i < ns.length; i += 1) {
    const onPath = window.activePath && window.activePath.nodeIds.has(ns[i].id);
    const onRootPath = window.activeRootPaths && window.activeRootPaths.nodeIds.has(ns[i].id);
    const isPathStart = ns[i].id === window.pathStart;
    if (color) {
      // Highlight with yellow (temporary traceback — path border will be re-applied on restore)
      ns[i].color = getYellowColor(ns[i].level);
    } else {
      const bg = getColorByNodeType(ns[i].nodeType || 'link');
      if (onPath || onRootPath || isPathStart) {
        // Preserve gold border for nodes on the active path or pending selection
        ns[i].color = { background: bg, border: '#FFC300', highlight: { background: bg, border: '#FFD700' } };
        ns[i].borderWidth = 2;
      } else {
        ns[i].color = bg;
        ns[i].borderWidth = 0;
      }
    }
    // Prevent snapping
    delete ns[i].x;
    delete ns[i].y;
  }
  nodes.update(ns);
  window.isReset = false;
}

// Set the width of some edges.
function edgesWidth(es, width) {
  for (let i = 0; i < es.length; i += 1) {
    es[i].width = width;
  }
  edges.update(es);
  window.isReset = false;
}

// Build an undirected adjacency list from all current edges.
// Pass the result to findPath to avoid rebuilding it for every pair.
function buildAdj() {
  const allEdges = edges.get();
  const adj = {};
  for (const e of allEdges) {
    if (!adj[e.from]) adj[e.from] = [];
    if (!adj[e.to]) adj[e.to] = [];
    adj[e.from].push({ neighbor: e.to, edgeId: e.id });
    adj[e.to].push({ neighbor: e.from, edgeId: e.id });
  }
  return adj;
}

// Find shortest undirected path between two nodes via BFS.
// Returns { nodeIds: Set, edgeIds: Set } or null if no path exists.
// Accepts an optional pre-built adjacency list to avoid redundant edge scans.
function findPath(startId, goalId, adj) {
  if (startId === goalId) return { nodeIds: new Set([startId]), edgeIds: new Set() };
  if (!adj) adj = buildAdj();
  // Use parent-pointer BFS — O(n) memory instead of copying full paths per node.
  const parent = {}; // node -> { from, edgeId } | null for startId
  parent[startId] = null;
  const queue = [startId];
  let found = false;
  outer: while (queue.length > 0) {
    const id = queue.shift();
    for (const { neighbor, edgeId } of (adj[id] || [])) {
      if (neighbor in parent) continue;
      parent[neighbor] = { from: id, edgeId };
      if (neighbor === goalId) { found = true; break outer; }
      queue.push(neighbor);
    }
  }
  if (!found) return null;
  // Backtrack from goalId to startId to recover the path.
  const nodeIds = new Set();
  const edgeIds = new Set();
  let cur = goalId;
  while (cur !== startId) {
    nodeIds.add(cur);
    const { from, edgeId } = parent[cur];
    edgeIds.add(edgeId);
    cur = from;
  }
  nodeIds.add(startId);
  return { nodeIds, edgeIds };
}

// Highlight a found path between two manually selected nodes.
window.activePath = null; // { startId, endId, nodeIds: Set, edgeIds: Set }
window.activeRootPaths = null; // { nodeIds: Set, edgeIds: Set }

function highlightSelectedPath(startId, endId) {
  const result = findPath(startId, endId);
  clearSelectedPath();
  if (!result) return false;

  window.activePath = { startId, endId, nodeIds: result.nodeIds, edgeIds: result.edgeIds };

  // Style path edges gold
  const pathEdges = edges.get({ filter: e => result.edgeIds.has(e.id) });
  edges.update(pathEdges.map(e => ({
    id: e.id,
    color: { color: '#FFC300', highlight: '#FFD700', hover: '#FFD700' },
    width: 3,
  })));

  // Style all path nodes (endpoints + intermediates) with thin gold border only
  const pathNodes = nodes.get({ filter: n => result.nodeIds.has(n.id) });
  nodes.update(pathNodes.map(n => {
    const bg = getColorByNodeType(n.nodeType || 'link');
    return {
      id: n.id,
      borderWidth: 2,
      color: { background: bg, border: '#FFC300', highlight: { background: bg, border: '#FFD700' } },
    };
  }));

  return true;
}

function clearSelectedPath() {
  if (!window.activePath) return;
  // Restore edges to their type-based color
  const pathEdges = edges.get({ filter: e => window.activePath.edgeIds.has(e.id) });
  edges.update(pathEdges.map(e => ({
    id: e.id,
    color: getEdgeColorByNodeType((nodes.get(e.to) || {}).nodeType || 'link'),
    width: 1,
  })));
  // Restore nodes to their type-based color, no border
  const pathNodes = nodes.get({ filter: n => window.activePath.nodeIds.has(n.id) });
  nodes.update(pathNodes.map(n => ({
    id: n.id,
    borderWidth: 0,
    color: getColorByNodeType(n.nodeType || 'link'),
  })));
  window.activePath = null;
}

function clearRootPathHighlights() {
  if (!window.activeRootPaths) return;
  // Restore edges to their type-based color
  const pathEdges = edges.get({ filter: e => window.activeRootPaths.edgeIds.has(e.id) });
  edges.update(pathEdges.map(e => ({
    id: e.id,
    color: getEdgeColorByNodeType((nodes.get(e.to) || {}).nodeType || 'link'),
    width: 1,
  })));
  // Restore nodes to their type-based color, no border
  const pathNodes = nodes.get({ filter: n => window.activeRootPaths.nodeIds.has(n.id) });
  nodes.update(pathNodes.map(n => ({
    id: n.id,
    borderWidth: 0,
    color: getColorByNodeType(n.nodeType || 'link'),
  })));
  window.activeRootPaths = null;

  // Re-apply manual selected path if present, because clearing root highlights
  // may have reset styling for overlapping nodes/edges.
  if (window.activePath) {
    highlightSelectedPath(window.activePath.startId, window.activePath.endId);
  }
}

function highlightAllRootPaths() {
  clearRootPathHighlights();

  const roots = (window.startpages || []).filter(id => nodes.get(id));
  if (roots.length < 2) return false;

  const allNodeIds = new Set();
  const allEdgeIds = new Set();

  // Build adjacency list once and reuse across all root-pair searches.
  const adj = buildAdj();
  for (let i = 0; i < roots.length; i += 1) {
    for (let j = i + 1; j < roots.length; j += 1) {
      const result = findPath(roots[i], roots[j], adj);
      if (!result) continue;
      result.nodeIds.forEach(id => allNodeIds.add(id));
      result.edgeIds.forEach(id => allEdgeIds.add(id));
    }
  }

  if (allEdgeIds.size === 0) return false;

  window.activeRootPaths = { nodeIds: allNodeIds, edgeIds: allEdgeIds };

  // Style path edges gold
  const pathEdges = edges.get({ filter: e => allEdgeIds.has(e.id) });
  edges.update(pathEdges.map(e => ({
    id: e.id,
    color: { color: '#FFC300', highlight: '#FFD700', hover: '#FFD700' },
    width: 3,
  })));

  // Style path nodes with a thin gold border
  const pathNodes = nodes.get({ filter: n => allNodeIds.has(n.id) });
  nodes.update(pathNodes.map(n => {
    const bg = getColorByNodeType(n.nodeType || 'link');
    return {
      id: n.id,
      borderWidth: 2,
      color: { background: bg, border: '#FFC300', highlight: { background: bg, border: '#FFD700' } },
    };
  }));

  return true;
}

// Get the id of the edge connecting two nodes a and b
function getEdgeConnecting(a, b) {
  const edge = edges.get({
    filter: e => e.from === a && e.to === b,
  })[0];

  return (edge instanceof Object ? edge : {}).id;
}

// Get the network's center of gravity
function getCenter() {
  const nodePositions = network.getPositions();
  const keys = Object.keys(nodePositions);

  // Find the sum of all x and y values
  let xsum = 0; let ysum = 0;

  Object.values(nodePositions).forEach((pos) => {
    xsum += pos.x;
    ysum += pos.y;
  });

  return [xsum / keys.length, ysum / keys.length]; // Average is sum divided by length
}

// Get the position in which nodes should be spawned given the id of a parent node.
// This position is in place so that nodes begin outside the network instead of at the center,
// leading to less chaotic node openings in large networks.
function getSpawnPosition(parentID) {
  // Get position of the node with specified id.
  const { x, y } = network.getPositions(parentID)[parentID];
  const cog = getCenter();
  // Distances from center of gravity to parent node
  const dx = cog[0] - x; const dy = cog[1] - y;

  let relSpawnX; let relSpawnY;

  if (dx === 0) { // Node is directly above center of gravity or on it, so slope will fail.
    relSpawnX = 0;
    relSpawnY = -sign(dy) * 100;
  } else {
    // Compute slope
    const slope = dy / dx;
    // Compute the new node position.
    const dis = 200; // Distance from parent (keep equal to network.options.physics.springLength)
    relSpawnX = dis / Math.sqrt((slope ** 2) + 1);
    relSpawnY = relSpawnX * slope;
  }
  return [Math.round(relSpawnX + x), Math.round(relSpawnY + y)];
}
