import { pb } from './api.js';
import { dataCache } from './dataCache.js';

const getSettingValue = (record) => {
  if (record?.key === 'org_logo' && record.file_value) {
    return pb.files.getURL(record, record.file_value);
  }
  return record?.value ?? '';
};

const parseNumberSetting = (value, fallback) => {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const dataUrlToBlob = async (dataUrl) => {
  const response = await fetch(dataUrl);
  return await response.blob();
};

export const settingsService = {
  async getRecords() {
    return await dataCache.get('settings:records', () => pb.collection('settings').getFullList());
  },

  /**
   * Get all settings as a key-value object
   */
  async getAll() {
    const records = await this.getRecords();
    return Object.fromEntries(records.map(r => [r.key, getSettingValue(r)]));
  },

  /**
   * Get all settings along with their last modified timestamps
   */
  async getTimestamps() {
    try {
      const records = await this.getRecords();
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
      return getSettingValue(record);
    } catch (e) {
      return null;
    }
  },

  async getNumber(key, fallback = 0) {
    const value = await this.get(key);
    return parseNumberSetting(value, fallback);
  },

  /**
   * Upsert a setting
   */
  async save(key, value) {
    if (key === 'org_logo' && String(value || '').startsWith('data:image/')) {
      return await this.saveLogo(value);
    }

    try {
      const existing = await pb.collection('settings').getFirstListItem(`key="${key}"`);
      const record = await pb.collection('settings').update(existing.id, { value: String(value) });
      await dataCache.invalidatePrefix('settings:');
      return record;
    } catch (e) {
      if (e?.status && e.status !== 404) throw e;
      // Doesn't exist, create it
      const record = await pb.collection('settings').create({ key, value: String(value) });
      await dataCache.invalidatePrefix('settings:');
      return record;
    }
  },

  async saveLogo(dataUrl) {
    const blob = await dataUrlToBlob(dataUrl);
    const extension = blob.type === 'image/png' ? 'png' : (blob.type === 'image/jpeg' ? 'jpg' : 'webp');
    const formData = new FormData();
    formData.append('key', 'org_logo');
    formData.append('value', '');
    formData.append('file_value', blob, `org-logo.${extension}`);

    try {
      const existing = await pb.collection('settings').getFirstListItem('key="org_logo"');
      const record = await pb.collection('settings').update(existing.id, formData);
      await dataCache.invalidatePrefix('settings:');
      return record;
    } catch (e) {
      if (e?.status && e.status !== 404) throw e;
      const record = await pb.collection('settings').create(formData);
      await dataCache.invalidatePrefix('settings:');
      return record;
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
