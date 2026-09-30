// Data access for the pages. The app used to call an Express/Postgres server under /api;
// it now talks to an in-browser database (see ./mock) with the same routes and JSON shapes,
// so the pages did not have to change.
import { dispatch } from './mock/routes';
import { HttpError } from './mock/services';

async function request(method, url, body) {
  const [path, search = ''] = url.split('?');
  // Same round trips the network used to do: query strings are text, bodies and results are plain JSON
  const query = Object.fromEntries(new URLSearchParams(search));
  const payload = body ? JSON.parse(JSON.stringify(body)) : {};
  try {
    const result = dispatch(method, path, query, payload);
    return result === null || result === undefined ? null : JSON.parse(JSON.stringify(result));
  } catch (e) {
    const data = e instanceof HttpError ? { error: e.message, ...e.details } : { error: 'Internal server error' };
    if (!(e instanceof HttpError)) console.error(e);
    const err = new Error(data.error);
    err.data = data;
    throw err;
  }
}

const qs = (params = {}) => {
  const p = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return p.length ? `?${new URLSearchParams(p)}` : '';
};

export const api = {
  get: (url, params) => request('GET', url + qs(params)),
  post: (url, body) => request('POST', url, body || {}),
  put: (url, body) => request('PUT', url, body),
  patch: (url, body) => request('PATCH', url, body),
  del: (url) => request('DELETE', url),
};
