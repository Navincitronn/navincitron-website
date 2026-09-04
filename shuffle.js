document.addEventListener("DOMContentLoaded", () => {
    const albumsFileInput = document.getElementById("albums-file");
    const startIndexInput = document.getElementById("start-index");
    const startIndexRow = document.getElementById("start-index-row");
    const playlistLinkInput = document.getElementById("playlist-link");
    const singleLinkRandomOrderInput = document.getElementById("single-link-random-order");
    const singleLinkRandomOrderRow = document.getElementById("single-link-random-order-row");
    const clipSecondsInput = document.getElementById("clip-seconds");
    const clipMinSecondsInput = document.getElementById("clip-min-seconds");
    const clipMaxSecondsInput = document.getElementById("clip-max-seconds");
    const randomStartInput = document.getElementById("random-start");
    const assumedDurationInput = document.getElementById("assumed-duration-seconds");
    const localSeekDelayInput = document.getElementById("local-seek-delay-seconds");
    const songguesserEnabledInput = document.getElementById("songguesser-enabled");
    const normalSamplerOptions = document.getElementById("normal-sampler-options");
    const songguesserOptions = document.getElementById("songguesser-options");
    const hintReleaseYearInput = document.getElementById("hint-release-year");
    const hintReleaseDecadeInput = document.getElementById("hint-release-decade");
    const hintArtistInput = document.getElementById("hint-artist");
    const hintAlbumInput = document.getElementById("hint-album");
    const startButton = document.getElementById("start-sampler");
    const stopButton = document.getElementById("stop-sampler");
    const samplerTransportControls = document.getElementById("sampler-transport-controls");
    const previousTrackButton = document.getElementById("previous-track");
    const pauseSamplerButton = document.getElementById("pause-sampler");
    const playSamplerButton = document.getElementById("play-sampler");
    const nextTrackButton = document.getElementById("next-track");
    const samplerStatus = document.getElementById("sampler-status");
    const samplerLog = document.getElementById("sampler-log");
    const samplerLogWrap = document.getElementById("shuffle-log-wrap");
    const coverImage = document.getElementById("current-cover-image");
    const coverFrame = document.getElementById("current-cover-frame");
    const currentTrackTitle = document.getElementById("current-track-title");
    const coverPicker = document.getElementById("shuffle-cover-picker");
    const coverPickerTitle = document.getElementById("shuffle-cover-picker-title");
    const coverPickerSearch = document.getElementById("shuffle-cover-picker-search");
    const coverPickerLink = document.getElementById("shuffle-cover-picker-link");
    const coverPickerLinkButton = document.getElementById("shuffle-cover-picker-link-button");
    const coverPickerResetDefault = document.getElementById("shuffle-cover-picker-reset-default");
    const coverPickerClose = document.getElementById("shuffle-cover-picker-close");
    const coverPickerStatus = document.getElementById("shuffle-cover-picker-status");
    const coverPickerResults = document.getElementById("shuffle-cover-picker-results");
    const spotifyLoginButton = document.getElementById("spotify-login");
    const spotifyAuthStatus = document.getElementById("spotify-auth-status");
    const fileSourceOptions = document.getElementById("file-source-options");
    const playlistSourceOptions = document.getElementById("playlist-source-options");
    const songguesserPanel = document.getElementById("songguesser-panel");
    const songguesserProgress = document.getElementById("songguesser-progress");
    const songguesserTimer = document.getElementById("songguesser-timer");
    const songguesserHintsOutput = document.getElementById("songguesser-hints-output");
    const songguesserGuessInput = document.getElementById("songguesser-guess");
    const songguesserSubmitButton = document.getElementById("songguesser-submit");
    const songguesserSkipButton = document.getElementById("songguesser-skip");
    const songguesserArtist = document.getElementById("songguesser-artist");
    const songguesserAlbum = document.getElementById("songguesser-album");
    const songguesserSong = document.getElementById("songguesser-song");
    const songguesserReleaseYearLine = document.getElementById("songguesser-release-year-line");
    const songguesserReleaseDecadeLine = document.getElementById("songguesser-release-decade-line");
    const songguesserReleaseYear = document.getElementById("songguesser-release-year");
    const songguesserReleaseDecade = document.getElementById("songguesser-release-decade");
    const songguesserSummary = document.getElementById("songguesser-summary");
    const songguesserSummaryList = document.getElementById("songguesser-summary-list");

    const API_BASE_URL = "https://api.navincitron.com";
    const SONGGUESSER_CLIP_SECONDS = 30;
    let spotifyAuthenticated = false;
    let songguesserCurrent = null;
    let songguesserCorrect = { artist: false, album: false, song: false };
    let songguesserAcceptingGuesses = false;
    let songguesserWrongGuesses = 0;
    let songguesserRoundResults = [];
    let songguesserTimerInterval = null;
    let songguesserNextTimeout = null;
    let samplerPaused = false;
    let songguesserPaused = false;
    let currentCoverIdentity = null;
    let currentDefaultCoverUrl = "";
    let currentManualCoverOverride = null;
    let coverPickerLookupToken = 0;
    let lastMusicBrainzCoverLookupAt = 0;
    let songguesserCountdownDeadlineMs = 0;
    let songguesserCountdownRemainingMs = 0;
    let songguesserCountdownAction = null;
    const SHUFFLE_LASTFM_API_KEY = "7c87436dbff96020ebb6e3a75cb0f396";

    function selectedClipMode() {
        const checked = document.querySelector('input[name="clip-mode"]:checked');
        return checked ? checked.value : "defined";
    }

    function selectedSourceMode() {
        const checked = document.querySelector('input[name="source-mode"]:checked');
        return checked ? checked.value : "file";
    }

    function songguesserEnabled() {
        return Boolean(songguesserEnabledInput && songguesserEnabledInput.checked);
    }

    function updateSourceModeVisibility() {
        const mode = selectedSourceMode();
        const guessing = songguesserEnabled();

        if (fileSourceOptions) {
            fileSourceOptions.hidden = mode !== "file";
        }

        if (playlistSourceOptions) {
            playlistSourceOptions.hidden = mode !== "playlist";
        }

        if (normalSamplerOptions) {
            normalSamplerOptions.hidden = guessing;
        }

        if (songguesserOptions) {
            songguesserOptions.hidden = !guessing;
        }

        if (startIndexRow) {
            startIndexRow.hidden = guessing;
        }

        if (singleLinkRandomOrderRow) {
            singleLinkRandomOrderRow.hidden = guessing;
        }

        if (samplerLogWrap) {
            samplerLogWrap.hidden = guessing;
        }

        if (samplerTransportControls) {
            // Keep Pause/Play available in Songguesser so artwork can be edited
            // only after playback has deliberately been paused.
            samplerTransportControls.hidden = false;
        }

        if (songguesserPanel && !guessing) {
            songguesserPanel.hidden = true;
        }

        if (startButton) {
            startButton.textContent = guessing ? "Start Songguesser" : "Start Sampler";
        }
    }

    function setStatus(text) {
        if (samplerStatus) {
            samplerStatus.textContent = `Status: ${text}`;
        }
    }

    function setAuthStatus(authenticated, detailText = "") {
        spotifyAuthenticated = authenticated;

        if (!spotifyAuthStatus) return;

        spotifyAuthStatus.classList.toggle("connected", authenticated);
        spotifyAuthStatus.classList.toggle("disconnected", !authenticated);

        if (authenticated) {
            spotifyAuthStatus.textContent = detailText || "Spotify: connected";
            if (spotifyLoginButton) {
                spotifyLoginButton.textContent = "Spotify Connected";
                spotifyLoginButton.title = "Click to reconnect or switch Spotify account.";
                spotifyLoginButton.classList.add("spotify-login-connected");
                spotifyLoginButton.classList.remove("spotify-login-disconnected");
            }
        } else {
            spotifyAuthStatus.textContent = detailText || "Spotify: not connected. Press Login with Spotify before starting.";
            if (spotifyLoginButton) {
                spotifyLoginButton.textContent = "Login with Spotify";
                spotifyLoginButton.title = "Connect Spotify before starting the sampler.";
                spotifyLoginButton.classList.add("spotify-login-disconnected");
                spotifyLoginButton.classList.remove("spotify-login-connected");
            }
        }
    }

    async function refreshAuthStatus() {
        try {
            const response = await fetch(`${API_BASE_URL}/api/auth-status`, {
                credentials: "include",
            });

            const data = await response.json();

            if (!response.ok || !data.ok) {
                setAuthStatus(false, "Spotify: unable to verify login.");
                return false;
            }

            if (data.authenticated) {
                setAuthStatus(true, "Spotify: connected");
                return true;
            }

            setAuthStatus(false);
            return false;
        } catch (error) {
            setAuthStatus(false, `Spotify: login check unavailable: ${error}`);
            return false;
        }
    }

    function setLog(lines) {
        if (!samplerLog) return;

        if (!lines || lines.length === 0) {
            samplerLog.textContent = "No output yet.";
            return;
        }

        samplerLog.textContent = lines.join("\n");
        samplerLog.scrollTop = samplerLog.scrollHeight;
    }

    function currentShufflePlaybackPaused() {
        return songguesserEnabled() ? songguesserPaused : samplerPaused;
    }

    function setShuffleCoverPickerAvailability() {
        if (!coverFrame) return;
        const identity = currentCoverIdentity || {};
        const validIdentity = Boolean(
            identity.artist && identity.album
            && !/^unknown artist$/i.test(identity.artist)
            && !/^unknown album$/i.test(identity.album)
        );

        // Artwork selection is tied to the currently identified Spotify album,
        // not to the player's paused/running state. This also deliberately allows
        // an empty cover frame to be clicked so a missing/local-file cover can be
        // assigned manually.
        const editable = Boolean(validIdentity);
        coverFrame.classList.toggle("editable", editable);
        if (editable) {
            coverFrame.setAttribute("role", "button");
            coverFrame.setAttribute("tabindex", "0");
            coverFrame.setAttribute("aria-label", "Change album artwork");
            coverFrame.title = "Click to change this album artwork.";
        } else {
            coverFrame.removeAttribute("role");
            coverFrame.removeAttribute("tabindex");
            coverFrame.removeAttribute("aria-label");
            coverFrame.removeAttribute("title");
        }
    }

    function setCoverPlaceholder() {
        if (!coverImage || !coverFrame || !currentTrackTitle) return;
        coverImage.removeAttribute("src");
        coverImage.classList.add("empty-cover");
        coverFrame.classList.add("cover-frame-empty", "songguesser-placeholder");
        currentTrackTitle.textContent = "Songguesser";
        currentCoverIdentity = null;
        currentDefaultCoverUrl = "";
        currentManualCoverOverride = null;
        setShuffleCoverPickerAvailability();
    }

    function isValidShuffleImageUrl(value) {
        try {
            const parsed = new URL(String(value || "").trim());
            return parsed.protocol === "http:" || parsed.protocol === "https:";
        } catch (error) {
            return false;
        }
    }

    function shuffleCoverCandidateKey(value) {
        return String(value || "").trim().replace(/^http:/i, "https:").replace(/[?#].*$/, "").toLowerCase();
    }

    function dedupeShuffleCoverCandidates(candidates) {
        const seen = new Set();
        const unique = [];
        for (const candidate of Array.isArray(candidates) ? candidates : []) {
            if (!candidate || !isValidShuffleImageUrl(candidate.imageSrc)) continue;
            const key = shuffleCoverCandidateKey(candidate.imageSrc);
            if (!key || seen.has(key)) continue;
            seen.add(key);
            unique.push(candidate);
        }
        return unique;
    }

    async function shuffleCoverFetchJson(url, timeoutMs = 12000) {
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

    function shuffleLastfmImage(images) {
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

    function shuffleItunesArtwork(url) {
        return String(url || "")
            .replace(/\/\d+x\d+bb\.(jpg|png)$/i, "/1000x1000bb.$1")
            .replace(/\/\d+x\d+bb-/i, "/1000x1000bb-");
    }

    function shuffleCoverSearchIdentity() {
        const identity = currentCoverIdentity || {};
        return {
            title: String(identity.album || "").trim(),
            artist: String(identity.artist || "").trim(),
            year: Number(identity.year) || null,
        };
    }

    async function resolveShuffleLastfmCoverCandidates(entry) {
        if (!SHUFFLE_LASTFM_API_KEY || !entry.title) return [];
        const candidates = [];
        if (entry.artist) {
            try {
                const url = new URL("https://ws.audioscrobbler.com/2.0/");
                url.searchParams.set("method", "album.getinfo");
                url.searchParams.set("artist", entry.artist);
                url.searchParams.set("album", entry.title);
                url.searchParams.set("api_key", SHUFFLE_LASTFM_API_KEY);
                url.searchParams.set("format", "json");
                const data = await shuffleCoverFetchJson(url.href);
                const album = data && data.album;
                const imageSrc = album ? shuffleLastfmImage(album.image) : "";
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
        searchUrl.searchParams.set("api_key", SHUFFLE_LASTFM_API_KEY);
        searchUrl.searchParams.set("format", "json");
        searchUrl.searchParams.set("limit", "20");
        const data = await shuffleCoverFetchJson(searchUrl.href);
        const albums = data && data.results && data.results.albummatches && Array.isArray(data.results.albummatches.album)
            ? data.results.albummatches.album
            : [];
        albums.forEach(album => {
            const imageSrc = shuffleLastfmImage(album && album.image);
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

    async function resolveShuffleItunesCoverCandidates(entry) {
        if (!entry.title) return [];
        const searchTerm = `${entry.artist ? `${entry.artist} ` : ""}${entry.title}${entry.year ? ` ${entry.year}` : ""}`.trim();
        const data = await shuffleCoverFetchJson(`https://itunes.apple.com/search?term=${encodeURIComponent(searchTerm)}&entity=album&limit=20`);
        return (Array.isArray(data && data.results) ? data.results : [])
            .filter(result => result && result.artworkUrl100)
            .map(result => ({
                title: result.collectionName || entry.title,
                artist: result.artistName || entry.artist,
                imageSrc: shuffleItunesArtwork(result.artworkUrl100),
                href: result.collectionViewUrl || "",
                source: "iTunes",
            }));
    }

    async function resolveShuffleMusicBrainzCoverCandidates(entry) {
        if (!entry.title) return [];
        const escapedTitle = entry.title.replace(/"/g, '\\"');
        const escapedArtist = entry.artist.replace(/"/g, '\\"');
        const query = [`releasegroup:"${escapedTitle}"`];
        if (escapedArtist) query.push(`artist:"${escapedArtist}"`);
        const elapsed = Date.now() - lastMusicBrainzCoverLookupAt;
        if (elapsed < 1100) await new Promise(resolve => window.setTimeout(resolve, 1100 - elapsed));
        lastMusicBrainzCoverLookupAt = Date.now();
        const data = await shuffleCoverFetchJson(`https://musicbrainz.org/ws/2/release-group/?query=${encodeURIComponent(query.join(" AND "))}&fmt=json&limit=10`, 15000);
        const groups = Array.isArray(data && data["release-groups"]) ? data["release-groups"] : [];
        const candidates = [];
        for (const group of groups.slice(0, 8)) {
            if (!group || !group.id) continue;
            try {
                const coverData = await shuffleCoverFetchJson(`https://coverartarchive.org/release-group/${encodeURIComponent(group.id)}`, 12000);
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

    async function resolveShuffleInternetArchiveCoverCandidates(entry) {
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
        const data = await shuffleCoverFetchJson(url.href);
        const docs = data && data.response && Array.isArray(data.response.docs) ? data.response.docs : [];
        return docs.filter(doc => doc && doc.identifier).map(doc => ({
            title: doc.title || entry.title,
            artist: Array.isArray(doc.creator) ? doc.creator.join(", ") : (doc.creator || entry.artist),
            imageSrc: `https://archive.org/services/img/${encodeURIComponent(doc.identifier)}`,
            href: `https://archive.org/details/${encodeURIComponent(doc.identifier)}`,
            source: "Internet Archive",
        }));
    }

    async function resolveShuffleManualCoverCandidates() {
        const entry = shuffleCoverSearchIdentity();
        const groups = await Promise.all([
            resolveShuffleLastfmCoverCandidates(entry).catch(() => []),
            resolveShuffleItunesCoverCandidates(entry).catch(() => []),
            resolveShuffleMusicBrainzCoverCandidates(entry).catch(() => []),
            resolveShuffleInternetArchiveCoverCandidates(entry).catch(() => []),
        ]);
        return dedupeShuffleCoverCandidates(groups.flat()).slice(0, 50);
    }

    function renderShuffleCoverPickerCandidates(candidates) {
        if (!coverPickerResults) return;
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
            button.addEventListener("click", () => saveShuffleManualCover(candidate));
            coverPickerResults.appendChild(button);
        });
    }

    async function loadShuffleCoverPickerResults() {
        if (!coverPicker || coverPicker.hidden || !coverPickerResults || !coverPickerStatus) return;
        const token = ++coverPickerLookupToken;
        coverPickerResults.replaceChildren();
        const entry = shuffleCoverSearchIdentity();
        coverPickerStatus.textContent = `Searching all available cover sources for ${entry.artist ? `${entry.artist} - ` : ""}${entry.title}...`;
        try {
            const candidates = await resolveShuffleManualCoverCandidates();
            if (token !== coverPickerLookupToken) return;
            renderShuffleCoverPickerCandidates(candidates);
            coverPickerStatus.textContent = candidates.length
                ? `Select one of ${candidates.length} cover results, or paste an Image Link above.`
                : "No cover results were found. Paste an Image Link above to set one manually.";
        } catch (error) {
            if (token !== coverPickerLookupToken) return;
            coverPickerStatus.textContent = "Cover search failed. Paste an Image Link above to set the cover manually.";
        }
    }

    function openShuffleCoverPicker() {
        if (!coverPicker) return;
        const entry = shuffleCoverSearchIdentity();
        if (!entry.title || /^unknown album$/i.test(entry.title) || !entry.artist || /^unknown artist$/i.test(entry.artist)) return;
        coverPickerLookupToken += 1;
        coverPicker.hidden = false;
        coverPickerTitle.textContent = `Select cover: ${entry.artist ? `${entry.artist} - ` : ""}${entry.title}`;
        coverPickerResults.replaceChildren();
        coverPickerStatus.textContent = "Searching all available cover sources...";
        coverPickerLink.value = "";
        loadShuffleCoverPickerResults();
    }

    function closeShuffleCoverPicker() {
        coverPickerLookupToken += 1;
        if (coverPicker) coverPicker.hidden = true;
    }

    function currentShuffleReleaseId() {
        const releaseId = currentManualCoverOverride && Number(currentManualCoverOverride.releaseId);
        return Number.isFinite(releaseId) && releaseId > 0 ? releaseId : null;
    }

    async function saveShuffleManualCover(candidate) {
        if (!candidate || !isValidShuffleImageUrl(candidate.imageSrc)) return;
        const entry = shuffleCoverSearchIdentity();
        if (!entry.title || !entry.artist) return;
        coverPickerStatus.textContent = "Saving cover...";
        try {
            const requestPayload = {
                artist: entry.artist,
                album: entry.title,
                imageUrl: candidate.imageSrc,
                source: candidate.source || "Manual",
                href: candidate.href || "",
            };
            const releaseId = currentShuffleReleaseId();
            if (releaseId) requestPayload.releaseId = releaseId;
            const response = await fetch(`${API_BASE_URL}/api/manual-cover`, {
                method: "POST",
                credentials: "include",
                cache: "no-store",
                headers: { "Content-Type": "application/json", Accept: "application/json" },
                body: JSON.stringify(requestPayload),
            });
            const payload = await response.json();
            if (!response.ok || !payload || payload.ok !== true) throw new Error(payload && payload.error ? payload.error : `HTTP ${response.status}`);
            currentManualCoverOverride = payload.coverOverride || null;
            coverImage.src = payload.coverOverride && payload.coverOverride.imageUrl ? payload.coverOverride.imageUrl : candidate.imageSrc;
            if (songguesserEnabled() && songguesserCurrent && songguesserCurrent.answer) {
                songguesserCurrent.answer.coverUrl = coverImage.src;
                songguesserCurrent.answer.manualCoverOverride = currentManualCoverOverride;
                if (!songguesserAcceptingGuesses) recordSongguesserRoundResult();
            }
            closeShuffleCoverPicker();
        } catch (error) {
            coverPickerStatus.textContent = `Could not save cover: ${error.message || error}`;
        }
    }

    function useShuffleManualImageLink() {
        const imageSrc = String(coverPickerLink && coverPickerLink.value || "").trim();
        if (!isValidShuffleImageUrl(imageSrc)) {
            coverPickerStatus.textContent = "Enter a valid http:// or https:// image link.";
            return;
        }
        saveShuffleManualCover({ imageSrc, href: imageSrc, source: "Image Link", title: shuffleCoverSearchIdentity().title });
    }

    async function resetShuffleManualCover() {
        const entry = shuffleCoverSearchIdentity();
        if (!entry.title || !entry.artist) return;
        coverPickerStatus.textContent = "Resetting cover...";
        try {
            const requestPayload = { artist: entry.artist, album: entry.title, reset: true };
            const releaseId = currentShuffleReleaseId();
            if (releaseId) requestPayload.releaseId = releaseId;
            const response = await fetch(`${API_BASE_URL}/api/manual-cover`, {
                method: "DELETE",
                credentials: "include",
                cache: "no-store",
                headers: { "Content-Type": "application/json", Accept: "application/json" },
                body: JSON.stringify(requestPayload),
            });
            const payload = await response.json();
            if (!response.ok || !payload || payload.ok !== true) throw new Error(payload && payload.error ? payload.error : `HTTP ${response.status}`);
            currentManualCoverOverride = null;
            if (currentDefaultCoverUrl) coverImage.src = currentDefaultCoverUrl;
            if (songguesserEnabled() && songguesserCurrent && songguesserCurrent.answer) {
                songguesserCurrent.answer.coverUrl = currentDefaultCoverUrl;
                songguesserCurrent.answer.manualCoverOverride = null;
                if (!songguesserAcceptingGuesses) recordSongguesserRoundResult();
            }
            closeShuffleCoverPicker();
            if (!songguesserEnabled()) await pollStatus();
        } catch (error) {
            coverPickerStatus.textContent = `Could not reset cover: ${error.message || error}`;
        }
    }

    function updateTransportControls(running, samplerControl) {
        const guessing = songguesserEnabled();
        const paused = guessing ? songguesserPaused : Boolean(samplerControl && samplerControl.paused);
        if (!guessing) samplerPaused = paused;
        const active = guessing ? Boolean(songguesserCurrent) : Boolean(running);

        if (previousTrackButton) previousTrackButton.disabled = !running || guessing;
        if (nextTrackButton) nextTrackButton.disabled = !running || guessing;
        if (pauseSamplerButton) pauseSamplerButton.disabled = !active || paused;
        if (playSamplerButton) playSamplerButton.disabled = !active || !paused;
        setShuffleCoverPickerAvailability();
    }

    async function sendSamplerControl(command) {
        const guessing = songguesserEnabled();
        if (guessing && !["pause", "play"].includes(command)) return;

        setStatus(`${command} requested`);

        try {
            const endpoint = guessing ? `/api/songguesser/${command}` : `/api/control/${command}`;
            const response = await fetch(`${API_BASE_URL}${endpoint}`, {
                method: "POST",
                credentials: "include",
            });

            const data = await response.json();

            if (!response.ok || !data.ok) {
                setStatus(data.error || `could not ${command}`);
                return;
            }

            if (guessing) {
                songguesserPaused = command === "pause";
                if (songguesserPaused) {
                    pauseSongguesserCountdown();
                    setStatus("paused");
                } else {
                    resumeSongguesserCountdown();
                    setStatus("Songguesser running");
                }
                updateTransportControls(true, { paused: songguesserPaused });
            } else {
                await pollStatus();
            }
        } catch (error) {
            setStatus(`could not ${command}: ${error}`);
        }
    }

    function updateCover(coverArt) {
        if (!coverImage || !coverFrame || !currentTrackTitle) return;

        if (!coverArt) {
            coverImage.removeAttribute("src");
            coverImage.classList.add("empty-cover");
            coverFrame.classList.add("cover-frame-empty");
            coverFrame.classList.remove("songguesser-placeholder");
            currentTrackTitle.textContent = "No track detected";
            currentCoverIdentity = null;
            currentDefaultCoverUrl = "";
            currentManualCoverOverride = null;
            setShuffleCoverPickerAvailability();
            return;
        }

        const artist = coverArt.artist || "Unknown Artist";
        const track = coverArt.track || coverArt.album || "Unknown Song";
        const album = coverArt.album || "Unknown album";
        currentTrackTitle.textContent = `${artist} - ${track}`;
        currentCoverIdentity = { artist, album, track, year: coverArt.year || null };
        currentDefaultCoverUrl = String(coverArt.defaultUrl || coverArt.defaultCoverUrl || coverArt.url || "");
        currentManualCoverOverride = coverArt.manualCoverOverride || null;

        if (coverArt.url) {
            coverImage.src = coverArt.url;
            coverImage.classList.remove("empty-cover");
            coverFrame.classList.remove("cover-frame-empty", "songguesser-placeholder");
        } else {
            // Keep the now-playing artist/album identity even when Spotify has no
            // usable image URL. The empty frame remains selectable so the user can
            // manually assign a persistent cover.
            coverImage.removeAttribute("src");
            coverImage.classList.add("empty-cover");
            coverFrame.classList.add("cover-frame-empty");
            coverFrame.classList.remove("songguesser-placeholder");
        }

        setShuffleCoverPickerAvailability();
    }

    async function pollStatus() {
        if (songguesserEnabled()) return;

        try {
            const response = await fetch(`${API_BASE_URL}/api/status`, {
                credentials: "include",
            });
            const data = await response.json();

            if (!response.ok || !data.ok) {
                setStatus("error");
                return;
            }

            const paused = Boolean(data.samplerControl && data.samplerControl.paused);
            setStatus(data.running ? (paused ? "paused" : "running") : "idle");
            setLog(data.log || []);
            updateCover(data.coverArt || null);
            updateTransportControls(Boolean(data.running), data.samplerControl || null);
        } catch (error) {
            setStatus(`status unavailable: ${error}`);
        }
    }

    function normalizeText(value) {
        return String(value || "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/\b(you|we|they|i|ive|youve|weve|theyve)['’]?ve\b/g, "$1 have")
            .replace(/\b(you|we|they|i)['’]?ll\b/g, "$1 will")
            .replace(/\b(you|we|they|i)['’]?re\b/g, "$1 are")
            .replace(/\b(can)['’]?t\b/g, "$1 not")
            .replace(/&/g, " and ")
            .replace(/[’']/g, "")
            .replace(/[^a-z0-9]+/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    function cleanTaggedTitle(value) {
        let text = String(value || "");
        const noise = [
            "remaster",
            "remastered",
            "remastering",
            "remix",
            "remixed",
            "mix",
            "live",
            "mono",
            "stereo",
            "version",
            "edit",
            "radio edit",
            "single edit",
            "deluxe",
            "deluxe edition",
            "bonus",
            "bonus track",
            "demo",
            "take",
            "session",
            "anniversary",
            "reissue",
            "expanded",
            "expanded edition",
            "explicit",
            "instrumental",
            "acoustic",
            "alternate",
            "alternative",
            "previously unreleased",
            "digitally remastered",
            "remastered version",
            "original mix",
            "new mix"
        ].join("|");

        text = text.replace(new RegExp(`\\s*[\\(\\[][^^\\)\\]]*(${noise})[^\\)\\]]*[\\)\\]]`, "gi"), " ");
        text = text.replace(new RegExp(`\\s+-\\s+.*(${noise}).*$`, "gi"), " ");
        text = text.replace(/\s+-\s+\d{4}.*$/g, " ");
        text = text.replace(/\s+/g, " ").trim();

        return text;
    }

    function cleanSongTitle(value) {
        return cleanTaggedTitle(value);
    }

    function cleanAlbumTitle(value) {
        return cleanTaggedTitle(value);
    }

    function singularizeToken(token) {
        if (token.endsWith("ies") && token.length > 4) {
            return `${token.slice(0, -3)}y`;
        }
        if (token.endsWith("es") && token.length > 4) {
            return token.slice(0, -2);
        }
        if (token.endsWith("s") && token.length > 3) {
            return token.slice(0, -1);
        }
        return token;
    }

    function tokenMatches(expectedToken, guessToken) {
        if (expectedToken === guessToken) return true;
        return singularizeToken(expectedToken) === singularizeToken(guessToken);
    }

    function tokenSetHasApproximate(tokenSet, expectedToken) {
        for (const guessToken of tokenSet) {
            if (tokenMatches(expectedToken, guessToken)) {
                return true;
            }
        }
        return false;
    }

    function significantTokens(value) {
        const stopwords = new Set([
            "the", "a", "an", "and", "of", "to", "in", "on", "for",
            "with", "feat", "featuring", "by", "you", "your", "i", "we",
            "they", "he", "she", "it", "have", "has", "are", "will"
        ]);

        return normalizeText(value)
            .split(" ")
            .filter((token) => token && token.length > 1 && !stopwords.has(token));
    }

    function artistAliasTokenGroups(value) {
        const normalized = normalizeText(value)
            .replace(/\bplus\b/g, " and ")
            .replace(/\bexperience\b/g, " ")
            .replace(/\bband\b/g, " ")
            .replace(/\borchestra\b/g, " ")
            .replace(/\s+/g, " ")
            .trim();

        const pieces = normalized
            .split(/\b(?:and|with|feat|featuring)\b/g)
            .map((piece) => significantTokens(piece))
            .filter((tokens) => tokens.length > 0);

        const allTokens = significantTokens(normalized);
        if (allTokens.length) {
            pieces.push(allTokens);
        }

        return pieces;
    }

    function artistMatches(expectedRaw, guessRaw) {
        const guessTokens = new Set(significantTokens(guessRaw));
        if (!guessTokens.size) return false;

        const groups = artistAliasTokenGroups(expectedRaw);

        for (const group of groups) {
            if (group.every((token) => tokenSetHasApproximate(guessTokens, token))) {
                return true;
            }
        }

        const expectedTokens = significantTokens(expectedRaw);

        return expectedTokens.some((token) => token.length >= 4 && tokenSetHasApproximate(guessTokens, token));
    }

    function answerMatches(expectedRaw, guessRaw, kind) {
        if (kind === "artist") {
            return artistMatches(expectedRaw, guessRaw);
        }

        const expected = kind === "song"
            ? cleanSongTitle(expectedRaw)
            : kind === "album"
                ? cleanAlbumTitle(expectedRaw)
                : expectedRaw;

        const guess = guessRaw || "";
        const expectedNorm = normalizeText(expected);
        const guessNorm = normalizeText(guess);

        if (!expectedNorm || !guessNorm) return false;
        if (guessNorm.includes(expectedNorm) || expectedNorm.includes(guessNorm)) return true;

        const expectedTokens = significantTokens(expected);
        const guessTokens = new Set(significantTokens(guess));

        if (expectedTokens.length === 0) return false;
        return expectedTokens.every((token) => tokenSetHasApproximate(guessTokens, token));
    }

    function playFeedbackSound(filename) {
        try {
            const audio = new Audio(filename);
            audio.currentTime = 0;
            audio.play().catch(() => {});
        } catch (error) {
            // Sound feedback is non-critical.
        }
    }

    function setAnswerText(element, value, statusClass) {
        if (!element) return;
        element.textContent = value || "???";
        element.classList.remove("songguesser-correct", "songguesser-revealed", "songguesser-answer-hint");
        if (statusClass) {
            element.classList.add(statusClass);
        }
    }

    function updateSongguesserAnswerDisplay(revealed = false) {
        const answer = songguesserCurrent ? songguesserCurrent.answer : {};
        const hints = songguesserCurrent ? (songguesserCurrent.hints || {}) : {};

        const showArtistHint = Boolean(hints.artist && !songguesserCorrect.artist && !revealed);
        const showAlbumHint = Boolean(hints.album && !songguesserCorrect.album && !revealed);

        setAnswerText(
            songguesserArtist,
            (revealed || songguesserCorrect.artist || showArtistHint) ? answer.artist : "???",
            songguesserCorrect.artist
                ? "songguesser-correct"
                : showArtistHint
                    ? "songguesser-answer-hint"
                    : (revealed ? "songguesser-revealed" : "")
        );

        setAnswerText(
            songguesserAlbum,
            (revealed || songguesserCorrect.album || showAlbumHint) ? answer.album : "???",
            songguesserCorrect.album
                ? "songguesser-correct"
                : showAlbumHint
                    ? "songguesser-answer-hint"
                    : (revealed ? "songguesser-revealed" : "")
        );

        setAnswerText(
            songguesserSong,
            (revealed || songguesserCorrect.song) ? answer.song : "???",
            songguesserCorrect.song ? "songguesser-correct" : (revealed ? "songguesser-revealed" : "")
        );

        if (songguesserReleaseYearLine) {
            songguesserReleaseYearLine.hidden = !hints.releaseYear;
        }
        if (songguesserReleaseDecadeLine) {
            songguesserReleaseDecadeLine.hidden = !hints.releaseDecade;
        }

        setAnswerText(
            songguesserReleaseYear,
            hints.releaseYear ? hints.releaseYear : "???",
            hints.releaseYear ? "songguesser-answer-hint" : ""
        );
        setAnswerText(
            songguesserReleaseDecade,
            hints.releaseDecade ? hints.releaseDecade : "???",
            hints.releaseDecade ? "songguesser-answer-hint" : ""
        );
    }


    function escapeSongguesserText(value) {
        return String(value || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function summaryColorCount(item) {
        const raw = Number(item.correctCount);
        if (Number.isFinite(raw)) {
            return Math.max(0, Math.min(3, Math.round(raw)));
        }
        return 0;
    }

    function renderSongguesserSummary(summary) {
        if (!songguesserSummary || !songguesserSummaryList) return;

        const rows = Array.isArray(summary) ? summary : [];

        if (!rows.length) {
            songguesserSummary.hidden = true;
            songguesserSummaryList.innerHTML = "";
            return;
        }

        songguesserSummary.hidden = false;
        songguesserSummaryList.innerHTML = rows.map((item) => {
            const index = escapeSongguesserText(item.index || "");
            const artist = escapeSongguesserText(item.artist || "Unknown artist");
            const song = escapeSongguesserText(item.song || "Unknown song");
            const album = escapeSongguesserText(item.album || "Unknown album");
            const coverUrl = item.coverUrl ? escapeSongguesserText(item.coverUrl) : "";
            const correctCount = summaryColorCount(item);

            const cover = coverUrl
                ? `<img class="songguesser-summary-thumb" src="${coverUrl}" alt="">`
                : `<div class="songguesser-summary-thumb" aria-hidden="true"></div>`;

            return `
                <div class="songguesser-summary-item">
                    ${cover}
                    <div>
                        <div class="songguesser-summary-index" data-correct-count="${correctCount}">#${index}</div>
                        <div class="songguesser-summary-title">${artist} - ${song}</div>
                        <div class="songguesser-summary-meta">Album: ${album}</div>
                    </div>
                </div>
            `;
        }).join("");
    }


    function showSongguesserHints(current) {
        updateSongguesserAnswerDisplay(false);
    }

    function clearSongguesserTimers(resetCountdown = true) {
        if (songguesserTimerInterval) {
            clearInterval(songguesserTimerInterval);
            songguesserTimerInterval = null;
        }
        if (songguesserNextTimeout) {
            clearTimeout(songguesserNextTimeout);
            songguesserNextTimeout = null;
        }
        if (resetCountdown) {
            songguesserCountdownDeadlineMs = 0;
            songguesserCountdownRemainingMs = 0;
            songguesserCountdownAction = null;
        }
    }

    function runSongguesserCountdown() {
        if (!songguesserCountdownAction || songguesserPaused) return;
        if (songguesserTimerInterval) clearInterval(songguesserTimerInterval);

        const update = () => {
            const remainingMs = Math.max(0, songguesserCountdownDeadlineMs - Date.now());
            songguesserCountdownRemainingMs = remainingMs;
            const remaining = Math.max(0, Math.ceil(remainingMs / 1000));
            if (songguesserTimer) songguesserTimer.textContent = String(remaining);

            if (remainingMs <= 0) {
                const action = songguesserCountdownAction;
                clearSongguesserTimers(true);
                if (typeof action === "function") action();
            }
        };

        update();
        if (songguesserCountdownAction) songguesserTimerInterval = setInterval(update, 250);
    }

    function beginSongguesserCountdown(deadlineMs, action) {
        clearSongguesserTimers(true);
        songguesserCountdownDeadlineMs = Math.max(Date.now(), Number(deadlineMs) || Date.now());
        songguesserCountdownRemainingMs = Math.max(0, songguesserCountdownDeadlineMs - Date.now());
        songguesserCountdownAction = action;
        if (songguesserPaused) {
            if (songguesserTimer) songguesserTimer.textContent = String(Math.ceil(songguesserCountdownRemainingMs / 1000));
            return;
        }
        runSongguesserCountdown();
    }

    function pauseSongguesserCountdown() {
        if (!songguesserCountdownAction) return;
        songguesserCountdownRemainingMs = Math.max(0, songguesserCountdownDeadlineMs - Date.now());
        if (songguesserTimerInterval) {
            clearInterval(songguesserTimerInterval);
            songguesserTimerInterval = null;
        }
        if (songguesserTimer) songguesserTimer.textContent = String(Math.ceil(songguesserCountdownRemainingMs / 1000));
    }

    function resumeSongguesserCountdown() {
        if (!songguesserCountdownAction) return;
        songguesserCountdownDeadlineMs = Date.now() + Math.max(0, songguesserCountdownRemainingMs);
        runSongguesserCountdown();
    }

    function startSongguesserTimer(endsAtSeconds) {
        beginSongguesserCountdown(Number(endsAtSeconds) * 1000, () => revealSongguesserAnswer("Time's up", 7));
    }

    function startSongguesserNextCountdown(delaySeconds) {
        beginSongguesserCountdown(Date.now() + Number(delaySeconds || 0) * 1000, loadNextSongguesserSong);
    }

    function songguesserCorrectCount() {
        // Result scoring counts only variables the user actually guessed.
        // Hinted/disclosed variables do not inflate the 0-3 correct count.
        return Number(Boolean(songguesserCorrect.artist))
            + Number(Boolean(songguesserCorrect.album))
            + Number(Boolean(songguesserCorrect.song));
    }

    function songguesserHintSatisfies(kind) {
        const hints = songguesserCurrent ? (songguesserCurrent.hints || {}) : {};

        if (kind === "artist") return Boolean(hints.artist);
        if (kind === "album") return Boolean(hints.album);
        return false;
    }

    function songguesserVariableSatisfied(kind) {
        return Boolean(songguesserCorrect[kind]) || songguesserHintSatisfies(kind);
    }

    function songguesserAllRequiredVariablesSatisfied() {
        return songguesserVariableSatisfied("artist")
            && songguesserVariableSatisfied("album")
            && songguesserVariableSatisfied("song");
    }

    function recordSongguesserRoundResult() {
        if (!songguesserCurrent) return;

        const answer = songguesserCurrent.answer || {};
        const progress = Number(songguesserCurrent.progress || 0);
        const correctCount = songguesserCorrectCount();

        const existingIndex = songguesserRoundResults.findIndex((item) => Number(item.index) === progress);
        const result = {
            index: progress,
            artist: answer.artist || "Unknown artist",
            song: answer.song || "Unknown song",
            album: answer.album || "Unknown album",
            coverUrl: answer.coverUrl || "",
            correctCount,
        };

        if (existingIndex >= 0) {
            songguesserRoundResults[existingIndex] = result;
        } else {
            songguesserRoundResults.push(result);
        }
    }

    function mergeSongguesserSummary(serverSummary) {
        const byIndex = new Map();

        for (const item of Array.isArray(serverSummary) ? serverSummary : []) {
            byIndex.set(Number(item.index), { ...item });
        }

        for (const item of songguesserRoundResults) {
            const index = Number(item.index);
            byIndex.set(index, { ...(byIndex.get(index) || {}), ...item });
        }

        return Array.from(byIndex.values()).sort((a, b) => Number(a.index) - Number(b.index));
    }

    function revealSongguesserAnswer(reason, delaySeconds) {
        if (!songguesserCurrent) return;

        clearSongguesserTimers();
        songguesserAcceptingGuesses = false;
        updateSongguesserAnswerDisplay(true);
        recordSongguesserRoundResult();

        const answer = songguesserCurrent.answer || {};
        updateCover({
            url: answer.coverUrl,
            defaultUrl: answer.defaultCoverUrl || answer.coverUrl,
            manualCoverOverride: answer.manualCoverOverride || null,
            artist: answer.artist,
            track: answer.song,
            album: answer.album,
        });

        setStatus(songguesserPaused ? `${reason}. Paused.` : `${reason}. Next song in ${delaySeconds} seconds.`);
        if (songguesserGuessInput) songguesserGuessInput.disabled = true;
        if (songguesserSkipButton) songguesserSkipButton.disabled = true;

        startSongguesserNextCountdown(delaySeconds);
        updateTransportControls(true, { paused: songguesserPaused });
    }

    function handleSongguesserCurrent(current) {
        songguesserCurrent = current;
        songguesserPaused = Boolean(current && current.paused);
        songguesserCorrect = { artist: false, album: false, song: false };
        songguesserWrongGuesses = 0;
        songguesserAcceptingGuesses = true;

        if (songguesserPanel) songguesserPanel.hidden = false;
        if (songguesserSummary) songguesserSummary.hidden = true;
        if (songguesserGuessInput) {
            songguesserGuessInput.value = "";
            songguesserGuessInput.disabled = false;
            songguesserGuessInput.focus();
        }
        if (songguesserSkipButton) songguesserSkipButton.disabled = false;
        if (songguesserProgress) songguesserProgress.textContent = `Song ${current.progress} / ${current.total}`;

        setCoverPlaceholder();
        showSongguesserHints(current);
        updateSongguesserAnswerDisplay(false);
        setStatus(songguesserPaused ? "paused" : "Songguesser running");
        startSongguesserTimer(current.endsAt);
        if (songguesserPaused) pauseSongguesserCountdown();
        updateTransportControls(true, { paused: songguesserPaused });
    }

    async function startSongguesser() {
        const authenticated = await refreshAuthStatus();
        if (!authenticated) {
            setStatus("press Login with Spotify first");
            return;
        }

        const sourceMode = selectedSourceMode();
        if (sourceMode === "file" && (!albumsFileInput || albumsFileInput.files.length === 0)) {
            setStatus("upload a .txt file first");
            return;
        }
        if (sourceMode === "playlist" && (!playlistLinkInput || !playlistLinkInput.value.trim())) {
            setStatus("enter a Spotify album or playlist link first");
            return;
        }

        const formData = new FormData();
        formData.append("sourceMode", sourceMode);
        formData.append("playlistLink", playlistLinkInput ? playlistLinkInput.value.trim() : "");
        formData.append("hintReleaseYear", hintReleaseYearInput && hintReleaseYearInput.checked ? "true" : "false");
        formData.append("hintReleaseDecade", hintReleaseDecadeInput && hintReleaseDecadeInput.checked ? "true" : "false");
        formData.append("hintArtist", hintArtistInput && hintArtistInput.checked ? "true" : "false");
        formData.append("hintAlbum", hintAlbumInput && hintAlbumInput.checked ? "true" : "false");

        if (sourceMode === "file") {
            formData.append("albumsFile", albumsFileInput.files[0]);
        }

        startButton.disabled = true;
        setStatus("starting Songguesser");
        clearSongguesserTimers();
        renderSongguesserSummary([]);

        try {
            const response = await fetch(`${API_BASE_URL}/api/songguesser/start`, {
                method: "POST",
                body: formData,
                credentials: "include",
            });
            const data = await response.json();

            if (!response.ok || !data.ok) {
                if (response.status === 401) setAuthStatus(false);
                setStatus(data.error || "could not start Songguesser");
                return;
            }

            if (data.complete) {
                setStatus(data.message || "Songguesser complete");
                renderSongguesserSummary(mergeSongguesserSummary(data.summary || []));
                return;
            }

            handleSongguesserCurrent(data);
        } catch (error) {
            setStatus(`could not start Songguesser: ${error}`);
        } finally {
            startButton.disabled = false;
        }
    }

    async function loadNextSongguesserSong() {
        clearSongguesserTimers();
        try {
            const response = await fetch(`${API_BASE_URL}/api/songguesser/next`, {
                method: "POST",
                credentials: "include",
            });
            const data = await response.json();

            if (!response.ok || !data.ok) {
                setStatus(data.error || "could not start next Songguesser song");
                return;
            }

            if (data.complete) {
                songguesserAcceptingGuesses = false;
                setStatus(data.message || "Songguesser complete");
                if (songguesserTimer) songguesserTimer.textContent = "0";
                if (songguesserProgress) songguesserProgress.textContent = "Songguesser complete";
                renderSongguesserSummary(mergeSongguesserSummary(data.summary || []));
                return;
            }

            handleSongguesserCurrent(data);
        } catch (error) {
            setStatus(`could not load next Songguesser song: ${error}`);
        }
    }

    function submitSongguesserGuess() {
        if (!songguesserAcceptingGuesses || !songguesserCurrent) return;

        const guess = songguesserGuessInput ? songguesserGuessInput.value : "";
        const answer = songguesserCurrent.answer || {};
        let newlyCorrect = 0;

        // Artist/Album hints are already disclosed answers. Do not require the
        // user to type them, and do not count them as user-guessed variables.
        if (!songguesserHintSatisfies("artist")
            && !songguesserCorrect.artist
            && answerMatches(answer.artist, guess, "artist")) {
            songguesserCorrect.artist = true;
            newlyCorrect += 1;
        }
        if (!songguesserHintSatisfies("album")
            && !songguesserCorrect.album
            && answerMatches(answer.album, guess, "album")) {
            songguesserCorrect.album = true;
            newlyCorrect += 1;
        }
        if (!songguesserCorrect.song && answerMatches(answer.song, guess, "song")) {
            songguesserCorrect.song = true;
            newlyCorrect += 1;
        }

        if (songguesserGuessInput) {
            songguesserGuessInput.value = "";
            songguesserGuessInput.focus();
        }

        if (newlyCorrect > 0) {
            songguesserWrongGuesses = 0;
            for (let i = 0; i < newlyCorrect; i += 1) {
                playFeedbackSound("correct.mp3");
            }
        } else {
            songguesserWrongGuesses += 1;
            playFeedbackSound("wrong.mp3");
        }

        updateSongguesserAnswerDisplay(false);

        if (songguesserAllRequiredVariablesSatisfied()) {
            revealSongguesserAnswer("Correct", 5);
            return;
        }

        if (songguesserWrongGuesses >= 3) {
            revealSongguesserAnswer("Three wrong guesses", 7);
        }
    }

    async function startSampler() {
        if (songguesserEnabled()) {
            await startSongguesser();
            return;
        }

        const authenticated = await refreshAuthStatus();

        if (!authenticated) {
            setStatus("press Login with Spotify first");
            return;
        }

        const sourceMode = selectedSourceMode();

        if (sourceMode === "file" && (!albumsFileInput || albumsFileInput.files.length === 0)) {
            setStatus("upload a .txt file first");
            return;
        }

        if (sourceMode === "playlist" && (!playlistLinkInput || !playlistLinkInput.value.trim())) {
            setStatus("enter a Spotify album or playlist link first");
            return;
        }

        const clipMode = selectedClipMode();
        const formData = new FormData();

        formData.append("sourceMode", sourceMode);
        formData.append("startIndex", startIndexInput ? (startIndexInput.value || "1") : "1");
        formData.append("playlistLink", playlistLinkInput ? playlistLinkInput.value.trim() : "");
        formData.append("singleLinkRandomOrder", singleLinkRandomOrderInput && singleLinkRandomOrderInput.checked ? "true" : "false");
        formData.append("clipMode", clipMode);
        formData.append("clipSeconds", clipSecondsInput.value || "15");
        formData.append("clipMinSeconds", clipMinSecondsInput.value || "18");
        formData.append("clipMaxSeconds", clipMaxSecondsInput.value || "25");
        formData.append("randomStart", randomStartInput.checked ? "true" : "false");
        formData.append("assumedDurationSeconds", assumedDurationInput.value || "180");
        formData.append("localSeekDelaySeconds", localSeekDelayInput.value || "0");

        if (sourceMode === "file") {
            formData.append("albumsFile", albumsFileInput.files[0]);
        }

        startButton.disabled = true;
        setStatus("starting");

        try {
            const response = await fetch(`${API_BASE_URL}/api/start`, {
                method: "POST",
                body: formData,
                credentials: "include",
            });

            const data = await response.json();

            if (!response.ok || !data.ok) {
                if (response.status === 401) {
                    setAuthStatus(false);
                    setStatus(data.error || "press Login with Spotify first");
                } else {
                    setStatus(data.error || "could not start sampler");
                }
                return;
            }

            setStatus("running");
            updateTransportControls(true, { paused: false });
            await pollStatus();
        } catch (error) {
            setStatus(`could not start sampler: ${error}`);
        } finally {
            startButton.disabled = false;
        }
    }

    async function stopSampler() {
        stopButton.disabled = true;
        setStatus("stopping");
        clearSongguesserTimers();

        try {
            const endpoint = songguesserEnabled() ? "/api/songguesser/stop" : "/api/stop";
            const response = await fetch(`${API_BASE_URL}${endpoint}`, {
                method: "POST",
                credentials: "include",
            });

            const data = await response.json();

            if (!response.ok || !data.ok) {
                setStatus(data.error || "could not stop sampler");
                return;
            }

            songguesserAcceptingGuesses = false;
            songguesserPaused = false;
            samplerPaused = false;
            songguesserCurrent = null;
            closeShuffleCoverPicker();
            updateCover(null);
            setStatus("idle");
            updateTransportControls(false, { paused: false });
            await pollStatus();
        } catch (error) {
            setStatus(`could not stop sampler: ${error}`);
        } finally {
            stopButton.disabled = false;
        }
    }

    if (spotifyLoginButton) {
        spotifyLoginButton.addEventListener("click", () => {
            window.location.href = `${API_BASE_URL}/login`;
        });
    }

    document.querySelectorAll('input[name="source-mode"]').forEach((input) => {
        input.addEventListener("change", updateSourceModeVisibility);
    });

    if (songguesserEnabledInput) {
        songguesserEnabledInput.addEventListener("change", () => {
            updateSourceModeVisibility();
            closeShuffleCoverPicker();
            songguesserPaused = false;
            samplerPaused = false;
            if (songguesserEnabled()) {
                setCoverPlaceholder();
                updateTransportControls(Boolean(songguesserCurrent), { paused: false });
            } else {
                updateCover(null);
                updateTransportControls(false, { paused: false });
            }
        });
    }

    if (startButton) {
        startButton.addEventListener("click", startSampler);
    }

    if (stopButton) {
        stopButton.addEventListener("click", stopSampler);
    }

    if (previousTrackButton) {
        previousTrackButton.addEventListener("click", () => sendSamplerControl("previous"));
    }

    if (pauseSamplerButton) {
        pauseSamplerButton.addEventListener("click", () => sendSamplerControl("pause"));
    }

    if (playSamplerButton) {
        playSamplerButton.addEventListener("click", () => sendSamplerControl("play"));
    }

    if (nextTrackButton) {
        nextTrackButton.addEventListener("click", () => sendSamplerControl("next"));
    }


    if (coverPicker && coverPickerClose && coverPickerSearch && coverPickerLink && coverPickerLinkButton && coverPickerResetDefault && coverFrame) {
        coverPickerClose.addEventListener("click", closeShuffleCoverPicker);
        coverPickerSearch.addEventListener("click", loadShuffleCoverPickerResults);
        coverPickerLinkButton.addEventListener("click", useShuffleManualImageLink);
        coverPickerResetDefault.addEventListener("click", resetShuffleManualCover);
        coverPickerLink.addEventListener("keydown", event => {
            if (event.key === "Enter") {
                event.preventDefault();
                useShuffleManualImageLink();
            }
        });
        coverPicker.addEventListener("click", event => {
            if (event.target === coverPicker) closeShuffleCoverPicker();
        });
        coverFrame.addEventListener("click", openShuffleCoverPicker);
        coverFrame.addEventListener("keydown", event => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openShuffleCoverPicker();
            }
        });
    }

    if (songguesserGuessInput) {
        songguesserGuessInput.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                submitSongguesserGuess();
            }
        });
    }

    if (songguesserSkipButton) {
        songguesserSkipButton.addEventListener("click", () => {
            revealSongguesserAnswer("Skipped", 7);
        });
    }

    updateSourceModeVisibility();
    refreshAuthStatus();
    pollStatus();
    setInterval(pollStatus, 1000);
    setInterval(refreshAuthStatus, 15000);
});
