import { renderSidebar } from './Sidebar.js';
import { renderHeader } from './Header.js';

let shellElement = null;
let pageContentElement = null;

export const withLayout = async (contentElement) => {
  const container = document.createElement('div');
  container.className = 'app-container';
  
  const sidebar = await renderSidebar();
  
  const mainContent = document.createElement('main');
  mainContent.className = 'main-content';
  
  const header = await renderHeader();
  
  const pageContent = document.createElement('div');
  pageContent.className = 'page-content';
  pageContent.appendChild(contentElement);
  
  mainContent.appendChild(header);
  mainContent.appendChild(pageContent);
  
  container.appendChild(sidebar);
  container.appendChild(mainContent);
  
  return container;
};

export const ensureAppShell = async (rootElement) => {
  if (shellElement && pageContentElement && rootElement.contains(shellElement)) {
    return pageContentElement;
  }

  const container = document.createElement('div');
  container.className = 'app-container';

  const sidebar = await renderSidebar();

  const mainContent = document.createElement('main');
  mainContent.className = 'main-content';

  const header = await renderHeader();

  const pageContent = document.createElement('div');
  pageContent.className = 'page-content';
  pageContent.id = 'route-content';

  mainContent.appendChild(header);
  mainContent.appendChild(pageContent);

  container.appendChild(sidebar);
  container.appendChild(mainContent);

  rootElement.innerHTML = '';
  rootElement.appendChild(container);

  shellElement = container;
  pageContentElement = pageContent;

  return pageContentElement;
};

export const destroyAppShell = (rootElement) => {
  shellElement = null;
  pageContentElement = null;
  rootElement.innerHTML = '';
};
