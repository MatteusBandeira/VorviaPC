// Motor de Sinopses Turbinado do Vorvia PC
// 1. Limpa sujeira de nomes de listas ([4K], (L), DUBLADO, H265, | BR |, etc.)
// 2. Combina dados completos da Xtream API (get_vod_info / get_series_info)
// 3. Enriquece automaticamente em PT-BR via TMDB API (se chave configurada) com cache local

window.VorviaSynopsis = (function () {
  const CACHE_KEY = 'vorvia_pc_synopsis_cache_v1';
  const MAX_CACHE = 400;

  function loadCache() {
    try {
      return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    } catch (_) {
      return {};
    }
  }

  function saveCache(cache) {
    try {
      const keys = Object.keys(cache);
      if (keys.length > MAX_CACHE) {
        keys.slice(0, keys.length - MAX_CACHE).forEach((k) => delete cache[k]);
      }
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch (_) {}
  }

  // Remove tags comuns de listas para melhorar drasticamente a taxa de acerto no TMDB
  function cleanTitle(rawName) {
    if (!rawName) return { title: '', year: '' };
    let str = String(rawName);
    const yearMatch = str.match(/(?:\(|\[|\b)(19\d{2}|20\d{2})(?:\)|\]|\b)/);
    const year = yearMatch ? yearMatch[1] : '';

    str = str
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/\([^\)]*(?:dub|leg|hd|fhd|uhd|4k|h265|hevc|cam|ts|dual|pt-?br|br|eng|l|d|nacional|cinema|camrip)[^\)]*\)/gi, ' ')
      .replace(/\b(?:4K|UHD|FHD|HD|SD|H265|HEVC|H264|DUBLADO|LEGENDADO|DUAL|NACIONAL|PT-BR|PTBR|BR|CAM|HDR|DOLBY|ATMOS|60FPS|WEB-DL|BLURAY)\b/gi, ' ')
      .replace(/\|[^|]*\|/g, ' ')
      .replace(/^[A-Z]{2,4}\s*[-:|]\s*/i, '')
      .replace(/\((19\d{2}|20\d{2})\)/g, ' ')
      .replace(/\b(19\d{2}|20\d{2})\b/g, ' ')
      .replace(/[-_|:]+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

    return { title: str || rawName.trim(), year };
  }

  function isPoorSynopsis(text) {
    if (!text) return true;
    const t = String(text).trim();
    if (t.length < 35) return true;
    if (/^(n\/a|sem sinopse|no description|not available|\.\.\.)$/i.test(t)) return true;
    return false;
  }

  async function fetchTMDB(rawName, mediaType, tmdbKey) {
    if (!tmdbKey) return null;
    const { title, year } = cleanTitle(rawName);
    if (!title) return null;

    const endpoint = mediaType === 'series' ? 'tv' : 'movie';
    const yearParam = year ? (endpoint === 'tv' ? `&first_air_date_year=${year}` : `&year=${year}`) : '';
    const searchUrl = `https://api.themoviedb.org/3/search/${endpoint}?api_key=${encodeURIComponent(tmdbKey)}&language=pt-BR&query=${encodeURIComponent(title)}${yearParam}`;

    let res = await window.vorviaAPI.netFetch(searchUrl, { timeout: 10000 });
    let data = res.ok ? safeJson(res.text) : null;

    // Fallback sem ano caso a lista tenha ano errado
    if ((!data || !data.results || !data.results.length) && year) {
      const retryUrl = `https://api.themoviedb.org/3/search/${endpoint}?api_key=${encodeURIComponent(tmdbKey)}&language=pt-BR&query=${encodeURIComponent(title)}`;
      res = await window.vorviaAPI.netFetch(retryUrl, { timeout: 10000 });
      data = res.ok ? safeJson(res.text) : null;
    }

    if (!data || !data.results || !data.results.length) return null;
    const match = data.results[0];

    const detailUrl = `https://api.themoviedb.org/3/${endpoint}/${match.id}?api_key=${encodeURIComponent(tmdbKey)}&language=pt-BR&append_to_response=credits,videos`;
    const detailRes = await window.vorviaAPI.netFetch(detailUrl, { timeout: 10000 });
    const det = detailRes.ok ? safeJson(detailRes.text) : match;

    const cast = (det.credits?.cast || []).slice(0, 6).map((c) => c.name).join(', ');
    const directorObj = (det.credits?.crew || []).find((c) => c.job === 'Director');
    const director = directorObj ? directorObj.name : (det.created_by || []).map((c) => c.name).join(', ');
    const genres = (det.genres || []).map((g) => g.name).join(' • ');
    const trailer = (det.videos?.results || []).find((v) => v.site === 'YouTube' && (v.type === 'Trailer' || v.type === 'Teaser'));

    const runtime = endpoint === 'movie'
      ? (det.runtime ? `${Math.floor(det.runtime / 60)}h ${det.runtime % 60}min` : '')
      : (det.number_of_seasons ? `${det.number_of_seasons} temporada(s)` : '');

    return {
      source: 'TMDB (PT-BR)',
      title: det.title || det.name || title,
      originalTitle: det.original_title || det.original_name || '',
      plot: det.overview || '',
      rating: det.vote_average ? Number(det.vote_average).toFixed(1) : '',
      year: (det.release_date || det.first_air_date || year || '').slice(0, 4),
      runtime,
      genres,
      cast,
      director,
      poster: det.poster_path ? `https://image.tmdb.org/t/p/w500${det.poster_path}` : '',
      backdrop: det.backdrop_path ? `https://image.tmdb.org/t/p/w1280${det.backdrop_path}` : '',
      trailerUrl: trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : ''
    };
  }

  function safeJson(str) {
    try { return JSON.parse(str); } catch (_) { return null; }
  }

  async function resolveDetails({ item, mediaType, xtreamInfo = null, tmdbKey = '' }) {
    const cache = loadCache();
    const cacheKey = `${mediaType}_${item.id || item.name}`;
    const cached = cache[cacheKey];

    // Base vinda da lista/Xtream
    const info = xtreamInfo?.info || xtreamInfo || {};
    const base = {
      source: xtreamInfo ? 'Servidor da Lista' : 'Lista Local',
      title: info.name || item.name || 'Sem titulo',
      originalTitle: info.o_name || '',
      plot: info.plot || info.description || item.plot || '',
      rating: info.rating ? String(info.rating).slice(0, 4) : (item.rating ? String(item.rating).slice(0, 4) : ''),
      year: (info.releasedate || info.releaseDate || cleanTitle(item.name).year || '').slice(0, 4),
      runtime: info.duration || info.episode_run_time || '',
      genres: info.genre || item.categoryName || '',
      cast: info.cast || info.actors || '',
      director: info.director || '',
      poster: info.movie_image || info.cover || item.poster || '',
      backdrop: (Array.isArray(info.backdrop_path) ? info.backdrop_path[0] : info.backdrop_path) || item.poster || '',
      trailerUrl: info.youtube_trailer ? `https://www.youtube.com/watch?v=${info.youtube_trailer}` : ''
    };

    // Se ja existe no cache enriquecido pelo TMDB, mescla imediatamente
    if (cached && cached.source === 'TMDB (PT-BR)') {
      return mergeData(base, cached);
    }

    // Enriquece via TMDB sempre que a chave estiver preenchida e a sinopse/metadados forem fracos ou faltar elenco/backdrop
    const shouldEnrich = Boolean(tmdbKey) && (
      isPoorSynopsis(base.plot) || !base.backdrop || !base.cast || !base.genres
    );

    if (shouldEnrich) {
      const tmdb = await fetchTMDB(item.name, mediaType, tmdbKey);
      if (tmdb) {
        cache[cacheKey] = tmdb;
        saveCache(cache);
        return mergeData(base, tmdb);
      }
    }

    if (!base.plot) {
      base.plot = tmdbKey
        ? 'Sinopse nao encontrada no servidor nem no TMDB para este titulo.'
        : 'Sinopse nao fornecida pela lista. Dica: adicione sua chave gratuita do TMDB em Configuracoes para buscar sinopses completas em PT-BR, elenco, nota e capas em HD automaticamente.';
    }

    return base;
  }

  function mergeData(base, tmdb) {
    return {
      source: 'TMDB + Lista',
      title: base.title,
      originalTitle: tmdb.originalTitle || base.originalTitle,
      plot: !isPoorSynopsis(tmdb.plot) ? tmdb.plot : base.plot,
      rating: tmdb.rating || base.rating,
      year: tmdb.year || base.year,
      runtime: tmdb.runtime || base.runtime,
      genres: tmdb.genres || base.genres,
      cast: tmdb.cast || base.cast,
      director: tmdb.director || base.director,
      poster: tmdb.poster || base.poster,
      backdrop: tmdb.backdrop || base.backdrop,
      trailerUrl: tmdb.trailerUrl || base.trailerUrl
    };
  }

  function clearCache() {
    localStorage.removeItem(CACHE_KEY);
  }

  return {
    cleanTitle,
    resolveDetails,
    clearCache
  };
})();
