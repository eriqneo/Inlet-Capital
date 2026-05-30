export const formatDate = (dateInput) => {
  if (!dateInput) return '—';
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return '—';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
};

export const initDateMask = (inputElement) => {
  if (!inputElement) return;
  inputElement.placeholder = 'dd/mm/yyyy';
  inputElement.maxLength = 10;
  
  inputElement.addEventListener('input', (e) => {
    let value = e.target.value.replace(/\D/g, '');
    let formatted = '';
    
    if (value.length > 0) {
      formatted += value.substring(0, 2);
      if (value.length > 2) {
        formatted += '/' + value.substring(2, 4);
        if (value.length > 4) {
          formatted += '/' + value.substring(4, 8);
        }
      }
    }
    e.target.value = formatted;
    
    // Quick validation pattern check
    if (formatted.length === 10) {
      const parts = formatted.split('/');
      const d = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10);
      const y = parseInt(parts[2], 10);
      if (d < 1 || d > 31 || m < 1 || m > 12 || y < 1900 || y > 2100) {
        inputElement.setCustomValidity('Please enter a valid calendar date.');
      } else {
        inputElement.setCustomValidity('');
      }
    } else {
      inputElement.setCustomValidity('');
    }
  });

  inputElement.addEventListener('blur', (e) => {
    const val = e.target.value;
    if (val && !/^\d{2}\/\d{2}\/\d{4}$/.test(val)) {
      inputElement.setCustomValidity('Please enter date in dd/mm/yyyy format.');
      inputElement.reportValidity();
    }
  });
};

export const parseInputDate = (dateStr) => {
  if (!dateStr) return '';
  const parts = dateStr.split('/');
  if (parts.length === 3) {
    const day = parts[0].padStart(2, '0');
    const month = parts[1].padStart(2, '0');
    const year = parts[2];
    return `${year}-${month}-${day}`;
  }
  return dateStr;
};

export const formatToInputDate = (dateStr) => {
  if (!dateStr) return '';
  if (dateStr.includes('/')) return dateStr;
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const year = parts[0];
    const month = parts[1];
    const day = parts[2].split('T')[0];
    return `${day}/${month}/${year}`;
  }
  return dateStr;
};

export const showLoader = () => {
  let loader = document.getElementById('global-loader');
  if (!loader) {
    loader = document.createElement('div');
    loader.id = 'global-loader';
    loader.innerHTML = `
      <div class="spinner"></div>
      <style>
        #global-loader {
          position: fixed; top: 0; left: 0; width: 100%; height: 100%;
          background: rgba(245, 247, 250, 0.7); z-index: 99999;
          display: flex; align-items: center; justify-content: center;
          backdrop-filter: blur(2px);
        }
        .spinner {
          width: 40px; height: 40px; border: 4px solid var(--border-color);
          border-top-color: var(--primary); border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }
        @keyframes spin { 100% { transform: rotate(360deg); } }
      </style>
    `;
    document.body.appendChild(loader);
  }
  loader.style.display = 'flex';
};

export const hideLoader = () => {
  const loader = document.getElementById('global-loader');
  if (loader) loader.style.display = 'none';
};
