/* global nodes, edges, getSpawnPosition, getNormalizedId, wordwrap, unwrap, getColor, getEdgeColor, getColorByNodeType, getEdgeColorByNodeType, getShapeByNodeType, isShapeMode, isSectionsLinksMode, getCurrentMode, getEdgeConnecting, getPageSections, getSectionLinks, colorNodes, edgesWidth, markExpanded, findPath, highlightSelectedPath, clearSelectedPath */ // eslint-disable-line max-len
// This script contains the big functions that implement a lot of the core
// functionality, like expanding nodes, and getting the nodes for a traceback.


// -- GLOBAL VARIABLES -- //
window.isReset = true;
window.selectedNode = null;
window.traceedges = [];
window.tracenodes = [];
window.expansionMode = 'C'; // Default mode: C (always sections)
window.pathStart = null;    // First node selected for manual path-finding
// ---------------------- //

// Get the current expansion mode from the dropdown
function getExpansionMode() {
  const select = document.getElementById('mode-select');
  return select ? select.value : 'C';
}


// Rename a node, possibly merging it with another node if another node has that ID
function renameNode(oldId, newName) {
  const oldNode = nodes.get(oldId);
  const newId = getNormalizedId(newName);
  // The node doesn't need to be renamed
  if (newId === oldId) return oldId;
  // The node needs to be renamed - the new name doesn't exist on the graph yet.
  edges.update([
    // Update all edges that were 'from' oldId to be 'from' newId
    ...edges.get({
      filter: e => e.from === oldId,
    }).map(e => ({ ...e, from: newId })),
    // Update all edges that were 'to' oldId to be 'to' newId
    ...edges.get({
      filter: e => e.to === oldId,
    }).map(e => ({ ...e, to: newId })),
  ]);
  // The node already exists! We're just merging it
  if (nodes.get(newId)) {
    nodes.remove(oldId);
    nodes.update({ id: newId, label: newName });
    console.log(`Merging ${oldId} with ${newId}`);
    // We're actually replacing the node
  } else {
    console.log(`Re-identifying ${oldId} as ${newId}`);
    nodes.remove(oldId);
    nodes.add({ ...oldNode, id: newId, label: wordwrap(newName, oldNode.level === 0 ? 20 : 15) });
  }
  // Update any nodes whose parent was the old node
  nodes.update(
    nodes.get({
      filter: n => n.parent === oldId,
    }).map(n => ({ ...n, parent: newId })),
  );
  // If the old node was highlighted or used as part of a highlight, move the highlight
  if (window.selectedNode === oldId) window.selectedNode = newId;
  window.tracenodes = window.tracenodes.map(id => (id === oldId ? newId : id));
  // If the node was a start node, replace it
  window.startpages = window.startpages.map(id => (id === oldId ? newId : id));
  // Return the new ID
  return newId;
}

// Callback to add to a node once data is recieved (for flat list of strings)
function expandNodeCallback(page, data) {
  const node = nodes.get(page); // The node that was clicked
  const level = node.level + 1; // Level for new nodes is one more than parent
  const subpages = data;

  // Add all children to network
  const subnodes = [];
  const newedges = [];
  // Where new nodes should be spawned
  const [x, y] = getSpawnPosition(page);
  // Create node objects
  for (let i = 0; i < subpages.length; i += 1) {
    const subpage = subpages[i];
    const subpageID = getNormalizedId(subpage);
    if (!nodes.getIds().includes(subpageID)) { // Don't add if node exists
      subnodes.push({
        id: subpageID,
        label: wordwrap(decodeURIComponent(subpage), 15),
        value: 1,
        level,
        color: getColor(level),
        parent: page,
        x,
        y,
      });
    }

    if (!getEdgeConnecting(page, subpageID)) { // Don't create duplicate edges in same direction
      newedges.push({
        from: page,
        to: subpageID,
        color: getEdgeColor(level),
        level,
        selectionWidth: 2,
        hoverWidth: 0,
      });
    }
  }

  // Add the new components to the datasets for the graph
  nodes.add(subnodes);
  edges.add(newedges);
}

// Callback to add hierarchical sections to a node
// sections is an array of {name: string, children: string[]}
// nodeType: 'root' for main search node, 'section' for section nodes, 'link' for link nodes
// includeChildren: whether to include subsections as child nodes (Mode A) or not (Mode B first click)
function expandNodeWithSections(page, sections, nodeType = 'section', articleName = null, includeChildren = true) {
  const node = nodes.get(page);
  const level = node.level + 1;
  const childLevel = level + 1;

  const subnodes = [];
  const newedges = [];
  const [x, y] = getSpawnPosition(page);

  for (const section of sections) {
    const sectionID = getNormalizedId(section.name);
    
    // Add the top-level section node
    if (!nodes.getIds().includes(sectionID)) {
      const sectionNode = {
        id: sectionID,
        label: wordwrap(decodeURIComponent(section.name), 15),
        value: 1,
        level,
        color: getColorByNodeType('primarySection'),
        parent: page,
        x,
        y,
        nodeType: 'primarySection', // Mark as primary section node
        articleName: articleName || unwrap(node.label), // Track which article this section belongs to
        hasChildren: section.children.length > 0,
        childrenData: section.children, // Store children for later expansion in Mode B
      };
      // Add shape for Mode A
      if (isShapeMode()) {
        sectionNode.shape = getShapeByNodeType('primarySection');
      }
      subnodes.push(sectionNode);
    }

    // Add edge from parent to this section
    if (!getEdgeConnecting(page, sectionID)) {
      newedges.push({
        from: page,
        to: sectionID,
        color: getEdgeColorByNodeType('primarySection'),
        level,
        selectionWidth: 2,
        hoverWidth: 0,
      });
    }

    // Only add children if includeChildren is true (Mode A behavior)
    if (includeChildren) {
      for (const child of section.children) {
        const childID = getNormalizedId(child);
        
        if (!nodes.getIds().includes(childID)) {
          const childNode = {
            id: childID,
            label: wordwrap(decodeURIComponent(child), 15),
            value: 1,
            level: childLevel,
            color: getColorByNodeType('secondarySection'),
            parent: sectionID,
            x,
            y,
            nodeType: 'secondarySection', // Subsections are secondary section nodes
            articleName: articleName || unwrap(node.label),
          };
          // Add shape for Mode A
          if (isShapeMode()) {
            childNode.shape = getShapeByNodeType('secondarySection');
          }
          subnodes.push(childNode);
        }

        if (!getEdgeConnecting(sectionID, childID)) {
          newedges.push({
            from: sectionID,
            to: childID,
            color: getEdgeColorByNodeType('secondarySection'),
            level: childLevel,
            selectionWidth: 2,
            hoverWidth: 0,
          });
        }
      }
    }
  }

  nodes.add(subnodes);
  edges.add(newedges);

  // In Mode A, primarySection nodes whose children were just added are visually "expanded"
  // (triangles already hang from them). Mark them so a second click triggers path-finding
  // rather than fetching links again.
  if (includeChildren) {
    const alreadyWithChildren = subnodes
      .filter(n => n.nodeType === 'primarySection' && n.hasChildren)
      .map(n => ({ id: n.id, isExpanded: true }));
    if (alreadyWithChildren.length > 0) nodes.update(alreadyWithChildren);
  }
}

// Expand secondary sections from a primary section node (Mode B)
function expandNodeWithSecondarySection(page, children, articleName) {
  const node = nodes.get(page);
  const level = node.level + 1;

  const subnodes = [];
  const newedges = [];
  const [x, y] = getSpawnPosition(page);

  for (const child of children) {
    const childID = getNormalizedId(child);
    
    if (!nodes.getIds().includes(childID)) {
      const childNode = {
        id: childID,
        label: wordwrap(decodeURIComponent(child), 15),
        value: 1,
        level,
        color: getColorByNodeType('secondarySection'),
        parent: page,
        x,
        y,
        nodeType: 'secondarySection',
        articleName: articleName,
      };
      // Add shape for Mode A
      if (isShapeMode()) {
        childNode.shape = getShapeByNodeType('secondarySection');
      }
      subnodes.push(childNode);
    }

    if (!getEdgeConnecting(page, childID)) {
      newedges.push({
        from: page,
        to: childID,
        color: getEdgeColorByNodeType('secondarySection'),
        level,
        selectionWidth: 2,
        hoverWidth: 0,
      });
    }
  }

  nodes.add(subnodes);
  edges.add(newedges);
}

// Callback to add link nodes from a section
function expandNodeWithLinks(page, links, isLeaf = false) {
  const node = nodes.get(page);
  const level = node.level + 1;

  const subnodes = [];
  const newedges = [];
  const [x, y] = getSpawnPosition(page);

  for (const link of links) {
    const linkID = getNormalizedId(link);
    
    if (!nodes.getIds().includes(linkID)) {
      const linkNode = {
        id: linkID,
        label: wordwrap(decodeURIComponent(link), 15),
        value: 1,
        level,
        color: getColorByNodeType('link'),
        parent: page,
        x,
        y,
        nodeType: 'link', // Mark as link node
        isLeaf, // If true, this node cannot be expanded (Mode B)
      };
      // Add shape for Mode A
      if (isShapeMode()) {
        linkNode.shape = getShapeByNodeType('link');
      }
      subnodes.push(linkNode);
    }

    if (!getEdgeConnecting(page, linkID)) {
      newedges.push({
        from: page,
        to: linkID,
        color: getEdgeColorByNodeType('link'),
        level,
        selectionWidth: 2,
        hoverWidth: 0,
      });
    }
  }

  nodes.add(subnodes);
  edges.add(newedges);
}

// Mark a node as expanded (tracked for re-expansion prevention)
function markExpanded(id) {
  const node = nodes.get(id);
  if (!node) return;
  nodes.update({ id, isExpanded: true });
}

// Expand a node based on the current mode
function expandNode(id) {
  const node = nodes.get(id);
  const pagename = unwrap(node.label);
  const mode = getExpansionMode();
  const nodeType = node.nodeType || 'root'; // 'root', 'primarySection', 'secondarySection', or 'link'
  const isLeaf = node.isLeaf || false;

  // If this is a leaf node, don't expand
  if (isLeaf) {
    console.log('This node cannot be expanded (leaf node)');
    return;
  }

  // If the node is already expanded, use it for manual path-finding between two nodes
  if (node.isExpanded) {
    // If a path is already displayed, clear it and start fresh selection
    if (window.activePath) {
      clearSelectedPath();
      window.pathStart = null;
    }

    if (!window.pathStart) {
      // First click — mark as selection start with thin gold outline only
      window.pathStart = id;
      const bg = getColorByNodeType(nodeType);
      nodes.update({ id, borderWidth: 2,
        color: { background: bg, border: '#FFC300', highlight: { background: bg, border: '#FFD700' } } });
    } else if (window.pathStart === id) {
      // Clicked the same node again — cancel selection
      nodes.update({ id, borderWidth: 0, color: getColorByNodeType(nodeType) });
      window.pathStart = null;
    } else {
      // Second click — find and highlight path
      const prevStart = window.pathStart;
      window.pathStart = null;
      const found = highlightSelectedPath(prevStart, id);
      if (!found) {
        // No path — clear the start node's outline too
        const sn = nodes.get(prevStart);
        if (sn) nodes.update({ id: prevStart, borderWidth: 0, color: getColorByNodeType(sn.nodeType || 'link') });
        console.log(`No path found between "${unwrap((nodes.get(prevStart) || {}).label || '')}" and "${pagename}"`);
      }
    }
    return;
  }

  // Clicking an unexpanded node — clear any active path or pending selection first
  if (window.activePath || window.pathStart) {
    if (window.pathStart) {
      const sn = nodes.get(window.pathStart);
      if (sn) nodes.update({ id: window.pathStart, borderWidth: 0, color: getColorByNodeType(sn.nodeType || 'link') });
      window.pathStart = null;
    }
    clearSelectedPath();
  }

  // Mode A & C: Sections (with subsections) ↔ Links
  // Mode A uses shapes, Mode C uses distinct colors
  if (mode === 'A' || mode === 'C') {
    if (nodeType === 'root' || nodeType === 'link') {
      // Root node or link node → fetch sections with children
      getPageSections(pagename)
        .then(({ redirectedTo, sections }) => {
          const newId = renameNode(id, redirectedTo);
          expandNodeWithSections(newId, sections, nodeType, redirectedTo, true);
          markExpanded(newId);
        })
        .catch(err => {
          console.error(`Failed to load sections for "${pagename}":`, err);
          markExpanded(id); // Still mark so user knows we tried
        });
    } else if (nodeType === 'primarySection' || nodeType === 'secondarySection') {
      // Section node → fetch links from that section
      const articleName = node.articleName;
      getSectionLinks(articleName, pagename, 10)
        .then(({ links }) => {
          if (links.length > 0) {
            expandNodeWithLinks(id, links, false);
          } else {
            console.log(`No links found in section "${pagename}" of "${articleName}"`);
          }
          markExpanded(id);
        })
        .catch(err => {
          console.error(`Failed to load links for section "${pagename}":`, err);
          markExpanded(id);
        });
    }
  }
  // Mode B: Primary sections → Secondary sections → Links → Sections...
  else if (mode === 'B') {
    if (nodeType === 'root' || nodeType === 'link') {
      // Root node or link node → fetch only primary sections (no children)
      getPageSections(pagename)
        .then(({ redirectedTo, sections }) => {
          const newId = renameNode(id, redirectedTo);
          expandNodeWithSections(newId, sections, nodeType, redirectedTo, false);
          markExpanded(newId);
        })
        .catch(err => {
          console.error(`Failed to load sections for "${pagename}":`, err);
          markExpanded(id);
        });
    } else if (nodeType === 'primarySection') {
      // Primary section → show secondary sections if available, otherwise show links
      const hasChildren = node.hasChildren;
      const childrenData = node.childrenData;
      const articleName = node.articleName;

      if (hasChildren && childrenData && childrenData.length > 0) {
        // Show secondary sections
        expandNodeWithSecondarySection(id, childrenData, articleName);
        markExpanded(id);
      } else {
        // No children, show links directly
        getSectionLinks(articleName, pagename, 10)
          .then(({ links }) => {
            if (links.length > 0) {
              expandNodeWithLinks(id, links, false);
            } else {
              console.log(`No links found in section "${pagename}" of "${articleName}"`);
            }
            markExpanded(id);
          })
          .catch(err => {
            console.error(`Failed to load links for section "${pagename}":`, err);
            markExpanded(id);
          });
      }
    } else if (nodeType === 'secondarySection') {
      // Secondary section → fetch links
      const articleName = node.articleName;
      getSectionLinks(articleName, pagename, 10)
        .then(({ links }) => {
          if (links.length > 0) {
            expandNodeWithLinks(id, links, false);
          } else {
            console.log(`No links found in section "${pagename}" of "${articleName}"`);
          }
          markExpanded(id);
        })
        .catch(err => {
          console.error(`Failed to load links for section "${pagename}":`, err);
          markExpanded(id);
        });
    }
  }

  // Mark the expanded node as 'locked' if it's one of the commafield items
  const cf = document.getElementById('input');
  const cfItem = cf.querySelector(`.item[data-node-id="${id}"]`);
  if (cfItem) cfItem.classList.add('locked');
}

// Get all the nodes tracing back to the start node.
function getTraceBackNodes(node) {
  let currentNode = node;
  let finished = false;
  let iterations = 0;
  const path = [];
  while (!finished) { // Add parents of nodes until we reach the start
    path.push(currentNode);
    if (window.startpages.indexOf(currentNode) !== -1) { // Check if we've reached the end
      finished = true;
    }
    currentNode = nodes.get(currentNode).parent; // Keep exploring with the node above.
    // Failsafe: avoid infinite loops in case something got messed up with parents in the graph
    if (iterations > 100) return [];
    iterations += 1;
  }
  return path;
}

// Get all the edges tracing back to the start node.
function getTraceBackEdges(tbnodes) {
  tbnodes.reverse();
  const path = [];
  for (let i = 0; i < tbnodes.length - 1; i += 1) { // Don't iterate through the last node
    path.push(getEdgeConnecting(tbnodes[i], tbnodes[i + 1]));
  }
  return path;
}

// Reset the color of all nodes, and width of all edges.
function resetProperties() {
  if (!window.isReset) {
    window.selectedNode = null;
    // Reset node color
    const modnodes = window.tracenodes.map(i => nodes.get(i));
    colorNodes(modnodes, 0);
    // Reset edge width and color
    const modedges = window.traceedges.map((i) => {
      const e = edges.get(i);
      e.color = getEdgeColor(nodes.get(e.to).level);
      return e;
    });
    edgesWidth(modedges, 1);
    window.tracenodes = [];
    window.traceedges = [];
  }
}

// Highlight the path from a given node back to the central node.
function traceBack(node) {
  if (node !== window.selectedNode) {
    resetProperties();
    window.selectedNode = node;
    window.tracenodes = getTraceBackNodes(node);
    window.traceedges = getTraceBackEdges(window.tracenodes);
    // Color nodes yellow
    const modnodes = window.tracenodes.map(i => nodes.get(i));
    colorNodes(modnodes, 1);
    // Widen edges
    const modedges = window.traceedges.map((i) => {
      const e = edges.get(i);
      e.color = { inherit: 'to' };
      return e;
    });
    edgesWidth(modedges, 5);
  }
}
