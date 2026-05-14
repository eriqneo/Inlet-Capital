import { getAll } from '../../core/db.js';
import { renderPagination } from '../../components/Pagination.js';

export const renderMemberList = async () => {
  const container = document.createElement('div');
  const members = await getAll('members');
  
  let currentPage = 1;
  const pageSize = 10;
  let filteredMembers = [...members];

  container.innerHTML = `
    <div style="margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center;">
      <div>
        <h1 class="text-xl">Members Management</h1>
        <p class="text-muted">View and manage all registered individuals.</p>
      </div>
      <button class="btn btn-primary" onclick="window.location.hash = '#/members/new'">+ Register Member</button>
    </div>

    <div class="card" style="padding: 0; overflow: hidden;">
      <div style="padding: 16px; border-bottom: 1px solid var(--border-color); display: flex; gap: 16px;">
        <input type="text" id="member-search" class="form-control" placeholder="Search by name, ID or Phone..." style="max-width: 400px;" />
      </div>
      
      <div class="table-responsive">
        <table class="table">
          <thead>
            <tr>
              <th>Member Details</th>
              <th>ID Number</th>
              <th>Phone</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="member-table-body">
            <!-- Table content will be injected here -->
          </tbody>
        </table>
      </div>
      <div id="pagination-wrapper"></div>
    </div>
  `;

  const tableBody = container.querySelector('#member-table-body');
  const paginationWrapper = container.querySelector('#pagination-wrapper');

  const updateUI = () => {
    const start = (currentPage - 1) * pageSize;
    const end = start + pageSize;
    const paginatedItems = filteredMembers.slice(start, end);

    tableBody.innerHTML = paginatedItems.length === 0 ? `
      <tr><td colspan="5" class="text-center text-muted" style="padding: 40px;">No members found.</td></tr>
    ` : paginatedItems.map(m => `
      <tr>
        <td>
          <div style="display: flex; align-items: center; gap: 12px;">
            <div style="width: 40px; height: 40px; background: var(--bg-light); border-radius: 50%; overflow: hidden; display: flex; align-items: center; justify-content: center;">
              ${m.passportPhoto ? `<img src="${m.passportPhoto}" style="width: 100%; height: 100%; object-fit: cover;" />` : `<span style="font-size: 20px;">👤</span>`}
            </div>
            <div>
              <div class="font-semibold">${m.fullName}</div>
              <div class="text-xs text-muted">${m.regNo}</div>
            </div>
          </div>
        </td>
        <td>${m.idNo}</td>
        <td>${m.phone}</td>
        <td><span class="badge ${m.status === 'active' ? 'badge-success' : 'badge-danger'}">${m.status}</span></td>
        <td>
          <button class="btn btn-outline btn-sm" onclick="window.location.hash = '#/members/${m.regNo}'">View Profile</button>
        </td>
      </tr>
    `).join('');

    paginationWrapper.innerHTML = '';
    const pagination = renderPagination(filteredMembers.length, pageSize, currentPage, (newPage) => {
      currentPage = newPage;
      updateUI();
    });
    if (pagination) paginationWrapper.appendChild(pagination);
  };

  // Initial render
  updateUI();

  // Search logic
  const searchInput = container.querySelector('#member-search');
  searchInput.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    filteredMembers = members.filter(m => 
      m.fullName.toLowerCase().includes(term) || 
      m.regNo.toLowerCase().includes(term) || 
      m.idNo.includes(term) || 
      m.phone.includes(term)
    );
    currentPage = 1;
    updateUI();
  });

  return container;
};
