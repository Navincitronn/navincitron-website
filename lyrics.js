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
    const embedCard = document.getElementById("lyrics-embed-card");
    const embedContainer = document.getElementById("lyrics-embed-container");
    const discogsCard = document.getElementById("lyrics-discogs-card");
    const discogsStatus = document.getElementById("lyrics-discogs-status");
    const discogsReleaseMeta = document.getElementById("lyrics-discogs-release-meta");
    const discogsSides = document.getElementById("lyrics-discogs-sides");

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
    let discogsLookupRequestId = 0;
    let playbackClock = {
        progressMs: 0,
        durationMs: 0,
        isPlaying: false,
        sampledAt: Date.now(),
    };

    const GENIUS_EMBED_HEIGHT_MESSAGE = "navincitron-genius-embed-height";
    const GENIUS_EMBED_ERROR_MESSAGE = "navincitron-genius-embed-error";
    const GENIUS_EMBED_INTERACTION_MESSAGE = "navincitron-genius-embed-interaction";

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


    function findLyricsDiscogsCollectionAlbum(entry) {
        if (!topsterEntryIsInDiscogsCollection(entry)) return null;
        const entryArtist = cleanAlbumTitle(entry && entry.artist || '');
        const entryTitle = cleanAlbumTitle(entry && entry.title || '');
        if (!entryTitle || !Array.isArray(topsterDiscogsCollectionAlbums)) return null;

        const collectionAlbums = topsterDiscogsCollectionAlbums;
        const candidates = getTopsterDiscogsCandidateAlbums(entryArtist);
        const orderedCandidates = [];
        const seen = new Set();
        const addCandidate = album => {
            if (!album) return;
            const key = `${discogsOwnedRelationKey(album.title || '')}::${(album.artists || []).map(discogsOwnedRelationKey).join('|')}`;
            if (seen.has(key)) return;
            seen.add(key);
            orderedCandidates.push(album);
        };
        candidates.forEach(addCandidate);

        if (discogsOwnedEntryHasCrossCreditRule(entryArtist, entryTitle)) {
            collectionAlbums.forEach(addCandidate);
        }

        for (const album of orderedCandidates) {
            const collectionTitle = cleanAlbumTitle(album.title || '');
            const collectionArtists = Array.isArray(album.artists) && album.artists.length ? album.artists : [album.artist || ''];
            if (!collectionTitle) continue;

            if (discogsOwnedKnownCrossCreditMatch(entryArtist, entryTitle, collectionTitle, collectionArtists)) {
                return album;
            }

            const artistsMatch = discogsOwnedArtistsMatch(entryArtist, collectionArtists);
            if (!artistsMatch) continue;
            if (normalizeAlbumIdentityKey(entryTitle) === normalizeAlbumIdentityKey(collectionTitle)) return album;
            if (discogsOwnedKnownContainerMatch(entryArtist, entryTitle, collectionTitle)) return album;
            if (discogsOwnedKnownAliasMatch(entryArtist, entryTitle, collectionTitle, collectionArtists)) return album;
            if (discogsOwnedSafeTitleEquivalence(entryTitle, collectionTitle, entryArtist, collectionArtists)) return album;

            const titleScore = discogsOwnedTitleScore(entryTitle, collectionTitle, entryArtist, collectionArtists.join(', '));
            if (titleScore >= 0.68 && discogsOwnedFuzzyTitleMatchIsSafe(entryTitle, collectionTitle)) return album;
            if (discogsOwnedIsCompilationLike(entryTitle) && discogsOwnedIsCompilationLike(collectionTitle)) return album;
            if (discogsOwnedIsArtistPresentationTitle(entryTitle, entryArtist) && discogsOwnedIsArtistPresentationTitle(collectionTitle, entryArtist)) return album;
        }

        // The Topster matcher also has deterministic owned-release and multi-release
        // fallbacks. If one of those made the ownership decision, recover the most
        // relevant real collection row so the backend can resolve an actual vinyl
        // release ID and tracklist.
        if (discogsOwnedKnownMultiReleaseMatch(entryArtist, entryTitle)) {
            for (const group of DISCOGS_OWNED_MULTI_RELEASE_GROUPS) {
                if (!discogsOwnedArtistMatchesScopedGroup(entryArtist, group.artists)) continue;
                if (!(group.entryTitles || []).some(title => discogsOwnedRelationKey(title) === discogsOwnedRelationKey(entryTitle))) continue;
                for (const requirement of group.requires || []) {
                    const requiredTitleKeys = new Set((requirement.titles || []).map(discogsOwnedRelationKey));
                    const album = collectionAlbums.find(candidate => {
                        const candidateArtists = Array.isArray(candidate.artists) && candidate.artists.length ? candidate.artists : [candidate.artist || ''];
                        return requiredTitleKeys.has(discogsOwnedRelationKey(candidate.title || ''))
                            && candidateArtists.some(artist => discogsOwnedArtistMatchesScopedGroup(artist, requirement.artists || group.artists));
                    });
                    if (album) return album;
                }
            }
        }

        if (discogsOwnedConfirmedReleaseMatch(entryArtist, entryTitle)) {
            let bestAlbum = null;
            let bestScore = 0;
            for (const album of collectionAlbums) {
                const collectionArtists = Array.isArray(album.artists) && album.artists.length ? album.artists : [album.artist || ''];
                if (!discogsOwnedArtistsMatch(entryArtist, collectionArtists)) continue;
                const score = discogsOwnedTitleScore(entryTitle, album.title || '', entryArtist, collectionArtists.join(', '));
                if (score > bestScore) {
                    bestScore = score;
                    bestAlbum = album;
                }
            }
            if (bestAlbum && bestScore >= 0.30) return bestAlbum;
        }

        return null;
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


    function setDiscogsStatus(message, type = "") {
        discogsStatus.textContent = message;
        discogsStatus.classList.toggle("error", type === "error");
    }

    function resetDiscogsTracklist(options = {}) {
        discogsLookupRequestId += 1;
        if (options.clearLookup !== false) {
            lastDiscogsAlbumLookupKey = "";
            lastDiscogsTracklistPayload = null;
        }
        discogsSides.replaceChildren();
        discogsReleaseMeta.replaceChildren();
        discogsReleaseMeta.hidden = true;
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

    function lyricsDiscogsCleanTrackTitle(value) {
        const qualifierWords = "remaster(?:ed|ing)?|live|radio edit|single edit|album version|mono|stereo|bonus track|deluxe|version|mix|edit|instrumental|karaoke";
        let text = String(value || "").trim();
        if (!text) return "";
        text = text.replace(new RegExp(`\\s*[\\[(][^\\])]*(?:${qualifierWords})[^\\])]*[\\])]\\s*`, "gi"), " ");
        text = text.replace(new RegExp(`\\s+-\\s+[^-]*(?:${qualifierWords})[^-]*$`, "i"), "");
        return text.replace(/\s+/g, " ").replace(/^\s*-|\s*-\s*$/g, "").trim();
    }

    function lyricsDiscogsTrackMatchScore(currentTitle, candidateTitle) {
        const currentRaw = String(currentTitle || "").trim();
        const candidateRaw = String(candidateTitle || "").trim();
        if (!currentRaw || !candidateRaw) return 0;

        const currentClean = lyricsDiscogsCleanTrackTitle(currentRaw);
        const candidateClean = lyricsDiscogsCleanTrackTitle(candidateRaw);
        const currentKey = lyricsDiscogsNormalizeTrackText(currentClean);
        const candidateKey = lyricsDiscogsNormalizeTrackText(candidateClean);
        if (currentKey && currentKey === candidateKey) return 1;

        const currentFull = lyricsDiscogsNormalizeTrackText(currentRaw);
        const candidateFull = lyricsDiscogsNormalizeTrackText(candidateRaw);
        if (currentFull && currentFull === candidateFull) return 0.99;

        const leftTokens = new Set(currentKey.split(/\s+/).filter(Boolean));
        const rightTokens = new Set(candidateKey.split(/\s+/).filter(Boolean));
        if (leftTokens.size && rightTokens.size) {
            let intersection = 0;
            leftTokens.forEach(token => { if (rightTokens.has(token)) intersection += 1; });
            const overlap = intersection / Math.max(leftTokens.size, rightTokens.size);
            if (overlap >= 0.9) return 0.94;
            if (overlap >= 0.75 && Math.min(currentKey.length, candidateKey.length) >= 8) return 0.82;
        }

        if (Math.min(currentKey.length, candidateKey.length) >= 10
            && (currentKey.includes(candidateKey) || candidateKey.includes(currentKey))) return 0.78;
        return 0;
    }

    function lyricsDiscogsSideFromPosition(position) {
        const text = String(position || "").trim().toUpperCase();
        if (!text) return "";
        const match = text.match(/^([A-Z]{1,3})(?=\d|$|[-.])/);
        return match ? match[1] : "";
    }

    function flattenLyricsDiscogsTracklist(tracklist, inheritedSide = "", rows = []) {
        let currentSide = inheritedSide;
        for (const entry of Array.isArray(tracklist) ? tracklist : []) {
            if (!entry || typeof entry !== "object") continue;
            const position = String(entry.position || "").trim();
            const detectedSide = lyricsDiscogsSideFromPosition(position);
            if (detectedSide) currentSide = detectedSide;
            const title = String(entry.title || "").trim();
            const type = String(entry.type || "track").toLowerCase();
            const subTracks = Array.isArray(entry.subTracks) ? entry.subTracks : [];

            if (title && (type === "track" || type === "index")) {
                rows.push({
                    position,
                    title,
                    duration: String(entry.duration || "").trim(),
                    side: detectedSide || currentSide || "",
                    type,
                });
            }

            if (subTracks.length) {
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

    function renderLyricsDiscogsTracklist(payload, currentTrackTitle = "") {
        discogsCard.classList.remove("lyrics-hidden");
        discogsSides.replaceChildren();
        discogsReleaseMeta.replaceChildren();
        discogsReleaseMeta.hidden = true;

        if (!payload || payload.noCollectionMatch) {
            setDiscogsStatus("This album is not in the NNavincitron Discogs collection.");
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
            setDiscogsStatus(payload.message || "The matched Discogs album is no longer present in the collection snapshot.");
            return;
        }
        if (!payload.vinylFound || !payload.release) {
            setDiscogsStatus(payload.message || "This album is in the Discogs collection, but no owned vinyl release tracklist was found.");
            return;
        }

        const release = payload.release;
        const rows = flattenLyricsDiscogsTracklist(release.tracklist || []);
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
        if (currentRowScore < 0.72) currentRowIndex = -1;

        const collectionAlbum = payload.collectionAlbum || {};
        const collectionArtist = Array.isArray(collectionAlbum.artists) ? collectionAlbum.artists.join(", ") : "";
        setDiscogsStatus(`Matched owned Discogs vinyl: ${collectionArtist ? `${collectionArtist} - ` : ""}${collectionAlbum.title || release.title || "release"}.`);

        const metaParts = [];
        if (release.year) metaParts.push(String(release.year));
        const formatSummary = lyricsDiscogsFormatSummary(release);
        if (formatSummary) metaParts.push(formatSummary);
        if (release.releaseId) metaParts.push(`Release #${release.releaseId}`);
        if (metaParts.length || release.discogsUrl) {
            const textNode = document.createTextNode(metaParts.join(" · "));
            discogsReleaseMeta.appendChild(textNode);
            if (release.discogsUrl) {
                if (metaParts.length) discogsReleaseMeta.appendChild(document.createTextNode(" · "));
                const link = document.createElement("a");
                link.href = release.discogsUrl;
                link.target = "_blank";
                link.rel = "noopener noreferrer";
                link.textContent = "Open on Discogs";
                discogsReleaseMeta.appendChild(link);
            }
            discogsReleaseMeta.hidden = false;
        }

        const groups = new Map();
        let mostRecentSide = "";
        rows.forEach((row, index) => {
            if (row.side) mostRecentSide = row.side;
            const groupKey = row.side || mostRecentSide || "Tracklist";
            if (!groups.has(groupKey)) groups.set(groupKey, []);
            groups.get(groupKey).push({ ...row, index });
        });

        groups.forEach((groupRows, groupKey) => {
            const side = document.createElement("section");
            side.className = "lyrics-discogs-side";
            const heading = document.createElement("h4");
            heading.textContent = groupKey === "Tracklist" ? "Tracklist" : `Side ${groupKey}`;
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
                title.textContent = row.title;
                const duration = document.createElement("span");
                duration.className = "lyrics-discogs-track-duration";
                duration.textContent = row.duration || "";

                trackRow.append(position, title, duration);
                side.appendChild(trackRow);
            });
            discogsSides.appendChild(side);
        });
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
            return;
        }

        const lookupKey = `${normalizeAlbumIdentityKey(albumArtist)}::${normalizeAlbumIdentityKey(albumTitle)}`;
        if (!options.force && lookupKey === lastDiscogsAlbumLookupKey && lastDiscogsTracklistPayload) {
            renderLyricsDiscogsTracklist(lastDiscogsTracklistPayload, track.title || "");
            return;
        }

        lastDiscogsAlbumLookupKey = lookupKey;
        lastDiscogsTracklistPayload = null;
        const requestId = ++discogsLookupRequestId;
        discogsCard.classList.remove("lyrics-hidden");
        discogsSides.replaceChildren();
        discogsReleaseMeta.replaceChildren();
        discogsReleaseMeta.hidden = true;
        setDiscogsStatus(`Looking up ${albumArtist ? `${albumArtist} - ` : ""}${albumTitle} in the NNavincitron Discogs collection…`);

        const collectionLoaded = await ensureTopsterDiscogsCollectionLoaded();
        if (requestId !== discogsLookupRequestId) return;
        if (!collectionLoaded) {
            lastDiscogsTracklistPayload = { error: true, message: "The Discogs collection could not be loaded." };
            renderLyricsDiscogsTracklist(lastDiscogsTracklistPayload, track.title || "");
            return;
        }

        const matchedAlbum = findLyricsDiscogsCollectionAlbum({ artist: albumArtist, title: albumTitle });
        if (!matchedAlbum) {
            lastDiscogsTracklistPayload = { noCollectionMatch: true };
            renderLyricsDiscogsTracklist(lastDiscogsTracklistPayload, track.title || "");
            return;
        }

        const collectionArtists = Array.isArray(matchedAlbum.artists) ? matchedAlbum.artists : [];
        const params = new URLSearchParams({
            collection_title: String(matchedAlbum.title || ""),
            collection_artist: String(collectionArtists[0] || matchedAlbum.artist || ""),
            artist: albumArtist,
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
            lastDiscogsTracklistPayload = payload;
            renderLyricsDiscogsTracklist(payload, track.title || "");
        } catch (error) {
            if (requestId !== discogsLookupRequestId) return;
            lastDiscogsTracklistPayload = { error: true, message: `Discogs vinyl tracklist unavailable: ${error.message || error}` };
            renderLyricsDiscogsTracklist(lastDiscogsTracklistPayload, track.title || "");
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
                if (frame !== activeEmbedFrame || !frame.isConnected || attempts >= 40) {
                    stopEmbedResizePolling();
                    return;
                }
                attempts += 1;
                resizeGeniusEmbedFrame(frame);
            }, 250);
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
        const trackChanged = trackKey !== lastTrackKey;
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
        setArtwork(track.coverUrl || geniusArtworkFallback, track.album || track.title);
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
            renderPlaybackProgress();
        } else if (action === "play") {
            playbackClock.isPlaying = true;
            playbackClock.sampledAt = Date.now();
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
