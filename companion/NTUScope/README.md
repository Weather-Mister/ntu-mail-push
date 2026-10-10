# NTU Schedule – lightweight Windows PC Audio Companion

A **native C++ Windows 10/11 (x64)** companion for the Eren GitHub schedule's skeuomorphic oscilloscope. Uses only Windows system APIs, not .NET, NAudio, Electron, Python or an embedded HTTP framework.

The application reads the default Windows output with **WASAPI loopback**, computes 64 envelope levels plus amplitude and a rough zero-crossing frequency indicator, and sends these small JSON frames at 20 Hz over an authenticated **127.0.0.1-only WebSocket**. It never records, persists, or uploads sound, and never accesses your microphone. No elevated permissions or added audio driver required.

## Install and use

1. Open [Build NTU Scope Companion](https://github.com/Weather-Mister/ntu-mail-push/actions/workflows/build-scope-companion.yml), select the most recent **successful main-branch build** and download the `ntu-scope-companion-win-x64` ZIP under **Artifacts** (requires GitHub login).
2. Extract and run **NTUScope.exe**. A small console shows the pairing key and capture status; leave it open while using the visualizer.
3. Open [Eren's skeuomorphic schedule](https://weather-mister.github.io/ntu-mail-push/skeuo-demo.html) in Firefox.
4. Click **AUX** beside the waveform. If this is your first setup, enter the 32-character pairing key displayed by the companion and click **CONNECT**.
5. The site remembers your key in that Firefox profile and reconnects on subsequent visits while the companion runs. If Firefox asks permission to connect to local services, approve it for the schedule site.
6. **DISCONNECT** in AUX settings to stop the website receiving data. Close the companion window to stop capture entirely.

**Upgrading from the original 75 MB .NET version:** Close and delete the old `NTUScope.exe`, then run the smaller replacement. **Your existing pairing key continues working** because the new app reuses `%LOCALAPPDATA%\NTUScope\pairing-key.txt`.

## Build from source (Visual Studio 2022 C++ desktop tools)

```powershell
cmake -S companion/NTUScope -B build/ntu-scope -G "Visual Studio 17 2022" -A x64
cmake --build build/ntu-scope --config Release
.\build\ntu-scope\Release\NTUScope.exe --self-test
```

The binary is statically linked to the C++ runtime (`/MT`), so it doesn't require users to install the MSVC redistributable. Its actual size is measured by GitHub Actions, which rejects builds larger than **5 MiB**. The self-test runs without playback hardware and verifies WebSocket handshake hashing, authorization checks, and frame serialization.

## Security, privacy, and limitations

- The listener binds only to IPv4 **127.0.0.1:43187** and uses both **site Origin restriction** (`https://weather-mister.github.io`) and a cryptographically random **32-character per-install pairing key**. The key is stored in `%LOCALAPPDATA%\NTUScope\pairing-key.txt`; deleting that file while the companion is closed rotates the key.
- Only one website connection is handled at a time. It is not an open LAN server; you cannot access the sound waveform from a different machine.
- The local WebSocket uses `ws://` on loopback, not an internet connection. Firefox's behavior can depend on local-network-access and mixed-content policies; the Firefox browser connection test covers the current CI version, but local user permission prompts may still appear.
- The default Windows **playback** device is selected when the app starts. Restart after switching to Bluetooth headphones or a different output.
- Silence flattens the wave. Some DRM-protected audio and exclusive-mode apps are not exposed to shared-mode WASAPI loopback.
- **The CI self-test is hardware-free:** live device capture still requires testing on a Windows PC. An unsigned new executable may receive a Windows SmartScreen warning; download only from this repository's build.

This update affects the **companion executable only**. It does **not** change either schedule's regular dashboard, Begüm's schedule, the website's waveform UI, or any Hatchable deployment.
