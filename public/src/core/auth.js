import { getById } from './db.js';

export const login = async (username, pin) => {
  const user = await getById('users', username);
  if (user && user.pin === pin) {
    localStorage.setItem('inlet_session', JSON.stringify({
      id: user.id,
      name: user.name,
      role: user.role
    }));
    return true;
  }
  return false;
};

export const logout = () => {
  localStorage.removeItem('inlet_session');
  window.location.hash = '#/login';
};

export const getSession = () => {
  const session = localStorage.getItem('inlet_session');
  return session ? JSON.parse(session) : null;
};
