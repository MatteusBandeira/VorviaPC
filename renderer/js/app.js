// Vorvia PC - Aplicacao Principal
(function () {
  const STORAGE = {
    profiles: 'vorvia_pc_profiles_v1',
    continueWatching: 'vorvia_pc_continue_v1',
    favorites: 'vorvia_pc_favorites_v1',
    settings: 'vorvia_pc_settings_v1'
  };

  const state = {
    profile: null,
    liveCategories: [],
    liveStreams: [],
    movieCategories: [],
    movies: [],
    seriesCategories: [],
    series: [],
    activeView: 'home',
    selectedLiveCat: 'ALL',
    selectedMovieCat: 'ALL',
    selectedSeriesCat: 'ALL',
    movieLimit: 60,
    seriesLimit: 60,
    currentLivePreview: null,
    livePreviewEngine: null,
    mainPlayerEngine: null,
    currentPlayingItem: null,
    pickerTargetSlot: 0,
    settings: {
      tmdbKey: '',
      pauseOnMinimize: true,
      muteOnMinimize: false,
      parentalEnabled: false,
      parentalPin: '0000'
    }
  };

  const ADULT_REGEX = /\b(xxx|adult|adulto|adultos|\+18|18\+|porn|erotic|sexy|hot)\b/i;

  // Helpers
  const $ = (id) => document.getElementById(id);
  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); } catch (_) { return fallback; }
  }
  function writeJson(key, val) {
    localStorage.setItem(key, JSON.stringify(val));
  }
  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }
  function formatTime(sec) {
    if (!isFinite(sec) || sec < 0) return '00:00';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    return h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  // Inicializacao
  function boot() {
    state.settings = { ...state.settings, ...readJson(STORAGE.settings, {}) };
    applySettingsToUI();
    bindTitlebar();
    bindNetworkEvents();
    bindBackgroundEvents();
    bindLogin();
    bindNavigation();
    bindModals();
    bindFullPlayer();
    bindSettings();
    bindKeyboardShortcuts();

    state.livePreviewEngine = window.VorviaPlayerEngine.create($('livePreviewVideo'), {
      onStatus: (st, msg) => {
        $('livePreviewStatus').textContent = msg;
      }
    });

    window.VorviaMultiview.init($('mvGridContainer'), (slotIdx) => {
      openChannelPicker(slotIdx);
    });

    renderSavedProfiles();
  }

  // Barra de titulo
  function bindTitlebar() {
    $('btnMin').onclick = () => window.vorviaAPI.minimize();
    $('btnMax').onclick = () => window.vorviaAPI.maximize();
    $('btnClose').onclick = () => window.vorviaAPI.close();
    $('btnFullscreen').onclick = () => window.vorviaAPI.toggleFullscreen();

    $('globalSearchInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const q = e.target.value.trim();
        if (q) runGlobalSearch(q);
      }
    });
  }

  // Alerta Offline / Online
  function bindNetworkEvents() {
    const updateNet = () => {
      const online = navigator.onLine;
      $('netIndicator').textContent = online ? '● Online' : '● Offline';
      $('netIndicator').className = `net-pill ${online ? 'online' : 'offline'}`;
      $('offlineBanner').classList.toggle('hidden', online);
      if (online) {
        if (state.activeView === 'multiview') window.VorviaMultiview.resumeAll();
      }
    };
    window.addEventListener('online', updateNet);
    window.addEventListener('offline', updateNet);
    updateNet();
  }

  // Controle de Segundo Plano ao minimizar
  function bindBackgroundEvents() {
    window.vorviaAPI.onWindowState(({ minimized }) => {
      if (minimized) {
        if (state.settings.pauseOnMinimize) {
          $('mainVideo').pause();
          $('livePreviewVideo').pause();
          window.VorviaMultiview.pauseAll();
        } else if (state.settings.muteOnMinimize) {
          $('mainVideo').muted = true;
          $('livePreviewVideo').muted = true;
          window.VorviaMultiview.muteAll(true);
        }
      } else {
        if (state.settings.muteOnMinimize) {
          $('mainVideo').muted = false;
          $('livePreviewVideo').muted = false;
          window.VorviaMultiview.muteAll(false);
        }
      }
    });
  }

  // Login e Gerenciador de Listas
  function bindLogin() {
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.onclick = () => {
        document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.tab;
        $('xtreamForm').classList.toggle('hidden', tab !== 'xtream');
        $('m3uForm').classList.toggle('hidden', tab !== 'm3u');
      };
    });

    $('xtreamForm').onsubmit = async (e) => {
      e.preventDefault();
      const profile = {
        id: Date.now(),
        type: 'xtream',
        name: $('xtName').value.trim(),
        server: $('xtServer').value.trim().replace(/\/+$/, ''),
        user: $('xtUser').value.trim(),
        pass: $('xtPass').value.trim()
      };
      await connectProfile(profile, true);
    };

    $('m3uForm').onsubmit = async (e) => {
      e.preventDefault();
      const profile = {
        id: Date.now(),
        type: 'm3u',
        name: $('m3uName').value.trim(),
        url: $('m3uUrl').value.trim()
      };
      await connectProfile(profile, true);
    };
  }

  function renderSavedProfiles() {
    const list = readJson(STORAGE.profiles, []);
    $('savedProfilesWrap').classList.toggle('hidden', !list.length);
    const container = $('savedProfilesList');
    container.innerHTML = '';
    list.forEach((p) => {
      const el = document.createElement('div');
      el.className = 'profile-item';
      el.innerHTML = `<span>${p.type === 'xtream' ? '⚡' : '📄'} <strong>${escapeHtml(p.name)}</strong></span><button class="p-del" title="Remover">×</button>`;
      el.onclick = () => connectProfile(p, false);
      el.querySelector('.p-del').onclick = (e) => {
        e.stopPropagation();
        const filtered = readJson(STORAGE.profiles, []).filter((x) => x.id !== p.id);
        writeJson(STORAGE.profiles, filtered);
        renderSavedProfiles();
      };
      container.appendChild(el);
    });
  }

  function saveProfile(profile) {
    const list = readJson(STORAGE.profiles, []).filter((x) => x.name !== profile.name);
    list.unshift(profile);
    writeJson(STORAGE.profiles, list.slice(0, 10));
    renderSavedProfiles();
  }

  async function connectProfile(profile, shouldSave) {
    const status = $('loginStatus');
    status.textContent = 'Conectando ao servidor e carregando catálogo...';
    try {
      if (profile.type === 'xtream') {
        await loadXtreamCatalog(profile);
      } else {
        await loadM3UCatalog(profile);
      }
      state.profile = profile;
      if (shouldSave) saveProfile(profile);

      $('activeProfileBadge').textContent = profile.name;
      $('activeProfileBadge').classList.remove('hidden');
      $('loginScreen').classList.add('hidden');
      $('appShell').classList.remove('hidden');
      status.textContent = '';
      renderAllInitialViews();
    } catch (err) {
      status.textContent = `Erro ao conectar: ${err.message || 'verifique os dados e tente novamente.'}`;
    }
  }

  async function xtreamFetch(profile, action, extra = '') {
    const url = `${profile.server}/player_api.php?username=${encodeURIComponent(profile.user)}&password=${encodeURIComponent(profile.pass)}${action ? '&action=' + action : ''}${extra}`;
    const res = await window.vorviaAPI.netFetch(url, { timeout: 30000 });
    if (!res.ok) throw new Error(`HTTP ${res.status || 'Sem resposta'}`);
    return JSON.parse(res.text);
  }

  async function loadXtreamCatalog(profile) {
    const auth = await xtreamFetch(profile, '');
    if (!auth.user_info || String(auth.user_info.auth) === '0') {
      throw new Error('Usuário ou senha inválidos.');
    }

    const [liveCats, liveStreams, vodCats, vodStreams, serCats, serList] = await Promise.all([
      xtreamFetch(profile, 'get_live_categories').catch(() => []),
      xtreamFetch(profile, 'get_live_streams').catch(() => []),
      xtreamFetch(profile, 'get_vod_categories').catch(() => []),
      xtreamFetch(profile, 'get_vod_streams').catch(() => []),
      xtreamFetch(profile, 'get_series_categories').catch(() => []),
      xtreamFetch(profile, 'get_series').catch(() => [])
    ]);

    const liveCatMap = Object.fromEntries((liveCats || []).map((c) => [String(c.category_id), c.category_name]));
    const vodCatMap = Object.fromEntries((vodCats || []).map((c) => [String(c.category_id), c.category_name]));
    const serCatMap = Object.fromEntries((serCats || []).map((c) => [String(c.category_id), c.category_name]));

    state.liveCategories = liveCats || [];
    state.liveStreams = (liveStreams || []).map((c) => ({
      id: String(c.stream_id),
      name: c.name || 'Canal',
      logo: c.stream_icon || '',
      categoryId: String(c.category_id || ''),
      categoryName: liveCatMap[String(c.category_id)] || 'Geral',
      url: `${profile.server}/live/${encodeURIComponent(profile.user)}/${encodeURIComponent(profile.pass)}/${c.stream_id}.m3u8`,
      tsUrl: `${profile.server}/live/${encodeURIComponent(profile.user)}/${encodeURIComponent(profile.pass)}/${c.stream_id}.ts`,
      type: 'live'
    }));

    state.movieCategories = vodCats || [];
    state.movies = (vodStreams || []).map((m) => ({
      id: String(m.stream_id),
      name: m.name || 'Filme',
      poster: m.stream_icon || '',
      rating: m.rating || '',
      added: Number(m.added || 0),
      categoryId: String(m.category_id || ''),
      categoryName: vodCatMap[String(m.category_id)] || 'Filmes',
      ext: m.container_extension || 'mp4',
      url: `${profile.server}/movie/${encodeURIComponent(profile.user)}/${encodeURIComponent(profile.pass)}/${m.stream_id}.${m.container_extension || 'mp4'}`,
      type: 'movie'
    }));

    state.seriesCategories = serCats || [];
    state.series = (serList || []).map((s) => ({
      id: String(s.series_id),
      name: s.name || 'Série',
      poster: s.cover || '',
      rating: s.rating || '',
      plot: s.plot || '',
      added: Number(s.last_modified || 0),
      categoryId: String(s.category_id || ''),
      categoryName: serCatMap[String(s.category_id)] || 'Séries',
      type: 'series'
    }));

    const exp = auth.user_info.exp_date ? new Date(Number(auth.user_info.exp_date) * 1000).toLocaleDateString('pt-BR') : 'Ilimitado';
    $('accountSummary').textContent = `Perfil: ${profile.name} • Validade: ${exp} • GPU acelerada para 6 telas`;
  }

  async function loadM3UCatalog(profile) {
    const res = await window.vorviaAPI.netFetch(profile.url, { timeout: 45000 });
    if (!res.ok) throw new Error('Não foi possível baixar a lista M3U.');
    const lines = res.text.split(/\r?\n/);

    const live = [];
    const movies = [];
    const liveCats = new Set();
    const movieCats = new Set();

    let current = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('#EXTINF')) {
        const logo = (line.match(/tvg-logo="([^"]*)"/i) || [])[1] || '';
        const group = (line.match(/group-title="([^"]*)"/i) || [])[1] || 'Geral';
        const name = line.split(',').slice(1).join(',').trim() || 'Sem título';
        current = { name, logo, group };
      } else if (line && !line.startsWith('#') && current) {
        const isVod = /\.(mp4|mkv|avi|mov)(\?|$)/i.test(line) || /\/movie\//i.test(line);
        if (isVod) {
          movieCats.add(current.group);
          movies.push({
            id: `m3u_m_${movies.length}`,
            name: current.name,
            poster: current.logo,
            categoryId: current.group,
            categoryName: current.group,
            url: line,
            type: 'movie',
            added: movies.length
          });
        } else {
          liveCats.add(current.group);
          live.push({
            id: `m3u_l_${live.length}`,
            name: current.name,
            logo: current.logo,
            categoryId: current.group,
            categoryName: current.group,
            url: line,
            type: 'live'
          });
        }
        current = null;
      }
    }

    state.liveCategories = [...liveCats].map((g) => ({ category_id: g, category_name: g }));
    state.liveStreams = live;
    state.movieCategories = [...movieCats].map((g) => ({ category_id: g, category_name: g }));
    state.movies = movies;
    state.seriesCategories = [];
    state.series = [];
    $('accountSummary').textContent = `Lista M3U: ${profile.name} • GPU acelerada para 6 telas`;
  }

  // Controle Parental
  function checkParentalAccess(categoryName) {
    if (!state.settings.parentalEnabled) return true;
    if (!ADULT_REGEX.test(categoryName || '')) return true;
    const entered = window.prompt('Categoria protegida pelo Controle Parental. Digite o PIN:');
    return entered === state.settings.parentalPin;
  }

  // Navegacao
  function bindNavigation() {
    document.querySelectorAll('.nav-btn[data-view]').forEach((btn) => {
      btn.onclick = () => switchView(btn.dataset.view);
    });
    document.querySelectorAll('[data-jump]').forEach((btn) => {
      btn.onclick = () => switchView(btn.dataset.jump);
    });
    $('btnSwitchAccount').onclick = () => {
      state.livePreviewEngine?.stop();
      window.VorviaMultiview.clearAll();
      $('appShell').classList.add('hidden');
      $('loginScreen').classList.remove('hidden');
    };
  }

  function switchView(viewName) {
    state.activeView = viewName;
    document.querySelectorAll('.nav-btn[data-view]').forEach((b) => {
      b.classList.toggle('active', b.dataset.view === viewName);
    });
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    $(`view-${viewName}`)?.classList.add('active');

    if (viewName !== 'live') state.livePreviewEngine?.stop();
    if (viewName === 'favorites') renderFavorites();
    if (viewName === 'home') renderContinueWatching();
  }

  function renderAllInitialViews() {
    $('statLive').textContent = state.liveStreams.length;
    $('statMovies').textContent = state.movies.length;
    $('statSeries').textContent = state.series.length;

    renderContinueWatching();
    const recentMovies = [...state.movies].sort((a, b) => (b.added || 0) - (a.added || 0)).slice(0, 12);
    const recentSeries = [...state.series].sort((a, b) => (b.added || 0) - (a.added || 0)).slice(0, 12);
    renderCardsGrid($('recentMoviesGrid'), recentMovies, 'movie');
    renderCardsGrid($('recentSeriesGrid'), recentSeries, 'series');

    setupLiveView();
    setupMoviesView();
    setupSeriesView();
    setupMultiviewToolbar();
    switchView('home');
  }

  // Continuar Assistindo
  function saveContinueWatching(item, currentTime, duration) {
    if (!item || item.type === 'live' || !isFinite(duration) || duration < 30) return;
    const list = readJson(STORAGE.continueWatching, []).filter((x) => x.id !== item.id);
    if (currentTime / duration < 0.94 && currentTime > 10) {
      list.unshift({ ...item, currentTime, duration, updatedAt: Date.now() });
    }
    writeJson(STORAGE.continueWatching, list.slice(0, 20));
  }

  function renderContinueWatching() {
    const list = readJson(STORAGE.continueWatching, []);
    $('continueBlock').classList.toggle('hidden', !list.length);
    const wrap = $('continueGrid');
    wrap.innerHTML = '';
    list.forEach((item) => {
      const pct = Math.min(100, Math.round((item.currentTime / item.duration) * 100));
      const card = buildMediaCard(item, pct);
      card.onclick = () => openFullPlayer(item, item.currentTime);
      wrap.appendChild(card);
    });
    $('btnClearContinue').onclick = () => {
      writeJson(STORAGE.continueWatching, []);
      renderContinueWatching();
    };
  }

  // Favoritos
  function getFavorites() { return readJson(STORAGE.favorites, []); }
  function isFavorite(id, type) { return getFavorites().some((f) => f.id === id && f.type === type); }
  function toggleFavorite(item) {
    let favs = getFavorites();
    if (isFavorite(item.id, item.type)) favs = favs.filter((f) => !(f.id === item.id && f.type === item.type));
    else favs.unshift({ id: item.id, name: item.name, poster: item.poster || item.logo || '', url: item.url, type: item.type, categoryName: item.categoryName || '' });
    writeJson(STORAGE.favorites, favs);
    return isFavorite(item.id, item.type);
  }
  function renderFavorites() {
    const favs = getFavorites();
    const grid = $('favoritesGrid');
    grid.innerHTML = favs.length ? '' : '<p class="muted-hint">Você ainda não favoritou nenhum canal, filme ou série.</p>';
    favs.forEach((item) => {
      const card = buildMediaCard(item);
      card.onclick = () => {
        if (item.type === 'live') openFullPlayer(item);
        else openDetailsModal(item, item.type);
      };
      grid.appendChild(card);
    });
  }

  // Cards genericos
  function buildMediaCard(item, progressPct = null) {
    const card = document.createElement('div');
    card.className = 'media-card';
    const poster = item.poster || item.logo || '../assets/icon.svg';
    card.innerHTML = `
      <div class="card-poster-wrap">
        <img class="card-poster" src="${escapeHtml(poster)}" loading="lazy" onerror="this.src='../assets/icon.svg'" />
        ${item.rating ? `<span class="card-rating">★ ${escapeHtml(String(item.rating).slice(0, 4))}</span>` : ''}
        ${progressPct !== null ? `<div class="card-progress"><div style="width:${progressPct}%"></div></div>` : ''}
      </div>
      <div class="card-info">
        <div class="card-title" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</div>
        <div class="card-sub">${escapeHtml(item.categoryName || item.type)}</div>
      </div>
    `;
    return card;
  }

  function renderCardsGrid(container, items, mediaType) {
    container.innerHTML = '';
    if (!items.length) {
      container.innerHTML = '<p class="muted-hint">Nenhum item encontrado.</p>';
      return;
    }
    const frag = document.createDocumentFragment();
    items.forEach((item) => {
      const card = buildMediaCard(item);
      card.onclick = () => openDetailsModal(item, mediaType);
      frag.appendChild(card);
    });
    container.appendChild(frag);
  }

  // TV AO VIVO
  function setupLiveView() {
    const renderCats = (filter = '') => {
      const wrap = $('liveCategories');
      wrap.innerHTML = '';
      const cats = [{ category_id: 'ALL', category_name: `Todos (${state.liveStreams.length})` }, ...state.liveCategories]
        .filter((c) => c.category_name.toLowerCase().includes(filter.toLowerCase()));

      cats.forEach((c) => {
        const el = document.createElement('div');
        el.className = `cat-item ${state.selectedLiveCat === String(c.category_id) ? 'active' : ''}`;
        el.textContent = c.category_name;
        el.onclick = () => {
          if (!checkParentalAccess(c.category_name)) return;
          state.selectedLiveCat = String(c.category_id);
          renderCats($('liveCatFilter').value);
          renderChannels($('liveChFilter').value);
        };
        wrap.appendChild(el);
      });
    };

    const renderChannels = (filter = '') => {
      const wrap = $('liveChannelList');
      wrap.innerHTML = '';
      const list = state.liveStreams.filter((ch) => {
        if (state.settings.parentalEnabled && ADULT_REGEX.test(ch.categoryName) && state.selectedLiveCat === 'ALL') return false;
        const catOk = state.selectedLiveCat === 'ALL' || ch.categoryId === state.selectedLiveCat;
        const qOk = !filter || ch.name.toLowerCase().includes(filter.toLowerCase());
        return catOk && qOk;
      }).slice(0, 250);

      const frag = document.createDocumentFragment();
      list.forEach((ch) => {
        const el = document.createElement('div');
        el.className = `ch-item ${state.currentLivePreview?.id === ch.id ? 'active' : ''}`;
        el.innerHTML = `
          <img class="ch-logo" src="${escapeHtml(ch.logo || '../assets/icon.svg')}" loading="lazy" onerror="this.src='../assets/icon.svg'" />
          <span class="ch-name">${escapeHtml(ch.name)}</span>
        `;
        el.onclick = () => selectLiveChannel(ch);
        el.ondblclick = () => openFullPlayer(ch);
        frag.appendChild(el);
      });
      wrap.appendChild(frag);
    };

    $('liveCatFilter').oninput = (e) => renderCats(e.target.value);
    $('liveChFilter').oninput = (e) => renderChannels(e.target.value);

    $('btnLiveFullscreen').onclick = () => {
      if (state.currentLivePreview) {
        state.livePreviewEngine.stop();
        openFullPlayer(state.currentLivePreview);
      }
    };
    $('btnLiveFav').onclick = () => {
      if (!state.currentLivePreview) return;
      const fav = toggleFavorite(state.currentLivePreview);
      $('btnLiveFav').textContent = fav ? '★ Favoritado' : '★ Favoritar';
    };
    $('btnLiveToMulti').onclick = () => {
      if (!state.currentLivePreview) return;
      const ch = state.currentLivePreview;
      switchView('multiview');
      window.VorviaMultiview.assignChannel(0, ch);
    };

    renderCats();
    renderChannels();
  }

  function selectLiveChannel(ch) {
    state.currentLivePreview = ch;
    $('livePreviewTitle').textContent = ch.name;
    $('livePreviewCat').textContent = ch.categoryName;
    $('btnLiveFav').textContent = isFavorite(ch.id, 'live') ? '★ Favoritado' : '★ Favoritar';
    state.livePreviewEngine.play(ch.url);
    document.querySelectorAll('#liveChannelList .ch-item').forEach((el) => {
      el.classList.toggle('active', el.textContent.trim() === ch.name);
    });
  }

  // FILMES
  function setupMoviesView() {
    const renderCats = (filter = '') => {
      const wrap = $('movieCategories');
      wrap.innerHTML = '';
      const cats = [{ category_id: 'ALL', category_name: `Todos (${state.movies.length})` }, ...state.movieCategories]
        .filter((c) => c.category_name.toLowerCase().includes(filter.toLowerCase()));
      cats.forEach((c) => {
        const el = document.createElement('div');
        el.className = `cat-item ${state.selectedMovieCat === String(c.category_id) ? 'active' : ''}`;
        el.textContent = c.category_name;
        el.onclick = () => {
          if (!checkParentalAccess(c.category_name)) return;
          state.selectedMovieCat = String(c.category_id);
          state.movieLimit = 60;
          $('movieCatTitle').textContent = c.category_name;
          renderCats($('movieCatFilter').value);
          renderMovies();
        };
        wrap.appendChild(el);
      });
    };

    const renderMovies = () => {
      const q = $('movieSearchInput').value.trim().toLowerCase();
      const filtered = state.movies.filter((m) => {
        if (state.settings.parentalEnabled && ADULT_REGEX.test(m.categoryName) && state.selectedMovieCat === 'ALL') return false;
        const catOk = state.selectedMovieCat === 'ALL' || m.categoryId === state.selectedMovieCat;
        const qOk = !q || m.name.toLowerCase().includes(q);
        return catOk && qOk;
      });
      renderCardsGrid($('moviesGrid'), filtered.slice(0, state.movieLimit), 'movie');
      $('btnMoreMovies').classList.toggle('hidden', filtered.length <= state.movieLimit);
    };

    $('movieCatFilter').oninput = (e) => renderCats(e.target.value);
    $('movieSearchInput').oninput = () => { state.movieLimit = 60; renderMovies(); };
    $('btnMoreMovies').onclick = () => { state.movieLimit += 60; renderMovies(); };

    renderCats();
    renderMovies();
  }

  // SERIES
  function setupSeriesView() {
    const renderCats = (filter = '') => {
      const wrap = $('seriesCategories');
      wrap.innerHTML = '';
      const cats = [{ category_id: 'ALL', category_name: `Todas (${state.series.length})` }, ...state.seriesCategories]
        .filter((c) => c.category_name.toLowerCase().includes(filter.toLowerCase()));
      cats.forEach((c) => {
        const el = document.createElement('div');
        el.className = `cat-item ${state.selectedSeriesCat === String(c.category_id) ? 'active' : ''}`;
        el.textContent = c.category_name;
        el.onclick = () => {
          if (!checkParentalAccess(c.category_name)) return;
          state.selectedSeriesCat = String(c.category_id);
          state.seriesLimit = 60;
          $('seriesCatTitle').textContent = c.category_name;
          renderCats($('seriesCatFilter').value);
          renderSeries();
        };
        wrap.appendChild(el);
      });
    };

    const renderSeries = () => {
      const q = $('seriesSearchInput').value.trim().toLowerCase();
      const filtered = state.series.filter((s) => {
        if (state.settings.parentalEnabled && ADULT_REGEX.test(s.categoryName) && state.selectedSeriesCat === 'ALL') return false;
        const catOk = state.selectedSeriesCat === 'ALL' || s.categoryId === state.selectedSeriesCat;
        const qOk = !q || s.name.toLowerCase().includes(q);
        return catOk && qOk;
      });
      renderCardsGrid($('seriesGrid'), filtered.slice(0, state.seriesLimit), 'series');
      $('btnMoreSeries').classList.toggle('hidden', filtered.length <= state.seriesLimit);
    };

    $('seriesCatFilter').oninput = (e) => renderCats(e.target.value);
    $('seriesSearchInput').oninput = () => { state.seriesLimit = 60; renderSeries(); };
    $('btnMoreSeries').onclick = () => { state.seriesLimit += 60; renderSeries(); };

    renderCats();
    renderSeries();
  }

  // MODAL DE DETALHES + SINOPSE TURBINADA
  async function openDetailsModal(item, mediaType) {
    $('detailsModal').classList.remove('hidden');
    $('detailsTitle').textContent = item.name;
    $('detailsPlot').textContent = 'Buscando sinopse completa e metadados...';
    $('detailsPoster').src = item.poster || '../assets/icon.svg';
    $('detailsBackdrop').style.backgroundImage = item.poster ? `url("${item.poster}")` : 'none';
    $('detailsSource').textContent = 'Carregando...';
    $('detailsRating').textContent = item.rating ? `★ ${item.rating}` : '';
    $('detailsYear').textContent = '';
    $('detailsRuntime').textContent = '';
    $('detailsGenres').textContent = item.categoryName || '';
    $('detailsDirector').textContent = '—';
    $('detailsCast').textContent = '—';
    $('btnDetailsTrailer').classList.add('hidden');
    $('seriesEpisodesWrap').classList.add('hidden');

    $('btnDetailsFav').textContent = isFavorite(item.id, mediaType) ? '★ Favoritado' : '★ Favoritar';
    $('btnDetailsFav').onclick = () => {
      const fav = toggleFavorite({ ...item, type: mediaType });
      $('btnDetailsFav').textContent = fav ? '★ Favoritado' : '★ Favoritar';
    };

    // Busca detalhes completos da Xtream API
    let xtreamInfo = null;
    if (state.profile?.type === 'xtream') {
      try {
        if (mediaType === 'movie') {
          xtreamInfo = await xtreamFetch(state.profile, 'get_vod_info', `&vod_id=${encodeURIComponent(item.id)}`);
        } else if (mediaType === 'series') {
          xtreamInfo = await xtreamFetch(state.profile, 'get_series_info', `&series_id=${encodeURIComponent(item.id)}`);
        }
      } catch (_) {}
    }

    // Resolve sinopse turbinada (Xtream + TMDB PT-BR + limpeza de titulo)
    const det = await window.VorviaSynopsis.resolveDetails({
      item,
      mediaType,
      xtreamInfo,
      tmdbKey: state.settings.tmdbKey
    });

    $('detailsSource').textContent = det.source;
    $('detailsTitle').textContent = det.title;
    $('detailsRating').textContent = det.rating ? `★ ${det.rating}` : 'Sem nota';
    $('detailsYear').textContent = det.year || '—';
    $('detailsRuntime').textContent = det.runtime || '—';
    $('detailsGenres').textContent = det.genres || item.categoryName || '';
    $('detailsPlot').textContent = det.plot;
    $('detailsDirector').textContent = det.director || 'Não informado';
    $('detailsCast').textContent = det.cast || 'Não informado';
    if (det.poster) $('detailsPoster').src = det.poster;
    if (det.backdrop) $('detailsBackdrop').style.backgroundImage = `url("${det.backdrop}")`;

    if (det.trailerUrl) {
      $('btnDetailsTrailer').classList.remove('hidden');
      $('btnDetailsTrailer').onclick = () => window.vorviaAPI.openExternal(det.trailerUrl);
    }

    if (mediaType === 'movie') {
      $('btnDetailsPlay').classList.remove('hidden');
      $('btnDetailsPlay').onclick = () => {
        $('detailsModal').classList.add('hidden');
        openFullPlayer({ ...item, poster: det.poster || item.poster, type: 'movie' });
      };
    } else if (mediaType === 'series') {
      $('btnDetailsPlay').classList.add('hidden');
      renderSeriesEpisodes(item, xtreamInfo, det.poster);
    }
  }

  function renderSeriesEpisodes(seriesItem, xtreamInfo, poster) {
    const episodesObj = xtreamInfo?.episodes || {};
    const seasonKeys = Object.keys(episodesObj);
    if (!seasonKeys.length) return;

    $('seriesEpisodesWrap').classList.remove('hidden');
    const select = $('seasonSelect');
    select.innerHTML = seasonKeys.map((k) => `<option value="${k}">Temporada ${k}</option>`).join('');

    const showSeason = (seasonKey) => {
      const eps = episodesObj[seasonKey] || [];
      const list = $('episodesList');
      list.innerHTML = '';
      eps.forEach((ep) => {
        const epNum = ep.episode_num || '';
        const ext = ep.container_extension || 'mp4';
        const url = `${state.profile.server}/series/${encodeURIComponent(state.profile.user)}/${encodeURIComponent(state.profile.pass)}/${ep.id}.${ext}`;
        const card = document.createElement('div');
        card.className = 'ep-card';
        card.innerHTML = `
          <strong>E${epNum} • ${escapeHtml(ep.title || `Episódio ${epNum}`)}</strong>
          <p>${escapeHtml(ep.info?.plot || 'Clique para reproduzir este episódio.')}</p>
        `;
        card.onclick = () => {
          $('detailsModal').classList.add('hidden');
          openFullPlayer({
            id: `ep_${ep.id}`,
            name: `${seriesItem.name} - T${seasonKey}E${epNum}`,
            poster: poster || seriesItem.poster,
            url,
            type: 'series',
            categoryName: seriesItem.categoryName
          });
        };
        list.appendChild(card);
      });
    };

    select.onchange = () => showSeason(select.value);
    showSeason(seasonKeys[0]);
  }

  // MULTITELA TOOLBAR & PICKER
  function setupMultiviewToolbar() {
    document.querySelectorAll('.mv-layout-btn').forEach((btn) => {
      btn.onclick = () => window.VorviaMultiview.setLayout(Number(btn.dataset.count));
    });
    $('btnClearMultiview').onclick = () => window.VorviaMultiview.clearAll();
    $('btnSavePreset').onclick = () => {
      const name = window.prompt('Nome para este preset de Multitela (ex: Jogos de Domingo):');
      if (name !== null) window.VorviaMultiview.saveCurrentPreset(name);
    };
  }

  function openChannelPicker(slotIdx) {
    state.pickerTargetSlot = slotIdx;
    $('pickerTitle').textContent = `Escolher Canal para a Tela ${slotIdx + 1}`;
    $('pickerSearch').value = '';
    $('pickerModal').classList.remove('hidden');
    renderPickerList('');
    $('pickerSearch').focus();
  }

  function renderPickerList(query) {
    const q = (query || '').trim().toLowerCase();
    const list = state.liveStreams.filter((ch) => {
      if (state.settings.parentalEnabled && ADULT_REGEX.test(ch.categoryName)) return false;
      return !q || ch.name.toLowerCase().includes(q) || ch.categoryName.toLowerCase().includes(q);
    }).slice(0, 150);

    const wrap = $('pickerList');
    wrap.innerHTML = '';
    const frag = document.createDocumentFragment();
    list.forEach((ch) => {
      const el = document.createElement('div');
      el.className = 'ch-item';
      el.innerHTML = `
        <img class="ch-logo" src="${escapeHtml(ch.logo || '../assets/icon.svg')}" onerror="this.src='../assets/icon.svg'" />
        <span class="ch-name">${escapeHtml(ch.name)}</span>
        <span class="muted-hint" style="margin-left:auto;font-size:11px">${escapeHtml(ch.categoryName)}</span>
      `;
      el.onclick = () => {
        window.VorviaMultiview.assignChannel(state.pickerTargetSlot, ch);
        $('pickerModal').classList.add('hidden');
      };
      frag.appendChild(el);
    });
    wrap.appendChild(frag);
  }

  function bindModals() {
    document.querySelectorAll('[data-close]').forEach((el) => {
      el.onclick = () => $(el.dataset.close)?.classList.add('hidden');
    });
    $('pickerSearch').oninput = (e) => renderPickerList(e.target.value);
  }

  // BUSCA GLOBAL
  function runGlobalSearch(query) {
    const q = query.toLowerCase();
    switchView('search');
    $('searchResultsHeading').textContent = `Resultados para "${query}"`;

    const matchLive = state.liveStreams.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 24);
    const matchMovies = state.movies.filter((m) => m.name.toLowerCase().includes(q)).slice(0, 30);
    const matchSeries = state.series.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 30);

    const container = $('searchResultsContainer');
    container.innerHTML = '';

    const addGroup = (title, items, type) => {
      if (!items.length) return;
      const block = document.createElement('div');
      block.className = 'section-block';
      block.innerHTML = `<div class="section-head"><h3>${title} (${items.length})</h3></div><div class="cards-grid"></div>`;
      const grid = block.querySelector('.cards-grid');
      items.forEach((it) => {
        const card = buildMediaCard(it);
        card.onclick = () => (type === 'live' ? openFullPlayer(it) : openDetailsModal(it, type));
        grid.appendChild(card);
      });
      container.appendChild(block);
    };

    addGroup('TV ao Vivo', matchLive, 'live');
    addGroup('Filmes', matchMovies, 'movie');
    addGroup('Séries', matchSeries, 'series');

    if (!container.children.length) {
      container.innerHTML = '<p class="muted-hint">Nenhum canal, filme ou série encontrado com esse termo.</p>';
    }
  }

  // PLAYER TELA CHEIA
  function bindFullPlayer() {
    const video = $('mainVideo');
    state.mainPlayerEngine = window.VorviaPlayerEngine.create(video, {
      onStatus: (_st, msg) => { $('fpStatus').textContent = msg; }
    });

    $('fpBack').onclick = closeFullPlayer;
    $('fpReload').onclick = () => state.mainPlayerEngine.reload();
    $('fpPlayPause').onclick = () => (video.paused ? video.play() : video.pause());
    $('fpBack10').onclick = () => { video.currentTime = Math.max(0, video.currentTime - 10); };
    $('fpFwd10').onclick = () => { video.currentTime = video.currentTime + 10; };
    $('fpMute').onclick = () => {
      video.muted = !video.muted;
      $('fpMute').textContent = video.muted ? '🔇' : '🔊';
    };
    $('fpVol').oninput = (e) => { video.volume = Number(e.target.value); };
    $('fpFs').onclick = () => window.vorviaAPI.toggleFullscreen();

    video.onplay = () => { $('fpPlayPause').textContent = '⏸'; };
    video.onpause = () => { $('fpPlayPause').textContent = '▶'; };
    video.ontimeupdate = () => {
      if (isFinite(video.duration) && video.duration > 0) {
        $('fpSeek').value = (video.currentTime / video.duration) * 100;
        $('fpTimeCur').textContent = formatTime(video.currentTime);
        $('fpTimeDur').textContent = formatTime(video.duration);
        if (Math.floor(video.currentTime) % 10 === 0) {
          saveContinueWatching(state.currentPlayingItem, video.currentTime, video.duration);
        }
      } else {
        $('fpTimeCur').textContent = 'AO VIVO';
        $('fpTimeDur').textContent = '';
      }
    };
    $('fpSeek').oninput = (e) => {
      if (isFinite(video.duration) && video.duration > 0) {
        video.currentTime = (Number(e.target.value) / 100) * video.duration;
      }
    };
  }

  function openFullPlayer(item, startTime = 0) {
    state.currentPlayingItem = item;
    window.VorviaMultiview.pauseAll();
    state.livePreviewEngine?.stop();
    $('fpTitle').textContent = item.name;
    $('fullPlayer').classList.remove('hidden');
    state.mainPlayerEngine.play(item.url, startTime);
  }

  function closeFullPlayer() {
    const video = $('mainVideo');
    saveContinueWatching(state.currentPlayingItem, video.currentTime, video.duration);
    state.mainPlayerEngine.stop();
    $('fullPlayer').classList.add('hidden');
    state.currentPlayingItem = null;
    if (state.activeView === 'home') renderContinueWatching();
  }

  // CONFIGURACOES
  function applySettingsToUI() {
    $('tmdbKeyInput').value = state.settings.tmdbKey || '';
    $('chkPauseOnMin').checked = Boolean(state.settings.pauseOnMinimize);
    $('chkMuteOnMin').checked = Boolean(state.settings.muteOnMinimize);
    $('chkParental').checked = Boolean(state.settings.parentalEnabled);
    $('parentalPinInput').value = state.settings.parentalPin || '0000';
  }

  function persistSettings() {
    writeJson(STORAGE.settings, state.settings);
  }

  function bindSettings() {
    $('btnSaveTmdb').onclick = () => {
      state.settings.tmdbKey = $('tmdbKeyInput').value.trim();
      persistSettings();
      alert('Chave TMDB salva! As próximas sinopses serão enriquecidas automaticamente em PT-BR.');
    };
    $('btnClearSynCache').onclick = () => {
      window.VorviaSynopsis.clearCache();
      alert('Cache de sinopses limpo com sucesso.');
    };
    $('linkTmdb').onclick = (e) => {
      e.preventDefault();
      window.vorviaAPI.openExternal('https://www.themoviedb.org/settings/api');
    };
    $('chkPauseOnMin').onchange = (e) => {
      state.settings.pauseOnMinimize = e.target.checked;
      if (e.target.checked) { state.settings.muteOnMinimize = false; $('chkMuteOnMin').checked = false; }
      persistSettings();
    };
    $('chkMuteOnMin').onchange = (e) => {
      state.settings.muteOnMinimize = e.target.checked;
      if (e.target.checked) { state.settings.pauseOnMinimize = false; $('chkPauseOnMin').checked = false; }
      persistSettings();
    };
    $('btnSaveParental').onclick = () => {
      const pin = $('parentalPinInput').value.trim();
      if (!/^\d{4}$/.test(pin)) return alert('O PIN deve ter exatamente 4 números.');
      state.settings.parentalEnabled = $('chkParental').checked;
      state.settings.parentalPin = pin;
      persistSettings();
      alert('Controle Parental atualizado.');
    };
    $('btnRunSpeed').onclick = async () => {
      $('speedResult').textContent = 'Testando velocidade...';
      const r = await window.vorviaAPI.speedTest();
      $('speedResult').textContent = r.ok ? `🚀 ${r.mbps} Mbps` : `Erro: ${r.error}`;
    };
  }

  // ATALHOS DE TECLADO PARA PC
  function bindKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        $('globalSearchInput').focus();
        return;
      }
      if (e.key === 'F11') {
        e.preventDefault();
        window.vorviaAPI.toggleFullscreen();
        return;
      }
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;

      if (e.key === 'Escape') {
        if (!$('fullPlayer').classList.contains('hidden')) closeFullPlayer();
        else {
          $('detailsModal').classList.add('hidden');
          $('pickerModal').classList.add('hidden');
        }
        return;
      }

      // Teclas 1-6 trocam o foco de audio no Multitela
      if (state.activeView === 'multiview' && /^[1-6]$/.test(e.key)) {
        window.VorviaMultiview.focusAudio(Number(e.key) - 1);
      }

      // Controles do player tela cheia
      if (!$('fullPlayer').classList.contains('hidden')) {
        const video = $('mainVideo');
        if (e.code === 'Space') { e.preventDefault(); video.paused ? video.play() : video.pause(); }
        if (e.key === 'ArrowLeft') video.currentTime = Math.max(0, video.currentTime - 10);
        if (e.key === 'ArrowRight') video.currentTime += 10;
        if (e.key.toLowerCase() === 'm') $('fpMute').click();
        if (e.key.toLowerCase() === 'f') window.vorviaAPI.toggleFullscreen();
      }
    });
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
