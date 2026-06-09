#!/usr/bin/env node
/**
 * Deezer OAuth helper — one-time setup to get a long-lived access token
 * for the build-playlist.mjs script.
 *
 * Run this ONCE per machine. The captured token gets saved to
 * .env.local and reused indefinitely by subsequent script runs.
 *
 * PREREQUISITES (5-minute one-time Deezer Developer setup):
 *
 * 1. Go to https://developers.deezer.com/myapps
 *    (Log in with the Deezer account you want to own the playlists)
 *
 * 2. Click "Create a new Application"
 *
 * 3. Fill in:
 *      Application name: Songnado Curation (or anything you want)
 *      Application domain: localhost
 *      Redirect URL after authentification: http://localhost:8765/auth
 *      Description: Personal curation tool
 *      Link to your application: http://localhost
 *      Logo: optional, skip
 *      Acceptance of Deezer's terms: tick
 *
 * 4. Click Create. You'll see the app's "Application ID" and "Secret Key".
 *
 * 5. Add them to .env.local in this project root:
 *      DEEZER_APP_ID=12345678
 *      DEEZER_APP_SECRET=abcdef1234567890...
 *
 * 6. Run this script: node scripts/deezer-auth.mjs
 *
 * 7. Your browser opens. Log in if needed, click "Authorize Songnado Curation".
 *
 * 8. You'll be redirected back here; the script captures the token and
 *    writes DEEZER_ACCESS_TOKEN= to .env.local. Done.
 *
 * After that, build-playlist.mjs picks up the token from .env.local
 * automatically. The token doesn't expire unless you revoke it.
 */

import { createServer } from 'node:http';
import { exec } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { URL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const ENV_FILE = join(PROJECT_ROOT, '.env.local');
const PORT = 8765;
const REDIRECT_URI = `http://localhost:${PORT}/auth`;
const PERMS = 'basic_access,manage_library';

// ---- Load env ----
function loadEnv() {
  if (!existsSync(ENV_FILE)) return {};
  const lines = readFileSync(ENV_FILE, 'utf8').split('\n');
  const env = {};
  for (const line of lines) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/i);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

function setEnvVar(key, value) {
  let content = '';
  if (existsSync(ENV_FILE)) {
    content = readFileSync(ENV_FILE, 'utf8');
  }
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  const newLine = `${key}=${value}`;
  if (pattern.test(content)) {
    content = content.replace(pattern, newLine);
  } else {
    if (content.length > 0 && !content.endsWith('\n')) content += '\n';
    content += newLine + '\n';
  }
  writeFileSync(ENV_FILE, content);
}

function openBrowser(url) {
  // Cross-platform browser open
  const cmd =
    process.platform === 'win32'
      ? `start "" "${url}"`
      : process.platform === 'darwin'
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, (err) => {
    if (err) {
      console.log('\nCould not auto-open browser. Please open this URL manually:\n');
      console.log(url);
      console.log('');
    }
  });
}

async function exchangeCodeForToken(appId, secret, code) {
  const url = `https://connect.deezer.com/oauth/access_token.php?app_id=${appId}&secret=${secret}&code=${code}&output=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`);
  const text = await res.text();
  // Deezer returns either JSON or form-encoded depending on quirks
  let token = null;
  try {
    const json = JSON.parse(text);
    token = json.access_token;
  } catch {
    const m = text.match(/access_token=([^&]+)/);
    if (m) token = m[1];
  }
  if (!token) throw new Error(`No access_token in response: ${text}`);
  return token;
}

async function main() {
  const env = loadEnv();
  const APP_ID = env.DEEZER_APP_ID || process.env.DEEZER_APP_ID;
  const APP_SECRET = env.DEEZER_APP_SECRET || process.env.DEEZER_APP_SECRET;

  if (!APP_ID || !APP_SECRET) {
    console.error('Missing DEEZER_APP_ID or DEEZER_APP_SECRET in .env.local.');
    console.error('Set them up first — see the comment block at the top of this script.');
    process.exit(1);
  }

  const authUrl =
    `https://connect.deezer.com/oauth/auth.php?` +
    `app_id=${APP_ID}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&perms=${encodeURIComponent(PERMS)}`;

  console.log('=== Songnado Deezer Auth Helper ===\n');
  console.log(`Listening on ${REDIRECT_URI}`);
  console.log('Opening browser to Deezer authorization...\n');

  const server = createServer(async (req, res) => {
    const u = new URL(req.url, `http://localhost:${PORT}`);
    if (u.pathname !== '/auth') {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }
    const code = u.searchParams.get('code');
    const errorReason = u.searchParams.get('error_reason');
    if (errorReason) {
      console.error('Authorization rejected:', errorReason);
      res.statusCode = 400;
      res.end('Authorization rejected. You can close this tab.');
      server.close();
      process.exit(1);
    }
    if (!code) {
      res.statusCode = 400;
      res.end('Missing code param. Check redirect URI matches.');
      return;
    }

    try {
      console.log('Got authorization code. Exchanging for access token...');
      const token = await exchangeCodeForToken(APP_ID, APP_SECRET, code);
      setEnvVar('DEEZER_ACCESS_TOKEN', token);
      console.log('\n✓ Success! Token saved to .env.local as DEEZER_ACCESS_TOKEN.');
      console.log('  You can now run: node scripts/build-playlist.mjs <args>\n');
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html');
      res.end(
        '<html><body style="font-family:sans-serif;text-align:center;padding:40px"><h1>✓ Authorized!</h1><p>You can close this tab and return to your terminal.</p></body></html>'
      );
      server.close();
      process.exit(0);
    } catch (err) {
      console.error('Error during token exchange:', err.message);
      res.statusCode = 500;
      res.end('Token exchange failed. Check terminal.');
      server.close();
      process.exit(1);
    }
  });

  server.listen(PORT, () => {
    openBrowser(authUrl);
    console.log('Waiting for Deezer to redirect back...');
    console.log('(If nothing happens within 30s, paste this URL manually into your browser:)');
    console.log(authUrl);
    console.log('');
  });
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
