# freditor

A desktop script editor for making AI-voiced podcasts with ElevenLabs. Write or
import a dialogue script, assign ElevenLabs voices to speakers, generate the
vocals line by line, and stitch everything (including your own audio clips)
into a finished episode.

## Features

- **Script editor** organized into sections → lines, with per-line speaker
  assignment, reordering, and inline editing.
- **Script import** from `.txt` / `.md` / `.docx` written like
  `Voice 1: Hey Sam.` — speakers are auto-detected and fuzzy-matched against
  the voices on your ElevenLabs account (misspellings like "Rachael" →
  "Rachel" are caught), with a wizard to correct or merge speakers.
- **Credit awareness**: character counts per line/section/episode, live
  used/remaining quota from your subscription, and cost estimates on every
  Generate button.
- **Smart generation**: only new or edited (stale) lines are regenerated, so
  credits are never spent twice on the same text. Request stitching keeps
  prosody consistent across consecutive lines of the same voice.
- **Per-line control**: voice override, stability/similarity/style/speed
  overrides, per-item gap, one-click regenerate.
- **Real audio clips**: insert your own mp3/wav/m4a/ogg files anywhere in the
  sequence; they play and export inline.
- **Playback**: play a line, a section, or the whole episode with configurable
  gaps between items.
- **Export** via bundled ffmpeg: single stitched WAV/MP3, or separate stems
  per line/clip named by section/position/speaker for use in a DAW or editor.

Projects are saved as `.freditor` JSON files with generated audio cached in a
sibling `<name>.freditor.assets/` folder.

## Web version

A browser version runs at [freditor.crypt0potam.us](https://freditor.crypt0potam.us) —
no install needed. Audio is cached in the browser (IndexedDB), projects
autosave locally and can be saved/opened as `.freditor` files, and exports
download as WAV/MP3 (stems come as a zip). The desktop app is still the best
experience (OS-keychain key storage, real file paths, ffmpeg exports), but the
web version covers the full workflow.

Deploy updates with `scripts/deploy-web.sh` (S3 + CloudFront).

## Download (Windows)

Grab the latest installer (`freditor-x.y.z-setup.exe`) or portable zip from the
[releases page](https://github.com/thoerner/freditor/releases).

The app isn't code-signed, so Windows SmartScreen will warn on first run —
click **More info → Run anyway**. On first launch, open Settings (⚙) and paste
your ElevenLabs API key (ElevenLabs → Developers → API keys).

## Setup (from source)

```sh
npm install
npm run dev
```

Then open Settings (⚙) and paste your ElevenLabs API key (elevenlabs.io →
Profile → API keys). The key is stored encrypted with your OS keychain and is
only ever sent to the ElevenLabs API.

A sample script to try the importer lives at `demo/demo-script.txt`.

## Scripts

```sh
npm run dev        # run the app in dev mode
npm run smoke      # parser + ffmpeg pipeline smoke tests
npm run typecheck  # typecheck main + renderer
npm run lint
npm run build:linux  # package (also build:mac / build:win)
```
