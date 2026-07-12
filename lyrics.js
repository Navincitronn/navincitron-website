(() => {
    "use strict";

    const API_BASE_URL = "https://api.navincitron.com";
    const POLL_INTERVAL_MS = 6000;

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

    let lastTrackKey = "";
    let lastGeniusSongId = null;
    let requestInProgress = false;
    let pollTimer = null;
    let activeEmbedFrame = null;
    let embedResizeTimer = null;
    let spotifyAuthenticated = false;
    let hasCurrentTrack = false;
    let playbackControlInProgress = false;
    let lastEmbedInteractionAt = 0;
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
        const controlsUnavailable = !spotifyAuthenticated || !hasCurrentTrack || playbackControlInProgress;
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

    function mobileAnnotationAutoScrollEnabled() {
        return window.matchMedia("(max-width: 700px), (orientation: portrait) and (pointer: coarse)").matches;
    }

    function revealGeniusAnnotationAtTop() {
        if (!mobileAnnotationAutoScrollEnabled() || !activeEmbedFrame || !activeEmbedFrame.isConnected) return;

        const now = Date.now();
        if (now - lastEmbedInteractionAt < 450) return;
        lastEmbedInteractionAt = now;

        window.setTimeout(() => {
            if (!activeEmbedFrame || !activeEmbedFrame.isConnected) return;
            const top = embedContainer.getBoundingClientRect().top + window.scrollY - 12;
            window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });

            // Return focus to the host page after Genius processes the click.
            // This allows the next iframe interaction to be detected as well.
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
            // Do not jump to the annotation area while the user is scrolling.
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
        lastTrackKey = "";
        songCard.classList.add("lyrics-hidden");
        embedCard.classList.add("lyrics-hidden");
        clearArtwork();
        clearEmbed();
        setPlaybackSnapshot(null);
        setStatus("Spotify is connected, but no song is currently playing.");
    }

    function displayTrack(track, geniusSong, geniusError = "", geniusErrorCode = "") {
        const trackKey = String(track.key || `${track.artist}::${track.title}`);
        const trackChanged = trackKey !== lastTrackKey;
        lastTrackKey = trackKey;

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
                songCard.classList.add("lyrics-hidden");
                embedCard.classList.add("lyrics-hidden");
                clearEmbed();
                setPlaybackSnapshot(null);
                setStatus("Spotify is not connected. Press “Login with Spotify” to continue.", "error");
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
        if (playbackControlInProgress || !spotifyAuthenticated || !hasCurrentTrack) return;

        const labels = {
            previous: "Previous track",
            pause: "Pause",
            play: "Play",
            next: "Next track",
        };

        playbackControlInProgress = true;
        updatePlaybackControls();
        setStatus(`${labels[action] || action} requested…`);

        if (action === "pause") {
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
            }
            setStatus(data.message || `${labels[action] || action} requested.`, "success");
            window.setTimeout(() => fetchCurrentLyrics(false), action === "previous" || action === "next" ? 850 : 300);
            window.setTimeout(() => fetchCurrentLyrics(false), action === "previous" || action === "next" ? 1800 : 900);
        } catch (error) {
            setStatus(`Spotify control unavailable: ${error.message || error}`, "error");
            window.setTimeout(() => fetchCurrentLyrics(false), 300);
        } finally {
            playbackControlInProgress = false;
            updatePlaybackControls();
        }
    }

    function schedulePolling() {
        if (pollTimer) window.clearInterval(pollTimer);
        pollTimer = window.setInterval(() => {
            if (!document.hidden) fetchCurrentLyrics(false);
        }, POLL_INTERVAL_MS);
    }

    window.addEventListener("blur", () => {
        window.setTimeout(() => {
            if (activeEmbedFrame && document.activeElement === activeEmbedFrame) {
                queueGeniusAnnotationReveal();
            }
        }, 0);
    });

    previousTrackButton.addEventListener("click", () => sendPlaybackControl("previous"));
    pauseButton.addEventListener("click", () => sendPlaybackControl("pause"));
    playButton.addEventListener("click", () => sendPlaybackControl("play"));
    nextTrackButton.addEventListener("click", () => sendPlaybackControl("next"));

    loginButton.addEventListener("click", () => {
        window.location.href = `${API_BASE_URL}/login?next=${encodeURIComponent("/lyrics.html")}`;
    });

    refreshButton.addEventListener("click", () => {
        lastTrackKey = "";
        lastGeniusSongId = null;
        fetchCurrentLyrics(true);
    });

    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) fetchCurrentLyrics(false);
    });

    window.setInterval(renderPlaybackProgress, 250);
    setPlaybackSnapshot(null);
    fetchCurrentLyrics(false);
    schedulePolling();
})();
