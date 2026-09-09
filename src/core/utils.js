export const formatDate = (dateInput) => {
  if (!dateInput) return '—';
  const normalizedInput = typeof dateInput === 'string' ? dateInput.replace(' ', 'T') : dateInput;
  const d = new Date(normalizedInput);
  if (isNaN(d.getTime())) return '—';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
};

export const formatNumber = (value, decimals = 2) => {
  const number = Number(value);
  return (Number.isFinite(number) ? number : 0).toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
};

export const formatMoney = (value) => formatNumber(value, 2);

export const formatPercent = (value) => `${formatNumber(value, 2)}%`;

const extractDateParts = (dateInput) => {
  if (!dateInput) return null;

  if (dateInput instanceof Date) {
    if (Number.isNaN(dateInput.getTime())) return null;
    return {
      day: dateInput.getDate(),
      month: dateInput.getMonth() + 1,
      year: dateInput.getFullYear()
    };
  }

  const value = String(dateInput).trim();
  let day;
  let month;
  let year;

  const inputMatch = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (inputMatch) {
    day = Number(inputMatch[1]);
    month = Number(inputMatch[2]);
    year = Number(inputMatch[3]);
  } else {
    const isoMatch = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (!isoMatch) return null;
    year = Number(isoMatch[1]);
    month = Number(isoMatch[2]);
    day = Number(isoMatch[3]);
  }

  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) return null;
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;

  const normalizedDate = new Date(year, month - 1, day);
  if (
    normalizedDate.getFullYear() !== year ||
    normalizedDate.getMonth() + 1 !== month ||
    normalizedDate.getDate() !== day
  ) {
    return null;
  }

  return { day, month, year };
};

export const calculateAge = (dateInput, referenceDate = new Date()) => {
  const birth = extractDateParts(dateInput);
  const reference = extractDateParts(referenceDate);
  if (!birth || !reference) return null;

  let age = reference.year - birth.year;
  const birthdayHasPassed = reference.month > birth.month
    || (reference.month === birth.month && reference.day >= birth.day);
  if (!birthdayHasPassed) age -= 1;

  return age >= 0 ? age : null;
};

export const initDobAgeLabel = (inputElement, labelElement) => {
  if (!inputElement || !labelElement || inputElement.dataset.ageLabelBound === 'true') return;
  inputElement.dataset.ageLabelBound = 'true';

  const updateAgeLabel = () => {
    const value = inputElement.value.trim();
    const age = calculateAge(value);

    labelElement.classList.remove('text-success', 'text-danger', 'text-muted');
    if (!value) {
      labelElement.textContent = 'Age will appear after DOB is entered.';
      labelElement.classList.add('text-muted');
      return;
    }

    if (age === null) {
      labelElement.textContent = 'Enter a valid past date of birth.';
      labelElement.classList.add('text-danger');
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(value)) {
        inputElement.setCustomValidity('Please enter a valid past date of birth.');
      }
      return;
    }

    labelElement.textContent = `Age: ${age} ${age === 1 ? 'year' : 'years'} old`;
    labelElement.classList.add('text-success');
    inputElement.setCustomValidity('');
  };

  inputElement.addEventListener('input', updateAgeLabel);
  inputElement.addEventListener('change', updateAgeLabel);
  updateAgeLabel();
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
  const value = String(dateStr);
  const parts = value.split('/');
  if (parts.length === 3) {
    const day = parts[0].padStart(2, '0');
    const month = parts[1].padStart(2, '0');
    const year = parts[2];
    return `${year}-${month}-${day}`;
  }
  return value;
};

export const formatToInputDate = (dateStr) => {
  if (!dateStr) return '';
  const value = String(dateStr);
  if (value.includes('/')) return value;
  const parts = value.split('-');
  if (parts.length === 3) {
    const year = parts[0];
    const month = parts[1];
    const day = parts[2].split(/[T\s]/)[0];
    return `${day}/${month}/${year}`;
  }
  return value;
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
