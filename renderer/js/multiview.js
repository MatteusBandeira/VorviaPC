// Modulo Multitela Pro (ate 6 telas simultaneas em grade 3x2)
// Controles individuais de audio, troca rapida de canal, tela cheia individual, atalhos 1-6 e presets salvos.

window.VorviaMultiview = (function () {
  const PRESETS_KEY = 'vorvia_pc_multiview_presets_v1';
  const MAX_SLOTS = 6;

  let activeCount = 6; // Padrao ja pronto em 6 telas!
  let activeAudioSlot = 0;
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
      const cell = document.createElement('div');
      cell.className = `mv-cell ${i === activeAudioSlot ? 'audio-active' : ''}`;
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
          <button class="mv-icon-btn mv-audio-btn" title="Ativar som desta tela (Tecla ${i + 1})">
            ${i === activeAudioSlot ? '🔊 Som Ativo' : '🔇 Mudo'}
          </button>
          <input type="range" class="mv-vol-slider" min="0" max="1" step="0.05" value="${slot.volume}" title="Volume">
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

      slot.videoEl = videoEl;
      slot.statusEl = statusEl;
      slot.titleEl = titleEl;

      // Recria engine limpa vinculada ao novo elemento <video>
      if (slot.engine) slot.engine.destroy();
      slot.engine = window.VorviaPlayerEngine.create(videoEl, {
        onStatus: (state, msg) => {
          statusEl.textContent = msg;
          statusEl.className = `mv-status st-${state}`;
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
        focusAudio(i);
      };
      cell.querySelector('.mv-vol-slider').oninput = (e) => {
        e.stopPropagation();
        slot.volume = Number(e.target.value);
        if (slot.videoEl) slot.videoEl.volume = slot.volume;
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
        slot.engine.play(slot.channel.url);
      }
    }

    syncAudioFocus();
  }

  function assignChannel(slotIndex, channel) {
    if (slotIndex < 0 || slotIndex >= MAX_SLOTS || !channel) return;
    const slot = slots[slotIndex];
    slot.channel = channel;

    const cell = containerEl?.querySelector(`.mv-cell[data-slot="${slotIndex}"]`);
    if (cell) {
      cell.querySelector('.mv-empty')?.classList.add('hidden');
      cell.querySelector('.mv-ch-title').textContent = channel.name;
    }

    slot.engine?.play(channel.url);
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
  }

  function clearAll() {
    for (let i = 0; i < MAX_SLOTS; i++) clearSlot(i);
  }

  function pauseAll() {
    slots.forEach((s) => s.videoEl && s.videoEl.pause());
  }

  function resumeAll() {
    slots.forEach((s, idx) => {
      if (idx < activeCount && s.channel && s.videoEl) s.videoEl.play().catch(() => {});
    });
  }

  function muteAll(muted) {
    slots.forEach((s, idx) => {
      if (!s.videoEl) return;
      s.videoEl.muted = muted ? true : idx !== activeAudioSlot;
    });
  }

  function focusAudio(slotIndex) {
    if (slotIndex < 0 || slotIndex >= activeCount) return;
    activeAudioSlot = slotIndex;
    syncAudioFocus();
  }

  function syncAudioFocus() {
    if (!containerEl) return;
    slots.forEach((slot, idx) => {
      const isFocused = idx === activeAudioSlot;
      if (slot.videoEl) {
        slot.videoEl.muted = !isFocused;
        slot.videoEl.volume = slot.volume;
      }
      const cell = containerEl.querySelector(`.mv-cell[data-slot="${idx}"]`);
      if (cell) {
        cell.classList.toggle('audio-active', isFocused);
        const btn = cell.querySelector('.mv-audio-btn');
        if (btn) btn.textContent = isFocused ? '🔊 Som Ativo' : '🔇 Mudo';
      }
    });
  }

  // Presets de 6 telas
  function loadPresets() {
    try { return JSON.parse(localStorage.getItem(PRESETS_KEY) || '[]'); } catch (_) { return []; }
  }

  function saveCurrentPreset(name) {
    const presetName = (name || '').trim() || `Grade ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    const channels = slots.slice(0, activeCount).map((s) => (s.channel ? { id: s.channel.id, name: s.channel.name, url: s.channel.url, logo: s.channel.logo } : null));
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
    resumeAll,
    muteAll,
    focusAudio,
    saveCurrentPreset,
    getActiveCount: () => activeCount
  };
})();
