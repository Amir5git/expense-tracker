// Cloudflare Workers entry point.
//
// Serves the shared backend (app.js) with a D1 database and the static
// frontend from public/ (declared under [assets] in wrangler.toml — those
// requests never reach this Worker and are free/unlimited).
//
// Deploy:  npm run deploy   (see README for the one-time D1 setup)

import backend from './app';
import adapters from './db';

const { D1DB } = adapters;

let appPromise = null;

export default {
  async fetch(request, env) {
    if (!appPromise) {
      const db = new D1DB(env.DB);
      appPromise = backend.ensureSchema(db).then(() => backend.createApp(db));
    }
    const app = await appPromise;
    return app.fetch(request);
  },
};
