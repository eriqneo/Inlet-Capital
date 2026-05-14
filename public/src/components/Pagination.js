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

  let pages = [];
  // Simple logic for page numbers (can be refined to show ellipsis if many pages)
  for (let i = 1; i <= totalPages; i++) {
    pages.push(i);
  }

  const container = document.createElement('div');
  container.className = 'pagination-container no-print';
  container.innerHTML = `
    <div class="pagination-info">
      Showing <b>${startIdx}</b> to <b>${endIdx}</b> of <b>${totalItems}</b> results
    </div>
    <div class="pagination-controls">
      <button class="pagination-btn pagination-arrow" ${currentPage === 1 ? 'disabled' : ''} id="prev-page">Previous</button>
      ${pages.map(p => `
        <button class="pagination-btn ${p === currentPage ? 'active' : ''}" data-page="${p}">${p}</button>
      `).join('')}
      <button class="pagination-btn pagination-arrow" ${currentPage === totalPages ? 'disabled' : ''} id="next-page">Next</button>
    </div>
  `;

  // Attach events
  container.querySelectorAll('.pagination-btn').forEach(btn => {
    btn.onclick = () => {
      if (btn.id === 'prev-page') onPageChange(currentPage - 1);
      else if (btn.id === 'next-page') onPageChange(currentPage + 1);
      else onPageChange(parseInt(btn.dataset.page));
    };
  });

  return container;
};
