/**
 * Premium Dialog System for Inlet Capital
 * Replaces native browser alert, confirm, and prompt dialogs with styled glassmorphic overlays.
 */

// Inject CSS styles for the Dialogs dynamically
const style = document.createElement('style');
style.textContent = `
  .dialog-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(15, 37, 69, 0.4);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    z-index: 99999;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    opacity: 0;
    transition: opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .dialog-overlay.show {
    opacity: 1;
  }

  .dialog-box {
    background: var(--bg-card, #ffffff);
    width: 100%;
    max-width: 440px;
    border-radius: 16px;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04), inset 0 0 0 1px rgba(255, 255, 255, 0.6);
    overflow: hidden;
    transform: scale(0.92);
    transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
    border-top: 5px solid var(--primary);
  }

  .dialog-overlay.show .dialog-box {
    transform: scale(1);
  }

  .dialog-box.success { border-top-color: var(--success, #10b981); }
  .dialog-box.danger { border-top-color: var(--danger, #ef4444); }
  .dialog-box.warning { border-top-color: var(--warning, #f59e0b); }
  .dialog-box.info { border-top-color: var(--primary, #1b3d72); }

  .dialog-content {
    padding: 28px 28px 24px;
  }

  .dialog-title {
    font-family: 'Outfit', sans-serif;
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--primary);
    margin-bottom: 12px;
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .dialog-message {
    font-family: 'Inter', sans-serif;
    font-size: 0.95rem;
    color: var(--text-muted);
    line-height: 1.6;
  }

  .dialog-input-wrapper {
    margin-top: 18px;
  }

  .dialog-input {
    width: 100%;
    padding: 12px 16px;
    border: 2px solid var(--border-color);
    border-radius: 8px;
    font-family: 'Inter', sans-serif;
    font-size: 0.95rem;
    color: var(--text-main);
    background: var(--bg-light);
    outline: none;
    transition: all 0.2s ease;
  }

  .dialog-input:focus {
    border-color: var(--primary);
    background: #ffffff;
    box-shadow: 0 0 0 3px rgba(27, 61, 114, 0.15);
  }

  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    padding: 16px 28px 24px;
    background: rgba(245, 247, 250, 0.5);
    border-top: 1px solid var(--border-color);
  }

  .dialog-btn {
    padding: 10px 20px;
    font-family: 'Inter', sans-serif;
    font-size: 0.9rem;
    font-weight: 600;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s ease;
    border: none;
  }

  .dialog-btn-cancel {
    background: transparent;
    color: var(--text-muted);
    border: 1px solid var(--border-color);
  }

  .dialog-btn-cancel:hover {
    background: var(--bg-light);
    color: var(--text-main);
  }

  .dialog-btn-confirm {
    background: var(--primary);
    color: #ffffff;
  }

  .dialog-btn-confirm:hover {
    background: var(--primary-light);
  }

  .dialog-box.success .dialog-btn-confirm { background: var(--success); }
  .dialog-box.success .dialog-btn-confirm:hover { filter: brightness(0.9); }
  .dialog-box.danger .dialog-btn-confirm { background: var(--danger); }
  .dialog-box.danger .dialog-btn-confirm:hover { filter: brightness(0.9); }
  .dialog-box.warning .dialog-btn-confirm { background: var(--warning); color: #000; }
  .dialog-box.warning .dialog-btn-confirm:hover { filter: brightness(0.9); }
`;
document.head.appendChild(style);

/**
 * Show premium Confirm dialog modal
 */
export const confirmDialog = ({
  title = 'Confirmation Required',
  message = 'Are you sure you want to proceed?',
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  type = 'info' // success, danger, warning, info
}) => {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';

    const icons = {
      success: '✓',
      danger: '⚠',
      warning: '⚠',
      info: 'ℹ'
    };

    overlay.innerHTML = `
      <div class="dialog-box ${type}">
        <div class="dialog-content">
          <h3 class="dialog-title">
            <span class="dialog-icon">${icons[type] || '🔔'}</span>
            ${title}
          </h3>
          <p class="dialog-message">${message}</p>
        </div>
        <div class="dialog-actions">
          <button class="dialog-btn dialog-btn-cancel">${cancelText}</button>
          <button class="dialog-btn dialog-btn-confirm">${confirmText}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Trigger open animation
    requestAnimationFrame(() => overlay.classList.add('show'));

    const cleanup = (value) => {
      overlay.classList.remove('show');
      overlay.addEventListener('transitionend', () => {
        overlay.remove();
        resolve(value);
      });
    };

    overlay.querySelector('.dialog-btn-cancel').onclick = () => cleanup(false);
    overlay.querySelector('.dialog-btn-confirm').onclick = () => cleanup(true);

    // Close on overlay click (optional, but let's keep it safe)
    overlay.onclick = (e) => {
      if (e.target === overlay) cleanup(false);
    };
  });
};

/**
 * Show premium Prompt dialog modal
 */
export const promptDialog = ({
  title = 'Input Required',
  message = 'Please enter a value:',
  placeholder = 'Type here...',
  required = false,
  confirmText = 'Submit',
  cancelText = 'Cancel'
}) => {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';

    overlay.innerHTML = `
      <div class="dialog-box info">
        <div class="dialog-content">
          <h3 class="dialog-title">
            <span class="dialog-icon">✏️</span>
            ${title}
          </h3>
          <p class="dialog-message">${message}</p>
          <div class="dialog-input-wrapper">
            <input type="text" class="dialog-input" placeholder="${placeholder}" autocomplete="off" />
          </div>
        </div>
        <div class="dialog-actions">
          <button class="dialog-btn dialog-btn-cancel">${cancelText}</button>
          <button class="dialog-btn dialog-btn-confirm">${confirmText}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const input = overlay.querySelector('.dialog-input');
    
    // Focus input field automatically
    requestAnimationFrame(() => {
      overlay.classList.add('show');
      setTimeout(() => input.focus(), 150);
    });

    const cleanup = (value) => {
      overlay.classList.remove('show');
      overlay.addEventListener('transitionend', () => {
        overlay.remove();
        resolve(value);
      });
    };

    const handleConfirm = () => {
      const value = input.value.trim();
      if (required && !value) {
        input.style.borderColor = 'var(--danger)';
        input.animate([
          { transform: 'translateX(0)' },
          { transform: 'translateX(-5px)' },
          { transform: 'translateX(5px)' },
          { transform: 'translateX(-5px)' },
          { transform: 'translateX(5px)' },
          { transform: 'translateX(0)' }
        ], { duration: 300 });
        return;
      }
      cleanup(value || null);
    };

    overlay.querySelector('.dialog-btn-cancel').onclick = () => cleanup(null);
    overlay.querySelector('.dialog-btn-confirm').onclick = handleConfirm;

    // Enter key support
    input.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleConfirm();
      } else if (e.key === 'Escape') {
        cleanup(null);
      }
    };

    overlay.onclick = (e) => {
      if (e.target === overlay) cleanup(null);
    };
  });
};

// Bind to window for global convenience, similar to window.notify
window.confirmDialog = confirmDialog;
window.promptDialog = promptDialog;
