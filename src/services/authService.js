import { pb } from './api.js';

export const authService = {
  async login(email, password) {
    const authData = await pb.collection('users').authWithPassword(email, password);
    if (authData.record.status === 'suspended') {
      this.logout();
      throw new Error('Your account has been suspended. Please contact the administrator.');
    }
    
    // Update last login (fire and forget)
    try {
      pb.collection('users').update(authData.record.id, { last_login: new Date().toISOString() });
    } catch(e) {}
    
    return authData;
  },

  logout() {
    pb.authStore.clear();
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
      await pb.collection('users').authRefresh();
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
  }
};
