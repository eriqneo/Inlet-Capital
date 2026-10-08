import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

const profile = await mkdtemp(join(tmpdir(), 'inlet-cache-test-'));
const browser = spawn(process.env.CHROME_BIN || 'google-chrome', [
  '--headless', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0',
  `--user-data-dir=${profile}`, 'about:blank'
], { stdio: ['ignore', 'ignore', 'pipe'] });
const timeout = setTimeout(() => { browser.kill(); }, 30000);
let socket;
try {
  const debugUrl = await new Promise((resolve, reject) => {
    let output = '';
    browser.on('error', reject);
    browser.on('exit', () => reject(new Error('Browser exited before test completed')));
    browser.stderr.on('data', chunk => {
      output += chunk;
      const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) resolve(match[1]);
    });
  });
  const endpoint = new URL(debugUrl);
  const pages = await (await fetch(`http://${endpoint.host}/json/list`)).json();
  socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
  await once(socket, 'open');
  let id = 0;
  const requests = new Map();
  const exceptions = [];
  socket.addEventListener('message', event => {
    const response = JSON.parse(event.data);
    if (response.id) {
      const request = requests.get(response.id);
      requests.delete(response.id);
      if (response.error) request.reject(new Error(response.error.message));
      else request.resolve(response.result);
    } else if (response.method === 'Runtime.exceptionThrown') {
      exceptions.push(response.params.exceptionDetails.exception?.description || 'Unhandled browser exception');
      console.error('Browser exception:', response.params.exceptionDetails.exception?.description);
    }
  });
  socket.addEventListener('close', () => {
    for (const request of requests.values()) request.reject(new Error('Browser connection closed'));
    requests.clear();
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const nextId = ++id;
    requests.set(nextId, { resolve, reject });
    socket.send(JSON.stringify({ id: nextId, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__INLET_CACHE_TEST__ = true;' });
  if (process.env.TEST_CHART_SCRIPT) {
    await send('Page.addScriptToEvaluateOnNewDocument', { source: await readFile(process.env.TEST_CHART_SCRIPT, 'utf8') });
  }
  if (process.env.TEST_VIEWPORT === 'mobile') {
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  } else {
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  }
  await send('Emulation.setTimezoneOverride', { timezoneId: process.env.TEST_TIMEZONE || 'Africa/Nairobi' });
  await send('Page.navigate', { url: `${process.env.TEST_BASE_URL || 'http://127.0.0.1:5181'}${process.env.TEST_PAGE || '/tests/cache.browser.html'}` });
  let outcome = '';
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const evaluation = await send('Runtime.evaluate', { expression: 'document.querySelector("#result")?.textContent', returnByValue: true });
    outcome = evaluation.result?.value || '';
    if (/^(PASS|FAIL):/.test(outcome)) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!outcome.startsWith('PASS:')) throw new Error(outcome || 'Browser test timed out');
  if (exceptions.length) throw new Error(exceptions.join('\n'));
  if (process.env.TEST_SCREENSHOT_PATH) {
    const rectangle = await send('Runtime.evaluate', { expression: `(() => { const box = document.querySelector('.analytics-expenses-chart').getBoundingClientRect(); return { x: box.x + scrollX, y: box.y + scrollY, width: box.width, height: box.height, scale: 1 }; })()`, returnByValue: true });
    const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: rectangle.result.value });
    await writeFile(process.env.TEST_SCREENSHOT_PATH, Buffer.from(screenshot.data, 'base64'));
  }
  console.log(outcome);
} finally {
  clearTimeout(timeout);
  socket?.close();
  if (browser.exitCode === null && browser.signalCode === null) { browser.kill(); await once(browser, 'exit'); }
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
