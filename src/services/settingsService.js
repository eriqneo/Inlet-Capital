import { pb } from './api.js';

export const settingsService = {
  /**
   * Get all settings as a key-value object
   */
  async getAll() {
    const records = await pb.collection('settings').getFullList();
    return Object.fromEntries(records.map(r => [r.key, r.value]));
  },

  /**
   * Get all settings along with their last modified timestamps
   */
  async getTimestamps() {
    try {
      const records = await pb.collection('settings').getFullList();
      return Object.fromEntries(records.map(r => [r.key, r.updated]));
    } catch (e) {
      return {};
    }
  },

  /**
   * Get a single setting value by key
   */
  async get(key) {
    try {
      const record = await pb.collection('settings').getFirstListItem(`key="${key}"`);
      return record.value;
    } catch (e) {
      return null;
    }
  },

  /**
   * Upsert a setting
   */
  async save(key, value) {
    try {
      const existing = await pb.collection('settings').getFirstListItem(`key="${key}"`);
      return await pb.collection('settings').update(existing.id, { value: String(value) });
    } catch (e) {
      // Doesn't exist, create it
      return await pb.collection('settings').create({ key, value: String(value) });
    }
  },

  /**
   * Bulk save multiple settings from an object
   */
  async saveBulk(obj) {
    const promises = Object.entries(obj).map(([key, value]) => this.save(key, value));
    return await Promise.all(promises);
  }
};
