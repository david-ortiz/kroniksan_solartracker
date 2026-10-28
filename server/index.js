import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { config, ROOT } from './config.js';
import { kv } from './db.js';
import { api } from './api.js';
import { authorizeUrl, exchangeCode } from './solaredge.js';
import { onConnected, startScheduler } from './sync.js';
import { setupDemo } from './demo.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json());
app.use('/api', api);

// ---------------------------------------------------------------- OAuth

const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>body{font-family:system-ui,sans-serif;background:#0d0f12;color:#eceae4;display:grid;place-items:center;min-height:100vh;margin:0}
main{max-width:34rem;padding:2rem}a{color:#f5b73b}code{background:#1c1f24;padding:.15rem .4rem;border-radius:.3rem}</style></head><body><main>${body}</main></body></html>`;

app.get('/auth/login', (req, res) => {
  if (config.demo) return res.redirect('/');
  res.redirect(authorizeUrl());
});

app.get('/auth/callback', async (req, res) => {
  const { code, site_id: siteId, error, external_id: externalId } = req.query;
  const pending = kv.get('oauth_pending');
  if (error) return res.status(400).send(page('Declined', `<h2>Access was declined</h2><p>${String(error)}</p><p><a href="/">Back</a></p>`));
  if (!code) return res.status(400).send(page('Missing code', '<h2>SolarEdge did not send an authorization code.</h2>'));
  if (externalId && pending?.externalId && externalId !== pending.externalId) {
    return res.status(400).send(page('Expired', '<h2>This sign-in does not match. Please <a href="/auth/login">start again</a>.</h2>'));
  }
  try {
    await exchangeCode(String(code));
    kv.delete('oauth_pending');
    onConnected(siteId ? String(siteId) : null);
    res.redirect('/?connected=1');
  } catch (err) {
    res.status(500).send(page('Sign-in failed', `<h2>Token exchange failed</h2><p><code>${String(err.message).replace(/</g, '&lt;')}</code></p><p><a href="/auth/login">Try again</a></p>`));
  }
});

app.post('/auth/logout', (req, res) => {
  kv.delete('tokens');
  res.json({ ok: true });
});

// ---------------------------------------------------------------- Frontend

const dist = path.join(ROOT, 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { maxAge: '1h', index: false }));
  app.get(/^\/(?!api|auth).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.listen(config.port, () => {
  console.log(`☀  Solar dashboard API on ${config.appUrl} (${config.demo ? 'DEMO mode' : 'live mode'})`);
  if (!config.demo) console.log(`   OAuth redirect URI to register at SolarEdge: ${config.redirectUri}`);
});

if (config.demo) setupDemo();
else startScheduler();
