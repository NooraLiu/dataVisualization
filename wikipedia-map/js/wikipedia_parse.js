/* global getNormalizedId */
const base = 'https://en.wikipedia.org/w/api.php';

const domParser = new DOMParser();

// Concurrency-limited request queue.
// At most MAX_CONCURRENT requests run in parallel, with a small MIN_GAP_MS
// politeness delay between each new request start.
// All queryApi calls funnel through here so Wikipedia is never flooded.
const MAX_CONCURRENT = 3;
const MIN_GAP_MS = 50; // max ~20 req/sec total — well within Wikipedia's limit
let _activeCount = 0;
let _lastStartTime = 0;
const _requestQueue = [];
const _drainCallbacks = []; // called once when queue empties and nothing is in-flight

function _startNext() {
  if (_activeCount >= MAX_CONCURRENT || _requestQueue.length === 0) return;
  const wait = Math.max(0, _lastStartTime + MIN_GAP_MS - Date.now());
  if (wait > 0) {
    // Re-check after the gap elapses; multiple simultaneous calls are harmless
    // because each one re-verifies the condition before launching.
    setTimeout(_startNext, wait);
    return;
  }
  const { run, resolve, reject } = _requestQueue.shift();
  _activeCount += 1;
  _lastStartTime = Date.now();
  run().then(resolve, reject).finally(function() {
    _activeCount -= 1;
    _startNext();
    // Fire drain callbacks once the queue is truly idle
    if (_activeCount === 0 && _requestQueue.length === 0 && _drainCallbacks.length > 0) {
      var cbs = _drainCallbacks.splice(0);
      cbs.forEach(function(cb) { setTimeout(cb, 100); });
    }
  });
  _startNext(); // fill remaining concurrent slots immediately
}

function _enqueue(run) {
  return new Promise(function(resolve, reject) {
    _requestQueue.push({ run: run, resolve: resolve, reject: reject });
    _startNext();
  });
}

/** Register a one-shot callback that fires when all queued requests finish. */
function onQueueDrain(cb) {
  _drainCallbacks.push(cb);
}

// Retry a fetch on 429 without re-enqueueing — keeps the slot open and retries
// in place so the queue stays sequential and doesn't leak extra active slots.
function _fetchWithRetry(url, retries, backoff) {
  return fetch(url).then(function(response) {
    if (response.status === 429) {
      if (retries === 0) return Promise.reject(new Error('Wikipedia API rate limited after retries'));
      return new Promise(function(resolve) { setTimeout(resolve, backoff); })
        .then(function() { return _fetchWithRetry(url, retries - 1, backoff * 2); });
    }
    return response.json();
  });
}

/* Make a request to the Wikipedia API.
 * All requests are serialised (one at a time, 300ms apart).
 * 429 responses are retried with exponential backoff without re-entering the queue. */
function queryApi(query) {
  const url = new URL(base);
  const params = { format: 'json', origin: '*', ...query };
  Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));
  return _enqueue(function() { return _fetchWithRetry(url, 6, 2000); });
}

/**
 * Get the title of a page from a URL quickly, but inaccurately (no redirects)
 */
const getPageTitleQuickly = url => url.split('/').filter(el => el).pop().split('#')[0];

/**
 * Get the name of a Wikipedia page accurately by following redirects (slow)
 */
function fetchPageTitle(page) {
  return queryApi({ action: 'query', titles: page, redirects: 1 })
    .then(res => Object.values(res.query.pages)[0].title);
}

/**
 * Decide whether the name of a wikipedia page is an article, or belongs to another namespace.
 * See https://en.wikipedia.org/wiki/Wikipedia:Namespace
 */
// Pages outside of main namespace have colons in the middle, e.g. 'WP:UA'
// Remove any trailing colons and return true if the result still contains a colon
const isArticle = name => !(name.endsWith(':') ? name.slice(0, -1) : name).includes(':');


// --- MAIN FUNCTIONS ---

/**
 * Get a DOM object for the HTML of a Wikipedia page.
 * Also returns information about any redirects that were followed.
 */
function getPageHtml(pageName) {
  return queryApi({ action: 'parse', page: pageName, prop: 'text', section: 0, redirects: 1 })
    .then(res => ({
      document: domParser.parseFromString(res.parse.text['*'], 'text/html'),
      redirectedTo: res.parse.redirects[0] ? res.parse.redirects[0].to : pageName,
    }));
}

/**
 * Get a DOM object for the first body paragraph in page HTML.
 * @param {HtmlElement} element - An HTML element as returned by `getPageHtml`
 */
const getFirstParagraph = element =>
  // First paragraph that isn't marked as "empty"...
  Array.from(element.querySelectorAll('.mw-parser-output > p:not(.mw-empty-elt)'))
    // ...and isn't the "coordinates" container
    .find(p => !p.querySelector('#coordinates'));

/**
 * Get the name of each Wikipedia article linked.
 * @param {HtmlElement} element - An HTML element as returned by `getFirstParagraph`
 */
function getWikiLinks(element) {
  const links = Array.from(element.querySelectorAll('a'))
    .map(link => link.getAttribute('href'))
    .filter(href => href && href.startsWith('/wiki/')) // Only links to Wikipedia articles
    .map(getPageTitleQuickly) // Get the title from the URL
    .filter(isArticle) // Make sure it's an article and not a part of another namespace
    .map(title => title.replace(/_/g, ' ')); // Replace underscores with spaces
  // Remove duplicates after normalizing
  const ids = links.map(getNormalizedId);
  const isUnique = ids.map((n, i) => ids.indexOf(n) === i); // 'true' in every spot that's unique
  return links.filter((n, i) => isUnique[i]);
}

/**
 * Given a page title, get the first paragraph links, as well as the name of the page it redirected
 * to.
 */
function getSubPages(pageName) {
  return getPageHtml(pageName).then(({ document: doc, redirectedTo }) => ({
    redirectedTo,
    links: getWikiLinks(getFirstParagraph(doc)),
  }));
}

/**
 * Sections to exclude from the table of contents
 */
const EXCLUDED_SECTIONS = [
  'see also',
  'notes',
  'references',
  'external links',
  'further reading',
  'bibliography',
  'sources',
  'citations',
];

/**
 * Get all section names from the Table of Contents of a Wikipedia page.
 * Returns a hierarchical structure where each section has its children.
 * Excludes standard footer sections like "See also", "References", etc.
 * @param {string} pageName - The name of the Wikipedia page
 * @returns {Promise<{redirectedTo: string, sections: Array<{name: string, children: string[]}>}>}
 */
function getPageSections(pageName) {
  return queryApi({
    action: 'parse',
    page: pageName,
    prop: 'sections',
    redirects: 1,
  }).then(res => {
    const redirectedTo = res.parse.redirects && res.parse.redirects[0]
      ? res.parse.redirects[0].to
      : pageName;
    
    // Build hierarchical structure
    const topLevelSections = [];
    let currentTopLevel = null;
    let excludeCurrentSection = false;
    
    // Build both the hierarchy and a name→index lookup in a single pass
    const sectionIndexMap = {};
    for (const section of res.parse.sections) {
      const sectionName = section.line.replace(/<[^>]*>/g, ''); // Strip HTML tags
      const sectionNameLower = sectionName.toLowerCase();
      const level = parseInt(section.toclevel, 10);
      sectionIndexMap[sectionName] = parseInt(section.index, 10);
      
      // Check if this is a top-level section (level 1)
      if (level === 1) {
        // Check if this section should be excluded
        if (EXCLUDED_SECTIONS.includes(sectionNameLower)) {
          excludeCurrentSection = true;
          currentTopLevel = null;
          continue;
        }
        
        excludeCurrentSection = false;
        currentTopLevel = { name: sectionName, children: [] };
        topLevelSections.push(currentTopLevel);
      } else if (level === 2 && currentTopLevel && !excludeCurrentSection) {
        // This is a subsection (level 2) - add as child of current top-level
        if (!EXCLUDED_SECTIONS.includes(sectionNameLower)) {
          currentTopLevel.children.push(sectionName);
        }
      }
      // Ignore deeper levels (level 3+) for now
    }
    
    return { redirectedTo, sections: topLevelSections, sectionIndexMap };
  });
}

/**
 * Get the section index for a given section name in an article
 * @param {string} pageName - The Wikipedia article name
 * @param {string} sectionName - The section name to find
 * @returns {Promise<number|null>} - The section index or null if not found
 */
function getSectionIndex(pageName, sectionName) {
  return queryApi({
    action: 'parse',
    page: pageName,
    prop: 'sections',
    redirects: 1,
  }).then(res => {
    for (const section of res.parse.sections) {
      const name = section.line.replace(/<[^>]*>/g, ''); // Strip HTML tags
      if (name.toLowerCase() === sectionName.toLowerCase()) {
        return parseInt(section.index, 10);
      }
    }
    return null;
  });
}

/**
 * Get links from a specific section of a Wikipedia article
 * Only returns links from the main content, excluding citations/references
 * @param {string} pageName - The Wikipedia article name (e.g., "Cat")
 * @param {string} sectionName - The section name (e.g., "Behavior")
 * @param {number} limit - Maximum number of links to return (default 10)
 * @returns {Promise<{links: string[]}>}
 */
function getSectionLinks(pageName, sectionName, limit = 10, knownIndex) {
  // If the caller already knows the section index (from getPageSections), use it directly
  // to avoid a redundant getSectionIndex API call.
  const indexPromise = (knownIndex !== undefined)
    ? Promise.resolve(knownIndex)
    : getSectionIndex(pageName, sectionName);
  return indexPromise.then(sectionIndex => {
    if (sectionIndex === null) {
      console.log(`Section "${sectionName}" not found in "${pageName}"`);
      return { links: [] };
    }
    
    return queryApi({
      action: 'parse',
      page: pageName,
      prop: 'text',
      section: sectionIndex,
      redirects: 1,
    }).then(res => {
      const doc = domParser.parseFromString(res.parse.text['*'], 'text/html');
      
      // Remove citation elements before extracting links
      // This includes <sup> tags (footnote markers), .reference, .citation, etc.
      const elementsToRemove = doc.querySelectorAll('sup, .reference, .citation, .mw-editsection, .noprint, .mw-cite-backlink');
      elementsToRemove.forEach(el => el.remove());
      
      // Get links only from paragraph tags (main content)
      const paragraphs = doc.querySelectorAll('p');
      const allLinks = [];
      
      paragraphs.forEach(p => {
        const links = Array.from(p.querySelectorAll('a'))
          .map(link => link.getAttribute('href'))
          .filter(href => href && href.startsWith('/wiki/'))
          .filter(href => !href.includes('#')) // Exclude anchor links within the same page
          .map(getPageTitleQuickly)
          .filter(isArticle)
          .map(title => title.replace(/_/g, ' '));
        allLinks.push(...links);
      });
      
      // Remove duplicates
      const ids = allLinks.map(getNormalizedId);
      const uniqueLinks = allLinks.filter((n, i) => ids.indexOf(ids[i]) === i);
      
      // Return first N links
      return { links: uniqueLinks.slice(0, limit) };
    });
  });
}

/**
 * Get the name of a random Wikipedia article
 */
function getRandomArticle() {
  return queryApi({
    action: 'query',
    list: 'random',
    rnlimit: 1,
    rnnamespace: 0, // Limits results to articles
  }).then(res => res.query.random[0].title);
}

/**
 * Get completion suggestions for a query
 */
function getSuggestions(search) {
  return queryApi({
    action: 'opensearch',
    search,
    limit: 10,
    namespace: 0, // Limits results to articles
  })
    .then(res => res[1]);
}
