export const sep = '/';

export const resolve = (...parts: string[]) => {
  const path = parts
    .filter(Boolean)
    .join('/')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/');

  return path.startsWith('/') ? path : `/${path}`;
};
