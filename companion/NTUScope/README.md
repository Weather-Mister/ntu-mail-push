# NTU Scope — silent Windows audio companion

A tiny, **tray-only** native Windows 10/11 x64 companion for the Eren skeuomorphic NTU Schedule oscilloscope. It captures default Windows playback via WASAPI loopback and streams a **128-point signed time-domain waveform snapshot** plus 64 amplitude envelopes, at 20 Hz, to the paired GitHub schedule using the authenticated local WebSocket at `127.0.0.1:43187`. This restores the **original live-audio oscilloscope look**, rather than the synthetic pitch-driven sine wave. The snapshots represent real audio samples; they go **only to the local browser**, never to the internet. No audio files, microphone capture, remote transmission, .NET, drivers or elevated privileges.

**Waveform update:** If you already have the 350 KB background helper, exit it from the tray, then download/run the latest binary. The earlier companion continues to connect but does not send real time-domain samples, so only the updated helper can show the restored waveform.

## Install once

1. Download `ntu-scope-companion-win-x64` from the latest successful **main** run of [Build NTU Scope Companion](https://github.com/Weather-Mister/ntu-mail-push/actions/workflows/build-scope-companion.yml). Extract `NTUScope.exe`.
2. **Exit any older NTUScope version first**, especially an earlier black console window. Double-click the extracted executable once.
3. The app copies itself into `%LOCALAPPDATA%\NTUScope\NTUScope.exe` and starts from that stable location. **No console or taskbar window appears.** Look under the Windows notification area (^ arrow) for the green oscilloscope icon.
4. By default it **starts automatically every time you sign in to Windows** (no administrator privileges or Task Scheduler needed). It will run quietly without displaying a window.
5. Open [Eren's NTU schedule demo](https://weather-mister.github.io/ntu-mail-push/skeuo-demo.html) in Firefox. Click **AUX** to connect if it has not already paired. If you need the 32-character pairing key, right-click the new green tray icon and select **Copy pairing key**; paste it into the AUX form. The pairing key survives upgrades.

The tray icon stays available while the companion runs, including when Firefox is closed. Only the connected schedule website receives waveform measurements.

## Tray controls

Right-click (or left-click) the notification-area icon:

- **Audio visualizer: Ready / Connected** — current Firefox connection status
- **Open NTU Schedule** — opens the schedule in your default browser
- **Copy pairing key** — copies the persistent 32-character key to the clipboard
- **Start with Windows** — checked by default; toggle it to enable or disable logon startup. Your choice persists when the app is opened manually again
- **Exit NTU Scope** — stops audio capture and closes the companion until you launch it again or the next sign-in (if startup is enabled)

Windows may initially place the icon behind the **^** hidden-icons arrow. Windows Task Manager will show `NTUScope.exe` under background processes; that is expected.

## Updating

Exit NTUScope from its tray menu, then run a freshly downloaded executable. It updates the installed copy in `%LOCALAPPDATA%\NTUScope` and launches it with your old pairing key and startup preference. Do not delete the pairing-key file when upgrading.

## Uninstalling

1. From the tray menu, uncheck **Start with Windows** and select **Exit NTU Scope**.
2. Delete the folder `%LOCALAPPDATA%\NTUScope` (this also deletes the pairing key).
3. Optionally click **DISCONNECT** in the schedule's AUX dialog to clear the remembered key in Firefox.

The app stores its startup preference at `HKCU\Software\NTUScope\StartWithWindows` and the launch entry at `HKCU\Software\Microsoft\Windows\CurrentVersion\Run\NTUScope`. Neither uses administrator rights.

## Building and validation

With CMake and Visual Studio C++ desktop tools installed:

```powershell
cmake -S companion/NTUScope -B build/ntu-scope -G "Visual Studio 17 2022" -A x64
cmake --build build/ntu-scope --config Release
Start-Process -FilePath .\build\ntu-scope\Release\NTUScope.exe -ArgumentList "--self-test" -Wait -PassThru
```

GitHub Actions detects the runner's Visual Studio version, compiles a statically linked **Windows GUI-subsystem** executable (no console), checks handshake/authorization/frame self-tests, checks the PE subsystem, and rejects any binary 5 MiB or larger.

**Limits:** Startup occurs at user sign-in, not before login. Default playback output is selected when the helper starts; restart it after switching audio outputs. Some DRM-protected or exclusive-mode audio cannot be captured. Actual speaker/headphone playback and tray behavior still need verification on the user's Windows installation, beyond automated Windows build and protocol tests.

This native companion update does **not** modify Eren's schedule HTML, Begüm's schedule, Hatchable or the Firefox AUX protocol.
