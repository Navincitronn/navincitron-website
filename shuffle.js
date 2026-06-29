document.addEventListener("DOMContentLoaded", () => {
    const albumsFileInput = document.getElementById("albums-file");
    const startIndexInput = document.getElementById("start-index");
    const playlistLinkInput = document.getElementById("playlist-link");
    const singleLinkRandomOrderInput = document.getElementById("single-link-random-order");
    const clipSecondsInput = document.getElementById("clip-seconds");
    const clipMinSecondsInput = document.getElementById("clip-min-seconds");
    const clipMaxSecondsInput = document.getElementById("clip-max-seconds");
    const randomStartInput = document.getElementById("random-start");
    const assumedDurationInput = document.getElementById("assumed-duration-seconds");
    const localSeekDelayInput = document.getElementById("local-seek-delay-seconds");
    const startButton = document.getElementById("start-sampler");
    const stopButton = document.getElementById("stop-sampler");
    const samplerStatus = document.getElementById("sampler-status");
    const samplerLog = document.getElementById("sampler-log");
    const coverImage = document.getElementById("current-cover-image");
    const coverFrame = document.getElementById("current-cover-frame");
    const currentTrackTitle = document.getElementById("current-track-title");
    const spotifyLoginButton = document.getElementById("spotify-login");
    const spotifyAuthStatus = document.getElementById("spotify-auth-status");
    const fileSourceOptions = document.getElementById("file-source-options");
    const playlistSourceOptions = document.getElementById("playlist-source-options");

    const API_BASE_URL = "https://api.navincitron.com";
    let spotifyAuthenticated = false;

    function selectedClipMode() {
        const checked = document.querySelector('input[name="clip-mode"]:checked');
        return checked ? checked.value : "defined";
    }

    function selectedSourceMode() {
        const checked = document.querySelector('input[name="source-mode"]:checked');
        return checked ? checked.value : "file";
    }

    function updateSourceModeVisibility() {
        const mode = selectedSourceMode();

        if (fileSourceOptions) {
            fileSourceOptions.hidden = mode !== "file";
        }

        if (playlistSourceOptions) {
            playlistSourceOptions.hidden = mode !== "playlist";
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
            }
        } else {
            spotifyAuthStatus.textContent = detailText || "Spotify: not connected. Press Login with Spotify before starting.";
            if (spotifyLoginButton) {
                spotifyLoginButton.textContent = "Login with Spotify";
                spotifyLoginButton.title = "Connect Spotify before starting the sampler.";
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

    function updateCover(coverArt) {
        if (!coverImage || !coverFrame || !currentTrackTitle) return;

        if (!coverArt || !coverArt.url) {
            coverImage.removeAttribute("src");
            coverImage.classList.add("empty-cover");
            coverFrame.classList.add("cover-frame-empty");
            currentTrackTitle.textContent = "No track detected";
            return;
        }

        coverImage.src = coverArt.url;
        coverImage.classList.remove("empty-cover");
        coverFrame.classList.remove("cover-frame-empty");

        const artist = coverArt.artist || "Unknown Artist";
        const track = coverArt.track || coverArt.album || "Unknown Song";
        currentTrackTitle.textContent = `${artist} - ${track}`;
    }

    async function pollStatus() {
        try {
            const response = await fetch(`${API_BASE_URL}/api/status`, {
                credentials: "include",
            });
            const data = await response.json();

            if (!response.ok || !data.ok) {
                setStatus("error");
                return;
            }

            setStatus(data.running ? "running" : "idle");
            setLog(data.log || []);
            updateCover(data.coverArt || null);
        } catch (error) {
            setStatus(`status unavailable: ${error}`);
        }
    }

    async function startSampler() {
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

        try {
            const response = await fetch(`${API_BASE_URL}/api/stop`, {
                method: "POST",
                credentials: "include",
            });

            const data = await response.json();

            if (!response.ok || !data.ok) {
                setStatus(data.error || "could not stop sampler");
                return;
            }

            setStatus("idle");
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

    if (startButton) {
        startButton.addEventListener("click", startSampler);
    }

    if (stopButton) {
        stopButton.addEventListener("click", stopSampler);
    }

    updateSourceModeVisibility();
    refreshAuthStatus();
    pollStatus();
    setInterval(pollStatus, 1000);
    setInterval(refreshAuthStatus, 15000);
});
