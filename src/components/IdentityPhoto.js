const escapeAttribute = (value) => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

export const renderIdentityPhoto = (src, name = 'Member') => `
  <button type="button" class="identity-photo" aria-label="View photo of ${escapeAttribute(name)}" aria-expanded="false" aria-controls="identity-photo-preview">
    <img src="${escapeAttribute(src)}" alt="${escapeAttribute(name)}" loading="lazy" decoding="async" />
  </button>
`;

export const initIdentityPhotoPreview = () => {
  if (document.getElementById('identity-photo-preview')) return;
  // Mount outside cards and scrollable tables so their overflow cannot clip the photo.
  const preview = document.createElement('div');
  preview.id = 'identity-photo-preview';
  preview.className = 'identity-photo-preview';
  preview.hidden = true;
  preview.setAttribute('role', 'region');
  preview.setAttribute('aria-label', 'Identity photo');
  preview.innerHTML = `
    <div class="identity-photo-preview__image"><img alt="" /><span role="status" hidden>Photo unavailable</span></div>
    <div class="identity-photo-preview__footer"><span></span><button type="button" aria-label="Close photo preview" title="Close photo preview">&times;</button></div>
  `;
  document.body.appendChild(preview);
  const image = preview.querySelector('img');
  const error = preview.querySelector('[role="status"]');
  const caption = preview.querySelector('.identity-photo-preview__footer > span');
  const closeButton = preview.querySelector('button');
  let active = null;
  let pinned = false;
  let closeTimer;
  let restoringFocus = false;

  const observer = new MutationObserver(() => {
    if (active && (!active.isConnected || !active.getClientRects().length)) close();
  });
  const close = (restoreFocus = false) => {
    clearTimeout(closeTimer);
    observer.disconnect();
    const previous = active;
    active = null;
    pinned = false;
    preview.hidden = true;
    image.removeAttribute('src');
    image.alt = '';
    caption.textContent = '';
    previous?.setAttribute('aria-expanded', 'false');
    if (restoreFocus && previous?.isConnected) {
      restoringFocus = true;
      previous.focus({ preventScroll: true });
      restoringFocus = false;
    }
  };
  const show = (trigger) => {
    clearTimeout(closeTimer);
    if (active === trigger) return;
    close();
    active = trigger;
    const source = trigger.querySelector('img');
    image.hidden = false;
    error.hidden = true;
    image.src = source.currentSrc || source.src;
    image.alt = source.alt;
    caption.textContent = source.alt;
    trigger.setAttribute('aria-expanded', 'true');
    preview.hidden = false;

    const anchor = trigger.getBoundingClientRect();
    const bounds = { width: preview.offsetWidth, height: preview.offsetHeight };
    const margin = 12;
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight;
    let left = anchor.right + margin;
    if (left + bounds.width > viewportWidth - margin) left = anchor.left - bounds.width - margin;
    left = Math.max(margin, Math.min(left, viewportWidth - bounds.width - margin));
    const top = Math.max(margin, Math.min(anchor.top + anchor.height / 2 - bounds.height / 2, viewportHeight - bounds.height - margin));
    preview.style.left = `${left}px`;
    preview.style.top = `${top}px`;
    observer.observe(document.body, { childList: true, subtree: true });
  };
  const scheduleClose = () => {
    clearTimeout(closeTimer);
    if (pinned) return;
    closeTimer = setTimeout(() => {
      if (active && document.activeElement !== active && !preview.contains(document.activeElement)) close();
    }, 140);
  };
  const getTrigger = (target) => target instanceof Element ? target.closest('.identity-photo') : null;

  image.addEventListener('error', () => {
    if (!active) return;
    image.hidden = true;
    error.hidden = false;
  });
  document.addEventListener('pointerover', event => {
    if (event.pointerType !== 'mouse') return;
    const trigger = getTrigger(event.target);
    if (trigger && !trigger.contains(event.relatedTarget)) show(trigger);
    if (preview.contains(event.target)) clearTimeout(closeTimer);
  });
  document.addEventListener('pointerout', event => {
    if (event.pointerType !== 'mouse') return;
    if ((active?.contains(event.target) || preview.contains(event.target))
      && !active?.contains(event.relatedTarget) && !preview.contains(event.relatedTarget)) scheduleClose();
  });
  document.addEventListener('focusin', event => {
    if (restoringFocus) return;
    const trigger = getTrigger(event.target);
    if (trigger) show(trigger);
  });
  document.addEventListener('focusout', event => {
    if (active && !active.contains(event.relatedTarget) && !preview.contains(event.relatedTarget)) close();
  });
  document.addEventListener('click', event => {
    const trigger = getTrigger(event.target);
    if (!trigger) return;
    event.preventDefault();
    if (active === trigger && pinned) close();
    else {
      show(trigger);
      pinned = true;
    }
  });
  document.addEventListener('pointerdown', event => {
    if (active && !active.contains(event.target) && !preview.contains(event.target)) close();
  });
  document.addEventListener('keydown', event => {
    if (active && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(preview.contains(document.activeElement));
    }
  }, true);
  closeButton.addEventListener('click', () => close(true));
  document.addEventListener('scroll', () => close(), { capture: true, passive: true });
  window.addEventListener('resize', () => close());
  window.addEventListener('hashchange', () => close());
};
