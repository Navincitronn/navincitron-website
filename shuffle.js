document.addEventListener("DOMContentLoaded", () => {
    const albumsFileInput = document.getElementById("albums-file");
    const startIndexInput = document.getElementById("start-index");
    const clipSecondsInput = document.getElementById("clip-seconds");
    const clipMinSecondsInput = document.getElementById("clip-min-seconds");
    const clipMaxSecondsInput = document.getElementById("clip-max-seconds");
    const deviceNameInput = document.getElementById("device-name");
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

    function selectedClipMode() {
        const checked = document.querySelector('input[name="clip-mode"]:checked');
        return checked ? checked.value : "defined";
    }

    function setStatus(text) {
        if (samplerStatus) {
            samplerStatus.textContent = `Status: ${text}`;
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
            const response = await fetch("/api/status");
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
        if (!albumsFileInput || albumsFileInput.files.length === 0) {
            setStatus("upload a .txt file first");
            return;
        }

        const clipMode = selectedClipMode();
        const formData = new FormData();

        formData.append("albumsFile", albumsFileInput.files[0]);
        formData.append("startIndex", startIndexInput.value || "1");
        formData.append("clipMode", clipMode);
        formData.append("clipSeconds", clipSecondsInput.value || "15");
        formData.append("clipMinSeconds", clipMinSecondsInput.value || "15");
        formData.append("clipMaxSeconds", clipMaxSecondsInput.value || "30");
        formData.append("deviceName", deviceNameInput.value || "");
        formData.append("randomStart", randomStartInput.checked ? "true" : "false");
        formData.append("assumedDurationSeconds", assumedDurationInput.value || "180");
        formData.append("localSeekDelaySeconds", localSeekDelayInput.value || "0");

        startButton.disabled = true;
        setStatus("starting");

        try {
            const response = await fetch("/api/start", {
                method: "POST",
                body: formData,
            });

            const data = await response.json();

            if (!response.ok || !data.ok) {
                setStatus(data.error || "could not start sampler");
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
            const response = await fetch("/api/stop", {
                method: "POST",
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

    if (startButton) {
        startButton.addEventListener("click", startSampler);
    }

    if (stopButton) {
        stopButton.addEventListener("click", stopSampler);
    }

    pollStatus();
    setInterval(pollStatus, 1000);
});
