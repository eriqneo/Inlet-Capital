import { pb } from './api.js';

const INACTIVITY_TIMEOUT_MS = 60 * 60 * 1000;
const LAST_ACTIVITY_KEY = 'inlet_last_activity_at';
let inactivityTimer = null;
let inactivityWatchStarted = false;

const now = () => Date.now();

export const authService = {
  async login(email, password) {
    const authData = await pb.collection('users').authWithPassword(email, password);
    if (authData.record.status === 'suspended') {
      this.logout();
      throw new Error('Your account has been suspended. Please contact the administrator.');
    }
    
    try {
      const loginAt = new Date().toISOString();
      await pb.collection('user_login_activity').create({
        user: authData.record.id,
        login_at: loginAt,
        user_email: authData.record.email || email,
        user_name: authData.record.name || authData.record.username || ''
      });
    } catch(e) {
      console.warn('[authService] Failed to record login activity:', e);
    }
    
    this.markActivity();
    this.startInactivityWatch();
    return authData;
  },

  logout({ reason = '' } = {}) {
    pb.authStore.clear();
    localStorage.removeItem(LAST_ACTIVITY_KEY);
    if (window.notify && reason === 'inactivity') {
      window.notify.warning('You were logged out after 1 hour of inactivity.');
    }
    window.location.hash = '#/login';
  },

  getUser() {
    return pb.authStore.model;
  },

  getToken() {
    return pb.authStore.token;
  },

  isAuthenticated() {
    return pb.authStore.isValid;
  },

  hasRole(...roles) {
    const user = this.getUser();
    return user && roles.includes(user.role);
  },

  requireRole(...roles) {
    if (!this.hasRole(...roles)) {
      throw new Error('Access denied: insufficient permissions');
    }
  },

  async refreshSession() {
    try {
      if (this.isInactiveExpired()) {
        this.logout({ reason: 'inactivity' });
        return false;
      }
      await pb.collection('users').authRefresh();
      this.markActivity();
      this.startInactivityWatch();
      return true;
    } catch (err) {
      const status = err?.status;
      if (status === 401 || status === 403) {
        this.logout();
        return false;
      }

      console.warn('[authService] Session refresh skipped; keeping current session:', err);
      return true;
    }
  },

  async resetPassword(email) {
    return await pb.collection('users').requestPasswordReset(email);
  },

  async changeOwnPassword(currentPassword, newPassword) {
    const user = this.getUser();
    if (!user?.id) throw new Error('You must be logged in to change your password.');
    const record = await pb.collection('users').update(user.id, {
      oldPassword: currentPassword,
      password: newPassword,
      passwordConfirm: newPassword,
      force_password_change: false,
      password_changed_at: new Date().toISOString()
    });
    await pb.collection('users').authWithPassword(user.email, newPassword);
    return record;
  },

  async suspendUser(id) {
    return await pb.collection('users').update(id, { status: 'suspended' });
  },

  async activateUser(id) {
    return await pb.collection('users').update(id, { status: 'active' });
  },

  async updateUser(id, data) {
    return await pb.collection('users').update(id, data);
  },

  async deleteUser(id) {
    return await pb.collection('users').delete(id);
  },

  onAuthChange(callback) {
    pb.authStore.onChange(callback);
  },

  markActivity() {
    if (!this.isAuthenticated()) return;
    localStorage.setItem(LAST_ACTIVITY_KEY, String(now()));
    this.scheduleInactivityLogout();
  },

  getLastActivityAt() {
    return Number(localStorage.getItem(LAST_ACTIVITY_KEY) || 0);
  },

  isInactiveExpired() {
    if (!this.isAuthenticated()) return false;
    const lastActivityAt = this.getLastActivityAt();
    if (!lastActivityAt) return false;
    return now() - lastActivityAt >= INACTIVITY_TIMEOUT_MS;
  },

  scheduleInactivityLogout() {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    if (!this.isAuthenticated()) return;

    const lastActivityAt = this.getLastActivityAt() || now();
    const remainingMs = Math.max(0, INACTIVITY_TIMEOUT_MS - (now() - lastActivityAt));
    inactivityTimer = setTimeout(() => {
      if (this.isInactiveExpired()) {
        this.logout({ reason: 'inactivity' });
      } else {
        this.scheduleInactivityLogout();
      }
    }, remainingMs + 250);
  },

  startInactivityWatch() {
    if (inactivityWatchStarted) {
      this.scheduleInactivityLogout();
      return;
    }
    inactivityWatchStarted = true;

    const activityEvents = ['click', 'keydown', 'mousemove', 'scroll', 'touchstart', 'focus'];
    let lastRecordedAt = 0;
    const recordActivity = () => {
      if (!this.isAuthenticated()) return;
      const currentTime = now();
      if (currentTime - lastRecordedAt < 10000) return;
      lastRecordedAt = currentTime;
      this.markActivity();
    };

    activityEvents.forEach(eventName => {
      window.addEventListener(eventName, recordActivity, { passive: true });
    });

    document.addEventListener('visibilitychange', () => {
      if (!this.isAuthenticated()) return;
      if (this.isInactiveExpired()) {
        this.logout({ reason: 'inactivity' });
      } else if (!document.hidden) {
        this.markActivity();
      }
    });

    window.addEventListener('storage', (event) => {
      if (event.key === LAST_ACTIVITY_KEY) this.scheduleInactivityLogout();
    });

    if (this.isAuthenticated() && !this.getLastActivityAt()) {
      this.markActivity();
    }
    this.scheduleInactivityLogout();
  }
};
