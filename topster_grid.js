const TOPSTER_CACHE_KEY = 'navincitron-grid-cover-cache-v2';
const TOPSTER_FRONTEND_VERSION = '20260717-topster-source-isolation-v13';
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
const TOPSTER_CHECKLIST_OVERLAYS = [
    { keyword: 'Hifiman Susvara Unveiled', id: 'susvara', imageSrc: 'susvara.png', label: 'Hifiman Susvara Unveiled' },
    { keyword: 'Hifiman Arya Organic', id: 'arya', imageSrc: 'arya.png', label: 'Hifiman Arya Organic' },
    { keyword: 'Hifiman Sundara', id: 'sundara', imageSrc: 'sundara.png', label: 'Hifiman Sundara' }
];
let topsterLoadingPanel = null;
let topsterLoadingHideTimer = null;
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



function ensureTopsterLoadingPanel() {
    if (topsterLoadingPanel && document.body.contains(topsterLoadingPanel)) {
        return topsterLoadingPanel;
    }

    const existingPanel = document.getElementById('topster-loading-panel');
    if (existingPanel) {
        topsterLoadingPanel = existingPanel;
        return existingPanel;
    }

    const section = document.querySelector('.grid-builder-page');
    if (!section) return null;

    const panel = document.createElement('div');
    panel.className = 'topster-loading-panel';
    panel.id = 'topster-loading-panel';
    panel.setAttribute('role', 'status');
    panel.setAttribute('aria-live', 'polite');
    panel.innerHTML = `
        <p class="topster-loading-title">Loading Topster</p>
        <p class="topster-loading-text" id="topster-loading-text">Preparing Topster data...</p>
        <progress class="topster-loading-progress" id="topster-loading-progress" max="100" value="0">0%</progress>
        <p class="topster-loading-percent" id="topster-loading-percent">0%</p>
    `;

    const output = document.getElementById('topster-output');
    if (output && output.parentNode === section) {
        section.insertBefore(panel, output);
    } else {
        section.appendChild(panel);
    }

    topsterLoadingPanel = panel;
    return panel;
}

function setTopsterLoadingProgress(percent, text, options = {}) {
    const panel = ensureTopsterLoadingPanel();
    if (!panel) return;

    window.clearTimeout(topsterLoadingHideTimer);
    panel.hidden = false;
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
    setTopsterLoadingProgress(100, text, { complete: true });
    topsterLoadingHideTimer = window.setTimeout(() => {
        if (topsterLoadingPanel) topsterLoadingPanel.hidden = true;
    }, 1400);
}

function failTopsterLoading(text) {
    setTopsterLoadingProgress(100, text || 'Topster loading failed.', { error: true });
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

function getTopsterStoreSourceKey() {
    // The storage namespace is explicitly declared by each Topster page pair.
    // This prevents display settings or cover caches from leaking between grid,
    // ranked, draft, and checklist even if a page's data-source label changes.
    const body = document.body;
    const explicitSource = String(
        (body && body.dataset && body.dataset.topsterStoreSource) || ''
    ).trim().toLowerCase();
    const allowedSources = new Set(['grid', 'ranked', 'draft', 'checklist']);
    if (allowedSources.has(explicitSource)) return explicitSource;

    // Backward-compatible fallback for older page copies.
    const kind = getTopsterDataSourceConfig().kind;
    if (kind === 'ranked-sheet') return 'ranked';
    if (kind === 'draft-file') return 'draft';
    if (kind === 'checklist-file') return 'checklist';
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
    try {
        const stored = JSON.parse(localStorage.getItem(getTopsterPrelookupStorageKey()) || 'null');
        return stored && typeof stored === 'object' ? stored : null;
    } catch (error) {
        return null;
    }
}

function saveTopsterPrelookupState(signature, details = {}) {
    if (!signature) return;
    try {
        localStorage.setItem(getTopsterPrelookupStorageKey(), JSON.stringify({
            signature,
            completedAt: new Date().toISOString(),
            lineCount: Number(details.lineCount) || 0,
            foundCount: Number(details.foundCount) || 0,
            missedCount: Number(details.missedCount) || 0
        }));
    } catch (error) {
        // Prelookup state is only a local editor hint; failing to save it should not stop rendering.
    }
}

function clearTopsterPrelookupState() {
    try {
        localStorage.removeItem(getTopsterPrelookupStorageKey());
    } catch (error) {
        // Optional local cleanup.
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
        || Boolean(body && body.dataset.topsterRequireAdmin === 'true');
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
    const roundCornersSelect = document.getElementById('topster-round-corners');
    const albumGapSelect = document.getElementById('topster-album-gap');
    const albumGapValue = document.getElementById('topster-album-gap-value');
    const fontSelect = document.getElementById('topster-font');
    const coverOverlaySelect = document.getElementById('topster-cover-overlay');
    const deviceProfileSelect = document.getElementById('topster-device-profile');
    const sourceConfig = getTopsterDataSourceConfig();
    const sourceFileInput = sourceConfig.fileInputId
        ? document.getElementById(sourceConfig.fileInputId)
        : null;
    const coverPicker = document.getElementById('topster-cover-picker');
    const coverPickerTitle = document.getElementById('topster-cover-picker-title');
    const coverPickerSearch = document.getElementById('topster-cover-picker-search');
    const coverPickerLink = document.getElementById('topster-cover-picker-link');
    const coverPickerLinkButton = document.getElementById('topster-cover-picker-link-button');
    const coverPickerClose = document.getElementById('topster-cover-picker-close');
    const coverPickerStatus = document.getElementById('topster-cover-picker-status');
    const coverPickerResults = document.getElementById('topster-cover-picker-results');

    if (!buildButton || !refreshButton || !stopButton || !clearButton || !cacheClearButton || !rangeSelect || !status || !output || !pagesContainer || !widthSelect || !heightSelect || !widthValue || !heightValue || !sidebarModeSelect || !roundCornersSelect || !albumGapSelect || !albumGapValue || !fontSelect) {
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
    await loadTopsterSharedStore();
    setTopsterLoadingProgress(
        14,
        topsterSharedStoreAvailable
            ? 'Saved settings and cover cache received. Preparing the Topster source...'
            : 'Shared storage is temporarily unavailable. Preparing the local Topster editor...'
    );
    let pickerEntryIndex = null;
    let pickerLookupToken = 0;
    const topsterSourceLabel = getTopsterSourceLabel();
    const topsterReadOnly = document.body && (document.body.dataset.topsterReadonly === 'true' || document.body.dataset.topsterMode === 'list');
    const topsterAutoLoad = document.body && (document.body.dataset.topsterAutoload === 'true' || topsterReadOnly);
    const topsterEditorPage = isTopsterEditorPage();
    let currentSettingsProfiles = normalizeTopsterSettingsProfiles(loadTopsterSettings());
    let currentSettingsProfile = getInitialTopsterSettingsProfile(deviceProfileSelect, topsterEditorPage);
    let currentSettings = normalizeTopsterSettings(currentSettingsProfiles[currentSettingsProfile]);

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

    if (!importedEntries.length) {
        status.textContent = '';
    }

    buildButton.addEventListener('click', () => {
        buildTopsterFromGridFile({ force: true, source: 'build' });
    });

    refreshButton.addEventListener('click', () => {
        buildTopsterFromGridFile({ force: false, source: 'refresh' });
    });

    stopButton.addEventListener('click', () => {
        activeLookupToken++;
        stopButton.disabled = true;
        buildButton.disabled = false;
        refreshButton.disabled = false;
        saveCurrentTopster();
        status.textContent = 'Cover lookup stopped. Current Topsters grid was kept.';
    });

    clearButton.addEventListener('click', () => {
        activeLookupToken++;
        importedEntries = [];
        currentGridSignature = '';
        pagesContainer.innerHTML = '';
        output.hidden = true;
        setSingleRangeOption();
        stopButton.disabled = true;
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
        saveSettingsButton.addEventListener('click', publishTopsterSettingsAndCovers);
    }

    if (sourceFileInput) {
        sourceFileInput.addEventListener('change', () => {
            const selectedFile = sourceFileInput.files && sourceFileInput.files[0] ? sourceFileInput.files[0] : null;
            activeLookupToken++;
            clearTopsterPrelookupState();
            currentGridSignature = '';
            currentSourceText = '';
            currentSourceName = selectedFile ? selectedFile.name : '';
            if (selectedFile) {
                status.textContent = `Selected ${selectedFile.name}. Press Build to read this ${sourceConfig.readLabel} and refresh the Topster.`;
                setTopsterLoadingProgress(0, `Ready to read ${selectedFile.name}. Press Build to begin.`);
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

    [widthSelect, heightSelect, albumGapSelect].forEach(element => {
        element.addEventListener('input', handleSettingsChange);
        element.addEventListener('change', handleSettingsChange);
    });

    [sidebarModeSelect, roundCornersSelect, fontSelect, coverOverlaySelect].forEach(element => {
        if (element) element.addEventListener('change', handleSettingsChange);
    });

    if (deviceProfileSelect) {
        deviceProfileSelect.addEventListener('change', handleSettingsProfileChange);
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

    function handleSettingsProfileChange() {
        const previousSettings = normalizeTopsterSettings(readSettingsControls());
        currentSettingsProfiles[currentSettingsProfile] = previousSettings;
        currentSettingsProfile = getInitialTopsterSettingsProfile(deviceProfileSelect, topsterEditorPage);
        currentSettings = normalizeTopsterSettings(currentSettingsProfiles[currentSettingsProfile]);
        setSettingsControls(currentSettings);
        applyTopsterSettings(currentSettings);
        saveTopsterSettings(currentSettingsProfiles);
        safeMarkTopsterPublishDirty();

        if (importedEntries.length) {
            const selectedStart = Number(rangeSelect.value || 0);
            renderTopster(importedEntries, selectedStart, { scroll: false });
            saveCurrentTopster();
        }

        status.textContent = topsterEditorPage
            ? `Now configuring ${getTopsterSettingsProfileLabel(currentSettingsProfile)} Topster display settings. Press Save Settings to publish.`
            : '';
    }

    function handleSettingsChange() {
        currentSettings = normalizeTopsterSettings(readSettingsControls());
        currentSettingsProfiles[currentSettingsProfile] = currentSettings;
        saveTopsterSettings(currentSettingsProfiles);
        applyTopsterSettings(currentSettings);
        updateSettingsValueLabels(currentSettings);
        safeMarkTopsterPublishDirty();

        if (!importedEntries.length) {
            setSingleRangeOption();
            status.textContent = topsterEditorPage
                ? 'Updated local Topster display settings. Press Save Settings to publish them.'
                : '';
            return;
        }

        const selectedStart = populateRangeSelect(importedEntries.length, 0);
        renderTopster(importedEntries, selectedStart, { scroll: false });
        saveCurrentTopster();
        status.textContent = topsterEditorPage
            ? `Updated local Topster display settings to ${currentSettings.width}x${currentSettings.height}. Press Save Settings to publish.`
            : `Updated Topster display settings to ${currentSettings.width}x${currentSettings.height}.`;
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
        const publicPageName = sourceKey === 'ranked'
            ? 'ranked_album_list.html'
            : (sourceKey === 'draft'
                ? 'draft_album_list.html'
                : (sourceKey === 'checklist' ? 'checklist.html' : 'album_list.html'));
        const sourceDisplayName = sourceKey === 'ranked'
            ? 'Ranked Albums'
            : (sourceKey === 'draft'
                ? 'Draft Albums'
                : (sourceKey === 'checklist' ? 'Checklist' : 'Albums'));
        status.textContent = `Saving ${sourceDisplayName} settings and cover selections to the shared backend...`;
        setTopsterLoadingProgress(92, `Publishing ${sourceDisplayName} settings, source text, and cover cache...`);

        const sharedPayload = {
            source: sourceKey,
            settings: currentSettingsProfiles,
            coverCache: getPublishableCoverCache()
        };
        if (sourceKey === 'draft' || sourceKey === 'checklist') {
            if (!currentSourceText && !importedEntries.length) {
                status.textContent = sourceKey === 'checklist'
                    ? 'Select a checklist .txt file and press Build before saving the shared checklist Topster.'
                    : 'Select a draft .txt file and press Build before saving the shared draft Topster.';
                if (saveSettingsButton) saveSettingsButton.disabled = false;
                return;
            }
            const publishSourceText = currentSourceText || topsterSharedSourceText || '';
            if (publishSourceText) {
                sharedPayload.sourceText = publishSourceText;
                sharedPayload.sourceName = currentSourceName
                    || topsterSharedSourceName
                    || (sourceKey === 'checklist' ? 'checklist notepad file' : 'draft notepad file');
                sharedPayload.sourceSignature = currentGridSignature || topsterSharedSourceSignature || simpleTextHash(publishSourceText);
            }
        }

        const ok = await saveTopsterSharedStoreNow(sharedPayload);

        if (saveSettingsButton) saveSettingsButton.disabled = false;

        if (ok) {
            topsterHasUnsavedPublishedChanges = false;
            status.textContent = `Saved shared ${sourceDisplayName} settings${sourceKey === 'draft' || sourceKey === 'checklist' ? ', source file,' : ''} and cover selections. ${publicPageName} will use these values.`;
            completeTopsterLoading(`Published ${sourceDisplayName}. ${publicPageName} is ready.`);
        } else {
            status.textContent = 'Shared save failed. Check that the backend is deployed, the admin session is active, and /api/topster-shared-store is reachable.';
            failTopsterLoading(status.textContent);
        }
    }

    window.addEventListener('resize', () => syncAllTopsterSidebarHeights());

    if (coverPicker && coverPickerClose && coverPickerSearch && coverPickerLink && coverPickerLinkButton && coverPickerResults && coverPickerStatus) {
        coverPickerClose.addEventListener('click', closeCoverPicker);
        coverPickerSearch.addEventListener('click', loadCoverPickerResults);
        coverPickerLinkButton.addEventListener('click', useManualImageLink);
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
        coverPickerTitle.textContent = `Select cover: ${formatEntryName(entry)}`;
        coverPickerResults.innerHTML = '';
        coverPickerStatus.textContent = 'Searching all available cover sources...';
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
            const candidates = await resolveManualCoverCandidates(entry, 'all', getSourceConfig());
            if (token !== pickerLookupToken) return;
            renderCoverPickerCandidates(candidates);
            coverPickerStatus.textContent = candidates.length
                ? `Select one of ${candidates.length} cover result${candidates.length === 1 ? '' : 's'}, or paste an Image Link above.`
                : 'No cover results were found. Paste an Image Link above to set the cover manually.';
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

    async function selectManualCover(candidate) {
        if (pickerEntryIndex === null || !importedEntries[pickerEntryIndex] || !candidate || !candidate.imageSrc) return;
        const entry = importedEntries[pickerEntryIndex];
        const selectedCover = {
            title: candidate.title || entry.title,
            artist: candidate.artist || entry.artist || '',
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

        renderTopster(importedEntries, 0, { scroll: false });
        saveCurrentTopster();
        syncAllTopsterSidebarHeights();
        window.requestAnimationFrame(syncAllTopsterSidebarHeights);

        status.textContent = topsterEditorPage
            ? `Updated local cover for ${formatEntryName(entry)}. Press Save Settings to publish it to the ${getTopsterStoreSourceKey() === 'ranked' ? 'ranked_album_list.html' : (getTopsterStoreSourceKey() === 'draft' ? 'draft_album_list.html' : (getTopsterStoreSourceKey() === 'checklist' ? 'checklist.html' : 'album_list.html'))}.`
            : `Updated cover for ${formatEntryName(entry)}.`;

        closeCoverPicker();
    }

    async function buildTopsterFromGridFile({ force, source }) {
        activeLookupToken++;
        const token = activeLookupToken;

        stopButton.disabled = true;
        buildButton.disabled = true;
        refreshButton.disabled = true;
        status.textContent = `Reading ${topsterSourceLabel}...`;
        setTopsterLoadingProgress(18, status.textContent);

        try {
            const loaded = await loadGridTextFile();
            setTopsterLoadingProgress(25, `Read ${loaded.source || topsterSourceLabel}. Parsing album entries...`);
            if (token !== activeLookupToken) return;

            if (!force && importedEntries.length && currentGridSignature && loaded.signature === currentGridSignature) {
                status.textContent = `${topsterSourceLabel} has not changed. Current Topsters grid was kept.`;
                completeTopsterLoading(status.textContent);
                buildButton.disabled = false;
                refreshButton.disabled = false;
                return;
            }

            const prelookupOnly = topsterEditorPage
                && source === 'build'
                && !topsterPrelookupIsComplete(loaded.signature);

            currentSourceText = loaded.text || '';
            currentSourceName = loaded.source || topsterSourceLabel;
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
            const cachedCover = prelookupOnly ? null : getPreferredCachedCover(entry);
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

        stopButton.disabled = false;
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
                    const cached = getPreferredCachedCover(entry) || getCachedCover(buildCoverCacheKey(entry));
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
        stopButton.disabled = true;
        buildButton.disabled = false;
        refreshButton.disabled = false;
        status.textContent = `Finished all ${total} album line${total === 1 ? '' : 's'}. Found/cached ${foundCount} cover${foundCount === 1 ? '' : 's'} and missed ${missedCount}. Press Build again to load the cached covers into the Topsters, then Save Settings to publish the updated cache.`;
        completeTopsterLoading(status.textContent);
    }

    async function resolveVisibleRange(startIndex = 0) {
        if (!importedEntries.length) return;

        const token = ++activeLookupToken;
        const config = getSourceConfig();
        let resolvedCount = importedEntries.filter(entry => entry.cover).length;

        stopButton.disabled = false;
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
            stopButton.disabled = true;
            buildButton.disabled = false;
            refreshButton.disabled = false;
            const missingCount = importedEntries.filter(entry => entry.status === 'missing').length;
            saveCurrentTopster();
            status.textContent = `Finished all ${importedEntries.length} album line${importedEntries.length === 1 ? '' : 's'}. Found/cached ${resolvedCount} cover${resolvedCount === 1 ? '' : 's'} and missed ${missingCount}.${topsterEditorPage ? ' Press Save Settings to publish the updated source/settings/cache.' : ''}`;
            completeTopsterLoading(status.textContent);
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

    function createTopsterPage(pageEntries, start, end, pageIndex, pageSize, settings = getEffectiveTopsterSettings(currentSettings)) {
        const page = document.createElement('section');
        page.className = 'topster-page';

        const layout = document.createElement('div');
        layout.className = 'topster-layout';

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
            }, settings.coverOverlay));
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
        const itemCountPerRow = Math.max(1, settings.width);
        const gap = Number.parseFloat(computed.rowGap || computed.gap || '0') || 0;
        const paddingTop = Number.parseFloat(computed.paddingTop || '0') || 0;
        const paddingBottom = Number.parseFloat(computed.paddingBottom || '0') || 0;
        const usableHeight = Math.max(1, maxHeight - paddingTop - paddingBottom - (gap * Math.max(0, rowCount - 1)));
        const rowHeight = usableHeight / rowCount;
        const dynamicBase = clampNumber(rowHeight / ((itemCountPerRow * 0.52) + 3.8), 4.2, 18);
        const baseSize = Math.min(Math.max(configuredBase, dynamicBase), 18);

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
            roundCorners: Number(roundCornersSelect.value),
            albumGap: Number(albumGapSelect.value),
            font: fontSelect.value,
            coverOverlay: coverOverlaySelect ? coverOverlaySelect.value : (currentSettings.coverOverlay || 'none')
        };
    }

    function setSettingsControls(settings) {
        widthSelect.value = String(settings.width);
        heightSelect.value = String(settings.height);
        sidebarModeSelect.value = settings.sidebarMode;
        roundCornersSelect.value = String(settings.roundCorners);
        albumGapSelect.value = String(settings.albumGap);
        fontSelect.value = settings.font;
        if (coverOverlaySelect) coverOverlaySelect.value = settings.coverOverlay || 'none';
        updateSettingsValueLabels(settings);
    }

    function updateSettingsValueLabels(settings) {
        widthValue.textContent = String(settings.width);
        heightValue.textContent = String(settings.height);
        albumGapValue.textContent = `${settings.albumGap} px`;
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
        output.style.setProperty('--topster-rows', String(effectiveSettings.height));
        output.style.fontFamily = fontFamily;
        output.classList.toggle('topster-sidebar-hidden', effectiveSettings.sidebarMode === 'hidden');
        output.classList.toggle('topster-cover-overlay-enabled', effectiveSettings.coverOverlay !== 'none');
        updateTopsterResponsiveMetrics();
        buildButton.textContent = 'Build';
    }

}


async function loadTopsterSharedStore() {
    topsterSharedStoreLoaded = true;

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = controller ? window.setTimeout(() => controller.abort(), 3500) : null;

    try {
        const response = await fetch(buildTopsterSharedStoreUrl(), {
            cache: 'no-store',
            credentials: 'include',
            signal: controller ? controller.signal : undefined
        });

        if (timeoutId) window.clearTimeout(timeoutId);

        if (!response.ok) {
            topsterSharedStoreAvailable = false;
            topsterSharedStoreWritable = false;
            return;
        }

        const payload = await response.json();
        const requestedSource = getTopsterStoreSourceKey();
        if (!payload || payload.ok !== true || payload.source !== requestedSource) {
            console.error('Topster shared-store source mismatch.', {
                requestedSource,
                returnedSource: payload && payload.source
            });
            topsterSharedStoreAvailable = false;
            topsterSharedStoreWritable = false;
            return;
        }

        topsterSharedStoreAvailable = true;
        topsterSharedStoreWritable = Boolean(payload.writable);
        topsterSharedCoverCache = payload.coverCache && typeof payload.coverCache === 'object' ? payload.coverCache : {};
        topsterSharedSettings = payload.settings && typeof payload.settings === 'object' ? payload.settings : null;
        topsterSharedSourceText = typeof payload.sourceText === 'string' ? payload.sourceText : '';
        topsterSharedSourceSignature = typeof payload.sourceSignature === 'string' ? payload.sourceSignature : '';
        topsterSharedSourceName = typeof payload.sourceName === 'string' ? payload.sourceName : '';
    } catch (error) {
        if (timeoutId) window.clearTimeout(timeoutId);
        topsterSharedStoreAvailable = false;
        topsterSharedStoreWritable = false;
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
        roundCorners: clampInteger(raw.roundCorners, 0, 24, 0),
        albumGap: clampInteger(raw.albumGap, 0, 100, 4),
        font: allowedFonts.has(raw.font) ? raw.font : 'Arial',
        coverOverlay: allowedCoverOverlays.has(raw.coverOverlay) ? raw.coverOverlay : 'none'
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
    return Math.round(clampNumber(widthBasedSize, 4.2, 18) * 10) / 10;
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

async function loadGridTextFile() {
    const source = getTopsterDataSourceConfig();

    if (source.kind === 'draft-file' || source.kind === 'checklist-file') {
        return loadDraftTextFile(source);
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
        throw new Error(`${fileName} was not found next to grid.html.`);
    }

    const text = await response.text();
    if (looksLikeHtmlDocument(text)) {
        throw new Error(`${fileName} was not found. Create it in the same navincitron-website folder as grid.html.`);
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
        if (cover && cover.imageSrc) {
            setCachedCover(cacheKey, cover);
            return cover;
        }
    }

    if (config.useCache) {
        const cached = getPreferredCachedCover(entry) || getCachedCover(cacheKey);
        if (cached && cached.imageSrc) {
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
    const data = await fetchMusicBrainzJson(searchUrl);
    const groups = Array.isArray(data['release-groups']) ? data['release-groups'] : [];
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

function buildMusicBrainzQuery(entry) {
    const escapedTitle = String(entry.title || '').replace(/"/g, '\\"');
    const escapedArtist = String(entry.artist || '').replace(/"/g, '\\"');
    const parts = [`releasegroup:"${escapedTitle}"`];
    if (escapedArtist) parts.push(`artist:"${escapedArtist}"`);
    if (entry.year) parts.push(`firstreleasedate:${entry.year}`);
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
    const searchTerm = `${entry.artist ? `${entry.artist} ` : ''}${entry.title}${entry.year ? ` ${entry.year}` : ''}`;
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(searchTerm)}&entity=album&limit=15`;
    const data = await fetchJson(url, 12000);
    const results = Array.isArray(data.results) ? data.results : [];
    const candidates = results
        .map(result => ({ result, score: scoreAlbumCandidate(entry, result.collectionName, result.releaseDate, 0, result.artistName) }))
        .filter(item => item.score >= 0.55)
        .sort((a, b) => b.score - a.score);

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
            if (album && imageSrc && !imageSrc.includes('2a96cbd8b46e442fc41c2b86b821562f')) {
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
    url.searchParams.set('q', `title:("${entry.title.replace(/"/g, '')}") AND mediatype:(audio)`);
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
        .filter(Boolean)
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
        .replace(/[^a-z0-9]+/g, '');
}

function tokenizeTitle(title) {
    const stopWords = new Set(['the', 'a', 'an', 'and', 'of', 'in', 'to', 'with', 'for']);
    return cleanAlbumTitle(title)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, ' ')
        .split(/\s+/)
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
        if (similarity >= 0.90) artistScore = 0.18;
        else if (similarity >= 0.60) artistScore = 0.08;
        else if (similarity > 0) artistScore = -0.06;
        else artistScore = -0.12;
    }

    const apiScore = sourceScore ? Math.min(sourceScore, 100) / 1000 : 0;
    return titleScore + yearScore + artistScore + apiScore;
}

function titleSimilarity(a, b) {
    const compactA = normalizeAlbumTitle(a);
    const compactB = normalizeAlbumTitle(b);
    if (!compactA || !compactB) return 0;
    if (compactA === compactB) return 1;
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
    return `${normalizeAlbumTitle(entry.artist || '')}|${normalizeAlbumTitle(entry.title)}|${entry.year || ''}`;
}

function buildCoverCacheAliases(entry) {
    const artistKey = normalizeAlbumTitle(entry.artist || '');
    const titleKey = normalizeAlbumTitle(entry.title || '');
    const yearKey = entry.year || '';
    const aliases = [
        `${artistKey}|${titleKey}|${yearKey}`,
        `${artistKey}|${titleKey}|`,
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

function getPreferredCachedCover(entry) {
    const cache = getCoverCache();
    const aliases = buildCoverCacheAliases(entry);

    for (const key of aliases) {
        const item = cache[key];
        if (item && item.imageSrc && item.selectedManually) {
            return { ...item, source: item.source || 'Cache' };
        }
    }

    for (const key of aliases) {
        const item = cache[key];
        if (item && item.imageSrc) {
            return { ...item, source: item.source || 'Cache' };
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

    const titleForAlias = cachedCover.title || (typeof key === 'string' ? key.split('|')[1] : '');
    const artistForAlias = cachedCover.artist || (typeof key === 'string' ? key.split('|')[0] : '');
    const yearForAlias = typeof key === 'string' ? key.split('|')[2] : '';
    buildCoverCacheAliases({ artist: artistForAlias, title: titleForAlias, year: yearForAlias }).forEach(alias => {
        cache[alias] = cachedCover;
    });

    if (isTopsterEditorPage()) {
        topsterEditorWorkingCoverCache = cache;
        writeLocalTopsterCoverCache(cache);
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
            if (album && isUsefulLastfmImage(imageSrc)) {
                candidates.push(makeCoverCandidate({
                    title: album.name || entry.title,
                    artist: album.artist || entry.artist || '',
                    imageSrc,
                    href: album.url || '',
                    source: 'Last.fm',
                    score: 1
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
    const exact = getCachedCover(buildCoverCacheKey(entry));
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

function createTopsterTile(entry, displayIndex, onSelectCover, coverOverlayMode = 'none') {
    const tile = document.createElement('div');
    tile.className = 'topster-tile';
    let mobileInfoTimer = null;

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

    const showMobileInfo = event => {
        if (!isTopsterTouchTooltipDevice()) return false;
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
            if (showMobileInfo(event)) return;
            event.preventDefault();
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
        tile.addEventListener('click', showMobileInfo);
    }

    if (cover && cover.imageSrc) {
        const img = document.createElement('img');
        img.src = cover.imageSrc;
        img.alt = formatEntryName(entry) || cover.title || entry.title;
        img.loading = 'lazy';
        img.onerror = () => {
            const placeholder = document.createElement('div');
            placeholder.className = 'topster-tile-placeholder';
            placeholder.textContent = formatEntryName(entry) || entry.title;
            tile.innerHTML = '';
            tile.classList.remove('has-cover-overlay');
            tile.appendChild(placeholder);
        };
        tile.appendChild(img);
    } else {
        const placeholder = document.createElement('div');
        placeholder.className = 'topster-tile-placeholder';
        if (entry.status === 'loading') {
            placeholder.classList.add('topster-tile-loading');
            placeholder.textContent = 'Loading...';
        } else if (entry.status === 'missing') {
            placeholder.textContent = formatEntryName(entry) || entry.title;
        } else {
            placeholder.textContent = formatEntryName(entry) || entry.title;
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

    const mobileInfo = document.createElement('span');
    mobileInfo.className = `topster-mobile-tile-info ${getTopsterMobileInfoLengthClass(label)}`;
    mobileInfo.textContent = label;
    mobileInfo.setAttribute('aria-hidden', 'true');
    tile.appendChild(mobileInfo);

    return tile;
}

function isTopsterTouchTooltipDevice() {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
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
    if (coverOverlayMode === 'year' && entry && entry.year) return String(entry.year);
    return '';
}


document.addEventListener('DOMContentLoaded', () => {
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