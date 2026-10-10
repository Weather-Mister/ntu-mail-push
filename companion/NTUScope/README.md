# NTU Schedule – Windows PC Audio Companion

A small, private, **Windows-only** companion for the **Eren skeuomorphic GitHub schedule demo**.

The Firefox website cannot directly grab system playback audio without the browser's capture permission and supported audio track. Instead, the helper uses Windows WASAPI loopback from the default playback device and computes **64 amplitude-envelope bins**, one RMS amplitude and a rough crossing-rate frequency feature. It does not save recordings, stream PCM, use a microphone or transmit audio to the internet.

## Installation (Windows 10/11 x64)

1. Open the repository's **Actions → Build NTU Scope Companion** workflow, select the latest successful run, and download the `ntu-scope-companion-win-x64` artifact.
2. Extract the ZIP and run `NTUScope.exe`. Keep its terminal window open.
3. Open <https://weather-mister.github.io/ntu-mail-push/skeuo-demo.html> in Firefox.
4. Press **AUX** on the oscilloscope. Enter the 32-character pairing key printed by `NTUScope.exe`, then click **CONNECT**.
5. If Firefox prompts for **Device apps and services / Local Network Access**, allow this site to access the companion.
6. Press **DISCONNECT** in the site's AUX dialog to stop the connection, or close the companion to stop audio capture. The original schedule-based waveform returns automatically.

The website remembers the pairing key in this browser profile, so future visits reconnect automatically while the companion is running. The key is stored in `%LOCALAPPDATA%\NTUScope\pairing-key.txt` on the PC. Deleting that file with the app closed rotates the key (re-pair afterward).

**No administrator rights, microphone permissions, or virtual audio devices should be needed.** Antivirus / Windows SmartScreen may warn about an unsigned custom executable. Only use a binary you built yourself or one produced by this repository's GitHub Actions workflow.

## Build from source

```powershell
dotnet publish companion/NTUScope/NTUScope.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o dist/scope
```

The app listens only on `127.0.0.1:43187` (not your LAN) and accepts WebSocket connections only from origin `https://weather-mister.github.io` supplying the per-install key. The browser connects to `ws://127.0.0.1:43187/stream`. Some Firefox security configurations may block the request; use the Firefox permission dialog rather than disabling global browser security settings.

The sound source is the **default Windows playback device at launch**. If you change from speakers to headphones or Bluetooth, restart the helper. Silence produces a flat waveform after 200 ms. DRM-protected streams or exclusive-mode output may not be visible to WASAPI loopback.

## Troubleshooting

- **NO CONNECTION**: Verify the helper is running, the key is correct, and Firefox allowed local device access. If the browser blocks insecure loopback WebSockets in your configuration, check the Console for a mixed-content or network permission error. Do not disable browser security globally.
- **CONNECTED but flat**: Play audio on the current default Windows output device, and check Windows volume/output routing. Restart after changing outputs.
- **Port occupied**: Close any previous NTUScope instance, then try again.
- **Stop all capture**: Close the companion window; the site falls back to the schedule wave.

This feature does not change the production `index.html`, Begüm's schedule, or the Hatchable site.
