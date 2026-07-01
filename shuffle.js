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
    const samplerStatus = document.getElementById("sampler-status");
    const samplerLog = document.getElementById("sampler-log");
    const samplerLogWrap = document.getElementById("shuffle-log-wrap");
    const coverImage = document.getElementById("current-cover-image");
    const coverFrame = document.getElementById("current-cover-frame");
    const currentTrackTitle = document.getElementById("current-track-title");
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

    function setCoverPlaceholder() {
        if (!coverImage || !coverFrame || !currentTrackTitle) return;
        coverImage.removeAttribute("src");
        coverImage.classList.add("empty-cover");
        coverFrame.classList.add("cover-frame-empty", "songguesser-placeholder");
        currentTrackTitle.textContent = "Songguesser";
    }

    function updateCover(coverArt) {
        if (!coverImage || !coverFrame || !currentTrackTitle) return;

        if (!coverArt || !coverArt.url) {
            coverImage.removeAttribute("src");
            coverImage.classList.add("empty-cover");
            coverFrame.classList.add("cover-frame-empty");
            coverFrame.classList.remove("songguesser-placeholder");
            currentTrackTitle.textContent = "No track detected";
            return;
        }

        coverImage.src = coverArt.url;
        coverImage.classList.remove("empty-cover");
        coverFrame.classList.remove("cover-frame-empty", "songguesser-placeholder");

        const artist = coverArt.artist || "Unknown Artist";
        const track = coverArt.track || coverArt.album || "Unknown Song";
        currentTrackTitle.textContent = `${artist} - ${track}`;
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

            setStatus(data.running ? "running" : "idle");
            setLog(data.log || []);
            updateCover(data.coverArt || null);
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

    function clearSongguesserTimers() {
        if (songguesserTimerInterval) {
            clearInterval(songguesserTimerInterval);
            songguesserTimerInterval = null;
        }
        if (songguesserNextTimeout) {
            clearTimeout(songguesserNextTimeout);
            songguesserNextTimeout = null;
        }
    }

    function startSongguesserTimer(endsAtSeconds) {
        clearSongguesserTimers();

        const update = () => {
            const remaining = Math.max(0, Math.ceil((endsAtSeconds * 1000 - Date.now()) / 1000));
            if (songguesserTimer) {
                songguesserTimer.textContent = String(remaining);
            }

            if (remaining <= 0) {
                clearSongguesserTimers();
                revealSongguesserAnswer("Time's up", 7);
            }
        };

        update();
        songguesserTimerInterval = setInterval(update, 250);
    }

    function startSongguesserNextCountdown(delaySeconds) {
        clearSongguesserTimers();

        const targetTime = Date.now() + delaySeconds * 1000;

        const update = () => {
            const remaining = Math.max(0, Math.ceil((targetTime - Date.now()) / 1000));
            if (songguesserTimer) {
                songguesserTimer.textContent = String(remaining);
            }

            if (remaining <= 0) {
                clearSongguesserTimers();
                loadNextSongguesserSong();
            }
        };

        update();
        songguesserTimerInterval = setInterval(update, 250);
    }

    function songguesserCorrectCount() {
        return Number(Boolean(songguesserCorrect.artist))
            + Number(Boolean(songguesserCorrect.album))
            + Number(Boolean(songguesserCorrect.song));
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
            artist: answer.artist,
            track: answer.song,
            album: answer.album,
        });

        setStatus(`${reason}. Next song in ${delaySeconds} seconds.`);
        if (songguesserGuessInput) songguesserGuessInput.disabled = true;
        if (songguesserSkipButton) songguesserSkipButton.disabled = true;

        startSongguesserNextCountdown(delaySeconds);
    }

    function handleSongguesserCurrent(current) {
        songguesserCurrent = current;
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
        setStatus("Songguesser running");
        startSongguesserTimer(current.endsAt);
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

        if (!songguesserCorrect.artist && answerMatches(answer.artist, guess, "artist")) {
            songguesserCorrect.artist = true;
            newlyCorrect += 1;
        }
        if (!songguesserCorrect.album && answerMatches(answer.album, guess, "album")) {
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

        if (songguesserCorrect.artist && songguesserCorrect.album && songguesserCorrect.song) {
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

    if (songguesserEnabledInput) {
        songguesserEnabledInput.addEventListener("change", () => {
            updateSourceModeVisibility();
            if (songguesserEnabled()) {
                setCoverPlaceholder();
            } else {
                updateCover(null);
            }
        });
    }

    if (startButton) {
        startButton.addEventListener("click", startSampler);
    }

    if (stopButton) {
        stopButton.addEventListener("click", stopSampler);
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
