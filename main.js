const { app, BrowserWindow, ipcMain, session, shell } = require('electron');
const path = require('path');
const http = require('http');
const https = require('https');

// Aceleracao de hardware para rodar ate 6 telas simultaneas com folga na GPU
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('enable-accelerated-video-decode');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let mainWindow = null;

// Helper HTTP/HTTPS nativo com suporte a redirecionamentos (funciona em qualquer versao do Electron)
function nodeRequest(targetUrl, options = {}, redirectCount = 0) {
  return new Promise((resolve) => {
    if (redirectCount > 6) {
      return resolve({ ok: false, status: 0, error: 'Muitos redirecionamentos' });
    }
    try {
      const parsed = new URL(targetUrl);
      const lib = parsed.protocol === 'https:' ? https : http;
      const req = lib.request(
        {
          hostname: parsed.hostname,
          port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
          path: parsed.pathname + parsed.search,
          method: options.method || 'GET',
          timeout: options.timeout || 25000,
          rejectUnauthorized: false,
          headers: {
            'User-Agent': options.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) VorviaPC/1.1',
            'Accept': '*/*',
            ...(options.headers || {})
          }
        },
        (res) => {
          const status = res.statusCode || 0;
          if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
            const nextUrl = new URL(res.headers.location, targetUrl).toString();
            res.resume();
            return resolve(nodeRequest(nextUrl, options, redirectCount + 1));
          }
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            const buf = Buffer.concat(chunks);
            resolve({
              ok: status >= 200 && status < 300,
              status,
              text: options.binary ? '' : buf.toString('utf8'),
              byteLength: buf.length
            });
          });
        }
      );

      req.on('timeout', () => {
        req.destroy();
        resolve({ ok: false, status: 0, error: 'Tempo limite excedido' });
      });

      req.on('error', (err) => {
        resolve({ ok: false, status: 0, error: err.message || 'Erro de conexao' });
      });

      req.end();
    } catch (err) {
      resolve({ ok: false, status: 0, error: err.message || 'URL invalida' });
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 860,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: '#090B10',
    frame: false,
    titleBarStyle: 'hidden',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
      allowRunningInsecureContent: true,
      backgroundThrottling: false
    }
  });

  // Bypass automatico de CORS preservando dominios de CDN e TMDB
  const ses = session.defaultSession;
  const preserveHosts = ['api.themoviedb.org', 'image.tmdb.org', 'cdn.jsdelivr.net', 'unpkg.com', 'cdnjs.cloudflare.com'];

  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders };
    const isPreserved = preserveHosts.some((h) => details.url.includes(h));
    if (!isPreserved && /^https?:\/\//i.test(details.url)) {
      headers['User-Agent'] = 'VLC/3.0.20 LibVLC/3.0.20';
      delete headers['Origin'];
      delete headers['Referer'];
    }
    callback({ requestHeaders: headers });
  });

  ses.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = { ...details.responseHeaders };
    delete responseHeaders['access-control-allow-origin'];
    delete responseHeaders['Access-Control-Allow-Origin'];
    delete responseHeaders['access-control-allow-headers'];
    delete responseHeaders['Access-Control-Allow-Headers'];
    responseHeaders['Access-Control-Allow-Origin'] = ['*'];
    responseHeaders['Access-Control-Allow-Headers'] = ['*'];
    responseHeaders['Access-Control-Allow-Methods'] = ['GET, POST, OPTIONS'];
    callback({ responseHeaders });
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('minimize', () => {
    mainWindow.webContents.send('window-state', { minimized: true });
  });

  mainWindow.on('restore', () => {
    mainWindow.webContents.send('window-state', { minimized: false });
  });

  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('window-maximized', true);
  });

  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('window-maximized', false);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

ipcMain.on('win-minimize', () => mainWindow && mainWindow.minimize());
ipcMain.on('win-maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on('win-close', () => mainWindow && mainWindow.close());
ipcMain.on('win-fullscreen', () => {
  if (!mainWindow) return;
  mainWindow.setFullScreen(!mainWindow.isFullScreen());
});
ipcMain.on('open-external', (_e, url) => {
  if (url && /^https?:\/\//i.test(url)) shell.openExternal(url);
});

ipcMain.handle('net-fetch', async (_event, url, options = {}) => {
  return nodeRequest(url, options);
});

ipcMain.handle('speed-test', async () => {
  const testUrl = 'https://speed.cloudflare.com/__down?bytes=10000000';
  const start = Date.now();
  const res = await nodeRequest(testUrl, { binary: true, timeout: 20000 });
  if (!res.ok || !res.byteLength) {
    return { ok: false, error: res.error || 'Falha no teste' };
  }
  const elapsedSec = Math.max((Date.now() - start) / 1000, 0.1);
  const mbps = Number(((res.byteLength * 8) / elapsedSec / 1000000).toFixed(1));
  return { ok: true, mbps };
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
