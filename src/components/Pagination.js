/**
 * Generic Pagination Component for INlet
 * @param {Array} items - All items to paginate
 * @param {number} pageSize - Items per page
 * @param {number} currentPage - Current page (1-indexed)
 * @param {Function} onPageChange - Callback when page changes
 * @returns {string} - HTML string for pagination controls
 */
export const renderPagination = (totalItems, pageSize, currentPage, onPageChange) => {
  const totalPages = Math.ceil(totalItems / pageSize);
  if (totalPages <= 1) return '';

  const startIdx = (currentPage - 1) * pageSize + 1;
  const endIdx = Math.min(currentPage * pageSize, totalItems);

  const getCompactPages = () => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, index) => index + 1);
    }

    const pageSet = new Set([1, totalPages]);
    for (let page = currentPage - 1; page <= currentPage + 1; page++) {
      if (page > 1 && page < totalPages) pageSet.add(page);
    }
    if (currentPage <= 3) {
      pageSet.add(2);
      pageSet.add(3);
      pageSet.add(4);
    }
    if (currentPage >= totalPages - 2) {
      pageSet.add(totalPages - 1);
      pageSet.add(totalPages - 2);
      pageSet.add(totalPages - 3);
    }

    const sortedPages = Array.from(pageSet).sort((a, b) => a - b);
    return sortedPages.reduce((items, page, index) => {
      const previous = sortedPages[index - 1];
      if (previous && page - previous > 1) items.push('ellipsis');
      items.push(page);
      return items;
    }, []);
  };

  const pages = getCompactPages();

  const container = document.createElement('div');
  container.className = 'pagination-container no-print';
  container.innerHTML = `
    <div class="pagination-info">
      Showing <b>${startIdx}</b> to <b>${endIdx}</b> of <b>${totalItems}</b> results
    </div>
    <div class="pagination-controls">
      <button class="pagination-btn pagination-arrow" ${currentPage === 1 ? 'disabled' : ''} id="prev-page">Prev</button>
      ${pages.map(p => `
        ${p === 'ellipsis'
          ? '<span class="pagination-ellipsis" style="padding: 0 4px; color: var(--text-muted);">...</span>'
          : `<button class="pagination-btn ${p === currentPage ? 'active' : ''}" data-page="${p}">${p}</button>`}
      `).join('')}
      <button class="pagination-btn pagination-arrow" ${currentPage === totalPages ? 'disabled' : ''} id="next-page">Next</button>
    </div>
  `;

  // Attach events
  container.querySelectorAll('.pagination-btn').forEach(btn => {
    btn.onclick = () => {
      if (btn.id === 'prev-page') onPageChange(currentPage - 1);
      else if (btn.id === 'next-page') onPageChange(currentPage + 1);
      else if (btn.dataset.page) onPageChange(parseInt(btn.dataset.page));
    };
  });

  return container;
};
