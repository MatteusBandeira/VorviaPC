// Motor unificado de video do Vorvia PC (HLS + MPEG-TS + HTML5 nativo)
// Projetado para suportar ate 6 instancias simultaneas com limpeza total de memoria.

window.VorviaPlayerEngine = (function () {
  function detectType(url) {
    const clean = (url || '').split('?')[0].toLowerCase();
    if (clean.endsWith('.m3u8')) return 'hls';
    if (clean.endsWith('.ts')) return 'mpegts';
    if (clean.endsWith('.mp4') || clean.endsWith('.mkv') || clean.endsWith('.webm') || clean.endsWith('.mov')) return 'native';
    // Streams Xtream ao vivo sem extensao geralmente sao MPEG-TS ou HLS
    if (url.includes('/live/') && !clean.includes('.')) return 'mpegts';
    if (url.includes('.m3u8')) return 'hls';
    return 'native';
  }

  class StreamInstance {
    constructor(videoEl, callbacks = {}) {
      this.video = videoEl;
      this.callbacks = callbacks;
      this.hls = null;
      this.tsPlayer = null;
      this.currentUrl = '';
      this.retryCount = 0;
      this.maxRetries = 3;
      this.retryTimer = null;
      this.destroyed = false;
    }

    setStatus(state, message = '') {
      if (this.callbacks.onStatus) this.callbacks.onStatus(state, message);
    }

    destroy() {
      this.destroyed = true;
      this.stop();
    }

    stop() {
      clearTimeout(this.retryTimer);
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
        this.video.pause();
        this.video.removeAttribute('src');
        this.video.load();
      }
    }

    play(url, startTime = 0, forceType = null) {
      if (!url || !this.video) return;
      this.destroyed = false;
      this.stop();
      this.currentUrl = url;
      this.retryCount = 0;
      this._startPlayback(url, startTime, forceType || detectType(url));
    }

    _scheduleRetry(nextType = null) {
      if (this.destroyed) return;
      if (this.retryCount >= this.maxRetries) {
        this.setStatus('error', 'Falha ao carregar stream');
        return;
      }
      this.retryCount++;
      this.setStatus('loading', `Reconectando (${this.retryCount}/${this.maxRetries})...`);
      clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => {
        if (!this.destroyed && this.currentUrl) {
          this._startPlayback(this.currentUrl, 0, nextType || detectType(this.currentUrl));
        }
      }, 1800);
    }

    _startPlayback(url, startTime, type) {
      this.setStatus('loading', 'Carregando...');

      if (type === 'hls' && window.Hls && window.Hls.isSupported()) {
        this.hls = new window.Hls({
          enableWorker: true,
          lowLatencyMode: true,
          backBufferLength: 30,
          maxBufferLength: 30,
          maxMaxBufferLength: 60,
          fragLoadingTimeOut: 15000,
          manifestLoadingTimeOut: 15000
        });
        this.hls.loadSource(url);
        this.hls.attachMedia(this.video);

        this.hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
          if (startTime > 5) this.video.currentTime = startTime;
          this.video.play().catch(() => {});
          this.setStatus('playing', 'Ao vivo');
        });

        this.hls.on(window.Hls.Events.ERROR, (_e, data) => {
          if (!data.fatal) return;
          if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR) {
            this.hls.startLoad();
            this._scheduleRetry('hls');
          } else if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) {
            this.hls.recoverMediaError();
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
              enableStashBuffer: false,
              stashInitialSize: 128,
              liveBufferLatencyChasing: true,
              liveBufferLatencyMaxLatency: 3.5,
              liveBufferLatencyMinRemain: 0.8
            }
          );
          this.tsPlayer.attachMediaElement(this.video);
          this.tsPlayer.load();
          this.video.play().catch(() => {});

          this.video.onplaying = () => {
            this.retryCount = 0;
            this.setStatus('playing', 'Reproduzindo');
          };

          this.tsPlayer.on(window.mpegts.Events.ERROR, () => {
            // Tenta fallback para .m3u8 se a URL for .ts
            const altUrl = url.endsWith('.ts') ? url.replace(/\.ts$/i, '.m3u8') : null;
            if (altUrl && this.retryCount === 0) {
              this.currentUrl = altUrl;
              this._scheduleRetry('hls');
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
      this.video.onplaying = () => {
        this.retryCount = 0;
        this.setStatus('playing', 'Reproduzindo');
      };
      this.video.onerror = () => {
        if (type === 'native' && !url.endsWith('.mp4') && !url.endsWith('.mkv')) {
          this._scheduleRetry('hls');
        } else {
          this._scheduleRetry('native');
        }
      };
    }

    reload() {
      if (this.currentUrl) {
        const current = this.video ? this.video.currentTime : 0;
        this.play(this.currentUrl, isFinite(current) ? current : 0);
      }
    }
  }

  return {
    create: (videoEl, callbacks) => new StreamInstance(videoEl, callbacks),
    detectType
  };
})();
