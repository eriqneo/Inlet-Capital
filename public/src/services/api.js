import PocketBase from 'pocketbase';

const PB_URL = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
  ? 'https://inletcapital.pockethost.io' // Even on localhost we connect to PocketHost for now
  : 'https://inletcapital.pockethost.io';

export const pb = new PocketBase(PB_URL);

// Auto-cancel duplicate requests
pb.autoCancellation(false);

// Listen for auth state changes globally
pb.authStore.onChange((token, model) => {
  if (!token) {
    // Session expired or user logged out
    window.location.hash = '#/login';
  }
});

// Centralized error handler
export const handleApiError = (error, context = '') => {
  console.error(`API Error [${context}]:`, error);

  if (window.notify) {
    if (error.status === 400) {
      // Validation error — show field-level messages
      const messages = Object.entries(error.data?.data || {})
        .map(([field, err]) => `${field}: ${err.message}`)
        .join('\n');
      window.notify.error(messages || 'Invalid data submitted.');
    } else if (error.status === 401) {
      window.notify.error('Session expired. Please log in again.');
      pb.authStore.clear();
      window.location.hash = '#/login';
    } else if (error.status === 403) {
      window.notify.error('You do not have permission to perform this action.');
    } else if (error.status === 404) {
      window.notify.error('Record not found.');
    } else if (!navigator.onLine) {
      window.notify.warning('You are offline. This action has been queued.');
    } else {
      window.notify.error('Something went wrong. Please try again.');
    }
  }
};

// Utility: one-at-a-time button guard
export const withSubmitGuard = (button, asyncFn) => {
  button.addEventListener('click', async (e) => {
    e.preventDefault();
    if (button.disabled) return;
    button.disabled = true;
    const originalText = button.textContent;
    button.textContent = 'Processing...';
    try {
      await asyncFn();
    } catch (err) {
      handleApiError(err);
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  });
};
