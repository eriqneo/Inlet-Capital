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
