// @ts-check
import { platform } from 'node:os';
import { existsSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { log } from './log.js';

const MAC_BROWSERS = ['Google Chrome', 'Google Chrome Canary', 'Google Chrome Dev', 'Chromium'];

const LINUX_BROWSERS = [
  'google-chrome',
  'google-chrome-stable',
  'google-chrome-unstable',
  'google-chrome-canary',
  'chromium-browser',
  'chromium',
];

/** Opens a URL in Chrome/Chromium. Supports macOS and Linux. */
export function openBrowser(url) {
  const os = platform();

  if (os === 'darwin') {
    for (const app of MAC_BROWSERS) {
      if (existsSync(`/Applications/${app}.app`)) {
        const proc = spawn('open', ['-a', app, url], { detached: true, stdio: 'ignore' });
        proc.unref();
        return;
      }
    }
    log(`Chrome not found — open ${url} in Chrome manually`);
  } else if (os === 'linux') {
    for (const name of LINUX_BROWSERS) {
      try {
        execFileSync('which', [name], { stdio: 'ignore' });
        const proc = spawn(name, [url], { detached: true, stdio: 'ignore' });
        proc.unref();
        return;
      } catch {
        // not found, try next
      }
    }
    log(`Chrome not found — open ${url} in Chrome manually`);
  } else {
    log(`Open ${url} in Chrome`);
  }
}
