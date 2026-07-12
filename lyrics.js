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
    const geniusLink = document.getElementById("lyrics-genius-link");
    const spotifyLink = document.getElementById("lyrics-spotify-link");
    const embedCard = document.getElementById("lyrics-embed-card");
    const embedContainer = document.getElementById("lyrics-embed-container");

    let lastTrackKey = "";
    let lastGeniusSongId = null;
    let requestInProgress = false;
    let pollTimer = null;
    let activeEmbedFrame = null;
    let embedResizeTimer = null;

    const GENIUS_EMBED_HEIGHT_MESSAGE = "navincitron-genius-embed-height";
    const GENIUS_EMBED_ERROR_MESSAGE = "navincitron-genius-embed-error";

    function setStatus(message, type = "") {
        statusElement.textContent = message;
        statusElement.classList.toggle("error", type === "error");
        statusElement.classList.toggle("success", type === "success");
    }

    function setAuthenticated(authenticated) {
        loginButton.textContent = authenticated ? "Spotify Connected" : "Login with Spotify";
        loginButton.classList.toggle("connected", authenticated);
        loginButton.title = authenticated
            ? "Reconnect or switch the Spotify account used by this page."
            : "Connect Spotify so the page can identify the currently playing song.";
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

    function setExternalLink(anchor, url) {
        if (url) {
            anchor.href = url;
            anchor.hidden = false;
        } else {
            anchor.removeAttribute("href");
            anchor.hidden = true;
        }
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
        html, body { margin: 0; padding: 0; background: #969693; color: #111111; }
        body { isolation: isolate; overflow: hidden; position: relative; }

        /* Genius renders the lyrics inside a cross-origin child frame. Its
           internal white background cannot be changed directly, so this
           non-interactive tint layer is composited over the rendered embed.
           The multiply blend preserves black text while converting white to
           the requested #969693 lyrics color. */
        body::after {
            background: #969693;
            content: "";
            inset: 0;
            mix-blend-mode: multiply;
            pointer-events: none;
            position: fixed;
            z-index: 2147483647;
        }

        iframe { background: #969693; border: 0; display: block; max-width: 100%; width: 100%; }
        .rg_embed_link { background: #969693; box-sizing: border-box; font-family: Arial, sans-serif; padding: 18px; }
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
        const geniusArtworkFallback = track.isLocal
            ? ""
            : (geniusSong && (geniusSong.thumbnailUrl || geniusSong.imageUrl));
        setArtwork(track.coverUrl || geniusArtworkFallback, track.album || track.title);
        setExternalLink(spotifyLink, track.spotifyUrl || "");

        if (!geniusSong) {
            annotationBadge.classList.add("lyrics-hidden");
            descriptionElement.textContent = "There is no description for this track";
            descriptionElement.classList.add("empty");
            setExternalLink(geniusLink, "");
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

        setExternalLink(geniusLink, geniusSong.url || "");
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

        if (data.type === GENIUS_EMBED_HEIGHT_MESSAGE) {
            const height = Number(data.height);
            if (Number.isFinite(height) && height >= 160) {
                frame.style.height = `${Math.min(Math.ceil(height) + 8, 6000)}px`;
            }
            return;
        }

        if (data.type === GENIUS_EMBED_ERROR_MESSAGE) {
            clearEmbed("The Genius embed was blocked or could not load. Use “Open on Genius” to view the lyrics page directly.");
        }
    });

    function schedulePolling() {
        if (pollTimer) window.clearInterval(pollTimer);
        pollTimer = window.setInterval(() => {
            if (!document.hidden) fetchCurrentLyrics(false);
        }, POLL_INTERVAL_MS);
    }

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

    fetchCurrentLyrics(false);
    schedulePolling();
})();
