const DB_NAME = 'inlet_capital_db';
const DB_VERSION = 4;

export const openDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      
      if (!db.objectStoreNames.contains('users')) {
        db.createObjectStore('users', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('members')) {
        db.createObjectStore('members', { keyPath: 'regNo' });
      }
      if (!db.objectStoreNames.contains('groups')) {
        db.createObjectStore('groups', { keyPath: 'groupId' });
      }
      if (!db.objectStoreNames.contains('group_members')) {
        const store = db.createObjectStore('group_members', { keyPath: 'id', autoIncrement: true });
        store.createIndex('groupId', 'groupId', { unique: false });
        store.createIndex('memberId', 'memberId', { unique: false });
      }
      if (!db.objectStoreNames.contains('loans')) {
        const store = db.createObjectStore('loans', { keyPath: 'loanNo' });
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('memberId', 'memberId', { unique: false });
        store.createIndex('groupId', 'groupId', { unique: false });
      }
      if (!db.objectStoreNames.contains('loan_schedule')) {
        const store = db.createObjectStore('loan_schedule', { keyPath: 'id', autoIncrement: true });
        store.createIndex('loanId', 'loanId', { unique: false });
      }
      if (!db.objectStoreNames.contains('collaterals')) {
        const store = db.createObjectStore('collaterals', { keyPath: 'id', autoIncrement: true });
        store.createIndex('loanId', 'loanId', { unique: false });
      }
      if (!db.objectStoreNames.contains('guarantors')) {
        const store = db.createObjectStore('guarantors', { keyPath: 'id', autoIncrement: true });
        store.createIndex('loanId', 'loanId', { unique: false });
      }
      if (!db.objectStoreNames.contains('fees_log')) {
        const store = db.createObjectStore('fees_log', { keyPath: 'id', autoIncrement: true });
        store.createIndex('loanId', 'loanId', { unique: false });
        store.createIndex('memberId', 'memberId', { unique: false });
      }
      if (!db.objectStoreNames.contains('expenses')) {
        const store = db.createObjectStore('expenses', { keyPath: 'id', autoIncrement: true });
        store.createIndex('votehead', 'votehead', { unique: false });
      }
      if (!db.objectStoreNames.contains('voteheads')) {
        db.createObjectStore('voteheads', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('savings')) {
        const store = db.createObjectStore('savings', { keyPath: 'id', autoIncrement: true });
        store.createIndex('memberId', 'memberId', { unique: false });
        store.createIndex('groupId', 'groupId', { unique: false });
      }
      if (!db.objectStoreNames.contains('audit_log')) {
        const store = db.createObjectStore('audit_log', { keyPath: 'id', autoIncrement: true });
        store.createIndex('userId', 'userId', { unique: false });
        store.createIndex('action', 'action', { unique: false });
      }
      if (!db.objectStoreNames.contains('loan_repayments')) {
        const store = db.createObjectStore('loan_repayments', { keyPath: 'id', autoIncrement: true });
        store.createIndex('loanNo', 'loanNo', { unique: false });
        store.createIndex('memberId', 'memberId', { unique: false });
      }
    };

    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error);
  });
};

export const getById = async (storeName, id) => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

export const getAll = async (storeName) => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

export const add = async (storeName, data) => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.add(data);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

export const put = async (storeName, data) => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.put(data);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};
