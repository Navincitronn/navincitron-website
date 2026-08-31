(() => {
    'use strict';

    const USERNAME = 'Navincitron';
    const STORAGE_KEY = 'navincitron-lastfm-topster-v1';
    const BACKEND_ORIGIN = /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname)
        ? window.location.origin
        : 'https://api.navincitron.com';
    const MAX_ITEMS = 1000;

    const defaults = {
        config: { mode: 'albums', period: '7day', start: '', end: '' },
        settings: {
            width: 10,
            height: 10,
            sidebarMode: 'artist-title',
            sidebarWidth: 20,
            sidebarTextScale: 100,
            cellCount: '',
            roundCorners: 0,
            albumGap: 4,
            coverOverlay: 'index',
            font: 'Arial'
        },
        items: [],
        meta: null,
        coverOverrides: {}
    };

    let state = structuredCloneSafe(defaults);
    let busy = false;
    let controlsDirty = false;
    let coverContextItem = null;
    let coverContextIndex = -1;
    let coverPickerItem = null;
    let coverPickerIndex = -1;
    let coverPickerRequestToken = 0;

    const $ = id => document.getElementById(id);
    const main = $('lastfm-main');
    const status = $('lastfm-status');
    const output = $('lastfm-output');
    const pages = $('lastfm-pages');
    const refreshButton = $('lastfm-refresh-button');
    const saveButton = $('lastfm-save-button');
    const modeSelect = $('lastfm-mode');
    const periodSelect = $('lastfm-period');
    const startInput = $('lastfm-start');
    const endInput = $('lastfm-end');
    const windowLabel = $('lastfm-window-label');
    const windowFields = $('lastfm-window');
    const widthInput = $('lastfm-width');
    const heightInput = $('lastfm-height');
    const widthValue = $('lastfm-width-value');
    const heightValue = $('lastfm-height-value');
    const cellCountInput = $('lastfm-cell-count');
    const sidebarSelect = $('lastfm-sidebar-mode');
    const sidebarWidthInput = $('lastfm-sidebar-width');
    const sidebarWidthValue = $('lastfm-sidebar-width-value');
    const sidebarTextSizeInput = $('lastfm-sidebar-text-size');
    const cornersSelect = $('lastfm-round-corners');
    const gapInput = $('lastfm-album-gap');
    const gapValue = $('lastfm-album-gap-value');
    const overlaySelect = $('lastfm-cover-overlay');
    const fontSelect = $('lastfm-font');
    const coverContextMenu = $('lastfm-cover-context-menu');
    const changeCoverButton = $('lastfm-change-cover-button');
    const coverPicker = $('lastfm-cover-picker');
    const coverPickerTitle = $('lastfm-cover-picker-title');
    const coverPickerClose = $('lastfm-cover-picker-close');
    const coverPickerLink = $('lastfm-cover-picker-link');
    const coverPickerLinkButton = $('lastfm-cover-picker-link-button');
    const coverPickerSearch = $('lastfm-cover-picker-search');
    const coverPickerStatus = $('lastfm-cover-picker-status');
    const coverPickerResults = $('lastfm-cover-picker-results');

    function structuredCloneSafe(value) {
        if (typeof structuredClone === 'function') {
            try { return structuredClone(value); } catch (error) { /* fall through */ }
        }
        return JSON.parse(JSON.stringify(value));
    }

    function clamp(value, min, max, fallback) {
        const number = Number(value);
        if (!Number.isFinite(number)) return fallback;
        return Math.min(max, Math.max(min, Math.round(number)));
    }

    function normalizeState(raw) {
        const source = raw && typeof raw === 'object' ? raw : {};
        const config = source.config && typeof source.config === 'object' ? source.config : {};
        const settings = source.settings && typeof source.settings === 'object' ? source.settings : {};
        const allowedModes = new Set(['albums', 'songs', 'artists', 'recent']);
        const allowedPeriods = new Set(['1day', '7day', '14day', '1month', '3month', '6month', '12month', 'overall', 'custom']);
        const allowedSidebars = new Set(['artist-title', 'title-only', 'hidden']);
        const allowedOverlays = new Set(['none', 'index', 'listens']);
        const allowedFonts = new Set(['Arial', 'Verdana', 'Helvetica Neue', 'Sans-serif', 'Monospace', 'Open Sans', 'Helvetica', 'Georgia', 'Tahoma', 'Calibri']);

        return {
            config: {
                mode: allowedModes.has(config.mode) ? config.mode : defaults.config.mode,
                period: allowedPeriods.has(config.period) ? config.period : defaults.config.period,
                start: typeof config.start === 'string' ? config.start : '',
                end: typeof config.end === 'string' ? config.end : ''
            },
            settings: {
                width: clamp(settings.width, 1, 25, defaults.settings.width),
                height: clamp(settings.height, 1, 10, defaults.settings.height),
                sidebarMode: allowedSidebars.has(settings.sidebarMode)
                    ? settings.sidebarMode
                    : (settings.sidebarMode === 'title-count' ? 'title-only' : defaults.settings.sidebarMode),
                sidebarWidth: clamp(settings.sidebarWidth, 10, 50, defaults.settings.sidebarWidth),
                sidebarTextScale: clamp(settings.sidebarTextScale, 50, 200, defaults.settings.sidebarTextScale),
                cellCount: /^\d+$/.test(String(settings.cellCount || '').trim())
                    ? String(clamp(settings.cellCount, 1, MAX_ITEMS, defaults.settings.width * defaults.settings.height))
                    : '',
                roundCorners: clamp(settings.roundCorners, 0, 24, defaults.settings.roundCorners),
                albumGap: clamp(settings.albumGap, 0, 100, defaults.settings.albumGap),
                coverOverlay: allowedOverlays.has(settings.coverOverlay) ? settings.coverOverlay : defaults.settings.coverOverlay,
                font: allowedFonts.has(settings.font) ? settings.font : defaults.settings.font
            },
            items: Array.isArray(source.items) ? source.items.slice(0, MAX_ITEMS) : [],
            meta: source.meta && typeof source.meta === 'object' ? source.meta : null,
            coverOverrides: source.coverOverrides && typeof source.coverOverrides === 'object' && !Array.isArray(source.coverOverrides)
                ? Object.fromEntries(Object.entries(source.coverOverrides).filter(([key, value]) => key && /^https?:\/\//i.test(String(value || ''))))
                : {}
        };
    }

    function loadSavedState() {
        try {
            const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
            if (parsed) state = normalizeState(parsed);
        } catch (error) {
            state = structuredCloneSafe(defaults);
        }
    }

    function saveState() {
        if (controlsDirty) {
            status.textContent = 'Settings have changed. Press Refresh to apply them before Save Settings.';
            return;
        }
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
            status.textContent = `Saved Last.fm settings and ${state.items.length} cached chart item${state.items.length === 1 ? '' : 's'}.`;
        } catch (error) {
            status.textContent = `Could not save Last.fm settings locally: ${error && error.message ? error.message : error}`;
        }
    }

    function applyStateToInputs() {
        modeSelect.value = state.config.mode;
        periodSelect.value = state.config.period;
        startInput.value = state.config.start || '';
        endInput.value = state.config.end || '';
        widthInput.value = String(state.settings.width);
        heightInput.value = String(state.settings.height);
        cellCountInput.value = state.settings.cellCount || '';
        sidebarSelect.value = state.settings.sidebarMode;
        if (sidebarWidthInput) sidebarWidthInput.value = String(state.settings.sidebarWidth);
        if (sidebarTextSizeInput) sidebarTextSizeInput.value = String(state.settings.sidebarTextScale);
        cornersSelect.value = String(state.settings.roundCorners);
        gapInput.value = String(state.settings.albumGap);
        overlaySelect.value = state.settings.coverOverlay;
        fontSelect.value = state.settings.font;
        updateValueLabels();
        updateCustomWindowVisibility();
    }

    function readInputsIntoState() {
        state.config.mode = modeSelect.value;
        state.config.period = periodSelect.value;
        state.config.start = startInput.value;
        state.config.end = endInput.value;
        state.settings.width = clamp(widthInput.value, 1, 25, 10);
        state.settings.height = clamp(heightInput.value, 1, 10, 10);
        const rawCellCount = String(cellCountInput.value || '').trim();
        state.settings.cellCount = /^\d+$/.test(rawCellCount) ? String(clamp(rawCellCount, 1, MAX_ITEMS, 100)) : '';
        state.settings.sidebarMode = sidebarSelect.value;
        state.settings.sidebarWidth = sidebarWidthInput ? clamp(sidebarWidthInput.value, 10, 50, 20) : 20;
        state.settings.sidebarTextScale = sidebarTextSizeInput ? clamp(sidebarTextSizeInput.value, 50, 200, 100) : 100;
        state.settings.roundCorners = clamp(cornersSelect.value, 0, 24, 0);
        state.settings.albumGap = clamp(gapInput.value, 0, 100, 4);
        state.settings.coverOverlay = overlaySelect.value;
        state.settings.font = fontSelect.value;
    }

    function updateValueLabels() {
        widthValue.textContent = String(widthInput.value);
        heightValue.textContent = String(heightInput.value);
        gapValue.textContent = `${gapInput.value} px`;
        if (sidebarWidthValue && sidebarWidthInput) sidebarWidthValue.textContent = `${sidebarWidthInput.value}%`;
    }

    function updateCustomWindowVisibility() {
        const custom = periodSelect.value === 'custom';
        windowLabel.hidden = !custom;
        windowFields.hidden = !custom;
        if (custom && (!startInput.value || !endInput.value)) {
            const now = new Date();
            const weekAgo = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
            if (!endInput.value) endInput.value = toLocalDateTimeValue(now);
            if (!startInput.value) startInput.value = toLocalDateTimeValue(weekAgo);
        }
    }

    function toLocalDateTimeValue(date) {
        const pad = value => String(value).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }

    function unixFromLocalInput(input) {
        const value = String(input.value || '').trim();
        if (!value) return 0;
        const ms = Date.parse(value);
        return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
    }

    function formatNumber(value) {
        return Math.max(0, Number(value) || 0).toLocaleString();
    }

    function formatListens(value) {
        const count = Math.max(0, Number(value) || 0);
        return `${formatNumber(count)} listen${count === 1 ? '' : 's'}`;
    }

    function titleForItem(item) {
        if (state.config.mode === 'artists') return item.artist || item.title || 'Unknown artist';
        return item.title || 'Unknown';
    }

    function sidebarText(item) {
        const artist = String(item.artist || '').trim();
        const title = titleForItem(item);
        const mode = state.config.mode;
        const sidebarMode = state.settings.sidebarMode;

        if (mode === 'artists') return artist || title;
        if (sidebarMode === 'title-only') return title;
        return artist ? `${artist} - ${title}` : title;
    }

    function placeholderText(item) {
        const artist = String(item.artist || '').trim();
        const title = titleForItem(item);
        return artist && artist !== title ? `${artist} - ${title}` : title;
    }

    function addListenReveal(tile, item) {
        if (!item || tile.querySelector('.lastfm-listen-info')) return;
        const info = document.createElement('div');
        info.className = 'topster-mobile-tile-info lastfm-listen-info';
        info.textContent = formatListens(item.playcount);
        tile.appendChild(info);
        tile.classList.add('lastfm-listen-clickable');
        tile.tabIndex = 0;
        tile.setAttribute('role', 'button');
        tile.setAttribute('aria-label', `${placeholderText(item)} — ${formatListens(item.playcount)}. Click to show listens.`);

        let hideTimer = 0;
        const reveal = () => {
            window.clearTimeout(hideTimer);
            tile.classList.add('topster-mobile-info-active');
            hideTimer = window.setTimeout(() => tile.classList.remove('topster-mobile-info-active'), 10000);
        };
        tile.addEventListener('click', reveal);
        tile.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                reveal();
            }
        });
    }

    function artistImageProxyUrl(item) {
        const artist = String((item && (item.artist || item.title)) || '').trim();
        if (!artist) return '';
        const url = new URL('/api/lastfm-artist-image', BACKEND_ORIGIN);
        url.searchParams.set('user', USERNAME);
        url.searchParams.set('artist', artist);
        // v61: force a fresh artist-image request so browsers cannot reuse the
        // cached v60 redirect that incorrectly pointed at the profile avatar.
        url.searchParams.set('imagev', '61');
        const artistUrl = String((item && item.url) || '').trim();
        if (artistUrl) url.searchParams.set('url', artistUrl);
        return url.href;
    }

    function coverOverrideKey(item, mode = state.config.mode) {
        if (!item) return '';
        return [mode, item.artist || '', item.title || '', item.album || '']
            .map(value => String(value).trim().toLocaleLowerCase())
            .join('\u241f');
    }

    function imageUrlForItem(item) {
        if (!item) return '';
        const override = state.coverOverrides && state.coverOverrides[coverOverrideKey(item)];
        if (override) return String(override).trim();
        if (state.config.mode === 'artists') return artistImageProxyUrl(item);
        return String(item.image || '').trim();
    }

    function renderTileArtwork(tile, item, index) {
        tile.querySelectorAll(':scope > img, :scope > .topster-tile-placeholder, :scope > .topster-tile-empty').forEach(node => node.remove());
        const beforeNode = tile.querySelector('.topster-cover-overlay, .topster-mobile-tile-info');
        const insert = node => tile.insertBefore(node, beforeNode || null);
        const imageUrl = imageUrlForItem(item);

        if (item && imageUrl) {
            const img = document.createElement('img');
            img.src = imageUrl;
            img.alt = placeholderText(item);
            img.loading = index <= 24 ? 'eager' : 'lazy';
            img.decoding = 'async';
            img.onerror = () => {
                img.remove();
                if (!tile.querySelector('.topster-tile-placeholder')) {
                    const placeholder = document.createElement('div');
                    placeholder.className = 'topster-tile-placeholder';
                    placeholder.textContent = placeholderText(item);
                    insert(placeholder);
                }
            };
            insert(img);
        } else if (item) {
            const placeholder = document.createElement('div');
            placeholder.className = 'topster-tile-placeholder';
            placeholder.textContent = placeholderText(item);
            insert(placeholder);
        } else {
            const empty = document.createElement('div');
            empty.className = 'topster-tile-empty';
            insert(empty);
        }
    }

    function createTile(item, index) {
        const tile = document.createElement('div');
        tile.className = 'topster-tile';
        tile.style.setProperty('--topster-radius', `${state.settings.roundCorners}px`);
        if (item) tile.dataset.lastfmCoverKey = coverOverrideKey(item);
        renderTileArtwork(tile, item, index);

        if (item) {
            addOverlay(tile, item, index);
            addListenReveal(tile, item);
            tile.addEventListener('contextmenu', event => {
                event.preventDefault();
                event.stopPropagation();
                openCoverContextMenu(item, index - 1, event.clientX, event.clientY);
            });
        }
        return tile;
    }

    function hideCoverContextMenu() {
        if (coverContextMenu) coverContextMenu.hidden = true;
    }

    function openCoverContextMenu(item, index, clientX, clientY) {
        if (!coverContextMenu || !item) return;
        coverContextItem = item;
        coverContextIndex = index;
        coverContextMenu.hidden = false;
        coverContextMenu.style.left = '0px';
        coverContextMenu.style.top = '0px';
        const rect = coverContextMenu.getBoundingClientRect();
        const x = Math.max(4, Math.min(Number(clientX) || 0, window.innerWidth - rect.width - 4));
        const y = Math.max(4, Math.min(Number(clientY) || 0, window.innerHeight - rect.height - 4));
        coverContextMenu.style.left = `${Math.round(x)}px`;
        coverContextMenu.style.top = `${Math.round(y)}px`;
    }

    function closeCoverPicker() {
        coverPickerRequestToken += 1;
        coverPickerItem = null;
        coverPickerIndex = -1;
        if (coverPicker) coverPicker.hidden = true;
        if (coverPickerResults) coverPickerResults.innerHTML = '';
        if (coverPickerStatus) coverPickerStatus.textContent = '';
    }

    function openCoverPicker(item, index) {
        if (!coverPicker || !item) return;
        hideCoverContextMenu();
        coverPickerItem = item;
        coverPickerIndex = index;
        if (coverPickerTitle) coverPickerTitle.textContent = `Select cover — ${placeholderText(item)}`;
        if (coverPickerLink) coverPickerLink.value = '';
        if (coverPickerResults) coverPickerResults.innerHTML = '';
        coverPicker.hidden = false;
        loadCoverPickerCandidates();
    }

    function renderCoverPickerCandidates(candidates) {
        if (!coverPickerResults) return;
        coverPickerResults.innerHTML = '';
        const usable = Array.isArray(candidates) ? candidates.filter(candidate => candidate && /^https?:\/\//i.test(String(candidate.imageSrc || ''))) : [];
        if (!usable.length) {
            if (coverPickerStatus) coverPickerStatus.textContent = 'No alternate Last.fm images were found for this page. You can still paste an image address above.';
            return;
        }

        usable.forEach((candidate, candidateIndex) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'topster-cover-choice';
            const img = document.createElement('img');
            img.src = candidate.imageSrc;
            img.alt = `Last.fm cover option ${candidateIndex + 1}`;
            img.loading = 'lazy';
            const label = document.createElement('span');
            label.textContent = candidate.source || 'Last.fm';
            button.appendChild(img);
            button.appendChild(label);
            button.addEventListener('click', () => applyManualCover(candidate.imageSrc, candidate.source || 'Last.fm'));
            coverPickerResults.appendChild(button);
        });
        if (coverPickerStatus) coverPickerStatus.textContent = `Found ${usable.length} Last.fm image option${usable.length === 1 ? '' : 's'}.`;
    }

    async function loadCoverPickerCandidates() {
        if (!coverPickerItem || !coverPickerStatus || !coverPickerResults) return;
        const requestToken = ++coverPickerRequestToken;
        coverPickerStatus.textContent = 'Loading image options from Last.fm...';
        coverPickerResults.innerHTML = '';
        try {
            const url = new URL('/api/lastfm-cover-options', BACKEND_ORIGIN);
            url.searchParams.set('user', USERNAME);
            url.searchParams.set('mode', state.config.mode);
            url.searchParams.set('artist', String(coverPickerItem.artist || ''));
            url.searchParams.set('title', String(coverPickerItem.title || ''));
            url.searchParams.set('album', String(coverPickerItem.album || ''));
            if (coverPickerItem.url) url.searchParams.set('url', String(coverPickerItem.url));
            const response = await fetch(url.href, { credentials: 'include', cache: 'no-store' });
            const payload = await response.json().catch(() => ({}));
            if (requestToken !== coverPickerRequestToken) return;
            if (!response.ok || !payload || payload.ok !== true) {
                throw new Error(payload && payload.error ? payload.error : `HTTP ${response.status}`);
            }
            renderCoverPickerCandidates(payload.candidates);
        } catch (error) {
            if (requestToken !== coverPickerRequestToken) return;
            coverPickerStatus.textContent = `Last.fm cover lookup failed: ${error && error.message ? error.message : error}`;
        }
    }

    function refreshManualCoverTiles(item) {
        const key = coverOverrideKey(item);
        pages.querySelectorAll('.topster-tile[data-lastfm-cover-key]').forEach((tile, tileIndex) => {
            if (tile.dataset.lastfmCoverKey !== key) return;
            const oneBasedIndex = Number(tile.querySelector('.topster-cover-overlay')?.textContent) || (tileIndex + 1);
            renderTileArtwork(tile, item, oneBasedIndex);
        });
    }

    function applyManualCover(imageUrl, sourceLabel) {
        if (!coverPickerItem || !/^https?:\/\//i.test(String(imageUrl || ''))) return;
        const key = coverOverrideKey(coverPickerItem);
        if (!state.coverOverrides || typeof state.coverOverrides !== 'object') state.coverOverrides = {};
        state.coverOverrides[key] = String(imageUrl).trim();
        const item = coverPickerItem;
        refreshManualCoverTiles(item);
        closeCoverPicker();
        status.textContent = `Updated the cover for ${placeholderText(item)} from ${sourceLabel || 'Last.fm'}. Press Save Settings to keep this manual cover.`;
    }

    function addOverlay(tile, item, index) {
        if (tile.querySelector('.topster-cover-overlay')) return;
        let text = '';
        if (state.settings.coverOverlay === 'index') text = String(index);
        if (state.settings.coverOverlay === 'listens') text = formatNumber(item.playcount);
        if (!text) return;
        const overlay = document.createElement('span');
        overlay.className = `topster-cover-overlay topster-cover-overlay-length-${Math.min(text.length, 4)}`;
        overlay.textContent = text;
        tile.classList.add('has-cover-overlay');
        tile.appendChild(overlay);
    }

    function pageCellCapacity() {
        return clamp(state.settings.width * state.settings.height, 1, MAX_ITEMS, 100);
    }

    function configuredCellCount() {
        const raw = String(state.settings.cellCount || '').trim();
        if (/^\d+$/.test(raw)) return clamp(raw, 1, MAX_ITEMS, pageCellCapacity());
        return pageCellCapacity();
    }

    function preferredSidebarFontSize(width, textScale = state.settings.sidebarTextScale) {
        // Preserve the automatic width-aware baseline, then let the user scale it.
        // The overflow fitter can still reduce this requested maximum when a row
        // would otherwise clip.
        const automaticBase = Math.max(3.5, Math.min(12, 14 - (Number(width) * 0.65)));
        return Math.max(2.5, Math.min(30, automaticBase * (clamp(textScale, 50, 200, 100) / 100)));
    }

    function render() {
        updateValueLabels();
        const settings = state.settings;
        const requestedCells = configuredCellCount();
        const pageCapacity = pageCellCapacity();
        const pageCount = Math.max(1, Math.ceil(requestedCells / pageCapacity));
        const visible = state.items.slice(0, requestedCells);
        pages.innerHTML = '';
        output.style.fontFamily = settings.font;
        output.classList.toggle('topster-sidebar-hidden', settings.sidebarMode === 'hidden');
        output.style.setProperty('--topster-frame-gap', '4px');

        for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
            const pageStart = pageIndex * pageCapacity;
            const page = document.createElement('section');
            page.className = 'topster-page';
            page.dataset.lastfmPage = String(pageIndex + 1);

            const layout = document.createElement('div');
            layout.className = 'topster-layout';
            if (settings.sidebarMode !== 'hidden') {
                const sidebarWidth = clamp(settings.sidebarWidth, 10, 50, 20);
                layout.style.gridTemplateColumns = `minmax(0, ${100 - sidebarWidth}fr) minmax(0, ${sidebarWidth}fr)`;
            }
            const chartWrap = document.createElement('div');
            chartWrap.className = 'topster-chart-wrap';
            const chart = document.createElement('div');
            chart.className = 'topster-chart-grid';
            chart.style.setProperty('--topster-columns', String(settings.width));
            chart.style.setProperty('--topster-rows', String(settings.height));
            chart.style.setProperty('--topster-radius', `${settings.roundCorners}px`);
            chart.style.setProperty('--topster-album-gap', `${settings.albumGap}px`);
            chart.setAttribute('aria-label', `Last.fm grid page ${pageIndex + 1} of ${pageCount}, ${settings.width} columns by ${settings.height} rows`);

            for (let localIndex = 0; localIndex < pageCapacity; localIndex += 1) {
                const globalOffset = pageStart + localIndex;
                const item = globalOffset < requestedCells ? visible[globalOffset] : null;
                chart.appendChild(createTile(item || null, globalOffset + 1));
            }
            chartWrap.appendChild(chart);
            layout.appendChild(chartWrap);

            if (settings.sidebarMode !== 'hidden') {
                const list = document.createElement('div');
                list.className = 'topster-list';
                list.style.setProperty('--topster-rows', String(settings.height));
                list.style.setProperty('--topster-album-gap', `${settings.albumGap}px`);
                list.style.fontSize = `${preferredSidebarFontSize(settings.width, settings.sidebarTextScale)}px`;

                for (let row = 0; row < settings.height; row += 1) {
                    const ol = document.createElement('ol');
                    ol.className = 'topster-list-row';
                    ol.start = pageStart + (row * settings.width) + 1;
                    for (let col = 0; col < settings.width; col += 1) {
                        const localOffset = (row * settings.width) + col;
                        const globalOffset = pageStart + localOffset;
                        if (globalOffset >= requestedCells) continue;
                        const item = visible[globalOffset];
                        if (!item) continue;
                        const li = document.createElement('li');
                        if (item.nowPlaying) li.classList.add('lastfm-now-playing');
                        const indexSpan = document.createElement('span');
                        indexSpan.className = 'topster-list-index';
                        indexSpan.textContent = `${globalOffset + 1}.`;
                        const textSpan = document.createElement('span');
                        textSpan.className = 'topster-list-text';
                        textSpan.textContent = sidebarText(item);
                        if (item.nowPlaying) textSpan.textContent += ' [now playing]';
                        li.appendChild(indexSpan);
                        li.appendChild(textSpan);
                        ol.appendChild(li);
                    }
                    list.appendChild(ol);
                }
                layout.appendChild(list);
            }

            page.appendChild(layout);
            pages.appendChild(page);
        }

        output.hidden = false;
        requestAnimationFrame(syncAllSidebarHeights);
    }

    function sidebarRowsFit(list) {
        return Array.from(list.querySelectorAll('.topster-list-row')).every(row =>
            row.scrollHeight <= row.clientHeight + 1 && row.scrollWidth <= row.clientWidth + 1
        );
    }

    function syncSidebarHeightForPage(page) {
        const chart = page.querySelector('.topster-chart-grid');
        const list = page.querySelector('.topster-list');
        if (!chart || !list) return;

        let fontSize = preferredSidebarFontSize(state.settings.width, state.settings.sidebarTextScale);
        list.style.fontSize = `${fontSize}px`;
        list.style.lineHeight = state.settings.width >= 10 ? '1.04' : '1.14';

        const stackedLayout = window.matchMedia('(max-width: 1180px), (hover: none) and (pointer: coarse)').matches;
        if (stackedLayout) {
            list.style.removeProperty('height');
            return;
        }

        const height = Math.max(1, Math.round(chart.getBoundingClientRect().height));
        list.style.height = `${height}px`;

        // Test each clipped sidebar row, not only the list as a whole. The old
        // check missed overflow because each row itself uses overflow:hidden.
        while (fontSize > 2.5 && !sidebarRowsFit(list)) {
            fontSize -= 0.5;
            list.style.fontSize = `${fontSize}px`;
        }
    }

    function syncAllSidebarHeights() {
        pages.querySelectorAll('.topster-page').forEach(syncSidebarHeightForPage);
    }

    function periodLabel(period) {
        return {
            '1day': '1 day', '7day': '1 week', '14day': '2 weeks', '1month': '1 month',
            '3month': '3 months', '6month': '6 months', '12month': '1 year', overall: 'overall', custom: 'custom window'
        }[period] || period;
    }

    function modeLabel(mode) {
        return { albums: 'albums', songs: 'songs', artists: 'artists', recent: 'recently played tracks' }[mode] || mode;
    }

    function chartRequestLimit() {
        // Cache at least one ordinary 10x10 page, but allow a requested chart
        // to span multiple Width × Height pages up to the 1,000-item ceiling.
        return Math.min(MAX_ITEMS, Math.max(100, configuredCellCount()));
    }

    async function verifyAdmin() {
        try {
            const response = await fetch(`${BACKEND_ORIGIN}/api/topster-admin-status`, { credentials: 'include', cache: 'no-store' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const payload = await response.json();
            if (payload && payload.authenticated) return true;
        } catch (error) {
            status.textContent = `Could not verify admin access: ${error && error.message ? error.message : error}`;
            main.hidden = false;
            return false;
        }
        const loginUrl = `${BACKEND_ORIGIN}/topster-admin-login?next=${encodeURIComponent(window.location.href)}`;
        window.location.replace(loginUrl);
        return false;
    }

    async function refreshData() {
        if (busy) return;
        readInputsIntoState();
        controlsDirty = false;
        updateCustomWindowVisibility();
        const config = state.config;
        let from = 0;
        let to = 0;
        if (config.period === 'custom') {
            from = unixFromLocalInput(startInput);
            to = unixFromLocalInput(endInput);
            if (!from || !to || from >= to) {
                status.textContent = 'Choose a valid custom start and end time.';
                return;
            }
        }

        busy = true;
        refreshButton.disabled = true;
        status.textContent = `Loading ${modeLabel(config.mode)} for ${periodLabel(config.period)} from Last.fm...`;
        try {
            const url = new URL('/api/lastfm-chart', BACKEND_ORIGIN);
            url.searchParams.set('user', USERNAME);
            url.searchParams.set('mode', config.mode);
            url.searchParams.set('period', config.period);
            url.searchParams.set('limit', String(chartRequestLimit()));
            if (config.period === 'custom') {
                url.searchParams.set('from', String(from));
                url.searchParams.set('to', String(to));
            }
            const response = await fetch(url.href, { credentials: 'include', cache: 'no-store' });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload || payload.ok !== true) {
                throw new Error(payload && payload.error ? payload.error : `HTTP ${response.status}`);
            }
            state.items = Array.isArray(payload.items) ? payload.items.slice(0, MAX_ITEMS) : [];
            state.meta = payload;
            render();
            const truncation = payload.truncated ? ' The custom/recent window hit the 50,000-scrobble safety cap.' : '';
            status.textContent = `Loaded ${state.items.length} ${modeLabel(config.mode)} for ${periodLabel(config.period)}.${truncation} Press Save Settings to keep this exact view after refresh.`;
        } catch (error) {
            status.textContent = `Last.fm lookup failed: ${error && error.message ? error.message : error}`;
        } finally {
            busy = false;
            refreshButton.disabled = false;
        }
    }

    function onSettingEdited() {
        controlsDirty = true;
        updateValueLabels();
        status.textContent = 'Settings changed. Press Refresh to apply them.';
    }

    function bindEvents() {
        refreshButton.addEventListener('click', refreshData);
        saveButton.addEventListener('click', saveState);
        modeSelect.addEventListener('change', onSettingEdited);
        periodSelect.addEventListener('change', () => { updateCustomWindowVisibility(); onSettingEdited(); });
        startInput.addEventListener('change', onSettingEdited);
        endInput.addEventListener('change', onSettingEdited);
        [widthInput, heightInput, gapInput, sidebarWidthInput, sidebarTextSizeInput].forEach(input => {
            if (!input) return;
            input.addEventListener('input', onSettingEdited);
            input.addEventListener('change', onSettingEdited);
        });
        cellCountInput.addEventListener('input', onSettingEdited);
        cellCountInput.addEventListener('change', onSettingEdited);
        [sidebarSelect, cornersSelect, overlaySelect, fontSelect].forEach(input => input.addEventListener('change', onSettingEdited));


        if (changeCoverButton) changeCoverButton.addEventListener('click', () => {
            if (coverContextItem) openCoverPicker(coverContextItem, coverContextIndex);
        });
        if (coverPickerClose) coverPickerClose.addEventListener('click', closeCoverPicker);
        if (coverPickerSearch) coverPickerSearch.addEventListener('click', loadCoverPickerCandidates);
        if (coverPickerLinkButton) coverPickerLinkButton.addEventListener('click', () => {
            const imageUrl = String(coverPickerLink && coverPickerLink.value || '').trim();
            if (!/^https?:\/\//i.test(imageUrl)) {
                if (coverPickerStatus) coverPickerStatus.textContent = 'Enter a complete http:// or https:// image address.';
                return;
            }
            applyManualCover(imageUrl, 'Image link');
        });
        if (coverPicker) coverPicker.addEventListener('click', event => { if (event.target === coverPicker) closeCoverPicker(); });
        document.addEventListener('pointerdown', event => {
            if (coverContextMenu && !coverContextMenu.hidden && !coverContextMenu.contains(event.target)) hideCoverContextMenu();
        });
        document.addEventListener('contextmenu', event => {
            if (coverContextMenu && !coverContextMenu.hidden && !event.target.closest('.topster-tile')) hideCoverContextMenu();
        });

        window.addEventListener('resize', () => { hideCoverContextMenu(); requestAnimationFrame(syncAllSidebarHeights); });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                hideCoverContextMenu();
                closeCoverPicker();
                return;
            }
            if ((event.ctrlKey || event.metaKey) && String(event.key || '').toLowerCase() === 's') {
                event.preventDefault();
                if (!saveButton.disabled) saveButton.click();
            }
        });
    }

    document.addEventListener('DOMContentLoaded', async () => {
        loadSavedState();
        applyStateToInputs();
        bindEvents();
        const authenticated = await verifyAdmin();
        if (!authenticated) return;
        main.hidden = false;
        if (state.items.length) {
            render();
            status.textContent = `Loaded saved Last.fm view with ${state.items.length} cached chart item${state.items.length === 1 ? '' : 's'}. Press Refresh to update from Last.fm.`;
        } else {
            await refreshData();
        }
    });
})();
