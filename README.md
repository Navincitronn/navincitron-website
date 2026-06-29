# Navincitron Website + Spotify Sampler

This folder contains the existing Navincitron static site plus a local Flask backend that can start and stop `sampler.py` from `shuffle.html`.

## Important

`shuffle.html` cannot start Python by itself as a normal static web page. Run the site locally through Flask:

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
```

Edit `.env` with your Spotify Developer app credentials.

Then run:

```powershell
python app.py
```

Open:

```text
http://127.0.0.1:5000/shuffle.html
```

## Spotify setup

Use this Redirect URI in the Spotify Developer Dashboard:

```text
http://127.0.0.1:8888/callback
```

Spotify must be open on the target device. The Start button runs `sampler.py`; the Stop button terminates it and sends a Spotify pause command.

## Album list

Paste Spotify album and playlist URLs into `albums.txt`, one per line. Blank lines and lines beginning with `#` are ignored.


## Shuffle cover art

`shuffle.html` now displays the currently playing Spotify cover image above the sampler output. The backend reads the current Spotify playback state and returns the track album art when available. For local-file playlists where Spotify does not expose a track object, it falls back to the playlist image if Spotify provides one.
