// Modulo Multitela Pro v1.2.3 (ate 6 telas simultaneas em grade 3x2)
// Mixer unico via Web Audio API (AudioContext + GainNode):
// Todas as 6 telas compartilham 1 unica saida de audio no Windows/Electron,
// evitando que o som trave ou suma ao adicionar um segundo canal ou trocar de janela.

window.VorviaMultiview = (function () {
  const PRESETS_KEY = 'vorvia_pc_multiview_presets_v1';
  const MAX_SLOTS = 6;

  let activeCount = 6;
  let activeAudioSlot = 0;
  let globalMuted = false;
  let slots = [];
  let onRequestChannelPicker = null;
  let containerEl = null;

  // Contexto unico de audio para todas as 6 janelas
  let audioCtx = null;
  let audioUnlockBound = false;

  function ensureAudioContext() {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) {
        try {
          audioCtx = new Ctx({ latencyHint: 'playback' });
        } catch (_) {
          audioCtx = null;
        }
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  function bindGlobalAudioUnlock() {
    if (audioUnlockBound) return;
    audioUnlockBound = true;
    const unlock = () => {
      if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
      }
    };
    document.addEventListener('pointerdown', unlock, { passive: true });
    document.addEventListener('keydown', unlock, { passive: true });
  }

  function attachSlotAudioGraph(slot) {
    if (!slot || !slot.videoEl || slot.audioAttached) return;
    const ctx = ensureAudioContext();
    if (!ctx) return;

    try {
      const source = ctx.createMediaElementSource(slot.videoEl);
      const gainNode = ctx.createGain();
      gainNode.gain.value = 0;
      source.connect(gainNode);
      gainNode.connect(ctx.destination);

      slot.audioSource = source;
      slot.gainNode = gainNode;
      slot.audioAttached = true;
    } catch (_) {
      // Fallback para controle direto no elemento <video> caso Web Audio falhe
      slot.audioAttached = false;
    }
  }

  function init(container, pickerCallback) {
    containerEl = container;
    onRequestChannelPicker = pickerCallback;
    bindGlobalAudioUnlock();

    // Marca visual da versao para confirmar que o build atualizado esta ativo
    const mvHeading = document.querySelector('#view-multiview .mv-toolbar h2');
    if (mvHeading && !mvHeading.dataset.verTagged) {
      mvHeading.dataset.verTagged = '1';
      mvHeading.innerHTML = 'Multitela <span class="accent">Pro</span> <small style="font-size:11px;color:#8E9CB8;font-weight:600">v1.2.3</small>';
    }

    for (let i = 0; i < MAX_SLOTS; i++) {
      slots.push({
        index: i,
        channel: null,
        engine: null,
        videoEl: null,
        statusEl: null,
        titleEl: null,
        volume: 0.85,
        audioAttached: false,
        audioSource: null,
        gainNode: null
      });
    }
    renderGrid();
    renderPresetsBar();
  }

  function setLayout(count) {
    activeCount = Math.min(MAX_SLOTS, Math.max(1, Number(count) || 6));
    for (let i = activeCount; i < MAX_SLOTS; i++) {
      if (slots[i].engine) slots[i].engine.stop();
    }
    if (activeAudioSlot >= activeCount) activeAudioSlot = 0;
    renderGrid();
    syncAudioFocus();
  }

  function applySlotAudio(idx) {
    const slot = slots[idx];
    if (!slot || !slot.videoEl) return;

    const isFocused = !globalMuted && idx === activeAudioSlot && idx < activeCount;
    const targetVol = isFocused ? Math.max(0.05, Math.min(1, Number(slot.volume) || 0.85)) : 0;

    // Mantem o elemento <video> sempre desmutado para o Chromium nunca suspender o decoder MSE
    slot.videoEl.defaultMuted = false;
    slot.videoEl.muted = false;

    if (slot.audioAttached && slot.gainNode && audioCtx) {
      slot.videoEl.volume = 1;
      try {
        const now = audioCtx.currentTime;
        slot.gainNode.gain.cancelScheduledValues(now);
        slot.gainNode.gain.setTargetAtTime(targetVol, now, 0.015);
      } catch (_) {
        slot.gainNode.gain.value = targetVol;
      }
    } else {
      // Fallback caso o AudioContext ainda nao esteja inicializado
      try {
        slot.videoEl.volume = isFocused ? targetVol : 0.00005;
      } catch (_) {}
    }

    const cell = containerEl?.querySelector(`.mv-cell[data-slot="${idx}"]`);
    if (cell) {
      cell.classList.toggle('audio-active', isFocused);
      const btn = cell.querySelector('.mv-audio-btn');
      if (btn) btn.textContent = isFocused ? '🔊 Som Ativo' : '🔇 Mudo';
    }
  }

  function renderGrid() {
    if (!containerEl) return;
    containerEl.className = `mv-grid mv-layout-${activeCount}`;
    containerEl.innerHTML = '';

    document.querySelectorAll('.mv-layout-btn').forEach((btn) => {
      btn.classList.toggle('active', Number(btn.dataset.count) === activeCount);
    });

    for (let i = 0; i < activeCount; i++) {
      const slot = slots[i];
      const isFocused = !globalMuted && i === activeAudioSlot;
      const cell = document.createElement('div');
      cell.className = `mv-cell ${isFocused ? 'audio-active' : ''}`;
      cell.dataset.slot = i;

      cell.innerHTML = `
        <video class="mv-video" playsinline></video>
        <div class="mv-empty ${slot.channel ? 'hidden' : ''}">
          <div class="mv-slot-badge">TELA ${i + 1}</div>
          <p>Clique para adicionar um canal</p>
          <button class="btn-primary btn-sm mv-pick-btn">+ Escolher Canal</button>
        </div>
        <div class="mv-overlay-top">
          <div class="mv-ch-info">
            <span class="mv-slot-num">${i + 1}</span>
            <span class="mv-ch-title">${slot.channel ? escapeHtml(slot.channel.name) : 'Vazio'}</span>
          </div>
          <span class="mv-status"></span>
        </div>
        <div class="mv-overlay-bottom">
          <button class="mv-icon-btn mv-audio-btn" title="Ativar/silenciar som desta tela (Tecla ${i + 1})">
            ${isFocused ? '🔊 Som Ativo' : '🔇 Mudo'}
          </button>
          <input type="range" class="mv-vol-slider" min="0.05" max="1" step="0.05" value="${slot.volume}" title="Volume">
          <div class="mv-actions-right">
            <button class="mv-icon-btn mv-change-btn" title="Trocar canal">⇄</button>
            <button class="mv-icon-btn mv-reload-btn" title="Recarregar stream">↻</button>
            <button class="mv-icon-btn mv-fs-btn" title="Tela cheia nesta tela">⛶</button>
            <button class="mv-icon-btn mv-clear-btn" title="Limpar tela">✕</button>
          </div>
        </div>
      `;

      const videoEl = cell.querySelector('.mv-video');
      const statusEl = cell.querySelector('.mv-status');
      const titleEl = cell.querySelector('.mv-ch-title');

      // Desconecta grafo anterior ao recriar o elemento <video>
      if (slot.audioSource) {
        try { slot.audioSource.disconnect(); } catch (_) {}
      }
      if (slot.gainNode) {
        try { slot.gainNode.disconnect(); } catch (_) {}
      }
      slot.audioAttached = false;
      slot.audioSource = null;
      slot.gainNode = null;

      videoEl.defaultMuted = false;
      videoEl.muted = false;
      videoEl.volume = 1;

      slot.videoEl = videoEl;
      slot.statusEl = statusEl;
      slot.titleEl = titleEl;

      // Conecta esta tela ao mixer unico do AudioContext
      attachSlotAudioGraph(slot);

      const enforceAudio = () => {
        ensureAudioContext();
        attachSlotAudioGraph(slot);
        applySlotAudio(i);
      };
      videoEl.addEventListener('loadedmetadata', enforceAudio);
      videoEl.addEventListener('canplay', enforceAudio);
      videoEl.addEventListener('playing', enforceAudio);

      if (slot.engine) slot.engine.destroy();
      slot.engine = window.VorviaPlayerEngine.create(videoEl, {
        onStatus: (state, msg) => {
          statusEl.textContent = msg;
          statusEl.className = `mv-status st-${state}`;
          if (state === 'playing') enforceAudio();
        }
      });

      cell.querySelector('.mv-pick-btn').onclick = (e) => {
        e.stopPropagation();
        ensureAudioContext();
        if (onRequestChannelPicker) onRequestChannelPicker(i);
      };
      cell.querySelector('.mv-change-btn').onclick = (e) => {
        e.stopPropagation();
        ensureAudioContext();
        if (onRequestChannelPicker) onRequestChannelPicker(i);
      };
      cell.querySelector('.mv-audio-btn').onclick = (e) => {
        e.stopPropagation();
        ensureAudioContext();
        if (i === activeAudioSlot && !globalMuted) {
          globalMuted = true;
          syncAudioFocus();
        } else {
          focusAudio(i);
        }
      };

      const volSlider = cell.querySelector('.mv-vol-slider');
      volSlider.onclick = (e) => e.stopPropagation();
      volSlider.oninput = (e) => {
        e.stopPropagation();
        ensureAudioContext();
        slot.volume = Math.max(0.05, Number(e.target.value));
        activeAudioSlot = i;
        globalMuted = false;
        syncAudioFocus();
      };

      cell.querySelector('.mv-reload-btn').onclick = (e) => {
        e.stopPropagation();
        ensureAudioContext();
        slot.engine?.reload();
      };
      cell.querySelector('.mv-fs-btn').onclick = (e) => {
        e.stopPropagation();
        if (document.fullscreenElement === cell) document.exitFullscreen();
        else cell.requestFullscreen?.();
      };
      cell.querySelector('.mv-clear-btn').onclick = (e) => {
        e.stopPropagation();
        clearSlot(i);
      };

      cell.onclick = () => {
        ensureAudioContext();
        if (slot.channel) focusAudio(i);
        else if (onRequestChannelPicker) onRequestChannelPicker(i);
      };
      cell.ondblclick = () => {
        if (!slot.channel) return;
        if (document.fullscreenElement === cell) document.exitFullscreen();
        else cell.requestFullscreen?.();
      };

      containerEl.appendChild(cell);

      if (slot.channel) {
        slot.engine.play(slot.channel.url, 0, null, slot.channel.tsUrl || '');
      }
    }

    syncAudioFocus();
  }

  function assignChannel(slotIndex, channel) {
    if (slotIndex < 0 || slotIndex >= MAX_SLOTS || !channel) return;
    ensureAudioContext();
    const slot = slots[slotIndex];
    slot.channel = channel;

    attachSlotAudioGraph(slot);

    if (!slots[activeAudioSlot] || !slots[activeAudioSlot].channel) {
      activeAudioSlot = slotIndex;
      globalMuted = false;
    }

    const cell = containerEl?.querySelector(`.mv-cell[data-slot="${slotIndex}"]`);
    if (cell) {
      cell.querySelector('.mv-empty')?.classList.add('hidden');
      cell.querySelector('.mv-ch-title').textContent = channel.name;
    }

    slot.engine?.play(channel.url, 0, null, channel.tsUrl || '');
    syncAudioFocus();
  }

  function clearSlot(slotIndex) {
    const slot = slots[slotIndex];
    if (!slot) return;
    slot.channel = null;
    slot.engine?.stop();
    const cell = containerEl?.querySelector(`.mv-cell[data-slot="${slotIndex}"]`);
    if (cell) {
      cell.querySelector('.mv-empty')?.classList.remove('hidden');
      cell.querySelector('.mv-ch-title').textContent = 'Vazio';
      cell.querySelector('.mv-status').textContent = '';
    }
    if (slotIndex === activeAudioSlot) {
      const next = slots.findIndex((s, idx) => idx < activeCount && s.channel);
      if (next !== -1) activeAudioSlot = next;
    }
    syncAudioFocus();
  }

  function clearAll() {
    for (let i = 0; i < MAX_SLOTS; i++) clearSlot(i);
  }

  function pauseAll() {
    slots.forEach((s) => s.videoEl && s.videoEl.pause());
  }

  function suspendAll() {
    slots.forEach((s) => {
      if (s.engine) s.engine.stop();
    });
  }

  function resumeAll() {
    ensureAudioContext();
    slots.forEach((s, idx) => {
      if (idx < activeCount && s.channel && s.engine) {
        if (!s.engine.hls && !s.engine.tsPlayer && (!s.videoEl || !s.videoEl.src)) {
          s.engine.play(s.channel.url, 0, null, s.channel.tsUrl || '');
        } else if (s.videoEl && s.videoEl.paused) {
          s.videoEl.play().catch(() => {});
        }
      }
    });
    syncAudioFocus();
  }

  function muteAll(muted) {
    globalMuted = Boolean(muted);
    syncAudioFocus();
  }

  function focusAudio(slotIndex) {
    if (slotIndex < 0 || slotIndex >= activeCount) return;
    ensureAudioContext();
    activeAudioSlot = slotIndex;
    globalMuted = false;
    const target = slots[slotIndex];
    if (target && target.volume < 0.1) target.volume = 0.85;
    if (target) attachSlotAudioGraph(target);
    syncAudioFocus();
    if (target?.videoEl && target.channel && target.videoEl.paused) {
      target.videoEl.play().catch(() => {});
    }
  }

  function syncAudioFocus() {
    if (!containerEl) return;
    ensureAudioContext();
    for (let i = 0; i < MAX_SLOTS; i++) {
      applySlotAudio(i);
    }
  }

  // Presets de 6 telas
  function loadPresets() {
    try { return JSON.parse(localStorage.getItem(PRESETS_KEY) || '[]'); } catch (_) { return []; }
  }

  function saveCurrentPreset(name) {
    const presetName = (name || '').trim() || `Grade ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    const channels = slots.slice(0, activeCount).map((s) => (s.channel ? { id: s.channel.id, name: s.channel.name, url: s.channel.url, tsUrl: s.channel.tsUrl || '', logo: s.channel.logo } : null));
    if (!channels.some(Boolean)) return false;
    const presets = loadPresets();
    presets.unshift({ id: Date.now(), name: presetName, count: activeCount, channels });
    localStorage.setItem(PRESETS_KEY, JSON.stringify(presets.slice(0, 8)));
    renderPresetsBar();
    return true;
  }

  function applyPreset(presetId) {
    ensureAudioContext();
    const preset = loadPresets().find((p) => p.id === presetId);
    if (!preset) return;
    setLayout(preset.count || 6);
    preset.channels.forEach((ch, idx) => {
      if (ch) assignChannel(idx, ch);
      else clearSlot(idx);
    });
  }

  function deletePreset(presetId) {
    const presets = loadPresets().filter((p) => p.id !== presetId);
    localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
    renderPresetsBar();
  }

  function renderPresetsBar() {
    const bar = document.getElementById('mvPresetsBar');
    if (!bar) return;
    const presets = loadPresets();
    if (!presets.length) {
      bar.innerHTML = '<span class="muted-hint">Nenhum preset salvo ainda — monte suas 6 telas e clique em "Salvar Preset".</span>';
      return;
    }
    bar.innerHTML = presets.map((p) => `
      <div class="preset-chip">
        <button class="preset-load" data-id="${p.id}">▶ ${escapeHtml(p.name)} (${p.count}T)</button>
        <button class="preset-del" data-id="${p.id}" title="Remover">×</button>
      </div>
    `).join('');

    bar.querySelectorAll('.preset-load').forEach((b) => {
      b.onclick = () => applyPreset(Number(b.dataset.id));
    });
    bar.querySelectorAll('.preset-del').forEach((b) => {
      b.onclick = () => deletePreset(Number(b.dataset.id));
    });
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }

  return {
    init,
    setLayout,
    assignChannel,
    clearSlot,
    clearAll,
    pauseAll,
    suspendAll,
    resumeAll,
    muteAll,
    focusAudio,
    saveCurrentPreset,
    getActiveCount: () => activeCount
  };
})();
