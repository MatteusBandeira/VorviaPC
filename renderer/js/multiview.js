// Modulo Multitela Pro v1.2.2 (ate 6 telas simultaneas em grade 3x2)
// Audio estavel no Electron/Chromium: mantem o pipeline de audio vivo via volume inaudivel
// (em vez de video.muted = true, que suspende o decoder MSE e faz o som sumir ao trocar de tela).

window.VorviaMultiview = (function () {
  const PRESETS_KEY = 'vorvia_pc_multiview_presets_v1';
  const MAX_SLOTS = 6;
  // Volume inaudivel (-86 dB) que impede o Chromium de suspender o decoder de audio em streams MSE ao vivo
  const SILENT_VOLUME = 0.00005;

  let activeCount = 6; // Padrao ja pronto em 6 telas!
  let activeAudioSlot = 0;
  let globalMuted = false;
  let slots = [];
  let onRequestChannelPicker = null;
  let containerEl = null;

  function init(container, pickerCallback) {
    containerEl = container;
    onRequestChannelPicker = pickerCallback;
    for (let i = 0; i < MAX_SLOTS; i++) {
      slots.push({
        index: i,
        channel: null,
        engine: null,
        videoEl: null,
        statusEl: null,
        titleEl: null,
        volume: 0.85
      });
    }
    renderGrid();
    renderPresetsBar();
  }

  function setLayout(count) {
    activeCount = Math.min(MAX_SLOTS, Math.max(1, Number(count) || 6));
    // Para streams de slots ocultos para economizar banda e GPU
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

    const isFocused = !globalMuted && idx === activeAudioSlot;
    const targetVol = isFocused ? Math.max(0.05, Math.min(1, Number(slot.volume) || 0.85)) : SILENT_VOLUME;

    // Nunca usa muted = true para evitar o bug do Chromium que derruba o audio MSE ao alternar telas
    slot.videoEl.defaultMuted = false;
    slot.videoEl.muted = false;
    try {
      slot.videoEl.volume = targetVol;
    } catch (_) {}

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

    // Atualiza botoes de layout
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

      videoEl.defaultMuted = false;
      videoEl.muted = false;
      videoEl.volume = isFocused ? slot.volume : SILENT_VOLUME;

      // Reaplica o nivel de audio sempre que o stream iniciar ou reconectar
      const enforceAudio = () => applySlotAudio(i);
      videoEl.addEventListener('loadedmetadata', enforceAudio);
      videoEl.addEventListener('canplay', enforceAudio);
      videoEl.addEventListener('playing', enforceAudio);

      slot.videoEl = videoEl;
      slot.statusEl = statusEl;
      slot.titleEl = titleEl;

      // Recria engine limpa vinculada ao novo elemento <video>
      if (slot.engine) slot.engine.destroy();
      slot.engine = window.VorviaPlayerEngine.create(videoEl, {
        onStatus: (state, msg) => {
          statusEl.textContent = msg;
          statusEl.className = `mv-status st-${state}`;
          if (state === 'playing') applySlotAudio(i);
        }
      });

      // Eventos
      cell.querySelector('.mv-pick-btn').onclick = (e) => {
        e.stopPropagation();
        if (onRequestChannelPicker) onRequestChannelPicker(i);
      };
      cell.querySelector('.mv-change-btn').onclick = (e) => {
        e.stopPropagation();
        if (onRequestChannelPicker) onRequestChannelPicker(i);
      };
      cell.querySelector('.mv-audio-btn').onclick = (e) => {
        e.stopPropagation();
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
        slot.volume = Math.max(0.05, Number(e.target.value));
        activeAudioSlot = i;
        globalMuted = false;
        syncAudioFocus();
      };

      cell.querySelector('.mv-reload-btn').onclick = (e) => {
        e.stopPropagation();
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

      // Clique no video foca o audio automaticamente; duplo clique abre tela cheia
      cell.onclick = () => {
        if (slot.channel) focusAudio(i);
        else if (onRequestChannelPicker) onRequestChannelPicker(i);
      };
      cell.ondblclick = () => {
        if (!slot.channel) return;
        if (document.fullscreenElement === cell) document.exitFullscreen();
        else cell.requestFullscreen?.();
      };

      containerEl.appendChild(cell);

      // Retoma canal se ja havia um carregado no slot
      if (slot.channel) {
        slot.engine.play(slot.channel.url, 0, null, slot.channel.tsUrl || '');
      }
    }

    syncAudioFocus();
  }

  function assignChannel(slotIndex, channel) {
    if (slotIndex < 0 || slotIndex >= MAX_SLOTS || !channel) return;
    const slot = slots[slotIndex];
    slot.channel = channel;

    // Se a tela que estava com foco de audio estava vazia, passa o audio para este canal automaticamente
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
    // Se fechou a tela que estava com o som ativo, transfere para outra tela que tenha canal tocando
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

  // Fecha as conexoes de rede das telas sem apagar os canais escolhidos (evita derrubar contas de 1 tela)
  function suspendAll() {
    slots.forEach((s) => {
      if (s.engine) s.engine.stop();
    });
  }

  function resumeAll() {
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
    activeAudioSlot = slotIndex;
    globalMuted = false;
    const target = slots[slotIndex];
    if (target && target.volume < 0.1) target.volume = 0.85;
    syncAudioFocus();
    if (target?.videoEl && target.channel && target.videoEl.paused) {
      target.videoEl.play().catch(() => {});
    }
  }

  function syncAudioFocus() {
    if (!containerEl) return;
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
