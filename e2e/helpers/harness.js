import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const E2E_DIR = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const REPO_ROOT = path.resolve(E2E_DIR, '..');
const SERVER_ENTRY = path.join(REPO_ROOT, 'server', 'src', 'index.js');

export const ADMIN_EMAIL = 'admin@vericar-e2e.test';
export const ADMIN_PASSWORD = 'AdminE2EPass!2026';

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

function resolveChromiumExecutable() {
  const candidates = [
    process.env.CHROME_BIN,
    '/usr/lib/chromium/chromium',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
  ].filter(Boolean);

  for (const bin of candidates) {
    if (fs.existsSync(bin)) return bin;
  }
  return undefined;
}

async function waitForReady(baseUrl, child, stderrLines, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `Server exited prematurely with code ${child.exitCode}.\n${stderrLines.join('')}`
      );
    }
    try {
      const res = await fetch(`${baseUrl}/api/ready`);
      if (res.ok) return;
    } catch {
      // Wait and retry
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Timed out waiting for ${baseUrl}/api/ready.\n${stderrLines.join('')}`);
}

/**
 * Starts an isolated production VériCar server + headless Chromium browser.
 */
export async function startE2EHarness(extraEnv = {}) {
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vericar-e2e-'));
  const dbPath = path.join(tmpDir, 'vericar-e2e.db');
  const stderrLines = [];

  const child = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      DB_PATH: dbPath,
      APP_URL: baseUrl,
      COOKIE_SECURE: 'false',
      ALLOW_SANDBOX_BILLING: 'true',
      SIGNUP_BONUS_CREDITS: '1',
      ADMIN_EMAIL,
      ADMIN_PASSWORD,
      RATE_LIMIT_MAX_MULTIPLIER: '5',
      LOG_LEVEL: 'error',
      VERICAR_SKIP_DOTENV: '1',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stderr.on('data', (chunk) => {
    stderrLines.push(chunk.toString('utf8'));
  });

  try {
    await waitForReady(baseUrl, child, stderrLines);
  } catch (err) {
    child.kill('SIGTERM');
    fs.rmSync(tmpDir, { recursive: true, force: true });
    throw err;
  }

  const executablePath = resolveChromiumExecutable();
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });

  const contexts = [];

  async function newTrackedPage(options = {}) {
    const context = await browser.newContext({
      viewport: { width: 1366, height: 900 },
      ignoreHTTPSErrors: true,
      ...options,
    });
    contexts.push(context);
    const page = await context.newPage();

    const consoleErrors = [];
    const pageErrors = [];
    const failedApi5xx = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
    page.on('pageerror', (err) => {
      pageErrors.push(err.message || String(err));
    });
    page.on('response', (res) => {
      if (res.url().startsWith(baseUrl) && res.status() >= 500) {
        failedApi5xx.push(`${res.status()} ${res.url()}`);
      }
    });

    return {
      context,
      page,
      consoleErrors,
      pageErrors,
      failedApi5xx,
      assertClean({ allowExpectedHttp404 = false } = {}) {
        const unexpectedConsoleErrors = consoleErrors.filter((text) => {
          if (allowExpectedHttp404 && text.includes('status of 404 (Not Found)')) {
            return false;
          }
          return true;
        });
        if (unexpectedConsoleErrors.length > 0 || pageErrors.length > 0 || failedApi5xx.length > 0) {
          throw new Error(
            [
              unexpectedConsoleErrors.length ? `Console errors: ${unexpectedConsoleErrors.join(' | ')}` : '',
              pageErrors.length ? `Page errors: ${pageErrors.join(' | ')}` : '',
              failedApi5xx.length ? `HTTP 5xx: ${failedApi5xx.join(' | ')}` : '',
            ]
              .filter(Boolean)
              .join('\n')
          );
        }
      },
    };
  }

  async function close() {
    for (const ctx of contexts) {
      await ctx.close().catch(() => {});
    }
    await browser.close().catch(() => {});
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          if (child.exitCode === null) child.kill('SIGKILL');
          resolve();
        }, 3000);
        child.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  return { baseUrl, browser, newTrackedPage, close };
}
