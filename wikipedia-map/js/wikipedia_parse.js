/* global getNormalizedId */
const base = 'https://en.wikipedia.org/w/api.php';

const domParser = new DOMParser();

/* Make a request to the Wikipedia API */
function queryApi(query) {
  const url = new URL(base);
  const params = { format: 'json', origin: '*', ...query };
  Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));
  return fetch(url).then(response => response.json());
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
    
    for (const section of res.parse.sections) {
      const sectionName = section.line.replace(/<[^>]*>/g, ''); // Strip HTML tags
      const sectionNameLower = sectionName.toLowerCase();
      const level = parseInt(section.toclevel, 10);
      
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
    
    return { redirectedTo, sections: topLevelSections };
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
function getSectionLinks(pageName, sectionName, limit = 10) {
  return getSectionIndex(pageName, sectionName).then(sectionIndex => {
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
