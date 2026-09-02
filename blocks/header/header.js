import { getMetadata } from '../../scripts/aem.js';
import { loadFragment } from '../fragment/fragment.js';

const isDesktop = window.matchMedia('(min-width: 900px)');
const DYNAMIC_NAV_LIMIT = 10;

/**
 * Expands nav links ending in "/*" (e.g. /home/newsroom/stories/*) into a
 * live list of matching pages from query-index.json, newest first, so
 * authors don't have to hand-maintain a list of articles in the nav doc.
 * @param {Element} nav The decorated nav element
 */
async function expandDynamicNavLinks(nav) {
  const dynamicLinks = [...nav.querySelectorAll('a[href$="/*"]')];
  if (dynamicLinks.length === 0) return;

  let pages;
  try {
    const res = await fetch('/query-index.json');
    if (!res.ok) return;
    ({ data: pages } = await res.json());
  } catch {
    return;
  }

  dynamicLinks.forEach((link) => {
    const prefix = link.getAttribute('href').slice(0, -2);
    const matches = pages
      .filter((p) => p.path.startsWith(`${prefix}/`))
      .sort((a, b) => (b.lastModified || 0) - (a.lastModified || 0))
      .slice(0, DYNAMIC_NAV_LIMIT);

    const li = link.closest('li');
    if (!li || matches.length === 0) return;
    const items = matches.map((p) => {
      const item = document.createElement('li');
      const a = document.createElement('a');
      a.href = p.path;
      a.textContent = p.title || p.path;
      item.append(a);
      return item;
    });
    li.replaceWith(...items);
  });
}

function closeAllFlyouts(nav) {
  nav.querySelectorAll('.nav-item[aria-expanded="true"]').forEach((li) => {
    li.setAttribute('aria-expanded', 'false');
  });
}

function toggleMobileMenu(nav, forceClose) {
  const open = forceClose ? false : nav.getAttribute('aria-expanded') !== 'true';
  nav.setAttribute('aria-expanded', open ? 'true' : 'false');
  document.body.classList.toggle('nav-open', open);
  if (!open) closeAllFlyouts(nav);
}

/**
 * loads and decorates the header nav
 * @param {Element} block The header block element
 */
export default async function decorate(block) {
  const navMeta = getMetadata('nav');
  const navPath = navMeta ? new URL(navMeta, window.location).pathname : '/nav';
  const fragment = await loadFragment(navPath);

  block.textContent = '';
  const nav = document.createElement('nav');
  nav.id = 'nav';
  nav.setAttribute('aria-label', 'Main navigation');
  while (fragment.firstElementChild) nav.append(fragment.firstElementChild);
  await expandDynamicNavLinks(nav);

  const sections = ['brand', 'sections', 'tools'];
  sections.forEach((c, i) => {
    const section = nav.children[i];
    if (section) section.classList.add(`nav-${c}`);
  });

  // Brand logo link
  const navBrand = nav.querySelector('.nav-brand');
  if (navBrand) {
    const brandLink = navBrand.querySelector('a');
    if (brandLink) brandLink.classList.add('nav-logo');
  }

  // Primary nav items with flyout panels
  const navSections = nav.querySelector('.nav-sections');
  if (navSections) {
    const topList = navSections.querySelector('ul');
    if (topList) topList.classList.add('nav-list');
    navSections.querySelectorAll(':scope ul > li').forEach((li) => {
      // only treat top-level <li> (direct children of the primary list)
      if (li.parentElement !== topList) return;
      const submenu = li.querySelector(':scope > ul');
      li.classList.add('nav-item');
      if (submenu) {
        li.classList.add('nav-drop');
        li.setAttribute('aria-expanded', 'false');
        // Toggle button (the "+" affordance from source)
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'nav-item-toggle';
        const labelLink = li.querySelector(':scope > a, :scope > p > a');
        toggle.setAttribute('aria-label', labelLink?.textContent || 'Toggle submenu');
        li.insertBefore(toggle, submenu);
        // Desktop: hover opens; click toggle expands (mobile)
        li.addEventListener('mouseenter', () => {
          if (isDesktop.matches) {
            closeAllFlyouts(nav);
            li.setAttribute('aria-expanded', 'true');
          }
        });
        li.addEventListener('mouseleave', () => {
          if (isDesktop.matches) li.setAttribute('aria-expanded', 'false');
        });
        toggle.addEventListener('click', (e) => {
          e.preventDefault();
          const expanded = li.getAttribute('aria-expanded') === 'true';
          if (!isDesktop.matches) closeAllFlyouts(nav);
          li.setAttribute('aria-expanded', expanded ? 'false' : 'true');
        });
      }
    });
  }

  // Tools section: mark worldwide + login, build search control
  const navTools = nav.querySelector('.nav-tools');
  if (navTools) {
    const links = [...navTools.querySelectorAll('a')];
    links.forEach((a) => {
      if (/worldwide/i.test(a.getAttribute('href') || '')) a.classList.add('nav-worldwide');
      if (/login/i.test(a.textContent)) a.classList.add('nav-login');
    });
    // Search button (built in JS per DA-flat contract)
    const searchLi = document.createElement('li');
    const searchBtn = document.createElement('button');
    searchBtn.type = 'button';
    searchBtn.className = 'nav-search-btn';
    searchBtn.setAttribute('aria-label', 'Search');
    searchLi.append(searchBtn);
    const toolsList = navTools.querySelector('ul');
    if (toolsList) toolsList.prepend(searchLi);
  }

  // Hamburger for mobile
  const hamburger = document.createElement('div');
  hamburger.classList.add('nav-hamburger');
  hamburger.innerHTML = `<button type="button" aria-controls="nav" aria-label="Open navigation">
      <span class="nav-hamburger-icon"></span>
    </button>`;
  hamburger.addEventListener('click', () => toggleMobileMenu(nav));
  nav.prepend(hamburger);
  nav.setAttribute('aria-expanded', 'false');

  // Close flyouts on outside click / escape
  document.addEventListener('click', (e) => {
    if (isDesktop.matches && !nav.contains(e.target)) closeAllFlyouts(nav);
  });
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') {
      closeAllFlyouts(nav);
      if (!isDesktop.matches) toggleMobileMenu(nav, true);
    }
  });

  // Reset state when crossing the breakpoint
  isDesktop.addEventListener('change', () => {
    closeAllFlyouts(nav);
    toggleMobileMenu(nav, true);
  });

  const navWrapper = document.createElement('div');
  navWrapper.className = 'nav-wrapper';
  navWrapper.append(nav);
  block.append(navWrapper);
}
