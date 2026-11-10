'use strict';

/* ============================================================
   API client
   ============================================================ */

const api = {
  async req(method, url, body) {
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new Error('Cannot reach the server. Is it still running?');
    }
    let data = null;
    try { data = await res.json(); } catch { /* no body */ }
    if (!res.ok) {
      throw new Error((data && data.error) || `${res.status} ${res.statusText}`);
    }
    return data;
  },
  get: url => api.req('GET', url),
  post: (url, body) => api.req('POST', url, body),
  put: (url, body) => api.req('PUT', url, body),
  del: url => api.req('DELETE', url),

  qs(params) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params || {})) {
      if (v !== undefined && v !== null && v !== '') sp.set(k, v);
    }
    const s = sp.toString();
    return s ? '?' + s : '';
  },
};
