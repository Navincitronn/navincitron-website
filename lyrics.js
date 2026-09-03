(() => {
    "use strict";

    const API_BASE_URL = "https://api.navincitron.com";
    const POLL_INTERVAL_MS = 3000;
    const PREVIOUS_DOUBLE_PRESS_WINDOW_MS = 2500;

    const loginButton = document.getElementById("lyrics-login");
    const refreshButton = document.getElementById("lyrics-refresh");
    const statusElement = document.getElementById("lyrics-status");
    const songCard = document.getElementById("lyrics-song-card");
    const coverFrame = document.getElementById("lyrics-cover-frame");
    const coverImage = document.getElementById("lyrics-cover-image");
    const songTitle = document.getElementById("lyrics-song-title");
    const songArtist = document.getElementById("lyrics-song-artist");
    const songAlbum = document.getElementById("lyrics-song-album");
    const sourceBadge = document.getElementById("lyrics-source-badge");
    const annotationBadge = document.getElementById("lyrics-annotation-badge");
    const descriptionElement = document.getElementById("lyrics-description");
    const progressTrack = document.getElementById("lyrics-progress-track");
    const progressFill = document.getElementById("lyrics-progress-fill");
    const progressCurrent = document.getElementById("lyrics-progress-current");
    const progressDuration = document.getElementById("lyrics-progress-duration");
    const previousTrackButton = document.getElementById("lyrics-previous-track");
    const pauseButton = document.getElementById("lyrics-pause");
    const playButton = document.getElementById("lyrics-play");
    const nextTrackButton = document.getElementById("lyrics-next-track");
    const scrobbleModeToggle = document.getElementById("lyrics-scrobble-mode");
    const vinylModeToggle = document.getElementById("lyrics-vinyl-mode");
    const embedCard = document.getElementById("lyrics-embed-card");
    const embedContainer = document.getElementById("lyrics-embed-container");
    const discogsCard = document.getElementById("lyrics-discogs-card");
    const discogsStatus = document.getElementById("lyrics-discogs-status");
    const discogsReleaseMeta = document.getElementById("lyrics-discogs-release-meta");
    const discogsConditionMeta = document.getElementById("lyrics-discogs-condition-meta");
    const discogsSides = document.getElementById("lyrics-discogs-sides");
    const discogsTotalLength = document.getElementById("lyrics-discogs-total-length");
    const scoreCard = document.getElementById("lyrics-score-card");
    const scoreStatus = document.getElementById("lyrics-score-status");
    const scoreSides = document.getElementById("lyrics-score-sides");
    const scoreOverall = document.getElementById("lyrics-score-overall");
    const scoreActions = document.getElementById("lyrics-score-actions");
    const scoreEditButton = document.getElementById("lyrics-score-edit");
    const scoreSaveButton = document.getElementById("lyrics-score-save");
    const scoreCancelButton = document.getElementById("lyrics-score-cancel");
    const scoreDeleteButton = document.getElementById("lyrics-score-delete");
    const scoreDeleteConfirm = document.getElementById("lyrics-score-delete-confirm");
    const scoreDeleteConfirmYes = document.getElementById("lyrics-score-delete-confirm-yes");
    const scoreDeleteConfirmNo = document.getElementById("lyrics-score-delete-confirm-no");
    const coverPicker = document.getElementById("lyrics-cover-picker");
    const coverPickerTitle = document.getElementById("lyrics-cover-picker-title");
    const coverPickerSearch = document.getElementById("lyrics-cover-picker-search");
    const coverPickerLink = document.getElementById("lyrics-cover-picker-link");
    const coverPickerLinkButton = document.getElementById("lyrics-cover-picker-link-button");
    const coverPickerResetDefault = document.getElementById("lyrics-cover-picker-reset-default");
    const coverPickerClose = document.getElementById("lyrics-cover-picker-close");
    const coverPickerStatus = document.getElementById("lyrics-cover-picker-status");
    const coverPickerResults = document.getElementById("lyrics-cover-picker-results");

    let lastTrackKey = "";
    let lastGeniusSongId = null;
    let requestInProgress = false;
    let pollTimer = null;
    let activeEmbedFrame = null;
    let embedResizeTimer = null;
    let spotifyAuthenticated = false;
    let hasCurrentTrack = false;
    let hasDisplayedTrack = false;
    let playbackControlInProgress = false;
    let previousRestartArmedUntil = 0;
    let lastEmbedInteractionAt = 0;
    let annotationReturnScrollY = null;
    let annotationScrollActive = false;
    let annotationAutoScrollAt = 0;
    let annotationRestoreInProgress = false;
    let lastDiscogsAlbumLookupKey = "";
    let lastDiscogsTracklistPayload = null;
    let lastDiscogsRenderedLookupKey = "";
    let discogsLookupInFlightKey = "";
    let discogsLookupRequestId = 0;
    let currentDiscogsRelease = null;
    let currentDisplayedTrack = null;
    let vinylSideEndPauseTimer = null;
    let vinylSideEndPauseArm = null;
    let currentTrackEndsVinylSide = false;
    let currentTrackVinylSide = "";
    let scrobbleAlbumEndPauseTimer = null;
    let scrobbleAlbumEndPauseArm = null;
    let currentTrackEndsAlbum = false;
    const SCROBBLE_MODE_STORAGE_KEY = "navincitron-lyrics-scrobble-mode";
    const VINYL_MODE_STORAGE_KEY = "navincitron-lyrics-vinyl-mode";
    let scrobbleModeEnabled = false;
    let vinylModeEnabled = false;
    try {
        scrobbleModeEnabled = window.localStorage.getItem(SCROBBLE_MODE_STORAGE_KEY) === "1";
        vinylModeEnabled = window.localStorage.getItem(VINYL_MODE_STORAGE_KEY) === "1";
        if (scrobbleModeEnabled && vinylModeEnabled) vinylModeEnabled = false;
    } catch (error) {
        scrobbleModeEnabled = false;
        vinylModeEnabled = false;
    }
    let lastDefaultArtworkUrl = "";
    let lastDefaultArtworkTitle = "";
    let coverPickerLookupToken = 0;
    let lastMusicBrainzCoverLookupAt = 0;
    let playbackClock = {
        progressMs: 0,
        durationMs: 0,
        isPlaying: false,
        sampledAt: Date.now(),
    };

    const GENIUS_EMBED_HEIGHT_MESSAGE = "navincitron-genius-embed-height";
    const GENIUS_EMBED_ERROR_MESSAGE = "navincitron-genius-embed-error";
    const GENIUS_EMBED_INTERACTION_MESSAGE = "navincitron-genius-embed-interaction";
    const LYRICS_LASTFM_API_KEY = "7c87436dbff96020ebb6e3a75cb0f396";

    // The three Rolling Stone song lists use two different text layouts:
    // 2004/2010 are primarily "Artist - Song", while 2021 is
    // "Song - Artist (year)". Probe both the requested production filenames and
    // the historical "top_500" filenames so existing site copies continue to work.
    const ROLLING_STONE_SONG_LISTS = Object.freeze([
        { year: 2004, format: "artist-title", files: ["rolling_stone_500_songs_2004.txt", "rolling_stone_top_500_songs_2004.txt"] },
        { year: 2010, format: "artist-title", files: ["rolling_stone_500_songs_2010.txt", "rolling_stone_top_500_songs_2010.txt"] },
        { year: 2021, format: "title-artist-year", files: ["rolling_stone_500_songs_2021.txt", "rolling_stone_top_500_songs_2021.txt"] },
    ]);
    let rollingStone500SongEntries = [];
    let rollingStone500SongListsLoaded = false;
    let rollingStone500SongListsPromise = null;
    let rollingStone500SongIndex = new Map();
    let rollingStone500SongBuckets = new Map();

    const MY_ALBUMS_SCORE_FILE = "my_albums.txt";
    let myAlbumsScoreEntries = [];
    let myAlbumsScoreText = "";
    let myAlbumsScoresLoaded = false;
    let myAlbumsScoresPromise = null;
    const myAlbumsAlbumMatchCache = new Map();
    let myAlbumsAlbumTitleIndex = new Map();
    let myAlbumsTrackTitleIndex = new Map();
    let currentScoreContext = null;
    let scoreEditMode = false;
    let scoreSaveInProgress = false;
    let scoreDeleteInProgress = false;
    let scoreDeletePendingContext = null;
    let myAlbumsScoreRevision = "";
    const SCORE_DRAFT_STORAGE_KEY = "navincitron-lyrics-score-drafts-v1";
    const scoreDraftsByAlbum = new Map();

    function persistScoreDrafts() {
        try {
            const serialized = {};
            scoreDraftsByAlbum.forEach((draft, key) => {
                serialized[key] = Object.fromEntries(draft && draft.values instanceof Map ? draft.values : []);
            });
            window.localStorage.setItem(SCORE_DRAFT_STORAGE_KEY, JSON.stringify(serialized));
        } catch (error) {
            // Drafts still remain in memory when storage is unavailable.
        }
    }

    try {
        const storedDrafts = JSON.parse(window.localStorage.getItem(SCORE_DRAFT_STORAGE_KEY) || "{}");
        if (storedDrafts && typeof storedDrafts === "object" && !Array.isArray(storedDrafts)) {
            Object.entries(storedDrafts).forEach(([key, values]) => {
                if (!key || !values || typeof values !== "object" || Array.isArray(values)) return;
                scoreDraftsByAlbum.set(key, { key, values: new Map(Object.entries(values)) });
            });
        }
    } catch (error) {
        // Ignore malformed/unavailable local draft storage.
    }

    const SCORE_COLOR_BANDS = Object.freeze([
        { min: 110, label: "VIOLET", color: "#a855f7" },
        { min: 98, label: "HIGH 10", color: "#2563eb" },
        { min: 96, label: "MID 10", color: "#3b82f6" },
        { min: 94, label: "LOW 10", color: "#60a5fa" },
        { min: 92, label: "HIGH 9", color: "#0891b2" },
        { min: 90, label: "MID 9", color: "#06b6d4" },
        { min: 88, label: "LOW 9", color: "#67e8f9" },
        { min: 86, label: "HIGH 8", color: "#16a34a" },
        { min: 84, label: "MID 8", color: "#22c55e" },
        { min: 82, label: "LOW 8", color: "#86efac" },
        { min: 80, label: "HIGH 7", color: "#ca8a04" },
        { min: 78, label: "MID 7", color: "#eab308" },
        { min: 76, label: "LOW 7", color: "#fde047" },
        { min: 75, label: "HIGH 6", color: "#c2410c" },
        { min: 73, label: "MID 6", color: "#f97316" },
        { min: 71, label: "LOW 6", color: "#fb923c" },
        { min: 68, label: "HIGH 5", color: "#b91c1c" },
        { min: 64, label: "MID 5", color: "#ef4444" },
        { min: 61, label: "LOW 5", color: "#f87171" },
        { min: 58, label: "HIGH 4", color: "#9d174d" },
        { min: 54, label: "MID 4", color: "#db2777" },
        { min: 51, label: "LOW 4", color: "#f472b6" },
        { min: -Infinity, label: "DUMPSTER FIRE", color: "#8b5a2b" },
    ]);

    const SCORE_RATING_IMAGE_BASE = "rating_images/";
    const ALBUM_SCORE_VISUAL_BANDS = Object.freeze([
        { min: 98, tier: "high", rating: 10 },
        { min: 96, tier: "mid", rating: 10 },
        { min: 94, tier: "low", rating: 10 },
        { min: 92, tier: "high", rating: 9 },
        { min: 90, tier: "mid", rating: 9 },
        { min: 88, tier: "low", rating: 9 },
        { min: 86, tier: "high", rating: 8 },
        { min: 84, tier: "mid", rating: 8 },
        { min: 82, tier: "low", rating: 8 },
        { min: 80, tier: "high", rating: 7 },
        { min: 78, tier: "mid", rating: 7 },
        { min: 76, tier: "low", rating: 7 },
        { min: 75, tier: "high", rating: 6 },
        { min: 73, tier: "mid", rating: 6 },
        { min: 71, tier: "low", rating: 6 },
        { min: 68, tier: "high", rating: 5 },
        { min: 64, tier: "mid", rating: 5 },
        { min: 61, tier: "low", rating: 5 },
        { min: 58, tier: "high", rating: 4 },
        { min: 54, tier: "mid", rating: 4 },
        { min: 51, tier: "low", rating: 4 },
        { min: 48, tier: "high", rating: 3 },
        { min: 44, tier: "mid", rating: 3 },
        { min: 41, tier: "low", rating: 3 },
        { min: -Infinity, tier: "not-good", rating: null },
    ]);

    const focusSink = document.createElement("span");
    focusSink.tabIndex = -1;
    focusSink.setAttribute("aria-hidden", "true");
    focusSink.style.cssText = "position:fixed;width:1px;height:1px;overflow:hidden;clip-path:inset(100%);left:0;top:0;";
    document.body.appendChild(focusSink);

    // Discogs ownership matching intentionally mirrors the current Topster
    // "Exclude releases that I have" implementation, including its shared
    // seven-day browser cache, artist index, exact index, alias rules, and fuzzy
    // safety checks. Keep the cache key synchronized with topster_grid.js.
    const TOPSTER_DEFAULT_BACKEND_ORIGIN = API_BASE_URL;
    const TOPSTER_DISCOGS_COLLECTION_USERNAME = "NNavincitron";
    const TOPSTER_DISCOGS_COLLECTION_CACHE_KEY = "navincitron-discogs-owned-releases-v10";
    const TOPSTER_DISCOGS_COLLECTION_CACHE_MS = 7 * 24 * 60 * 60 * 1000;
    let topsterDiscogsCollectionAlbums = null;
    let topsterDiscogsCollectionItemCount = 0;
    let topsterDiscogsCollectionLoadedAt = 0;
    let topsterDiscogsCollectionLoadPromise = null;
    let topsterDiscogsArtistIndex = new Map();
    let topsterDiscogsOwnershipMemo = new Map();
    let topsterDiscogsExactIndex = new Set();

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
        return cleanAlbumTitle(value || '').normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '')
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
                schema: 10,
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

            if (Number(parsed.schema) === 10 && Array.isArray(parsed.normalizedAlbums)) {
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
        // Live/archive titles often abbreviate a four-digit year with an apostrophe
        // ("Live at Red Rocks '22" vs Discogs' "Live At Red Rocks 2022"). Treat that
        // as date notation rather than as a sequel/volume number. Two-digit years
        // 00-30 are interpreted as 20xx; 31-99 as 19xx, which covers the catalog-era
        // shorthand used by these release titles without weakening unrelated numbers.
        text = text.replace(/[’'](\d{2})\b/g, (match, shortYear) => {
            const year = Number(shortYear);
            if (!Number.isFinite(year)) return match;
            return ` ${year <= 30 ? 2000 + year : 1900 + year} `;
        });
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

        // Discogs sometimes exposes bilingual/translated artist credits in the same
        // display string (for example "Yellow Magic Orchestra = イエロー…*"). Either
        // side of an equals-sign credit is the same credited artist for ownership
        // matching. Normalize each side independently so a trailing Discogs "*" on
        // the translated side cannot prevent the English artist from being indexed.
        const artistTexts = new Set([clean]);
        clean.split(/\s+=\s+/).forEach(part => {
            const normalizedPart = normalizeDiscogsArtistForMatch(part);
            if (normalizedPart) artistTexts.add(normalizedPart);
        });

        const variants = new Set();
        artistTexts.forEach(artistText => {
            topsterOwnedTextVariants(artistText, { artist: true }).forEach(v => variants.add(v));
            topsterOwnedTextVariants(artistText.replace(/\s+\b(?:featuring|feat\.?)\b\s+.+$/i, ''), { artist: true }).forEach(v => variants.add(v));
        });
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

    // User-confirmed owned releases that have repeatedly failed to surface through
    // Discogs' collection payload/matching path on the live site. Keep these exact
    // artist/title identities as a final deterministic ownership fallback after a
    // collection has successfully loaded.
    const DISCOGS_OWNED_CONFIRMED_RELEASES = Object.freeze([
        { artist: 'Paul McCartney & Wings', title: 'Band On The Run' },
        { artist: 'The King Cole Trio', title: 'The King Cole Trio' },
        { artist: 'Sabu', title: 'Palo Congo' }
    ]);

    function discogsOwnedConfirmedReleaseMatch(entryArtist, entryTitle) {
        const artistKey = discogsOwnedRelationKey(normalizeDiscogsArtistForMatch(entryArtist || ''));
        const titleKey = discogsOwnedRelationKey(entryTitle || '');
        if (!artistKey || !titleKey) return false;
        return DISCOGS_OWNED_CONFIRMED_RELEASES.some(item =>
            discogsOwnedRelationKey(normalizeDiscogsArtistForMatch(item.artist)) === artistKey
            && discogsOwnedRelationKey(item.title) === titleKey);
    }

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
        // Apostrophe-prefixed two-digit endings are year shorthand ('22, ’72), not
        // sequel/volume markers. discogsOwnedNormalizeRomanVolumes expands them for
        // title comparison, so do not let this safety guard reject that equivalence.
        if (!text || /[’']\d{2}\s*$/.test(text) || /\b(?:vol(?:ume)?|no\.?|number|part)\s*(?:[ivx]+|\d+)\s*$/.test(text)) return '';
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
        if (discogsOwnedConfirmedReleaseMatch(entryArtist, entryTitle)) return remember(true);

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

    // Spotify sometimes presents an album under a streaming-specific title/credit
    // even though the user's owned Discogs release is indexed under a different
    // physical-release identity. These aliases do NOT replace the Topster ownership
    // matcher: each target is fed back through topsterEntryIsInDiscogsCollection(),
    // so the ownership decision still uses the exact same matcher/indexes as
    // "Exclude releases that I have".
    const LYRICS_DISCOGS_SPOTIFY_OWNERSHIP_ALIASES = Object.freeze([
        {
            sourceArtists: ['Carl Perkins'],
            sourceTitles: ['The Dance Album'],
            targets: [
                { artist: 'Carl Perkins', title: 'Dance Album Of Carl Perkins' },
            ],
        },
        {
            sourceArtists: ['Fats Domino'],
            sourceTitles: ['This Is Fats (1957)'],
            targets: [
                { artist: 'Fats Domino', title: 'This Is Fats' },
            ],
        },
        {
            sourceArtists: ['Magdalena Bay'],
            sourceTitles: ['mini mix vol. 1', 'mini mix vol. 2', 'mini mix vol. 3'],
            targets: [
                { artist: 'Magdalena Bay', title: 'Mini Mix Vol. 1-3' },
            ],
        },
        {
            sourceArtists: ['Sabu'],
            sourceTitles: ['Palo Congo'],
            targets: [
                { artist: 'Sabu', title: 'Palo Congo' },
            ],
        },
        {
            sourceArtists: ['Benny Goodman'],
            sourceTitles: ['Live At Carnegie Hall-1938 Complete'],
            targets: [
                { artist: 'Benny Goodman', title: 'The Famous 1938 Carnegie Hall Jazz Concert' },
            ],
        },
        {
            // Spotify's Archive Collection credit/title is a streaming identity;
            // the owned physical record uses the original Wings credit and title.
            sourceArtists: [],
            sourceTitles: ['Band On The Run (Archive Collection)'],
            targets: [
                { artist: 'Paul McCartney & Wings', title: 'Band On The Run' },
            ],
        },
        {
            sourceArtists: [],
            sourceTitles: ['King Tubbys Meets Rockers Uptown'],
            targets: [
                { artist: 'Augustus Pablo', title: 'King Tubbys Meets Rockers Uptown' },
            ],
        },
        {
            sourceArtists: [],
            sourceTitles: ['Nuggets: Original Artyfacts from the First Psychedelic Era 1965–1968', 'Nuggets: Original Artyfacts from the First Psychedelic Era 1965-1968'],
            targets: [
                { artist: 'Various', title: 'Nuggets: Original Artyfacts From The First Psychedelic Era 1965-1968' },
            ],
        },
        {
            sourceArtists: ['Fishmans'],
            sourceTitles: ['空中キャンプ', '98.12.28 男達の別れ (Live)', '98.12.28 男達の別れ'],
            targets: [
                { artist: 'Fishmans', title: 'Fishmans Rock Festival' },
            ],
        },
        {
            sourceArtists: [],
            sourceTitles: ['The Good, The Bad and The Ugly (Original Motion Picture Soundtrack) [Remastered Edition]'],
            targets: [
                { artist: 'Ennio Morricone', title: 'Il Buono, Il Brutto, Il Cattivo (Colonna Sonora Originale)' },
            ],
        },
        {
            // Spotify credits individual soundtrack performers/composers while the
            // owned Discogs release is filed under Rodgers & Hammerstein.
            sourceArtists: [],
            sourceTitles: ['South Pacific (Original Soundtrack Recording)'],
            targets: [
                { artist: 'Rodgers & Hammerstein', title: 'South Pacific' },
            ],
        },
        {
            // Spotify uses the later reissue title, while the owned LP is the
            // original Bing Crosby release titled Merry Christmas.
            sourceArtists: ['Bing Crosby'],
            sourceTitles: ['White Christmas'],
            targets: [
                { artist: 'Bing Crosby', title: 'Merry Christmas' },
            ],
        },
        {
            // Local tracks from the Phil Spector box set are credited to each
            // individual performer, but the owned Discogs container is filed
            // under Phil Spector with the 1958-1969 title.
            sourceArtists: [],
            sourceTitles: ['Back To Mono (1958 - 1966)', 'Back To Mono (1958-1966)'],
            targets: [
                { artist: 'Phil Spector', title: 'Back To Mono (1958-1969)' },
            ],
        },
        {
            // Spotify local-file metadata can credit "Various Artists" (or an
            // individual performer) while the owned physical anthology is filed
            // under curator Harry Smith. Match the distinctive album title, then
            // expose all four owned volumes so the backend can select the volume
            // containing the currently playing track.
            sourceArtists: [],
            sourceTitles: ['Anthology of American Folk Music'],
            targets: [
                { artist: 'Harry Smith', title: 'Anthology Of American Folk Music Volume One: Ballads' },
                { artist: 'Harry Smith', title: 'Anthology Of American Folk Music Volume Two: Social Music' },
                { artist: 'Harry Smith', title: 'Anthology Of American Folk Music Volume Three: Songs' },
                { artist: 'Harry Smith', title: 'Anthology Of American Folk Music Volume Four: Rhythmic Changes' },
            ],
        },
    ]);
    function lyricsDiscogsSpotifyOwnershipEntries(entry) {
        const entryArtist = cleanAlbumTitle(entry && entry.artist || '');
        const entryTitle = cleanAlbumTitle(entry && entry.title || '');
        const aliases = [];
        const seenAliases = new Set();
        const addAlias = candidate => {
            const artist = cleanAlbumTitle(candidate && candidate.artist || '');
            const title = cleanAlbumTitle(candidate && candidate.title || '');
            if (!title) return;
            const key = `${discogsOwnedRelationKey(artist)}::${discogsOwnedRelationKey(title)}`;
            if (!key || seenAliases.has(key)) return;
            seenAliases.add(key);
            aliases.push({ artist, title });
        };

        const sourceTitleKey = discogsOwnedRelationKey(entryTitle);
        LYRICS_DISCOGS_SPOTIFY_OWNERSHIP_ALIASES.forEach(rule => {
            const titleMatches = (rule.sourceTitles || []).some(title => discogsOwnedRelationKey(title) === sourceTitleKey);
            if (!titleMatches) return;

            const sourceArtists = Array.isArray(rule.sourceArtists) ? rule.sourceArtists : [];
            if (sourceArtists.length && !sourceArtists.some(artist => discogsOwnedArtistsMatch(entryArtist, [artist]))) return;
            (rule.targets || []).forEach(addAlias);
        });

        // A known Spotify->Discogs identity mapping is authoritative for Lyrics.
        // Feed those mapped identities through the exact same Topster ownership
        // matcher, but do not also let the original streaming identity wander into
        // an unrelated fuzzy/cross-credit release (e.g. soundtrack title collisions).
        if (aliases.length) return aliases;
        return entryTitle ? [{ artist: entryArtist, title: entryTitle }] : [];
    }

    function lyricsDiscogsCollectionAlbumMatchesEntry(entryArtist, entryTitle, album) {
        const collectionTitle = cleanAlbumTitle(album && album.title || '');
        const collectionArtists = album && Array.isArray(album.artists) && album.artists.length
            ? album.artists
            : [album && album.artist || ''];
        if (!collectionTitle) return false;

        if (discogsOwnedKnownCrossCreditMatch(entryArtist, entryTitle, collectionTitle, collectionArtists)) return true;

        const artistsMatch = discogsOwnedArtistsMatch(entryArtist, collectionArtists);
        if (!artistsMatch) return false;
        if (normalizeAlbumIdentityKey(entryTitle) === normalizeAlbumIdentityKey(collectionTitle)) return true;
        if (discogsOwnedKnownContainerMatch(entryArtist, entryTitle, collectionTitle)) return true;
        if (discogsOwnedKnownAliasMatch(entryArtist, entryTitle, collectionTitle, collectionArtists)) return true;
        if (discogsOwnedSafeTitleEquivalence(entryTitle, collectionTitle, entryArtist, collectionArtists)) return true;

        const titleScore = discogsOwnedTitleScore(entryTitle, collectionTitle, entryArtist, collectionArtists.join(', '));
        if (titleScore >= 0.68 && discogsOwnedFuzzyTitleMatchIsSafe(entryTitle, collectionTitle)) return true;
        if (discogsOwnedIsCompilationLike(entryTitle) && discogsOwnedIsCompilationLike(collectionTitle)) return true;
        if (discogsOwnedIsArtistPresentationTitle(entryTitle, entryArtist)
            && discogsOwnedIsArtistPresentationTitle(collectionTitle, entryArtist)) return true;
        return false;
    }

    function findLyricsDiscogsCollectionAlbums(entry) {
        if (!Array.isArray(topsterDiscogsCollectionAlbums) || !topsterDiscogsCollectionAlbums.length) return [];

        const matches = [];
        const seen = new Set();
        const addMatch = album => {
            if (!album) return;
            const artists = Array.isArray(album.artists) ? album.artists : [];
            const key = `${Number(album.releaseId) || 0}::${discogsOwnedRelationKey(album.title || '')}::${artists.map(discogsOwnedRelationKey).join('|')}`;
            if (seen.has(key)) return;
            seen.add(key);
            matches.push(album);
        };

        const ownershipEntries = lyricsDiscogsSpotifyOwnershipEntries(entry);
        for (const ownershipEntry of ownershipEntries) {
            const entryArtist = cleanAlbumTitle(ownershipEntry.artist || '');
            const entryTitle = cleanAlbumTitle(ownershipEntry.title || '');
            if (!entryTitle || !topsterEntryIsInDiscogsCollection(ownershipEntry)) continue;

            // The alias targets above use the exact physical-release identity when
            // Spotify differs from Discogs. Prefer exact title+compatible-artist rows
            // first; otherwise recover the row through the same per-album rules that
            // the Topster matcher uses after its indexes select candidate albums.
            const exactTitleKey = discogsOwnedRelationKey(entryTitle);
            const exactMatches = topsterDiscogsCollectionAlbums.filter(album => {
                if (discogsOwnedRelationKey(album && album.title || '') !== exactTitleKey) return false;
                const artists = album && Array.isArray(album.artists) && album.artists.length
                    ? album.artists
                    : [album && album.artist || ''];
                return discogsOwnedArtistsMatch(entryArtist, artists);
            });
            if (exactMatches.length) {
                exactMatches.forEach(addMatch);
                continue;
            }

            const candidates = getTopsterDiscogsCandidateAlbums(entryArtist);
            const candidateSet = new Set(candidates);
            if (discogsOwnedEntryHasCrossCreditRule(entryArtist, entryTitle)) {
                topsterDiscogsCollectionAlbums.forEach(album => candidateSet.add(album));
            }
            for (const album of candidateSet) {
                if (lyricsDiscogsCollectionAlbumMatchesEntry(entryArtist, entryTitle, album)) addMatch(album);
            }

            // Preserve the Topster multi-release semantics. A single streaming
            // album can be represented by multiple owned physical records.
            if (discogsOwnedKnownMultiReleaseMatch(entryArtist, entryTitle)) {
                for (const group of DISCOGS_OWNED_MULTI_RELEASE_GROUPS) {
                    if (!discogsOwnedArtistMatchesScopedGroup(entryArtist, group.artists)) continue;
                    if (!(group.entryTitles || []).some(title => discogsOwnedRelationKey(title) === discogsOwnedRelationKey(entryTitle))) continue;
                    for (const requirement of group.requires || []) {
                        const requiredTitleKeys = new Set((requirement.titles || []).map(discogsOwnedRelationKey));
                        topsterDiscogsCollectionAlbums.forEach(album => {
                            const collectionArtists = Array.isArray(album.artists) && album.artists.length
                                ? album.artists
                                : [album.artist || ''];
                            if (!requiredTitleKeys.has(discogsOwnedRelationKey(album.title || ''))) return;
                            if (collectionArtists.some(artist => discogsOwnedArtistMatchesScopedGroup(artist, requirement.artists || group.artists))) {
                                addMatch(album);
                            }
                        });
                    }
                }
            }

            // The Topster confirmed-release fallback is a boolean safety net. If it
            // fired, recover the best concrete collection row so a release tracklist
            // can still be loaded.
            if (discogsOwnedConfirmedReleaseMatch(entryArtist, entryTitle) && !matches.length) {
                let bestAlbum = null;
                let bestScore = 0;
                for (const album of topsterDiscogsCollectionAlbums) {
                    const collectionArtists = Array.isArray(album.artists) && album.artists.length ? album.artists : [album.artist || ''];
                    if (!discogsOwnedArtistsMatch(entryArtist, collectionArtists)) continue;
                    const score = discogsOwnedTitleScore(entryTitle, album.title || '', entryArtist, collectionArtists.join(', '));
                    if (score > bestScore) {
                        bestScore = score;
                        bestAlbum = album;
                    }
                }
                if (bestAlbum && bestScore >= 0.30) addMatch(bestAlbum);
            }
        }

        return matches;
    }

    function setStatus(message, type = "") {
        statusElement.textContent = message;
        statusElement.classList.toggle("error", type === "error");
        statusElement.classList.toggle("success", type === "success");
    }

    function setAuthenticated(authenticated) {
        spotifyAuthenticated = Boolean(authenticated);
        loginButton.textContent = authenticated ? "Spotify Connected" : "Login with Spotify";
        loginButton.classList.toggle("connected", authenticated);
        loginButton.title = authenticated
            ? "Reconnect or switch the Spotify account used by this page."
            : "Connect Spotify so the page can identify the currently playing song.";
        updatePlaybackControls();
    }

    function clearArtwork() {
        coverImage.removeAttribute("src");
        coverFrame.classList.add("empty");
    }

    function setArtwork(url, title) {
        if (!url) {
            clearArtwork();
            return;
        }

        coverImage.onerror = () => {
            coverImage.onerror = null;
            clearArtwork();
        };
        coverImage.src = url;
        coverImage.alt = title ? `${title} artwork` : "Current album artwork";
        coverFrame.classList.remove("empty");
    }


    function setCoverPickerAvailability(release) {
        const validRelease = release && Number(release.releaseId) > 0 ? release : null;
        currentDiscogsRelease = validRelease;
        const entry = lyricsCoverSearchIdentity();
        const canEdit = Boolean(entry.title && !/^unknown album$/i.test(entry.title) && entry.artist && !/^unknown artist$/i.test(entry.artist));
        coverFrame.classList.toggle("editable", canEdit);
        if (canEdit) {
            coverFrame.setAttribute("role", "button");
            coverFrame.setAttribute("tabindex", "0");
            coverFrame.setAttribute("aria-label", "Change album artwork");
            coverFrame.title = validRelease
                ? "Click to change this Discogs release artwork."
                : "Click to change this album artwork.";
        } else {
            coverFrame.removeAttribute("role");
            coverFrame.removeAttribute("tabindex");
            coverFrame.removeAttribute("aria-label");
            coverFrame.removeAttribute("title");
        }
    }

    function isValidLyricsImageUrl(value) {
        try {
            const parsed = new URL(String(value || "").trim());
            return parsed.protocol === "http:" || parsed.protocol === "https:";
        } catch (error) {
            return false;
        }
    }

    function lyricsCoverCandidateKey(value) {
        return String(value || "").trim().replace(/^http:/i, "https:").replace(/[?#].*$/, "").toLowerCase();
    }

    function dedupeLyricsCoverCandidates(candidates) {
        const seen = new Set();
        const unique = [];
        for (const candidate of Array.isArray(candidates) ? candidates : []) {
            if (!candidate || !isValidLyricsImageUrl(candidate.imageSrc)) continue;
            const key = lyricsCoverCandidateKey(candidate.imageSrc);
            if (!key || seen.has(key)) continue;
            seen.add(key);
            unique.push(candidate);
        }
        return unique;
    }

    async function lyricsCoverFetchJson(url, timeoutMs = 12000) {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(url, { cache: "force-cache", signal: controller.signal });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.json();
        } finally {
            window.clearTimeout(timeoutId);
        }
    }

    function lyricsLastfmImage(images) {
        const list = Array.isArray(images) ? images : [];
        for (const size of ["mega", "extralarge", "large", "medium", "small"]) {
            const item = list.find(image => image && image.size === size && (image["#text"] || image.url));
            const url = item && (item["#text"] || item.url);
            if (url && !String(url).includes("2a96cbd8b46e442fc41c2b86b821562f")) return String(url);
        }
        for (let index = list.length - 1; index >= 0; index -= 1) {
            const url = list[index] && (list[index]["#text"] || list[index].url);
            if (url && !String(url).includes("2a96cbd8b46e442fc41c2b86b821562f")) return String(url);
        }
        return "";
    }

    function lyricsItunesArtwork(url) {
        return String(url || "")
            .replace(/\/\d+x\d+bb\.(jpg|png)$/i, "/1000x1000bb.$1")
            .replace(/\/\d+x\d+bb-/i, "/1000x1000bb-");
    }

    function lyricsCoverSearchIdentity() {
        const release = currentDiscogsRelease || {};
        const artists = Array.isArray(release.artists) ? release.artists.filter(Boolean) : [];
        return {
            title: String(release.title || currentDisplayedTrack && currentDisplayedTrack.album || "").trim(),
            artist: String(artists[0] || currentDisplayedTrack && currentDisplayedTrack.artist || "").trim(),
            year: Number(release.year) || null,
        };
    }

    function lyricsCoverStorageIdentity() {
        const track = currentDisplayedTrack || {};
        return {
            title: String(track.album || "").trim(),
            artist: String(track.artist || "").trim(),
        };
    }

    async function resolveLyricsLastfmCoverCandidates(entry) {
        if (!LYRICS_LASTFM_API_KEY || !entry.title) return [];
        const candidates = [];
        if (entry.artist) {
            try {
                const url = new URL("https://ws.audioscrobbler.com/2.0/");
                url.searchParams.set("method", "album.getinfo");
                url.searchParams.set("artist", entry.artist);
                url.searchParams.set("album", entry.title);
                url.searchParams.set("api_key", LYRICS_LASTFM_API_KEY);
                url.searchParams.set("format", "json");
                const data = await lyricsCoverFetchJson(url.href);
                const album = data && data.album;
                const imageSrc = album ? lyricsLastfmImage(album.image) : "";
                if (imageSrc) {
                    candidates.push({
                        title: album.name || entry.title,
                        artist: album.artist || entry.artist,
                        imageSrc,
                        href: album.url || "",
                        source: "Last.fm",
                    });
                }
            } catch (error) {
                // album.search below can still return useful choices.
            }
        }

        const searchUrl = new URL("https://ws.audioscrobbler.com/2.0/");
        searchUrl.searchParams.set("method", "album.search");
        searchUrl.searchParams.set("album", `${entry.artist ? `${entry.artist} ` : ""}${entry.title}`.trim());
        searchUrl.searchParams.set("api_key", LYRICS_LASTFM_API_KEY);
        searchUrl.searchParams.set("format", "json");
        searchUrl.searchParams.set("limit", "20");
        const data = await lyricsCoverFetchJson(searchUrl.href);
        const albums = data && data.results && data.results.albummatches && Array.isArray(data.results.albummatches.album)
            ? data.results.albummatches.album
            : [];
        albums.forEach(album => {
            const imageSrc = lyricsLastfmImage(album && album.image);
            if (!imageSrc) return;
            candidates.push({
                title: album.name || entry.title,
                artist: album.artist || entry.artist,
                imageSrc,
                href: album.url || "",
                source: "Last.fm",
            });
        });
        return candidates;
    }

    async function resolveLyricsItunesCoverCandidates(entry) {
        if (!entry.title) return [];
        const searchTerm = `${entry.artist ? `${entry.artist} ` : ""}${entry.title}${entry.year ? ` ${entry.year}` : ""}`.trim();
        const data = await lyricsCoverFetchJson(`https://itunes.apple.com/search?term=${encodeURIComponent(searchTerm)}&entity=album&limit=20`);
        return (Array.isArray(data && data.results) ? data.results : [])
            .filter(result => result && result.artworkUrl100)
            .map(result => ({
                title: result.collectionName || entry.title,
                artist: result.artistName || entry.artist,
                imageSrc: lyricsItunesArtwork(result.artworkUrl100),
                href: result.collectionViewUrl || "",
                source: "iTunes",
            }));
    }

    async function resolveLyricsMusicBrainzCoverCandidates(entry) {
        if (!entry.title) return [];
        const escapedTitle = entry.title.replace(/"/g, '\\"');
        const escapedArtist = entry.artist.replace(/"/g, '\\"');
        const query = [`releasegroup:"${escapedTitle}"`];
        if (escapedArtist) query.push(`artist:"${escapedArtist}"`);
        const elapsed = Date.now() - lastMusicBrainzCoverLookupAt;
        if (elapsed < 1100) await new Promise(resolve => window.setTimeout(resolve, 1100 - elapsed));
        lastMusicBrainzCoverLookupAt = Date.now();
        const data = await lyricsCoverFetchJson(`https://musicbrainz.org/ws/2/release-group/?query=${encodeURIComponent(query.join(" AND "))}&fmt=json&limit=10`, 15000);
        const groups = Array.isArray(data && data["release-groups"]) ? data["release-groups"] : [];
        const candidates = [];
        for (const group of groups.slice(0, 8)) {
            if (!group || !group.id) continue;
            try {
                const coverData = await lyricsCoverFetchJson(`https://coverartarchive.org/release-group/${encodeURIComponent(group.id)}`, 12000);
                const images = Array.isArray(coverData && coverData.images) ? coverData.images : [];
                const front = images.find(image => image && image.front) || images[0];
                if (!front) continue;
                const thumbnails = front.thumbnails || {};
                const imageSrc = thumbnails["1200"] || thumbnails.large || thumbnails["500"] || thumbnails["250"] || thumbnails.small || front.image || "";
                if (!imageSrc) continue;
                const credit = Array.isArray(group["artist-credit"]) && group["artist-credit"][0]
                    ? (group["artist-credit"][0].name || group["artist-credit"][0].artist && group["artist-credit"][0].artist.name || "")
                    : "";
                candidates.push({
                    title: group.title || entry.title,
                    artist: credit || entry.artist,
                    imageSrc,
                    href: `https://musicbrainz.org/release-group/${group.id}`,
                    source: "MusicBrainz/CAA",
                });
            } catch (error) {
                // Some release groups do not have Cover Art Archive images.
            }
        }
        return candidates;
    }

    async function resolveLyricsInternetArchiveCoverCandidates(entry) {
        if (!entry.title) return [];
        const url = new URL("https://archive.org/advancedsearch.php");
        const safeTitle = entry.title.replace(/"/g, "");
        const safeArtist = entry.artist.replace(/"/g, "");
        const queryParts = [`title:("${safeTitle}")`, "mediatype:(audio)"];
        if (safeArtist) queryParts.push(`creator:("${safeArtist}")`);
        url.searchParams.set("q", queryParts.join(" AND "));
        url.searchParams.append("fl[]", "identifier");
        url.searchParams.append("fl[]", "title");
        url.searchParams.append("fl[]", "creator");
        url.searchParams.set("rows", "20");
        url.searchParams.set("page", "1");
        url.searchParams.set("output", "json");
        const data = await lyricsCoverFetchJson(url.href);
        const docs = data && data.response && Array.isArray(data.response.docs) ? data.response.docs : [];
        return docs.filter(doc => doc && doc.identifier).map(doc => ({
            title: doc.title || entry.title,
            artist: Array.isArray(doc.creator) ? doc.creator.join(", ") : (doc.creator || entry.artist),
            imageSrc: `https://archive.org/services/img/${encodeURIComponent(doc.identifier)}`,
            href: `https://archive.org/details/${encodeURIComponent(doc.identifier)}`,
            source: "Internet Archive",
        }));
    }

    async function resolveLyricsManualCoverCandidates() {
        const entry = lyricsCoverSearchIdentity();
        const groups = await Promise.all([
            resolveLyricsLastfmCoverCandidates(entry).catch(() => []),
            resolveLyricsItunesCoverCandidates(entry).catch(() => []),
            resolveLyricsMusicBrainzCoverCandidates(entry).catch(() => []),
            resolveLyricsInternetArchiveCoverCandidates(entry).catch(() => []),
        ]);
        return dedupeLyricsCoverCandidates(groups.flat()).slice(0, 50);
    }

    function renderLyricsCoverPickerCandidates(candidates) {
        coverPickerResults.replaceChildren();
        candidates.forEach(candidate => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "topster-cover-choice";
            button.title = `${candidate.source || "Cover"}: ${candidate.artist ? `${candidate.artist} - ` : ""}${candidate.title || ""}`;

            const img = document.createElement("img");
            img.src = candidate.imageSrc;
            img.alt = candidate.title || "Album cover option";
            img.loading = "lazy";
            img.onerror = () => button.remove();

            const label = document.createElement("span");
            label.textContent = `${candidate.source || "Source"}${candidate.title ? ` · ${candidate.title}` : ""}`;
            button.append(img, label);
            button.addEventListener("click", () => saveLyricsDiscogsCover(candidate));
            coverPickerResults.appendChild(button);
        });
    }

    async function loadLyricsCoverPickerResults() {
        if (!coverPicker || coverPicker.hidden || !coverPickerResults || !coverPickerStatus) return;
        const token = ++coverPickerLookupToken;
        coverPickerResults.replaceChildren();
        const entry = lyricsCoverSearchIdentity();
        coverPickerStatus.textContent = `Searching all available cover sources for ${entry.artist ? `${entry.artist} - ` : ""}${entry.title}...`;
        try {
            const candidates = await resolveLyricsManualCoverCandidates();
            if (token !== coverPickerLookupToken) return;
            renderLyricsCoverPickerCandidates(candidates);
            coverPickerStatus.textContent = candidates.length
                ? `Select one of ${candidates.length} cover results, or paste an Image Link above.`
                : "No cover results were found. Paste an Image Link above to set one manually.";
        } catch (error) {
            if (token !== coverPickerLookupToken) return;
            coverPickerStatus.textContent = "Cover search failed. Paste an Image Link above to set the cover manually.";
        }
    }

    function openLyricsCoverPicker() {
        if (!coverPicker) return;
        const entry = lyricsCoverSearchIdentity();
        if (!entry.title || /^unknown album$/i.test(entry.title) || !entry.artist || /^unknown artist$/i.test(entry.artist)) return;
        coverPickerLookupToken += 1;
        coverPicker.hidden = false;
        coverPickerTitle.textContent = `Select cover: ${entry.artist ? `${entry.artist} - ` : ""}${entry.title}`;
        coverPickerResults.replaceChildren();
        coverPickerStatus.textContent = "Searching all available cover sources...";
        coverPickerLink.value = "";
        loadLyricsCoverPickerResults();
    }

    function closeLyricsCoverPicker() {
        coverPickerLookupToken += 1;
        if (coverPicker) coverPicker.hidden = true;
    }

    async function saveLyricsDiscogsCover(candidate) {
        if (!candidate || !isValidLyricsImageUrl(candidate.imageSrc)) return;
        const entry = lyricsCoverSearchIdentity();
        const storageEntry = lyricsCoverStorageIdentity();
        if (!entry.title || !entry.artist || !storageEntry.title || !storageEntry.artist) return;
        coverPickerStatus.textContent = "Saving cover...";
        try {
            const requestPayload = {
                artist: storageEntry.artist,
                album: storageEntry.title,
                imageUrl: candidate.imageSrc,
                source: candidate.source || "Manual",
                href: candidate.href || "",
            };
            if (currentDiscogsRelease && Number(currentDiscogsRelease.releaseId)) {
                requestPayload.releaseId = Number(currentDiscogsRelease.releaseId);
            }
            const response = await fetch(`${API_BASE_URL}/api/manual-cover`, {
                method: "POST",
                credentials: "include",
                cache: "no-store",
                headers: { "Content-Type": "application/json", Accept: "application/json" },
                body: JSON.stringify(requestPayload),
            });
            const payload = await response.json();
            if (!response.ok || !payload || payload.ok !== true) throw new Error(payload && payload.error ? payload.error : `HTTP ${response.status}`);
            if (lastDiscogsTracklistPayload && currentDiscogsRelease && Number(lastDiscogsTracklistPayload.release && lastDiscogsTracklistPayload.release.releaseId) === Number(currentDiscogsRelease.releaseId)) {
                lastDiscogsTracklistPayload.coverOverride = payload.coverOverride || null;
            }
            if (currentDisplayedTrack) currentDisplayedTrack.manualCoverOverride = payload.coverOverride || null;
            setArtwork(payload.coverOverride && payload.coverOverride.imageUrl ? payload.coverOverride.imageUrl : candidate.imageSrc, lastDefaultArtworkTitle);
            closeLyricsCoverPicker();
        } catch (error) {
            coverPickerStatus.textContent = `Could not save cover: ${error.message || error}`;
        }
    }

    function useLyricsManualImageLink() {
        const imageSrc = String(coverPickerLink && coverPickerLink.value || "").trim();
        if (!isValidLyricsImageUrl(imageSrc)) {
            coverPickerStatus.textContent = "Enter a valid http:// or https:// image link.";
            return;
        }
        saveLyricsDiscogsCover({ imageSrc, href: imageSrc, source: "Image Link", title: lyricsCoverSearchIdentity().title });
    }

    async function resetLyricsDiscogsCover() {
        const entry = lyricsCoverSearchIdentity();
        const storageEntry = lyricsCoverStorageIdentity();
        if (!entry.title || !entry.artist || !storageEntry.title || !storageEntry.artist) return;
        coverPickerStatus.textContent = "Resetting cover...";
        try {
            const requestPayload = { artist: storageEntry.artist, album: storageEntry.title, reset: true };
            if (currentDiscogsRelease && Number(currentDiscogsRelease.releaseId)) {
                requestPayload.releaseId = Number(currentDiscogsRelease.releaseId);
            }
            const response = await fetch(`${API_BASE_URL}/api/manual-cover`, {
                method: "DELETE",
                credentials: "include",
                cache: "no-store",
                headers: { "Content-Type": "application/json", Accept: "application/json" },
                body: JSON.stringify(requestPayload),
            });
            const payload = await response.json();
            if (!response.ok || !payload || payload.ok !== true) throw new Error(payload && payload.error ? payload.error : `HTTP ${response.status}`);
            if (lastDiscogsTracklistPayload && currentDiscogsRelease && Number(lastDiscogsTracklistPayload.release && lastDiscogsTracklistPayload.release.releaseId) === Number(currentDiscogsRelease.releaseId)) {
                lastDiscogsTracklistPayload.coverOverride = null;
            }
            if (currentDisplayedTrack) currentDisplayedTrack.manualCoverOverride = null;
            setArtwork(lastDefaultArtworkUrl, lastDefaultArtworkTitle);
            closeLyricsCoverPicker();
        } catch (error) {
            coverPickerStatus.textContent = `Could not reset cover: ${error.message || error}`;
        }
    }

    if (coverPicker && coverPickerClose && coverPickerSearch && coverPickerLink && coverPickerLinkButton && coverPickerResetDefault) {
        coverPickerClose.addEventListener("click", closeLyricsCoverPicker);
        coverPickerSearch.addEventListener("click", loadLyricsCoverPickerResults);
        coverPickerLinkButton.addEventListener("click", useLyricsManualImageLink);
        coverPickerResetDefault.addEventListener("click", resetLyricsDiscogsCover);
        coverPickerLink.addEventListener("keydown", event => {
            if (event.key === "Enter") {
                event.preventDefault();
                useLyricsManualImageLink();
            }
        });
        coverPicker.addEventListener("click", event => {
            if (event.target === coverPicker) closeLyricsCoverPicker();
        });
        coverFrame.addEventListener("click", openLyricsCoverPicker);
        coverFrame.addEventListener("keydown", event => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openLyricsCoverPicker();
            }
        });
    }

    function updateScrobbleModeUi() {
        if (scrobbleModeToggle) {
            scrobbleModeToggle.checked = scrobbleModeEnabled;
            scrobbleModeToggle.setAttribute("aria-checked", scrobbleModeEnabled ? "true" : "false");
        }
    }

    function updateVinylModeUi() {
        if (vinylModeToggle) {
            vinylModeToggle.checked = vinylModeEnabled;
            vinylModeToggle.setAttribute("aria-checked", vinylModeEnabled ? "true" : "false");
        }
    }

    function persistPlaybackModeState() {
        try {
            window.localStorage.setItem(SCROBBLE_MODE_STORAGE_KEY, scrobbleModeEnabled ? "1" : "0");
            window.localStorage.setItem(VINYL_MODE_STORAGE_KEY, vinylModeEnabled ? "1" : "0");
        } catch (error) {
            // Playback modes still work for the current page when storage is unavailable.
        }
    }

    function setScrobbleModeEnabled(enabled) {
        scrobbleModeEnabled = Boolean(enabled);
        if (scrobbleModeEnabled) {
            vinylModeEnabled = false;
            clearVinylSideEndPause();
        }
        persistPlaybackModeState();
        updateScrobbleModeUi();
        updateVinylModeUi();

        if (!scrobbleModeEnabled) {
            clearScrobbleAlbumEndPause();
            return;
        }
        if (currentTrackEndsAlbum && currentDisplayedTrack) {
            armScrobbleAlbumEndPause(currentDisplayedTrack);
        }
    }

    function setVinylModeEnabled(enabled) {
        vinylModeEnabled = Boolean(enabled);
        if (vinylModeEnabled) {
            scrobbleModeEnabled = false;
            clearScrobbleAlbumEndPause();
        }
        persistPlaybackModeState();
        updateScrobbleModeUi();
        updateVinylModeUi();

        if (!vinylModeEnabled) {
            clearVinylSideEndPause();
            return;
        }
        if (currentTrackEndsVinylSide && currentDisplayedTrack && currentTrackVinylSide) {
            armVinylSideEndPause(currentDisplayedTrack, currentTrackVinylSide);
        }
    }

    updateScrobbleModeUi();
    updateVinylModeUi();
    if (scrobbleModeToggle) {
        scrobbleModeToggle.addEventListener("change", () => setScrobbleModeEnabled(scrobbleModeToggle.checked));
    }
    if (vinylModeToggle) {
        vinylModeToggle.addEventListener("change", () => setVinylModeEnabled(vinylModeToggle.checked));
    }

    function clearVinylSideEndPause(options = {}) {
        if (vinylSideEndPauseTimer) {
            window.clearTimeout(vinylSideEndPauseTimer);
            vinylSideEndPauseTimer = null;
        }
        if (options.forget !== false) vinylSideEndPauseArm = null;
    }

    async function pauseSpotifyAtVinylSideEnd(arm, options = {}) {
        if (!vinylModeEnabled || !arm || !spotifyAuthenticated) return;
        if (!options.force && vinylSideEndPauseArm !== arm) return;
        // Never let a heavily throttled background-tab timer pause an unrelated
        // song long after the intended vinyl side boundary.
        if (arm.expectedEndAt && Date.now() - arm.expectedEndAt > 5000) {
            if (vinylSideEndPauseArm === arm) clearVinylSideEndPause();
            return;
        }
        if (!playbackClock.isPlaying) return;
        if (playbackControlInProgress) {
            vinylSideEndPauseTimer = window.setTimeout(() => pauseSpotifyAtVinylSideEnd(arm), 175);
            return;
        }

        if (arm.endsAlbum) {
            void autoSaveScoreAtVinylAlbumEnd(arm);
        }

        playbackControlInProgress = true;
        playbackClock.progressMs = estimatedPlaybackProgress();
        playbackClock.isPlaying = false;
        playbackClock.sampledAt = Date.now();
        renderPlaybackProgress();
        updatePlaybackControls();

        try {
            const response = await fetch(`${API_BASE_URL}/api/lyrics/control/pause`, {
                method: "POST",
                credentials: "include",
                cache: "no-store",
                headers: { Accept: "application/json" },
            });
            const data = await response.json().catch(() => null);
            if (!response.ok || !data || data.ok !== true) {
                throw new Error(data && data.error ? data.error : `HTTP ${response.status}`);
            }
            setStatus(`Paused after SIDE ${arm.side}.`, "success");
            if (vinylSideEndPauseArm === arm) clearVinylSideEndPause();
            window.setTimeout(() => fetchCurrentLyrics(false), 300);
        } catch (error) {
            playbackClock.isPlaying = true;
            playbackClock.sampledAt = Date.now();
            setStatus(`Could not pause at the end of SIDE ${arm.side}: ${error.message || error}`, "error");
            if (vinylSideEndPauseArm === arm) clearVinylSideEndPause();
            window.setTimeout(() => fetchCurrentLyrics(false), 300);
        } finally {
            playbackControlInProgress = false;
            updatePlaybackControls();
        }
    }

    function scheduleVinylSideEndPause() {
        if (vinylSideEndPauseTimer) {
            window.clearTimeout(vinylSideEndPauseTimer);
            vinylSideEndPauseTimer = null;
        }
        if (!vinylModeEnabled) return;
        const arm = vinylSideEndPauseArm;
        if (!arm || !currentDisplayedTrack || !playbackClock.isPlaying) return;
        const currentTrackKey = String(currentDisplayedTrack.key || `${currentDisplayedTrack.artist}::${currentDisplayedTrack.title}`);
        if (currentTrackKey !== arm.trackKey || lastTrackKey !== arm.trackKey) return;

        const durationMs = Math.max(0, Number(playbackClock.durationMs) || 0);
        if (!durationMs) return;
        const remainingMs = Math.max(0, durationMs - estimatedPlaybackProgress());
        arm.expectedEndAt = Date.now() + remainingMs;

        // Request the pause just after Spotify's reported track end. This avoids
        // clipping the final audible fraction of the side-ending song. If Spotify
        // has already advanced, the following side is paused almost immediately.
        const delayMs = Math.max(0, remainingMs + 100);
        vinylSideEndPauseTimer = window.setTimeout(() => pauseSpotifyAtVinylSideEnd(arm), delayMs);
    }

    function armVinylSideEndPause(track, side) {
        if (!vinylModeEnabled) {
            clearVinylSideEndPause();
            return;
        }
        const trackKey = String(track && (track.key || `${track.artist}::${track.title}`) || "");
        const normalizedSide = String(side || "").trim().toUpperCase();
        if (!trackKey || !normalizedSide) {
            clearVinylSideEndPause();
            return;
        }
        if (!vinylSideEndPauseArm || vinylSideEndPauseArm.trackKey !== trackKey || vinylSideEndPauseArm.side !== normalizedSide) {
            clearVinylSideEndPause();
            vinylSideEndPauseArm = { trackKey, side: normalizedSide };
        }
        vinylSideEndPauseArm.endsAlbum = Boolean(currentTrackEndsAlbum);
        vinylSideEndPauseArm.scoreContext = currentTrackEndsAlbum && currentScoreContext
            ? scoreContextSnapshot(currentScoreContext)
            : null;
        scheduleVinylSideEndPause();
    }


    function clearScrobbleAlbumEndPause(options = {}) {
        if (scrobbleAlbumEndPauseTimer) {
            window.clearTimeout(scrobbleAlbumEndPauseTimer);
            scrobbleAlbumEndPauseTimer = null;
        }
        if (options.forget !== false) scrobbleAlbumEndPauseArm = null;
    }

    async function pauseSpotifyAtScrobbleAlbumEnd(arm, options = {}) {
        if (!scrobbleModeEnabled || !arm || !spotifyAuthenticated) return;
        if (!options.force && scrobbleAlbumEndPauseArm !== arm) return;
        if (arm.expectedEndAt && Date.now() - arm.expectedEndAt > 5000) {
            if (scrobbleAlbumEndPauseArm === arm) clearScrobbleAlbumEndPause();
            return;
        }
        if (!playbackClock.isPlaying) return;
        if (playbackControlInProgress) {
            scrobbleAlbumEndPauseTimer = window.setTimeout(() => pauseSpotifyAtScrobbleAlbumEnd(arm), 175);
            return;
        }

        playbackControlInProgress = true;
        playbackClock.progressMs = estimatedPlaybackProgress();
        playbackClock.isPlaying = false;
        playbackClock.sampledAt = Date.now();
        renderPlaybackProgress();
        updatePlaybackControls();

        try {
            const response = await fetch(`${API_BASE_URL}/api/lyrics/control/pause`, {
                method: "POST",
                credentials: "include",
                cache: "no-store",
                headers: { Accept: "application/json" },
            });
            const data = await response.json().catch(() => null);
            if (!response.ok || !data || data.ok !== true) {
                throw new Error(data && data.error ? data.error : `HTTP ${response.status}`);
            }
            setStatus("Paused after the final track of the album.", "success");
            if (scrobbleAlbumEndPauseArm === arm) clearScrobbleAlbumEndPause();
            window.setTimeout(() => fetchCurrentLyrics(false), 300);
        } catch (error) {
            playbackClock.isPlaying = true;
            playbackClock.sampledAt = Date.now();
            setStatus(`Could not pause at the end of the album: ${error.message || error}`, "error");
            if (scrobbleAlbumEndPauseArm === arm) clearScrobbleAlbumEndPause();
            window.setTimeout(() => fetchCurrentLyrics(false), 300);
        } finally {
            playbackControlInProgress = false;
            updatePlaybackControls();
        }
    }

    function scheduleScrobbleAlbumEndPause() {
        if (scrobbleAlbumEndPauseTimer) {
            window.clearTimeout(scrobbleAlbumEndPauseTimer);
            scrobbleAlbumEndPauseTimer = null;
        }
        if (!scrobbleModeEnabled) return;
        const arm = scrobbleAlbumEndPauseArm;
        if (!arm || !currentDisplayedTrack || !playbackClock.isPlaying) return;
        const currentTrackKey = String(currentDisplayedTrack.key || `${currentDisplayedTrack.artist}::${currentDisplayedTrack.title}`);
        if (currentTrackKey !== arm.trackKey || lastTrackKey !== arm.trackKey) return;

        const durationMs = Math.max(0, Number(playbackClock.durationMs) || 0);
        if (!durationMs) return;
        const remainingMs = Math.max(0, durationMs - estimatedPlaybackProgress());
        arm.expectedEndAt = Date.now() + remainingMs;
        scrobbleAlbumEndPauseTimer = window.setTimeout(() => pauseSpotifyAtScrobbleAlbumEnd(arm), Math.max(0, remainingMs + 100));
    }

    function armScrobbleAlbumEndPause(track) {
        if (!scrobbleModeEnabled) {
            clearScrobbleAlbumEndPause();
            return;
        }
        const trackKey = String(track && (track.key || `${track.artist}::${track.title}`) || "");
        if (!trackKey) {
            clearScrobbleAlbumEndPause();
            return;
        }
        if (!scrobbleAlbumEndPauseArm || scrobbleAlbumEndPauseArm.trackKey !== trackKey) {
            clearScrobbleAlbumEndPause();
            scrobbleAlbumEndPauseArm = { trackKey };
        }
        scheduleScrobbleAlbumEndPause();
    }

    function setDiscogsStatus(message, type = "") {
        discogsStatus.textContent = message;
        discogsStatus.classList.toggle("error", type === "error");
    }

    function resetDiscogsTracklist(options = {}) {
        discogsLookupRequestId += 1;
        if (options.clearLookup !== false) {
            lastDiscogsAlbumLookupKey = "";
            lastDiscogsRenderedLookupKey = "";
            discogsLookupInFlightKey = "";
            lastDiscogsTracklistPayload = null;
        }
        discogsSides.replaceChildren();
        discogsReleaseMeta.replaceChildren();
        discogsReleaseMeta.hidden = true;
        discogsConditionMeta.replaceChildren();
        discogsConditionMeta.hidden = true;
        currentTrackEndsVinylSide = false;
        currentTrackVinylSide = "";
        currentTrackEndsAlbum = false;
        clearVinylSideEndPause();
        clearScrobbleAlbumEndPause();
        resetLyricsScoreCard();
        discogsTotalLength.textContent = "";
        discogsTotalLength.hidden = true;
        setCoverPickerAvailability(null);
        setDiscogsStatus("Waiting for a currently playing album.");
        if (options.hide !== false) discogsCard.classList.add("lyrics-hidden");
    }

    function lyricsDiscogsAlbumArtist(track) {
        const albumArtists = Array.isArray(track && track.albumArtists) ? track.albumArtists : [];
        if (albumArtists.length && String(albumArtists[0] || "").trim()) return String(albumArtists[0]).trim();
        const trackArtists = Array.isArray(track && track.artists) ? track.artists : [];
        if (trackArtists.length && String(trackArtists[0] || "").trim()) return String(trackArtists[0]).trim();
        return String(track && (track.albumArtist || track.artist) || "").split(",")[0].trim();
    }

    function lyricsDiscogsNormalizeTrackText(value) {
        return String(value || "")
            .normalize("NFKD")
            .toLocaleLowerCase()
            .replace(/&/g, " and ")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[’']/g, "")
            .replace(/[^\p{L}\p{N}]+/gu, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    function lyricsDiscogsCompactTrackText(value) {
        return lyricsDiscogsNormalizeTrackText(value).replace(/\s+/g, "");
    }

    function lyricsDiscogsCleanTrackTitle(value) {
        const qualifierWords = "remaster(?:ed|ing)?|live|radio edit|single edit|album version|mono|stereo|bonus track|deluxe|version|mix|edit|instrumental|karaoke";
        let text = String(value || "").trim();
        if (!text) return "";
        text = text.replace(new RegExp(`\\s*[\\[(][^\\])]*(?:${qualifierWords})[^\\])]*[\\])]\\s*`, "gi"), " ");
        text = text.replace(new RegExp(`\\s+-\\s+[^-]*(?:${qualifierWords})[^-]*$`, "i"), "");
        text = text.replace(/\s*[\[(]\s*(?:feat\.?|featuring|with)\b[^\])]*[\])]\s*$/i, "");
        return text.replace(/\s+/g, " ").replace(/^\s*-|\s*-\s*$/g, "").trim();
    }

    function lyricsDiscogsTrackTitleVariants(value) {
        const raw = String(value || "").trim();
        const variants = [];
        const seen = new Set();
        const add = candidate => {
            const clean = String(candidate || "").replace(/\s+/g, " ").trim();
            const key = lyricsDiscogsNormalizeTrackText(clean);
            if (!clean || !key || seen.has(key)) return;
            seen.add(key);
            variants.push(clean);
        };

        add(raw);
        add(lyricsDiscogsCleanTrackTitle(raw));
        add(raw.replace(/\s*[\[(][^\])]*[\])]\s*$/g, ""));
        add(raw.replace(/\s+(?:feat\.?|featuring)\s+.+$/i, ""));

        // On Spotify, a local/imported title may have the performer appended after
        // " - ". Within an already matched Discogs release, the left side is a
        // useful low-risk song-title candidate (e.g. "Bahia - Stan Getz, Charlie Byrd").
        const dashIndex = raw.indexOf(" - ");
        if (dashIndex >= 3) add(raw.slice(0, dashIndex));
        return variants;
    }

    function lyricsDiscogsLevenshteinDistance(leftValue, rightValue) {
        const left = String(leftValue || "");
        const right = String(rightValue || "");
        if (left === right) return 0;
        if (!left) return right.length;
        if (!right) return left.length;
        let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
        for (let i = 1; i <= left.length; i += 1) {
            const current = [i];
            for (let j = 1; j <= right.length; j += 1) {
                current[j] = Math.min(
                    current[j - 1] + 1,
                    previous[j] + 1,
                    previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1),
                );
            }
            previous = current;
        }
        return previous[right.length];
    }

    function lyricsDiscogsTrackMatchScore(currentTitle, candidateTitle) {
        const currentVariants = lyricsDiscogsTrackTitleVariants(currentTitle);
        const candidateVariants = lyricsDiscogsTrackTitleVariants(candidateTitle);
        if (!currentVariants.length || !candidateVariants.length) return 0;

        let best = 0;
        for (const currentVariant of currentVariants) {
            for (const candidateVariant of candidateVariants) {
                const currentKey = lyricsDiscogsNormalizeTrackText(currentVariant);
                const candidateKey = lyricsDiscogsNormalizeTrackText(candidateVariant);
                if (!currentKey || !candidateKey) continue;
                if (currentKey === candidateKey) return 1;

                const currentCompact = currentKey.replace(/\s+/g, "");
                const candidateCompact = candidateKey.replace(/\s+/g, "");
                if (currentCompact && currentCompact === candidateCompact) return 0.99;

                const shorterCompact = currentCompact.length <= candidateCompact.length ? currentCompact : candidateCompact;
                const longerCompact = currentCompact.length > candidateCompact.length ? currentCompact : candidateCompact;
                if (shorterCompact.length >= 4 && longerCompact.startsWith(shorterCompact)) {
                    best = Math.max(best, 0.93);
                }

                const leftTokens = new Set(currentKey.split(/\s+/).filter(Boolean));
                const rightTokens = new Set(candidateKey.split(/\s+/).filter(Boolean));
                if (leftTokens.size && rightTokens.size) {
                    let intersection = 0;
                    leftTokens.forEach(token => { if (rightTokens.has(token)) intersection += 1; });
                    const containment = intersection / Math.max(1, Math.min(leftTokens.size, rightTokens.size));
                    const overlap = intersection / Math.max(leftTokens.size, rightTokens.size);
                    if (containment === 1 && Math.min(leftTokens.size, rightTokens.size) >= 2) best = Math.max(best, 0.91);
                    else if (containment >= 0.8) best = Math.max(best, 0.84);
                    else if (overlap >= 0.6) best = Math.max(best, 0.72);
                }

                if (Math.min(currentCompact.length, candidateCompact.length) >= 4) {
                    const distance = lyricsDiscogsLevenshteinDistance(currentCompact, candidateCompact);
                    const maxLength = Math.max(currentCompact.length, candidateCompact.length);
                    if (distance <= 1) best = Math.max(best, 0.90);
                    else if (distance <= 2 && maxLength >= 8) best = Math.max(best, 0.78);
                }
            }
        }
        return best;
    }

    function lyricsDiscogsSideFromPosition(position) {
        const text = String(position || "").trim().toUpperCase();
        if (!text) return "";
        const match = text.match(/^([A-Z]{1,3})(?=\d|$|[-.])/);
        return match ? match[1] : "";
    }

    function lyricsDiscogsCompositePosition(subTracks) {
        const positions = (Array.isArray(subTracks) ? subTracks : [])
            .map(entry => String(entry && entry.position || "").trim().toUpperCase())
            .filter(Boolean);
        if (!positions.length) return "";

        const bases = positions.map(position => position.replace(/[-.]?[IVXLCDM]+$/i, ""));
        const firstBase = bases[0];
        if (firstBase && bases.every(base => base === firstBase)) return firstBase;

        const sides = positions.map(lyricsDiscogsSideFromPosition).filter(Boolean);
        if (sides.length && sides.every(side => side === sides[0])) return sides[0];
        return "";
    }

    function flattenLyricsDiscogsTracklist(tracklist, inheritedSide = "", rows = []) {
        let currentSide = inheritedSide;
        for (const entry of Array.isArray(tracklist) ? tracklist : []) {
            if (!entry || typeof entry !== "object") continue;
            const rawPosition = String(entry.position || "").trim();
            const title = String(entry.title || "").trim();
            const duration = String(entry.duration || "").trim();
            const type = String(entry.type || "track").toLowerCase();
            const artists = Array.isArray(entry.artists)
                ? entry.artists.map(value => String(value || "").trim()).filter(Boolean)
                : [];
            const subTracks = Array.isArray(entry.subTracks) ? entry.subTracks : [];

            if (type === "index") {
                if (title && duration) {
                    // A timed Discogs index is the actual composite song; its A-I,
                    // A-II / B3-I, B3-II children are sections/movements, not songs.
                    const position = rawPosition || lyricsDiscogsCompositePosition(subTracks);
                    const side = lyricsDiscogsSideFromPosition(position) || currentSide || inheritedSide;
                    if (side) currentSide = side;
                    rows.push({ position, title, duration, side, type, artists });
                } else if (subTracks.length) {
                    // An untimed index is only a structural heading (e.g. "Le Sacre
                    // Du Printemps"). Omit the heading itself and keep its real A/B
                    // child tracks.
                    flattenLyricsDiscogsTracklist(subTracks, currentSide || inheritedSide, rows);
                }
                continue;
            }

            const detectedSide = lyricsDiscogsSideFromPosition(rawPosition);
            if (detectedSide) currentSide = detectedSide;
            if (title && type === "track") {
                rows.push({
                    position: rawPosition,
                    title,
                    duration,
                    side: detectedSide || currentSide || "",
                    type,
                    artists,
                });
            }

            if (subTracks.length && !duration) {
                flattenLyricsDiscogsTracklist(subTracks, detectedSide || currentSide || inheritedSide, rows);
            }
        }
        return rows;
    }

    function lyricsDiscogsFormatSummary(release) {
        const labels = [];
        for (const format of Array.isArray(release && release.formats) ? release.formats : []) {
            if (!format || typeof format !== "object") continue;
            const name = String(format.name || "").trim();
            if (name) labels.push(name);
            for (const description of Array.isArray(format.descriptions) ? format.descriptions : []) {
                const text = String(description || "").trim();
                if (text) labels.push(text);
            }
        }
        return Array.from(new Set(labels)).join(" · ");
    }

    function lyricsDiscogsDurationSeconds(value) {
        const text = String(value || "").trim();
        if (!text) return null;
        const parts = text.split(":");
        if (parts.length < 2 || parts.length > 3 || parts.some(part => !/^\d+$/.test(part))) return null;
        const numbers = parts.map(Number);
        if (numbers.some(number => !Number.isFinite(number) || number < 0)) return null;
        if (parts.length === 2) return numbers[0] * 60 + numbers[1];
        return numbers[0] * 3600 + numbers[1] * 60 + numbers[2];
    }

    function lyricsDiscogsFormatDurationSeconds(seconds) {
        const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
        const minutes = Math.floor(safeSeconds / 60);
        const remainder = safeSeconds % 60;
        return `${minutes}:${String(remainder).padStart(2, "0")}`;
    }

    function lyricsDiscogsConditionColor(value) {
        const text = String(value || "").trim().toLowerCase();
        if (!text) return "";
        if (/near\s+mint|\bnm\b/.test(text)) return "#3cb3ff";
        if (/very\s+good\s*(?:plus|\+)|\bvg\+\b/.test(text)) return "#7dd956";
        if (/very\s+good|\bvg\b/.test(text)) return "#FFEF00";
        if (/good\s*(?:plus|\+)|\bg\+\b/.test(text)) return "#ff914c";
        if (/\bgood\b|\bg\b/.test(text)) return "#ff5757";
        if (/\bfair\b|\bpoor\b|\bf\b|\bp\b/.test(text)) return "#9F000F";
        if (/\bmint\b|^m(?:\s|\(|$)/.test(text)) return "#a47df0";
        return "";
    }

    function scoreBandForHundredScale(value) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return null;
        return SCORE_COLOR_BANDS.find(band => numeric >= band.min) || SCORE_COLOR_BANDS[SCORE_COLOR_BANDS.length - 1];
    }

    function scoreBandForTrackScore(value) {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? scoreBandForHundredScale(numeric * 10) : null;
    }

    function albumScoreVisualForHundredScale(value) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return null;
        const band = ALBUM_SCORE_VISUAL_BANDS.find(candidate => numeric >= candidate.min)
            || ALBUM_SCORE_VISUAL_BANDS[ALBUM_SCORE_VISUAL_BANDS.length - 1];
        const topFilename = band.tier === "high"
            ? "rating_strong.png"
            : (band.tier === "mid" ? "rating_decent.png" : (band.tier === "low" ? "rating_light.png" : ""));
        const bottomFilename = band.rating
            ? `rating_${band.rating}.png`
            : "rating_not_good.png";
        return { ...band, topFilename, bottomFilename };
    }

    function makeAlbumScoreImage(filename, className, altText) {
        const image = document.createElement("img");
        image.className = className;
        image.src = new URL(`${SCORE_RATING_IMAGE_BASE}${filename}`, window.location.href).href;
        image.alt = altText;
        image.loading = "lazy";
        image.decoding = "async";
        return image;
    }

    function parseMyAlbumsScoreFile(text) {
        const albums = [];
        const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
        let index = 0;

        while (index < lines.length) {
            while (index < lines.length && !lines[index].trim()) index += 1;
            if (index >= lines.length) break;

            const startLine = index;
            while (index < lines.length && lines[index].trim()) index += 1;
            const endLine = index;
            const block = lines.slice(startLine, endLine);
            if (!block.length) continue;

            const header = block[0].trim();
            const scoredHeader = header.match(/^(.+?):\s*(-?\d+(?:\.\d+)?)%\s*$/);
            const unscoredHeader = header.match(/^(.+?):\s*$/);
            const hasTrackLines = block.slice(1).some(line => /^.+?:\s*-?\d+(?:\.\d+)?(?:\s+.*)?$/.test(line.trim()));
            if (!scoredHeader && !(unscoredHeader && hasTrackLines)) continue;

            const entry = {
                title: (scoredHeader ? scoredHeader[1] : unscoredHeader[1]).trim(),
                overallScore: scoredHeader ? Number(scoredHeader[2]) : null,
                tracks: [],
                startLine,
                endLine,
                headerLine: block[0],
                hasOverallScore: Boolean(scoredHeader),
            };

            for (const rawTrackLine of block.slice(1)) {
                const line = rawTrackLine.trim();
                const trackMatch = line.match(/^(.+?):\s*(-?\d+(?:\.\d+)?)(?:\s+.*)?$/);
                if (trackMatch) {
                    entry.tracks.push({ title: trackMatch[1].trim(), score: Number(trackMatch[2]) });
                    continue;
                }
                const blankTrackMatch = line.match(/^(.+?):\s*$/);
                if (blankTrackMatch) entry.tracks.push({ title: blankTrackMatch[1].trim(), score: null });
            }
            albums.push(entry);
        }
        return albums;
    }

    async function fetchMyAlbumsScoreText() {
        try {
            const response = await fetch(`${API_BASE_URL}/api/lyrics/my-albums`, {
                method: "GET",
                credentials: "include",
                cache: "no-store",
                headers: { Accept: "application/json" },
            });
            if (response.ok) {
                const payload = await response.json();
                const storedText = payload && typeof payload.text === "string" ? payload.text : "";
                myAlbumsScoreRevision = payload && typeof payload.revision === "string" ? payload.revision : "";
                if (storedText.trim()) return storedText;
            }
        } catch (error) {
            // Before the first edit, production can still use the static site copy.
        }

        myAlbumsScoreRevision = "";
        const response = await fetch(new URL(MY_ALBUMS_SCORE_FILE, window.location.href).href, { cache: "force-cache" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.text();
    }

    function setMyAlbumsScoreText(text) {
        myAlbumsScoreText = String(text || "").replace(/\r\n?/g, "\n");
        myAlbumsScoreEntries = parseMyAlbumsScoreFile(myAlbumsScoreText);
        myAlbumsAlbumMatchCache.clear();
        myAlbumsAlbumTitleIndex = new Map();
        myAlbumsTrackTitleIndex = new Map();
        const addIndexValue = (map, key, entry) => {
            if (!key) return;
            if (!map.has(key)) map.set(key, []);
            map.get(key).push(entry);
        };
        myAlbumsScoreEntries.forEach(entry => {
            addIndexValue(myAlbumsAlbumTitleIndex, normalizeAlbumTitle(entry.title || ""), entry);
            (entry.tracks || []).forEach(track => {
                lyricsDiscogsTrackTitleVariants(track.title || "").forEach(variant => {
                    addIndexValue(myAlbumsTrackTitleIndex, lyricsDiscogsNormalizeTrackText(variant), entry);
                });
            });
        });
        myAlbumsScoresLoaded = true;
    }

    function loadMyAlbumsScores() {
        if (myAlbumsScoresPromise) return myAlbumsScoresPromise;
        myAlbumsScoresPromise = fetchMyAlbumsScoreText()
            .then(text => {
                setMyAlbumsScoreText(text);
                if (lastDiscogsTracklistPayload && lastDiscogsTracklistPayload.release) {
                    const release = lastDiscogsTracklistPayload.release;
                    const rows = flattenLyricsDiscogsTracklist(release.tracklist || []);
                    if (rows.length) renderLyricsScoreCard(release, lastDiscogsTracklistPayload.collectionAlbum || {}, rows, -1);
                }
                return myAlbumsScoreEntries;
            })
            .catch(() => {
                myAlbumsScoreText = "";
                myAlbumsScoreEntries = [];
                myAlbumsAlbumMatchCache.clear();
                myAlbumsAlbumTitleIndex = new Map();
                myAlbumsTrackTitleIndex = new Map();
                myAlbumsScoresLoaded = true;
                return [];
            });
        return myAlbumsScoresPromise;
    }

    function myAlbumsAlbumTitleScore(candidateTitle, wantedTitle) {
        const left = normalizeAlbumTitle(candidateTitle);
        const right = normalizeAlbumTitle(wantedTitle);
        if (!left || !right) return 0;
        if (left === right) return 1;
        if (left.length >= 5 && right.length >= 5 && (left.includes(right) || right.includes(left))) return 0.88;
        const leftTokens = new Set(tokenizeTitle(candidateTitle));
        const rightTokens = new Set(tokenizeTitle(wantedTitle));
        if (!leftTokens.size || !rightTokens.size) return 0;
        let common = 0;
        leftTokens.forEach(token => { if (rightTokens.has(token)) common += 1; });
        const containment = common / Math.max(1, Math.min(leftTokens.size, rightTokens.size));
        if (containment === 1 && Math.min(leftTokens.size, rightTokens.size) >= 2) return 0.84;
        if (containment >= 0.75) return 0.72;
        return 0;
    }

    function myAlbumsTrackCoverageScore(albumEntry, discogsRows) {
        if (!albumEntry || !Array.isArray(albumEntry.tracks) || !albumEntry.tracks.length || !discogsRows.length) return 0;
        let matched = 0;
        for (const row of discogsRows) {
            const best = albumEntry.tracks.reduce((value, track) => Math.max(value, lyricsDiscogsTrackMatchScore(row.title, track.title)), 0);
            if (best >= 0.72) matched += 1;
        }
        return matched / Math.max(1, Math.min(discogsRows.length, albumEntry.tracks.length));
    }

    function myAlbumsAlbumMatchCacheKey(release, collectionAlbum, discogsRows) {
        const releaseKey = Number(release && release.releaseId) || 0;
        const titles = [
            release && release.title,
            collectionAlbum && collectionAlbum.title,
            currentDisplayedTrack && currentDisplayedTrack.album,
        ].map(value => normalizeAlbumTitle(value || "")).join("::");
        const tracks = (discogsRows || []).map(row => lyricsDiscogsNormalizeTrackText(row && row.title || "")).join("|");
        return `${releaseKey}::${titles}::${tracks}`;
    }

    function findMyAlbumsScoreEntry(release, collectionAlbum, discogsRows) {
        if (!myAlbumsScoresLoaded || !myAlbumsScoreEntries.length) return null;
        const cacheKey = myAlbumsAlbumMatchCacheKey(release, collectionAlbum, discogsRows);
        if (myAlbumsAlbumMatchCache.has(cacheKey)) return myAlbumsAlbumMatchCache.get(cacheKey);

        const wantedTitles = [
            release && release.title,
            collectionAlbum && collectionAlbum.title,
            currentDisplayedTrack && currentDisplayedTrack.album,
        ].map(value => String(value || "").trim()).filter(Boolean);

        const candidateSet = new Set();
        wantedTitles.forEach(title => {
            const exact = myAlbumsAlbumTitleIndex.get(normalizeAlbumTitle(title));
            (exact || []).forEach(entry => candidateSet.add(entry));
        });
        (discogsRows || []).forEach(row => {
            lyricsDiscogsTrackTitleVariants(row && row.title || "").forEach(variant => {
                const indexed = myAlbumsTrackTitleIndex.get(lyricsDiscogsNormalizeTrackText(variant));
                (indexed || []).forEach(entry => candidateSet.add(entry));
            });
        });

        // Add a small set of high-scoring title candidates. This keeps the looser
        // title matching behavior without running track-vs-track fuzzy comparisons
        // across all ~1,000 albums on every track change.
        const titleCandidates = [];
        for (const entry of myAlbumsScoreEntries) {
            let titleScore = 0;
            for (const wanted of wantedTitles) titleScore = Math.max(titleScore, myAlbumsAlbumTitleScore(entry.title, wanted));
            if (titleScore > 0) titleCandidates.push({ entry, titleScore });
        }
        titleCandidates.sort((left, right) => right.titleScore - left.titleScore);
        titleCandidates.slice(0, 16).forEach(item => candidateSet.add(item.entry));

        const candidates = candidateSet.size ? Array.from(candidateSet) : titleCandidates.slice(0, 16).map(item => item.entry);
        let bestEntry = null;
        let bestScore = 0;
        for (const entry of candidates) {
            let titleScore = 0;
            for (const wanted of wantedTitles) titleScore = Math.max(titleScore, myAlbumsAlbumTitleScore(entry.title, wanted));
            const trackCoverage = myAlbumsTrackCoverageScore(entry, discogsRows);
            const combined = titleScore * 0.72 + trackCoverage * 0.28;
            if (combined > bestScore) { bestScore = combined; bestEntry = entry; }
        }
        if (!bestEntry) {
            myAlbumsAlbumMatchCache.set(cacheKey, null);
            return null;
        }
        const strongestTitle = Math.max(...wantedTitles.map(title => myAlbumsAlbumTitleScore(bestEntry.title, title)), 0);
        const coverage = myAlbumsTrackCoverageScore(bestEntry, discogsRows);
        const result = strongestTitle >= 0.84 || (strongestTitle >= 0.60 && coverage >= 0.45) || coverage >= 0.72
            ? bestEntry
            : null;
        myAlbumsAlbumMatchCache.set(cacheKey, result);
        return result;
    }

    function findMyAlbumsTrackScore(albumEntry, discogsTitle) {
        if (!albumEntry || !Array.isArray(albumEntry.tracks)) return null;
        let bestTrack = null;
        let bestScore = 0;
        for (const track of albumEntry.tracks) {
            const score = lyricsDiscogsTrackMatchScore(discogsTitle, track.title);
            if (score > bestScore) { bestScore = score; bestTrack = track; }
        }
        return bestScore >= 0.55 ? bestTrack : null;
    }

    function scoreDraftAlbumKey(release, collectionAlbum, albumEntry = null) {
        const title = String(
            albumEntry && albumEntry.title
            || collectionAlbum && collectionAlbum.title
            || release && release.title
            || currentDisplayedTrack && currentDisplayedTrack.album
            || ""
        ).trim();
        const releaseArtists = Array.isArray(release && release.artists) ? release.artists : [];
        const collectionArtists = Array.isArray(collectionAlbum && collectionAlbum.artists) ? collectionAlbum.artists : [];
        const artist = String(
            releaseArtists[0]
            || collectionArtists[0]
            || collectionAlbum && collectionAlbum.artist
            || currentDisplayedTrack && (currentDisplayedTrack.albumArtist || currentDisplayedTrack.artist)
            || ""
        ).trim();
        return `${normalizeAlbumIdentityKey(artist)}::${normalizeAlbumTitle(title)}`;
    }

    function scoreDraftRowKey(row, rowIndex) {
        const position = String(row && row.position || "").trim().toUpperCase();
        const title = lyricsDiscogsNormalizeTrackText(row && row.title || "");
        return `${position}::${title}::${Number(rowIndex)}`;
    }

    function scoreSavedValueForRow(albumEntry, row) {
        const matchedTrack = albumEntry ? findMyAlbumsTrackScore(albumEntry, row && row.title || "") : null;
        return matchedTrack && Number.isFinite(Number(matchedTrack.score)) ? String(Number(matchedTrack.score)) : "";
    }

    function ensureScoreDraft(context) {
        if (!context) return null;
        const draftKey = context.draftKey || scoreDraftAlbumKey(context.release, context.collectionAlbum, context.albumEntry);
        if (!draftKey || draftKey === "::") return null;
        let draft = scoreDraftsByAlbum.get(draftKey);
        if (!draft) {
            const values = new Map();
            (context.discogsRows || []).forEach((row, index) => {
                values.set(scoreDraftRowKey(row, index), scoreSavedValueForRow(context.albumEntry, row));
            });
            draft = { key: draftKey, values };
            scoreDraftsByAlbum.set(draftKey, draft);
            persistScoreDrafts();
        }
        context.draftKey = draftKey;
        return draft;
    }

    function scoreDraftForContext(context) {
        if (!context) return null;
        const draftKey = context.draftKey || scoreDraftAlbumKey(context.release, context.collectionAlbum, context.albumEntry);
        if (!draftKey) return null;
        context.draftKey = draftKey;
        return scoreDraftsByAlbum.get(draftKey) || null;
    }

    function resetLyricsScoreCard() {
        if (!scoreCard) return;
        scoreEditMode = false;
        scoreSaveInProgress = false;
        scoreDeleteInProgress = false;
        currentScoreContext = null;
        scoreSides.replaceChildren();
        scoreStatus.textContent = "Waiting for a matched Discogs tracklist.";
        scoreStatus.hidden = false;
        scoreOverall.textContent = "";
        scoreOverall.hidden = true;
        if (scoreActions) scoreActions.hidden = true;
        if (scoreEditButton) scoreEditButton.hidden = false;
        if (scoreSaveButton) scoreSaveButton.hidden = true;
        if (scoreCancelButton) scoreCancelButton.hidden = true;
        if (scoreDeleteButton) scoreDeleteButton.hidden = true;
        scoreCard.classList.add("lyrics-hidden");
    }

    function makeScoreValueElement(value, isTrackScore = false) {
        const element = document.createElement("span");
        element.className = "lyrics-score-value";
        if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value))) {
            element.textContent = "—";
            return element;
        }
        const numeric = Number(value);
        const band = isTrackScore ? scoreBandForTrackScore(numeric) : scoreBandForHundredScale(numeric);
        element.textContent = isTrackScore ? numeric.toFixed(1) : `${numeric.toFixed(2)}%`;
        if (band) {
            element.style.color = band.color;
            if (!isTrackScore) {
                element.title = band.label;
                element.dataset.ratingBand = band.label;
            }
        }
        return element;
    }

    function makeScoreInputElement(value, rowIndex, rowKey, draftKey) {
        const input = document.createElement("input");
        input.className = "lyrics-score-input";
        input.type = "number";
        input.min = "0";
        input.max = "12";
        input.step = "0.01";
        input.inputMode = "decimal";
        input.dataset.scoreRowIndex = String(rowIndex);
        input.dataset.scoreDraftRowKey = String(rowKey || "");
        input.dataset.scoreDraftAlbumKey = String(draftKey || "");
        input.setAttribute("aria-label", "Track score from 0.0 to 12.0");
        if (value !== null && value !== undefined && String(value).trim() !== "" && Number.isFinite(Number(value))) {
            input.value = String(Number(value));
        }
        input.addEventListener("input", () => {
            const albumKey = String(input.dataset.scoreDraftAlbumKey || "");
            const trackKey = String(input.dataset.scoreDraftRowKey || "");
            if (!albumKey || !trackKey) return;
            const draft = scoreDraftsByAlbum.get(albumKey);
            if (draft) {
                draft.values.set(trackKey, input.value);
                persistScoreDrafts();
            }
        });
        return input;
    }


    function updateScoreEditControls() {
        if (!scoreActions) return;
        const mutationInProgress = scoreSaveInProgress || scoreDeleteInProgress;
        scoreActions.hidden = !currentScoreContext;
        if (scoreEditButton) {
            scoreEditButton.hidden = scoreEditMode;
            scoreEditButton.disabled = mutationInProgress;
        }
        if (scoreSaveButton) {
            scoreSaveButton.hidden = !scoreEditMode;
            scoreSaveButton.disabled = mutationInProgress;
            scoreSaveButton.textContent = scoreSaveInProgress ? "Saving..." : "Save";
        }
        if (scoreCancelButton) {
            scoreCancelButton.hidden = !scoreEditMode;
            scoreCancelButton.disabled = mutationInProgress;
        }
        if (scoreDeleteButton) {
            scoreDeleteButton.hidden = !scoreEditMode || !(currentScoreContext && currentScoreContext.albumEntry);
            scoreDeleteButton.disabled = mutationInProgress;
            scoreDeleteButton.textContent = scoreDeleteInProgress ? "Deleting..." : "Delete";
        }
    }

    function renderLyricsScoreCard(release, collectionAlbum, discogsRows, currentRowIndex) {
        if (!scoreCard) return;
        scoreCard.classList.remove("lyrics-hidden");
        scoreSides.replaceChildren();
        scoreOverall.replaceChildren();
        scoreOverall.hidden = true;
        if (!myAlbumsScoresLoaded) {
            currentScoreContext = null;
            updateScoreEditControls();
            scoreStatus.textContent = "Loading scores from my_albums.txt…";
            scoreStatus.hidden = false;
            loadMyAlbumsScores();
            return;
        }
        const albumEntry = findMyAlbumsScoreEntry(release, collectionAlbum, discogsRows);
        const draftKey = scoreDraftAlbumKey(release, collectionAlbum, albumEntry);
        currentScoreContext = { release, collectionAlbum, discogsRows, albumEntry, draftKey };
        const activeDraft = scoreDraftsByAlbum.get(draftKey) || null;
        scoreEditMode = Boolean(activeDraft);
        updateScoreEditControls();
        scoreStatus.textContent = "";
        scoreStatus.hidden = true;
        const groups = new Map();
        let mostRecentSide = "";
        discogsRows.forEach((row, index) => {
            if (row.side) mostRecentSide = row.side;
            const groupKey = row.side || mostRecentSide || "Tracklist";
            if (!groups.has(groupKey)) groups.set(groupKey, []);
            groups.get(groupKey).push({ ...row, index });
        });
        const sidesFragment = document.createDocumentFragment();
        groups.forEach((groupRows, groupKey) => {
            const side = document.createElement("section");
            side.className = "lyrics-discogs-side lyrics-score-side";
            const heading = document.createElement("h4");
            heading.textContent = groupKey === "Tracklist" ? "TRACKLIST" : `SIDE ${String(groupKey).toUpperCase()}`;
            side.appendChild(heading);
            groupRows.forEach(row => {
                const trackRow = document.createElement("div");
                trackRow.className = "lyrics-discogs-track lyrics-score-track";
                const position = document.createElement("span");
                position.className = "lyrics-discogs-track-position";
                position.textContent = row.position || "—";
                const title = document.createElement("span");
                title.className = "lyrics-discogs-track-title";
                const rollingStoneArtists = Array.isArray(row.artists) && row.artists.length
                    ? row.artists
                    : (Array.isArray(release && release.artists) ? release.artists : []);
                title.dataset.rollingStoneTitle = row.title;
                title.dataset.rollingStoneArtists = JSON.stringify(rollingStoneArtists);
                title.textContent = row.title;
                applyRollingStoneStarToTrackTitleElement(title);
                const matchedTrack = albumEntry ? findMyAlbumsTrackScore(albumEntry, row.title) : null;
                const savedValue = matchedTrack && Number.isFinite(Number(matchedTrack.score)) ? matchedTrack.score : null;
                const rowKey = scoreDraftRowKey(row, row.index);
                const draftValue = activeDraft && activeDraft.values.has(rowKey) ? activeDraft.values.get(rowKey) : savedValue;
                const scoreControl = scoreEditMode
                    ? makeScoreInputElement(draftValue, row.index, rowKey, draftKey)
                    : makeScoreValueElement(savedValue, true);
                trackRow.append(position, title, scoreControl);
                side.appendChild(trackRow);
            });
            sidesFragment.appendChild(side);
        });
        scoreSides.appendChild(sidesFragment);

        // New/unscored entries intentionally have no overall rating images.
        if (albumEntry && albumEntry.hasOverallScore && Number.isFinite(Number(albumEntry.overallScore))) {
            const visual = albumScoreVisualForHundredScale(albumEntry.overallScore);
            if (visual) {
                const ratingStack = document.createElement("div");
                ratingStack.className = "lyrics-score-rating-stack";
                if (visual.topFilename) {
                    const topLabel = visual.tier === "high" ? "Strong" : (visual.tier === "mid" ? "Decent" : "Light");
                    ratingStack.appendChild(makeAlbumScoreImage(
                        visual.topFilename,
                        "lyrics-score-rating-image lyrics-score-rating-image-top",
                        topLabel
                    ));
                }
                const bottomLabel = visual.rating ? `Rating ${visual.rating}` : "Not good";
                ratingStack.appendChild(makeAlbumScoreImage(
                    visual.bottomFilename,
                    "lyrics-score-rating-image lyrics-score-rating-image-bottom",
                    bottomLabel
                ));
                scoreOverall.appendChild(ratingStack);
                scoreOverall.hidden = false;
            }
        }
    }

    function scoreFileNumberText(rawValue) {
        const raw = String(rawValue || "").trim();
        if (!raw) return "";
        const numeric = Number(raw);
        if (!Number.isFinite(numeric) || numeric < 0 || numeric > 12) {
            throw new Error("Every entered song score must be between 0.0 and 12.0.");
        }
        if (!raw.includes(".")) return numeric.toFixed(1);
        return raw.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, ".0");
    }

    function scoreContextSnapshot(context) {
        if (!context) return null;
        return {
            release: context.release || {},
            collectionAlbum: context.collectionAlbum || {},
            discogsRows: Array.isArray(context.discogsRows) ? context.discogsRows : [],
            albumEntry: context.albumEntry || null,
            draftKey: context.draftKey || scoreDraftAlbumKey(
                context.release,
                context.collectionAlbum,
                context.albumEntry
            ),
        };
    }

    function updatedMyAlbumsTextFromScoreInputs(context, options = {}) {
        const sourceLines = String(myAlbumsScoreText || "").replace(/\r\n?/g, "\n").split("\n");
        const draft = scoreDraftForContext(context);
        const captureDom = options.captureDom !== false;
        if (captureDom && draft) {
            const scoreInputs = Array.from(scoreSides.querySelectorAll(".lyrics-score-input[data-score-row-index]"));
            scoreInputs.forEach(input => {
                const inputAlbumKey = String(input.dataset.scoreDraftAlbumKey || "");
                const rowKey = String(input.dataset.scoreDraftRowKey || "");
                if (inputAlbumKey === draft.key && rowKey) draft.values.set(rowKey, input.value);
            });
            persistScoreDrafts();
        }

        const entry = context && context.albumEntry;
        const release = context && context.release || {};
        const collectionAlbum = context && context.collectionAlbum || {};
        const rows = context && Array.isArray(context.discogsRows) ? context.discogsRows : [];
        let albumTitle = String(entry && entry.title || release.title || collectionAlbum.title || currentDisplayedTrack && currentDisplayedTrack.album || "Untitled Album").trim();
        if (!entry) albumTitle = albumTitle.toUpperCase();
        const header = entry && entry.headerLine
            ? String(entry.headerLine).trimEnd()
            : `${albumTitle}:`;
        const blockLines = [header];
        rows.forEach((row, index) => {
            const rowKey = scoreDraftRowKey(row, index);
            const rawValue = draft && draft.values.has(rowKey) ? draft.values.get(rowKey) : scoreSavedValueForRow(entry, row);
            const value = scoreFileNumberText(rawValue);
            blockLines.push(`${row.title}: ${value}`.trimEnd());
        });

        if (entry && Number.isInteger(entry.startLine) && Number.isInteger(entry.endLine)) {
            sourceLines.splice(entry.startLine, entry.endLine - entry.startLine, ...blockLines);
            return sourceLines.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\s*$/, "\n");
        }

        const base = String(myAlbumsScoreText || "").replace(/\r\n?/g, "\n").replace(/\s*$/, "");
        return `${base}${base ? "\n\n" : ""}${blockLines.join("\n")}\n`;
    }

    function deletedMyAlbumsTextForScoreContext(context) {
        const entry = context && context.albumEntry;
        if (!entry || !Number.isInteger(entry.startLine) || !Number.isInteger(entry.endLine)) {
            throw new Error("This album does not have a saved my_albums.txt entry to delete.");
        }
        const sourceLines = String(myAlbumsScoreText || "").replace(/\r\n?/g, "\n").split("\n");
        sourceLines.splice(entry.startLine, entry.endLine - entry.startLine);
        return sourceLines.join("\n").replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "").replace(/\s*$/, "\n");
    }

    function rerenderCurrentScoreCard() {
        if (!currentScoreContext) return;
        const { release, collectionAlbum, discogsRows } = currentScoreContext;
        renderLyricsScoreCard(release, collectionAlbum, discogsRows, -1);
    }

    function beginScoreEdit() {
        if (!currentScoreContext || scoreSaveInProgress || scoreDeleteInProgress) return;
        ensureScoreDraft(currentScoreContext);
        scoreEditMode = true;
        if (vinylModeEnabled && currentTrackEndsAlbum && vinylSideEndPauseArm) {
            vinylSideEndPauseArm.endsAlbum = true;
            vinylSideEndPauseArm.scoreContext = scoreContextSnapshot(currentScoreContext);
        }
        rerenderCurrentScoreCard();
    }

    function cancelScoreEdits() {
        if (!currentScoreContext || scoreSaveInProgress || scoreDeleteInProgress) return;
        const draftKey = currentScoreContext.draftKey || scoreDraftAlbumKey(
            currentScoreContext.release,
            currentScoreContext.collectionAlbum,
            currentScoreContext.albumEntry
        );
        if (draftKey) {
            scoreDraftsByAlbum.delete(draftKey);
            persistScoreDrafts();
        }
        scoreEditMode = false;
        scoreStatus.textContent = "";
        scoreStatus.hidden = true;
        rerenderCurrentScoreCard();
    }

    function closeScoreDeleteConfirmation() {
        if (scoreDeleteConfirm) scoreDeleteConfirm.hidden = true;
        scoreDeletePendingContext = null;
    }

    function openScoreDeleteConfirmation() {
        if (!currentScoreContext || !currentScoreContext.albumEntry || scoreSaveInProgress || scoreDeleteInProgress) return;
        if (!scoreDeleteConfirm) return;
        scoreDeletePendingContext = scoreContextSnapshot(currentScoreContext);
        scoreDeleteConfirm.hidden = false;
        if (scoreDeleteConfirmNo) scoreDeleteConfirmNo.focus({ preventScroll: true });
    }

    async function persistScoreTextMutation(updatedText, targetContext, options = {}) {
        const isDelete = Boolean(options.isDelete);
        const targetDraftKey = targetContext && (
            targetContext.draftKey
            || scoreDraftAlbumKey(targetContext.release, targetContext.collectionAlbum, targetContext.albumEntry)
        );
        if (isDelete) {
            scoreDeleteInProgress = true;
        } else {
            scoreSaveInProgress = true;
        }
        updateScoreEditControls();

        try {
            const response = await fetch(`${API_BASE_URL}/api/lyrics/my-albums`, {
                method: "PUT",
                credentials: "include",
                cache: "no-store",
                headers: { "Content-Type": "application/json", Accept: "application/json" },
                body: JSON.stringify({ text: updatedText, baseRevision: myAlbumsScoreRevision }),
            });
            let payload = null;
            try { payload = await response.json(); } catch (error) { payload = null; }
            if (!response.ok || !payload || payload.ok !== true) {
                throw new Error(payload && payload.error ? payload.error : `Score ${isDelete ? "delete" : "save"} failed (${response.status}).`);
            }

            if (typeof payload.revision === "string") myAlbumsScoreRevision = payload.revision;
            if (targetDraftKey) {
                scoreDraftsByAlbum.delete(targetDraftKey);
                persistScoreDrafts();
            }
            setMyAlbumsScoreText(typeof payload.text === "string" ? payload.text : updatedText);

            const currentDraftKey = currentScoreContext && (
                currentScoreContext.draftKey
                || scoreDraftAlbumKey(currentScoreContext.release, currentScoreContext.collectionAlbum, currentScoreContext.albumEntry)
            );
            if (targetDraftKey && currentDraftKey === targetDraftKey) scoreEditMode = false;

            scoreSaveInProgress = false;
            scoreDeleteInProgress = false;
            if (currentScoreContext) rerenderCurrentScoreCard();
            else updateScoreEditControls();

            const warnings = Array.isArray(payload.warnings) ? payload.warnings.filter(Boolean) : [];
            const normalMessage = isDelete ? "Deleted." : "Saved.";
            scoreStatus.textContent = warnings.length
                ? `${isDelete ? "Deleted" : "Saved"} on GitHub. ${warnings.join(" ")}`
                : normalMessage;
            scoreStatus.hidden = false;
            if (!warnings.length) {
                window.setTimeout(() => {
                    if (!scoreEditMode && scoreStatus.textContent === normalMessage) {
                        scoreStatus.textContent = "";
                        scoreStatus.hidden = true;
                    }
                }, 1600);
            }
            return true;
        } catch (error) {
            scoreSaveInProgress = false;
            scoreDeleteInProgress = false;
            updateScoreEditControls();
            scoreStatus.textContent = isDelete
                ? `Could not delete score entry: ${error.message || error}`
                : `Could not save scores: ${error.message || error}`;
            scoreStatus.hidden = false;
            return false;
        }
    }

    async function saveScoreEdits(options = {}) {
        const targetContext = options.context || currentScoreContext;
        if (!targetContext || scoreSaveInProgress || scoreDeleteInProgress) return false;
        let updatedText = "";
        try {
            updatedText = updatedMyAlbumsTextFromScoreInputs(targetContext, {
                captureDom: options.captureDom !== false,
            });
        } catch (error) {
            scoreStatus.textContent = error.message || String(error);
            scoreStatus.hidden = false;
            return false;
        }
        return persistScoreTextMutation(updatedText, targetContext, { isDelete: false });
    }

    async function deleteCurrentScoreEntry() {
        if (scoreSaveInProgress || scoreDeleteInProgress) return false;
        const targetContext = scoreDeletePendingContext
            ? scoreContextSnapshot(scoreDeletePendingContext)
            : scoreContextSnapshot(currentScoreContext);
        if (!targetContext || !targetContext.albumEntry) return false;
        let updatedText = "";
        try {
            updatedText = deletedMyAlbumsTextForScoreContext(targetContext);
        } catch (error) {
            scoreStatus.textContent = error.message || String(error);
            scoreStatus.hidden = false;
            return false;
        }
        closeScoreDeleteConfirmation();
        return persistScoreTextMutation(updatedText, targetContext, { isDelete: true });
    }

    function scoreContextForVinylAutoSave(arm) {
        if (!arm || !arm.endsAlbum) return null;
        let context = arm.scoreContext ? scoreContextSnapshot(arm.scoreContext) : null;

        if (!context && currentTrackEndsAlbum && currentScoreContext) {
            context = scoreContextSnapshot(currentScoreContext);
        }
        if (!context) return null;

        if (myAlbumsScoresLoaded) {
            const latestEntry = findMyAlbumsScoreEntry(
                context.release,
                context.collectionAlbum,
                context.discogsRows
            );
            const originalDraftKey = context.draftKey || "";
            const latestDraftKey = scoreDraftAlbumKey(context.release, context.collectionAlbum, latestEntry);
            context.albumEntry = latestEntry;
            context.draftKey = scoreDraftsByAlbum.has(originalDraftKey) ? originalDraftKey : latestDraftKey;
        }
        return context;
    }

    async function autoSaveScoreAtVinylAlbumEnd(arm) {
        if (!vinylModeEnabled || !arm || !arm.endsAlbum || scoreSaveInProgress || scoreDeleteInProgress) return false;
        const context = scoreContextForVinylAutoSave(arm);
        if (!context) return false;
        const draft = scoreDraftForContext(context);
        if (!draft) return false;

        const currentDraftKey = currentScoreContext && (
            currentScoreContext.draftKey
            || scoreDraftAlbumKey(currentScoreContext.release, currentScoreContext.collectionAlbum, currentScoreContext.albumEntry)
        );
        return saveScoreEdits({
            context,
            automatic: true,
            captureDom: Boolean(currentDraftKey && currentDraftKey === context.draftKey),
        });
    }

    if (scoreEditButton) scoreEditButton.addEventListener("click", beginScoreEdit);
    if (scoreSaveButton) scoreSaveButton.addEventListener("click", () => saveScoreEdits());
    if (scoreCancelButton) scoreCancelButton.addEventListener("click", cancelScoreEdits);
    if (scoreDeleteButton) scoreDeleteButton.addEventListener("click", openScoreDeleteConfirmation);
    if (scoreDeleteConfirmNo) scoreDeleteConfirmNo.addEventListener("click", closeScoreDeleteConfirmation);
    if (scoreDeleteConfirmYes) scoreDeleteConfirmYes.addEventListener("click", deleteCurrentScoreEntry);
    if (scoreDeleteConfirm) {
        scoreDeleteConfirm.addEventListener("click", event => {
            if (event.target === scoreDeleteConfirm) closeScoreDeleteConfirmation();
        });
    }
    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && scoreDeleteConfirm && !scoreDeleteConfirm.hidden) {
            event.preventDefault();
            closeScoreDeleteConfirmation();
        }
    });


    async function fetchRollingStoneSongListText(config) {
        for (const filename of config.files || []) {
            try {
                const url = new URL(filename, window.location.href);
                const response = await fetch(url.href, { cache: "force-cache" });
                if (!response.ok) continue;
                const text = await response.text();
                if (text && text.trim()) return text;
            } catch (error) {
                // Try the alternate filename below.
            }
        }
        return "";
    }

    function parseRollingStoneSongList(text, config) {
        const entries = [];
        for (const rawLine of String(text || "").split(/\r?\n/)) {
            let body = rawLine.replace(/^\s*\d+\.\s*/, "").trim();
            if (!body) continue;

            let title = "";
            let artist = "";
            if (config.format === "title-artist-year") {
                body = body.replace(/\s+\((?:18|19|20)\d{2}\)\s*$/, "").trim();
                // One 2021 entry is "River Deep - Mountain High - Ike & Tina Turner";
                // the final delimiter is therefore the artist separator.
                const separator = body.lastIndexOf(" - ");
                if (separator > 0) {
                    title = body.slice(0, separator).trim();
                    artist = body.slice(separator + 3).trim();
                }
            } else {
                // 2004/2010 are Artist - Song. Each supplied file also contains one
                // comma-formatted outlier, so accept "Artist, Song" as a fallback.
                let separator = body.indexOf(" - ");
                let separatorLength = 3;
                if (separator < 0) {
                    separator = body.indexOf(", ");
                    separatorLength = 2;
                }
                if (separator > 0) {
                    artist = body.slice(0, separator).trim();
                    title = body.slice(separator + separatorLength).trim();
                }
            }

            if (title) entries.push({ title, artist, listYear: config.year });
        }
        return entries;
    }

    function rollingStoneSongTitleVariants(value) {
        const raw = String(value || "").trim();
        const variants = [];
        const seen = new Set();
        const add = candidate => {
            const clean = String(candidate || "").replace(/\s+/g, " ").trim();
            const key = lyricsDiscogsNormalizeTrackText(clean);
            if (!clean || !key || seen.has(key)) return;
            seen.add(key);
            variants.push(clean);
        };

        lyricsDiscogsTrackTitleVariants(raw).forEach(add);
        // Rolling Stone occasionally includes a parenthetical prefix that Discogs
        // omits, e.g. "(I Can't Get No) Satisfaction" vs "Satisfaction".
        add(raw.replace(/^\s*\([^)]{1,120}\)\s*/, ""));
        add(raw.replace(/\([^)]*\)/g, " "));
        return variants;
    }

    function rollingStoneSongTitleMatchScore(leftTitle, rightTitle) {
        let best = 0;
        for (const left of rollingStoneSongTitleVariants(leftTitle)) {
            for (const right of rollingStoneSongTitleVariants(rightTitle)) {
                best = Math.max(best, lyricsDiscogsTrackMatchScore(left, right));
                if (best >= 1) return 1;
            }
        }
        return best;
    }

    function rollingStoneSongArtistsMatch(listArtist, candidateArtists) {
        const artist = String(listArtist || "").trim();
        if (!artist) return true;
        const candidates = (Array.isArray(candidateArtists) ? candidateArtists : [candidateArtists])
            .map(value => String(value || "").trim())
            .filter(value => value && !/^(?:various|various artists)$/i.test(value));
        if (!candidates.length) return false;
        return discogsOwnedArtistsMatch(artist, candidates)
            || candidates.some(candidate => discogsOwnedArtistsMatch(candidate, [artist]));
    }

    function rollingStoneIndexKey(value) {
        return lyricsDiscogsNormalizeTrackText(value || "");
    }

    function rollingStoneBucketKey(value) {
        const normalized = rollingStoneIndexKey(value);
        return normalized ? normalized.slice(0, 4) : "";
    }

    function rebuildRollingStoneSongIndexes() {
        rollingStone500SongIndex = new Map();
        rollingStone500SongBuckets = new Map();
        const add = (map, key, entry) => {
            if (!key) return;
            if (!map.has(key)) map.set(key, []);
            map.get(key).push(entry);
        };
        rollingStone500SongEntries.forEach(entry => {
            rollingStoneSongTitleVariants(entry.title).forEach(variant => {
                const key = rollingStoneIndexKey(variant);
                add(rollingStone500SongIndex, key, entry);
                add(rollingStone500SongBuckets, rollingStoneBucketKey(variant), entry);
            });
        });
    }

    function isRollingStone500Song(trackTitle, candidateArtists) {
        if (!rollingStone500SongListsLoaded || !trackTitle) return false;
        const artists = (Array.isArray(candidateArtists) ? candidateArtists : [candidateArtists])
            .map(value => String(value || "").trim())
            .filter(Boolean);
        const candidates = new Set();
        const variants = rollingStoneSongTitleVariants(trackTitle);
        variants.forEach(variant => {
            const direct = rollingStone500SongIndex.get(rollingStoneIndexKey(variant));
            (direct || []).forEach(entry => candidates.add(entry));
        });

        // Only use fuzzy matching when normalization did not produce an exact
        // candidate, and then limit it to a tiny title-prefix bucket.
        if (!candidates.size) {
            variants.forEach(variant => {
                const bucket = rollingStone500SongBuckets.get(rollingStoneBucketKey(variant));
                (bucket || []).forEach(entry => candidates.add(entry));
            });
        }

        for (const entry of candidates) {
            const score = rollingStoneSongTitleMatchScore(trackTitle, entry.title);
            if (score < 0.90) continue;
            if (entry.artist && artists.length) {
                if (rollingStoneSongArtistsMatch(entry.artist, artists)) return true;
                continue;
            }
            if (score >= 0.99) return true;
        }
        return false;
    }

    function applyRollingStoneStarToTrackTitleElement(element) {
        if (!element) return;
        const rawTitle = String(element.dataset.rollingStoneTitle || "").trim();
        if (!rawTitle) return;
        let artists = [];
        try {
            const parsed = JSON.parse(element.dataset.rollingStoneArtists || "[]");
            if (Array.isArray(parsed)) artists = parsed;
        } catch (error) {
            artists = [];
        }
        element.textContent = isRollingStone500Song(rawTitle, artists) ? `${rawTitle} ★` : rawTitle;
    }

    function refreshRollingStoneStarsInRenderedTracklist() {
        [discogsSides, scoreSides].forEach(container => {
            if (!container) return;
            container.querySelectorAll(".lyrics-discogs-track-title[data-rolling-stone-title]")
                .forEach(applyRollingStoneStarToTrackTitleElement);
        });
    }

    function loadRollingStone500SongLists() {
        if (rollingStone500SongListsPromise) return rollingStone500SongListsPromise;
        rollingStone500SongListsPromise = Promise.all(
            ROLLING_STONE_SONG_LISTS.map(async config => ({
                config,
                text: await fetchRollingStoneSongListText(config),
            }))
        ).then(results => {
            rollingStone500SongEntries = results.flatMap(result => parseRollingStoneSongList(result.text, result.config));
            rebuildRollingStoneSongIndexes();
            rollingStone500SongListsLoaded = true;
            refreshRollingStoneStarsInRenderedTracklist();
            return rollingStone500SongEntries;
        }).catch(() => {
            rollingStone500SongEntries = [];
            rollingStone500SongIndex = new Map();
            rollingStone500SongBuckets = new Map();
            rollingStone500SongListsLoaded = true;
            return [];
        });
        return rollingStone500SongListsPromise;
    }

    function renderLyricsDiscogsTracklist(payload, currentTrackTitle = "") {
        discogsCard.classList.remove("lyrics-hidden");
        discogsSides.replaceChildren();
        discogsReleaseMeta.replaceChildren();
        discogsReleaseMeta.hidden = true;
        discogsConditionMeta.replaceChildren();
        discogsConditionMeta.hidden = true;
        clearVinylSideEndPause();
        clearScrobbleAlbumEndPause();
        currentTrackEndsAlbum = false;
        resetLyricsScoreCard();
        discogsTotalLength.textContent = "";
        discogsTotalLength.hidden = true;
        setCoverPickerAvailability(null);

        if (!payload || payload.noCollectionMatch) {
            setDiscogsStatus("Album not owned.");
            return;
        }
        if (payload.error) {
            setDiscogsStatus(payload.message || "Discogs vinyl tracklist lookup failed.", "error");
            return;
        }
        if (!payload.ok) {
            setDiscogsStatus(payload.error || "Discogs vinyl tracklist lookup failed.", "error");
            return;
        }
        if (!payload.matched) {
            setDiscogsStatus("Album not owned.");
            return;
        }
        if (!payload.vinylFound || !payload.release) {
            setDiscogsStatus(payload.message || "This album is in the Discogs collection, but no owned vinyl release tracklist was found.");
            return;
        }

        const release = payload.release;
        setCoverPickerAvailability(release);
        const overrideUrl = payload.coverOverride && payload.coverOverride.imageUrl ? String(payload.coverOverride.imageUrl) : "";
        if (overrideUrl) setArtwork(overrideUrl, lastDefaultArtworkTitle || release.title);
        const rows = flattenLyricsDiscogsTracklist(release.tracklist || []);
        if (!rollingStone500SongListsLoaded && !rollingStone500SongListsPromise) {
            window.setTimeout(() => loadRollingStone500SongLists(), 0);
        }
        if (!rows.length) {
            setDiscogsStatus("The owned Discogs vinyl release does not have a tracklist in the Discogs response.");
            return;
        }

        let currentRowIndex = -1;
        let currentRowScore = 0;
        rows.forEach((row, index) => {
            const score = lyricsDiscogsTrackMatchScore(currentTrackTitle, row.title);
            if (score > currentRowScore) {
                currentRowScore = score;
                currentRowIndex = index;
            }
        });
        if (currentRowScore < 0.55) currentRowIndex = -1;

        const collectionAlbum = payload.collectionAlbum || {};
        const releaseArtists = Array.isArray(release.artists) && release.artists.length
            ? release.artists.join(", ")
            : (Array.isArray(collectionAlbum.artists) ? collectionAlbum.artists.join(", ") : "");
        const releaseDisplayTitle = release.title || collectionAlbum.title || "Discogs release";
        discogsStatus.replaceChildren();
        if (release.discogsUrl) {
            const releaseLink = document.createElement("a");
            releaseLink.href = release.discogsUrl;
            releaseLink.target = "_blank";
            releaseLink.rel = "noopener noreferrer";
            releaseLink.textContent = `${releaseArtists ? `${releaseArtists} - ` : ""}${releaseDisplayTitle}`;
            discogsStatus.appendChild(releaseLink);
        } else {
            discogsStatus.textContent = `${releaseArtists ? `${releaseArtists} - ` : ""}${releaseDisplayTitle}`;
        }
        discogsStatus.classList.remove("error");

        const metaParts = [];
        if (release.year) metaParts.push(String(release.year));
        const formatSummary = lyricsDiscogsFormatSummary(release);
        if (formatSummary) metaParts.push(formatSummary);
        if (release.releaseId) metaParts.push(`Release #${release.releaseId}`);
        if (metaParts.length) {
            discogsReleaseMeta.textContent = metaParts.join(" · ");
            discogsReleaseMeta.hidden = false;
        }

        const mediaCondition = String(release.mediaCondition || "").trim();
        const sleeveCondition = String(release.sleeveCondition || "").trim();
        if (mediaCondition || sleeveCondition) {
            discogsConditionMeta.replaceChildren();
            if (mediaCondition) {
                discogsConditionMeta.appendChild(document.createTextNode("Media Quality: "));
                const mediaValue = document.createElement("span");
                mediaValue.textContent = mediaCondition;
                const mediaColor = lyricsDiscogsConditionColor(mediaCondition);
                if (mediaColor) mediaValue.style.color = mediaColor;
                discogsConditionMeta.appendChild(mediaValue);
            }
            if (mediaCondition && sleeveCondition) {
                discogsConditionMeta.appendChild(document.createTextNode(" · "));
            }
            if (sleeveCondition) {
                discogsConditionMeta.appendChild(document.createTextNode("Sleeve Quality: "));
                const sleeveValue = document.createElement("span");
                sleeveValue.textContent = sleeveCondition;
                const sleeveColor = lyricsDiscogsConditionColor(sleeveCondition);
                if (sleeveColor) sleeveValue.style.color = sleeveColor;
                discogsConditionMeta.appendChild(sleeveValue);
            }
            discogsConditionMeta.hidden = false;
        } else {
            const auth = payload && payload.discogsAuth && typeof payload.discogsAuth === "object" ? payload.discogsAuth : {};
            const collectionUsername = String(auth.collectionUsername || "NNavincitron").trim();
            const authenticatedUsername = String(auth.authenticatedUsername || "").trim();
            const conditionFields = auth.conditionFields && typeof auth.conditionFields === "object" ? auth.conditionFields : {};
            if (!auth.tokenConfigured) {
                discogsConditionMeta.textContent = `Media/Sleeve Quality unavailable: Discogs owner authentication is required for ${collectionUsername}'s private collection fields.`;
                discogsConditionMeta.hidden = false;
            } else if (!auth.ownerAuthenticated) {
                discogsConditionMeta.textContent = authenticatedUsername
                    ? `Media/Sleeve Quality unavailable: the configured Discogs token is authenticated as ${authenticatedUsername}, not ${collectionUsername}.`
                    : `Media/Sleeve Quality unavailable: the configured Discogs token could not be authenticated as ${collectionUsername}.`;
                discogsConditionMeta.hidden = false;
            } else if (!Object.keys(conditionFields).length) {
                discogsConditionMeta.textContent = "Media/Sleeve Quality unavailable: Discogs did not return the collection field definitions.";
                discogsConditionMeta.hidden = false;
            } else {
                discogsConditionMeta.textContent = "Media/Sleeve Quality not returned for this collection instance.";
                discogsConditionMeta.hidden = false;
            }
        }

        renderLyricsScoreCard(release, collectionAlbum, rows, currentRowIndex);

        const groups = new Map();
        let mostRecentSide = "";
        rows.forEach((row, index) => {
            if (row.side) mostRecentSide = row.side;
            const groupKey = row.side || mostRecentSide || "Tracklist";
            if (!groups.has(groupKey)) groups.set(groupKey, []);
            groups.get(groupKey).push({ ...row, index });
        });

        let currentTrackEndsSide = false;
        let currentTrackSide = "";

        groups.forEach((groupRows, groupKey) => {
            const isVinylSide = groupKey !== "Tracklist" && /^[A-Z]{1,3}$/i.test(String(groupKey));
            const finalRow = groupRows.length ? groupRows[groupRows.length - 1] : null;
            if (isVinylSide && finalRow && finalRow.index === currentRowIndex) {
                currentTrackEndsSide = true;
                currentTrackSide = String(groupKey).toUpperCase();
            }

            const side = document.createElement("section");
            side.className = "lyrics-discogs-side";
            const heading = document.createElement("h4");
            heading.textContent = groupKey === "Tracklist" ? "TRACKLIST" : `SIDE ${String(groupKey).toUpperCase()}`;
            side.appendChild(heading);

            groupRows.forEach(row => {
                const trackRow = document.createElement("div");
                trackRow.className = "lyrics-discogs-track";
                if (row.index === currentRowIndex) {
                    trackRow.classList.add("current");
                    trackRow.setAttribute("aria-current", "true");
                }

                const position = document.createElement("span");
                position.className = "lyrics-discogs-track-position";
                position.textContent = row.position || "—";
                const title = document.createElement("span");
                title.className = "lyrics-discogs-track-title";
                const rollingStoneArtists = Array.isArray(row.artists) && row.artists.length
                    ? row.artists
                    : (Array.isArray(release.artists) ? release.artists : []);
                title.dataset.rollingStoneTitle = row.title;
                title.dataset.rollingStoneArtists = JSON.stringify(rollingStoneArtists);
                title.textContent = row.title;
                applyRollingStoneStarToTrackTitleElement(title);
                const duration = document.createElement("span");
                duration.className = "lyrics-discogs-track-duration";
                duration.textContent = row.duration || "";

                trackRow.append(position, title, duration);
                side.appendChild(trackRow);
            });

            const sideDurations = groupRows.map(row => lyricsDiscogsDurationSeconds(row.duration));
            if (sideDurations.length && sideDurations.every(value => value !== null)) {
                const sideLength = document.createElement("div");
                sideLength.className = "lyrics-discogs-side-length";
                sideLength.textContent = `Length: ${lyricsDiscogsFormatDurationSeconds(sideDurations.reduce((sum, value) => sum + value, 0))}`;
                side.appendChild(sideLength);
            }
            discogsSides.appendChild(side);
        });

        currentTrackEndsAlbum = currentRowIndex >= 0 && currentRowIndex === rows.length - 1;
        if (scrobbleModeEnabled && currentTrackEndsAlbum && currentDisplayedTrack) {
            armScrobbleAlbumEndPause(currentDisplayedTrack);
        } else {
            clearScrobbleAlbumEndPause();
        }

        currentTrackEndsVinylSide = currentTrackEndsSide;
        currentTrackVinylSide = currentTrackSide;
        if (vinylModeEnabled && currentTrackEndsSide && currentDisplayedTrack) {
            armVinylSideEndPause(currentDisplayedTrack, currentTrackSide);
        } else {
            clearVinylSideEndPause();
        }

        const allDurations = rows.map(row => lyricsDiscogsDurationSeconds(row.duration));
        if (allDurations.length && allDurations.every(value => value !== null)) {
            discogsTotalLength.textContent = `Total Length: ${lyricsDiscogsFormatDurationSeconds(allDurations.reduce((sum, value) => sum + value, 0))}`;
            discogsTotalLength.hidden = false;
        }
    }

    async function updateLyricsDiscogsTracklist(track, options = {}) {
        if (!track) return;
        const albumTitle = String(track.album || "").trim();
        const albumArtist = lyricsDiscogsAlbumArtist(track);
        if (!albumTitle || /^unknown album$/i.test(albumTitle)) {
            discogsCard.classList.remove("lyrics-hidden");
            setDiscogsStatus("The current track does not provide an album name for Discogs matching.");
            discogsSides.replaceChildren();
            discogsReleaseMeta.hidden = true;
            discogsConditionMeta.hidden = true;
            clearVinylSideEndPause();
            clearScrobbleAlbumEndPause();
            currentTrackEndsAlbum = false;
            resetLyricsScoreCard();
            return;
        }

        const lookupKey = `${normalizeAlbumIdentityKey(albumArtist)}::${normalizeAlbumIdentityKey(albumTitle)}::${normalizeAlbumIdentityKey(track.title || "")}`;
        if (!options.force && lookupKey === discogsLookupInFlightKey) return;
        if (!options.force && lookupKey === lastDiscogsAlbumLookupKey && lastDiscogsTracklistPayload) {
            if (lastDiscogsRenderedLookupKey === lookupKey) return;
            renderLyricsDiscogsTracklist(lastDiscogsTracklistPayload, track.title || "");
            lastDiscogsRenderedLookupKey = lookupKey;
            return;
        }

        lastDiscogsAlbumLookupKey = lookupKey;
        lastDiscogsRenderedLookupKey = "";
        discogsLookupInFlightKey = lookupKey;
        lastDiscogsTracklistPayload = null;
        const requestId = ++discogsLookupRequestId;
        discogsCard.classList.remove("lyrics-hidden");
        discogsSides.replaceChildren();
        discogsReleaseMeta.replaceChildren();
        discogsReleaseMeta.hidden = true;
        discogsConditionMeta.replaceChildren();
        discogsConditionMeta.hidden = true;
        clearVinylSideEndPause();
        clearScrobbleAlbumEndPause();
        currentTrackEndsAlbum = false;
        resetLyricsScoreCard();
        discogsTotalLength.textContent = "";
        discogsTotalLength.hidden = true;
        setCoverPickerAvailability(null);
        setDiscogsStatus("Searching for release...");

        const collectionLoaded = await ensureTopsterDiscogsCollectionLoaded();
        if (requestId !== discogsLookupRequestId) return;
        if (!collectionLoaded) {
            discogsLookupInFlightKey = "";
            lastDiscogsTracklistPayload = { error: true, message: "The Discogs collection could not be loaded." };
            renderLyricsDiscogsTracklist(lastDiscogsTracklistPayload, track.title || "");
            lastDiscogsRenderedLookupKey = lookupKey;
            return;
        }

        const matchedAlbums = findLyricsDiscogsCollectionAlbums({ artist: albumArtist, title: albumTitle });
        if (!matchedAlbums.length) {
            discogsLookupInFlightKey = "";
            lastDiscogsTracklistPayload = { noCollectionMatch: true };
            renderLyricsDiscogsTracklist(lastDiscogsTracklistPayload, track.title || "");
            lastDiscogsRenderedLookupKey = lookupKey;
            return;
        }

        const collectionMatches = matchedAlbums.map(album => {
            const artists = Array.isArray(album.artists) ? album.artists : [];
            return {
                title: String(album.title || ""),
                artist: String(artists[0] || album.artist || ""),
            };
        }).filter(item => item.title);
        const firstMatch = collectionMatches[0] || { title: "", artist: "" };
        const params = new URLSearchParams({
            collection_title: firstMatch.title,
            collection_artist: firstMatch.artist,
            collection_matches: JSON.stringify(collectionMatches),
            artist: albumArtist,
            track_artist: String(track.artist || ""),
            album: albumTitle,
            track: String(track.title || ""),
        });

        try {
            const response = await fetch(`${API_BASE_URL}/api/lyrics/discogs-vinyl-tracklist?${params.toString()}`, {
                method: "GET",
                credentials: "include",
                cache: "no-store",
                headers: { Accept: "application/json" },
            });
            let payload;
            try {
                payload = await response.json();
            } catch (error) {
                throw new Error(`Discogs tracklist service returned an unreadable response (${response.status}).`);
            }
            if (!response.ok || !payload || payload.ok !== true) {
                throw new Error(payload && payload.error ? payload.error : `Discogs tracklist request failed (${response.status}).`);
            }
            if (requestId !== discogsLookupRequestId) return;
            discogsLookupInFlightKey = "";
            lastDiscogsTracklistPayload = payload;
            renderLyricsDiscogsTracklist(payload, track.title || "");
            lastDiscogsRenderedLookupKey = lookupKey;
        } catch (error) {
            if (requestId !== discogsLookupRequestId) return;
            discogsLookupInFlightKey = "";
            lastDiscogsTracklistPayload = { error: true, message: `Discogs vinyl tracklist unavailable: ${error.message || error}` };
            renderLyricsDiscogsTracklist(lastDiscogsTracklistPayload, track.title || "");
            lastDiscogsRenderedLookupKey = lookupKey;
        }
    }

    function formatPlaybackTime(milliseconds) {
        const safeMilliseconds = Math.max(0, Number(milliseconds) || 0);
        const totalSeconds = Math.floor(safeMilliseconds / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes}:${String(seconds).padStart(2, "0")}`;
    }

    function estimatedPlaybackProgress() {
        let progressMs = playbackClock.progressMs;
        if (playbackClock.isPlaying) {
            progressMs += Math.max(0, Date.now() - playbackClock.sampledAt);
        }
        return Math.min(Math.max(0, progressMs), Math.max(0, playbackClock.durationMs));
    }

    function renderPlaybackProgress() {
        const durationMs = Math.max(0, Number(playbackClock.durationMs) || 0);
        const progressMs = durationMs > 0 ? estimatedPlaybackProgress() : 0;
        const percentage = durationMs > 0 ? Math.min(100, Math.max(0, (progressMs / durationMs) * 100)) : 0;

        progressFill.style.width = `${percentage}%`;
        progressCurrent.textContent = formatPlaybackTime(progressMs);
        progressDuration.textContent = formatPlaybackTime(durationMs);
        progressTrack.setAttribute("aria-valuenow", String(Math.round(percentage)));
        progressTrack.setAttribute("aria-valuetext", `${formatPlaybackTime(progressMs)} of ${formatPlaybackTime(durationMs)}`);
    }

    function updatePlaybackControls() {
        // Keep transport controls usable whenever the browser is authenticated.
        // Spotify can often resume the last playback context even when
        // current_playback() temporarily reports no active item/device.
        const controlsUnavailable = !spotifyAuthenticated || playbackControlInProgress;
        previousTrackButton.disabled = controlsUnavailable;
        nextTrackButton.disabled = controlsUnavailable;
        pauseButton.disabled = controlsUnavailable || !playbackClock.isPlaying;
        playButton.disabled = controlsUnavailable || playbackClock.isPlaying;
    }

    function setPlaybackSnapshot(track) {
        if (!track) {
            hasCurrentTrack = false;
            playbackClock = {
                progressMs: 0,
                durationMs: 0,
                isPlaying: false,
                sampledAt: Date.now(),
            };
        } else {
            hasCurrentTrack = true;
            playbackClock = {
                progressMs: Math.max(0, Number(track.progressMs) || 0),
                durationMs: Math.max(0, Number(track.durationMs) || 0),
                isPlaying: Boolean(track.isPlaying),
                sampledAt: Date.now(),
            };
        }
        renderPlaybackProgress();
        updatePlaybackControls();
        if (vinylSideEndPauseArm) scheduleVinylSideEndPause();
    }

    function setPlaybackIdleSnapshot(preserveLastTrack = false) {
        const preservedProgressMs = preserveLastTrack ? estimatedPlaybackProgress() : 0;
        const preservedDurationMs = preserveLastTrack
            ? Math.max(0, Number(playbackClock.durationMs) || 0)
            : 0;

        hasCurrentTrack = false;
        playbackClock = {
            progressMs: Math.min(preservedProgressMs, preservedDurationMs || preservedProgressMs),
            durationMs: preservedDurationMs,
            isPlaying: false,
            sampledAt: Date.now(),
        };
        renderPlaybackProgress();
        updatePlaybackControls();
    }

    function renderEmptyPlaybackHud(authenticated) {
        songCard.classList.remove("lyrics-hidden");
        embedCard.classList.add("lyrics-hidden");
        clearArtwork();
        currentDisplayedTrack = null;
        lastDefaultArtworkUrl = "";
        lastDefaultArtworkTitle = "";
        clearEmbed();
        resetDiscogsTracklist({ hide: true });
        songTitle.textContent = "No song currently playing";
        songArtist.textContent = authenticated
            ? "Spotify is connected"
            : "Spotify is not connected";
        songAlbum.textContent = "";
        sourceBadge.textContent = authenticated ? "Spotify Connected" : "Spotify Not Connected";
        annotationBadge.classList.add("lyrics-hidden");
        descriptionElement.textContent = authenticated
            ? "Press Play to resume Spotify playback. The playback controls remain available while no song is active."
            : "Log in with Spotify to identify the current song and use the playback controls.";
        descriptionElement.classList.add("empty");
        setPlaybackIdleSnapshot(false);
    }

    function mobileAnnotationAutoScrollEnabled() {
        return window.matchMedia("(max-width: 700px), (orientation: portrait) and (pointer: coarse)").matches;
    }

    function resetGeniusAnnotationScrollState() {
        annotationReturnScrollY = null;
        annotationScrollActive = false;
        annotationAutoScrollAt = 0;
        annotationRestoreInProgress = false;
    }

    function restoreGeniusAnnotationScroll() {
        if (!annotationScrollActive || annotationReturnScrollY === null || annotationRestoreInProgress) return;

        const returnScrollY = Math.max(0, Number(annotationReturnScrollY) || 0);
        annotationRestoreInProgress = true;
        annotationScrollActive = false;
        annotationReturnScrollY = null;
        annotationAutoScrollAt = 0;

        window.setTimeout(() => {
            window.scrollTo({ top: returnScrollY, behavior: "smooth" });
            window.setTimeout(() => {
                annotationRestoreInProgress = false;
            }, 550);
        }, 80);
    }

    function revealGeniusAnnotationAtTop() {
        if (!mobileAnnotationAutoScrollEnabled() || !activeEmbedFrame || !activeEmbedFrame.isConnected) return;

        const now = Date.now();
        if (now - lastEmbedInteractionAt < 450) return;
        lastEmbedInteractionAt = now;

        // After the first lyric tap, focus is deliberately returned to the host
        // page. A later tap on Genius's close control therefore enters the child
        // iframe again. Genius does not expose a cross-origin close event, so a
        // later, stationary iframe interaction is the best available close
        // signal. Swipes are filtered in queueGeniusAnnotationReveal().
        if (annotationScrollActive) {
            if (now - annotationAutoScrollAt < 850) return;
            restoreGeniusAnnotationScroll();
            return;
        }

        annotationReturnScrollY = window.scrollY;
        annotationScrollActive = true;
        annotationAutoScrollAt = now;

        window.setTimeout(() => {
            if (!activeEmbedFrame || !activeEmbedFrame.isConnected || !annotationScrollActive) return;
            const top = embedContainer.getBoundingClientRect().top + window.scrollY - 12;
            window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });

            // Return focus to the host page after Genius processes the click.
            // This makes a later close-button tap detectable as a new iframe
            // focus transition.
            window.setTimeout(() => {
                try {
                    focusSink.focus({ preventScroll: true });
                } catch (error) {
                    focusSink.focus();
                }
            }, 500);
        }, 140);
    }

    function queueGeniusAnnotationReveal() {
        if (!mobileAnnotationAutoScrollEnabled()) return;

        const startingScrollY = window.scrollY;
        window.setTimeout(() => {
            // A swipe that began over the iframe can also move focus into it.
            // Do not open or close the auto-scroll state while the user is
            // vertically scrolling.
            if (Math.abs(window.scrollY - startingScrollY) > 18) return;
            revealGeniusAnnotationAtTop();
        }, 220);
    }

    function stopEmbedResizePolling() {
        if (embedResizeTimer) {
            window.clearInterval(embedResizeTimer);
            embedResizeTimer = null;
        }
    }

    function clearEmbed(message = "Waiting for a currently playing song.") {
        resetGeniusAnnotationScrollState();
        lastGeniusSongId = null;
        activeEmbedFrame = null;
        stopEmbedResizePolling();
        embedContainer.replaceChildren();
        const placeholder = document.createElement("div");
        placeholder.className = "lyrics-embed-placeholder";
        placeholder.textContent = message;
        embedContainer.appendChild(placeholder);
    }

    function escapeEmbedHtml(value) {
        return String(value || "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#39;");
    }

    function resizeGeniusEmbedFrame(frame) {
        if (!frame || frame !== activeEmbedFrame || !frame.isConnected) return;

        try {
            const documentElement = frame.contentDocument && frame.contentDocument.documentElement;
            const body = frame.contentDocument && frame.contentDocument.body;
            if (!documentElement || !body) return;

            const measuredHeight = Math.max(
                220,
                body.scrollHeight || 0,
                body.offsetHeight || 0,
                documentElement.scrollHeight || 0,
                documentElement.offsetHeight || 0
            );
            frame.style.height = `${Math.min(measuredHeight + 8, 6000)}px`;
        } catch (error) {
            // The outer srcdoc frame normally remains same-origin. If Genius
            // changes its embed to navigate the outer frame, retain the default
            // height rather than interrupting the rest of lyrics.html.
        }
    }

    function buildGeniusEmbedDocument(geniusSong, songId) {
        const songUrl = geniusSong.url || `https://genius.com/songs/${songId}`;
        const scriptUrl = geniusSong.embedScriptUrl || `https://genius.com/songs/${songId}/embed.js`;
        const title = geniusSong.title || "this song";
        const artist = geniusSong.artist ? ` by ${geniusSong.artist}` : "";
        const linkText = `Read “${title}”${artist} on Genius`;

        // Genius's embed script uses document.write(). It therefore has to run
        // while this iframe document is being parsed; appending the script to
        // the already-loaded parent document can result in a blank embed.
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <base target="_blank">
    <style>
        :root { color-scheme: light; }
        html, body { margin: 0; padding: 0; background: #ffffff; color: #111111; font-size: 16px; }
        body { isolation: isolate; overflow: hidden; position: relative; }

        /* Genius renders the lyrics inside a cross-origin child frame. Keep
           every surface below the tint white, then multiply one solid #969693
           layer across the complete embed. White Genius content and exposed
           outer-frame space therefore resolve to the same final shade instead
           of the outer space being tinted twice and appearing darker. */
        body::after {
            background: #969693;
            content: "";
            inset: 0;
            mix-blend-mode: multiply;
            pointer-events: none;
            position: fixed;
            z-index: 2147483647;
        }

        iframe {
            background: #ffffff;
            border: 0;
            display: block;
            max-width: none !important;
            width: 93.75% !important;
            zoom: 1.0666667 !important;
        }
        .rg_embed_link { background: #ffffff; box-sizing: border-box; font-family: Arial, sans-serif; font-size: 16px; padding: 18px; }
    </style>
</head>
<body>
    <div id="rg_embed_link_${songId}" class="rg_embed_link" data-song-id="${songId}">
        <a href="${escapeEmbedHtml(songUrl)}" rel="noopener noreferrer">${escapeEmbedHtml(linkText)}</a>
    </div>
    <script
        crossorigin="anonymous"
        src="${escapeEmbedHtml(scriptUrl)}"
        onerror="parent.postMessage({type: '${GENIUS_EMBED_ERROR_MESSAGE}', songId: ${songId}}, '*')"
    ><\/script>
    <script>
        (() => {
            const reportHeight = () => {
                const root = document.documentElement;
                const body = document.body;
                const height = Math.max(
                    220,
                    body ? body.scrollHeight : 0,
                    body ? body.offsetHeight : 0,
                    root ? root.scrollHeight : 0,
                    root ? root.offsetHeight : 0
                );
                parent.postMessage({
                    type: '${GENIUS_EMBED_HEIGHT_MESSAGE}',
                    songId: ${songId},
                    height
                }, '*');
            };

            const reportInteraction = () => {
                parent.postMessage({
                    type: '${GENIUS_EMBED_INTERACTION_MESSAGE}',
                    songId: ${songId}
                }, '*');
            };

            window.addEventListener('blur', () => {
                window.setTimeout(() => {
                    const active = document.activeElement;
                    if (active && active.tagName === 'IFRAME') reportInteraction();
                }, 0);
            });

            window.addEventListener('load', reportHeight);
            window.setTimeout(reportHeight, 250);
            window.setTimeout(reportHeight, 1000);
            window.setTimeout(reportHeight, 2500);

            if ('ResizeObserver' in window) {
                const observer = new ResizeObserver(reportHeight);
                observer.observe(document.documentElement);
                if (document.body) observer.observe(document.body);
            }
        })();
    <\/script>
</body>
</html>`;
    }

    function renderGeniusEmbed(geniusSong) {
        const songId = Number(geniusSong && geniusSong.id);
        if (!Number.isFinite(songId) || songId <= 0) {
            clearEmbed("No Genius lyrics page was matched for this track.");
            return;
        }

        if (lastGeniusSongId === songId && activeEmbedFrame && activeEmbedFrame.isConnected) {
            return;
        }

        stopEmbedResizePolling();
        resetGeniusAnnotationScrollState();
        lastGeniusSongId = songId;
        embedContainer.replaceChildren();

        const frame = document.createElement("iframe");
        frame.className = "lyrics-genius-frame";
        frame.title = `Genius lyrics and annotations for ${geniusSong.title || "the current song"}`;
        frame.referrerPolicy = "strict-origin-when-cross-origin";
        frame.setAttribute("scrolling", "no");
        frame.setAttribute("allowtransparency", "true");
        frame.style.backgroundColor = "#969693";
        frame.style.height = "320px";
        activeEmbedFrame = frame;

        frame.addEventListener("load", () => {
            if (frame !== activeEmbedFrame) return;
            resizeGeniusEmbedFrame(frame);

            let attempts = 0;
            stopEmbedResizePolling();
            embedResizeTimer = window.setInterval(() => {
                if (frame !== activeEmbedFrame || !frame.isConnected || attempts >= 8) {
                    stopEmbedResizePolling();
                    return;
                }
                attempts += 1;
                resizeGeniusEmbedFrame(frame);
            }, 750);
        });

        embedContainer.appendChild(frame);
        frame.srcdoc = buildGeniusEmbedDocument(geniusSong, songId);
    }

    function displayNoTrack() {
        songCard.classList.remove("lyrics-hidden");

        if (hasDisplayedTrack) {
            // Retain the last detected song, artwork, progress, and lyrics. This
            // keeps the playback HUD useful while Spotify reports no active item.
            setPlaybackIdleSnapshot(true);
            if (activeEmbedFrame || lastGeniusSongId !== null) {
                embedCard.classList.remove("lyrics-hidden");
            }
            setStatus("Spotify is connected, but no song is currently playing. The last detected track remains displayed.");
            return;
        }

        renderEmptyPlaybackHud(true);
        setStatus("Spotify is connected, but no song is currently playing. Press Play to resume playback.");
    }

    function displayDisconnected() {
        songCard.classList.remove("lyrics-hidden");

        if (hasDisplayedTrack) {
            setPlaybackIdleSnapshot(true);
        } else {
            renderEmptyPlaybackHud(false);
        }

        setStatus("Spotify is not connected. Press “Login with Spotify” to continue.", "error");
    }

    function displayTrack(track, geniusSong, geniusError = "", geniusErrorCode = "") {
        const trackKey = String(track.key || `${track.artist}::${track.title}`);
        const previousTrackKey = lastTrackKey;
        const previousRemainingMs = Math.max(0, (Number(playbackClock.durationMs) || 0) - estimatedPlaybackProgress());
        const trackChanged = trackKey !== previousTrackKey;

        // Fallback for throttled/background timers: if Spotify naturally advanced
        // from an armed side-ending track while the previous track was already at
        // its end, pause the newly started side immediately. Manual Next/Previous
        // clears the arm before changing tracks and therefore does not trigger this.
        if (scrobbleModeEnabled && trackChanged && scrobbleAlbumEndPauseArm && scrobbleAlbumEndPauseArm.trackKey === previousTrackKey && previousRemainingMs <= 1500) {
            const missedAlbumArm = scrobbleAlbumEndPauseArm;
            window.setTimeout(() => pauseSpotifyAtScrobbleAlbumEnd(missedAlbumArm, { force: true }), 0);
        } else if (trackChanged && scrobbleAlbumEndPauseArm && scrobbleAlbumEndPauseArm.trackKey === previousTrackKey) {
            clearScrobbleAlbumEndPause();
        }

        if (vinylModeEnabled && trackChanged && vinylSideEndPauseArm && vinylSideEndPauseArm.trackKey === previousTrackKey && previousRemainingMs <= 1500) {
            const missedBoundaryArm = vinylSideEndPauseArm;
            window.setTimeout(() => pauseSpotifyAtVinylSideEnd(missedBoundaryArm, { force: true }), 0);
        } else if (trackChanged && vinylSideEndPauseArm && vinylSideEndPauseArm.trackKey === previousTrackKey) {
            clearVinylSideEndPause();
        }

        if (trackChanged) {
            currentTrackEndsVinylSide = false;
            currentTrackVinylSide = "";
            currentTrackEndsAlbum = false;
        }
        lastTrackKey = trackKey;
        hasDisplayedTrack = true;

        songCard.classList.remove("lyrics-hidden");
        embedCard.classList.remove("lyrics-hidden");

        songTitle.textContent = track.title || "Unknown song";
        songArtist.textContent = track.artist || "Unknown artist";
        songAlbum.textContent = track.album || "Unknown album";
        sourceBadge.textContent = track.isLocal
            ? (track.artworkSource === "lastfm" ? "Spotify Local File · Last.fm Artwork" : "Spotify Local File")
            : "Spotify Track";
        setPlaybackSnapshot(track);
        const geniusArtworkFallback = track.isLocal
            ? ""
            : (geniusSong && (geniusSong.thumbnailUrl || geniusSong.imageUrl));
        currentDisplayedTrack = track;
        lastDefaultArtworkUrl = track.coverUrl || geniusArtworkFallback || "";
        lastDefaultArtworkTitle = track.album || track.title || "";
        const artworkLookupKey = `${normalizeAlbumIdentityKey(lyricsDiscogsAlbumArtist(track))}::${normalizeAlbumIdentityKey(track.album || "")}::${normalizeAlbumIdentityKey(track.title || "")}`;
        const cachedReleaseOverrideUrl = artworkLookupKey === lastDiscogsAlbumLookupKey && lastDiscogsTracklistPayload && lastDiscogsTracklistPayload.coverOverride
            ? String(lastDiscogsTracklistPayload.coverOverride.imageUrl || "")
            : "";
        const albumIdentityOverrideUrl = track.manualCoverOverride && track.manualCoverOverride.imageUrl
            ? String(track.manualCoverOverride.imageUrl || "")
            : "";
        setArtwork(cachedReleaseOverrideUrl || albumIdentityOverrideUrl || lastDefaultArtworkUrl, lastDefaultArtworkTitle);
        setCoverPickerAvailability(currentDiscogsRelease);
        updateLyricsDiscogsTracklist(track);

        if (!geniusSong) {
            annotationBadge.classList.add("lyrics-hidden");
            descriptionElement.textContent = "There is no description for this track";
            descriptionElement.classList.add("empty");
            if (trackChanged || lastGeniusSongId !== null) {
                clearEmbed("No Genius lyrics page was matched for this track.");
            }
            let statusMessage = `Now playing: ${track.artist} - ${track.title}. No confident Genius match was found.`;
            let statusType = "";

            if (geniusErrorCode === "not_configured") {
                statusMessage = `Now playing: ${track.artist} - ${track.title}. Genius API access token is not configured on the backend.`;
                statusType = "error";
            } else if (geniusErrorCode === "authentication_failed") {
                statusMessage = `Now playing: ${track.artist} - ${track.title}. Genius rejected the configured access token.`;
                statusType = "error";
            } else if (geniusError) {
                statusMessage = `Now playing: ${track.artist} - ${track.title}. Genius lookup failed: ${geniusError}`;
                statusType = "error";
            }

            setStatus(statusMessage, statusType);
            return;
        }

        const annotationCount = Number(geniusSong.annotationCount || 0);
        annotationBadge.textContent = `${annotationCount} Genius annotation${annotationCount === 1 ? "" : "s"}`;
        annotationBadge.classList.remove("lyrics-hidden");

        const geniusDescription = String(geniusSong.description || "").trim();
        if (geniusDescription && geniusDescription !== "?") {
            descriptionElement.textContent = geniusDescription;
            descriptionElement.classList.remove("empty");
        } else {
            descriptionElement.textContent = "There is no description for this track";
            descriptionElement.classList.add("empty");
        }

        renderGeniusEmbed(geniusSong);
        const playbackLabel = track.isPlaying ? "Now playing" : "Paused on";
        setStatus(`${playbackLabel}: ${track.artist} - ${track.title}`, "success");
    }

    async function fetchCurrentLyrics(force = false) {
        if (requestInProgress) return;
        requestInProgress = true;

        if (force) {
            setStatus("Refreshing the currently playing song…");
        }

        try {
            const response = await fetch(`${API_BASE_URL}/api/lyrics/current`, {
                method: "GET",
                credentials: "include",
                cache: "no-store",
                headers: {
                    Accept: "application/json",
                },
            });

            let data;
            try {
                data = await response.json();
            } catch (error) {
                throw new Error(`The lyrics service returned an unreadable response (${response.status}).`);
            }

            if (response.status === 401 || !data.authenticated) {
                setAuthenticated(false);
                displayDisconnected();
                return;
            }

            setAuthenticated(true);

            if (!response.ok || !data.ok) {
                throw new Error(data.error || `Lyrics request failed (${response.status}).`);
            }

            if (!data.playing || !data.track) {
                displayNoTrack();
                return;
            }

            displayTrack(data.track, data.genius || null, data.geniusError || "", data.geniusErrorCode || "");
        } catch (error) {
            setStatus(`Lyrics status unavailable: ${error.message || error}`, "error");
        } finally {
            requestInProgress = false;
        }
    }

    window.addEventListener("message", (event) => {
        const frame = activeEmbedFrame;
        if (!frame || event.source !== frame.contentWindow) return;

        const data = event.data;
        if (!data || typeof data !== "object" || Number(data.songId) !== lastGeniusSongId) return;

        if (data.type === GENIUS_EMBED_INTERACTION_MESSAGE) {
            queueGeniusAnnotationReveal();
            return;
        }

        if (data.type === GENIUS_EMBED_HEIGHT_MESSAGE) {
            const height = Number(data.height);
            if (Number.isFinite(height) && height >= 160) {
                frame.style.height = `${Math.min(Math.ceil(height) + 8, 6000)}px`;
            }
            return;
        }

        if (data.type === GENIUS_EMBED_ERROR_MESSAGE) {
            clearEmbed("The Genius embed was blocked or could not load.");
        }
    });

    async function sendPlaybackControl(action) {
        if (playbackControlInProgress || !spotifyAuthenticated) return;
        if (action === "next" || action === "previous" || action === "restart") {
            clearVinylSideEndPause();
            clearScrobbleAlbumEndPause();
        }

        const labels = {
            restart: "Restart track",
            previous: "Previous track",
            pause: "Pause",
            play: "Play",
            next: "Next track",
        };

        playbackControlInProgress = true;
        updatePlaybackControls();
        setStatus(`${labels[action] || action} requested…`);

        if (action === "restart") {
            playbackClock.progressMs = 0;
            playbackClock.sampledAt = Date.now();
            renderPlaybackProgress();
        } else if (action === "pause") {
            playbackClock.progressMs = estimatedPlaybackProgress();
            playbackClock.isPlaying = false;
            playbackClock.sampledAt = Date.now();
            if (vinylSideEndPauseTimer) {
                window.clearTimeout(vinylSideEndPauseTimer);
                vinylSideEndPauseTimer = null;
            }
            if (scrobbleAlbumEndPauseTimer) {
                window.clearTimeout(scrobbleAlbumEndPauseTimer);
                scrobbleAlbumEndPauseTimer = null;
            }
            renderPlaybackProgress();
        } else if (action === "play") {
            playbackClock.isPlaying = true;
            playbackClock.sampledAt = Date.now();
            if (vinylModeEnabled && vinylSideEndPauseArm) scheduleVinylSideEndPause();
            if (scrobbleModeEnabled && scrobbleAlbumEndPauseArm) scheduleScrobbleAlbumEndPause();
        }

        try {
            const response = await fetch(`${API_BASE_URL}/api/lyrics/control/${encodeURIComponent(action)}`, {
                method: "POST",
                credentials: "include",
                cache: "no-store",
                headers: { Accept: "application/json" },
            });

            let data;
            try {
                data = await response.json();
            } catch (error) {
                throw new Error(`Spotify control returned an unreadable response (${response.status}).`);
            }

            if (response.status === 401 || !data.authenticated) {
                setAuthenticated(false);
                throw new Error(data.error || "Spotify is not connected.");
            }
            if (!response.ok || !data.ok) {
                throw new Error(data.error || `Could not ${action} Spotify playback.`);
            }

            if (action === "previous" || action === "next") {
                lastTrackKey = "";
                lastGeniusSongId = null;
                previousRestartArmedUntil = 0;
            }
            if (action === "restart") {
                setStatus(`Restarted at 0:00. Press Previous Track again within ${Math.round(PREVIOUS_DOUBLE_PRESS_WINDOW_MS / 100) / 10} seconds to play the previous track.`, "success");
            } else {
                setStatus(data.message || `${labels[action] || action} requested.`, "success");
            }
            const trackChange = action === "previous" || action === "next";
            window.setTimeout(() => fetchCurrentLyrics(false), trackChange ? 850 : 300);
            window.setTimeout(() => fetchCurrentLyrics(false), trackChange ? 1800 : 900);
        } catch (error) {
            setStatus(`Spotify control unavailable: ${error.message || error}`, "error");
            window.setTimeout(() => fetchCurrentLyrics(false), 300);
        } finally {
            playbackControlInProgress = false;
            updatePlaybackControls();
        }
    }

    function handlePreviousTrackPress() {
        if (playbackControlInProgress || !spotifyAuthenticated) return;
        const now = Date.now();
        if (now <= previousRestartArmedUntil) {
            previousRestartArmedUntil = 0;
            sendPlaybackControl("previous");
            return;
        }
        previousRestartArmedUntil = now + PREVIOUS_DOUBLE_PRESS_WINDOW_MS;
        sendPlaybackControl("restart");
    }

    function schedulePolling() {
        if (pollTimer) window.clearInterval(pollTimer);
        pollTimer = window.setInterval(() => {
            if (!document.hidden) fetchCurrentLyrics(false);
        }, POLL_INTERVAL_MS);
    }

    document.addEventListener("pointerdown", (event) => {
        if (!annotationScrollActive || annotationRestoreInProgress) return;
        if (embedCard.contains(event.target)) return;
        restoreGeniusAnnotationScroll();
    }, true);

    window.addEventListener("blur", () => {
        window.setTimeout(() => {
            if (activeEmbedFrame && document.activeElement === activeEmbedFrame) {
                queueGeniusAnnotationReveal();
            }
        }, 0);
    });

    previousTrackButton.addEventListener("click", handlePreviousTrackPress);
    pauseButton.addEventListener("click", () => sendPlaybackControl("pause"));
    playButton.addEventListener("click", () => sendPlaybackControl("play"));
    nextTrackButton.addEventListener("click", () => {
        previousRestartArmedUntil = 0;
        sendPlaybackControl("next");
    });

    loginButton.addEventListener("click", () => {
        window.location.href = `${API_BASE_URL}/login?next=${encodeURIComponent("/lyrics.html")}`;
    });

    refreshButton.addEventListener("click", () => {
        previousRestartArmedUntil = 0;
        lastTrackKey = "";
        lastGeniusSongId = null;
        lastDiscogsAlbumLookupKey = "";
        lastDiscogsRenderedLookupKey = "";
        discogsLookupInFlightKey = "";
        lastDiscogsTracklistPayload = null;
        discogsLookupRequestId += 1;
        fetchCurrentLyrics(true);
    });

    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) fetchCurrentLyrics(false);
    });

    window.setInterval(renderPlaybackProgress, 250);
    renderEmptyPlaybackHud(false);
    fetchCurrentLyrics(false);
    schedulePolling();
})();
