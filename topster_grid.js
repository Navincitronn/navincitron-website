const TOPSTER_CACHE_KEY = 'navincitron-grid-cover-cache-v2';
const TOPSTER_FRONTEND_VERSION = '20260830-refresh-staged-controls-discogs-v63';

const TOPSTER_LOADING_LOCAL_POSTER_ALIASES = Object.freeze({
    fallen_angel: 'fallen_angels'
});
const TOPSTER_STATE_KEY = 'navincitron-grid-current-topster-v1';
const TOPSTER_SETTINGS_KEY = 'navincitron-grid-settings-v1';
const TOPSTER_PRELOOKUP_KEY = 'navincitron-grid-prelookup-v1';
const TOPSTER_PRELOOKUP_CONCURRENCY = 8;
const TOPSTER_BASE_CANVAS_SIZE = 2000;
const TOPSTER_GRID_FILE = 'grid.txt';
const TOPSTER_RANKED_SHEET_ID = '1JiZwXGPANDlhkobNPo0Xdw_5MrNpG1fWTbEbL-I1dcA';
const TOPSTER_RANKED_SHEET_GID = '0';
const TOPSTER_LASTFM_API_KEY = '7c87436dbff96020ebb6e3a75cb0f396';
const MUSICBRAINZ_DELAY_MS = 1200;
const TOPSTER_SHARED_STORE_API = '/api/topster-shared-store';
const TOPSTER_DEFAULT_BACKEND_ORIGIN = 'https://api.navincitron.com';
const TOPSTER_BACKEND_INITIAL_TIMEOUT_MS = 12000;
const TOPSTER_BACKEND_RETRY_TIMEOUT_MS = 15000;
const TOPSTER_BACKEND_RETRY_BASE_DELAY_MS = 1200;
const TOPSTER_BACKEND_RETRY_MAX_DELAY_MS = 6000;
const TOPSTER_DISCOGS_COLLECTION_USERNAME = 'NNavincitron';
const TOPSTER_DISCOGS_COLLECTION_CACHE_KEY = 'navincitron-discogs-owned-releases-v8';
const TOPSTER_DISCOGS_COLLECTION_CACHE_MS = 7 * 24 * 60 * 60 * 1000;
let topsterDiscogsCollectionAlbums = null;
let topsterDiscogsCollectionItemCount = 0;
let topsterDiscogsCollectionLoadedAt = 0;
let topsterDiscogsCollectionLoadPromise = null;
let topsterDiscogsArtistIndex = new Map();
let topsterDiscogsOwnershipMemo = new Map();
let topsterDiscogsExactIndex = new Set();

const TOPSTER_CHECKLIST_OVERLAYS = [
    { keyword: 'Hifiman Susvara Unveiled', id: 'susvara', imageSrc: 'susvara.png', label: 'Hifiman Susvara Unveiled' },
    { keyword: 'Hifiman Arya Organic', id: 'arya', imageSrc: 'arya.png', label: 'Hifiman Arya Organic' },
    { keyword: 'Hifiman Sundara', id: 'sundara', imageSrc: 'sundara.png', label: 'Hifiman Sundara' }
];
let topsterLoadingPanel = null;
let topsterLoadingStatusPanel = null;
let topsterLoadingHideTimer = null;
let topsterPublicLoadingDismissTimer = null;
let topsterPublicLoadingDismissTransitionTimer = null;
let topsterLoadingQuotePosterRequestId = 0;
let topsterEditorCoverCachePersistTimer = null;
let topsterEditorCoverCacheIdleHandle = null;
const TOPSTER_LOADING_QUOTE_WIKIPEDIA_TITLE_MAP = Object.freeze({
    '3 WOMEN': '3 Women',
    'TRAINSPOTTING': 'Trainspotting (film)',
    "ALL THE PRESIDENT'S MEN": "All the President's Men (film)",
    'CRIA!': 'Cría cuervos'
});
let lastMusicBrainzRequestAt = 0;
let topsterSharedStoreLoaded = false;
let topsterSharedStoreAvailable = false;
let topsterSharedStoreWritable = false;
let topsterSharedCoverCache = {};
let topsterEditorWorkingCoverCache = null;
let topsterSharedSettings = null;
let topsterSharedSourceText = '';
let topsterSharedSourceSignature = '';
let topsterSharedSourceName = '';
let topsterSharedSaveTimer = null;
let topsterHasUnsavedPublishedChanges = false;
let topsterPrelookupMemoryState = null;


function markTopsterPublishDirty() {
    if (isTopsterEditorPage()) {
        topsterHasUnsavedPublishedChanges = true;
        window.__navincitronTopsterPublishDirty = true;
    }
}

window.markTopsterPublishDirty = markTopsterPublishDirty;

function safeMarkTopsterPublishDirty() {
    try {
        if (typeof markTopsterPublishDirty === 'function') {
            markTopsterPublishDirty();
            return;
        }
        if (typeof window !== 'undefined' && typeof window.markTopsterPublishDirty === 'function') {
            window.markTopsterPublishDirty();
        }
    } catch (error) {
        // Marking the editor state as dirty must never break Topster initialization or rendering.
    }
}



let topsterLoadingQuotesPromise = null;
let topsterLoadingQuoteSelection = null;
let topsterLoadingQuoteReadyPromise = null;

function isTopsterPublicReadOnlyListPage() {
    const body = document.body;
    if (!body || !body.dataset) return false;
    return body.dataset.topsterReadonly === 'true'
        && body.dataset.topsterMode === 'list'
        && body.dataset.topsterRequireAdmin !== 'true';
}

function parseTopsterLoadingQuotes(text) {
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    const quotes = [];
    let current = null;

    const flush = () => {
        if (!current) return;
        const bodyLines = current.lines.filter((line, index, array) => {
            if (line.trim()) return true;
            const prev = array[index - 1] || '';
            const next = array[index + 1] || '';
            return Boolean(prev.trim() && next.trim());
        });
        const body = bodyLines.join('\n').trim();
        if (current.source && body) quotes.push({ source: current.source, body, poster: current.poster || '' });
        current = null;
    };

    for (const rawLine of lines) {
        const line = rawLine.trimEnd();
        const heading = line.match(/^(.+?\(\d{4}\)):\s*$/);
        if (heading && !/^\s/.test(rawLine)) {
            flush();
            current = { source: heading[1].trim(), lines: [], poster: '' };
            continue;
        }
        if (current) {
            const posterMatch = line.match(/^poster:\s*(.+)$/i);
            if (posterMatch) {
                current.poster = posterMatch[1].trim();
                continue;
            }
            current.lines.push(line);
        }
    }
    flush();
    return quotes;
}

async function getTopsterLoadingQuotes() {
    if (!topsterLoadingQuotesPromise) {
        topsterLoadingQuotesPromise = fetch(`quotes.txt?v=${encodeURIComponent(TOPSTER_FRONTEND_VERSION)}`, { cache: 'no-cache' })
            .then(response => {
                if (!response.ok) throw new Error(`quotes.txt returned HTTP ${response.status}`);
                return response.text();
            })
            .then(parseTopsterLoadingQuotes)
            .catch(error => {
                console.warn('Could not load quotes.txt:', error);
                return [];
            });
    }
    return topsterLoadingQuotesPromise;
}

function escapeTopsterLoadingQuoteHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatTopsterLoadingQuoteBody(body) {
    const lines = String(body || '').split('\n');
    return lines.map(line => {
        const trimmed = line.trim();
        if (!trimmed) return '<div class="topster-loading-quote-spacer" aria-hidden="true"></div>';
        const match = trimmed.match(/^([^:]{1,120}):(\s*)(.*)$/);
        if (match) {
            return `<p class="topster-loading-quote-line"><strong>${escapeTopsterLoadingQuoteHtml(match[1])}:</strong>${match[2] ? ' ' : ''}${escapeTopsterLoadingQuoteHtml(match[3])}</p>`;
        }
        return `<p class="topster-loading-quote-line">${escapeTopsterLoadingQuoteHtml(trimmed)}</p>`;
    }).join('');
}

function topsterLoadingQuoteFilmTitle(source) {
    return cleanAlbumTitle(String(source || '').replace(/\s*\(\d{4}\)\s*$/, ''));
}

function topsterLoadingQuoteFilmSlug(source) {
    const filmTitle = topsterLoadingQuoteFilmTitle(source);
    if (!filmTitle) return '';
    return String(filmTitle)
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[’']/g, '')
        .replace(/\s*&\s*/g, ' and ')
        .replace(/[^a-zA-Z0-9-]+/g, '_')
        .replace(/-+/g, '-')
        .replace(/^[_-]+|[_-]+$/g, '')
        .replace(/_+/g, '_')
        .toLowerCase();
}

function buildTopsterLocalMoviePosterUrl(fileName) {
    const name = String(fileName || '').replace(/^\/+/, '');
    if (!name) return '';
    return new URL(`/movie_posters/${name}`, window.location.origin).href;
}

function getTopsterLoadingQuotePosterCandidates(quote) {
    if (!quote) return [];

    const candidates = [];
    const seen = new Set();
    const addCandidate = (image, page = '', source = '') => {
        const imageUrl = String(image || '').trim();
        if (!imageUrl || seen.has(imageUrl)) return;
        seen.add(imageUrl);
        candidates.push({ image: imageUrl, page: String(page || '').trim(), source: String(source || '').trim() });
    };

    const explicitPoster = String((quote && quote.poster) || '').trim();
    if (explicitPoster) addCandidate(explicitPoster, explicitPoster, 'custom');

    const slug = topsterLoadingQuoteFilmSlug(quote.source);
    if (slug) {
        const baseNames = Array.from(new Set([
            TOPSTER_LOADING_LOCAL_POSTER_ALIASES[slug],
            slug
        ].filter(Boolean)));

        for (const baseName of baseNames) {
            addCandidate(buildTopsterLocalMoviePosterUrl(`${baseName}.jpg`), '', 'local');
            addCandidate(buildTopsterLocalMoviePosterUrl(`${baseName}.png`), '', 'local');
        }
    }

    const filmTitle = topsterLoadingQuoteFilmTitle(quote.source);
    if (filmTitle) {
        const url = new URL('/api/movie-poster', getTopsterBackendOrigin() || window.location.origin);
        url.searchParams.set('title', filmTitle);
        url.searchParams.set('v', TOPSTER_FRONTEND_VERSION);
        addCandidate(url.href, '', 'backend');
    }

    return candidates;
}

function ensureTopsterPublicLoadingPosterStage(panel) {
    if (!panel || !isTopsterPublicReadOnlyListPage()) return null;

    let stage = panel.querySelector('.topster-loading-poster-stage');
    let posterWrap = panel.querySelector('#topster-loading-poster-wrap');
    let posterImage = panel.querySelector('#topster-loading-poster');
    let posterFallback = panel.querySelector('#topster-loading-poster-fallback');
    let posterLink = panel.querySelector('#topster-loading-poster-link');

    // Most public HTML pages already contain #topster-loading-panel in their
    // source. Older panel markup did not include the poster nodes. Hydrate that
    // existing panel in place instead of returning it unchanged.
    if (!stage || !posterWrap || !posterImage || !posterFallback || !posterLink) {
        stage = document.createElement('div');
        stage.className = 'topster-loading-poster-stage';
        stage.setAttribute('aria-live', 'off');
        stage.innerHTML = `
            <div class="topster-loading-poster-wrap topster-loading-poster-pending" id="topster-loading-poster-wrap">
                <div class="topster-loading-poster-link" id="topster-loading-poster-link" aria-label="Movie poster">
                    <img class="topster-loading-poster" id="topster-loading-poster" alt="Movie poster" width="132" height="198" loading="eager" decoding="async" referrerpolicy="no-referrer" hidden>
                    <div class="topster-loading-poster-fallback" id="topster-loading-poster-fallback">Loading Poster...</div>
                </div>
            </div>
        `;

        const quote = panel.querySelector('#topster-loading-quote');
        if (quote) panel.insertBefore(stage, quote);
        else panel.appendChild(stage);

        posterWrap = stage.querySelector('#topster-loading-poster-wrap');
        posterImage = stage.querySelector('#topster-loading-poster');
        posterFallback = stage.querySelector('#topster-loading-poster-fallback');
        posterLink = stage.querySelector('#topster-loading-poster-link');
    }

    if (posterLink && posterLink.tagName && posterLink.tagName.toUpperCase() === 'A') {
        const posterShell = document.createElement('div');
        posterShell.className = posterLink.className;
        posterShell.id = posterLink.id;
        const ariaLabel = posterLink.getAttribute('aria-label');
        if (ariaLabel) posterShell.setAttribute('aria-label', ariaLabel);
        while (posterLink.firstChild) posterShell.appendChild(posterLink.firstChild);
        posterLink.replaceWith(posterShell);
        posterLink = posterShell;
    }

    return { stage, posterWrap, posterImage, posterFallback, posterLink };
}

function renderTopsterLoadingQuotePoster(panel, quote) {
    if (!panel) return Promise.resolve('missing-panel');
    const posterUi = ensureTopsterPublicLoadingPosterStage(panel);
    if (!posterUi) return Promise.resolve('missing-poster-ui');

    const { posterWrap, posterImage, posterFallback, posterLink } = posterUi;
    const filmTitle = topsterLoadingQuoteFilmTitle(quote && quote.source);
    const posterCandidates = getTopsterLoadingQuotePosterCandidates(quote);

    posterWrap.hidden = false;
    posterWrap.style.display = 'block';
    posterWrap.classList.add('topster-loading-poster-pending');
    posterFallback.hidden = false;
    posterFallback.style.display = 'flex';
    posterFallback.textContent = filmTitle ? `Loading ${filmTitle} Poster...` : 'Loading Poster...';
    posterImage.hidden = true;
    posterImage.style.display = 'none';
    posterImage.width = 132;
    posterImage.height = 198;
    posterImage.alt = filmTitle ? `${filmTitle} poster` : 'Movie poster';
    posterImage.referrerPolicy = 'no-referrer';
    posterImage.loading = 'eager';
    posterImage.decoding = 'async';
    posterImage.fetchPriority = 'high';

    if (!posterCandidates.length) {
        posterWrap.classList.remove('topster-loading-poster-pending');
        posterFallback.textContent = 'Poster unavailable';
        return Promise.resolve('unavailable');
    }

    return new Promise(resolve => {
        let settled = false;
        let timeoutId = null;
        let currentIndex = -1;

        const finish = result => {
            if (settled) return;
            settled = true;
            if (timeoutId) window.clearTimeout(timeoutId);
            resolve(result);
        };

        const fail = result => {
            posterWrap.classList.remove('topster-loading-poster-pending');
            posterImage.hidden = true;
            posterImage.style.display = 'none';
            posterFallback.hidden = false;
            posterFallback.style.display = 'flex';
            posterFallback.textContent = filmTitle ? `${filmTitle} poster unavailable` : 'Poster unavailable';
            finish(result);
        };

        const tryNextCandidate = () => {
            currentIndex += 1;
            if (currentIndex >= posterCandidates.length) {
                fail('failed');
                return;
            }

            const candidate = posterCandidates[currentIndex] || {};
            posterFallback.textContent = filmTitle ? `Loading ${filmTitle} Poster...` : 'Loading Poster...';
            posterImage.src = candidate.image;
        };

        posterImage.onload = () => {
            posterWrap.classList.remove('topster-loading-poster-pending');
            posterFallback.hidden = true;
            posterFallback.style.display = 'none';
            posterImage.hidden = false;
            posterImage.style.display = 'block';
            finish('loaded');
        };

        posterImage.onerror = () => {
            tryNextCandidate();
        };

        timeoutId = window.setTimeout(() => {
            if (settled) return;
            fail('timeout');
        }, 12000);

        tryNextCandidate();
    });
}

function scheduleTopsterPublicLoadingPanelDismiss(panel, delayMs = 3000) {
    if (!isTopsterPublicReadOnlyListPage() || !panel) return;
    if (panel.dataset.topsterDismissed === 'true' || panel.dataset.topsterDismissScheduled === 'true') return;
    panel.dataset.topsterDismissScheduled = 'true';

    window.clearTimeout(topsterPublicLoadingDismissTimer);
    window.clearTimeout(topsterPublicLoadingDismissTransitionTimer);
    topsterPublicLoadingDismissTimer = window.setTimeout(() => {
        panel.classList.add('topster-loading-panel-fading');
        topsterPublicLoadingDismissTransitionTimer = window.setTimeout(() => {
            panel.dataset.topsterDismissed = 'true';
            panel.hidden = true;
        }, 700);
    }, Math.max(0, Number(delayMs) || 0));
}

async function renderTopsterLoadingQuote(panel, quote) {
    if (!panel || !quote) return;
    ensureTopsterPublicLoadingPosterStage(panel);
    const quoteBody = panel.querySelector('#topster-loading-quote-body');
    const quoteSource = panel.querySelector('#topster-loading-quote-source');
    if (quoteBody) quoteBody.innerHTML = formatTopsterLoadingQuoteBody(quote.body);
    if (quoteSource) quoteSource.textContent = quote.source;

    // Finish preparing the poster before the public Topster build begins. The quote/poster
    // panel is dismissed separately three seconds after Topster loading completes.
    await renderTopsterLoadingQuotePoster(panel, quote);
}

async function ensureTopsterPublicLoadingQuote(panel) {
    if (!isTopsterPublicReadOnlyListPage() || !panel) return 'not-public';
    if (topsterLoadingQuoteReadyPromise) return topsterLoadingQuoteReadyPromise;

    topsterLoadingQuoteReadyPromise = (async () => {
        panel.dataset.topsterQuoteLoading = 'true';
        const quotes = await getTopsterLoadingQuotes();
        panel.dataset.topsterQuoteLoading = 'false';
        if (!quotes.length) return 'no-quotes';

        if (!topsterLoadingQuoteSelection) {
            topsterLoadingQuoteSelection = quotes[Math.floor(Math.random() * quotes.length)];
        }
        await renderTopsterLoadingQuote(panel, topsterLoadingQuoteSelection);
        panel.dataset.topsterQuoteReady = 'true';
        return 'ready';
    })().catch(error => {
        panel.dataset.topsterQuoteLoading = 'false';
        console.warn('Could not prepare Topster loading quote/poster:', error);
        return 'failed';
    });

    return topsterLoadingQuoteReadyPromise;
}

async function waitForTopsterPublicLoadingMedia() {
    if (!isTopsterPublicReadOnlyListPage()) return;
    const panel = ensureTopsterLoadingPanel();
    if (!panel) return;
    await ensureTopsterPublicLoadingQuote(panel);
}


function ensureTopsterPublicLoadingStatusPanel(quotePanel = null) {
    if (!isTopsterPublicReadOnlyListPage()) return null;

    if (topsterLoadingStatusPanel && document.body.contains(topsterLoadingStatusPanel)) {
        return topsterLoadingStatusPanel;
    }

    let statusPanel = document.getElementById('topster-loading-status-panel');
    if (!statusPanel) {
        statusPanel = document.createElement('div');
        statusPanel.className = 'topster-loading-status-panel';
        statusPanel.id = 'topster-loading-status-panel';
        statusPanel.setAttribute('role', 'status');
        statusPanel.setAttribute('aria-live', 'polite');
        statusPanel.innerHTML = `
            <p class="topster-loading-title">Loading...</p>
            <p class="topster-loading-text" id="topster-loading-text">Preparing Topster data...</p>
        `;

        const panel = quotePanel || document.getElementById('topster-loading-panel');
        if (panel && panel.parentNode) {
            panel.parentNode.insertBefore(statusPanel, panel);
        } else {
            const section = document.querySelector('.grid-builder-page');
            if (section) section.appendChild(statusPanel);
        }
    }

    topsterLoadingStatusPanel = statusPanel;
    return statusPanel;
}

function hideTopsterPublicLoadingStatusPanel() {
    const statusPanel = topsterLoadingStatusPanel || document.getElementById('topster-loading-status-panel');
    if (!statusPanel) return;
    statusPanel.hidden = true;
}


function ensureTopsterLoadingPanel() {
    if (topsterLoadingPanel && document.body.contains(topsterLoadingPanel)) {
        if (isTopsterPublicReadOnlyListPage()) {
            ensureTopsterPublicLoadingStatusPanel(topsterLoadingPanel);
        }
        return topsterLoadingPanel;
    }

    const existingPanel = document.getElementById('topster-loading-panel');
    if (existingPanel) {
        topsterLoadingPanel = existingPanel;
        if (isTopsterPublicReadOnlyListPage()) {
            ensureTopsterPublicLoadingStatusPanel(existingPanel);
            ensureTopsterPublicLoadingPosterStage(existingPanel);
            ensureTopsterPublicLoadingQuote(existingPanel);
        }
        return existingPanel;
    }

    const section = document.querySelector('.grid-builder-page');
    if (!section) return null;

    const panel = document.createElement('div');
    panel.className = 'topster-loading-panel';
    panel.id = 'topster-loading-panel';
    panel.setAttribute('role', 'status');
    panel.setAttribute('aria-live', 'polite');
    if (isTopsterPublicReadOnlyListPage()) {
        panel.setAttribute('role', 'group');
        panel.setAttribute('aria-live', 'off');
        panel.innerHTML = `
            <div class="topster-loading-poster-stage" aria-live="off">
                <div class="topster-loading-poster-wrap topster-loading-poster-pending" id="topster-loading-poster-wrap">
                    <div class="topster-loading-poster-link" id="topster-loading-poster-link" aria-label="Movie poster">
                        <img class="topster-loading-poster" id="topster-loading-poster" alt="Movie poster" loading="eager" decoding="async" referrerpolicy="no-referrer" hidden>
                        <div class="topster-loading-poster-fallback" id="topster-loading-poster-fallback">Loading Poster...</div>
                    </div>
                </div>
            </div>
            <figure class="topster-loading-quote" id="topster-loading-quote">
                <blockquote id="topster-loading-quote-body">Loading a quote...</blockquote>
                <figcaption id="topster-loading-quote-source"></figcaption>
            </figure>
        `;
        ensureTopsterPublicLoadingQuote(panel);
    } else {
        panel.innerHTML = `
            <p class="topster-loading-title">Loading Topster</p>
            <p class="topster-loading-text" id="topster-loading-text">Preparing Topster data...</p>
            <progress class="topster-loading-progress" id="topster-loading-progress" max="100" value="0">0%</progress>
            <p class="topster-loading-percent" id="topster-loading-percent">0%</p>
        `;
    }

    const output = document.getElementById('topster-output');
    if (output && output.parentNode === section) {
        section.insertBefore(panel, output);
    } else {
        section.appendChild(panel);
    }

    if (isTopsterPublicReadOnlyListPage()) {
        ensureTopsterPublicLoadingStatusPanel(panel);
    }

    topsterLoadingPanel = panel;
    return panel;
}

function setTopsterLoadingProgress(percent, text, options = {}) {
    const panel = ensureTopsterLoadingPanel();
    if (!panel) return;

    const publicListPage = isTopsterPublicReadOnlyListPage();
    if (publicListPage) {
        if (panel.dataset.topsterDismissed === 'true') return;
        const statusPanel = ensureTopsterPublicLoadingStatusPanel(panel);
        if (statusPanel) {
            statusPanel.hidden = false;
            statusPanel.classList.toggle('topster-loading-error', Boolean(options.error));
            const statusLabel = statusPanel.querySelector('.topster-loading-text');
            if (statusLabel && text) statusLabel.textContent = text;
        }
        ensureTopsterPublicLoadingQuote(panel);
        return;
    }

    window.clearTimeout(topsterLoadingHideTimer);
    panel.hidden = false;
    panel.classList.remove('topster-loading-panel-fading');
    panel.classList.toggle('topster-loading-error', Boolean(options.error));
    panel.classList.toggle('topster-loading-complete', Boolean(options.complete));

    const progress = panel.querySelector('.topster-loading-progress');
    const label = panel.querySelector('.topster-loading-text');
    const percentLabel = panel.querySelector('.topster-loading-percent');
    const safePercent = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));

    if (label && text) label.textContent = text;
    if (progress) {
        progress.value = safePercent;
        progress.textContent = `${safePercent}%`;
    }
    if (percentLabel) percentLabel.textContent = `${safePercent}%`;
}

function completeTopsterLoading(text = 'Topster loaded.') {
    if (isTopsterPublicReadOnlyListPage()) {
        hideTopsterPublicLoadingStatusPanel();
        scheduleTopsterPublicLoadingPanelDismiss(ensureTopsterLoadingPanel(), 3000);
        return;
    }
    setTopsterLoadingProgress(100, text, { complete: true });
    topsterLoadingHideTimer = window.setTimeout(() => {
        if (topsterLoadingPanel) topsterLoadingPanel.hidden = true;
    }, 1400);
}

function failTopsterLoading(text) {
    setTopsterLoadingProgress(100, text || 'Topster loading failed.', { error: true });
}


function setTopsterSettingsSaveStatus(status, text) {
    if (!status) return;
    status.hidden = false;
    status.classList.remove('topster-status-progress-active', 'topster-status-progress-complete');
    status.textContent = text || 'Saving shared Topster settings...';
}

function isChecklistTopsterSource() {
    return getTopsterDataSourceConfig().kind === 'checklist-file';
}

function extractChecklistOverlayMetadata(rawLine) {
    const original = String(rawLine || '').trim();
    const lowered = original.toLocaleLowerCase();

    for (const overlay of TOPSTER_CHECKLIST_OVERLAYS) {
        const keyword = overlay.keyword.toLocaleLowerCase();
        if (!lowered.endsWith(keyword)) continue;

        const albumLine = original.slice(0, original.length - overlay.keyword.length).trim();
        if (!albumLine) break;

        return {
            albumLine,
            checklistOverlay: overlay.id,
            checklistOverlayImage: overlay.imageSrc,
            checklistOverlayLabel: overlay.label
        };
    }

    return {
        albumLine: original,
        checklistOverlay: '',
        checklistOverlayImage: '',
        checklistOverlayLabel: ''
    };
}



function stripTrailingSlash(value) {
    return String(value || '').replace(/\/+$/, '');
}

function getTopsterBackendOrigin() {
    const body = document.body;
    const explicit = stripTrailingSlash(
        (window.NAVINCITRON_TOPSTER_API_BASE_URL || '')
        || (body && body.dataset ? body.dataset.topsterApiBase || '' : '')
    );

    if (explicit) return explicit;

    const host = window.location.hostname.toLowerCase();
    if (host === 'www.navincitron.com' || host === 'navincitron.com') {
        return TOPSTER_DEFAULT_BACKEND_ORIGIN;
    }

    return '';
}

function buildTopsterApiUrl(path) {
    const backendOrigin = getTopsterBackendOrigin();
    return new URL(path || '/', backendOrigin || window.location.origin).href;
}

function normalizeDiscogsArtistForMatch(value) {
    return cleanAlbumTitle(value || '')
        // Discogs uses a trailing asterisk for artist links and (2)/(3)/... for
        // disambiguated artist records. Neither is part of the credited name.
        .replace(/\s*\*+\s*$/, '')
        .replace(/\s*\(\d+\)\s*$/, '')
        // A nickname in quotes should not prevent Alexander \"Skip\" Spence from
        // matching Alexander Spence, etc.
        .replace(/\s*[\"“][^\"”]+[\"”]\s*/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function topsterOwnedTextVariants(value, options = {}) {
    const raw = cleanAlbumTitle(value || '').trim();
    if (!raw) return [];

    const candidates = [raw];
    if (options.artist) {
        candidates.push(normalizeDiscogsArtistForMatch(raw));
    }
    candidates.push(raw.replace(/^(?:the|a|an)\s+/i, '').trim());

    return Array.from(new Set(candidates
        .map(item => normalizeAlbumIdentityKey(item))
        .filter(Boolean)));
}

function normalizeDiscogsCollectionAlbums(rawAlbums) {
    if (!Array.isArray(rawAlbums)) return [];
    return rawAlbums.map(item => {
        const title = cleanAlbumTitle(item && item.title || '');
        const artists = Array.isArray(item && item.artists)
            ? item.artists.map(name => normalizeDiscogsArtistForMatch(name)).filter(Boolean)
            : [];
        const fallbackArtist = normalizeDiscogsArtistForMatch(item && item.artist || '');
        if (!artists.length && fallbackArtist) artists.push(fallbackArtist);

        return {
            title,
            titleVariants: topsterOwnedTextVariants(title),
            artists,
            artistVariants: Array.from(new Set(artists.flatMap(name => topsterOwnedTextVariants(name, { artist: true })))),
            releaseId: Number(item && item.releaseId) || null,
            masterId: Number(item && item.masterId) || null,
            year: Number(item && item.year) || null
        };
    }).filter(item => item.titleVariants.length);
}

function discogsOwnedArtistIndexKeys(value) {
    const keys = new Set();
    const variants = discogsOwnedArtistVariants(value || '');
    variants.forEach(variant => {
        if (!variant) return;
        keys.add(`v:${variant}`);
        if (variant.length >= 5) keys.add(`p:${variant.slice(0, 5)}`);
    });
    discogsOwnedArtistTokenSet(value || '').forEach(token => {
        if (token.length >= 6) keys.add(`t:${token}`);
    });
    DISCOGS_OWNED_ARTIST_ALIAS_GROUPS.forEach((group, index) => {
        const groupVariants = new Set(group.flatMap(discogsOwnedArtistVariants));
        if (variants.some(value => groupVariants.has(value))) keys.add(`g:${index}`);
    });
    return Array.from(keys);
}

function rebuildTopsterDiscogsIndexes() {
    topsterDiscogsArtistIndex = new Map();
    topsterDiscogsOwnershipMemo = new Map();
    topsterDiscogsExactIndex = new Set();
    (topsterDiscogsCollectionAlbums || []).forEach((album, albumIndex) => {
        const artists = Array.isArray(album.artists) ? album.artists : [];
        artists.forEach(artist => {
            discogsOwnedArtistIndexKeys(artist).forEach(key => {
                if (!topsterDiscogsArtistIndex.has(key)) topsterDiscogsArtistIndex.set(key, new Set());
                topsterDiscogsArtistIndex.get(key).add(albumIndex);
            });

            // Keep a second, strict artist+safe-title index. This avoids routing
            // straightforward owned releases through the fuzzy matcher and also
            // protects recurring Discogs forms such as a trailing artist "*" or
            // a self-titled "- Vol. 1" catalog suffix.
            const artistVariants = discogsOwnedArtistVariants(artist);
            const titleVariants = discogsOwnedSafeTitleVariants(album.title || '', artist);
            artistVariants.forEach(artistVariant => {
                titleVariants.forEach(titleVariant => {
                    if (artistVariant && titleVariant) topsterDiscogsExactIndex.add(`${artistVariant}::${titleVariant}`);
                });
            });
        });
    });
}

function discogsOwnedDirectIndexedMatch(entryArtist, entryTitle) {
    if (!entryArtist || !entryTitle || !topsterDiscogsExactIndex.size) return false;
    const artistVariants = discogsOwnedArtistVariants(entryArtist);
    const titleVariants = discogsOwnedSafeTitleVariants(entryTitle, entryArtist);
    return artistVariants.some(artistVariant => titleVariants.some(titleVariant =>
        topsterDiscogsExactIndex.has(`${artistVariant}::${titleVariant}`)));
}

function installTopsterDiscogsCollection(rawAlbums, options = {}) {
    const canUseNormalized = Boolean(options.normalized)
        && Array.isArray(rawAlbums)
        && rawAlbums.every(item => item && Array.isArray(item.titleVariants) && Array.isArray(item.artists));
    // Even browser-cached "normalized" Discogs data is normalized again here.
    // Older cache schemas could preserve a trailing Discogs artist '*' or stale
    // title variants, which made exact owned releases fail after the matcher was
    // otherwise fixed. Rebuilding these fields is cheap compared with a network
    // collection refresh and makes exact artist/title matching deterministic.
    topsterDiscogsCollectionAlbums = canUseNormalized
        ? rawAlbums.map(item => {
            const artists = (Array.isArray(item.artists) ? item.artists : [])
                .map(name => normalizeDiscogsArtistForMatch(name))
                .filter(Boolean);
            const title = cleanAlbumTitle(item.title || '');
            return {
                ...item,
                title,
                titleVariants: topsterOwnedTextVariants(title),
                artists,
                artistVariants: Array.from(new Set(artists.flatMap(name => topsterOwnedTextVariants(name, { artist: true }))))
            };
        }).filter(item => item.titleVariants.length)
        : normalizeDiscogsCollectionAlbums(rawAlbums);
    rebuildTopsterDiscogsIndexes();
    return topsterDiscogsCollectionAlbums;
}

function getTopsterDiscogsCandidateAlbums(entryArtist) {
    if (!entryArtist || !topsterDiscogsArtistIndex.size) return topsterDiscogsCollectionAlbums || [];
    const indexes = new Set();
    discogsOwnedArtistIndexKeys(entryArtist).forEach(key => {
        const matches = topsterDiscogsArtistIndex.get(key);
        if (matches) matches.forEach(index => indexes.add(index));
    });
    return Array.from(indexes).map(index => topsterDiscogsCollectionAlbums[index]).filter(Boolean);
}

function discogsOwnedEntryHasCrossCreditRule(entryArtist, entryTitle) {
    const entryArtistKeys = new Set(discogsOwnedArtistVariants(entryArtist));
    const entryTitleKey = discogsOwnedRelationKey(entryTitle);
    if (!entryArtistKeys.size || !entryTitleKey) return false;
    return DISCOGS_OWNED_CROSS_CREDIT_GROUPS.some(group => {
        const allowedEntryArtists = new Set(group.entryArtists.flatMap(discogsOwnedArtistVariants));
        return Array.from(entryArtistKeys).some(value => allowedEntryArtists.has(value))
            && group.entryTitles.some(title => discogsOwnedRelationKey(title) === entryTitleKey);
    });
}

function saveDiscogsCollectionBrowserCache(payload) {
    try {
        const normalizedAlbums = Array.isArray(topsterDiscogsCollectionAlbums)
            ? topsterDiscogsCollectionAlbums
            : normalizeDiscogsCollectionAlbums(payload && payload.albums);
        localStorage.setItem(TOPSTER_DISCOGS_COLLECTION_CACHE_KEY, JSON.stringify({
            schema: 8,
            savedAt: Date.now(),
            itemCount: Number(payload && payload.itemCount) || normalizedAlbums.length,
            normalizedAlbums
        }));
    } catch (error) {
        // The shared backend remains the source of truth if local storage is unavailable.
    }
}

function loadDiscogsCollectionBrowserCache() {
    try {
        const parsed = JSON.parse(localStorage.getItem(TOPSTER_DISCOGS_COLLECTION_CACHE_KEY) || 'null');
        if (!parsed) return false;
        const savedAt = Number(parsed.savedAt) || 0;
        if (!savedAt || (Date.now() - savedAt) > TOPSTER_DISCOGS_COLLECTION_CACHE_MS) return false;

        if (Number(parsed.schema) === 8 && Array.isArray(parsed.normalizedAlbums)) {
            installTopsterDiscogsCollection(parsed.normalizedAlbums, { normalized: true });
        } else if (Array.isArray(parsed.albums)) {
            installTopsterDiscogsCollection(parsed.albums);
            // Upgrade an older browser cache once so subsequent loads skip repeated
            // normalization of the entire Discogs collection.
            saveDiscogsCollectionBrowserCache({ itemCount: parsed.itemCount, albums: parsed.albums });
        } else {
            return false;
        }

        topsterDiscogsCollectionItemCount = Number(parsed.itemCount)
            || (topsterDiscogsCollectionAlbums ? topsterDiscogsCollectionAlbums.length : 0);
        topsterDiscogsCollectionLoadedAt = savedAt;
        return true;
    } catch (error) {
        return false;
    }
}

async function ensureTopsterDiscogsCollectionLoaded(options = {}) {
    if (!options.force && Array.isArray(topsterDiscogsCollectionAlbums) && topsterDiscogsCollectionAlbums.length) return true;
    if (!options.force && loadDiscogsCollectionBrowserCache()) return true;
    if (topsterDiscogsCollectionLoadPromise) return topsterDiscogsCollectionLoadPromise;

    topsterDiscogsCollectionLoadPromise = (async () => {
        try {
            const url = new URL('/api/discogs-collection', getTopsterBackendOrigin() || window.location.origin);
            url.searchParams.set('username', TOPSTER_DISCOGS_COLLECTION_USERNAME);
            // Reaching the network means there was no usable seven-day browser
            // snapshot. Ask the backend to rebuild its Discogs snapshot too, so
            // clearing browser data cannot immediately repopulate from a stale
            // week-old Redis collection. Normal subsequent loads still use the
            // fast browser cache and do not hit Discogs again.
            url.searchParams.set('refresh', '1');

            const response = await fetch(url.href, {
                credentials: 'include',
                cache: 'no-store'
            });
            if (!response.ok) {
                let detail = '';
                try {
                    const body = await response.json();
                    detail = body && body.error ? String(body.error) : '';
                } catch (error) {
                    // Ignore non-JSON error bodies.
                }
                throw new Error(detail || `HTTP ${response.status}`);
            }

            const payload = await response.json();
            if (!payload || payload.ok !== true || !Array.isArray(payload.albums)) {
                throw new Error('Discogs collection response was invalid.');
            }

            installTopsterDiscogsCollection(payload.albums);
            topsterDiscogsCollectionItemCount = Number(payload.itemCount) || payload.albums.length;
            topsterDiscogsCollectionLoadedAt = Date.now();
            saveDiscogsCollectionBrowserCache(payload);
            return true;
        } catch (error) {
            console.error('Discogs collection lookup failed:', error);
            return false;
        } finally {
            topsterDiscogsCollectionLoadPromise = null;
        }
    })();

    return topsterDiscogsCollectionLoadPromise;
}

function discogsOwnedNormalizeRomanVolumes(value) {
    let text = cleanAlbumTitle(value || '').toLowerCase();
    const romanMap = { i:'1', ii:'2', iii:'3', iv:'4', v:'5', vi:'6', vii:'7', viii:'8', ix:'9', x:'10' };
    text = text.replace(/\bvol(?:ume)?\.?\s*([ivx]+|\d+)\b/gi, (match, volume) => ` volume ${romanMap[String(volume).toLowerCase()] || volume} `);
    return cleanAlbumTitle(text);
}

function discogsOwnedTitleVariants(title, artist = '') {
    const clean = discogsOwnedNormalizeRomanVolumes(title);
    if (!clean) return [];
    const variants = new Set();
    const add = value => { const normalized = normalizeAlbumIdentityKey(value || ''); if (normalized) variants.add(normalized); };
    add(clean);
    add(clean.replace(/\s*\([^)]*\)\s*/g, ' '));
    add(clean.replace(/\s*["“][^"”]+["”]\s*/g, ' '));
    clean.split(/\s+[—–-]\s+|:\s+/).forEach(add);
    clean.split(/\s+=\s+/).forEach(add);
    add(clean.replace(/\bvolume\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/gi, ' '));
    add(clean.replace(/\b(?:complete|expanded|deluxe|remastered|remaster|edition)\b/gi, ' '));
    add(clean.replace(/\b(?:18|19|20)\d{2}(?:\s*[-–—]\s*(?:18|19|20)\d{2})?\b/g, ' '));
    add(clean.replace(/\s+\b(?:with|featuring|feat\.?|by)\b\s+.+$/i, ''));
    add(clean.replace(/,\s*volume\s+.+$/i, ''));
    add(clean.replace(/\s+-\s+.+$/i, ''));
    const artistText = cleanAlbumTitle(artist || '');
    if (artistText) {
        const escapedArtist = artistText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        add(clean.replace(new RegExp(`\\b(?:with|by|featuring|feat\\.?)\\s+${escapedArtist}\\b.*$`, 'i'), ''));
    }
    return Array.from(variants);
}

function discogsOwnedArtistVariants(value) {
    const clean = normalizeDiscogsArtistForMatch(value || '');
    if (!clean) return [];
    const variants = new Set(topsterOwnedTextVariants(clean, { artist: true }));
    topsterOwnedTextVariants(clean.replace(/\s+\b(?:featuring|feat\.?)\b\s+.+$/i, ''), { artist: true }).forEach(v => variants.add(v));
    return Array.from(variants);
}

function discogsOwnedCanonicalToken(token) {
    const raw = String(token || '').toLowerCase();
    if (!raw) return '';

    const ordinalWords = {
        first: '1', second: '2', third: '3', fourth: '4', fifth: '5', sixth: '6', seventh: '7', eighth: '8', ninth: '9', tenth: '10',
        eleventh: '11', twelfth: '12', thirteenth: '13', fourteenth: '14', fifteenth: '15', sixteenth: '16', seventeenth: '17',
        eighteenth: '18', nineteenth: '19', twentieth: '20'
    };
    if (ordinalWords[raw]) return ordinalWords[raw];
    if (/^\d+(?:st|nd|rd|th)$/.test(raw)) return raw.replace(/(?:st|nd|rd|th)$/, '');

    // Discogs and list sources occasionally differ only by a plural/spelling
    // form (Berries/Berrys). Keep this deliberately conservative.
    if (raw.length > 4 && /ies$/.test(raw)) return `${raw.slice(0, -3)}y`;
    if (raw.length > 4 && /ys$/.test(raw)) return raw.slice(0, -1);
    return raw;
}

function discogsOwnedTokenSet(value) {
    return new Set(tokenizeTitle(discogsOwnedNormalizeRomanVolumes(value || '')
        .replace(/\b(?:complete|expanded|deluxe|remastered|remaster|edition)\b/gi, ' ')
        .replace(/\b(?:18|19|20)\d{2}(?:\s*[-–—]\s*(?:18|19|20)\d{2})?\b/g, ' '))
        .map(discogsOwnedCanonicalToken)
        .filter(Boolean));
}

function discogsOwnedBigramSimilarity(leftValue, rightValue) {
    const left = normalizeAlbumTitle(leftValue || '');
    const right = normalizeAlbumTitle(rightValue || '');
    if (left === right && left) return 1;
    if (Math.min(left.length, right.length) < 8) return 0;
    if (Math.min(left.length, right.length) / Math.max(left.length, right.length) < 0.62) return 0;

    const counts = new Map();
    for (let i = 0; i < left.length - 1; i += 1) {
        const gram = left.slice(i, i + 2);
        counts.set(gram, (counts.get(gram) || 0) + 1);
    }
    let overlap = 0;
    for (let i = 0; i < right.length - 1; i += 1) {
        const gram = right.slice(i, i + 2);
        const count = counts.get(gram) || 0;
        if (count > 0) {
            overlap += 1;
            counts.set(gram, count - 1);
        }
    }
    return (2 * overlap) / Math.max(1, (left.length - 1) + (right.length - 1));
}

function discogsOwnedTitleScore(entryTitle, collectionTitle, entryArtist = '', collectionArtist = '') {
    const leftVariants = discogsOwnedTitleVariants(entryTitle, entryArtist);
    const rightVariants = discogsOwnedTitleVariants(collectionTitle, collectionArtist);
    if (leftVariants.some(v => rightVariants.includes(v))) return 1;
    let best = 0;
    for (const left of leftVariants) for (const right of rightVariants) {
        const shorter = left.length <= right.length ? left : right;
        const longer = left.length > right.length ? left : right;
        if (shorter.length >= 8 && longer.includes(shorter)) best = Math.max(best, Math.min(0.98, 0.84 + (shorter.length / Math.max(longer.length,1))*0.14));
    }
    const l = discogsOwnedTokenSet(entryTitle), r = discogsOwnedTokenSet(collectionTitle);
    if (l.size && r.size) {
        let inter = 0; l.forEach(t => { if (r.has(t)) inter += 1; });
        const union = new Set([...l, ...r]).size;
        const jaccard = union ? inter/union : 0;
        const containment = inter/Math.max(1, Math.min(l.size,r.size));
        best = Math.max(best, jaccard*0.45 + containment*0.55);
    }

    // Character bigrams catch small catalog spelling differences such as
    // Africa/African without allowing unrelated short titles to match.
    best = Math.max(best, discogsOwnedBigramSimilarity(entryTitle, collectionTitle));
    return best;
}

function discogsOwnedArtistTokenSet(value) {
    return new Set(tokenizeTitle(normalizeDiscogsArtistForMatch(value || '')));
}

const DISCOGS_OWNED_ARTIST_ALIAS_GROUPS = Object.freeze([
    // Early Wailers releases can be filed under either Bob Marley or The Wailers.
    ['Bob Marley', 'Bob Marley And The Wailers', 'The Wailers'],
    // Zappa records can be filed under his own name or The Mothers.
    ['Frank Zappa', 'The Mothers', 'The Mothers Of Invention', 'Frank Zappa And The Mothers Of Invention'],
    // Discogs may split Hall & Oates into the two individual artist credits.
    ['Hall & Oates', 'Daryl Hall & John Oates', 'Daryl Hall / John Oates', 'Daryl Hall', 'John Oates']
]);

function discogsOwnedArtistAliasGroupMatch(entryArtist, collectionArtists) {
    const entryVariants = new Set(discogsOwnedArtistVariants(entryArtist));
    const rawCollectionArtists = Array.isArray(collectionArtists) ? collectionArtists : [collectionArtists];
    const collectionVariants = new Set(rawCollectionArtists.flatMap(discogsOwnedArtistVariants));
    if (!entryVariants.size || !collectionVariants.size) return false;

    return DISCOGS_OWNED_ARTIST_ALIAS_GROUPS.some(group => {
        const groupVariants = new Set(group.flatMap(discogsOwnedArtistVariants));
        const entryInGroup = Array.from(entryVariants).some(value => groupVariants.has(value));
        const collectionInGroup = Array.from(collectionVariants).some(value => groupVariants.has(value));
        return entryInGroup && collectionInGroup;
    });
}

function discogsOwnedArtistsMatch(entryArtist, collectionArtists) {
    const e = discogsOwnedArtistVariants(entryArtist);
    const rawCollectionArtists = Array.isArray(collectionArtists) ? collectionArtists : [collectionArtists];
    const c = Array.from(new Set(rawCollectionArtists.flatMap(discogsOwnedArtistVariants)));
    if (!e.length || !c.length) return false;
    if (e.some(a => c.some(b => a===b || (a.length>=5 && b.includes(a)) || (b.length>=5 && a.includes(b))))) return true;
    if (discogsOwnedArtistAliasGroupMatch(entryArtist, rawCollectionArtists)) return true;

    // Permit a distinctive shared surname/name token for Discogs credit forms
    // such as \"Krzysztof Komeda\" vs \"Komeda Quintet\". Requiring six
    // characters avoids common first-name collisions such as \"David\".
    const entryTokens = discogsOwnedArtistTokenSet(entryArtist);
    for (const collectionArtist of rawCollectionArtists) {
        const collectionTokens = discogsOwnedArtistTokenSet(collectionArtist);
        for (const token of entryTokens) {
            if (token.length >= 6 && collectionTokens.has(token)) return true;
        }
    }
    return false;
}

function discogsOwnedIsCompilationLike(title) {
    return /\b(?:anthology|best of|greatest hits|collection|complete|retrospective|essential|legend)\b/i.test(cleanAlbumTitle(title || ''));
}

function discogsOwnedIsArtistPresentationTitle(title, artist) {
    const t = normalizeAlbumTitle(title || ''), a = normalizeAlbumTitle(artist || '');
    return Boolean(t && a && t.includes(a) && /\b(?:evening with|recital by|with|presents|sings)\b/i.test(cleanAlbumTitle(title || '')));
}

// Some Discogs releases use a translated, original, reissue, or self-titled
// name that cannot be inferred safely from string similarity alone. Keep those
// known equivalences explicit and artist-scoped so they do not become global
// title-only matches.
const DISCOGS_OWNED_TITLE_ALIAS_GROUPS = Object.freeze([
    { artists: ['Tyler, The Creator'], titles: ['Flower Boy', 'Scum Fuck Flower Boy'] },
    { artists: ['Grateful Dead'], titles: ['Sunshine Daydream: Veneta, Oregon, August 27, 1972', 'Veneta, Oregon 8/27/72 (Sunshine Daydream)'] },
    { artists: ['Led Zeppelin'], titles: ['Led Zeppelin IV', 'Untitled'] },
    { artists: ['Ludwig van Beethoven', 'Beethoven', 'Herbert Von Karajan', 'Berliner Philharmoniker'], titles: ['Beethoven: Symphony No. 9', 'IX. Symphonie', 'IX. Symphony D-moll Op. 125'] },
    { artists: ['Jerry Lee Lewis'], titles: ['Live At The Star Club, Hamburg', "Enregistrement Public Au Star-Club D'Hambourg"] },
    { artists: ['Jacques Brel'], titles: ['Ces Gens-Là', 'Jacques Brel'] },
    { artists: ['The Yardbirds'], titles: ['Roger The Engineer', 'The Yardbirds'] },
    { artists: ['Fred Neil'], titles: ['Fred Neil', "Everybody's Talkin' (Theme From Midnight Cowboy)"] },
    { artists: ['Ennio Morricone'], titles: ['Once Upon A Time In The West', "C'Era Una Volta Il West"] },
    { artists: ['David Bowie'], titles: ['Space Oddity', 'David Bowie'] },
    { artists: ['Nick Lowe'], titles: ['Jesus Of Cool', 'Pure Pop For Now People'] },
    { artists: ['Big Star'], titles: ['Third/Sister Lovers', '3rd/Sister Lovers', 'Third', '3rd'] },
    { artists: ['Cartola'], titles: ['Cartola II', 'Cartola'] },
    { artists: ['Keith Jarrett'], titles: ['Sun Bear Concerts Piano Solo: Recorded In Japan', 'Sun Bear Concerts'] },
    { artists: ['Count Basie'], titles: ['The Atomic Mr. Basie', 'Basie'] },
    { artists: ['Led Zeppelin'], titles: ['Led Zeppelin I', 'Led Zeppelin'] },
    { artists: ['The Kinks'], titles: ['Lola Versus Powerman', 'Lola Versus Powerman And The Moneygoround', 'Lola Versus Powerman And The Moneygoround (Part One)'] }
]);

// A collection entry can represent a larger package that contains the album in
// the Topster. These mappings are directional: owning the container counts as
// owning the contained release, but owning only the contained release does not
// imply ownership of the larger package.
const DISCOGS_OWNED_CONTAINER_GROUPS = Object.freeze([
    { artists: ['Death Grips'], container: 'The Powers That B', contains: ['Jenny Death'] },
    { artists: ['Fishmans'], container: 'Fishmans Rock Festival', contains: ['Long Season', '98.12.28 男達の別れ', '宇宙 日本 世田谷'] },
    { artists: ['Fishmans'], container: '98.12.28 男達の別れ', contains: ['宇宙 日本 世田谷'] }
]);

// Some source lists identify a producer/curator as the artist while Discogs
// files the physical release under Various. Keep these exceptions explicit so
// \"Various\" never becomes a blanket artist wildcard.
const DISCOGS_OWNED_CROSS_CREDIT_GROUPS = Object.freeze([
    {
        entryArtists: ['Phil Spector'],
        collectionArtists: ['Various'],
        entryTitles: ['A Christmas Gift For You'],
        collectionTitles: ['A Christmas Gift For You From Philles Records']
    },
    {
        entryArtists: ['Jimmy Cliff'],
        collectionArtists: ['Various'],
        entryTitles: ['The Harder They Come'],
        collectionTitles: ['The Harder They Come (Original Soundtrack Recording)']
    },
    {
        entryArtists: ['Various Artists'],
        collectionArtists: ['Rodgers & Hammerstein'],
        entryTitles: ['South Pacific'],
        collectionTitles: ['South Pacific', 'Rodgers & Hammerstein']
    }
]);

const DISCOGS_OWNED_MULTI_RELEASE_GROUPS = Object.freeze([
    {
        artists: ['Frank Zappa'],
        entryTitles: ["Joe's Garage"],
        requires: [
            { artists: ['Frank Zappa', 'Zappa'], titles: ["Joe's Garage Act I"] },
            { artists: ['Frank Zappa', 'Zappa'], titles: ["Joe's Garage Acts II & III", "Joe's Garage Acts II And III"] }
        ]
    }
]);

function discogsOwnedKnownMultiReleaseMatch(entryArtist, entryTitle) {
    const entryKey = discogsOwnedRelationKey(entryTitle);
    if (!entryKey || !Array.isArray(topsterDiscogsCollectionAlbums)) return false;

    return DISCOGS_OWNED_MULTI_RELEASE_GROUPS.some(group => {
        if (!discogsOwnedArtistMatchesScopedGroup(entryArtist, group.artists)) return false;
        if (!(group.entryTitles || []).some(title => discogsOwnedRelationKey(title) === entryKey)) return false;

        return (group.requires || []).every(requirement => {
            const requiredTitleKeys = new Set((requirement.titles || []).map(discogsOwnedRelationKey));
            return topsterDiscogsCollectionAlbums.some(album => {
                const collectionTitle = cleanAlbumTitle(album && album.title || '');
                const collectionArtists = album && Array.isArray(album.artists) && album.artists.length
                    ? album.artists
                    : [album && album.artist || ''];
                if (!requiredTitleKeys.has(discogsOwnedRelationKey(collectionTitle))) return false;
                return collectionArtists.some(artist => discogsOwnedArtistMatchesScopedGroup(artist, requirement.artists || group.artists));
            });
        });
    });
}

function discogsOwnedRelationKey(value) {
    const normalized = cleanAlbumTitle(value || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[^\p{L}\p{N}]+/gu, '')
        .trim();
    return normalized || normalizeAlbumIdentityKey(value);
}

function discogsOwnedArtistMatchesScopedGroup(entryArtist, groupArtists) {
    const entryVariants = new Set(discogsOwnedArtistVariants(entryArtist));
    const groupVariants = new Set((groupArtists || []).flatMap(discogsOwnedArtistVariants));
    return Array.from(entryVariants).some(value => groupVariants.has(value)
        || Array.from(groupVariants).some(groupValue => value.length >= 5 && (value.includes(groupValue) || groupValue.includes(value))));
}

function discogsOwnedKnownContainerMatch(entryArtist, entryTitle, collectionTitle) {
    const entryKey = discogsOwnedRelationKey(entryTitle);
    const collectionKey = discogsOwnedRelationKey(collectionTitle);
    if (!entryKey || !collectionKey) return false;

    return DISCOGS_OWNED_CONTAINER_GROUPS.some(group => {
        if (!discogsOwnedArtistMatchesScopedGroup(entryArtist, group.artists)) return false;
        if (discogsOwnedRelationKey(group.container) !== collectionKey) return false;
        return group.contains.some(title => discogsOwnedRelationKey(title) === entryKey);
    });
}

function discogsOwnedKnownCrossCreditMatch(entryArtist, entryTitle, collectionTitle, collectionArtists = []) {
    const entryArtistKeys = new Set(discogsOwnedArtistVariants(entryArtist));
    const collectionArtistKeys = new Set((Array.isArray(collectionArtists) ? collectionArtists : [collectionArtists]).flatMap(discogsOwnedArtistVariants));
    const entryTitleKey = discogsOwnedRelationKey(entryTitle);
    const collectionTitleKey = discogsOwnedRelationKey(collectionTitle);
    if (!entryArtistKeys.size || !collectionArtistKeys.size || !entryTitleKey || !collectionTitleKey) return false;

    return DISCOGS_OWNED_CROSS_CREDIT_GROUPS.some(group => {
        const allowedEntryArtists = new Set(group.entryArtists.flatMap(discogsOwnedArtistVariants));
        const allowedCollectionArtists = new Set(group.collectionArtists.flatMap(discogsOwnedArtistVariants));
        const entryArtistMatch = Array.from(entryArtistKeys).some(value => allowedEntryArtists.has(value));
        const collectionArtistMatch = Array.from(collectionArtistKeys).some(value => allowedCollectionArtists.has(value));
        if (!entryArtistMatch || !collectionArtistMatch) return false;
        return group.entryTitles.some(title => discogsOwnedRelationKey(title) === entryTitleKey)
            && group.collectionTitles.some(title => discogsOwnedRelationKey(title) === collectionTitleKey);
    });
}

function discogsOwnedKnownAliasMatch(entryArtist, entryTitle, collectionTitle, collectionArtists = []) {
    const entryTitleKey = normalizeAlbumTitle(entryTitle || '');
    const collectionTitleKey = normalizeAlbumTitle(collectionTitle || '');
    if (!entryTitleKey || !collectionTitleKey) return false;

    const artistVariants = new Set([
        ...discogsOwnedArtistVariants(entryArtist),
        ...(Array.isArray(collectionArtists) ? collectionArtists : [collectionArtists]).flatMap(discogsOwnedArtistVariants)
    ]);

    return DISCOGS_OWNED_TITLE_ALIAS_GROUPS.some(group => {
        const titleKeys = group.titles.map(normalizeAlbumTitle);
        if (!titleKeys.includes(entryTitleKey) || !titleKeys.includes(collectionTitleKey)) return false;
        return group.artists.some(groupArtist => {
            const groupVariants = discogsOwnedArtistVariants(groupArtist);
            return groupVariants.some(aliasArtist => artistVariants.has(aliasArtist)
                || Array.from(artistVariants).some(candidate => candidate.length >= 5 && (candidate.includes(aliasArtist) || aliasArtist.includes(candidate))));
        });
    });
}


function discogsOwnedSafeTitleVariants(title, artist = '') {
    const clean = discogsOwnedNormalizeRomanVolumes(title);
    if (!clean) return [];

    const normalizedVariants = new Set();
    const rawVariants = new Set();
    const queue = [];

    const enqueue = value => {
        const raw = cleanAlbumTitle(value || '');
        if (!raw || rawVariants.has(raw)) return;
        rawVariants.add(raw);
        queue.push(raw);
        const normalized = normalizeAlbumIdentityKey(raw);
        if (normalized) normalizedVariants.add(normalized);
    };

    const escapeRegExp = value => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const artistText = normalizeDiscogsArtistForMatch(artist || '');
    const artistPrefixCandidates = Array.from(new Set([
        artistText,
        artistText.replace(/^(?:the|a|an)\s+/i, '')
    ].map(cleanAlbumTitle).filter(Boolean)));

    enqueue(clean);

    // Generate combinations, not just one transformation at a time. This lets
    // "The Complete Live At ... 1965" safely become "Live At ..." after the
    // edition word, year, and leading article are all removed.
    while (queue.length && rawVariants.size < 80) {
        const current = queue.shift();

        // Leading articles are catalog punctuation, not identity.
        enqueue(current.replace(/^(?:the|a|an)\s+/i, ''));

        // Trailing parentheticals are commonly translation/edition/soundtrack metadata.
        enqueue(current.replace(/\s*\([^()]*\)\s*$/, ''));

        // Bracketed alternate-name annotations such as [El Indio] are catalog metadata.
        enqueue(current.replace(/\s*\[[^\[\]]*\]\s*$/, ''));

        // "AKA" joins alternate names for the same release; either substantial side
        // may identify the owned album when the artist is already compatible.
        current.split(/\s+\baka\b\s+/i).forEach(part => {
            const partClean = cleanAlbumTitle(part);
            if (normalizeAlbumTitle(partClean).length >= 8) enqueue(partClean);
        });

        // Discogs frequently places a translated/Japanese title after an equals
        // sign. Either substantial side can identify the same owned release.
        current.split(/\s+=\s+/).forEach(part => {
            const partClean = cleanAlbumTitle(part);
            if (normalizeAlbumIdentityKey(partClean).length >= 6) enqueue(partClean);
        });

        // Live/archival suffixes are frequently appended to the base album title.
        enqueue(current.replace(/\s+\blive\s+at\b.+$/i, ''));
        enqueue(current.replace(/\s+[—–-]\s+(?:the\s+)?(?:found\s+)?(?:['’]?\d{2,4}\s+)?masters\b.*$/i, ''));

        // Explicit volume labels may be omitted by one source. Bare sequel numerals
        // are still protected later by discogsOwnedFuzzyTitleMatchIsSafe().
        enqueue(current.replace(/\s*(?:[-–—,:]\s*)?\bvolume\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*$/i, ''));

        // Archive date annotations are often absent from list titles.
        enqueue(current.replace(/\b(?:18|19|20)\d{2}(?:\s*[-–—]\s*(?:18|19|20)\d{2})?\s*$/i, ''));

        // Edition words can appear anywhere and combine with other metadata removals.
        enqueue(current.replace(/\b(?:complete|expanded|deluxe|remastered|remaster|edition)\b/gi, ' '));

        // Credits sometimes migrate from the artist field to the title field.
        enqueue(current.replace(/\s+\b(?:with|featuring|feat\.?|by)\b\s+.+$/i, ''));

        // Compilation descriptors appended after a separator are safe to discard
        // when the artist already matches (e.g. Chronicle - The 20 Greatest Hits).
        enqueue(current.replace(/\s+[—–-]\s+(?:the\s+)?(?:\d+\s+)?(?:greatest|golden)\s+hits\b.*$/i, ''));
        enqueue(current.replace(/\s+[—–-]\s+\b(?:original soundtrack|original movie soundtrack|soundtrack|a tribute to)\b.*$/i, ''));

        // The same artist name is often redundantly prepended to a Discogs title,
        // including possessive forms such as "The Drifters' Golden Hits".
        artistPrefixCandidates.forEach(candidate => {
            const escaped = escapeRegExp(candidate);
            const prefixPattern = new RegExp(`^${escaped}(?:['’](?:s)?)?(?:\\s*[-–—:]\\s*|\\s+)`, 'i');
            enqueue(current.replace(prefixPattern, ''));
        });

        // Slash-combined releases may list one constituent album. Requiring two
        // distinctive tokens and a reasonable text length avoids tiny collisions.
        current.split(/\s*\/\s*/).forEach(part => {
            const partClean = cleanAlbumTitle(part);
            const partNormalized = normalizeAlbumTitle(partClean);
            if (partNormalized.length >= 8 && tokenizeTitle(partClean).length >= 2) enqueue(partClean);
        });

        // Hyphen/colon combined titles can likewise surface one substantial part.
        // The >=10-character threshold deliberately keeps "Star Wars" from matching
        // "Star Wars: The Empire Strikes Back" while allowing Deaf Dumb Blind and
        // Roforofo Fight to match their expanded Discogs titles.
        current.split(/\s+[—–-]\s+|:\s+/).forEach(part => {
            const partClean = cleanAlbumTitle(part);
            const partNormalized = normalizeAlbumTitle(partClean);
            if (partNormalized.length >= 10 && tokenizeTitle(partClean).length >= 2) enqueue(partClean);
        });
    }

    return Array.from(normalizedVariants);
}

function discogsOwnedTruncatedTitleMatch(shortTitle, fullTitle) {
    const rawShort = cleanAlbumTitle(shortTitle || '');
    if (!/(?:\.{3,}|…)\s*$/.test(rawShort)) return false;

    const prefix = normalizeAlbumTitle(rawShort.replace(/(?:\.{3,}|…)\s*$/, ''));
    const full = normalizeAlbumTitle(fullTitle || '');
    return prefix.length >= 10 && full.length > prefix.length && full.startsWith(prefix);
}

function discogsOwnedSafeTitleEquivalence(entryTitle, collectionTitle, entryArtist = '', collectionArtists = []) {
    const entryVariants = discogsOwnedSafeTitleVariants(entryTitle, entryArtist);
    const rawCollectionArtists = Array.isArray(collectionArtists) ? collectionArtists : [collectionArtists];
    const collectionVariants = new Set();

    if (rawCollectionArtists.length) {
        rawCollectionArtists.forEach(artist => {
            discogsOwnedSafeTitleVariants(collectionTitle, artist).forEach(value => collectionVariants.add(value));
        });
    } else {
        discogsOwnedSafeTitleVariants(collectionTitle, '').forEach(value => collectionVariants.add(value));
    }

    if (entryVariants.some(value => collectionVariants.has(value))) return true;
    return discogsOwnedTruncatedTitleMatch(entryTitle, collectionTitle)
        || discogsOwnedTruncatedTitleMatch(collectionTitle, entryTitle);
}

function discogsOwnedBareTrailingSequenceMarker(value) {
    const text = cleanAlbumTitle(value || '').toLowerCase();
    if (!text || /\b(?:vol(?:ume)?|no\.?|number|part)\s*(?:[ivx]+|\d+)\s*$/.test(text)) return '';
    const match = text.match(/\b([ivx]+|\d+)\s*$/);
    if (!match) return '';
    const romanMap = { i:'1', ii:'2', iii:'3', iv:'4', v:'5', vi:'6', vii:'7', viii:'8', ix:'9', x:'10' };
    return romanMap[match[1]] || match[1];
}

function discogsOwnedFuzzyTitleMatchIsSafe(entryTitle, collectionTitle) {
    const entryNormalized = normalizeAlbumTitle(entryTitle || '');
    const collectionNormalized = normalizeAlbumTitle(collectionTitle || '');
    if (!entryNormalized || !collectionNormalized) return false;
    if (entryNormalized === collectionNormalized) return true;

    // A bare sequel/volume marker is substantive: Pretenders II must not match
    // Pretenders simply because the base title is identical.
    const entrySequence = discogsOwnedBareTrailingSequenceMarker(entryTitle);
    const collectionSequence = discogsOwnedBareTrailingSequenceMarker(collectionTitle);
    if (entrySequence !== collectionSequence && (entrySequence || collectionSequence)) return false;

    // Very short titles such as Time are too collision-prone for fuzzy/subset
    // matching. They may still match when the normalized titles are exact.
    if (Math.min(entryNormalized.length, collectionNormalized.length) <= 5) return false;

    const left = discogsOwnedTokenSet(entryTitle);
    const right = discogsOwnedTokenSet(collectionTitle);
    if (left.size && right.size) {
        let intersection = 0;
        left.forEach(token => { if (right.has(token)) intersection += 1; });
        const smallerSize = Math.min(left.size, right.size);
        const largerSize = Math.max(left.size, right.size);
        const fullContainment = intersection === smallerSize;

        // Do not let a short franchise/base title claim a longer distinct work,
        // e.g. Star Wars -> Star Wars: The Empire Strikes Back.
        if (fullContainment && smallerSize <= 2 && largerSize >= 4) return false;
    }

    const lengthRatio = Math.min(entryNormalized.length, collectionNormalized.length)
        / Math.max(entryNormalized.length, collectionNormalized.length);
    if (lengthRatio < 0.52) return false;
    return true;
}

function discogsOwnedStrongTitleOnlyMatch(entryTitle, collectionTitle, entryArtist = '', collectionArtist = '') {
    const leftVariants = discogsOwnedTitleVariants(entryTitle, entryArtist);
    const rightVariants = discogsOwnedTitleVariants(collectionTitle, collectionArtist);
    const exact = leftVariants.some(v => rightVariants.includes(v));
    if (!exact) return false;
    return Math.min(normalizeAlbumTitle(entryTitle).length, normalizeAlbumTitle(collectionTitle).length) >= 12;
}

function topsterEntryIsInDiscogsCollection(entry) {
    if (!entry || !Array.isArray(topsterDiscogsCollectionAlbums) || !topsterDiscogsCollectionAlbums.length) return false;
    const entryArtist = cleanAlbumTitle(entry.artist || ''), entryTitle = cleanAlbumTitle(entry.title || '');
    if (!entryTitle) return false;

    const memoKey = `${discogsOwnedRelationKey(entryArtist)}::${discogsOwnedRelationKey(entryTitle)}`;
    if (memoKey && topsterDiscogsOwnershipMemo.has(memoKey)) {
        return topsterDiscogsOwnershipMemo.get(memoKey);
    }
    const remember = value => {
        if (memoKey) topsterDiscogsOwnershipMemo.set(memoKey, Boolean(value));
        return Boolean(value);
    };

    // Exact normalized artist + safe title equivalence comes first. This is
    // intentionally independent of the fuzzy score path so exact Discogs credit
    // punctuation (including a trailing *) cannot be lost in later heuristics.
    if (discogsOwnedDirectIndexedMatch(entryArtist, entryTitle)) return remember(true);

    if (discogsOwnedKnownMultiReleaseMatch(entryArtist, entryTitle)) return remember(true);

    // Cross-credit exceptions deliberately allow different credited artists, so
    // evaluate only the handful of entries that can use one of those explicit rules.
    if (discogsOwnedEntryHasCrossCreditRule(entryArtist, entryTitle)) {
        for (const album of topsterDiscogsCollectionAlbums) {
            const collectionTitle = cleanAlbumTitle(album.title || '');
            const collectionArtists = Array.isArray(album.artists) && album.artists.length ? album.artists : [album.artist || ''];
            if (collectionTitle && discogsOwnedKnownCrossCreditMatch(entryArtist, entryTitle, collectionTitle, collectionArtists)) {
                return remember(true);
            }
        }
    }

    // Most entries now scan only releases indexed to a compatible artist instead
    // of every album in the Discogs collection. This removes the old O(topster ×
    // collection) cost when enabling the owned-release overlay on large Topsters.
    const candidateAlbums = getTopsterDiscogsCandidateAlbums(entryArtist);
    for (const album of candidateAlbums) {
        const collectionTitle = cleanAlbumTitle(album.title || '');
        const collectionArtists = Array.isArray(album.artists) && album.artists.length ? album.artists : [album.artist || ''];
        if (!collectionTitle) continue;
        const artistsMatch = discogsOwnedArtistsMatch(entryArtist, collectionArtists);

        if (artistsMatch) {
            if (normalizeAlbumIdentityKey(entryTitle) === normalizeAlbumIdentityKey(collectionTitle)) return remember(true);
            if (discogsOwnedKnownContainerMatch(entryArtist, entryTitle, collectionTitle)) return remember(true);
            if (discogsOwnedKnownAliasMatch(entryArtist, entryTitle, collectionTitle, collectionArtists)) return remember(true);
            if (discogsOwnedSafeTitleEquivalence(entryTitle, collectionTitle, entryArtist, collectionArtists)) return remember(true);

            const titleScore = discogsOwnedTitleScore(entryTitle, collectionTitle, entryArtist, collectionArtists.join(', '));
            if (titleScore >= 0.68 && discogsOwnedFuzzyTitleMatchIsSafe(entryTitle, collectionTitle)) return remember(true);
            if (discogsOwnedIsCompilationLike(entryTitle) && discogsOwnedIsCompilationLike(collectionTitle)) return remember(true);
            if (discogsOwnedIsArtistPresentationTitle(entryTitle, entryArtist) && discogsOwnedIsArtistPresentationTitle(collectionTitle, entryArtist)) return remember(true);
        }
    }

    // Never infer ownership from an exact/fuzzy title alone when the artist is
    // unrelated. Cross-credit cases must be explicitly mapped above.
    return remember(false);
}

function applyOwnedReleaseVisualState(tile, entry, enabled) {
    if (!tile) return;
    const owned = Boolean(enabled && topsterEntryIsInDiscogsCollection(entry));
    tile.classList.toggle('topster-owned-release', owned);

    const existingOwnedX = tile.querySelector('.topster-owned-release-x');
    if (!owned) {
        if (existingOwnedX) existingOwnedX.remove();
        tile.querySelectorAll('img, .topster-cover-overlay, .topster-tile-placeholder').forEach(element => {
            element.style.opacity = '';
            element.style.filter = '';
        });
        return;
    }

    tile.querySelectorAll('img, .topster-cover-overlay, .topster-tile-placeholder').forEach(element => {
        element.style.opacity = '0.25';
        element.style.filter = 'grayscale(100%)';
    });

    if (!existingOwnedX) {
        const ownedX = document.createElement('span');
        ownedX.className = 'topster-owned-release-x';
        ownedX.setAttribute('aria-hidden', 'true');
        tile.appendChild(ownedX);
    }
}

function getTopsterStoreSourceKey() {
    // The storage namespace is explicitly declared by each Topster page pair.
    // This prevents display settings or cover caches from leaking between grid,
    // ranked, draft, and checklist even if a page's data-source label changes.
    const body = document.body;
    const explicitSource = String(
        (body && body.dataset && body.dataset.topsterStoreSource) || ''
    ).trim().toLowerCase();
    const allowedSources = new Set(['grid', 'ranked', 'draft', 'checklist', 'rolling_stone_500_albums_2003', 'rolling_stone_500_albums_2012', 'rolling_stone_500_albums_2020', 'rolling_stone_500_albums_2023', 'nme_500_albums', '1001_albums_you_must_hear_before_you_die', 'rate_your_music', 'rolling_stone_greatest_singers_of_all_time_2023', 'rolling_stone_greatest_singers_of_all_time_2008']);
    if (allowedSources.has(explicitSource)) return explicitSource;

    // Backward-compatible fallback for older page copies.
    const kind = getTopsterDataSourceConfig().kind;
    if (kind === 'ranked-sheet') return 'ranked';
    if (kind === 'draft-file') return 'draft';
    if (kind === 'checklist-file') return 'checklist';
    if (kind === 'rolling-stone-500-albums-2003-file') return 'rolling_stone_500_albums_2003';
    if (kind === 'rolling-stone-500-albums-2012-file') return 'rolling_stone_500_albums_2012';
    if (kind === 'rolling-stone-500-albums-2020-file') return 'rolling_stone_500_albums_2020';
    if (kind === 'rolling-stone-500-albums-2023-file') return 'rolling_stone_500_albums_2023';
    if (kind === 'nme-500-albums-file') return 'nme_500_albums';
    if (kind === '1001-albums-you-must-hear-before-you-die-file') return '1001_albums_you_must_hear_before_you_die';
    if (kind === 'rate-your-music-chart') return 'rate_your_music';
    if (kind === 'rolling-stone-greatest-singers-of-all-time-2023-file') return 'rolling_stone_greatest_singers_of_all_time_2023';
    if (kind === 'rolling-stone-greatest-singers-of-all-time-2008-file') return 'rolling_stone_greatest_singers_of_all_time_2008';
    return 'grid';
}

function buildTopsterSharedStoreUrl() {
    const url = new URL(TOPSTER_SHARED_STORE_API, getTopsterBackendOrigin() || window.location.origin);
    url.searchParams.set('source', getTopsterStoreSourceKey());
    return url.href;
}

function getTopsterSettingsStorageKey() {
    return `${TOPSTER_SETTINGS_KEY}::${getTopsterStoreSourceKey()}::working`;
}

function getTopsterCoverCacheStorageKey() {
    return `${TOPSTER_CACHE_KEY}::${getTopsterStoreSourceKey()}::working`;
}

function getTopsterPrelookupStorageKey() {
    return `${TOPSTER_PRELOOKUP_KEY}::${getTopsterStoreSourceKey()}::working`;
}

function loadTopsterPrelookupState() {
    // The completed-first-Build flag must survive even when a very large cover cache
    // exhausts localStorage. Keep an in-memory copy first, with sessionStorage and
    // localStorage used only as persistence helpers.
    if (topsterPrelookupMemoryState && typeof topsterPrelookupMemoryState === 'object') {
        return topsterPrelookupMemoryState;
    }

    const storageKey = getTopsterPrelookupStorageKey();
    for (const storage of [window.sessionStorage, window.localStorage]) {
        try {
            const stored = JSON.parse(storage.getItem(storageKey) || 'null');
            if (stored && typeof stored === 'object') {
                topsterPrelookupMemoryState = stored;
                return stored;
            }
        } catch (error) {
            // Try the next storage mechanism.
        }
    }

    return null;
}

function saveTopsterPrelookupState(signature, details = {}) {
    if (!signature) return;

    const state = {
        signature,
        completedAt: new Date().toISOString(),
        lineCount: Number(details.lineCount) || 0,
        foundCount: Number(details.foundCount) || 0,
        missedCount: Number(details.missedCount) || 0
    };

    // Set memory before touching Web Storage. With a 500-album cache, localStorage
    // can be full because each cover has multiple aliases. The second Build must
    // still see the completed prelookup immediately in the current page session.
    topsterPrelookupMemoryState = state;
    const serialized = JSON.stringify(state);
    const storageKey = getTopsterPrelookupStorageKey();

    try {
        sessionStorage.setItem(storageKey, serialized);
    } catch (error) {
        // The in-memory state above remains authoritative for this page session.
    }

    try {
        localStorage.setItem(storageKey, serialized);
    } catch (error) {
        // Large Topster caches can exhaust localStorage. This is no longer fatal
        // because memory/sessionStorage already preserve the two-stage Build state.
    }
}

function clearTopsterPrelookupState() {
    topsterPrelookupMemoryState = null;
    const storageKey = getTopsterPrelookupStorageKey();

    for (const storage of [window.sessionStorage, window.localStorage]) {
        try {
            storage.removeItem(storageKey);
        } catch (error) {
            // Optional local cleanup.
        }
    }
}

function topsterPrelookupIsComplete(signature) {
    const state = loadTopsterPrelookupState();
    return Boolean(state && signature && state.signature === signature);
}

function isTopsterEditorPage() {
    const body = document.body;
    const readOnly = body && (body.dataset.topsterReadonly === 'true' || body.dataset.topsterMode === 'list');
    if (readOnly) return false;

    const fileName = window.location.pathname.split('/').pop().toLowerCase();
    return fileName === 'grid.html'
        || fileName === 'ranked_grid.html'
        || fileName === 'draft_grid.html'
        || fileName === 'draft_checklist.html'
        || fileName === 'rolling_stone_500_albums_2003_draft.html'
        || fileName === 'rolling_stone_500_albums_2012_draft.html'
        || fileName === 'rolling_stone_500_albums_2020_draft.html'
        || fileName === 'rolling_stone_500_albums_2023_draft.html'
        || fileName === 'nme_500_albums_draft.html'
        || fileName === '1001_albums_you_must_hear_before_you_die_draft.html'
        || fileName === 'rate_your_music_draft.html'
        || fileName === 'rolling_stone_greatest_singers_of_all_time_2023_draft.html'
        || fileName === 'rolling_stone_greatest_singers_of_all_time_2008_draft.html'
        || Boolean(body && body.dataset.topsterRequireAdmin === 'true');
}

function isTopsterAdminProtectedPage() {
    const body = document.body;
    if (body && body.dataset.topsterRequireAdmin === 'true') return true;

    const fileName = window.location.pathname.split('/').pop().toLowerCase();
    if (fileName === 'grid.html' || fileName === 'ranked_grid.html' || fileName === 'draft_album_list.html') return true;
    if (/^draft_.+\.html$/.test(fileName)) return true;
    if (/_draft\.html$/.test(fileName)) return true;
    return false;
}

async function requireTopsterAdminAccess() {
    if (!isTopsterAdminProtectedPage()) return true;

    const statusUrl = new URL('/api/topster-admin-status', getTopsterBackendOrigin() || window.location.origin);
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = controller ? window.setTimeout(() => controller.abort(), 12000) : null;

    try {
        const response = await fetch(statusUrl.href, {
            method: 'GET',
            credentials: 'include',
            cache: 'no-store',
            signal: controller ? controller.signal : undefined
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const payload = await response.json();
        if (payload && payload.authenticated) return true;

        window.location.replace(buildTopsterAdminLoginUrl());
        return false;
    } catch (error) {
        console.error('Topster admin authentication check failed:', error);
        const status = document.getElementById('topster-status');
        if (status) {
            status.textContent = 'Admin authentication service is unavailable. This page is locked until authentication can be verified.';
            status.hidden = false;
        }
        failTopsterLoading('Admin authentication could not be verified. Access is locked.');
        return false;
    } finally {
        if (timeoutId) window.clearTimeout(timeoutId);
    }
}

function isTopsterReadOnlyPage() {
    const body = document.body;
    return Boolean(body && (body.dataset.topsterReadonly === 'true' || body.dataset.topsterMode === 'list'));
}

function buildTopsterAdminLoginUrl() {
    const loginUrl = new URL('/topster-admin-login', getTopsterBackendOrigin() || window.location.origin);
    loginUrl.searchParams.set('next', window.location.href);
    return loginUrl.href;
}

function getTopsterDataSourceConfig() {
    const sourceName = String((document.body && document.body.dataset.topsterSource) || '').trim().toLowerCase();

    if (sourceName === 'rolling-stone-500-albums-2003-file' || sourceName === 'rolling_stone_500_albums_2003' || sourceName === 'rolling-stone-500-albums-2003') {
        return {
            kind: 'rolling-stone-500-albums-2003-file',
            label: 'rolling_stone_500_albums_2003.txt',
            readLabel: 'rolling_stone_500_albums_2003.txt',
            fileName: 'rolling_stone_500_albums_2003.txt',
            staticFileOnly: true
        };
    }

    if (sourceName === 'rolling-stone-500-albums-2012-file' || sourceName === 'rolling_stone_500_albums_2012' || sourceName === 'rolling-stone-500-albums-2012') {
        return {
            kind: 'rolling-stone-500-albums-2012-file',
            label: 'rolling_stone_500_albums_2012.txt',
            readLabel: 'rolling_stone_500_albums_2012.txt',
            fileName: 'rolling_stone_500_albums_2012.txt',
            staticFileOnly: true
        };
    }

    if (sourceName === 'rolling-stone-500-albums-2020-file' || sourceName === 'rolling_stone_500_albums_2020' || sourceName === 'rolling-stone-500-albums-2020') {
        return {
            kind: 'rolling-stone-500-albums-2020-file',
            label: 'rolling_stone_500_albums_2020.txt',
            readLabel: 'rolling_stone_500_albums_2020.txt',
            fileName: 'rolling_stone_500_albums_2020.txt',
            staticFileOnly: true
        };
    }

    if (sourceName === 'rolling-stone-500-albums-2023-file' || sourceName === 'rolling_stone_500_albums_2023' || sourceName === 'rolling-stone-500-albums-2023') {
        return {
            kind: 'rolling-stone-500-albums-2023-file',
            label: 'rolling_stone_500_albums_2023.txt',
            readLabel: 'rolling_stone_500_albums_2023.txt',
            fileName: 'rolling_stone_500_albums_2023.txt',
            staticFileOnly: true
        };
    }

    if (sourceName === '1001-albums-you-must-hear-before-you-die-file' || sourceName === '1001_albums_you_must_hear_before_you_die' || sourceName === '1001-albums-you-must-hear-before-you-die') {
        return {
            kind: '1001-albums-you-must-hear-before-you-die-file',
            label: '1001_albums_you_must_hear_before_you_die.txt',
            readLabel: '1001_albums_you_must_hear_before_you_die.txt',
            fileName: '1001_albums_you_must_hear_before_you_die.txt',
            staticFileOnly: true
        };
    }

    if (sourceName === 'nme-500-albums-file' || sourceName === 'nme_500_albums' || sourceName === 'nme-500-albums') {
        return {
            kind: 'nme-500-albums-file',
            label: 'nme_500_albums.txt',
            readLabel: 'nme_500_albums.txt',
            fileName: 'nme_500_albums.txt',
            staticFileOnly: true
        };
    }

    if (sourceName === 'rate-your-music-chart' || sourceName === 'rate_your_music' || sourceName === 'rate-your-music') {
        return {
            kind: 'rate-your-music-chart',
            label: 'RateYourMusic chart snapshot',
            readLabel: 'saved RateYourMusic chart HTML',
            fileInputId: 'rym-chart-html-input'
        };
    }

    if (sourceName === 'rolling-stone-greatest-singers-of-all-time-2008-file' || sourceName === 'rolling_stone_greatest_singers_of_all_time_2008' || sourceName === 'rolling-stone-greatest-singers-2008') {
        return {
            kind: 'rolling-stone-greatest-singers-of-all-time-2008-file',
            label: 'rolling_stone_greatest_singers_of_all_time_2008.txt',
            readLabel: 'rolling_stone_greatest_singers_of_all_time_2008.txt',
            fileName: 'rolling_stone_greatest_singers_of_all_time_2008.txt',
            staticFileOnly: true
        };
    }

    if (sourceName === 'rolling-stone-greatest-singers-of-all-time-2023-file' || sourceName === 'rolling_stone_greatest_singers_of_all_time_2023' || sourceName === 'rolling-stone-greatest-singers-2023') {
        return {
            kind: 'rolling-stone-greatest-singers-of-all-time-2023-file',
            label: 'rolling_stone_greatest_singers_of_all_time_2023.txt',
            readLabel: 'rolling_stone_greatest_singers_of_all_time_2023.txt',
            fileName: 'rolling_stone_greatest_singers_of_all_time_2023.txt',
            staticFileOnly: true
        };
    }

    if (sourceName === 'checklist-file' || sourceName === 'checklist') {
        return {
            kind: 'checklist-file',
            label: 'checklist notepad file',
            readLabel: 'checklist notepad file',
            apiPath: '/api/checklist-text',
            fileInputId: 'topster-checklist-file-input'
        };
    }

    if (sourceName === 'draft-file' || sourceName === 'draft') {
        return {
            kind: 'draft-file',
            label: 'draft notepad file',
            readLabel: 'draft notepad file',
            apiPath: '/api/draft-grid-text',
            fileInputId: 'topster-draft-file-input'
        };
    }

    if (sourceName === 'ranked-sheet' || sourceName === 'ranked') {
        return {
            kind: 'ranked-sheet',
            label: 'Google Sheets ranked albums',
            readLabel: 'Google Sheets ranked albums',
            apiPath: '/api/ranked-grid-text',
            csvUrl: `https://docs.google.com/spreadsheets/d/${TOPSTER_RANKED_SHEET_ID}/export?format=csv&gid=${TOPSTER_RANKED_SHEET_GID}`
        };
    }

    return {
        kind: 'grid-file',
        label: TOPSTER_GRID_FILE,
        readLabel: TOPSTER_GRID_FILE,
        apiPath: '/api/grid-text',
        fileName: TOPSTER_GRID_FILE
    };
}

function getTopsterSourceLabel() {
    return getTopsterDataSourceConfig().label;
}

function getTopsterPublicPageName(sourceKey = getTopsterStoreSourceKey()) {
    const pageNames = {
        grid: 'album_list.html',
        ranked: 'ranked_album_list.html',
        draft: 'draft_album_list.html',
        checklist: 'checklist.html',
        rolling_stone_500_albums_2003: 'rolling_stone_500_albums_2003_list.html',
        rolling_stone_500_albums_2012: 'rolling_stone_500_albums_2012_list.html',
        rolling_stone_500_albums_2020: 'rolling_stone_500_albums_2020_list.html',
        rolling_stone_500_albums_2023: 'rolling_stone_500_albums_2023_list.html',
        nme_500_albums: 'nme_500_albums_list.html',
        '1001_albums_you_must_hear_before_you_die': '1001_albums_you_must_hear_before_you_die_list.html',
        rate_your_music: 'rate_your_music_list.html',
        rolling_stone_greatest_singers_of_all_time_2023: 'rolling_stone_greatest_singers_of_all_time_2023_list.html',
        rolling_stone_greatest_singers_of_all_time_2008: 'rolling_stone_greatest_singers_of_all_time_2008_list.html'
    };
    return pageNames[sourceKey] || 'album_list.html';
}

function getTopsterSourceDisplayName(sourceKey = getTopsterStoreSourceKey()) {
    const names = {
        grid: 'Albums',
        ranked: 'Ranked Albums',
        draft: 'Draft Albums',
        checklist: 'Checklist',
        rolling_stone_500_albums_2003: "Rolling Stone's 500 Greatest Albums Of All Time (2003)",
        rolling_stone_500_albums_2012: "Rolling Stone's 500 Greatest Albums Of All Time (2012)",
        rolling_stone_500_albums_2020: "Rolling Stone's 500 Greatest Albums Of All Time (2020)",
        rolling_stone_500_albums_2023: "Rolling Stone's 500 Greatest Albums Of All Time (2023)",
        nme_500_albums: "NME's 500 Greatest Albums Of All Time",
        '1001_albums_you_must_hear_before_you_die': '1001 Albums You Must Hear Before You Die (All Editions)',
        rate_your_music: "RateYourMusic's Top Albums Of All Time",
        rolling_stone_greatest_singers_of_all_time_2023: "Rolling Stone's 200 Greatest Singers of All Time (2023)",
        rolling_stone_greatest_singers_of_all_time_2008: "Rolling Stone's 200 Greatest Singers of All Time (2008)"
    };
    return names[sourceKey] || 'Albums';
}

function getTopsterStateKey() {
    return `${TOPSTER_STATE_KEY}::${getTopsterDataSourceConfig().kind}`;
}

async function initTopsterImporter(albumCards) {
    const buildButton = document.getElementById('topster-build-button');
    const refreshButton = document.getElementById('topster-refresh-button');
    const stopButton = document.getElementById('topster-stop-button');
    const clearButton = document.getElementById('topster-clear-button');
    const saveSettingsButton = document.getElementById('topster-save-settings-button');
    const cacheClearButton = document.getElementById('topster-cache-clear-button');
    const rangeSelect = document.getElementById('topster-range');
    const status = document.getElementById('topster-status');
    const output = document.getElementById('topster-output');
    const pagesContainer = document.getElementById('topster-pages');
    const widthSelect = document.getElementById('topster-width');
    const heightSelect = document.getElementById('topster-height');
    const widthValue = document.getElementById('topster-width-value');
    const heightValue = document.getElementById('topster-height-value');
    const sidebarModeSelect = document.getElementById('topster-sidebar-mode');
    const sidebarWidthSelect = document.getElementById('topster-sidebar-width');
    const sidebarWidthValue = document.getElementById('topster-sidebar-width-value');
    const sidebarTextSizeInput = document.getElementById('topster-sidebar-text-size');
    const sidebarTextSizeValue = document.getElementById('topster-sidebar-text-size-value');
    const roundCornersSelect = document.getElementById('topster-round-corners');
    const albumGapSelect = document.getElementById('topster-album-gap');
    const albumGapValue = document.getElementById('topster-album-gap-value');
    const fontSelect = document.getElementById('topster-font');
    const coverOverlaySelect = document.getElementById('topster-cover-overlay');
    const excludeOwnedSelect = document.getElementById('topster-exclude-owned');
    const deviceProfileSelect = document.getElementById('topster-device-profile');
    const sourceConfig = getTopsterDataSourceConfig();
    const topsterReadOnly = document.body && (document.body.dataset.topsterReadonly === 'true' || document.body.dataset.topsterMode === 'list');
    const topsterAutoLoad = document.body && (document.body.dataset.topsterAutoload === 'true' || topsterReadOnly);
    const sourceFileInput = sourceConfig.fileInputId
        ? document.getElementById(sourceConfig.fileInputId)
        : null;
    const coverPicker = document.getElementById('topster-cover-picker');
    const coverPickerTitle = document.getElementById('topster-cover-picker-title');
    const coverPickerSearch = document.getElementById('topster-cover-picker-search');
    const coverPickerLink = document.getElementById('topster-cover-picker-link');
    const coverPickerLinkButton = document.getElementById('topster-cover-picker-link-button');
    const coverPickerResetDefault = document.getElementById('topster-cover-picker-reset-default');
    const coverPickerClose = document.getElementById('topster-cover-picker-close');
    const coverPickerStatus = document.getElementById('topster-cover-picker-status');
    const coverPickerResults = document.getElementById('topster-cover-picker-results');

    if (!buildButton || !refreshButton || !clearButton || !cacheClearButton || !rangeSelect || !status || !output || !pagesContainer || !widthSelect || !heightSelect || !widthValue || !heightValue || !sidebarModeSelect || !roundCornersSelect || !albumGapSelect || !albumGapValue || !fontSelect) {
        return;
    }

    buildButton.textContent = 'Build';
    document.documentElement.dataset.topsterGridJsVersion = TOPSTER_FRONTEND_VERSION;
    setTopsterLoadingProgress(4, 'Connecting to the saved Topster settings and cover cache...');

    let albumCatalog = buildAlbumCatalog(albumCards || [], window.location.href);
    let importedEntries = [];
    let activeLookupToken = 0;
    let localIndexLoaded = albumCatalog.records.length > 0;
    let currentGridSignature = '';
    let currentSourceText = '';
    let currentSourceName = '';
    let lastBuildCompletionStatusText = '';
    let settingsElapsedTimer = null;
    let settingsElapsedToken = 0;

    function setBuildCompletionStatus(textValue) {
        lastBuildCompletionStatusText = String(textValue || '').trim();
        status.style.whiteSpace = 'pre-line';
        status.textContent = lastBuildCompletionStatusText;
    }

    function formatElapsedTime(milliseconds) {
        const seconds = Math.max(0, Number(milliseconds) || 0) / 1000;
        if (seconds < 10) return `${seconds.toFixed(1)}s`;
        if (seconds < 60) return `${seconds.toFixed(0)}s`;
        const minutes = Math.floor(seconds / 60);
        const remainder = Math.floor(seconds % 60);
        return `${minutes}m ${String(remainder).padStart(2, '0')}s`;
    }

    function formatSystemClockTime(epochMilliseconds) {
        return new Date(epochMilliseconds).toLocaleTimeString([], {
            hour: 'numeric',
            minute: '2-digit',
            second: '2-digit'
        });
    }

    function beginSettingsElapsedStatus(label = 'Updating Topster display settings') {
        const token = ++settingsElapsedToken;
        const startedAt = Date.now();
        const baseText = lastBuildCompletionStatusText || String(status.textContent || '').trim();
        window.clearInterval(settingsElapsedTimer);
        settingsElapsedTimer = null;
        status.style.whiteSpace = 'pre-line';
        status.textContent = `${baseText}${baseText ? '\n' : ''}${label} started at ${formatSystemClockTime(startedAt)}.`;
        return { token, startedAt, baseText, label };
    }

    function finishSettingsElapsedStatus(context, suffix = '') {
        if (!context || context.token !== settingsElapsedToken) return;
        const finishedAt = Date.now();
        const elapsed = formatElapsedTime(finishedAt - context.startedAt);
        const completion = `${context.label} started at ${formatSystemClockTime(context.startedAt)} and finished at ${formatSystemClockTime(finishedAt)} (${elapsed}).${suffix ? ` ${suffix}` : ''}`;
        status.textContent = `${context.baseText}${context.baseText ? '\n' : ''}${completion}`;
    }

    await waitForTopsterSharedStore();
    if (sourceConfig.kind === 'rate-your-music-chart') {
        initializeRateYourMusicUi(topsterSharedSourceText);
    }
    setTopsterLoadingProgress(
        14,
        topsterSharedStoreAvailable
            ? 'Saved settings and cover cache received. Preparing the Topster source...'
            : 'Shared storage is temporarily unavailable. Preparing the local Topster editor...'
    );
    let pickerEntryIndex = null;
    let pickerLookupToken = 0;
    const retryingPublicCoverIndexes = new Set();
    const brokenCoverRecoveryState = new Map();
    const topsterSourceLabel = getTopsterSourceLabel();
    const topsterEditorPage = isTopsterEditorPage();

    // Warm the owned-release collection in the background on editor pages. A
    // valid seven-day browser cache resolves synchronously; otherwise the backend
    // request starts while the user is working instead of only after they toggle
    // "Exclude releases that I have".
    if (topsterEditorPage && excludeOwnedSelect) {
        const cachedDiscogsCollectionReady = loadDiscogsCollectionBrowserCache();
        if (!cachedDiscogsCollectionReady) {
            const prefetchDiscogsCollection = () => { ensureTopsterDiscogsCollectionLoaded().catch(() => {}); };
            if (typeof window.requestIdleCallback === 'function') {
                window.requestIdleCallback(prefetchDiscogsCollection, { timeout: 1500 });
            } else {
                window.setTimeout(prefetchDiscogsCollection, 250);
            }
        }
    }
    let currentSettingsProfiles = normalizeTopsterSettingsProfiles(loadTopsterSettings());
    let currentSettingsProfile = getInitialTopsterSettingsProfile(deviceProfileSelect, topsterEditorPage);
    let currentSettings = normalizeTopsterSettings(currentSettingsProfiles[currentSettingsProfile]);
    let pendingSettingsDirty = false;

    if (topsterEditorPage && topsterSharedStoreAvailable && !topsterSharedStoreWritable) {
        status.textContent = 'Grid editing requires Topster admin login. Redirecting...';
        window.location.replace(buildTopsterAdminLoginUrl());
        return;
    }

    if (topsterEditorPage && !topsterSharedStoreAvailable) {
        status.textContent = 'Sampler backend shared store is unavailable. Editor controls will still work locally, but Save Settings cannot publish until /api/topster-shared-store is reachable.';
    }

    if (deviceProfileSelect) deviceProfileSelect.value = currentSettingsProfile;
    setSettingsControls(currentSettings);
    applyTopsterSettings(currentSettings);
    loadSavedTopster();

    if (currentSettings.excludeOwnedReleases) {
        const collectionLoaded = await ensureTopsterDiscogsCollectionLoaded();
        if (collectionLoaded && importedEntries.length) {
            renderTopster(importedEntries, 0, { scroll: false });
        }
    }

    if (!importedEntries.length) {
        status.textContent = '';
    }

    buildButton.addEventListener('click', () => {
        buildTopsterFromGridFile({ force: true, source: 'build' });
    });

    refreshButton.addEventListener('click', async () => {
        const settingsApplied = pendingSettingsDirty;
        if (settingsApplied) {
            await handleSettingsChange();
            pendingSettingsDirty = false;
        }
        buildTopsterFromGridFile({ force: false, source: 'refresh', settingsApplied });
    });

    if (stopButton) {
        stopButton.addEventListener('click', () => {
            activeLookupToken++;
            if (stopButton) stopButton.disabled = true;
            buildButton.disabled = false;
            refreshButton.disabled = false;
            saveCurrentTopster();
            status.textContent = 'Cover lookup stopped. Current Topsters grid was kept.';
        });
    }

    clearButton.addEventListener('click', () => {
        activeLookupToken++;
        importedEntries = [];
        currentGridSignature = '';
        pagesContainer.innerHTML = '';
        output.hidden = true;
        setSingleRangeOption();
        if (stopButton) stopButton.disabled = true;
        buildButton.disabled = false;
        refreshButton.disabled = false;
        clearSavedTopsterState();
        status.textContent = `Cleared the saved Topsters grid. Build again from ${topsterSourceLabel} when ready.`;
    });

    cacheClearButton.addEventListener('click', async () => {
        await clearTopsterCoverCache();
        status.textContent = 'Cover cache cleared. The current Topsters grid was kept.';
    });

    if (saveSettingsButton) {
        saveSettingsButton.addEventListener('click', () => {
            if (pendingSettingsDirty) {
                status.textContent = 'Display settings have changed. Press Refresh to apply them before Save Settings.';
                return;
            }
            publishTopsterSettingsAndCovers();
        });
        if (topsterEditorPage) {
            document.addEventListener('keydown', event => {
                const key = String(event.key || '').toLowerCase();
                if (!(event.ctrlKey || event.metaKey) || event.altKey || key !== 's') return;
                event.preventDefault();
                event.stopPropagation();
                if (!saveSettingsButton.disabled) saveSettingsButton.click();
            });
        }
    }

    if (sourceFileInput) {
        sourceFileInput.addEventListener('change', () => {
            const selectedFiles = sourceFileInput.files ? Array.from(sourceFileInput.files) : [];
            const selectedFile = selectedFiles.length ? selectedFiles[0] : null;
            activeLookupToken++;
            clearTopsterPrelookupState();
            currentGridSignature = '';
            currentSourceText = '';
            currentSourceName = selectedFile ? selectedFile.name : '';
            if (selectedFile) {
                const selectedLabel = sourceConfig.kind === 'rate-your-music-chart' && selectedFiles.length > 1
                    ? `${selectedFiles.length} saved RateYourMusic pages`
                    : selectedFile.name;
                status.textContent = `Selected ${selectedLabel}. Press Build to read this ${sourceConfig.readLabel} and refresh the Topster.`;
                setTopsterLoadingProgress(0, `Ready to read ${selectedLabel}. Press Build to begin.`);
            } else {
                status.textContent = `No ${sourceConfig.readLabel} selected.`;
            }
        });
    }

    rangeSelect.addEventListener('change', () => {
        renderTopster(importedEntries, 0, { scroll: false });
        saveCurrentTopster();
        resolveVisibleRange(0);
    });

    function markSettingsPending() {
        pendingSettingsDirty = true;
        const pending = normalizeTopsterSettings(readSettingsControls());
        updateSettingsValueLabels(pending);
        status.textContent = 'Display settings changed. Press Refresh to apply them.';
    }

    function bindEditableSliderValue(rangeInput, valueInput, min, max) {
        if (!rangeInput || !valueInput || valueInput.tagName !== 'INPUT') return;
        const commit = () => {
            const next = clampInteger(valueInput.value, min, max, Number(rangeInput.value));
            rangeInput.value = String(next);
            valueInput.value = String(next);
            markSettingsPending();
        };
        valueInput.addEventListener('change', commit);
        valueInput.addEventListener('keydown', event => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            commit();
            valueInput.blur();
        });
    }

    [widthSelect, heightSelect, albumGapSelect, sidebarWidthSelect, sidebarTextSizeInput].forEach(element => {
        if (!element) return;
        element.addEventListener('input', markSettingsPending);
        element.addEventListener('change', markSettingsPending);
    });

    bindEditableSliderValue(widthSelect, widthValue, 1, 25);
    bindEditableSliderValue(heightSelect, heightValue, 1, 10);
    bindEditableSliderValue(sidebarWidthSelect, sidebarWidthValue, 10, 50);
    bindEditableSliderValue(sidebarTextSizeInput, sidebarTextSizeValue, 50, 200);
    bindEditableSliderValue(albumGapSelect, albumGapValue, 0, 100);

    [sidebarModeSelect, roundCornersSelect, fontSelect, coverOverlaySelect, excludeOwnedSelect].forEach(element => {
        if (element) element.addEventListener('change', markSettingsPending);
    });

    if (deviceProfileSelect) {
        deviceProfileSelect.addEventListener('change', () => {
            currentSettingsProfiles[currentSettingsProfile] = normalizeTopsterSettings(readSettingsControls());
            currentSettingsProfile = getInitialTopsterSettingsProfile(deviceProfileSelect, topsterEditorPage);
            setSettingsControls(normalizeTopsterSettings(currentSettingsProfiles[currentSettingsProfile]));
            pendingSettingsDirty = true;
            status.textContent = `Now editing ${getTopsterSettingsProfileLabel(currentSettingsProfile)} settings. Press Refresh to apply them.`;
        });
    }

    function getEffectiveTopsterSettings(settings = currentSettings) {
        const normalized = normalizeTopsterSettings(settings);
        if (isChecklistTopsterSource()) normalized.coverOverlay = 'none';
        return normalized;
    }

    function syncCurrentSettingsProfileToViewport() {
        if (topsterEditorPage) return false;

        const nextProfile = getAutomaticTopsterSettingsProfile();
        if (nextProfile === currentSettingsProfile) return false;

        currentSettingsProfile = nextProfile;
        currentSettings = normalizeTopsterSettings(currentSettingsProfiles[currentSettingsProfile]);
        setSettingsControls(currentSettings);
        applyTopsterSettings(currentSettings);
        return true;
    }

    function updateTopsterResponsiveMetrics() {
        if (!output || output.hidden) return;

        const chartGrids = pagesContainer.querySelectorAll('.topster-chart-grid');
        chartGrids.forEach(chart => {
            const tile = chart.querySelector('.topster-tile');
            const tileRect = tile ? tile.getBoundingClientRect() : null;
            const gridRect = chart.getBoundingClientRect();
            let coverSize = tileRect && tileRect.width ? tileRect.width : 0;

            if (!coverSize && gridRect.width) {
                const computed = getComputedStyle(chart);
                const columns = Number.parseFloat(computed.getPropertyValue('--topster-columns')) || currentSettings.width || 10;
                const gap = Number.parseFloat(computed.columnGap || computed.gap || '0') || 0;
                const paddingLeft = Number.parseFloat(computed.paddingLeft || '0') || 0;
                const paddingRight = Number.parseFloat(computed.paddingRight || '0') || 0;
                coverSize = (gridRect.width - paddingLeft - paddingRight - (gap * Math.max(0, columns - 1))) / Math.max(1, columns);
            }

            if (coverSize && Number.isFinite(coverSize)) {
                const rounded = Math.max(1, Math.round(coverSize));
                chart.style.setProperty('--topster-actual-cover-size', `${rounded}px`);
                output.style.setProperty('--topster-actual-cover-size', `${rounded}px`);
            }
        });
    }

    let topsterResizeFrame = 0;
    function scheduleTopsterResponsiveRefresh() {
        if (topsterResizeFrame) window.cancelAnimationFrame(topsterResizeFrame);
        topsterResizeFrame = window.requestAnimationFrame(() => {
            topsterResizeFrame = 0;
            const profileChanged = syncCurrentSettingsProfileToViewport();

            if (profileChanged && importedEntries.length) {
                renderTopster(importedEntries, 0, { scroll: false });
                return;
            }

            applyTopsterSettings(currentSettings);
            updateTopsterResponsiveMetrics();
            syncAllTopsterSidebarHeights();
        });
    }


    window.addEventListener('resize', scheduleTopsterResponsiveRefresh, { passive: true });
    window.addEventListener('orientationchange', () => {
        window.setTimeout(scheduleTopsterResponsiveRefresh, 120);
    }, { passive: true });

    async function handleSettingsProfileChange() {
        const elapsedContext = topsterEditorPage
            ? beginSettingsElapsedStatus('Updating Topster display settings')
            : null;
        if (elapsedContext) {
            await delay(0);
            if (elapsedContext.token !== settingsElapsedToken) return;
        }

        const previousSettings = normalizeTopsterSettings(readSettingsControls());
        currentSettingsProfiles[currentSettingsProfile] = previousSettings;
        currentSettingsProfile = getInitialTopsterSettingsProfile(deviceProfileSelect, topsterEditorPage);
        currentSettings = normalizeTopsterSettings(currentSettingsProfiles[currentSettingsProfile]);
        setSettingsControls(currentSettings);
        applyTopsterSettings(currentSettings);
        saveTopsterSettings(currentSettingsProfiles);
        safeMarkTopsterPublishDirty();

        if (currentSettings.excludeOwnedReleases) {
            await ensureTopsterDiscogsCollectionLoaded();
            if (elapsedContext && elapsedContext.token !== settingsElapsedToken) return;
        }

        if (importedEntries.length) {
            const selectedStart = Number(rangeSelect.value || 0);
            renderTopster(importedEntries, selectedStart, { scroll: false });
            // Yield so the new layout can paint before serializing a very large
            // saved-state payload, but keep persistence inside the elapsed task.
            await delay(0);
            if (elapsedContext && elapsedContext.token !== settingsElapsedToken) return;
            saveCurrentTopster();
        }

        if (topsterEditorPage) {
            await new Promise(resolve => window.requestAnimationFrame(() => resolve()));
            finishSettingsElapsedStatus(
                elapsedContext,
                `Now configuring ${getTopsterSettingsProfileLabel(currentSettingsProfile)}. Press Save Settings to publish.`
            );
        } else {
            status.textContent = '';
        }
    }

    async function handleSettingsChange() {
        const elapsedContext = topsterEditorPage
            ? beginSettingsElapsedStatus('Updating Topster display settings')
            : null;
        if (elapsedContext) {
            // Yield once so rapid slider input events collapse onto the newest
            // settings state and the elapsed line can paint before a large rerender.
            await delay(0);
            if (elapsedContext.token !== settingsElapsedToken) return;
        }

        const previousSettings = { ...currentSettings };
        currentSettings = normalizeTopsterSettings(readSettingsControls());
        const excludeOwnedOnlyChange = previousSettings.excludeOwnedReleases !== currentSettings.excludeOwnedReleases
            && ['width', 'height', 'sidebarMode', 'sidebarWidth', 'sidebarTextScale', 'roundCorners', 'albumGap', 'font', 'coverOverlay']
                .every(key => previousSettings[key] === currentSettings[key]);
        currentSettingsProfiles[currentSettingsProfile] = currentSettings;
        saveTopsterSettings(currentSettingsProfiles);
        applyTopsterSettings(currentSettings);
        updateSettingsValueLabels(currentSettings);
        safeMarkTopsterPublishDirty();

        let warning = '';
        if (currentSettings.excludeOwnedReleases) {
            const collectionLoaded = await ensureTopsterDiscogsCollectionLoaded();
            if (elapsedContext && elapsedContext.token !== settingsElapsedToken) return;
            if (!collectionLoaded && topsterEditorPage) {
                warning = 'Discogs collection could not be loaded, so owned-release dimming is temporarily unavailable.';
            }
        }

        if (!importedEntries.length) {
            setSingleRangeOption();
            if (topsterEditorPage) {
                finishSettingsElapsedStatus(elapsedContext, `${warning}${warning ? ' ' : ''}Press Save Settings to publish.`);
            } else {
                status.textContent = '';
            }
            return;
        }

        if (excludeOwnedOnlyChange) {
            updateOwnedReleaseVisualStatesInPlace(currentSettings.excludeOwnedReleases);
            await new Promise(resolve => window.requestAnimationFrame(() => resolve()));
            if (elapsedContext && elapsedContext.token !== settingsElapsedToken) return;
            scheduleCurrentTopsterSave();
            if (topsterEditorPage) {
                finishSettingsElapsedStatus(elapsedContext, `${warning}${warning ? ' ' : ''}Press Save Settings to publish.`);
            }
            return;
        }

        const selectedStart = populateRangeSelect(importedEntries.length, 0);
        renderTopster(importedEntries, selectedStart, { scroll: false });
        await delay(0);
        if (elapsedContext && elapsedContext.token !== settingsElapsedToken) return;
        saveCurrentTopster();

        if (topsterEditorPage) {
            await new Promise(resolve => window.requestAnimationFrame(() => resolve()));
            finishSettingsElapsedStatus(elapsedContext, `${warning}${warning ? ' ' : ''}Press Save Settings to publish.`);
        } else {
            status.textContent = `Updated Topster display settings to ${currentSettings.width}x${currentSettings.height}.`;
        }
    }

    function getPublishableCoverCache() {
        const cache = getCoverCache();

        importedEntries.forEach(entry => {
            if (!entry || !entry.cover || !entry.cover.imageSrc) return;

            const cachedCover = {
                title: entry.cover.title || entry.title || '',
                artist: entry.cover.artist || entry.artist || '',
                imageSrc: entry.cover.imageSrc,
                href: entry.cover.href || '',
                source: entry.cover.source || '',
                selectedManually: Boolean(entry.cover.selectedManually),
                savedAt: entry.cover.savedAt || new Date().toISOString()
            };

            buildCoverCacheAliases(entry).forEach(alias => {
                cache[alias] = cachedCover;
            });
            cache[buildCoverCacheKey(entry)] = cachedCover;
        });

        if (isTopsterEditorPage()) {
            topsterEditorWorkingCoverCache = cache;
            writeLocalTopsterCoverCache(cache);
        }

        return cache;
    }

    async function publishTopsterSettingsAndCovers() {
        if (!topsterEditorPage) return;

        currentSettings = normalizeTopsterSettings(readSettingsControls());
        currentSettingsProfiles[currentSettingsProfile] = currentSettings;
        currentSettingsProfiles = normalizeTopsterSettingsProfiles(currentSettingsProfiles);
        saveTopsterSettings(currentSettingsProfiles);
        saveCurrentTopster();

        if (!topsterSharedStoreAvailable || !topsterSharedStoreWritable) {
            status.textContent = 'Cannot save shared Topster settings: backend shared store is unavailable or you are not logged in as admin.';
            return;
        }

        if (saveSettingsButton) saveSettingsButton.disabled = true;
        const sourceKey = getTopsterStoreSourceKey();
        const publicPageName = getTopsterPublicPageName(sourceKey);
        const sourceDisplayName = getTopsterSourceDisplayName(sourceKey);
        setTopsterSettingsSaveStatus(status, `Saving ${sourceDisplayName} display settings...`);
        setTopsterLoadingProgress(92, `Publishing ${sourceDisplayName} settings, source text, and cover cache...`);

        const sharedPayload = {
            source: sourceKey,
            settings: currentSettingsProfiles,
            coverCache: getPublishableCoverCache()
        };
        setTopsterSettingsSaveStatus(status, 'Prepared Width/Height, Sidebar text, ownership filter, Font, and cover selections...');
        if (sourceKey === 'draft' || sourceKey === 'checklist' || sourceKey === 'rate_your_music') {
            if (!currentSourceText && !importedEntries.length) {
                status.textContent = sourceKey === 'checklist'
                    ? 'Select a checklist .txt file and press Build before saving the shared checklist Topster.'
                    : sourceKey === 'rate_your_music'
                        ? 'Select one or more saved RateYourMusic chart HTML files and press Build before publishing the chart snapshot.'
                        : 'Select a draft .txt file and press Build before saving the shared draft Topster.';
                if (saveSettingsButton) saveSettingsButton.disabled = false;
                return;
            }
            const publishSourceText = currentSourceText || topsterSharedSourceText || '';
            if (publishSourceText) {
                sharedPayload.sourceText = publishSourceText;
                sharedPayload.sourceName = currentSourceName
                    || topsterSharedSourceName
                    || (sourceKey === 'checklist'
                        ? 'checklist notepad file'
                        : sourceKey === 'rate_your_music'
                            ? 'RateYourMusic chart snapshot'
                            : 'draft notepad file');
                sharedPayload.sourceSignature = currentGridSignature || topsterSharedSourceSignature || simpleTextHash(publishSourceText);
            }
        }

        setTopsterSettingsSaveStatus(status, `Uploading shared ${sourceDisplayName} settings and cover selections...`);
        const ok = await saveTopsterSharedStoreNow(sharedPayload);

        if (saveSettingsButton) saveSettingsButton.disabled = false;

        if (ok) {
            topsterHasUnsavedPublishedChanges = false;
            const savedText = `Saved shared ${sourceDisplayName} settings${sourceKey === 'draft' || sourceKey === 'checklist' || sourceKey === 'rate_your_music' ? ', source snapshot,' : ''} and cover selections. ${publicPageName} will use these values.`;
            setTopsterSettingsSaveStatus(status, savedText);
            completeTopsterLoading(`Published ${sourceDisplayName}. ${publicPageName} is ready.`);
        } else {
            status.classList.remove('topster-status-progress-active', 'topster-status-progress-complete');
            status.textContent = 'Shared save failed. Check that the backend is deployed, the admin session is active, and /api/topster-shared-store is reachable.';
            failTopsterLoading(status.textContent);
        }
    }

    window.addEventListener('resize', () => syncAllTopsterSidebarHeights());

    if (coverPicker && coverPickerClose && coverPickerSearch && coverPickerLink && coverPickerLinkButton && coverPickerResults && coverPickerStatus) {
        coverPickerClose.addEventListener('click', closeCoverPicker);
        coverPickerSearch.addEventListener('click', loadCoverPickerResults);
        coverPickerLinkButton.addEventListener('click', useManualImageLink);
        if (coverPickerResetDefault) {
            coverPickerResetDefault.addEventListener('click', resetRollingStoneSingerImageToDefault);
        }
        coverPickerLink.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                useManualImageLink();
            }
        });
        coverPicker.addEventListener('click', event => {
            if (event.target === coverPicker) closeCoverPicker();
        });
    }

    if (topsterAutoLoad) {
        setTopsterLoadingProgress(18, `Reading ${topsterSourceLabel}...`);
        window.setTimeout(() => {
            buildTopsterFromGridFile({ force: false, source: 'autoload' });
        }, 0);
    } else if (importedEntries.length) {
        completeTopsterLoading('Loaded the saved Topster preview.');
    } else {
        completeTopsterLoading('Topster editor ready.');
    }

    function openCoverPicker(entry, entryIndex) {
        if (!coverPicker || !coverPickerTitle || !coverPickerResults || !coverPickerStatus) return;
        pickerEntryIndex = entryIndex;
        pickerLookupToken++;
        coverPicker.hidden = false;
        coverPickerTitle.textContent = isRollingStoneSingerTopsterSource()
            ? `Select artist image: ${entry.title}`
            : `Select cover: ${formatEntryName(entry)}`;
        coverPickerResults.innerHTML = '';
        coverPickerStatus.textContent = isRollingStoneSingerTopsterSource()
            ? 'Searching artist and associated-act image sources...'
            : 'Searching all available cover sources...';
        if (coverPickerLink) coverPickerLink.value = '';
        loadCoverPickerResults();
    }

    function closeCoverPicker() {
        pickerLookupToken++;
        pickerEntryIndex = null;
        if (coverPicker) coverPicker.hidden = true;
    }

    async function loadCoverPickerResults() {
        if (!coverPicker || coverPicker.hidden || pickerEntryIndex === null || !importedEntries[pickerEntryIndex]) return;
        if (!coverPickerResults || !coverPickerStatus) return;

        const entry = importedEntries[pickerEntryIndex];
        const token = ++pickerLookupToken;
        coverPickerResults.innerHTML = '';
        coverPickerStatus.textContent = `Searching all available sources for ${formatEntryName(entry)}...`;

        try {
            const candidates = isRollingStoneSingerTopsterSource()
                ? await resolveRollingStoneSingerImageCandidates(entry, getSourceConfig())
                : await resolveManualCoverCandidates(entry, 'all', getSourceConfig());
            if (token !== pickerLookupToken) return;
            renderCoverPickerCandidates(candidates);
            coverPickerStatus.textContent = candidates.length
                ? `Select one of ${candidates.length} ${isRollingStoneSingerTopsterSource() ? 'artist image' : 'cover'} result${candidates.length === 1 ? '' : 's'}, or paste an Image Link above.`
                : `No ${isRollingStoneSingerTopsterSource() ? 'artist image' : 'cover'} results were found. Paste an Image Link above to set one manually.`;
        } catch (error) {
            if (token !== pickerLookupToken) return;
            coverPickerStatus.textContent = 'Cover search failed. Paste an Image Link above to set the cover manually.';
        }
    }

    function renderCoverPickerCandidates(candidates) {
        if (!coverPickerResults) return;
        coverPickerResults.innerHTML = '';

        candidates.forEach((candidate) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'topster-cover-choice';
            button.title = `${candidate.source || 'Cover'}: ${formatCandidateName(candidate)}`;

            const img = document.createElement('img');
            img.src = candidate.imageSrc;
            img.alt = formatCandidateName(candidate) || 'Album cover option';
            img.loading = 'lazy';
            img.onerror = () => button.remove();

            const label = document.createElement('span');
            label.textContent = `${candidate.source || 'Source'}${candidate.title ? ` · ${candidate.title}` : ''}`;

            button.appendChild(img);
            button.appendChild(label);
            button.addEventListener('click', () => selectManualCover(candidate));
            coverPickerResults.appendChild(button);
        });
    }

    function useManualImageLink() {
        if (pickerEntryIndex === null || !importedEntries[pickerEntryIndex] || !coverPickerLink || !coverPickerStatus) return;
        const entry = importedEntries[pickerEntryIndex];
        const imageSrc = coverPickerLink.value.trim();

        if (!isValidImageUrl(imageSrc)) {
            coverPickerStatus.textContent = 'Enter a valid http:// or https:// image link.';
            return;
        }

        selectManualCover({
            title: entry.title,
            artist: entry.artist || '',
            imageSrc,
            href: imageSrc,
            source: 'Image Link',
            score: 1
        });
    }

    function resetRollingStoneSingerImageToDefault() {
        if (!isRollingStoneSingerTopsterSource() || pickerEntryIndex === null || !importedEntries[pickerEntryIndex]) return;
        const entry = importedEntries[pickerEntryIndex];
        const defaultCover = getRollingStoneSingerDefaultCover(entry);
        if (!defaultCover || !defaultCover.imageSrc) return;

        entry.cover = defaultCover;
        entry.status = 'found';
        entry.manuallySelectedCover = false;
        setCachedCover(buildCoverCacheKey(entry), defaultCover);
        safeMarkTopsterPublishDirty();

        if (!refreshRenderedTopsterTile(pickerEntryIndex)) {
            renderTopster(importedEntries, 0, { scroll: false });
        }
        closeCoverPicker();
        scheduleCurrentTopsterSave();
        status.textContent = `Reset ${entry.title} to the default local artist image. Press Save Settings to publish it to ${getTopsterPublicPageName()}.`;
    }

    async function selectManualCover(candidate) {
        if (pickerEntryIndex === null || !importedEntries[pickerEntryIndex] || !candidate || !candidate.imageSrc) return;
        const entry = importedEntries[pickerEntryIndex];
        const selectedCover = {
            // A manual choice belongs to this exact Topster entry even if a source
            // describes the same artwork with a compilation/alias artist credit.
            title: entry.title || candidate.title || '',
            artist: entry.artist || candidate.artist || '',
            imageSrc: candidate.imageSrc,
            href: candidate.href || '',
            source: candidate.source || 'Manual',
            selectedManually: true
        };

        entry.cover = selectedCover;
        entry.status = 'found';
        entry.manuallySelectedCover = true;
        setCachedCover(buildCoverCacheKey(entry), selectedCover);
        safeMarkTopsterPublishDirty();

        // Replace only the affected tile instead of rebuilding every page. This
        // makes a manual selection visibly apply immediately even on ~2,000-entry
        // Topsters. Large localStorage serialization is also deferred separately.
        if (!refreshRenderedTopsterTile(pickerEntryIndex)) {
            renderTopster(importedEntries, 0, { scroll: false });
        }
        closeCoverPicker();
        scheduleCurrentTopsterSave();

        status.textContent = topsterEditorPage
            ? `Updated local cover for ${formatEntryName(entry)}. Press Save Settings to publish it to the ${getTopsterPublicPageName()}.`
            : `Updated cover for ${formatEntryName(entry)}.`;
    }

    async function buildTopsterFromGridFile({ force, source, settingsApplied = false }) {
        activeLookupToken++;
        const token = activeLookupToken;

        if (stopButton) stopButton.disabled = true;
        buildButton.disabled = true;
        refreshButton.disabled = true;
        status.textContent = `Reading ${topsterSourceLabel}...`;
        setTopsterLoadingProgress(18, status.textContent);

        try {
            const loaded = await loadGridTextFile();
            setTopsterLoadingProgress(25, `Read ${loaded.source || topsterSourceLabel}. Parsing album entries...`);
            if (token !== activeLookupToken) return;

            if (!force && importedEntries.length && currentGridSignature && loaded.signature === currentGridSignature) {
                status.textContent = settingsApplied
                    ? `Applied the pending display settings. ${topsterSourceLabel} has not changed.`
                    : `${topsterSourceLabel} has not changed. Current Topsters grid was kept.`;
                completeTopsterLoading(status.textContent);
                buildButton.disabled = false;
                refreshButton.disabled = false;
                return;
            }

            const prelookupOnly = topsterEditorPage
                && source === 'build'
                && sourceConfig.kind !== 'rate-your-music-chart'
                && !String(sourceConfig.kind || '').startsWith('rolling-stone-greatest-singers-of-all-time-')
                && !topsterPrelookupIsComplete(loaded.signature);

            currentSourceText = loaded.text || '';
            currentSourceName = loaded.source || topsterSourceLabel;
            if (sourceConfig.kind === 'rate-your-music-chart') {
                renderRateYourMusicSnapshotSummary(currentSourceText);
            }
            await buildTopsterFromText(loaded.text, loaded.signature, source, { prelookupOnly });
        } catch (error) {
            if (token !== activeLookupToken) return;
            status.textContent = error && error.message ? error.message : `Could not read ${topsterSourceLabel}.`;
            failTopsterLoading(status.textContent);
            buildButton.disabled = false;
            refreshButton.disabled = false;
        }
    }

    async function buildTopsterFromText(text, signature, source, options = {}) {
        setTopsterLoadingProgress(30, `Parsing album entries from ${topsterSourceLabel}...`);
        const parsed = parseAlbumText(text);
        if (sourceConfig.kind === 'rate-your-music-chart') {
            const metadata = parseRateYourMusicMetadata(text);
            const releaseLinks = metadata && Array.isArray(metadata.releaseLinks) ? metadata.releaseLinks : [];
            parsed.forEach((entry, index) => {
                entry.releaseHref = typeof releaseLinks[index] === 'string' ? releaseLinks[index] : '';
            });
        }

        if (parsed.length === 0) {
            status.textContent = `${topsterSourceLabel} did not contain any album lines.`;
            failTopsterLoading(status.textContent);
            output.hidden = true;
            buildButton.disabled = false;
            refreshButton.disabled = false;
            return;
        }

        const token = activeLookupToken;
        currentGridSignature = signature || simpleTextHash(text);
        const prelookupOnly = Boolean(options.prelookupOnly);

        importedEntries = parsed.map((entry, index) => {
            const cachedCover = prelookupOnly ? null : (isRateYourMusicTopsterSource() ? getPreferredRateYourMusicCover(entry) : getPreferredCachedCover(entry));
            return {
                ...entry,
                originalIndex: index + 1,
                cover: cachedCover,
                status: cachedCover ? 'found' : 'pending'
            };
        });

        const selectedStart = populateRangeSelect(importedEntries.length, 0);
        setTopsterLoadingProgress(36, `Prepared ${importedEntries.length} album entries. Building the Topster layout...`);
        renderTopster(importedEntries, selectedStart, { scroll: true });
        saveCurrentTopster();

        await maybeLoadLocalIndex();
        if (token !== activeLookupToken) return;

        if (prelookupOnly) {
            status.textContent = `First Build after a ${topsterSourceLabel} update: preloading cover cache for ${importedEntries.length} album line${importedEntries.length === 1 ? '' : 's'} without displaying cover images...`;
            await preloadCoverCacheWithoutDisplaying(token, currentGridSignature);
            return;
        }

        const actionText = source === 'refresh' ? 'Refreshed' : 'Built';
        if (isRateYourMusicTopsterSource()) {
            importedEntries.forEach(entry => {
                entry.status = entry.cover && entry.cover.imageSrc ? 'found' : 'missing';
            });
            renderTopster(importedEntries, selectedStart, { scroll: false });
            saveCurrentTopster();
            if (stopButton) stopButton.disabled = true;
            buildButton.disabled = false;
            refreshButton.disabled = false;

            const foundCount = importedEntries.filter(entry => entry.status === 'found').length;
            const missingCount = importedEntries.length - foundCount;
            const completionText = `${actionText} all ${importedEntries.length} RateYourMusic release${importedEntries.length === 1 ? '' : 's'}. Using ${foundCount} RYM/manual cover${foundCount === 1 ? '' : 's'} directly from the supplied snapshot/cache and missing ${missingCount}. No automatic external cover lookup was performed.${topsterEditorPage ? ' Click any release to choose an alternate cover manually, then press Save Settings to publish.' : ''}`;
            setBuildCompletionStatus(completionText);
            completeTopsterLoading(completionText);
            return;
        }

        status.textContent = `${actionText} ${importedEntries.length} album line${importedEntries.length === 1 ? '' : 's'} from ${topsterSourceLabel}. Loading cached covers and looking up any missing covers...`;
        resolveVisibleRange(selectedStart);
    }

    function loadSavedTopster() {
        const saved = loadSavedTopsterState();
        if (!saved || !Array.isArray(saved.entries) || !saved.entries.length) {
            setSingleRangeOption();
            return;
        }

        if (saved.settings) {
            currentSettings = normalizeTopsterSettings(saved.settings);
            setSettingsControls(currentSettings);
            applyTopsterSettings(currentSettings);
        }

        importedEntries = saved.entries.map((entry, index) => {
            const normalizedEntry = {
                ...entry,
                originalIndex: entry.originalIndex || index + 1,
                artist: cleanAlbumTitle(entry.artist || ''),
                title: cleanAlbumTitle(entry.title || ''),
                status: entry.status || (entry.cover ? 'found' : 'pending')
            };
            if (normalizedEntry.cover && normalizedEntry.cover.imageSrc) {
                setCachedCover(buildCoverCacheKey(normalizedEntry), normalizedEntry.cover);
            }
            return normalizedEntry;
        });
        currentGridSignature = saved.signature || '';
        currentSourceText = typeof saved.sourceText === 'string' ? saved.sourceText : '';
        currentSourceName = typeof saved.sourceName === 'string' ? saved.sourceName : '';
        const selectedStart = populateRangeSelect(importedEntries.length, typeof saved.rangeStart === 'number' ? saved.rangeStart : 0);
        renderTopster(importedEntries, selectedStart, { scroll: false });
        status.textContent = '';
    }

    function saveCurrentTopster() {
        if (!importedEntries.length) return;

        const payload = {
            savedAt: new Date().toISOString(),
            signature: currentGridSignature,
            sourceText: currentSourceText,
            sourceName: currentSourceName,
            rangeStart: 0,
            settings: currentSettings,
            entries: importedEntries
        };

        try {
            localStorage.setItem(getTopsterStateKey(), JSON.stringify(payload));
        } catch (error) {
            // Browser storage can fill up. Rendering should continue even if state cannot be saved.
        }
    }

    let currentTopsterSaveTimer = null;
    let currentTopsterSaveIdleHandle = null;
    function scheduleCurrentTopsterSave(delayMs = 650) {
        window.clearTimeout(currentTopsterSaveTimer);
        if (currentTopsterSaveIdleHandle !== null && typeof window.cancelIdleCallback === 'function') {
            window.cancelIdleCallback(currentTopsterSaveIdleHandle);
            currentTopsterSaveIdleHandle = null;
        }
        currentTopsterSaveTimer = window.setTimeout(() => {
            currentTopsterSaveTimer = null;
            const persist = () => {
                currentTopsterSaveIdleHandle = null;
                saveCurrentTopster();
            };
            if (typeof window.requestIdleCallback === 'function') {
                currentTopsterSaveIdleHandle = window.requestIdleCallback(persist, { timeout: 3000 });
            } else {
                window.setTimeout(persist, 0);
            }
        }, Math.max(0, Number(delayMs) || 0));
    }

    async function maybeLoadLocalIndex() {
        const config = getSourceConfig();
        if (!config.useLocalIndex || localIndexLoaded) return;

        try {
            status.textContent = 'Loading local index.html thumbnail catalog...';
            const indexUrl = new URL('index.html', window.location.href).href;
            const fetchedCards = await loadAlbumCardsFromIndex(indexUrl);
            albumCatalog = buildAlbumCatalog(fetchedCards, indexUrl);
            localIndexLoaded = true;
        } catch (error) {
            status.textContent = 'Could not load index.html for local thumbnail fallback. External cover lookup will continue.';
            albumCatalog = buildAlbumCatalog([], window.location.href);
            localIndexLoaded = true;
        }
    }

    async function preloadCoverCacheWithoutDisplaying(token, signature) {
        if (!importedEntries.length) return;

        const config = getSourceConfig();
        const total = importedEntries.length;
        let nextIndex = 0;
        let processedCount = 0;
        let foundCount = 0;
        let missedCount = 0;

        if (stopButton) stopButton.disabled = false;
        buildButton.disabled = true;
        refreshButton.disabled = true;

        const updatePrelookupStatus = () => {
            status.textContent = `Preloading cover cache ${processedCount} of ${total}. Found/cached ${foundCount} cover${foundCount === 1 ? '' : 's'} and missed ${missedCount}. Images will load after pressing Build again.`;
            const progress = total ? 38 + ((processedCount / total) * 54) : 38;
            setTopsterLoadingProgress(progress, status.textContent);
        };

        const workerCount = Math.min(TOPSTER_PRELOOKUP_CONCURRENCY, total);

        async function runWorker() {
            while (token === activeLookupToken) {
                const index = nextIndex++;
                if (index >= total) return;

                const entry = importedEntries[index];
                if (!entry) {
                    processedCount++;
                    continue;
                }

                try {
                    const cached = getPreferredCachedCover(entry) || getExactCachedCoverForEntry(entry);
                    if (cached && cached.imageSrc) {
                        foundCount++;
                        entry.status = 'pending';
                    } else {
                        const cover = await resolveAlbumCover(entry, albumCatalog, config);
                        if (token !== activeLookupToken) return;

                        if (cover && cover.imageSrc) {
                            foundCount++;
                            entry.status = 'pending';
                        } else {
                            missedCount++;
                            entry.status = 'missing';
                        }
                    }
                } catch (error) {
                    if (token !== activeLookupToken) return;
                    missedCount++;
                    entry.status = 'missing';
                }

                processedCount++;
                if (processedCount === total || processedCount % 5 === 0) {
                    updatePrelookupStatus();
                    saveCurrentTopster();
                    await delay(0);
                }
            }
        }

        updatePrelookupStatus();
        await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

        if (token !== activeLookupToken) return;

        saveTopsterPrelookupState(signature, {
            lineCount: total,
            foundCount,
            missedCount
        });

        saveCurrentTopster();
        if (stopButton) stopButton.disabled = true;
        buildButton.disabled = false;
        refreshButton.disabled = false;
        const completionText = `Finished all ${total} album line${total === 1 ? '' : 's'}. Found/cached ${foundCount} cover${foundCount === 1 ? '' : 's'} and missed ${missedCount}. Press Build again to load the cached covers into the Topsters, then Save Settings to publish the updated cache.`;
        setBuildCompletionStatus(completionText);
        completeTopsterLoading(completionText);
    }

    async function resolveVisibleRange(startIndex = 0) {
        if (!importedEntries.length) return;

        if (isRateYourMusicTopsterSource()) {
            importedEntries.forEach(entry => {
                if (!entry) return;
                entry.cover = getPreferredRateYourMusicCover(entry);
                entry.status = entry.cover && entry.cover.imageSrc ? 'found' : 'missing';
            });
            renderTopster(importedEntries, startIndex, { scroll: false });
            saveCurrentTopster();
            if (stopButton) stopButton.disabled = true;
            buildButton.disabled = false;
            refreshButton.disabled = false;
            const foundCount = importedEntries.filter(entry => entry.status === 'found').length;
            const missingCount = importedEntries.length - foundCount;
            const completionText = `Finished all ${importedEntries.length} RateYourMusic release${importedEntries.length === 1 ? '' : 's'}. Using ${foundCount} RYM/manual cover${foundCount === 1 ? '' : 's'} and missing ${missingCount}. No automatic external cover lookup was performed.${topsterEditorPage ? ' Click a release to choose an alternate cover manually, then press Save Settings to publish.' : ''}`;
            setBuildCompletionStatus(completionText);
            completeTopsterLoading(completionText);
            return;
        }

        const token = ++activeLookupToken;
        const config = getSourceConfig();
        let resolvedCount = importedEntries.filter(entry => entry.cover).length;

        if (stopButton) stopButton.disabled = false;
        buildButton.disabled = true;
        refreshButton.disabled = true;

        for (let i = 0; i < importedEntries.length; i++) {
            if (token !== activeLookupToken) return;
            const entry = importedEntries[i];
            if (!entry || entry.cover || entry.status === 'missing') continue;

            entry.status = 'loading';
            renderTopster(importedEntries, 0, { scroll: false });
            saveCurrentTopster();
            status.textContent = `Looking up cover ${i + 1} of ${importedEntries.length}: ${formatEntryName(entry)}`;
            const lookupProgress = importedEntries.length
                ? 38 + (((i + 1) / importedEntries.length) * 58)
                : 38;
            setTopsterLoadingProgress(lookupProgress, status.textContent);

            try {
                const cover = await resolveAlbumCover(entry, albumCatalog, config);
                if (token !== activeLookupToken) return;

                if (entry.cover && entry.cover.selectedManually) {
                    entry.status = 'found';
                } else if (cover && cover.imageSrc) {
                    entry.cover = cover;
                    entry.status = 'found';
                    setCachedCover(buildCoverCacheKey(entry), cover);
                    resolvedCount++;
                } else {
                    entry.status = 'missing';
                }
            } catch (error) {
                if (token !== activeLookupToken) return;
                entry.status = 'missing';
            }

            renderTopster(importedEntries, 0, { scroll: false });
            saveCurrentTopster();
        }

        if (token === activeLookupToken) {
            if (stopButton) stopButton.disabled = true;
            buildButton.disabled = false;
            refreshButton.disabled = false;
            const missingCount = importedEntries.filter(entry => entry.status === 'missing').length;
            saveCurrentTopster();
            const completionText = `Finished all ${importedEntries.length} album line${importedEntries.length === 1 ? '' : 's'}. Found/cached ${resolvedCount} cover${resolvedCount === 1 ? '' : 's'} and missed ${missingCount}.${topsterEditorPage ? ' Press Save Settings to publish the updated source/settings/cache.' : ''}`;
            setBuildCompletionStatus(completionText);
            completeTopsterLoading(completionText);
        }
    }

    function populateRangeSelect(total, preferredStart = 0) {
        rangeSelect.innerHTML = '';
        const option = document.createElement('option');
        option.value = '0';
        option.textContent = `All ${total || 0}`;
        rangeSelect.appendChild(option);
        rangeSelect.value = '0';
        rangeSelect.disabled = true;
        return 0;
    }

    function setSingleRangeOption() {
        rangeSelect.innerHTML = '<option value="0">All</option>';
        rangeSelect.value = '0';
        rangeSelect.disabled = true;
    }

    function renderTopster(entries, startIndex, options = {}) {
        const effectiveSettings = getEffectiveTopsterSettings(currentSettings);
        const pageSize = getTopsterPageSize(effectiveSettings);
        const totalPages = Math.max(1, Math.ceil(entries.length / pageSize));

        applyTopsterSettings(currentSettings);
        pagesContainer.innerHTML = '';

        for (let pageIndex = 0; pageIndex < totalPages; pageIndex++) {
            const start = pageIndex * pageSize;
            const end = Math.min(start + pageSize, entries.length);
            const pageEntries = entries.slice(start, end);
            const page = createTopsterPage(pageEntries, start, end, pageIndex, pageSize, effectiveSettings);
            pagesContainer.appendChild(page);
        }

        output.hidden = false;
        updateTopsterResponsiveMetrics();
        syncAllTopsterSidebarHeights();
        window.requestAnimationFrame(() => {
            updateTopsterResponsiveMetrics();
            syncAllTopsterSidebarHeights();
        });

        if (options.scroll) {
            output.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }

    function refreshRenderedTopsterTile(absoluteIndex) {
        const entry = importedEntries[absoluteIndex];
        if (!entry) return false;
        const existingTiles = pagesContainer.querySelectorAll(`.topster-tile[data-topster-entry-index="${absoluteIndex}"]`);
        if (!existingTiles.length) return false;

        const settings = getEffectiveTopsterSettings(currentSettings);
        existingTiles.forEach(existingTile => {
            const selectableHandler = topsterReadOnly ? null : () => openCoverPicker(entry, absoluteIndex);
            const publicRetryHandler = topsterReadOnly && isPublicAlbumCoverRetrySource()
                ? () => retryPublicAlbumCover(entry, absoluteIndex)
                : null;
            const loadErrorHandler = !isRollingStoneSingerTopsterSource() && !isRateYourMusicTopsterSource()
                ? failedImageSrc => recoverBrokenAlbumCover(entry, absoluteIndex, failedImageSrc)
                : null;
            const replacement = createTopsterTile(
                entry,
                absoluteIndex + 1,
                selectableHandler,
                settings.coverOverlay,
                settings.excludeOwnedReleases,
                publicRetryHandler,
                loadErrorHandler
            );
            existingTile.replaceWith(replacement);
        });
        return true;
    }

    function updateOwnedReleaseVisualStatesInPlace(enabled) {
        const tiles = pagesContainer.querySelectorAll('.topster-tile[data-topster-entry-index]');
        tiles.forEach(tile => {
            const index = Number(tile.dataset.topsterEntryIndex);
            if (!Number.isInteger(index) || index < 0 || !importedEntries[index]) return;
            applyOwnedReleaseVisualState(tile, importedEntries[index], enabled);
        });
    }

    async function recoverBrokenAlbumCover(entry, absoluteIndex, failedImageSrc) {
        if (!entry || entry.cover && entry.cover.selectedManually) return;
        if (isRateYourMusicTopsterSource()) {
            entry.status = 'missing';
            refreshRenderedTopsterTile(absoluteIndex);
            return;
        }

        let state = brokenCoverRecoveryState.get(absoluteIndex);
        if (!state) {
            state = { failedUrls: new Set(), attempts: 0, running: false };
            brokenCoverRecoveryState.set(absoluteIndex, state);
        }
        const failedKey = normalizeImageUrl(failedImageSrc);
        if (failedKey) state.failedUrls.add(failedKey);
        if (state.running || state.attempts >= 4) return;

        state.running = true;
        state.attempts += 1;
        invalidateCachedCover(entry, failedImageSrc);
        entry.cover = null;
        entry.status = 'loading';
        refreshRenderedTopsterTile(absoluteIndex);

        try {
            await maybeLoadLocalIndex();
            const retryConfig = {
                ...getSourceConfig(),
                useCache: false,
                excludeImageUrls: Array.from(state.failedUrls)
            };
            const freshCover = await resolveAlbumCover(entry, albumCatalog, retryConfig);
            if (freshCover && freshCover.imageSrc) {
                entry.cover = freshCover;
                entry.status = 'found';
                setCachedCover(buildCoverCacheKey(entry), freshCover);
            } else {
                entry.status = 'missing';
            }
        } catch (error) {
            entry.status = 'missing';
        } finally {
            state.running = false;
            refreshRenderedTopsterTile(absoluteIndex);
            window.setTimeout(saveCurrentTopster, 0);
        }
    }

    async function retryPublicAlbumCover(entry, absoluteIndex) {
        if (!entry || !isPublicAlbumCoverRetrySource() || retryingPublicCoverIndexes.has(absoluteIndex)) return;
        retryingPublicCoverIndexes.add(absoluteIndex);

        const previousCover = entry.cover && entry.cover.imageSrc ? { ...entry.cover } : null;
        entry.status = 'loading';
        entry.cover = null;
        renderTopster(importedEntries, 0, { scroll: false });

        try {
            // First retry the exact published image with a cache-busting request. This
            // handles intermittent CDN/host failures without changing the chosen cover.
            if (previousCover && await probeTopsterImage(previousCover.imageSrc)) {
                entry.cover = previousCover;
                entry.status = 'found';
            } else {
                // If the published image is genuinely unavailable, do a fresh cover
                // lookup but deliberately skip the saved cache so we do not immediately
                // return the same broken URL again.
                await maybeLoadLocalIndex();
                const retryConfig = { ...getSourceConfig(), useCache: false };
                const freshCover = await resolveAlbumCover(entry, albumCatalog, retryConfig);
                if (freshCover && freshCover.imageSrc) {
                    entry.cover = freshCover;
                    entry.status = 'found';
                } else {
                    entry.status = 'missing';
                }
            }
        } catch (error) {
            entry.status = 'missing';
        } finally {
            retryingPublicCoverIndexes.delete(absoluteIndex);
            renderTopster(importedEntries, 0, { scroll: false });
            syncAllTopsterSidebarHeights();
            window.requestAnimationFrame(syncAllTopsterSidebarHeights);
        }
    }

    function createTopsterPage(pageEntries, start, end, pageIndex, pageSize, settings = getEffectiveTopsterSettings(currentSettings)) {
        const page = document.createElement('section');
        page.className = 'topster-page';

        const layout = document.createElement('div');
        layout.className = 'topster-layout';
        if (settings.sidebarMode !== 'hidden') {
            const sidebarWidth = clampInteger(settings.sidebarWidth, 10, 50, 20);
            layout.style.gridTemplateColumns = `minmax(0, ${100 - sidebarWidth}fr) minmax(0, ${sidebarWidth}fr)`;
        }

        const chartWrap = document.createElement('div');
        chartWrap.className = 'topster-chart-wrap';

        const chart = document.createElement('div');
        chart.className = 'topster-chart-grid';
        chart.setAttribute('aria-label', `${settings.width} by ${settings.height} album cover grid`);
        chart.style.setProperty('--topster-columns', String(settings.width));
        chart.style.setProperty('--topster-rows', String(settings.height));
        chart.style.setProperty('--topster-cover-size', `${getTopsterCoverSize(settings)}px`);
        chart.style.setProperty('--topster-radius', `${settings.roundCorners}px`);
        chart.style.setProperty('--topster-album-gap', `${settings.albumGap}px`);

        for (let i = 0; i < pageSize; i++) {
            const entry = pageEntries[i];
            const absoluteIndex = start + i;
            chart.appendChild(createTopsterTile(entry, absoluteIndex + 1, topsterReadOnly ? null : () => {
                if (entry) openCoverPicker(entry, absoluteIndex);
            }, settings.coverOverlay, settings.excludeOwnedReleases,
            topsterReadOnly && isPublicAlbumCoverRetrySource() && entry
                ? () => retryPublicAlbumCover(entry, absoluteIndex)
                : null,
            entry && !isRollingStoneSingerTopsterSource() && !isRateYourMusicTopsterSource()
                ? failedImageSrc => recoverBrokenAlbumCover(entry, absoluteIndex, failedImageSrc)
                : null));
        }

        chartWrap.appendChild(chart);
        layout.appendChild(chartWrap);

        if (settings.sidebarMode !== 'hidden') {
            const pageList = document.createElement('div');
            pageList.className = 'topster-list';
            pageList.style.setProperty('--topster-rows', String(settings.height));
            pageList.style.setProperty('--topster-album-gap', `${settings.albumGap}px`);

            for (let rowIndex = 0; rowIndex < settings.height; rowIndex++) {
                const rowList = document.createElement('ol');
                rowList.className = 'topster-list-row';
                rowList.start = start + (rowIndex * settings.width) + 1;

                for (let columnIndex = 0; columnIndex < settings.width; columnIndex++) {
                    const offset = (rowIndex * settings.width) + columnIndex;
                    const entry = pageEntries[offset];
                    if (!entry) continue;

                    const li = document.createElement('li');
                    const itemIndex = start + offset + 1;
                    const indexSpan = document.createElement('span');
                    indexSpan.className = 'topster-list-index';
                    indexSpan.textContent = `${itemIndex}.`;

                    const textSpan = document.createElement('span');
                    textSpan.className = 'topster-list-text';
                    textSpan.textContent = formatSidebarEntry(entry, settings.sidebarMode);

                    if (entry.status === 'loading') {
                        li.classList.add('topster-loading');
                        textSpan.textContent += ' [looking up cover]';
                    } else if (entry.status === 'missing') {
                        li.classList.add('topster-missing');
                        textSpan.textContent += ' [no cover found]';
                    }

                    li.value = itemIndex;
                    li.appendChild(indexSpan);
                    li.appendChild(textSpan);
                    rowList.appendChild(li);
                }

                pageList.appendChild(rowList);
            }

            layout.appendChild(pageList);
        }

        page.appendChild(layout);
        return page;
    }

    function entriesRangeTitle(start, end) {
        if (end <= start) return `Empty (${currentSettings.width}x${currentSettings.height})`;
        return `${start + 1}-${end} (${currentSettings.width}x${currentSettings.height})`;
    }

    function syncAllTopsterSidebarHeights() {
        updateTopsterResponsiveMetrics();
        const effectiveSettings = getEffectiveTopsterSettings(currentSettings);
        if (effectiveSettings.sidebarMode === 'hidden') return;

        const pages = pagesContainer.querySelectorAll('.topster-page');
        pages.forEach(page => {
            const grid = page.querySelector('.topster-chart-grid');
            const pageList = page.querySelector('.topster-list');
            if (!grid || !pageList) return;

            const height = Math.max(1, Math.round(grid.getBoundingClientRect().height));
            pageList.style.height = `${height}px`;
            fitSidebarText(pageList, height, effectiveSettings);
        });
    }

    function fitSidebarText(pageList, maxHeight, settings = getEffectiveTopsterSettings(currentSettings)) {
        const computed = getComputedStyle(pageList);
        const configuredBase = Number.parseFloat(getComputedStyle(output).getPropertyValue('--topster-list-font-size')) || 12;
        const rowCount = Math.max(1, settings.height);
        const gap = Number.parseFloat(computed.rowGap || computed.gap || '0') || 0;
        const paddingTop = Number.parseFloat(computed.paddingTop || '0') || 0;
        const paddingBottom = Number.parseFloat(computed.paddingBottom || '0') || 0;
        const usableHeight = Math.max(1, maxHeight - paddingTop - paddingBottom - (gap * Math.max(0, rowCount - 1)));
        const baseSize = clampNumber(configuredBase, 3.2, 36);

        pageList.style.fontSize = `${baseSize.toFixed(2)}px`;
        pageList.style.lineHeight = '1.12';

        const fits = () => {
            if (pageList.scrollHeight > maxHeight + 1) return false;
            const rows = pageList.querySelectorAll('.topster-list-row');
            for (const row of rows) {
                if (row.scrollHeight > row.clientHeight + 1) return false;
            }
            return true;
        };

        let size = baseSize;
        while (size > 3.2 && !fits()) {
            size -= 0.2;
            pageList.style.fontSize = `${size.toFixed(2)}px`;
        }
    }

    function readSettingsControls() {
        return {
            width: Number(widthSelect.value),
            height: Number(heightSelect.value),
            sidebarMode: sidebarModeSelect.value,
            sidebarWidth: sidebarWidthSelect ? Number(sidebarWidthSelect.value) : (currentSettings.sidebarWidth || 20),
            sidebarTextScale: sidebarTextSizeInput ? Number(sidebarTextSizeInput.value) : (currentSettings.sidebarTextScale || 100),
            roundCorners: Number(roundCornersSelect.value),
            albumGap: Number(albumGapSelect.value),
            font: fontSelect.value,
            coverOverlay: coverOverlaySelect ? coverOverlaySelect.value : (currentSettings.coverOverlay || 'none'),
            excludeOwnedReleases: excludeOwnedSelect
                ? excludeOwnedSelect.value === 'yes'
                : Boolean(currentSettings.excludeOwnedReleases)
        };
    }

    function setSettingsControls(settings) {
        widthSelect.value = String(settings.width);
        heightSelect.value = String(settings.height);
        sidebarModeSelect.value = settings.sidebarMode;
        if (sidebarWidthSelect) sidebarWidthSelect.value = String(settings.sidebarWidth);
        if (sidebarTextSizeInput) sidebarTextSizeInput.value = String(settings.sidebarTextScale);
        roundCornersSelect.value = String(settings.roundCorners);
        albumGapSelect.value = String(settings.albumGap);
        fontSelect.value = settings.font;
        if (coverOverlaySelect) coverOverlaySelect.value = settings.coverOverlay || 'none';
        if (excludeOwnedSelect) excludeOwnedSelect.value = settings.excludeOwnedReleases ? 'yes' : 'no';
        updateSettingsValueLabels(settings);
    }

    function setSettingsValueLabel(element, value, suffix = '') {
        if (!element) return;
        if (element.tagName === 'INPUT') {
            element.value = String(value);
        } else {
            element.textContent = `${value}${suffix}`;
        }
    }

    function updateSettingsValueLabels(settings) {
        setSettingsValueLabel(widthValue, settings.width);
        setSettingsValueLabel(heightValue, settings.height);
        setSettingsValueLabel(sidebarWidthValue, settings.sidebarWidth, '%');
        setSettingsValueLabel(sidebarTextSizeValue, settings.sidebarTextScale, '%');
        setSettingsValueLabel(albumGapValue, settings.albumGap, ' px');
    }

    function applyTopsterSettings(settings) {
        currentSettings = normalizeTopsterSettings(settings);
        const effectiveSettings = getEffectiveTopsterSettings(currentSettings);
        const coverSize = getTopsterCoverSize(effectiveSettings);
        const fontFamily = getFontFamily(effectiveSettings.font);
        const listFontSize = getTopsterListFontSize(effectiveSettings, coverSize);

        output.style.setProperty('--topster-cover-size', `${coverSize}px`);
        output.style.setProperty('--topster-radius', `${effectiveSettings.roundCorners}px`);
        output.style.setProperty('--topster-album-gap', `${effectiveSettings.albumGap}px`);
        output.style.setProperty('--topster-list-font-size', `${listFontSize}px`);
        output.style.setProperty('--topster-columns', String(effectiveSettings.width));
        const sidebarWidth = clampInteger(effectiveSettings.sidebarWidth, 10, 50, 20);
        output.querySelectorAll('.topster-layout').forEach(layout => {
            if (effectiveSettings.sidebarMode !== 'hidden') {
                layout.style.gridTemplateColumns = `minmax(0, ${100 - sidebarWidth}fr) minmax(0, ${sidebarWidth}fr)`;
            } else {
                layout.style.removeProperty('grid-template-columns');
            }
        });
        output.style.setProperty('--topster-rows', String(effectiveSettings.height));
        output.style.fontFamily = fontFamily;
        output.classList.toggle('topster-sidebar-hidden', effectiveSettings.sidebarMode === 'hidden');
        output.classList.toggle('topster-cover-overlay-enabled', effectiveSettings.coverOverlay !== 'none');
        updateTopsterResponsiveMetrics();
        buildButton.textContent = 'Build';
    }

}


async function loadTopsterSharedStore(options = {}) {
    topsterSharedStoreLoaded = true;
    topsterSharedStoreAvailable = false;
    topsterSharedStoreWritable = false;

    const timeoutMs = Math.max(1000, Number(options.timeoutMs) || TOPSTER_BACKEND_RETRY_TIMEOUT_MS);
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = controller ? window.setTimeout(() => controller.abort(), timeoutMs) : null;

    try {
        const response = await fetch(buildTopsterSharedStoreUrl(), {
            cache: 'no-store',
            credentials: 'include',
            signal: controller ? controller.signal : undefined
        });

        if (!response.ok) return false;

        const payload = await response.json();
        const requestedSource = getTopsterStoreSourceKey();
        if (!payload || payload.ok !== true || payload.source !== requestedSource) {
            console.error('Topster shared-store source mismatch.', {
                requestedSource,
                returnedSource: payload && payload.source
            });
            return false;
        }

        topsterSharedStoreAvailable = true;
        topsterSharedStoreWritable = Boolean(payload.writable);
        topsterSharedCoverCache = payload.coverCache && typeof payload.coverCache === 'object' ? payload.coverCache : {};
        topsterSharedSettings = payload.settings && typeof payload.settings === 'object' ? payload.settings : null;
        topsterSharedSourceText = typeof payload.sourceText === 'string' ? payload.sourceText : '';
        topsterSharedSourceSignature = typeof payload.sourceSignature === 'string' ? payload.sourceSignature : '';
        topsterSharedSourceName = typeof payload.sourceName === 'string' ? payload.sourceName : '';
        if (isRateYourMusicTopsterSource()) renderRateYourMusicSnapshotSummary(topsterSharedSourceText);
        return true;
    } catch (error) {
        return false;
    } finally {
        if (timeoutId) window.clearTimeout(timeoutId);
    }
}

function shouldKeepWaitingForTopsterBackend() {
    if (typeof window === 'undefined' || !/^https?:$/i.test(window.location.protocol)) return false;

    // Production pages and pages with an explicitly configured API origin must
    // wait for the configured backend/shared store. Local file/development copies retain
    // the old immediate-fallback behavior when no backend origin is configured.
    return Boolean(getTopsterBackendOrigin());
}

async function waitForTopsterSharedStore() {
    let attempt = 0;

    while (true) {
        attempt += 1;
        const attemptText = attempt === 1
            ? 'Connecting to the backend for saved Topster settings and album art...'
            : `Backend connection attempt ${attempt}...`;
        setTopsterLoadingProgress(Math.min(12, 4 + attempt), attemptText);

        const connected = await loadTopsterSharedStore({
            timeoutMs: attempt === 1
                ? TOPSTER_BACKEND_INITIAL_TIMEOUT_MS
                : TOPSTER_BACKEND_RETRY_TIMEOUT_MS
        });
        if (connected) return true;

        if (!shouldKeepWaitingForTopsterBackend()) return false;

        const retryDelayMs = Math.min(
            TOPSTER_BACKEND_RETRY_MAX_DELAY_MS,
            TOPSTER_BACKEND_RETRY_BASE_DELAY_MS + ((attempt - 1) * 500)
        );
        const retrySeconds = Math.max(1, Math.ceil(retryDelayMs / 1000));
        setTopsterLoadingProgress(
            Math.min(12, 5 + attempt),
            `Waiting for the backend/shared store. Retrying in ${retrySeconds} second${retrySeconds === 1 ? '' : 's'}...`
        );
        await delay(retryDelayMs);
    }
}

function shouldUseTopsterSharedStore() {
    return topsterSharedStoreLoaded && topsterSharedStoreAvailable;
}

async function saveTopsterSharedStoreNow(payload) {
    if (!topsterSharedStoreAvailable || !topsterSharedStoreWritable) return false;

    try {
        const response = await fetch(buildTopsterSharedStoreUrl(), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(payload)
        });

        if (!response.ok) return false;
        const result = await response.json();
        const requestedSource = getTopsterStoreSourceKey();
        if (!result || result.ok !== true || result.source !== requestedSource) {
            console.error('Topster shared-save source mismatch.', {
                requestedSource,
                returnedSource: result && result.source
            });
            return false;
        }

        if (result.coverCache && typeof result.coverCache === 'object') {
            topsterSharedCoverCache = result.coverCache;
            if (isTopsterEditorPage()) {
                topsterEditorWorkingCoverCache = cloneCoverCache(result.coverCache);
                writeLocalTopsterCoverCache(topsterEditorWorkingCoverCache);
            }
        }
        if (result.settings && typeof result.settings === 'object') {
            topsterSharedSettings = result.settings;
        }
        if (typeof result.sourceText === 'string') {
            topsterSharedSourceText = result.sourceText;
        }
        if (typeof result.sourceSignature === 'string') {
            topsterSharedSourceSignature = result.sourceSignature;
        }
        if (typeof result.sourceName === 'string') {
            topsterSharedSourceName = result.sourceName;
        }
        if (isRateYourMusicTopsterSource()) renderRateYourMusicSnapshotSummary(topsterSharedSourceText);
        return true;
    } catch (error) {
        return false;
    }
}

function scheduleTopsterSharedCoverCacheSave() {
    if (!topsterSharedStoreAvailable || !topsterSharedStoreWritable) return;

    window.clearTimeout(topsterSharedSaveTimer);
    topsterSharedSaveTimer = window.setTimeout(() => {
        saveTopsterSharedStoreNow({ coverCache: topsterSharedCoverCache });
    }, 450);
}

async function flushTopsterSharedCoverCacheSave() {
    if (!topsterSharedStoreAvailable || !topsterSharedStoreWritable) return false;

    window.clearTimeout(topsterSharedSaveTimer);
    topsterSharedSaveTimer = null;
    return saveTopsterSharedStoreNow({ coverCache: topsterSharedCoverCache });
}

async function clearTopsterCoverCache() {
    topsterSharedCoverCache = {};
    topsterEditorWorkingCoverCache = {};
    clearTopsterPrelookupState();

    try {
        localStorage.removeItem(getTopsterCoverCacheStorageKey());
    } catch (error) {
        // Clearing cache is optional; rendering can continue.
    }

    if (topsterSharedStoreAvailable && topsterSharedStoreWritable) {
        try {
            const response = await fetch(buildTopsterSharedStoreUrl(), {
                method: 'DELETE',
                credentials: 'include'
            });
            if (response.ok) {
                const result = await response.json();
                if (result && result.ok === true) {
                    topsterHasUnsavedPublishedChanges = false;
                    return;
                }
            }
        } catch (error) {
            // Local cleanup already happened.
        }
    }

    try {
        localStorage.removeItem(TOPSTER_CACHE_KEY);
    } catch (error) {
        // Clearing cache is optional; rendering can continue.
    }
}


function loadTopsterSettings() {
    if (isTopsterEditorPage()) {
        try {
            const localSettings = JSON.parse(localStorage.getItem(getTopsterSettingsStorageKey()) || 'null');
            if (localSettings) return normalizeTopsterSettingsProfiles(localSettings);
        } catch (error) {
            // Fall back to the published backend settings below.
        }
    }

    if (shouldUseTopsterSharedStore() && topsterSharedSettings) {
        return normalizeTopsterSettingsProfiles(topsterSharedSettings);
    }

    // Public list pages should use only the backend-published settings for their source.
    // If the backend is unavailable, fall back to defaults instead of a visitor's old local settings.
    if (isTopsterReadOnlyPage()) {
        return normalizeTopsterSettingsProfiles({});
    }

    try {
        return normalizeTopsterSettingsProfiles(
            JSON.parse(localStorage.getItem(getTopsterSettingsStorageKey()) || 'null')
            || JSON.parse(localStorage.getItem(TOPSTER_SETTINGS_KEY) || 'null')
            || {}
        );
    } catch (error) {
        return normalizeTopsterSettingsProfiles({});
    }
}

function saveTopsterSettings(settings) {
    const normalizedProfiles = normalizeTopsterSettingsProfiles(settings);

    if (isTopsterEditorPage()) {
        try {
            localStorage.setItem(getTopsterSettingsStorageKey(), JSON.stringify(normalizedProfiles));
        } catch (error) {
            // Settings persistence is helpful but not required for rendering.
        }
        return;
    }

    if (shouldUseTopsterSharedStore()) {
        topsterSharedSettings = normalizedProfiles;
        return;
    }

    if (isTopsterReadOnlyPage()) {
        return;
    }

    try {
        localStorage.setItem(getTopsterSettingsStorageKey(), JSON.stringify(normalizedProfiles));
    } catch (error) {
        // Settings persistence is helpful but not required for rendering.
    }
}

function getAutomaticTopsterSettingsProfile() {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'desktop';
    return window.matchMedia('(max-width: 1180px), (hover: none) and (pointer: coarse)').matches ? 'mobile' : 'desktop';
}

function getInitialTopsterSettingsProfile(deviceProfileSelect, editorPage) {
    if (editorPage && deviceProfileSelect && deviceProfileSelect.value === 'mobile') return 'mobile';
    if (editorPage && deviceProfileSelect && deviceProfileSelect.value === 'desktop') return 'desktop';
    return editorPage ? 'desktop' : getAutomaticTopsterSettingsProfile();
}

function getTopsterSettingsProfileLabel(profile) {
    return profile === 'mobile' ? 'mobile/tablet' : 'desktop';
}

function normalizeTopsterSettingsProfiles(settings) {
    const raw = settings && typeof settings === 'object' ? settings : {};
    const looksLikeProfiles = raw.desktop && typeof raw.desktop === 'object' || raw.mobile && typeof raw.mobile === 'object';

    if (looksLikeProfiles) {
        const desktop = normalizeTopsterSettings(raw.desktop || raw.mobile || {});
        const mobile = normalizeTopsterSettings(raw.mobile || raw.desktop || {});
        return { desktop, mobile };
    }

    const base = normalizeTopsterSettings(raw);
    return {
        desktop: base,
        mobile: {
            ...base,
            sidebarMode: base.sidebarMode
        }
    };
}

function normalizeTopsterSettings(settings) {
    const allowedFonts = new Set(['Arial', 'Verdana', 'Helvetica Neue', 'Sans-serif', 'Monospace', 'Open Sans', 'Helvetica', 'Georgia', 'Tahoma', 'Calibri']);
    const allowedSidebarModes = new Set(['artist-title', 'title-only', 'hidden']);
    const allowedCoverOverlays = new Set(['none', 'index', 'year']);
    const raw = settings && typeof settings === 'object' ? settings : {};

    const normalized = {
        width: clampInteger(raw.width, 1, 25, 10),
        height: clampInteger(raw.height, 1, 10, 10),
        sidebarMode: allowedSidebarModes.has(raw.sidebarMode) ? raw.sidebarMode : 'artist-title',
        sidebarWidth: clampInteger(raw.sidebarWidth, 10, 50, 20),
        sidebarTextScale: clampInteger(raw.sidebarTextScale, 50, 200, 100),
        roundCorners: clampInteger(raw.roundCorners, 0, 24, 0),
        albumGap: clampInteger(raw.albumGap, 0, 100, 4),
        font: allowedFonts.has(raw.font) ? raw.font : 'Arial',
        coverOverlay: allowedCoverOverlays.has(raw.coverOverlay) ? raw.coverOverlay : 'none',
        excludeOwnedReleases: raw.excludeOwnedReleases === true || raw.excludeOwnedReleases === 'yes'
    };

    if (isChecklistTopsterSource()) normalized.coverOverlay = 'none';
    return normalized;
}

function clampInteger(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, Math.round(number)));
}

function clampNumber(value, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return min;
    return Math.min(max, Math.max(min, number));
}

function getTopsterPageSize(settings) {
    const normalized = normalizeTopsterSettings(settings);
    return normalized.width * normalized.height;
}

function getTopsterCoverSize(settings) {
    const normalized = normalizeTopsterSettings(settings);
    return Math.floor(TOPSTER_BASE_CANVAS_SIZE / Math.max(normalized.width, normalized.height));
}

function getTopsterListFontSize(settings, coverSize) {
    const normalized = normalizeTopsterSettings(settings);
    const widthBasedSize = coverSize / ((normalized.width * 0.52) + 3.8);
    const scaledSize = clampNumber(widthBasedSize, 4.2, 18) * (normalized.sidebarTextScale / 100);
    return Math.round(clampNumber(scaledSize, 3.2, 36) * 10) / 10;
}

function getFontFamily(font) {
    const fontMap = {
        'Arial': 'Arial, sans-serif',
        'Verdana': 'Verdana, Geneva, sans-serif',
        'Helvetica Neue': '"Helvetica Neue", Helvetica, Arial, sans-serif',
        'Sans-serif': 'sans-serif',
        'Monospace': 'Consolas, "Courier New", monospace',
        'Open Sans': '"Open Sans", Arial, sans-serif',
        'Helvetica': 'Helvetica, Arial, sans-serif',
        'Georgia': 'Georgia, serif',
        'Tahoma': 'Tahoma, Geneva, sans-serif',
        'Calibri': 'Calibri, Arial, sans-serif'
    };
    return fontMap[font] || fontMap.Arial;
}

function formatEntryName(entry) {
    if (!entry) return '';
    const artist = cleanAlbumTitle(entry.artist || '');
    const title = cleanAlbumTitle(entry.title || '');
    if (artist && title) return `${artist} - ${title}`;
    return title || artist;
}

function formatSidebarEntry(entry, mode) {
    if (!entry) return '';
    const title = cleanAlbumTitle(entry.title || '');
    const artist = cleanAlbumTitle(entry.artist || '');

    if (mode === 'title-only' || !artist) return title;
    return `${artist} - ${title}`;
}

function loadSavedTopsterState() {
    if (shouldUseTopsterSharedStore() && !isTopsterEditorPage()) {
        return null;
    }

    try {
        const primary = localStorage.getItem(getTopsterStateKey());
        if (primary) return JSON.parse(primary);

        // Backward-compatible fallback for grid.html states saved before ranked_grid.html existed.
        if (getTopsterDataSourceConfig().kind === 'grid-file') {
            const legacy = localStorage.getItem(TOPSTER_STATE_KEY);
            if (legacy) return JSON.parse(legacy);
        }

        return null;
    } catch (error) {
        return null;
    }
}

function clearSavedTopsterState() {
    if (shouldUseTopsterSharedStore() && !isTopsterEditorPage()) {
        return;
    }

    try {
        localStorage.removeItem(getTopsterStateKey());
        if (getTopsterDataSourceConfig().kind === 'grid-file') {
            localStorage.removeItem(TOPSTER_STATE_KEY);
        }
    } catch (error) {
        // Clearing saved state is optional; rendering can continue.
    }
}

const RATE_YOUR_MUSIC_CHART_BASE = 'https://rateyourmusic.com/charts/';
const RATE_YOUR_MUSIC_RELEASE_TYPES = [
    { value: 'album', label: 'Albums' },
    { value: 'ep', label: 'EP' },
    { value: 'mixtape', label: 'Mixtape' },
    { value: 'djmix', label: 'DJ Mix' },
    { value: 'single', label: 'Single' },
    { value: 'comp', label: 'Compilation' },
    { value: 'video', label: 'Video' },
    { value: 'unauth', label: 'Unauthorized' }
];

function isRateYourMusicTopsterSource() {
    return getTopsterDataSourceConfig().kind === 'rate-your-music-chart';
}

function isRollingStoneSingerTopsterSource() {
    const kind = getTopsterDataSourceConfig().kind;
    return kind === 'rolling-stone-greatest-singers-of-all-time-2023-file'
        || kind === 'rolling-stone-greatest-singers-of-all-time-2008-file';
}


function isPublicAlbumCoverRetrySource() {
    return isTopsterReadOnlyPage()
        && !isRateYourMusicTopsterSource()
        && !isRollingStoneSingerTopsterSource()
        && !(document.body && document.body.dataset.topsterRequireAdmin === 'true');
}

function topsterRetryImageUrl(imageSrc) {
    const value = String(imageSrc || '').trim();
    if (!value) return '';
    try {
        const url = new URL(value, window.location.href);
        url.searchParams.set('_nav_retry', String(Date.now()));
        return url.href;
    } catch (error) {
        const separator = value.includes('?') ? '&' : '?';
        return `${value}${separator}_nav_retry=${Date.now()}`;
    }
}

function probeTopsterImage(imageSrc, timeoutMs = 10000) {
    return new Promise(resolve => {
        if (!imageSrc || typeof Image === 'undefined') {
            resolve(false);
            return;
        }

        const image = new Image();
        let settled = false;
        const finish = result => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timeoutId);
            image.onload = null;
            image.onerror = null;
            resolve(Boolean(result));
        };
        const timeoutId = window.setTimeout(() => finish(false), Math.max(1000, Number(timeoutMs) || 10000));
        image.onload = () => finish(true);
        image.onerror = () => finish(false);
        image.src = topsterRetryImageUrl(imageSrc);
    });
}

function getRollingStoneSingerListYear() {
    const kind = getTopsterDataSourceConfig().kind;
    if (kind === 'rolling-stone-greatest-singers-of-all-time-2008-file') return 2008;
    if (kind === 'rolling-stone-greatest-singers-of-all-time-2023-file') return 2023;
    return null;
}

const ROLLING_STONE_SINGER_WIKIPEDIA_OVERRIDES = Object.freeze({
    'sade': 'Sade_(singer)',
    'dion': 'Dion_DiMucci',
    'luciano': 'Luciano_(Jamaican_singer)',
    'iu': 'IU_(singer)',
    'brandy': 'Brandy_Norwood',
    'robertsmith': 'Robert_Smith_(musician)',
    'bobbybluebland': 'Bobby_Bland',
    'prince': 'Prince_(musician)',
    'sylvester': 'Sylvester_(singer)',
    'usher': 'Usher_(musician)'
});

function getRollingStoneSingerWikipediaUrl(name) {
    const cleanName = cleanAlbumTitle(name || '').replace(/[’‘]/g, "'").replace(/[“”]/g, '"').trim();
    if (!cleanName) return '';

    const overrideKey = normalizeAlbumTitle(cleanName);
    const pageTitle = ROLLING_STONE_SINGER_WIKIPEDIA_OVERRIDES[overrideKey] || cleanName;
    const wikiPath = encodeURIComponent(pageTitle.replace(/\s+/g, '_'))
        .replace(/%28/g, '(')
        .replace(/%29/g, ')')
        .replace(/%27/g, "'");
    return `https://en.wikipedia.org/wiki/${wikiPath}`;
}


const ROLLING_STONE_SINGER_2008_ACT_OVERRIDES = Object.freeze({
    'howlinwolf': [],
    'stevewinwood': ['The Spencer Davis Group', 'Traffic', 'Blind Faith', 'Go'],
    'bobbybluebland': ['The Beale Streeters'],
    'jimmorrison': ['The Doors'],
    'paulrodgers': ['Free', 'Bad Company', 'The Firm', 'The Law', 'Queen + Paul Rodgers'],
    'ericburdon': ['The Animals', 'Eric Burdon and War'],
    'jerryleelewis': [],
    'greggallman': ['The Allman Brothers Band', 'The Hour Glass', 'Gregg Allman Band'],
    'jamestaylor': ['The Flying Machine'],
    'slystone': ['Sly and the Family Stone'],
    'frankievalli': ['The Four Seasons'],
    'johnleehooker': [],
    'tomwaits': [],
    'sammoore': ['Sam & Dave'],
    'artgarfunkel': ['Tom & Jerry', 'Simon & Garfunkel'],
    'donhenley': ['Eagles'],
    'theeverlybrothers': [],
    'annielennox': ['The Tourists', 'Eurythmics'],
    'bbking': [],
    'joecocker': ['The Grease Band'],
    'steventyler': ['Aerosmith']
});

let rollingStoneSinger2023ActMap = null;
let rollingStoneSinger2023ActMapPromise = null;

async function loadRollingStoneSinger2023ActMap() {
    if (rollingStoneSinger2023ActMap) return rollingStoneSinger2023ActMap;
    if (rollingStoneSinger2023ActMapPromise) return rollingStoneSinger2023ActMapPromise;
    rollingStoneSinger2023ActMapPromise = (async () => {
        const map = new Map();
        try {
            const response = await fetch('rolling_stone_greatest_singers_of_all_time_2023.txt', { cache: 'no-store' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const text = await response.text();
            String(text || '').split(/\r?\n/).forEach(rawLine => {
                const line = rawLine.replace(/^\s*\d+[.)]\s*/, '').trim();
                const match = line.match(/^(.+?)\s*\([^()]*?\b(?:18|19|20)\d{2}[^()]*\)\s*\|\s*\((.*?)\)\s*$/);
                if (!match) return;
                const name = cleanAlbumTitle(match[1]);
                const actsText = cleanAlbumTitle(match[2]);
                const acts = /^solo$/i.test(actsText) ? [] : actsText.split(/\s*;\s*|\s*\/\s*/).map(cleanAlbumTitle).filter(Boolean);
                map.set(normalizeAlbumTitle(name), acts);
            });
        } catch (error) {
            console.warn('Could not load 2023 singer-act reference data:', error);
        }
        rollingStoneSinger2023ActMap = map;
        return map;
    })();
    try { return await rollingStoneSinger2023ActMapPromise; }
    finally { rollingStoneSinger2023ActMapPromise = null; }
}

async function hydrateRollingStoneSingerActs(entry) {
    if (!entry || !entry.title || getRollingStoneSingerListYear() !== 2008) return entry;
    const key = normalizeAlbumTitle(entry.title);
    const ref = await loadRollingStoneSinger2023ActMap();
    const refActs = ref && ref.get(key);
    const fallback = ROLLING_STONE_SINGER_2008_ACT_OVERRIDES[key] || [];
    entry.acts = Array.from(new Set([...(entry.acts || []), ...(refActs || []), ...fallback].map(cleanAlbumTitle).filter(Boolean)));
    return entry;
}

function rollingStoneSingerImageSlug(name) {
    return String(name || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[’‘']/g, '')
        .replace(/[“”"]/g, '')
        .replace(/&/g, ' and ')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function getRollingStoneSingerDefaultCover(entry) {
    if (!entry || !entry.title) return null;
    const listYear = Number(entry.singerListYear) || getRollingStoneSingerListYear() || 2023;
    const extension = listYear === 2008 ? 'webp' : 'png';
    const imageSrc = entry.defaultImageSrc
        || `rolling_stone_greatest_singers_of_all_time_${listYear}/${rollingStoneSingerImageSlug(entry.title)}.${extension}`;
    return {
        title: entry.title,
        artist: '',
        imageSrc: resolveMaybeRelativeUrl(imageSrc, window.location.href),
        href: getRollingStoneSingerWikipediaUrl(entry.title) || entry.wikipediaHref,
        source: 'Default artist image',
        selectedManually: false,
        score: 1
    };
}

function getRollingStoneSingerLookupNames(entry) {
    const names = [entry && entry.title, ...(entry && Array.isArray(entry.acts) ? entry.acts : [])]
        .map(value => cleanAlbumTitle(value || ''))
        .filter(Boolean);
    return Array.from(new Set(names.map(name => name.trim()))).slice(0, 14);
}

function normalizeRateYourMusicMode(value) {
    const allowed = new Set(['auto', 'separate', 'deweight', 'include', 'only']);
    return allowed.has(value) ? value : 'auto';
}

function normalizeRateYourMusicChartConfig(value = {}) {
    const raw = value && typeof value === 'object' ? value : {};
    const chartTypes = new Set(['top', 'popular', 'esoteric', 'diverse']);
    const periodModes = new Set(['all-time', 'year', 'decade', 'range']);
    const allowedReleaseTypes = new Set(RATE_YOUR_MUSIC_RELEASE_TYPES.map(item => item.value));
    const releaseTypes = Array.isArray(raw.releaseTypes)
        ? raw.releaseTypes.filter(item => allowedReleaseTypes.has(item))
        : ['album'];
    const normalizedTypes = releaseTypes.length ? Array.from(new Set(releaseTypes)) : ['album'];
    const currentYear = new Date().getFullYear();
    const year = clampInteger(raw.year, 1900, currentYear + 1, currentYear);
    let decade = String(raw.decade || `${Math.floor(currentYear / 10) * 10}s`).trim();
    if (!/^\d{4}s$/.test(decade)) decade = `${Math.floor(currentYear / 10) * 10}s`;
    const rangeStart = clampInteger(raw.rangeStart, 1900, currentYear + 1, Math.max(1900, currentYear - 10));
    const rangeEnd = clampInteger(raw.rangeEnd, 1900, currentYear + 1, currentYear);

    return {
        chartType: chartTypes.has(raw.chartType) ? raw.chartType : 'top',
        releaseTypes: normalizedTypes,
        periodMode: periodModes.has(raw.periodMode) ? raw.periodMode : 'all-time',
        year,
        decade,
        rangeStart: Math.min(rangeStart, rangeEnd),
        rangeEnd: Math.max(rangeStart, rangeEnd),
        liveMode: normalizeRateYourMusicMode(raw.liveMode),
        archivalMode: normalizeRateYourMusicMode(raw.archivalMode),
        soundtrackMode: normalizeRateYourMusicMode(raw.soundtrackMode),
        popularityWeighting: clampInteger(raw.popularityWeighting, 1, 5, 3),
        pageCount: clampInteger(raw.pageCount, 1, 100, 25)
    };
}

function getRateYourMusicPeriodValue(config) {
    if (config.periodMode === 'year') return String(config.year);
    if (config.periodMode === 'decade') return config.decade;
    if (config.periodMode === 'range') return `${config.rangeStart}-${config.rangeEnd}`;
    return 'all-time';
}

function buildRateYourMusicChartUrl(rawConfig, page = 1) {
    const config = normalizeRateYourMusicChartConfig(rawConfig);
    const releaseTypes = config.releaseTypes.join(',');
    const period = getRateYourMusicPeriodValue(config);
    const modeBuckets = {
        separate: [],
        deweight: [],
        include: [],
        only: []
    };
    [
        ['live', config.liveMode],
        ['archival', config.archivalMode],
        ['soundtrack', config.soundtrackMode]
    ].forEach(([name, mode]) => {
        if (mode !== 'auto' && modeBuckets[mode]) modeBuckets[mode].push(name);
    });

    const segments = [];
    ['separate', 'deweight', 'include', 'only'].forEach(mode => {
        if (!modeBuckets[mode].length) return;
        const token = mode === 'include' ? 'incl' : mode;
        segments.push(`${token}:${modeBuckets[mode].join(',')}`);
    });

    const normalizedPage = Math.max(1, Math.floor(Number(page) || 1));

    // RYM pagination must come after the inclusion/deweighting filters.
    // Page 1 accepts the popularity-weighting segment, but including pop:X on
    // later page URLs can cause RYM to return an Internal Server Error.
    if (normalizedPage > 1) {
        segments.push(String(normalizedPage));
    } else {
        segments.push(`pop:${config.popularityWeighting}`);
    }

    return `${RATE_YOUR_MUSIC_CHART_BASE}${config.chartType}/${releaseTypes}/${period}/${segments.join('/')}/`;
}

function readRateYourMusicChartConfigFromControls() {
    const releaseTypes = RATE_YOUR_MUSIC_RELEASE_TYPES
        .filter(item => {
            const input = document.getElementById(`rym-release-${item.value}`);
            return Boolean(input && input.checked);
        })
        .map(item => item.value);

    const value = id => {
        const element = document.getElementById(id);
        return element ? element.value : '';
    };

    return normalizeRateYourMusicChartConfig({
        chartType: value('rym-chart-type'),
        releaseTypes,
        periodMode: value('rym-period-mode'),
        year: value('rym-year'),
        decade: value('rym-decade'),
        rangeStart: value('rym-range-start'),
        rangeEnd: value('rym-range-end'),
        liveMode: value('rym-live-mode'),
        archivalMode: value('rym-archival-mode'),
        soundtrackMode: value('rym-soundtrack-mode'),
        popularityWeighting: value('rym-popularity-weighting'),
        pageCount: value('rym-page-count')
    });
}

function setRateYourMusicControls(configValue) {
    const config = normalizeRateYourMusicChartConfig(configValue);
    const setValue = (id, value) => {
        const element = document.getElementById(id);
        if (element) element.value = value;
    };
    setValue('rym-chart-type', config.chartType);
    setValue('rym-period-mode', config.periodMode);
    setValue('rym-year', config.year);
    setValue('rym-decade', config.decade);
    setValue('rym-range-start', config.rangeStart);
    setValue('rym-range-end', config.rangeEnd);
    setValue('rym-live-mode', config.liveMode);
    setValue('rym-archival-mode', config.archivalMode);
    setValue('rym-soundtrack-mode', config.soundtrackMode);
    setValue('rym-popularity-weighting', config.popularityWeighting);
    setValue('rym-page-count', config.pageCount);

    RATE_YOUR_MUSIC_RELEASE_TYPES.forEach(item => {
        const input = document.getElementById(`rym-release-${item.value}`);
        if (input) input.checked = config.releaseTypes.includes(item.value);
    });
    updateRateYourMusicPeriodControls();
    updateRateYourMusicChartUrlPreview();
}

function updateRateYourMusicPeriodControls() {
    const modeElement = document.getElementById('rym-period-mode');
    const mode = modeElement ? modeElement.value : 'all-time';
    const groups = {
        year: document.getElementById('rym-year-group'),
        decade: document.getElementById('rym-decade-group'),
        range: document.getElementById('rym-range-group')
    };
    Object.entries(groups).forEach(([name, element]) => {
        if (element) element.hidden = mode !== name;
    });
}

function updateRateYourMusicChartUrlPreview() {
    const preview = document.getElementById('rym-chart-url-preview');
    if (!preview) return;
    const config = readRateYourMusicChartConfigFromControls();
    const url = buildRateYourMusicChartUrl(config, 1);
    preview.href = url;
    preview.textContent = url;

    const pageLinks = document.getElementById('rym-page-links');
    if (pageLinks) {
        pageLinks.innerHTML = '';
        for (let page = 1; page <= config.pageCount; page += 1) {
            const link = document.createElement('a');
            link.href = buildRateYourMusicChartUrl(config, page);
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.textContent = `Page ${page}`;
            pageLinks.appendChild(link);
        }
    }

    updateRateYourMusicSelectedPageCount();
}

function updateRateYourMusicSelectedPageCount() {
    const status = document.getElementById('rym-selected-page-count');
    if (!status) return;
    const input = document.getElementById('rym-chart-html-input');
    const selected = input && input.files ? input.files.length : 0;
    const config = readRateYourMusicChartConfigFromControls();
    status.textContent = `Selected pages: ${selected} / ${config.pageCount}`;
}

function parseRateYourMusicMetadata(text) {
    const line = String(text || '').split(/\r?\n/).find(item => item.startsWith('# RYM_CONFIG '));
    if (!line) return null;
    try {
        const parsed = JSON.parse(line.slice('# RYM_CONFIG '.length));
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (error) {
        return null;
    }
}

function rateYourMusicModeLabel(value) {
    const labels = {
        auto: 'Auto',
        separate: 'Separate',
        deweight: 'Include deweighted',
        include: 'Include',
        only: 'Only'
    };
    return labels[value] || 'Auto';
}

function rateYourMusicChartTypeLabel(value) {
    const labels = { top: 'Top', popular: 'Popular', esoteric: 'Esoteric', diverse: 'Diverse' };
    return labels[value] || 'Top';
}

function rateYourMusicReleaseTypeLabel(value) {
    const match = RATE_YOUR_MUSIC_RELEASE_TYPES.find(item => item.value === value);
    return match ? match.label : value;
}

function formatRateYourMusicPeriod(config) {
    if (config.periodMode === 'year') return String(config.year);
    if (config.periodMode === 'decade') return config.decade;
    if (config.periodMode === 'range') return `${config.rangeStart}–${config.rangeEnd}`;
    return 'All-time';
}

function formatRateYourMusicTimestamp(value, dateOnly = false) {
    if (!value) return 'Not published yet';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);

    if (dateOnly) {
        return date.toLocaleDateString('en-US', {
            month: '2-digit',
            day: '2-digit',
            year: 'numeric'
        });
    }

    return date.toLocaleString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    });
}

function renderRateYourMusicSnapshotSummary(text = topsterSharedSourceText) {
    if (!isRateYourMusicTopsterSource()) return;
    const metadata = parseRateYourMusicMetadata(text);
    const subtitle = document.getElementById('rym-last-updated');
    if (subtitle) {
        const publicReadOnlyList = document.body
            && document.body.dataset
            && document.body.dataset.topsterReadonly === 'true';
        subtitle.textContent = metadata && metadata.updatedAt
            ? `Last updated: ${formatRateYourMusicTimestamp(metadata.updatedAt, publicReadOnlyList)}`
            : 'Last updated: Not published yet';
    }

    const summary = document.getElementById('rym-config-summary');
    if (!summary) return;
    summary.innerHTML = '';
    if (!metadata) {
        summary.textContent = 'No published RateYourMusic chart snapshot is available yet.';
        return;
    }

    const config = normalizeRateYourMusicChartConfig(metadata.configuration || {});
    const rows = [
        ['Chart', rateYourMusicChartTypeLabel(config.chartType)],
        ['Release types', config.releaseTypes.map(rateYourMusicReleaseTypeLabel).join(', ')],
        ['Period', formatRateYourMusicPeriod(config)],
        ['Live releases', rateYourMusicModeLabel(config.liveMode)],
        ['Archival releases', rateYourMusicModeLabel(config.archivalMode)],
        ['Soundtracks and scores', rateYourMusicModeLabel(config.soundtrackMode)],
        ['Popularity weighting', String(config.popularityWeighting)],
        ['Chart pages requested', String(config.pageCount)],
        ['Imported chart entries', String(metadata.entryCount || 0)],
        ['Imported RYM pages', String(metadata.sourcePageCount || 0)]
    ];

    const dl = document.createElement('dl');
    dl.className = 'rym-config-readonly-grid';
    rows.forEach(([label, value]) => {
        const dt = document.createElement('dt');
        dt.textContent = label;
        const dd = document.createElement('dd');
        dd.textContent = value;
        dl.appendChild(dt);
        dl.appendChild(dd);
    });
    summary.appendChild(dl);

    if (metadata.chartUrl) {
        const sourceLine = document.createElement('p');
        sourceLine.className = 'rym-chart-source-line';
        sourceLine.append('Configured chart: ');
        const link = document.createElement('a');
        link.href = metadata.chartUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = 'Open on RateYourMusic';
        sourceLine.appendChild(link);
        summary.appendChild(sourceLine);
    }
}

function initializeRateYourMusicUi(sharedText = topsterSharedSourceText) {
    if (!isRateYourMusicTopsterSource()) return;
    renderRateYourMusicSnapshotSummary(sharedText);

    const chartType = document.getElementById('rym-chart-type');
    if (!chartType) return;
    if (chartType.dataset.rymInitialized === 'true') return;
    chartType.dataset.rymInitialized = 'true';

    const metadata = parseRateYourMusicMetadata(sharedText);
    if (metadata && metadata.configuration) {
        setRateYourMusicControls(metadata.configuration);
    } else {
        setRateYourMusicControls({ chartType: 'top', releaseTypes: ['album'], periodMode: 'all-time', popularityWeighting: 3, pageCount: 25 });
    }

    const controls = document.querySelectorAll('[data-rym-config-control="true"]');
    controls.forEach(element => {
        const eventName = element.type === 'number' ? 'input' : 'change';
        element.addEventListener(eventName, () => {
            if (element.type === 'checkbox' && element.id.startsWith('rym-release-')) {
                const anyReleaseChecked = RATE_YOUR_MUSIC_RELEASE_TYPES.some(item => {
                    const input = document.getElementById(`rym-release-${item.value}`);
                    return Boolean(input && input.checked);
                });
                if (!anyReleaseChecked) element.checked = true;
            }
            updateRateYourMusicPeriodControls();
            updateRateYourMusicChartUrlPreview();
            safeMarkTopsterPublishDirty();
        });
        if (eventName !== 'change') {
            element.addEventListener('change', () => {
                updateRateYourMusicPeriodControls();
                updateRateYourMusicChartUrlPreview();
                safeMarkTopsterPublishDirty();
            });
        }
    });

    const openButton = document.getElementById('rym-open-chart-button');
    if (openButton) {
        openButton.addEventListener('click', () => {
            window.open(buildRateYourMusicChartUrl(readRateYourMusicChartConfigFromControls(), 1), '_blank', 'noopener,noreferrer');
        });
    }

    const htmlInput = document.getElementById('rym-chart-html-input');
    if (htmlInput) {
        htmlInput.addEventListener('change', () => {
            updateRateYourMusicSelectedPageCount();
            safeMarkTopsterPublishDirty();
        });
    }

    updateRateYourMusicPeriodControls();
    updateRateYourMusicChartUrlPreview();
}

function getRateYourMusicImageUrl(element) {
    if (!element) return '';
    const candidates = [
        element.getAttribute && element.getAttribute('data-src'),
        element.getAttribute && element.getAttribute('data-original'),
        element.getAttribute && element.getAttribute('data-lazy-src'),
        element.getAttribute && element.getAttribute('src')
    ].filter(Boolean);

    // RYM's saved chart pages commonly lazy-load artwork through data-srcset on
    // <source> elements. Parse both live and lazy srcsets so the snapshot itself
    // remains the complete source of truth for Build.
    ['data-srcset', 'data-lazy-srcset', 'srcset'].forEach(attributeName => {
        const srcset = element.getAttribute && element.getAttribute(attributeName);
        if (!srcset) return;
        srcset.split(',').forEach(part => {
            const value = part.trim().split(/\s+/)[0];
            if (value) candidates.push(value);
        });
    });

    const style = element.getAttribute && element.getAttribute('style');
    if (style) {
        const styleMatch = style.match(/background-image\s*:\s*url\(["']?([^"')]+)["']?\)/i);
        if (styleMatch) candidates.push(styleMatch[1]);
    }

    for (const candidate of candidates) {
        if (!candidate || /^data:/i.test(candidate) || /placeholder/i.test(candidate)) continue;
        try {
            const value = candidate.startsWith('//') ? `https:${candidate}` : new URL(candidate, 'https://rateyourmusic.com/').href;
            if (/^https?:/i.test(value)) return value;
        } catch (error) {
            // Try the next candidate.
        }
    }
    return '';
}

function parseRateYourMusicCompactCount(rawValue, suffix = '') {
    const raw = String(rawValue || '').trim();
    if (!raw) return null;

    const multiplierSuffix = String(suffix || '').trim().toLowerCase();
    let numberText = raw.replace(/\s+/g, '');

    // Commas are thousands separators. A period is retained so values such as
    // 12.4k can be interpreted as 12,400.
    numberText = numberText.replace(/,/g, '');
    const value = Number(numberText);
    if (!Number.isFinite(value)) return null;

    let multiplier = 1;
    if (multiplierSuffix === 'k') multiplier = 1_000;
    if (multiplierSuffix === 'm') multiplier = 1_000_000;

    return Math.round(value * multiplier);
}

function parseRateYourMusicRatingCount(container) {
    if (!container) return null;

    const parseText = rawText => {
        const text = String(rawText || '').replace(/\u00a0/g, ' ');

        // Support both "12.4k ratings" and "Ratings 12.4k".
        const afterNumber = text.match(/([\d,.]+)\s*([kKmM]?)\s*(?:ratings?|votes?)\b/i);
        if (afterNumber) {
            const value = parseRateYourMusicCompactCount(afterNumber[1], afterNumber[2]);
            if (Number.isFinite(value)) return value;
        }

        const afterLabel = text.match(/(?:ratings?|votes?)\s*[:\-]?\s*([\d,.]+)\s*([kKmM]?)/i);
        if (afterLabel) {
            const value = parseRateYourMusicCompactCount(afterLabel[1], afterLabel[2]);
            if (Number.isFinite(value)) return value;
        }

        return null;
    };

    const focused = Array.from(container.querySelectorAll(
        '[class*="rating_count"], [class*="ratings_count"], [class*="chart_stats"], [title*="rating" i], [aria-label*="rating" i]'
    ));

    for (const element of focused) {
        const combined = `${element.textContent || ''} ${element.getAttribute('title') || ''} ${element.getAttribute('aria-label') || ''}`;
        const labeledValue = parseText(combined);
        if (Number.isFinite(labeledValue)) return labeledValue;

        const compactOnly = combined.match(/^\s*([\d,.]+)\s*([kKmM]?)\s*$/);
        if (compactOnly) {
            const value = parseRateYourMusicCompactCount(compactOnly[1], compactOnly[2]);
            if (Number.isFinite(value)) return value;
        }
    }

    return parseText(container.textContent || '');
}

function findRateYourMusicChartCard(anchor) {
    let node = anchor;
    for (let depth = 0; node && depth < 10; depth += 1, node = node.parentElement) {
        if (!node.querySelectorAll) continue;
        const releaseLinks = Array.from(node.querySelectorAll('a[href*="/release/"]'));
        const uniqueReleaseHrefs = new Set(releaseLinks.map(item => item.getAttribute('href')).filter(Boolean));
        const hasArtist = Boolean(node.querySelector('a[href*="/artist/"]'));
        const hasImage = Boolean(node.querySelector('img, source, [style*="background-image"]'));
        if (hasArtist && hasImage && uniqueReleaseHrefs.size <= 4) return node;
    }
    return anchor.parentElement || anchor;
}


const RATE_YOUR_MUSIC_RECORDED_YEAR_OVERRIDES = Object.freeze({
    // Previously reported corrections.
    '/release/album/led-zeppelin/how-the-west-was-won/': 1972,
    '/release/album/prince-and-the-revolution/prince-and-the-revolution-live/': 1985,
    '/release/album/bruce-springsteen-and-the-e-street-band/hammersmith-odeon-london-75/': 1975,
    '/release/album/boris/performing-flood/': 2012,
    '/release/album/townes-van-zandt/live-at-the-old-quarter-houston-texas/': 1973,

    // RYM chart HTML does not carry the full Recorded field from the individual
    // release page. These corrections preserve the RYM-style recorded year for
    // releases where the chart card alone cannot supply it.
    '/release/album/fishmans/98_12_28-男達の別れ/': 1998,
    '/release/album/swans/swans-are-dead/': 1995,
    '/release/album/nirvana/mtv-unplugged-in-new-york/': 1993,
    '/release/album/juan-gabriel/en-el-palacio-de-bellas-artes/': 1990,
    '/release/album/swans/live-rope/': 2023,
    '/release/album/ween/live-in-chicago/': 2003,
    '/release/album/lcd-soundsystem/the-long-goodbye-lcd-soundsystem-live-at-madison-square-garden/': 2011,
    '/release/album/john-coltrane/the-olatunji-concert-the-last-live-recording/': 1967,
    '/release/album/talking-heads/the-name-of-this-band-is-talking-heads/': 1977,
    '/release/album/portishead/roseland-nyc-live/': 1997,
    '/release/album/파란노을/after-the-night/': 2023,
    '/release/album/boris-with-merzbow/rock-dream/': 2006,
    '/release/album/miles-davis/dark-magus/': 1974,
    '/release/album/adrianne-lenker/live-at-revolution-hall/': 2024,
    '/release/album/alice-in-chains/mtv-unplugged/': 1996,
    '/release/album/vangelis/blade-runner/': 1981,
    '/release/album/the-velvet-underground/the-complete-matrix-tapes/': 1969,
    '/release/album/electric-masada/at-the-mountains-of-madness/': 2004,
    '/release/album/johnny-cash/at-folsom-prison/': 1968
});

function getRateYourMusicRecordedYearOverride(href) {
    if (!href) return null;
    try {
        const pathname = new URL(href, 'https://rateyourmusic.com/').pathname.toLowerCase();
        return RATE_YOUR_MUSIC_RECORDED_YEAR_OVERRIDES[pathname] || null;
    } catch (error) {
        return null;
    }
}

function parseRateYourMusicTwoDigitHistoricalYear(raw) {
    const text = String(raw || '');
    const match = text.match(/(?:^|[^0-9])['’](\d{2})(?:[^0-9]|$)/);
    if (!match) return null;
    const yy = Number(match[1]);
    if (!Number.isFinite(yy)) return null;
    const currentTwoDigit = new Date().getFullYear() % 100;
    return yy <= currentTwoDigit ? 2000 + yy : 1900 + yy;
}

function parseRateYourMusicHistoricalDateYear(raw) {
    const text = decodeURIComponent(String(raw || '')).replace(/[–—]/g, '-');

    // Date-like forms used in release titles/slugs: 98.12.28, 98_12_28, 98-12-28.
    // The year is interpreted using the same rolling-century rule as apostrophe years.
    const shortDate = text.match(/(?:^|[^0-9])(\d{2})[._-](?:0?[1-9]|1[0-2])[._-](?:0?[1-9]|[12]\d|3[01])(?:[^0-9]|$)/);
    if (shortDate) {
        const yy = Number(shortDate[1]);
        const currentTwoDigit = new Date().getFullYear() % 100;
        if (Number.isFinite(yy)) return yy <= currentTwoDigit ? 2000 + yy : 1900 + yy;
    }

    const fullYear = text.match(/\b((?:18|19|20)\d{2})\b/);
    if (fullYear) return Number(fullYear[1]);

    return parseRateYourMusicTwoDigitHistoricalYear(text);
}

function parseRateYourMusicRecordedYear(container, title = '', href = '', releaseType = '') {
    if (!container) return getRateYourMusicRecordedYearOverride(href);

    const extractYear = raw => {
        const match = String(raw || '').match(/\b((?:18|19|20)\d{2})\b/);
        return match ? Number(match[1]) : null;
    };

    const override = getRateYourMusicRecordedYearOverride(href);
    if (override) return override;

    const candidateElements = Array.from(container.querySelectorAll(
        '[class*="recorded" i], [data-testid*="recorded" i], [title*="recorded" i], [aria-label*="recorded" i]'
    ));

    for (const element of candidateElements) {
        const combined = `${element.textContent || ''} ${element.getAttribute('title') || ''} ${element.getAttribute('aria-label') || ''}`;
        const year = extractYear(combined);
        if (year) return year;
    }

    const cardText = String(container.textContent || '').replace(/\s+/g, ' ').trim();
    const recordedLabel = cardText.match(/\bRecorded\b[\s:,-]*([\s\S]{0,140}?)(?=\b(?:Released|RYM Rating|Ratings?|Reviews?|Genres?|Descriptors?|Language|$))/i);
    if (recordedLabel) {
        const year = extractYear(recordedLabel[1]);
        if (year) return year;
        const twoDigit = parseRateYourMusicTwoDigitHistoricalYear(recordedLabel[1]);
        if (twoDigit) return twoDigit;
    }

    // Historical live/archival titles frequently carry the performance year.
    const isHistoricalRelease = /\b(?:live|archival)\b/i.test(`${releaseType} ${cardText}`);
    if (isHistoricalRelease) {
        const titleHistoricalYear = parseRateYourMusicHistoricalDateYear(title);
        if (titleHistoricalYear) return titleHistoricalYear;

        const hrefHistoricalYear = parseRateYourMusicHistoricalDateYear(href);
        if (hrefHistoricalYear) return hrefHistoricalYear;
    }

    return null;
}

function parseRateYourMusicReleasedYear(container) {
    if (!container) return null;
    const dateElement = container.querySelector('[class*="release_date"], [class*="chart_date"], time, [class*="date"]');
    const dateText = `${dateElement ? dateElement.textContent || '' : ''} ${container.textContent || ''}`;
    const yearMatch = dateText.match(/\b((?:18|19|20)\d{2})\b/);
    return yearMatch ? Number(yearMatch[1]) : null;
}

function parseRateYourMusicChartHtml(htmlText, sourceName = '', sourcePageIndex = 0) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(String(htmlText || ''), 'text/html');
    const entries = [];
    const seen = new Set();

    const chartItems = Array.from(doc.querySelectorAll('.page_charts_section_charts_item'));

    const normalizeHref = rawHref => {
        try {
            const url = new URL(rawHref || '', 'https://rateyourmusic.com/');
            url.hash = '';
            url.search = '';
            return url.href;
        } catch (error) {
            return '';
        }
    };

    const textOf = (container, selector) => {
        const element = container ? container.querySelector(selector) : null;
        return element ? String(element.textContent || '').replace(/\s+/g, ' ').trim() : '';
    };

    const getImageFromContainer = container => {
        if (!container) return '';
        const imageElements = Array.from(container.querySelectorAll('img, source, [style*="background-image"]'));
        for (const imageElement of imageElements) {
            const imageSrc = getRateYourMusicImageUrl(imageElement);
            if (imageSrc) return imageSrc;
        }
        return '';
    };

    const pushChartItem = (card, itemIndex) => {
        const releaseAnchor = card.querySelector(
            '.page_charts_section_charts_item_title a[href*="/release/"], .release a[href*="/release/"], a[href*="/release/"]'
        );
        if (!releaseAnchor) return;

        const href = normalizeHref(releaseAnchor.getAttribute('href'));
        if (!href || !/rateyourmusic\.com\/release\//i.test(href) || seen.has(href)) return;

        let title = textOf(card, '.page_charts_section_charts_item_title a .ui_name_locale_original')
            || textOf(card, '.page_charts_section_charts_item_title a')
            || textOf(card, '.release a')
            || String(releaseAnchor.textContent || '').replace(/\s+/g, ' ').trim();

        if (!title) {
            const image = card.querySelector('img[alt]');
            title = image ? String(image.getAttribute('alt') || '').trim() : '';
        }

        // Only strip an actual "1. " / "1) " rank prefix. Never strip a pure
        // numeric title such as Prince's "1999", Wire's "154", or Ichiko Aoba's "0".
        title = title.replace(/^\s*\d+[.)]\s+/, '').trim();

        let artist = textOf(card, '.page_charts_section_charts_item_credited_links_primary a.artist')
            || textOf(card, '.artist a')
            || textOf(card, 'a[href*="/artist/"]');

        if (!artist) {
            artist = textOf(card, '.page_charts_section_charts_item_credited_links_primary')
                || textOf(card, '.artist');
        }

        // RYM often renders Various Artists as non-clickable text rather than an
        // /artist/ link, which previously caused those chart entries to be skipped.
        if (!artist && /\/release\/[^/]+\/various-artists\//i.test(new URL(href).pathname)) {
            artist = 'Various Artists';
        }

        if (!artist || !title) return;

        const releaseType = textOf(card, '.page_charts_section_charts_item_release_type');
        const releasedYear = parseRateYourMusicReleasedYear(card);
        const recordedYear = parseRateYourMusicRecordedYear(card, title, href, releaseType);

        // The saved RYM chart itself exposes the release date, not a reliable
        // Recorded field. When a historical live/archival item has no recoverable
        // Recorded year, do not substitute the later release year into the overlay.
        const isHistoricalRelease = /\b(?:live|archival)\b/i.test(`${releaseType} ${card.textContent || ''}`);
        // Historical releases must use Recorded rather than the later Released date.
        // If the chart card lacks Recorded metadata, the URL/title heuristics and
        // recorded-year override table above are used before leaving the year blank.
        // Historical releases must use Recorded rather than the later Released date.
        const year = recordedYear || (isHistoricalRelease ? null : releasedYear);

        const rankText = textOf(card, '.page_charts_section_charts_item_number > div:first-child')
            || textOf(card, '[class*="chart_position"], [class*="position"], [class*="rank"]');
        const rankMatch = rankText.match(/\d+/);
        const rank = rankMatch
            ? Number(rankMatch[0])
            : ((Number(sourcePageIndex) || 0) * 100) + itemIndex + 1;

        const imageSrc = getImageFromContainer(releaseAnchor) || getImageFromContainer(card);

        seen.add(href);
        entries.push({
            rank,
            artist: cleanAlbumTitle(artist),
            title: cleanAlbumTitle(title),
            year,
            recordedYear,
            releasedYear,
            releaseType,
            ratingCount: null,
            imageSrc,
            href,
            sourceName
        });
    };

    if (chartItems.length) {
        chartItems.forEach((card, itemIndex) => pushChartItem(card, itemIndex));
        return entries;
    }

    // Fallback for older/simplified saved RYM markup that does not use the
    // current page_charts_section_charts_item container.
    const releaseAnchors = Array.from(doc.querySelectorAll('a[href*="/release/"]'));
    releaseAnchors.forEach((anchor, itemIndex) => {
        const href = normalizeHref(anchor.getAttribute('href'));
        if (!href || !/rateyourmusic\.com\/release\//i.test(href) || seen.has(href)) return;

        const card = findRateYourMusicChartCard(anchor);
        if (!card) return;

        let title = String(anchor.textContent || '').replace(/\s+/g, ' ').trim();
        if (!title) {
            const image = card.querySelector('img[alt]');
            title = image ? String(image.getAttribute('alt') || '').trim() : '';
        }
        title = title.replace(/^\s*\d+[.)]\s+/, '').trim();

        let artist = Array.from(card.querySelectorAll('a[href*="/artist/"]'))
            .map(link => String(link.textContent || '').replace(/\s+/g, ' ').trim())
            .find(Boolean) || '';

        if (!artist && /\/release\/[^/]+\/various-artists\//i.test(new URL(href).pathname)) {
            artist = 'Various Artists';
        }
        if (!artist || !title) return;

        const releaseType = textOf(card, '.page_charts_section_charts_item_release_type');
        const releasedYear = parseRateYourMusicReleasedYear(card);
        const recordedYear = parseRateYourMusicRecordedYear(card, title, href, releaseType);
        const isHistoricalRelease = /\b(?:live|archival)\b/i.test(`${releaseType} ${card.textContent || ''}`);
        const year = recordedYear || (isHistoricalRelease ? null : releasedYear);
        const imageSrc = getImageFromContainer(anchor) || getImageFromContainer(card);

        seen.add(href);
        entries.push({
            rank: ((Number(sourcePageIndex) || 0) * 100) + itemIndex + 1,
            artist: cleanAlbumTitle(artist),
            title: cleanAlbumTitle(title),
            year,
            recordedYear,
            releasedYear,
            releaseType,
            ratingCount: null,
            imageSrc,
            href,
            sourceName
        });
    });

    return entries;
}
function seedRateYourMusicCovers(entries) {
    entries.forEach(entry => {
        if (!entry || !entry.imageSrc) return;
        const cacheEntry = { artist: entry.artist, title: entry.title, year: entry.year || '' };
        const existing = getPreferredCachedCover(cacheEntry);
        if (existing && existing.selectedManually) return;
        setCachedCover(buildCoverCacheKey(cacheEntry), {
            title: entry.title,
            artist: entry.artist,
            imageSrc: entry.imageSrc,
            href: entry.href || '',
            source: 'RateYourMusic thumbnail',
            selectedManually: false
        });
    });
}

async function readRateYourMusicHtmlFile(file) {
    const text = await readTextFromSelectedDraftFile(file);
    return { name: file.name || 'RateYourMusic chart.html', text };
}

function getRateYourMusicPageNumberFromFileName(name) {
    const text = String(name || '').trim();

    // Chrome/Firefox saves RYM chart pages with names such as:
    // "Custom chart_ Best albums of all time - Rate Your Music.html"
    // "Custom chart_ Best albums of all time - Rate Your Music2.html"
    // "Custom chart_ Best albums of all time - Rate Your Music25.html"
    // Treat the unsuffixed file as page 1 and trailing digits as the page.
    const rymChartName = text.match(/(?:^|.*\s-\s)Rate Your Music\s*(\d*)\s*(?=\.(?:html?|xhtml)$|$)/i);
    if (rymChartName) {
        const page = rymChartName[1] ? Number(rymChartName[1]) : 1;
        if (Number.isFinite(page) && page >= 1) return page;
    }

    // Secondary fallbacks for manually renamed files.
    const patterns = [
        /(?:page|pg)[\s._-]*(\d+)/i,
        /[\s._-]\((\d+)\)(?=\.[^.]+$)/i,
        /[\s._-](\d+)(?=\.[^.]+$)/i,
        /(\d+)(?=\.[^.]+$)/i
    ];
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) {
            const page = Number(match[1]);
            if (Number.isFinite(page) && page >= 1) return page;
        }
    }

    return null;
}

function sortRateYourMusicHtmlFiles(files) {
    return Array.from(files || [])
        .map((file, index) => ({
            file,
            index,
            page: getRateYourMusicPageNumberFromFileName(file && file.name),
            name: String(file && file.name || '')
        }))
        .sort((a, b) => {
            if (a.page !== null && b.page !== null && a.page !== b.page) return a.page - b.page;
            if (a.page !== null && b.page === null) return -1;
            if (a.page === null && b.page !== null) return 1;

            const byName = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
            if (byName !== 0) return byName;
            return a.index - b.index;
        })
        .map(item => item.file);
}

async function loadRateYourMusicChartSource(source = getTopsterDataSourceConfig()) {
    const input = source.fileInputId ? document.getElementById(source.fileInputId) : null;
    const files = input && input.files ? sortRateYourMusicHtmlFiles(input.files) : [];

    if (!files.length) {
        if (topsterSharedSourceText) {
            renderRateYourMusicSnapshotSummary(topsterSharedSourceText);
            return {
                text: topsterSharedSourceText,
                signature: topsterSharedSourceSignature || simpleTextHash(topsterSharedSourceText),
                source: topsterSharedSourceName || source.label
            };
        }
        throw new Error(isTopsterEditorPage()
            ? 'Open the configured RateYourMusic page links, save the required chart pages as HTML, select all of them at once, then press Build.'
            : 'No RateYourMusic chart snapshot has been published yet.');
    }

    const config = readRateYourMusicChartConfigFromControls();
    if (!config.releaseTypes.length) {
        throw new Error('Select at least one RateYourMusic release type.');
    }
    setTopsterLoadingProgress(20, `Reading ${files.length} saved RateYourMusic chart page${files.length === 1 ? '' : 's'}...`);
    const pages = await Promise.all(files.map(readRateYourMusicHtmlFile));
    const parsed = [];
    pages.forEach((page, pageIndex) => parsed.push(...parseRateYourMusicChartHtml(page.text, page.name, pageIndex)));

    const unique = [];
    const seen = new Set();
    parsed.forEach(entry => {
        const key = entry.href || `${normalizeAlbumTitle(entry.artist)}|${normalizeAlbumTitle(entry.title)}|${entry.year || ''}`;
        if (seen.has(key)) return;
        seen.add(key);
        unique.push(entry);
    });

    if (!unique.length) {
        throw new Error('No RateYourMusic chart entries could be read from the selected HTML pages. Make sure the selected files are actual RYM chart result pages.');
    }

    unique.sort((a, b) => (Number(a.rank) || 999999999) - (Number(b.rank) || 999999999));
    seedRateYourMusicCovers(unique);

    const metadata = {
        version: 3,
        updatedAt: new Date().toISOString(),
        updateCadence: 'Weekly',
        chartUrl: buildRateYourMusicChartUrl(config, 1),
        configuration: config,
        requestedPageCount: config.pageCount,
        sourcePageCount: pages.length,
        sourceFiles: pages.map(page => page.name),
        parsedEntryCount: unique.length,
        entryCount: unique.length,
        rymThumbnailCount: unique.filter(entry => entry.imageSrc).length,
        recordedYearCount: unique.filter(entry => Number.isFinite(entry.recordedYear)).length,
        releaseLinks: unique.map(entry => entry.href || '')
    };
    const lines = unique.map(entry => `${entry.artist} - ${entry.title}${entry.year ? ` (${entry.year})` : ''}`);
    const text = `# RYM_CONFIG ${JSON.stringify(metadata)}\n${lines.join('\n')}`;
    renderRateYourMusicSnapshotSummary(text);

    return {
        text,
        signature: simpleTextHash(text),
        source: `RateYourMusic chart snapshot (${pages.length} imported page${pages.length === 1 ? '' : 's'}, ${unique.length} release${unique.length === 1 ? '' : 's'})`
    };
}

async function loadGridTextFile() {
    const source = getTopsterDataSourceConfig();

    if (source.kind === 'rate-your-music-chart') {
        return loadRateYourMusicChartSource(source);
    }

    if (source.kind === 'draft-file' || source.kind === 'checklist-file') {
        return loadDraftTextFile(source);
    }

    if (source.staticFileOnly) {
        return loadPlainGridTextFile(source);
    }

    const apiResult = await tryLoadGridTextFromApi(source);
    if (apiResult) return apiResult;

    if (source.kind === 'ranked-sheet') {
        return loadRankedSheetTextFromGoogle(source);
    }

    return loadPlainGridTextFile(source);
}

async function loadDraftTextFile(source = getTopsterDataSourceConfig()) {
    const fileInput = source.fileInputId ? document.getElementById(source.fileInputId) : null;
    const selectedFile = fileInput && fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;

    if (selectedFile) {
        const text = await readTextFromSelectedDraftFile(selectedFile);
        return {
            text,
            signature: simpleTextHash(text),
            source: selectedFile.name || source.label
        };
    }

    const apiResult = await tryLoadGridTextFromApi(source);
    if (apiResult) return apiResult;

    if (topsterSharedSourceText) {
        return {
            text: topsterSharedSourceText,
            signature: topsterSharedSourceSignature || simpleTextHash(topsterSharedSourceText),
            source: topsterSharedSourceName || source.label
        };
    }

    throw new Error(isTopsterEditorPage()
        ? `Select a Notepad .txt file for the ${source.readLabel}, then press Build.`
        : `No ${source.readLabel} has been published yet.`);
}

function readTextFromSelectedDraftFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Could not read the selected Notepad .txt file.'));
        reader.readAsText(file);
    });
}

async function loadPlainGridTextFile(source = getTopsterDataSourceConfig()) {
    const fileName = source.fileName || TOPSTER_GRID_FILE;
    const gridUrl = new URL(fileName, window.location.href);
    gridUrl.searchParams.set('_', String(Date.now()));

    const response = await fetch(gridUrl.href, { cache: 'no-store' });
    if (!response.ok) {
        throw new Error(`${fileName} was not found next to this Topster page.`);
    }

    const text = await response.text();
    if (looksLikeHtmlDocument(text)) {
        throw new Error(`${fileName} was not found. Put it in the same navincitron-website folder as this Topster page.`);
    }

    return {
        text,
        signature: simpleTextHash(text),
        source: fileName
    };
}

async function loadRankedSheetTextFromGoogle(source = getTopsterDataSourceConfig()) {
    const csvUrl = new URL(source.csvUrl);
    csvUrl.searchParams.set('_', String(Date.now()));

    const response = await fetch(csvUrl.href, { cache: 'no-store' });
    if (!response.ok) {
        throw new Error('Could not read the ranked Google Sheet. Make sure the sheet is shared publicly or run through app.py.');
    }

    const csvText = await response.text();
    if (looksLikeHtmlDocument(csvText)) {
        throw new Error('The ranked Google Sheet returned an HTML page instead of CSV. Share the sheet publicly or use the Flask app.py proxy.');
    }

    const text = rankedSheetCsvToAlbumText(csvText);
    return {
        text,
        signature: simpleTextHash(text),
        source: source.label
    };
}

async function tryLoadGridTextFromApi(source = getTopsterDataSourceConfig()) {
    if (!/^https?:$/i.test(window.location.protocol)) return null;

    try {
        const apiUrl = new URL(buildTopsterApiUrl(source.apiPath || '/api/grid-text'));
        apiUrl.searchParams.set('_', String(Date.now()));
        const response = await fetch(apiUrl.href, { cache: 'no-store', credentials: 'include' });
        const contentType = response.headers.get('content-type') || '';

        if (!response.ok || !contentType.includes('application/json')) {
            return null;
        }

        const data = await response.json();
        if (!data || !data.ok || typeof data.text !== 'string') {
            return null;
        }

        return {
            text: data.text,
            signature: data.signature || simpleTextHash(data.text),
            source: data.source || source.label
        };
    } catch (error) {
        return null;
    }
}

function rankedSheetCsvToAlbumText(csvText) {
    const rows = parseCsvRows(csvText);
    const albumLines = [];

    rows.forEach((row, index) => {
        if (!row || row.length < 5) return;
        if (index === 0 && /album\s*name/i.test(row[2] || '') && /artist\s*name/i.test(row[3] || '')) return;

        const albumTitle = cleanCsvCell(row[2]);
        const artistName = cleanCsvCell(row[3]);
        const dateText = cleanCsvCell(row[4]);

        if (!albumTitle || !artistName) return;
        albumLines.push(`${artistName} - ${albumTitle}${dateText ? ` (${dateText})` : ''}`);
    });

    return albumLines.join('\n');
}

function cleanCsvCell(value) {
    return String(value == null ? '' : value).replace(/^\ufeff/, '').trim();
}

function parseCsvRows(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    const value = String(text || '');

    for (let i = 0; i < value.length; i++) {
        const char = value[i];
        const next = value[i + 1];

        if (inQuotes) {
            if (char === '"' && next === '"') {
                field += '"';
                i++;
            } else if (char === '"') {
                inQuotes = false;
            } else {
                field += char;
            }
            continue;
        }

        if (char === '"') {
            inQuotes = true;
        } else if (char === ',') {
            row.push(field);
            field = '';
        } else if (char === '\n') {
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
        } else if (char !== '\r') {
            field += char;
        }
    }

    row.push(field);
    if (row.some(cell => String(cell || '').trim() !== '')) rows.push(row);
    return rows;
}

function looksLikeHtmlDocument(text) {
    return /^\s*<!doctype html/i.test(text || '') || /^\s*<html[\s>]/i.test(text || '');
}

function simpleTextHash(text) {
    let hash = 2166136261;
    const value = String(text || '');
    for (let i = 0; i < value.length; i++) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return `fnv1a-${(hash >>> 0).toString(16)}`;
}

function getSourceConfig() {
    return {
        useMusicBrainz: true,
        useItunes: true,
        useInternetArchive: true,
        useLocalIndex: false,
        useCache: true,
        lastfmKey: TOPSTER_LASTFM_API_KEY,
        useLastfm: Boolean(TOPSTER_LASTFM_API_KEY),
        googleKey: '',
        googleCx: '',
        useGoogle: false
    };
}

function isChecked(id) {
    const element = document.getElementById(id);
    return Boolean(element && element.checked);
}

async function resolveAlbumCover(entry, albumCatalog, config) {
    const cacheKey = buildCoverCacheKey(entry);
    const resolvers = [];
    const excludedUrls = new Set(
        (Array.isArray(config && config.excludeImageUrls) ? config.excludeImageUrls : [])
            .map(normalizeImageUrl)
            .filter(Boolean)
    );
    const isExcluded = cover => Boolean(
        cover && cover.imageSrc && excludedUrls.has(normalizeImageUrl(cover.imageSrc))
    );

    if (config.useLastfm) {
        resolvers.push(() => resolveLastfmCover(entry, config.lastfmKey));
    }
    if (config.useInternetArchive) {
        resolvers.push(() => resolveInternetArchiveCover(entry));
    }
    if (config.useMusicBrainz) {
        resolvers.push(() => resolveMusicBrainzCover(entry));
    }
    if (config.useItunes) {
        resolvers.push(() => resolveItunesCover(entry));
    }

    for (const resolver of resolvers) {
        const cover = await resolver();
        if (cover && cover.imageSrc && !isExcluded(cover)) {
            setCachedCover(cacheKey, cover);
            return cover;
        }
    }

    if (config.useCache) {
        const cached = getPreferredCachedCover(entry) || getExactCachedCoverForEntry(entry);
        if (cached && cached.imageSrc && !isExcluded(cached)) {
            return { ...cached, source: cached.source || 'Cache' };
        }
    }

    return null;
}

function resolveLocalIndexCover(entry, catalog) {
    if (!catalog || !catalog.records || !catalog.records.length) return null;
    const match = findAlbumMatch(entry.title, catalog, entry.year);
    if (!match || !match.imageSrc) return null;
    return {
        title: match.title || entry.title,
        artist: match.artist || '',
        imageSrc: match.imageSrc,
        href: match.href || '',
        source: 'Site'
    };
}

async function resolveMusicBrainzCover(entry) {
    const query = buildMusicBrainzQuery(entry);
    const searchUrl = `https://musicbrainz.org/ws/2/release-group/?query=${encodeURIComponent(query)}&fmt=json&limit=10`;
    let data = await fetchMusicBrainzJson(searchUrl);
    let groups = Array.isArray(data['release-groups']) ? data['release-groups'] : [];
    if (!groups.length && entry.year) {
        const fallbackQuery = buildMusicBrainzQuery(entry, false);
        data = await fetchMusicBrainzJson(`https://musicbrainz.org/ws/2/release-group/?query=${encodeURIComponent(fallbackQuery)}&fmt=json&limit=10`);
        groups = Array.isArray(data['release-groups']) ? data['release-groups'] : [];
    }
    const candidates = groups
        .map(group => ({ group, score: scoreAlbumCandidate(entry, group.title, group['first-release-date'], Number(group.score) || 0, firstArtistCreditName(group['artist-credit'])) }))
        .filter(item => item.score >= 0.58)
        .sort((a, b) => b.score - a.score);

    for (const item of candidates.slice(0, 5)) {
        const mbid = item.group.id;
        if (!mbid) continue;
        const cover = await fetchCoverArtArchiveForReleaseGroup(mbid);
        if (cover && cover.imageSrc) {
            return {
                title: item.group.title || entry.title,
                artist: firstArtistCreditName(item.group['artist-credit']),
                imageSrc: cover.imageSrc,
                href: `https://musicbrainz.org/release-group/${mbid}`,
                source: 'MusicBrainz/CAA'
            };
        }
    }

    return null;
}

function buildMusicBrainzQuery(entry, includeYear = true) {
    const escapedTitle = String(entry.title || '').replace(/"/g, '\\"');
    const escapedArtist = String(entry.artist || '').replace(/"/g, '\\"');
    const parts = [`releasegroup:"${escapedTitle}"`];
    if (escapedArtist) parts.push(`artist:"${escapedArtist}"`);
    if (includeYear && entry.year) parts.push(`firstreleasedate:${entry.year}`);
    return parts.join(' AND ');
}

async function fetchCoverArtArchiveForReleaseGroup(mbid) {
    const dataUrl = `https://coverartarchive.org/release-group/${encodeURIComponent(mbid)}`;
    try {
        const data = await fetchJson(dataUrl, 12000);
        const images = Array.isArray(data.images) ? data.images : [];
        const front = images.find(image => image.front) || images[0];
        if (!front) return null;
        const thumbnails = front.thumbnails || {};
        return {
            imageSrc: thumbnails['1200'] || thumbnails.large || thumbnails['500'] || thumbnails['250'] || thumbnails.small || front.image || ''
        };
    } catch (error) {
        return null;
    }
}

async function resolveItunesCover(entry) {
    async function search(includeYear) {
        const searchTerm = `${entry.artist ? `${entry.artist} ` : ''}${entry.title}${includeYear && entry.year ? ` ${entry.year}` : ''}`;
        const url = `https://itunes.apple.com/search?term=${encodeURIComponent(searchTerm)}&entity=album&limit=15`;
        const data = await fetchJson(url, 12000);
        const results = Array.isArray(data.results) ? data.results : [];
        return results
            .map(result => ({ result, score: scoreAlbumCandidate(entry, result.collectionName, result.releaseDate, 0, result.artistName) }))
            .filter(item => item.score >= 0.55)
            .sort((a, b) => b.score - a.score);
    }

    let candidates = await search(true);
    if (!candidates.length && entry.year) candidates = await search(false);

    const best = candidates[0] ? candidates[0].result : null;
    if (!best || !best.artworkUrl100) return null;

    return {
        title: best.collectionName || entry.title,
        artist: best.artistName || entry.artist || '',
        imageSrc: upscaleItunesArtwork(best.artworkUrl100),
        href: best.collectionViewUrl || '',
        source: 'iTunes'
    };
}

async function resolveLastfmCover(entry, apiKey) {
    if (entry.artist) {
        try {
            const infoUrl = new URL('https://ws.audioscrobbler.com/2.0/');
            infoUrl.searchParams.set('method', 'album.getinfo');
            infoUrl.searchParams.set('artist', entry.artist);
            infoUrl.searchParams.set('album', entry.title);
            infoUrl.searchParams.set('api_key', apiKey);
            infoUrl.searchParams.set('format', 'json');
            const infoData = await fetchJson(infoUrl.href, 12000);
            const album = infoData && infoData.album ? infoData.album : null;
            const images = album && Array.isArray(album.image) ? album.image : [];
            const imageSrc = getLastfmImage(images);
            const identityScore = album
                ? scoreAlbumCandidate(entry, album.name || entry.title, '', 0, album.artist || '')
                : 0;
            if (album && identityScore >= 0.30 && imageSrc && !imageSrc.includes('2a96cbd8b46e442fc41c2b86b821562f')) {
                return {
                    title: album.name || entry.title,
                    artist: album.artist || entry.artist || '',
                    imageSrc,
                    href: album.url || '',
                    source: 'Last.fm'
                };
            }
        } catch (error) {
            // Fall back to album.search below.
        }
    }

    const searchAlbum = `${entry.artist ? `${entry.artist} ` : ''}${entry.title}`;
    const url = `https://ws.audioscrobbler.com/2.0/?method=album.search&album=${encodeURIComponent(searchAlbum)}&api_key=${encodeURIComponent(apiKey)}&format=json&limit=10`;
    const data = await fetchJson(url, 12000);
    const matches = data && data.results && data.results.albummatches && Array.isArray(data.results.albummatches.album)
        ? data.results.albummatches.album
        : [];
    const candidates = matches
        .map(album => ({ album, score: scoreAlbumCandidate(entry, album.name, '', 0, album.artist) }))
        .filter(item => item.score >= 0.62)
        .sort((a, b) => b.score - a.score);

    for (const item of candidates) {
        const images = Array.isArray(item.album.image) ? item.album.image : [];
        const imageSrc = getLastfmImage(images);
        if (imageSrc && !imageSrc.includes('2a96cbd8b46e442fc41c2b86b821562f')) {
            return {
                title: item.album.name || entry.title,
                artist: item.album.artist || entry.artist || '',
                imageSrc,
                href: item.album.url || '',
                source: 'Last.fm'
            };
        }
    }

    return null;
}

async function resolveInternetArchiveCover(entry) {
    const url = new URL('https://archive.org/advancedsearch.php');
    const safeArchiveTitle = String(entry.title || '').replace(/"/g, '');
    const safeArchiveArtist = String(entry.artist || '').replace(/"/g, '');
    const archiveQuery = [`title:("${safeArchiveTitle}")`, 'mediatype:(audio)'];
    if (safeArchiveArtist) archiveQuery.push(`creator:("${safeArchiveArtist}")`);
    url.searchParams.set('q', archiveQuery.join(' AND '));
    url.searchParams.append('fl[]', 'identifier');
    url.searchParams.append('fl[]', 'title');
    url.searchParams.append('fl[]', 'creator');
    url.searchParams.append('fl[]', 'date');
    url.searchParams.set('rows', '10');
    url.searchParams.set('page', '1');
    url.searchParams.set('output', 'json');

    const data = await fetchJson(url.href, 12000);
    const docs = data && data.response && Array.isArray(data.response.docs) ? data.response.docs : [];
    const candidates = docs
        .map(doc => ({ doc, score: scoreAlbumCandidate(entry, doc.title, doc.date, 0, Array.isArray(doc.creator) ? doc.creator.join(', ') : doc.creator) }))
        .filter(item => item.score >= 0.50)
        .sort((a, b) => b.score - a.score);

    const best = candidates[0] ? candidates[0].doc : null;
    if (!best || !best.identifier) return null;

    return {
        title: best.title || entry.title,
        artist: Array.isArray(best.creator) ? best.creator.join(', ') : (best.creator || ''),
        imageSrc: `https://archive.org/services/img/${encodeURIComponent(best.identifier)}`,
        href: `https://archive.org/details/${encodeURIComponent(best.identifier)}`,
        source: 'Internet Archive'
    };
}

async function resolveGoogleCustomSearchCover(entry, apiKey, cx) {
    const query = `${entry.title}${entry.year ? ` ${entry.year}` : ''} album cover`;
    const url = new URL('https://www.googleapis.com/customsearch/v1');
    url.searchParams.set('key', apiKey);
    url.searchParams.set('cx', cx);
    url.searchParams.set('searchType', 'image');
    url.searchParams.set('num', '5');
    url.searchParams.set('safe', 'off');
    url.searchParams.set('q', query);

    const data = await fetchJson(url.href, 12000);
    const items = Array.isArray(data.items) ? data.items : [];
    const best = items[0];
    if (!best || !best.link) return null;

    return {
        title: entry.title,
        artist: '',
        imageSrc: best.link,
        href: best.image && best.image.contextLink ? best.image.contextLink : '',
        source: 'Google CSE'
    };
}

async function fetchMusicBrainzJson(url) {
    const elapsed = Date.now() - lastMusicBrainzRequestAt;
    if (elapsed < MUSICBRAINZ_DELAY_MS) {
        await delay(MUSICBRAINZ_DELAY_MS - elapsed);
    }
    lastMusicBrainzRequestAt = Date.now();
    return fetchJson(url, 15000);
}

async function fetchJson(url, timeoutMs) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs || 12000);

    try {
        const response = await fetch(url, {
            cache: 'force-cache',
            signal: controller.signal
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        return await response.json();
    } finally {
        clearTimeout(timeoutId);
    }
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function loadAlbumCardsFromIndex(indexUrl) {
    const response = await fetch(indexUrl, { cache: 'no-cache' });
    if (!response.ok) {
        throw new Error(`Could not fetch index.html: ${response.status}`);
    }
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return Array.from(doc.querySelectorAll('#album-grid .album'));
}

function buildAlbumCatalog(albumCards, baseUrl) {
    const records = [];
    const lookup = new Map();

    albumCards.forEach((card, index) => {
        const titleElement = card.querySelector('.album-link strong') || card.querySelector('.album-link');
        const artistParagraphs = Array.from(card.querySelectorAll('p'));
        const image = card.querySelector('img.thumbnail');
        const link = card.querySelector('.album-link');
        const title = titleElement ? titleElement.textContent.trim() : (image ? image.alt.trim() : '');
        const artist = artistParagraphs.length ? artistParagraphs[artistParagraphs.length - 1].textContent.trim() : '';
        const rawImageSrc = image ? image.getAttribute('src') : '';
        const rawHref = link ? link.getAttribute('href') : '';
        const rawDate = card.dataset ? (card.dataset.date || '') : '';
        const record = {
            title,
            artist,
            dataName: card.dataset ? (card.dataset.name || '') : '',
            date: rawDate,
            year: extractYear(rawDate),
            imageSrc: resolveMaybeRelativeUrl(rawImageSrc, baseUrl),
            href: resolveMaybeRelativeUrl(rawHref, baseUrl),
            index
        };

        if (!record.title) return;
        record.keys = Array.from(new Set([
            ...getTitleKeys(record.title),
            ...getTitleKeys(record.dataName)
        ].filter(Boolean)));
        records.push(record);
        record.keys.forEach(key => {
            if (!lookup.has(key)) lookup.set(key, []);
            lookup.get(key).push(record);
        });
    });

    return { records, lookup };
}

function resolveMaybeRelativeUrl(value, baseUrl) {
    if (!value) return '';
    try {
        return new URL(value, baseUrl || window.location.href).href;
    } catch (error) {
        return value;
    }
}

function parseAlbumText(text) {
    const monthPattern = '(?:jan(?:uary)?|feb(?:ruary|uary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
    const numericDatePattern = '\\d{1,2}\\/\\d{1,2}\\/\\d{2,4}';
    const datePattern = `(?:${monthPattern}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,)?\\s+\\d{4}|${monthPattern}\\.?\\s+\\d{4}|${numericDatePattern}|\\d{4})`;
    const artistAlbumDateLine = new RegExp(`^(.+?)\\s+-\\s+(.+?)\\s*\\(\\s*(${datePattern})\\s*\\)\\s*(?:\\*+)?$`, 'i');
    const albumDateLine = new RegExp(`^(.*?)\\s+-\\s+(${datePattern})\\s*(?:\\*+)?$`, 'i');
    const artistAlbumLine = /^(.+?)\s+-\s+(.+)$/;

    return String(text || '')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => Boolean(line) && !line.startsWith('#'))
        .map(line => line.replace(/^\s*\d+[.)]\s*/, '').trim())
        .map(line => {
            const originalLine = line;
            const checklistMetadata = isChecklistTopsterSource()
                ? extractChecklistOverlayMetadata(line)
                : {
                    albumLine: line,
                    checklistOverlay: '',
                    checklistOverlayImage: '',
                    checklistOverlayLabel: ''
                };
            line = checklistMetadata.albumLine;
            const checklistFields = {
                checklistOverlay: checklistMetadata.checklistOverlay,
                checklistOverlayImage: checklistMetadata.checklistOverlayImage,
                checklistOverlayLabel: checklistMetadata.checklistOverlayLabel
            };

            // Rolling Stone singer source (2008): "Name (birth date)".
            if (getTopsterDataSourceConfig().kind === 'rolling-stone-greatest-singers-of-all-time-2008-file') {
                const singerMatch = line.match(/^(.+?)\s*\((.+)\)\s*$/);
                if (singerMatch) {
                    const singerName = cleanAlbumTitle(singerMatch[1]);
                    const birthDate = singerMatch[2].trim();
                    const birthYears = Array.from(birthDate.matchAll(/\b((?:18|19|20)\d{2})\b/g)).map(match => Number(match[1])).filter(Number.isFinite);
                    const uniqueBirthYears = Array.from(new Set(birthYears));
                    return {
                        artist: '',
                        title: singerName,
                        dateText: birthDate,
                        birthDate,
                        birthYear: uniqueBirthYears[0] || null,
                        birthYearLabel: uniqueBirthYears.join('/'),
                        year: uniqueBirthYears[0] || null,
                        acts: [],
                        actsText: '',
                        wikipediaHref: getRollingStoneSingerWikipediaUrl(singerName),
                        defaultImageSrc: `rolling_stone_greatest_singers_of_all_time_2008/${rollingStoneSingerImageSlug(singerName)}.webp`,
                        singerListYear: 2008,
                        isSingerEntry: true,
                        raw: originalLine,
                        ...checklistFields
                    };
                }
            }

            // Rolling Stone's 200 Greatest Singers of All Time (2023):
            //   1. Aretha Franklin (March 25, 1942) | (Solo)
            //   12. John Lennon (October 9, 1940) | (The Quarrymen; The Beatles; Plastic Ono Band)
            // The source's date is the singer's birth date; entry.year intentionally
            // stores the birth year so the standard "year" overlay can display it.
            if (getTopsterDataSourceConfig().kind === 'rolling-stone-greatest-singers-of-all-time-2023-file') {
                const singerMatch = line.match(/^(.+?)\s*\(\s*([^()]*?\b(?:18|19|20)\d{2})\s*\)\s*\|\s*\((.*?)\)\s*$/);
                if (singerMatch) {
                    const singerName = cleanAlbumTitle(singerMatch[1]);
                    const birthDate = singerMatch[2].trim();
                    const actsText = singerMatch[3].trim();
                    const acts = /^solo$/i.test(actsText)
                        ? []
                        : actsText.split(/\s*;\s*/).map(value => cleanAlbumTitle(value)).filter(Boolean);
                    return {
                        artist: '',
                        title: singerName,
                        dateText: birthDate,
                        birthDate,
                        birthYear: extractYear(birthDate),
                        year: extractYear(birthDate),
                        acts,
                        actsText,
                        wikipediaHref: getRollingStoneSingerWikipediaUrl(singerName),
                        defaultImageSrc: `rolling_stone_greatest_singers_of_all_time_2023/${rollingStoneSingerImageSlug(singerName)}.png`,
                        singerListYear: 2023,
                        isSingerEntry: true,
                        raw: originalLine,
                        ...checklistFields
                    };
                }
            }

            // 1001 Albums You Must Hear Before You Die (All Editions) source format:
            //   1. Frank Sinatra - In the Wee Small Hours (1955)
            //   12. Miles Davis - Birth of the Cool (1957 [Compilation])
            // The leading numeric index is removed above. For this source, accept
            // optional bracketed metadata after the four-digit year while keeping
            // the metadata out of the album title used for cover lookup.
            if (getTopsterDataSourceConfig().kind === '1001-albums-you-must-hear-before-you-die-file') {
                const mustHearMatch = line.match(/^(.+?)\s+-\s+(.+?)\s*\(\s*(\d{4})(?:\s+\[[^\]]+\])?\s*\)\s*$/);
                if (mustHearMatch) {
                    return {
                        artist: cleanAlbumTitle(mustHearMatch[1]),
                        title: cleanAlbumTitle(mustHearMatch[2]),
                        dateText: mustHearMatch[3].trim(),
                        year: extractYear(mustHearMatch[3]),
                        raw: originalLine,
                        ...checklistFields
                    };
                }
            }

            // NME's 500 Greatest Albums Of All Time source format:
            //   1 - The Smiths - The Queen Is Dead
            // Preserve everything after the second separator as the album title so
            // punctuation and additional hyphens inside titles remain usable.
            const nmeRankArtistAlbumMatch = line.match(/^\s*\d+\s+-\s+(.+?)\s+-\s+(.+)$/);
            if (nmeRankArtistAlbumMatch) {
                return {
                    artist: cleanAlbumTitle(nmeRankArtistAlbumMatch[1]),
                    title: cleanAlbumTitle(nmeRankArtistAlbumMatch[2]),
                    dateText: '',
                    year: null,
                    raw: originalLine,
                    ...checklistFields
                };
            }

            // Rolling Stone 500 (2020) source format:
            //   1 | Marvin Gaye | What's Going On | 1971
            // Keep the rank as ordering metadata only; originalIndex is assigned from file order.
            const rollingStonePipeMatch = line.match(/^\s*\d+\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(\d{4})\s*$/);
            if (rollingStonePipeMatch) {
                return {
                    artist: cleanAlbumTitle(rollingStonePipeMatch[1]),
                    title: cleanAlbumTitle(rollingStonePipeMatch[2]),
                    dateText: rollingStonePipeMatch[3].trim(),
                    year: extractYear(rollingStonePipeMatch[3]),
                    raw: originalLine,
                    ...checklistFields
                };
            }

            // Rolling Stone 500 (2003/2012/2023) source format:
            //   1. Sgt. Pepper's Lonely Hearts Club Band (1967) by The Beatles
            // Leading rank numbers have already been removed above. Match the final
            // parenthesized four-digit year so titles may themselves contain parentheses.
            const titleYearByArtistMatch = line.match(/^(.+?)\s*\(\s*(\d{4})\s*\)\s+by\s+(.+)$/i);
            if (titleYearByArtistMatch) {
                return {
                    artist: cleanAlbumTitle(titleYearByArtistMatch[3]),
                    title: cleanAlbumTitle(titleYearByArtistMatch[1]),
                    dateText: titleYearByArtistMatch[2].trim(),
                    year: extractYear(titleYearByArtistMatch[2]),
                    raw: originalLine,
                    ...checklistFields
                };
            }

            const artistAlbumDateMatch = line.match(artistAlbumDateLine);
            if (artistAlbumDateMatch) {
                return {
                    artist: cleanAlbumTitle(artistAlbumDateMatch[1]),
                    title: cleanAlbumTitle(artistAlbumDateMatch[2]),
                    dateText: artistAlbumDateMatch[3].trim(),
                    year: extractYear(artistAlbumDateMatch[3]),
                    raw: originalLine,
                    ...checklistFields
                };
            }

            const albumDateMatch = line.match(albumDateLine);
            if (albumDateMatch) {
                return {
                    artist: '',
                    title: cleanAlbumTitle(albumDateMatch[1]),
                    dateText: albumDateMatch[2].trim(),
                    year: extractYear(albumDateMatch[2]),
                    raw: originalLine,
                    ...checklistFields
                };
            }

            const cleanedLine = line.replace(/\*+\s*$/, '').trim();
            const artistAlbumMatch = cleanedLine.match(artistAlbumLine);
            if (artistAlbumMatch) {
                return {
                    artist: cleanAlbumTitle(artistAlbumMatch[1]),
                    title: cleanAlbumTitle(artistAlbumMatch[2]),
                    dateText: '',
                    year: extractYear(cleanedLine),
                    raw: originalLine,
                    ...checklistFields
                };
            }

            return {
                artist: '',
                title: cleanAlbumTitle(cleanedLine),
                dateText: '',
                year: extractYear(cleanedLine),
                raw: originalLine,
                    ...checklistFields
            };
        })
        .filter(entry => entry.title.length > 0);
}

function findAlbumMatch(title, catalog, year) {
    const keys = getTitleKeys(title);
    for (const key of keys) {
        const matches = catalog.lookup.get(key);
        if (matches && matches.length) {
            return pickBestYearMatch(matches, year);
        }
    }

    const compactTitle = normalizeAlbumTitle(title);
    if (compactTitle.length >= 8) {
        const fuzzyMatches = catalog.records.filter(record => {
            return record.keys.some(key => {
                if (key.length < 8) return false;
                return key.includes(compactTitle) || compactTitle.includes(key);
            });
        });
        if (fuzzyMatches.length) return pickBestYearMatch(fuzzyMatches, year);
    }

    return null;
}

function pickBestYearMatch(matches, year) {
    if (!year) return matches[0];
    return [...matches].sort((a, b) => {
        const diffA = a.year ? Math.abs(a.year - year) : 999;
        const diffB = b.year ? Math.abs(b.year - year) : 999;
        return diffA - diffB;
    })[0];
}

function getTitleKeys(title) {
    const clean = cleanAlbumTitle(title);
    const withoutLeadingArticle = clean.replace(/^the\s+/i, '');
    const compact = normalizeAlbumTitle(clean);
    const compactNoArticle = normalizeAlbumTitle(withoutLeadingArticle);
    return Array.from(new Set([compact, compactNoArticle].filter(Boolean)));
}

function cleanAlbumTitle(title) {
    return String(title || '')
        .replace(/\s+/g, ' ')
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201C\u201D]/g, '"')
        .trim();
}

function normalizeAlbumTitle(title) {
    return cleanAlbumTitle(title)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/&/g, 'and')
        .replace(/\bvol(?:ume)?\b/g, 'volume')
        .replace(/\bno\.?\b/g, 'number')
        // Preserve Unicode letters/numbers. The old ASCII-only expression turned
        // titles such as 宇宙 日本 世田谷 into an empty cache identity, causing RYM's
        // correctly extracted thumbnail to be rejected later as a mismatch.
        .replace(/[^\p{L}\p{N}]+/gu, '');
}

// Most album identities are naturally represented by letters/numbers. Some real
// titles, however, are punctuation-only (notably Sigur Rós - "( )"). Preserve
// those as a deterministic code-point key instead of collapsing them to an empty
// string, while keeping ordinary fuzzy/title matching behavior unchanged.
function normalizeAlbumIdentityKey(value) {
    const normal = normalizeAlbumTitle(value || '');
    if (normal) return normal;

    const punctuation = cleanAlbumTitle(value || '')
        .normalize('NFKC')
        .toLocaleLowerCase()
        .replace(/\s+/gu, '');
    if (!punctuation) return '';

    return `__punct_${Array.from(punctuation)
        .map(character => character.codePointAt(0).toString(16))
        .join('_')}`;
}

function tokenizeTitle(title) {
    const stopWords = new Set(['the', 'a', 'an', 'and', 'of', 'in', 'to', 'with', 'for']);
    return cleanAlbumTitle(title)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .split(/\s+/u)
        .filter(token => token && !stopWords.has(token));
}

function scoreAlbumCandidate(entry, candidateTitle, candidateDate, sourceScore, candidateArtist = '') {
    const titleScore = titleSimilarity(entry.title, candidateTitle);
    const candidateYear = extractYear(candidateDate);
    let yearScore = 0;
    let artistScore = 0;

    if (entry.year && candidateYear) {
        const yearDiff = Math.abs(entry.year - candidateYear);
        if (yearDiff === 0) yearScore = 0.18;
        else if (yearDiff === 1) yearScore = 0.08;
        else if (yearDiff <= 3) yearScore = -0.08;
        else yearScore = -0.28;
    }

    if (entry.artist && candidateArtist) {
        const similarity = titleSimilarity(entry.artist, candidateArtist);

        // An exact/common album title is not enough to identify a release. A
        // candidate credited to a genuinely unrelated artist must never win just
        // because titles such as "Faith", "Greatest Hits", or "Anthology" match.
        if (similarity < 0.18) {
            const apiScore = sourceScore ? Math.min(sourceScore, 100) / 1000 : 0;
            return Math.min(0.29, titleScore + yearScore + apiScore);
        }

        if (similarity >= 0.90) artistScore = 0.22;
        else if (similarity >= 0.60) artistScore = 0.14;
        else if (similarity >= 0.32) artistScore = 0.05;
        else artistScore = -0.15;
    }

    const apiScore = sourceScore ? Math.min(sourceScore, 100) / 1000 : 0;
    return titleScore + yearScore + artistScore + apiScore;
}

function titleSimilarity(a, b) {
    const compactA = normalizeAlbumIdentityKey(a);
    const compactB = normalizeAlbumIdentityKey(b);
    if (!compactA || !compactB) return 0;
    if (compactA === compactB) return 1;
    if (compactA.startsWith('__punct_') || compactB.startsWith('__punct_')) return 0;
    if (compactA.length >= 8 && compactB.length >= 8 && (compactA.includes(compactB) || compactB.includes(compactA))) return 0.82;

    const tokensA = new Set(tokenizeTitle(a));
    const tokensB = new Set(tokenizeTitle(b));
    if (!tokensA.size || !tokensB.size) return 0;

    let intersection = 0;
    tokensA.forEach(token => {
        if (tokensB.has(token)) intersection++;
    });
    const union = new Set([...tokensA, ...tokensB]).size;
    return union ? intersection / union : 0;
}

function extractYear(value) {
    const match = String(value || '').match(/\b(18|19|20)\d{2}\b/);
    return match ? Number(match[0]) : null;
}

function firstArtistCreditName(artistCredit) {
    if (!Array.isArray(artistCredit) || !artistCredit.length) return '';
    return artistCredit
        .map(credit => credit && credit.name ? credit.name : '')
        .filter(Boolean)
        .join(', ');
}

function upscaleItunesArtwork(url) {
    return String(url || '')
        .replace(/\/\d+x\d+bb\.(jpg|png|webp)$/i, '/600x600bb.$1')
        .replace(/\d+x\d+bb\.(jpg|png|webp)$/i, '600x600bb.$1');
}

function getLastfmImage(images) {
    const preferredSizes = ['mega', 'extralarge', 'large', 'medium', 'small'];
    for (const size of preferredSizes) {
        const match = images.find(image => image.size === size && image['#text']);
        if (match) return match['#text'];
    }
    const fallback = images.find(image => image['#text']);
    return fallback ? fallback['#text'] : '';
}

function buildCoverCacheKey(entry) {
    return `${normalizeAlbumTitle(entry.artist || '')}|${normalizeAlbumIdentityKey(entry.title)}|${entry.year || ''}`;
}

function buildCoverCacheAliases(entry) {
    const artistKey = normalizeAlbumTitle(entry.artist || '');
    const titleKey = normalizeAlbumIdentityKey(entry.title || '');
    const yearKey = entry.year || '';
    if (!titleKey) return [];

    // Artist identity is mandatory whenever the source entry supplies one.
    // Earlier builds also wrote |title| aliases, which caused different artists
    // with albums named Faith / Let It Be / Greatest Hits / Anthology to share
    // one cover. Artistless aliases are retained only for genuinely artistless
    // source entries (for example some non-album image lists).
    const aliases = artistKey
        ? [
            `${artistKey}|${titleKey}|${yearKey}`,
            `${artistKey}|${titleKey}|`
        ]
        : [
            `|${titleKey}|${yearKey}`,
            `|${titleKey}|`
        ];

    return Array.from(new Set(aliases.filter(key => key.replace(/\|/g, ''))));
}


function readLocalTopsterCoverCache() {
    try {
        const parsed = JSON.parse(localStorage.getItem(getTopsterCoverCacheStorageKey()) || 'null');
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
        return {};
    }
}

function writeLocalTopsterCoverCache(cache) {
    try {
        localStorage.setItem(getTopsterCoverCacheStorageKey(), JSON.stringify(cache || {}));
        return true;
    } catch (error) {
        // Some large Topster caches can exceed browser localStorage. Keep the in-memory
        // working cache so Save Settings can still publish the complete cache to Redis.
        return false;
    }
}

function scheduleTopsterEditorCoverCachePersist(delayMs = 650) {
    if (!isTopsterEditorPage()) return;
    window.clearTimeout(topsterEditorCoverCachePersistTimer);
    if (topsterEditorCoverCacheIdleHandle !== null && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(topsterEditorCoverCacheIdleHandle);
        topsterEditorCoverCacheIdleHandle = null;
    }
    topsterEditorCoverCachePersistTimer = window.setTimeout(() => {
        topsterEditorCoverCachePersistTimer = null;
        const persist = () => {
            topsterEditorCoverCacheIdleHandle = null;
            writeLocalTopsterCoverCache(getTopsterEditorWorkingCoverCache());
        };
        if (typeof window.requestIdleCallback === 'function') {
            topsterEditorCoverCacheIdleHandle = window.requestIdleCallback(persist, { timeout: 3000 });
        } else {
            window.setTimeout(persist, 0);
        }
    }, Math.max(0, Number(delayMs) || 0));
}

function cloneCoverCache(cache) {
    return cache && typeof cache === 'object' ? { ...cache } : {};
}

function getTopsterEditorWorkingCoverCache() {
    if (topsterEditorWorkingCoverCache && typeof topsterEditorWorkingCoverCache === 'object') {
        return topsterEditorWorkingCoverCache;
    }

    const sharedCache = shouldUseTopsterSharedStore()
        ? cloneCoverCache(topsterSharedCoverCache)
        : {};
    const localCache = readLocalTopsterCoverCache();

    // Seed from the published backend cache first, then overlay the host's local
    // working changes. This prevents a partially saved local cache from hiding
    // older published covers, while still letting new/manual local choices win.
    topsterEditorWorkingCoverCache = {
        ...sharedCache,
        ...localCache
    };

    return topsterEditorWorkingCoverCache;
}

function getCoverCache() {
    if (isTopsterEditorPage()) {
        return getTopsterEditorWorkingCoverCache();
    }

    if (shouldUseTopsterSharedStore()) {
        return topsterSharedCoverCache && typeof topsterSharedCoverCache === 'object'
            ? { ...topsterSharedCoverCache }
            : {};
    }

    // Public list pages must not use whatever cover cache happens to exist in a visitor's browser.
    // They should show the backend-published grid/ranked cache, or resolve covers for this session only.
    if (isTopsterReadOnlyPage()) {
        return {};
    }

    try {
        return JSON.parse(localStorage.getItem(getTopsterCoverCacheStorageKey()) || '{}')
            || JSON.parse(localStorage.getItem(TOPSTER_CACHE_KEY) || '{}')
            || {};
    } catch (error) {
        return {};
    }
}

function getCachedCover(key) {
    const cache = getCoverCache();
    const item = cache[key];
    if (!item || !item.imageSrc) return null;
    return item;
}

function cachedCoverMatchesEntryIdentity(entry, item) {
    if (!entry || !item || !item.imageSrc) return false;

    if (entry.title && item.title) {
        const entryTitleIdentity = normalizeAlbumIdentityKey(entry.title);
        const itemTitleIdentity = normalizeAlbumIdentityKey(item.title);
        if (!entryTitleIdentity || !itemTitleIdentity) return false;
        if (entryTitleIdentity !== itemTitleIdentity) {
            const titleScore = titleSimilarity(entry.title, item.title);
            if (titleScore < 0.30) return false;
        }
    }

    if (entry.artist) {
        if (!item.artist && !item.selectedManually) return false;
        if (item.artist) {
            const artistScore = titleSimilarity(entry.artist, item.artist);
            if (artistScore < 0.18) return false;
        }
    }

    return true;
}

function getExactCachedCoverForEntry(entry) {
    const item = getCachedCover(buildCoverCacheKey(entry));
    return cachedCoverMatchesEntryIdentity(entry, item) ? item : null;
}

function getPreferredCachedCover(entry) {
    const cache = getCoverCache();
    const aliases = buildCoverCacheAliases(entry);

    for (const key of aliases) {
        const item = cache[key];
        if (item && item.imageSrc && item.selectedManually && cachedCoverMatchesEntryIdentity(entry, item)) {
            return { ...item, source: item.source || 'Cache' };
        }
    }

    if (isRollingStoneSingerTopsterSource()) {
        const defaultCover = getRollingStoneSingerDefaultCover(entry);
        if (defaultCover && defaultCover.imageSrc) return defaultCover;
    }

    for (const key of aliases) {
        const item = cache[key];
        if (item && item.imageSrc && cachedCoverMatchesEntryIdentity(entry, item)) {
            return { ...item, source: item.source || 'Cache' };
        }
    }

    return null;
}

function getPreferredRateYourMusicCover(entry) {
    const cache = getCoverCache();
    const aliases = buildCoverCacheAliases(entry);

    // A user's explicit choice always wins, including over a newly imported RYM thumbnail.
    for (const key of aliases) {
        const item = cache[key];
        if (item && item.imageSrc && item.selectedManually && cachedCoverMatchesEntryIdentity(entry, item)) {
            return { ...item, source: item.source || 'Manual' };
        }
    }

    // RYM Build is intentionally snapshot-driven. Automatic Last.fm / Archive /
    // MusicBrainz / iTunes covers left in an older cache are not valid defaults here.
    for (const key of aliases) {
        const item = cache[key];
        if (!item || !item.imageSrc || !cachedCoverMatchesEntryIdentity(entry, item)) continue;
        const source = String(item.source || '').trim().toLocaleLowerCase();
        if (source === 'rateyourmusic thumbnail') {
            return { ...item, source: 'RateYourMusic thumbnail' };
        }
    }

    return null;
}

function setCachedCover(key, cover) {
    if (!key || !cover || !cover.imageSrc) return;
    const cache = getCoverCache();
    const cachedCover = {
        title: cover.title || '',
        artist: cover.artist || '',
        imageSrc: cover.imageSrc,
        href: cover.href || '',
        source: cover.source || '',
        selectedManually: Boolean(cover.selectedManually),
        savedAt: new Date().toISOString()
    };

    cache[key] = cachedCover;

    const keyParts = typeof key === 'string' ? key.split('|') : [];
    const artistForAlias = keyParts[0] || cachedCover.artist || '';
    const titleForAlias = keyParts[1] || cachedCover.title || '';
    const yearForAlias = keyParts[2] || '';
    buildCoverCacheAliases({ artist: artistForAlias, title: titleForAlias, year: yearForAlias }).forEach(alias => {
        cache[alias] = cachedCover;
    });

    if (isTopsterEditorPage()) {
        topsterEditorWorkingCoverCache = cache;
        // Persisting a 1,000+ album cache requires a large JSON.stringify. Debounce
        // that work so a manual cover selection can update the visible tile first.
        scheduleTopsterEditorCoverCachePersist();
        safeMarkTopsterPublishDirty();
        return;
    }

    if (shouldUseTopsterSharedStore()) {
        topsterSharedCoverCache = cache;
        return;
    }

    // Public read-only album_list pages must not create per-visitor persistent cover choices.
    if (isTopsterReadOnlyPage()) {
        return;
    }

    try {
        localStorage.setItem(getTopsterCoverCacheStorageKey(), JSON.stringify(cache));
    } catch (error) {
        // Browser storage can fill up; failing to cache should not prevent the grid from rendering.
    }
}

function invalidateCachedCover(entry, failedImageSrc) {
    if (!entry || !failedImageSrc) return;
    const failedKey = normalizeImageUrl(failedImageSrc);
    if (!failedKey) return;

    const cache = getCoverCache();
    const keys = new Set([buildCoverCacheKey(entry), ...buildCoverCacheAliases(entry)]);
    let changed = false;
    keys.forEach(key => {
        const item = cache[key];
        if (!item || normalizeImageUrl(item.imageSrc) !== failedKey) return;
        delete cache[key];
        changed = true;
    });
    if (!changed) return;

    if (isTopsterEditorPage()) {
        topsterEditorWorkingCoverCache = cache;
        scheduleTopsterEditorCoverCachePersist();
    } else if (shouldUseTopsterSharedStore()) {
        topsterSharedCoverCache = cache;
    } else if (!isTopsterReadOnlyPage()) {
        try {
            localStorage.setItem(getTopsterCoverCacheStorageKey(), JSON.stringify(cache));
        } catch (error) {
            // Cache invalidation is best-effort.
        }
    }
}

function isValidImageUrl(value) {
    try {
        const parsed = new URL(String(value || '').trim());
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch (error) {
        return false;
    }
}


function getManualSourceLabel(source) {
    const labels = {
        all: 'all sources',
        lastfm: 'Last.fm',
        internetarchive: 'Internet Archive',
        musicbrainz: 'MusicBrainz + Cover Art Archive',
        itunes: 'Apple iTunes Search API',
        cache: 'saved local cover cache'
    };
    return labels[source] || source;
}

async function resolveLastfmArtistImageCandidates(artistName, apiKey, relationLabel = 'Artist') {
    if (!artistName || !apiKey) return [];
    const candidates = [];

    try {
        const infoUrl = new URL('https://ws.audioscrobbler.com/2.0/');
        infoUrl.searchParams.set('method', 'artist.getinfo');
        infoUrl.searchParams.set('artist', artistName);
        infoUrl.searchParams.set('api_key', apiKey);
        infoUrl.searchParams.set('format', 'json');
        const infoData = await fetchJson(infoUrl.href, 12000);
        const artist = infoData && infoData.artist ? infoData.artist : null;
        const imageSrc = artist && Array.isArray(artist.image) ? getLastfmImage(artist.image) : '';
        if (artist && isUsefulLastfmImage(imageSrc)) {
            candidates.push(makeCoverCandidate({
                title: artist.name || artistName,
                artist: relationLabel,
                imageSrc,
                href: artist.url || '',
                source: `Last.fm · ${relationLabel}`,
                score: 1
            }));
        }
    } catch (error) {
        // artist.search below can still provide results.
    }

    try {
        const searchUrl = new URL('https://ws.audioscrobbler.com/2.0/');
        searchUrl.searchParams.set('method', 'artist.search');
        searchUrl.searchParams.set('artist', artistName);
        searchUrl.searchParams.set('api_key', apiKey);
        searchUrl.searchParams.set('format', 'json');
        searchUrl.searchParams.set('limit', '8');
        const data = await fetchJson(searchUrl.href, 12000);
        const matches = data && data.results && data.results.artistmatches && Array.isArray(data.results.artistmatches.artist)
            ? data.results.artistmatches.artist
            : [];
        matches.forEach(match => {
            const imageSrc = Array.isArray(match.image) ? getLastfmImage(match.image) : '';
            if (!isUsefulLastfmImage(imageSrc)) return;
            const similarity = titleSimilarity(artistName, match.name || '');
            if (similarity < 0.34) return;
            candidates.push(makeCoverCandidate({
                title: match.name || artistName,
                artist: relationLabel,
                imageSrc,
                href: match.url || '',
                source: `Last.fm · ${relationLabel}`,
                score: similarity
            }));
        });
    } catch (error) {
        // Continue with Wikipedia/Archive candidates.
    }

    return candidates;
}

async function resolveWikipediaArtistImageCandidates(artistName, relationLabel = 'Artist') {
    if (!artistName) return [];
    const url = new URL('https://en.wikipedia.org/w/api.php');
    url.searchParams.set('action', 'query');
    url.searchParams.set('generator', 'search');
    url.searchParams.set('gsrsearch', artistName);
    url.searchParams.set('gsrnamespace', '0');
    url.searchParams.set('gsrlimit', '5');
    url.searchParams.set('prop', 'pageimages|info');
    url.searchParams.set('piprop', 'thumbnail');
    url.searchParams.set('pithumbsize', '900');
    url.searchParams.set('inprop', 'url');
    url.searchParams.set('format', 'json');
    url.searchParams.set('origin', '*');

    const data = await fetchJson(url.href, 12000);
    const pages = data && data.query && data.query.pages ? Object.values(data.query.pages) : [];
    return pages
        .filter(page => page && page.thumbnail && page.thumbnail.source)
        .map(page => makeCoverCandidate({
            title: page.title || artistName,
            artist: relationLabel,
            imageSrc: page.thumbnail.source,
            href: page.fullurl || getRollingStoneSingerWikipediaUrl(page.title || artistName),
            source: `Wikipedia · ${relationLabel}`,
            score: titleSimilarity(artistName, page.title || '')
        }))
        .filter(candidate => candidate.score >= 0.22)
        .sort((a, b) => (b.score || 0) - (a.score || 0));
}

async function resolveInternetArchiveArtistImageCandidates(artistName) {
    if (!artistName) return [];
    const safeName = artistName.replace(/"/g, '');
    const url = new URL('https://archive.org/advancedsearch.php');
    url.searchParams.set('q', `mediatype:(image) AND (title:("${safeName}") OR creator:("${safeName}"))`);
    url.searchParams.append('fl[]', 'identifier');
    url.searchParams.append('fl[]', 'title');
    url.searchParams.append('fl[]', 'creator');
    url.searchParams.set('rows', '8');
    url.searchParams.set('page', '1');
    url.searchParams.set('output', 'json');

    const data = await fetchJson(url.href, 12000);
    const docs = data && data.response && Array.isArray(data.response.docs) ? data.response.docs : [];
    return docs
        .filter(doc => doc && doc.identifier)
        .map(doc => makeCoverCandidate({
            title: doc.title || artistName,
            artist: Array.isArray(doc.creator) ? doc.creator.join(', ') : (doc.creator || 'Artist image'),
            imageSrc: `https://archive.org/services/img/${encodeURIComponent(doc.identifier)}`,
            href: `https://archive.org/details/${encodeURIComponent(doc.identifier)}`,
            source: 'Internet Archive · Artist image',
            score: titleSimilarity(artistName, doc.title || artistName)
        }))
        .filter(candidate => candidate.score >= 0.20);
}

async function resolveRollingStoneSingerImageCandidates(entry, config) {
    await hydrateRollingStoneSingerActs(entry);
    const candidates = [];
    const defaultCover = getRollingStoneSingerDefaultCover(entry);
    if (defaultCover) candidates.push(defaultCover);

    const lookupNames = getRollingStoneSingerLookupNames(entry);
    for (let index = 0; index < lookupNames.length; index += 1) {
        const lookupName = lookupNames[index];
        const relationLabel = index === 0 ? 'Singer' : `Act: ${lookupName}`;
        const tasks = [
            resolveWikipediaArtistImageCandidates(lookupName, relationLabel)
        ];
        if (config && config.useLastfm && config.lastfmKey) {
            tasks.unshift(resolveLastfmArtistImageCandidates(lookupName, config.lastfmKey, relationLabel));
        }

        const groups = await Promise.all(tasks.map(task => Promise.resolve(task).catch(() => [])));
        groups.forEach(group => candidates.push(...group));
    }

    try {
        candidates.push(...await resolveInternetArchiveArtistImageCandidates(entry.title));
    } catch (error) {
        // Optional archive image lookup.
    }

    candidates.push(...resolveCacheCoverCandidates(entry));
    return dedupeCoverCandidates(candidates).slice(0, 50);
}

async function resolveManualCoverCandidates(entry, selectedSource, config) {
    const sourceOrder = selectedSource === 'all'
        ? ['lastfm', 'internetarchive', 'musicbrainz', 'itunes', 'cache']
        : [selectedSource];

    const candidates = [];
    for (const source of sourceOrder) {
        try {
            let sourceCandidates = [];
            if (source === 'lastfm') {
                sourceCandidates = await resolveLastfmCoverCandidates(entry, config.lastfmKey);
            } else if (source === 'internetarchive') {
                sourceCandidates = await resolveInternetArchiveCoverCandidates(entry);
            } else if (source === 'musicbrainz') {
                sourceCandidates = await resolveMusicBrainzCoverCandidates(entry);
            } else if (source === 'itunes') {
                sourceCandidates = await resolveItunesCoverCandidates(entry);
            } else if (source === 'cache') {
                sourceCandidates = resolveCacheCoverCandidates(entry);
            }
            candidates.push(...sourceCandidates);
        } catch (error) {
            // Continue polling the remaining sources if one source fails.
        }
    }

    return dedupeCoverCandidates(candidates).slice(0, 40);
}

async function resolveLastfmCoverCandidates(entry, apiKey) {
    if (!apiKey) return [];
    const candidates = [];

    if (entry.artist) {
        try {
            const infoUrl = new URL('https://ws.audioscrobbler.com/2.0/');
            infoUrl.searchParams.set('method', 'album.getinfo');
            infoUrl.searchParams.set('artist', entry.artist);
            infoUrl.searchParams.set('album', entry.title);
            infoUrl.searchParams.set('api_key', apiKey);
            infoUrl.searchParams.set('format', 'json');
            const infoData = await fetchJson(infoUrl.href, 12000);
            const album = infoData && infoData.album ? infoData.album : null;
            const images = album && Array.isArray(album.image) ? album.image : [];
            const imageSrc = getLastfmImage(images);
            const identityScore = album
                ? scoreAlbumCandidate(entry, album.name || entry.title, '', 0, album.artist || '')
                : 0;
            if (album && identityScore >= 0.30 && isUsefulLastfmImage(imageSrc)) {
                candidates.push(makeCoverCandidate({
                    title: album.name || entry.title,
                    artist: album.artist || entry.artist || '',
                    imageSrc,
                    href: album.url || '',
                    source: 'Last.fm',
                    score: identityScore
                }));
            }
        } catch (error) {
            // Album search below usually still works when album.getinfo misses.
        }
    }

    const searchAlbum = `${entry.artist ? `${entry.artist} ` : ''}${entry.title}`;
    const url = `https://ws.audioscrobbler.com/2.0/?method=album.search&album=${encodeURIComponent(searchAlbum)}&api_key=${encodeURIComponent(apiKey)}&format=json&limit=20`;
    const data = await fetchJson(url, 12000);
    const matches = data && data.results && data.results.albummatches && Array.isArray(data.results.albummatches.album)
        ? data.results.albummatches.album
        : [];

    matches.forEach(album => {
        const images = Array.isArray(album.image) ? album.image : [];
        const imageSrc = getLastfmImage(images);
        if (!isUsefulLastfmImage(imageSrc)) return;
        const score = scoreAlbumCandidate(entry, album.name, '', 0, album.artist);
        if (score < 0.34) return;
        candidates.push(makeCoverCandidate({
            title: album.name || entry.title,
            artist: album.artist || entry.artist || '',
            imageSrc,
            href: album.url || '',
            source: 'Last.fm',
            score
        }));
    });

    return candidates.sort((a, b) => (b.score || 0) - (a.score || 0));
}

async function resolveInternetArchiveCoverCandidates(entry) {
    const url = new URL('https://archive.org/advancedsearch.php');
    const safeTitle = entry.title.replace(/"/g, '');
    const safeArtist = String(entry.artist || '').replace(/"/g, '');
    const queryParts = [`title:("${safeTitle}")`, 'mediatype:(audio)'];
    if (safeArtist) queryParts.push(`creator:("${safeArtist}")`);
    url.searchParams.set('q', queryParts.join(' AND '));
    url.searchParams.append('fl[]', 'identifier');
    url.searchParams.append('fl[]', 'title');
    url.searchParams.append('fl[]', 'creator');
    url.searchParams.append('fl[]', 'date');
    url.searchParams.set('rows', '20');
    url.searchParams.set('page', '1');
    url.searchParams.set('output', 'json');

    const data = await fetchJson(url.href, 12000);
    const docs = data && data.response && Array.isArray(data.response.docs) ? data.response.docs : [];
    return docs
        .map(doc => {
            const artist = Array.isArray(doc.creator) ? doc.creator.join(', ') : (doc.creator || '');
            return makeCoverCandidate({
                title: doc.title || entry.title,
                artist,
                imageSrc: doc.identifier ? `https://archive.org/services/img/${encodeURIComponent(doc.identifier)}` : '',
                href: doc.identifier ? `https://archive.org/details/${encodeURIComponent(doc.identifier)}` : '',
                source: 'Internet Archive',
                score: scoreAlbumCandidate(entry, doc.title, doc.date, 0, artist)
            });
        })
        .filter(candidate => candidate.imageSrc && candidate.score >= 0.30)
        .sort((a, b) => (b.score || 0) - (a.score || 0));
}

async function resolveMusicBrainzCoverCandidates(entry) {
    const query = buildMusicBrainzQuery(entry);
    const searchUrl = `https://musicbrainz.org/ws/2/release-group/?query=${encodeURIComponent(query)}&fmt=json&limit=12`;
    const data = await fetchMusicBrainzJson(searchUrl);
    const groups = Array.isArray(data['release-groups']) ? data['release-groups'] : [];
    const groupsToCheck = groups
        .map(group => ({
            group,
            score: scoreAlbumCandidate(entry, group.title, group['first-release-date'], Number(group.score) || 0, firstArtistCreditName(group['artist-credit']))
        }))
        .filter(item => item.score >= 0.30)
        .sort((a, b) => b.score - a.score)
        .slice(0, 8);

    const candidates = [];
    for (const item of groupsToCheck) {
        const mbid = item.group.id;
        if (!mbid) continue;
        const cover = await fetchCoverArtArchiveForReleaseGroup(mbid);
        if (!cover || !cover.imageSrc) continue;
        candidates.push(makeCoverCandidate({
            title: item.group.title || entry.title,
            artist: firstArtistCreditName(item.group['artist-credit']),
            imageSrc: cover.imageSrc,
            href: `https://musicbrainz.org/release-group/${mbid}`,
            source: 'MusicBrainz/CAA',
            score: item.score
        }));
    }
    return candidates;
}

async function resolveItunesCoverCandidates(entry) {
    const searchTerm = `${entry.artist ? `${entry.artist} ` : ''}${entry.title}${entry.year ? ` ${entry.year}` : ''}`;
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(searchTerm)}&entity=album&limit=20`;
    const data = await fetchJson(url, 12000);
    const results = Array.isArray(data.results) ? data.results : [];
    return results
        .map(result => makeCoverCandidate({
            title: result.collectionName || entry.title,
            artist: result.artistName || entry.artist || '',
            imageSrc: result.artworkUrl100 ? upscaleItunesArtwork(result.artworkUrl100) : '',
            href: result.collectionViewUrl || '',
            source: 'iTunes',
            score: scoreAlbumCandidate(entry, result.collectionName, result.releaseDate, 0, result.artistName)
        }))
        .filter(candidate => candidate.imageSrc && candidate.score >= 0.30)
        .sort((a, b) => (b.score || 0) - (a.score || 0));
}

function resolveCacheCoverCandidates(entry) {
    const exact = getExactCachedCoverForEntry(entry);
    const candidates = [];
    if (exact && exact.imageSrc) {
        candidates.push(makeCoverCandidate({ ...exact, source: exact.source || 'Cache', score: 1 }));
    }

    const cache = getCoverCache();
    Object.values(cache).forEach(item => {
        if (!item || !item.imageSrc) return;
        const score = scoreAlbumCandidate(entry, item.title, '', 0, item.artist);
        if (score < 0.30) return;
        candidates.push(makeCoverCandidate({
            title: item.title || entry.title,
            artist: item.artist || entry.artist || '',
            imageSrc: item.imageSrc,
            href: item.href || '',
            source: item.source || 'Cache',
            score
        }));
    });

    return dedupeCoverCandidates(candidates).sort((a, b) => (b.score || 0) - (a.score || 0));
}

function makeCoverCandidate(candidate) {
    return {
        title: cleanAlbumTitle(candidate.title || ''),
        artist: cleanAlbumTitle(candidate.artist || ''),
        imageSrc: candidate.imageSrc || '',
        href: candidate.href || '',
        source: candidate.source || '',
        score: Number(candidate.score) || 0
    };
}

function dedupeCoverCandidates(candidates) {
    const seen = new Set();
    const unique = [];
    candidates.forEach(candidate => {
        if (!candidate || !candidate.imageSrc) return;
        const key = normalizeImageUrl(candidate.imageSrc);
        if (!key || seen.has(key)) return;
        seen.add(key);
        unique.push(candidate);
    });
    return unique;
}

function normalizeImageUrl(url) {
    return String(url || '').trim().replace(/^http:/i, 'https:').replace(/([?&])_=[^&]+/g, '$1');
}

function formatCandidateName(candidate) {
    const artist = cleanAlbumTitle(candidate.artist || '');
    const title = cleanAlbumTitle(candidate.title || '');
    if (artist && title) return `${artist} - ${title}`;
    return title || artist || 'Album cover';
}

function isUsefulLastfmImage(imageSrc) {
    return Boolean(imageSrc) && !String(imageSrc).includes('2a96cbd8b46e442fc41c2b86b821562f');
}

function createTopsterTile(entry, displayIndex, onSelectCover, coverOverlayMode = 'none', excludeOwnedReleases = false, onRetryCover = null, onCoverLoadError = null) {
    const tile = document.createElement('div');
    tile.className = 'topster-tile';
    tile.dataset.topsterEntryIndex = String(Math.max(0, (Number(displayIndex) || 1) - 1));
    let mobileInfoTimer = null;
    const isSelectableTile = typeof onSelectCover === 'function';

    if (!entry) {
        const empty = document.createElement('div');
        empty.className = 'topster-tile-empty';
        empty.textContent = String(displayIndex);
        tile.appendChild(empty);
        return tile;
    }

    const cover = entry.cover;
    const label = `${displayIndex}. ${formatEntryName(entry)}`;
    const overlayText = getTopsterCoverOverlayText(entry, displayIndex, coverOverlayMode);

    const makeRetryablePlaceholder = placeholder => {
        if (!placeholder || typeof onRetryCover !== 'function') return;
        placeholder.classList.add('topster-tile-retryable');
        placeholder.setAttribute('role', 'button');
        placeholder.setAttribute('tabindex', '0');
        placeholder.setAttribute('title', `${label} — click to retry album cover`);
        placeholder.setAttribute('aria-label', `${label}. Album cover did not load. Click to retry.`);
        placeholder.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            onRetryCover();
        });
        placeholder.addEventListener('keydown', event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            event.stopPropagation();
            onRetryCover();
        });
    };

    const showMobileInfo = event => {
        if (isSelectableTile || !isTopsterTouchTooltipDevice()) return false;
        event.preventDefault();
        event.stopPropagation();
        toggleTopsterMobileTileInfo(tile, true, () => {
            window.clearTimeout(mobileInfoTimer);
            mobileInfoTimer = null;
        });
        window.clearTimeout(mobileInfoTimer);
        mobileInfoTimer = window.setTimeout(() => {
            toggleTopsterMobileTileInfo(tile, false);
            mobileInfoTimer = null;
        }, 10000);
        return true;
    };

    if (typeof onSelectCover === 'function') {
        tile.title = `${label} — click to choose a cover`;
        tile.classList.add('topster-tile-selectable');
        tile.setAttribute('role', 'button');
        tile.setAttribute('tabindex', '0');
        tile.setAttribute('aria-label', `${label}. Click to choose a cover.`);
        tile.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            onSelectCover();
        });
        tile.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelectCover();
            }
        });
    } else {
        tile.title = label;
        tile.setAttribute('aria-label', label);
        tile.addEventListener('click', event => {
            if (event.target && event.target.closest && event.target.closest('.topster-rym-release-link, .topster-singer-wikipedia-link')) return;
            showMobileInfo(event);
        });
    }

    if (cover && cover.imageSrc) {
        const img = document.createElement('img');
        img.src = cover.imageSrc;
        img.alt = formatEntryName(entry) || cover.title || entry.title;
        img.loading = cover.selectedManually ? 'eager' : 'lazy';
        img.decoding = 'async';
        if (cover.selectedManually) img.fetchPriority = 'high';
        img.onerror = () => {
            const placeholder = document.createElement('div');
            placeholder.className = 'topster-tile-placeholder';
            placeholder.textContent = formatEntryName(entry) || entry.title;
            makeRetryablePlaceholder(placeholder);
            tile.innerHTML = '';
            tile.classList.remove('has-cover-overlay');
            tile.appendChild(placeholder);
            applyOwnedReleaseVisualState(tile, entry, excludeOwnedReleases);
            if (!cover.selectedManually && typeof onCoverLoadError === 'function') {
                window.setTimeout(() => onCoverLoadError(cover.imageSrc), 0);
            }
        };

        const rymReleaseHref = !onSelectCover && isRateYourMusicTopsterSource()
            ? String(entry.releaseHref || '').trim()
            : '';
        const singerWikipediaHref = !onSelectCover && isRollingStoneSingerTopsterSource()
            ? String(getRollingStoneSingerWikipediaUrl(entry.title || '') || entry.wikipediaHref || '').trim()
            : '';

        if (rymReleaseHref && /^https:\/\/(?:www\.)?rateyourmusic\.com\/release\//i.test(rymReleaseHref)) {
            const releaseLink = document.createElement('a');
            releaseLink.className = 'topster-rym-release-link';
            releaseLink.href = rymReleaseHref;
            releaseLink.setAttribute('aria-label', `${label}. Open RateYourMusic release page.`);
            releaseLink.appendChild(img);
            tile.appendChild(releaseLink);
        } else if (singerWikipediaHref && /^https:\/\/en\.wikipedia\.org\/wiki\//i.test(singerWikipediaHref)) {
            const wikipediaLink = document.createElement('a');
            wikipediaLink.className = 'topster-singer-wikipedia-link';
            wikipediaLink.href = singerWikipediaHref;
            wikipediaLink.setAttribute('aria-label', `${label}. Open Wikipedia page.`);
            wikipediaLink.appendChild(img);
            tile.appendChild(wikipediaLink);
        } else {
            tile.appendChild(img);
        }
    } else {
        const placeholder = document.createElement('div');
        placeholder.className = 'topster-tile-placeholder';
        if (entry.status === 'loading') {
            placeholder.classList.add('topster-tile-loading');
            placeholder.textContent = 'Loading...';
        } else if (entry.status === 'missing') {
            placeholder.textContent = formatEntryName(entry) || entry.title;
            makeRetryablePlaceholder(placeholder);
        } else {
            placeholder.textContent = formatEntryName(entry) || entry.title;
            makeRetryablePlaceholder(placeholder);
        }
        tile.appendChild(placeholder);
    }

    if (overlayText && cover && cover.imageSrc) {
        const overlay = document.createElement('span');
        overlay.className = `topster-cover-overlay topster-cover-overlay-length-${Math.min(String(overlayText).length, 4)}`;
        overlay.textContent = overlayText;
        tile.classList.add('has-cover-overlay');
        tile.appendChild(overlay);
    }

    if (cover && cover.imageSrc && entry.checklistOverlayImage) {
        const checklistOverlay = document.createElement('img');
        checklistOverlay.className = `topster-checklist-overlay-image topster-checklist-overlay-${entry.checklistOverlay || 'unknown'}`;
        checklistOverlay.src = resolveMaybeRelativeUrl(entry.checklistOverlayImage, window.location.href);
        checklistOverlay.alt = entry.checklistOverlayLabel || 'Checklist headphone';
        checklistOverlay.loading = 'lazy';
        checklistOverlay.onerror = () => checklistOverlay.remove();
        tile.classList.add('has-checklist-overlay');
        tile.appendChild(checklistOverlay);
    }

    applyOwnedReleaseVisualState(tile, entry, excludeOwnedReleases);

    if (!isSelectableTile && isTopsterTouchTooltipDevice()) {
        const mobileInfo = document.createElement('span');
        mobileInfo.className = `topster-mobile-tile-info ${getTopsterMobileInfoLengthClass(label)}`;
        mobileInfo.textContent = label;
        mobileInfo.setAttribute('aria-hidden', 'true');
        tile.appendChild(mobileInfo);
    }

    return tile;
}

function isTopsterTouchTooltipDevice() {
    if (typeof window === 'undefined') return false;

    const nav = typeof navigator !== 'undefined' ? navigator : null;
    const maxTouchPoints = nav && Number.isFinite(Number(nav.maxTouchPoints))
        ? Number(nav.maxTouchPoints)
        : 0;
    const userAgent = nav ? String(nav.userAgent || '') : '';
    const platform = nav ? String(nav.platform || '') : '';

    // Modern iPadOS can identify itself as Macintosh and can report a fine
    // primary pointer when a trackpad/keyboard is attached. In that state the
    // old `(hover: none) and (pointer: coarse)` test is false even though the
    // screen itself is still touch-capable, so the tap-to-reveal span was never
    // created. Detect both classic and desktop-mode iPads explicitly.
    const isIPadLike = /iPad/i.test(userAgent)
        || ((/Macintosh/i.test(userAgent) || platform === 'MacIntel') && maxTouchPoints > 1);

    if (isIPadLike) return true;
    if (typeof window.matchMedia !== 'function') return maxTouchPoints > 0;

    const coarseOrTouchPrimary = window.matchMedia(
        '(hover: none) and (pointer: coarse), (any-pointer: coarse)'
    ).matches;

    return maxTouchPoints > 0 && coarseOrTouchPrimary;
}

function getTopsterMobileInfoLengthClass(label) {
    const length = String(label || '').length;
    if (length >= 72) return 'topster-mobile-info-xlong';
    if (length >= 52) return 'topster-mobile-info-long';
    if (length >= 34) return 'topster-mobile-info-medium';
    return 'topster-mobile-info-short';
}

function toggleTopsterMobileTileInfo(tile, forceShow, onHide) {
    if (!tile) return;

    const currentlyActive = tile.classList.contains('topster-mobile-info-active');
    const show = typeof forceShow === 'boolean' ? (forceShow && !currentlyActive) : !currentlyActive;

    document.querySelectorAll('.topster-tile.topster-mobile-info-active').forEach(activeTile => {
        if (activeTile !== tile) activeTile.classList.remove('topster-mobile-info-active');
    });

    tile.classList.toggle('topster-mobile-info-active', show);
    if (!show && typeof onHide === 'function') onHide();
}

function getTopsterCoverOverlayText(entry, displayIndex, coverOverlayMode) {
    if (coverOverlayMode === 'index') return String(displayIndex);
    if (coverOverlayMode === 'year' && entry) {
        if (entry.isSingerEntry && entry.birthYearLabel) return String(entry.birthYearLabel);
        if (entry.year) return String(entry.year);
    }
    return '';
}


document.addEventListener('DOMContentLoaded', async () => {
    // Public Topster pages intentionally prepare the random quote and finish the
    // poster image request before any source/cache loading begins. This prevents
    // the Topster build from racing ahead of the movie poster.
    if (isTopsterPublicReadOnlyListPage()) {
        await waitForTopsterPublicLoadingMedia();
    }

    const authenticated = await requireTopsterAdminAccess();
    if (!authenticated) return;

    initTopsterImporter([]).catch(error => {
        console.error('Topster initialization failed:', error);
        const status = document.getElementById('topster-status');
        if (status) {
            status.textContent = `Topster initialization failed. Reload the page after clearing browser cache. Detail: ${error && error.message ? error.message : error}`;
            status.hidden = false;
        }
        failTopsterLoading(`Topster initialization failed: ${error && error.message ? error.message : error}`);
    });
});
