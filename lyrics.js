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

    function clearEmbed(message = "Waiting for a currently playing song.") {
        lastGeniusSongId = null;
        embedContainer.replaceChildren();
        const placeholder = document.createElement("div");
        placeholder.className = "lyrics-embed-placeholder";
        placeholder.textContent = message;
        embedContainer.appendChild(placeholder);
    }

    function renderGeniusEmbed(geniusSong) {
        const songId = Number(geniusSong && geniusSong.id);
        if (!Number.isFinite(songId) || songId <= 0) {
            clearEmbed("No Genius lyrics page was matched for this track.");
            return;
        }

        if (lastGeniusSongId === songId && embedContainer.querySelector(".rg_embed_link")) {
            return;
        }

        lastGeniusSongId = songId;
        embedContainer.replaceChildren();

        const embedTarget = document.createElement("div");
        embedTarget.id = `rg_embed_link_${songId}`;
        embedTarget.className = "rg_embed_link";
        embedTarget.dataset.songId = String(songId);
        embedContainer.appendChild(embedTarget);

        const embedScript = document.createElement("script");
        embedScript.src = geniusSong.embedScriptUrl || `https://genius.com/songs/${songId}/embed.js`;
        embedScript.async = true;
        embedScript.dataset.geniusSongId = String(songId);
        embedScript.onerror = () => {
            if (lastGeniusSongId !== songId) return;
            clearEmbed("The Genius embed could not load. Use “Open on Genius” to view the lyrics page directly.");
        };
        embedContainer.appendChild(embedScript);
    }

    function displayNoTrack() {
        lastTrackKey = "";
        songCard.classList.add("lyrics-hidden");
        embedCard.classList.add("lyrics-hidden");
        clearArtwork();
        clearEmbed();
        setStatus("Spotify is connected, but no song is currently playing.");
    }

    function displayTrack(track, geniusSong, geniusError = "") {
        const trackKey = String(track.key || `${track.artist}::${track.title}`);
        const trackChanged = trackKey !== lastTrackKey;
        lastTrackKey = trackKey;

        songCard.classList.remove("lyrics-hidden");
        embedCard.classList.remove("lyrics-hidden");

        songTitle.textContent = track.title || "Unknown song";
        songArtist.textContent = track.artist || "Unknown artist";
        songAlbum.textContent = track.album || "Unknown album";
        sourceBadge.textContent = track.isLocal ? "Spotify Local File" : "Spotify Track";
        setArtwork(track.coverUrl || (geniusSong && (geniusSong.thumbnailUrl || geniusSong.imageUrl)), track.album || track.title);
        setExternalLink(spotifyLink, track.spotifyUrl || "");

        if (!geniusSong) {
            annotationBadge.classList.add("lyrics-hidden");
            descriptionElement.textContent = "No Genius description is available because this track could not be matched to a Genius song page.";
            descriptionElement.classList.add("empty");
            setExternalLink(geniusLink, "");
            if (trackChanged || lastGeniusSongId !== null) {
                clearEmbed("No Genius lyrics page was matched for this track.");
            }
            setStatus(
                geniusError
                    ? `Now playing: ${track.artist} - ${track.title}. Genius lookup is temporarily unavailable.`
                    : `Now playing: ${track.artist} - ${track.title}. No confident Genius match was found.`,
                geniusError ? "error" : ""
            );
            return;
        }

        const annotationCount = Number(geniusSong.annotationCount || 0);
        annotationBadge.textContent = `${annotationCount} Genius annotation${annotationCount === 1 ? "" : "s"}`;
        annotationBadge.classList.remove("lyrics-hidden");

        if (geniusSong.description) {
            descriptionElement.textContent = geniusSong.description;
            descriptionElement.classList.remove("empty");
        } else {
            descriptionElement.textContent = "No Genius description is available for this song.";
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

            displayTrack(data.track, data.genius || null, data.geniusError || "");
        } catch (error) {
            setStatus(`Lyrics status unavailable: ${error.message || error}`, "error");
        } finally {
            requestInProgress = false;
        }
    }

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
