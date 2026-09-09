export const setButtonLoading = (button, label = 'Saving...') => {
  if (!button) return () => {};

  const originalHtml = button.innerHTML;
  const originalDisabled = button.disabled;

  button.disabled = true;
  button.innerHTML = label;

  return () => {
    button.disabled = originalDisabled;
    button.innerHTML = originalHtml;
  };
};

export const showDelayedLoading = (renderLoading, delay = 180) => {
  let active = true;
  const timer = setTimeout(() => {
    if (active) renderLoading();
  }, delay);

  return () => {
    active = false;
    clearTimeout(timer);
  };
};

export const DATABASE_LOADING_LABEL = 'Fetching records from Inlet Database';

export const renderDatabaseLoaderIcon = () => `
  <span class="database-loader-icon" aria-hidden="true">
    <span></span>
  </span>
`;

export const renderTableSkeletonRows = (columns = 4, rows = 6) => (
  Array.from({ length: rows }, () => `
    <tr class="skeleton-row">
      ${Array.from({ length: columns }, (_, index) => `
        <td><span class="skeleton-line ${index === 0 ? 'wide' : ''}"></span></td>
      `).join('')}
    </tr>
  `).join('')
);

export const renderCardSkeleton = ({ title = DATABASE_LOADING_LABEL, rows = 4 } = {}) => `
  <div class="card skeleton-card" aria-busy="true">
    <div class="skeleton-status">
      ${renderDatabaseLoaderIcon()}
      <span>${title}</span>
    </div>
    ${Array.from({ length: rows }, (_, index) => `
      <span class="skeleton-line ${index === 0 ? 'wide' : ''}"></span>
    `).join('')}
  </div>
`;

export const renderInlineSyncStatus = (label = DATABASE_LOADING_LABEL) => `
  <span class="inline-sync-status">
    ${renderDatabaseLoaderIcon()}
    ${label}
  </span>
`;
