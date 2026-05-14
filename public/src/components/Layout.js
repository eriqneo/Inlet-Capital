import { renderSidebar } from './Sidebar.js';
import { renderHeader } from './Header.js';

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
