// Motor unificado de video do Vorvia PC v1.2.4 (HLS + MPEG-TS + HTML5 nativo)
// Buffer equilibrado para inicio rapido de audio/video (sem atraso de ~1 min e sem travar a cada 3s).

window.VorviaPlayerEngine = (function () {
  function getPathname(url) {
    try {
      return new URL(url).pathname.toLowerCase();
    } catch (_) {
      return String(url || '').split('?')[0].replace(/^https?:\/\/[^/]+/i, '').toLowerCase();
    }
  }

  function detectType(url) {
    const raw = String(url || '').toLowerCase();
    const pathname = getPathname(url);
    const lastSegment = pathname.split('/').pop() || '';

    if (pathname.endsWith('.m3u8') || raw.includes('.m3u8') || raw.includes('output=m3u8') || raw.includes('output=hls')) {
      return 'hls';
    }
    if (pathname.endsWith('.ts') || raw.includes('output=ts') || raw.includes('output=mpegts')) {
      return 'mpegts';
    }
    if (/\.(mp4|mkv|webm|mov|m4v|avi)$/.test(pathname)) {
      return 'native';
    }
    if (pathname.includes('/live/') || (!lastSegment.includes('.') && /^\d+$/.test(lastSegment))) {
      return 'mpegts';
    }
    return 'native';
  }

  class StreamInstance {
    constructor(videoEl, callbacks = {}) {
      this.video = videoEl;
      this.callbacks = callbacks;
      this.hls = null;
      this.tsPlayer = null;
      this.currentUrl = '';
      this.altUrl = '';
      this.retryCount = 0;
      this.maxRetries = 4;
      this.hlsNetRetries = 0;
      this.retryTimer = null;
      this.stallTimer = null;
      this.destroyed = false;
    }

    setStatus(state, message = '') {
      if (this.callbacks.onStatus) this.callbacks.onStatus(state, message);
    }

    destroy() {
      this.destroyed = true;
      this.stop();
    }

    clearTimers() {
      clearTimeout(this.retryTimer);
      clearTimeout(this.stallTimer);
      this.retryTimer = null;
      this.stallTimer = null;
    }

    stop() {
      this.clearTimers();
      if (this.hls) {
        try { this.hls.destroy(); } catch (_) {}
        this.hls = null;
      }
      if (this.tsPlayer) {
        try {
          this.tsPlayer.pause();
          this.tsPlayer.unload();
          this.tsPlayer.detachMediaElement();
          this.tsPlayer.destroy();
        } catch (_) {}
        this.tsPlayer = null;
      }
      if (this.video) {
        this.video.onplaying = null;
        this.video.onwaiting = null;
        this.video.onloadedmetadata = null;
        this.video.onerror = null;
        this.video.pause();
        this.video.removeAttribute('src');
        this.video.load();
      }
    }

    play(url, startTime = 0, forceType = null, altUrl = '') {
      if (!url || !this.video) return;
      this.destroyed = false;
      this.stop();
      this.currentUrl = url;
      this.altUrl = altUrl || '';
      this.retryCount = 0;
      this.hlsNetRetries = 0;
      this._startPlayback(url, startTime, forceType || detectType(url));
    }

    _armStallWatchdog(type) {
      clearTimeout(this.stallTimer);
      this.stallTimer = setTimeout(() => {
        if (this.destroyed || !this.video || this.video.paused) return;
        this._scheduleRetry(type);
      }, 14000);
    }

    _scheduleRetry(nextType = null, nextUrl = null) {
      if (this.destroyed) return;
      if (this.retryCount >= this.maxRetries) {
        this.setStatus('error', 'Falha ao carregar stream');
        return;
      }
      this.retryCount++;
      if (nextUrl) this.currentUrl = nextUrl;
      this.setStatus('loading', `Reconectando (${this.retryCount}/${this.maxRetries})...`);
      this.clearTimers();
      this.retryTimer = setTimeout(() => {
        if (!this.destroyed && this.currentUrl) {
          this.stop();
          this._startPlayback(this.currentUrl, 0, nextType || detectType(this.currentUrl));
        }
      }, 2200);
    }

    _startPlayback(url, startTime, type) {
      this.setStatus('loading', 'Carregando...');

      this.video.onplaying = () => {
        clearTimeout(this.stallTimer);
        this.retryCount = 0;
        this.hlsNetRetries = 0;
        this.setStatus('playing', type === 'native' ? 'Reproduzindo' : 'Ao vivo');
      };

      this.video.onwaiting = () => {
        if (this.destroyed) return;
        this.setStatus('loading', 'Carregando buffer...');
        if (type !== 'native') this._armStallWatchdog(type);
      };

      if (type === 'hls' && window.Hls && window.Hls.isSupported()) {
        this.hls = new window.Hls({
          enableWorker: true,
          lowLatencyMode: false,
          startFragPrefetch: true,
          liveSyncDurationCount: 3,
          liveMaxLatencyDurationCount: 8,
          backBufferLength: 10,
          maxBufferLength: 15,      // Reduzido de 45s para 15s: evita fila longa de audio/video
          maxMaxBufferLength: 30,   // Reduzido de 90s para 30s: resposta rapida no Multitela
          maxBufferHole: 1.0,
          maxAudioFramesDrift: 4,
          nudgeOffset: 0.2,
          nudgeMaxRetry: 10,
          fragLoadingTimeOut: 20000,
          manifestLoadingTimeOut: 20000,
          levelLoadingTimeOut: 20000,
          fragLoadingMaxRetry: 4,
          manifestLoadingMaxRetry: 3
        });
        this.hls.loadSource(url);
        this.hls.attachMedia(this.video);

        this.hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
          if (startTime > 5) this.video.currentTime = startTime;
          this.video.play().catch(() => {});
        });

        this.hls.on(window.Hls.Events.ERROR, (_e, data) => {
          if (!data.fatal || this.destroyed) return;
          if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR) {
            if (this.hlsNetRetries < 2) {
              this.hlsNetRetries++;
              this.setStatus('loading', 'Recuperando sinal...');
              this.hls.startLoad();
            } else if (this.altUrl && this.altUrl !== url) {
              this._scheduleRetry(detectType(this.altUrl), this.altUrl);
            } else {
              this._scheduleRetry('hls');
            }
          } else if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) {
            this.hls.recoverMediaError();
          } else if (this.altUrl && this.altUrl !== url) {
            this._scheduleRetry(detectType(this.altUrl), this.altUrl);
          } else {
            this._scheduleRetry('mpegts');
          }
        });
        return;
      }

      if (type === 'mpegts' && window.mpegts && window.mpegts.isSupported()) {
        try {
          this.tsPlayer = window.mpegts.createPlayer(
            { type: 'mpegts', isLive: true, url },
            {
              enableWorker: true,
              enableStashBuffer: true,
              stashInitialSize: 256, // 256 KB: inicio rapido de audio sem travar a cada 3s
              lazyLoad: false,
              liveBufferLatencyChasing: false,
              autoCleanupSourceBuffer: true,
              autoCleanupMaxBackwardDuration: 15,
              autoCleanupMinBackwardDuration: 8,
              fixAudioTimestampGap: true,
              accurateSeek: false
            }
          );
          this.tsPlayer.attachMediaElement(this.video);
          this.tsPlayer.load();
          this.video.play().catch(() => {});

          this.tsPlayer.on(window.mpegts.Events.ERROR, () => {
            if (this.destroyed) return;
            const fallbackHls = this.altUrl || (url.endsWith('.ts') ? url.replace(/\.ts$/i, '.m3u8') : '');
            if (fallbackHls && fallbackHls !== url && this.retryCount === 0) {
              this._scheduleRetry('hls', fallbackHls);
            } else {
              this._scheduleRetry('mpegts');
            }
          });
          return;
        } catch (_) {
          // cai para nativo
        }
      }

      // Player HTML5 nativo (MP4, MKV H264/AAC, WebM, fallback)
      this.video.src = url;
      this.video.onloadedmetadata = () => {
        if (startTime > 5 && isFinite(this.video.duration) && startTime < this.video.duration - 10) {
          this.video.currentTime = startTime;
        }
        this.video.play().catch(() => {});
      };
      this.video.onerror = () => {
        if (this.destroyed) return;
        const pathname = getPathname(url);
        if (type === 'native' && !/\.(mp4|mkv|webm|mov|m4v)$/.test(pathname)) {
          this._scheduleRetry('hls');
        } else {
          this._scheduleRetry('native');
        }
      };
    }

    reload() {
      if (this.currentUrl) {
        const current = this.video ? this.video.currentTime : 0;
        const resumeAt = isFinite(current) && isFinite(this.video?.duration) ? current : 0;
        this.play(this.currentUrl, resumeAt, null, this.altUrl);
      }
    }
  }

  return {
    create: (videoEl, callbacks) => new StreamInstance(videoEl, callbacks),
    detectType
  };
})();
