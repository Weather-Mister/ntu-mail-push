// NTU Scope: native Windows WASAPI loopback -> authenticated local WebSocket.
// No .NET, web server framework, microphone, audio recording or outbound network access.
#define UNICODE
#define _UNICODE
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#define _WIN32_WINNT 0x0A00
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <mmreg.h>
#include <wrl/client.h>
#include <shlobj.h>
#include <shellapi.h>
#include <bcrypt.h>
#include <wincrypt.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <future>
#include <iomanip>
#include <iostream>
#include <mutex>
#include <sstream>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>
#include <utility>

#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "uuid.lib")
#pragma comment(lib, "ws2_32.lib")
#pragma comment(lib, "bcrypt.lib")
#pragma comment(lib, "crypt32.lib")
#pragma comment(lib, "shell32.lib")

using Microsoft::WRL::ComPtr;
namespace fs = std::filesystem;
constexpr std::uint16_t kPort = 43187;
constexpr size_t kBins = 64;
constexpr char kOrigin[] = "https://weather-mister.github.io";
constexpr char kWsGuid[] = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
constexpr char kDemo[] = "https://weather-mister.github.io/ntu-mail-push/skeuo-demo.html";
constexpr wchar_t kDemoWide[] = L"https://weather-mister.github.io/ntu-mail-push/skeuo-demo.html";
constexpr wchar_t kStartupRun[] = L"Software\\Microsoft\\Windows\\CurrentVersion\\Run";
constexpr wchar_t kPreferenceRoot[] = L"Software\\NTUScope";
constexpr wchar_t kStartupValue[] = L"NTUScope";
constexpr UINT kTrayMessage = WM_APP + 21;
constexpr UINT kNetworkStatusMessage = WM_APP + 22;
constexpr UINT_PTR kTrayId = 42;
constexpr UINT kMenuOpen = 101;
constexpr UINT kMenuCopy = 102;
constexpr UINT kMenuStartup = 103;
constexpr UINT kMenuExit = 104;
static std::atomic<bool> gRunning{true};
static std::atomic<bool> gConnected{false};
static HWND gWindow = nullptr;
static HICON gIcon = nullptr;
static std::string gPairingKey;
static std::wstring gInstalledPath;
static UINT gTaskbarCreated = 0;

struct Frame {
    std::array<float, kBins> bins{};
    float rms = 0;
    float pitch = 0;
    ULONGLONG timestamp = 0;
};
static float Clamp(float n) {
    return std::isfinite(n) ? std::clamp(n, 0.0f, 1.0f) : 0.0f;
}
static std::string Trim(std::string s) {
    auto start = s.find_first_not_of(" \t\r\n");
    if (start == std::string::npos) return "";
    auto end = s.find_last_not_of(" \t\r\n");
    return s.substr(start, end - start + 1);
}
static std::string Lower(std::string s) {
    for (char& c : s) if (c >= 'A' && c <= 'Z') c = static_cast<char>(c + 32);
    return s;
}
static bool ValidKey(const std::string& s) {
    if (s.size() != 32) return false;
    for (char c : s) if (!((c >= '0' && c <= '9') ||
                            (c >= 'A' && c <= 'F') || (c >= 'a' && c <= 'f'))) return false;
    return true;
}
static bool ConstantTimeEqual(const std::string& a, const std::string& b) {
    if (a.size() != 32 || b.size() != 32) return false;
    unsigned int difference = 0;
    for (size_t i = 0; i < 32; ++i)
        difference |= static_cast<unsigned char>(a[i] ^ b[i]);
    return difference == 0;
}
static std::string Upper(std::string s) {
    for (char& c : s) if (c >= 'a' && c <= 'f') c = static_cast<char>(c - 32);
    return s;
}

static std::string PairingKey() {
    PWSTR local = nullptr;
    if (FAILED(SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, nullptr, &local)))
        throw std::runtime_error("Windows LocalAppData directory is unavailable.");
    fs::path folder(local);
    CoTaskMemFree(local);
    folder /= L"NTUScope";
    fs::create_directories(folder);
    const auto path = folder / L"pairing-key.txt";
    std::string key;
    {
        std::ifstream input(path, std::ios::binary);
        if (input) std::getline(input, key);
    }
    key = Upper(Trim(key));
    if (!ValidKey(key)) {
        std::array<UCHAR, 16> random{};
        if (!BCRYPT_SUCCESS(BCryptGenRandom(nullptr, random.data(),
            static_cast<ULONG>(random.size()), BCRYPT_USE_SYSTEM_PREFERRED_RNG)))
            throw std::runtime_error("Could not securely generate a pairing key.");
        static constexpr char hex[] = "0123456789ABCDEF";
        key.clear();
        for (UCHAR n : random) {
            key += hex[n >> 4];
            key += hex[n & 0x0f];
        }
        std::ofstream output(path, std::ios::binary | std::ios::trunc);
        if (!output || !(output << key << '\n'))
            throw std::runtime_error("Could not save the pairing key.");
    }
    return key;
}


static std::wstring CurrentExePath() {
    std::vector<wchar_t> characters(MAX_PATH);
    for (;;) {
        const DWORD count = GetModuleFileNameW(nullptr, characters.data(),
            static_cast<DWORD>(characters.size()));
        if (!count) throw std::runtime_error("Cannot locate NTUScope.exe.");
        if (count < characters.size() - 1)
            return std::wstring(characters.data(), count);
        if (characters.size() > 32768)
            throw std::runtime_error("Executable path is too long.");
        characters.resize(characters.size() * 2);
    }
}
static std::wstring InstalledExePath() {
    PWSTR local = nullptr;
    if (FAILED(SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, nullptr, &local)))
        throw std::runtime_error("Cannot locate LocalAppData.");
    const fs::path folder(local);
    CoTaskMemFree(local);
    const fs::path appFolder = folder / L"NTUScope";
    fs::create_directories(appFolder);
    return (appFolder / L"NTUScope.exe").wstring();
}
static bool EnsureInstalled() {
    gInstalledPath = InstalledExePath();
    const auto current = CurrentExePath();
    if (_wcsicmp(current.c_str(), gInstalledPath.c_str()) == 0)
        return false;
    // Install into a stable per-user folder. Startup must never point to a
    // disposable GitHub ZIP extraction or Downloads folder.
    fs::copy_file(current, gInstalledPath, fs::copy_options::overwrite_existing);
    const auto launched = reinterpret_cast<INT_PTR>(ShellExecuteW(
        nullptr, L"open", gInstalledPath.c_str(), nullptr, nullptr, SW_SHOWNORMAL));
    if (launched <= 32)
        throw std::runtime_error("Could not launch installed NTUScope.exe.");
    return true;
}
static bool StartupPreference() {
    DWORD value = 1;
    DWORD bytes = sizeof(value);
    const LSTATUS result = RegGetValueW(HKEY_CURRENT_USER, kPreferenceRoot,
        L"StartWithWindows", RRF_RT_REG_DWORD, nullptr, &value, &bytes);
    return result == ERROR_SUCCESS ? value != 0 : true;
}
static bool SetStartup(bool enabled, bool persistPreference) {
    HKEY run = nullptr;
    if (RegCreateKeyExW(HKEY_CURRENT_USER, kStartupRun, 0, nullptr, 0,
        KEY_SET_VALUE, nullptr, &run, nullptr) != ERROR_SUCCESS)
        return false;
    LSTATUS status;
    if (enabled) {
        const auto command = L"\"" + gInstalledPath + L"\"";
        status = RegSetValueExW(run, kStartupValue, 0, REG_SZ,
            reinterpret_cast<const BYTE*>(command.c_str()),
            static_cast<DWORD>((command.size() + 1) * sizeof(wchar_t)));
    } else {
        status = RegDeleteValueW(run, kStartupValue);
        if (status == ERROR_FILE_NOT_FOUND) status = ERROR_SUCCESS;
    }
    RegCloseKey(run);
    if (status != ERROR_SUCCESS) return false;
    if (!persistPreference) return true;
    HKEY preferences = nullptr;
    if (RegCreateKeyExW(HKEY_CURRENT_USER, kPreferenceRoot, 0, nullptr, 0,
        KEY_SET_VALUE, nullptr, &preferences, nullptr) != ERROR_SUCCESS)
        return false;
    const DWORD value = enabled ? 1 : 0;
    status = RegSetValueExW(preferences, L"StartWithWindows", 0, REG_DWORD,
        reinterpret_cast<const BYTE*>(&value), sizeof(value));
    RegCloseKey(preferences);
    return status == ERROR_SUCCESS;
}
static bool StartupEntryExists() {
    wchar_t command[32768] = {};
    DWORD bytes = sizeof(command);
    if (RegGetValueW(HKEY_CURRENT_USER, kStartupRun, kStartupValue,
        RRF_RT_REG_SZ, nullptr, command, &bytes) != ERROR_SUCCESS)
        return false;
    return std::wstring(command) == L"\"" + gInstalledPath + L"\"";
}
static bool CopyPairingKey(HWND hwnd) {
    std::wstring text(gPairingKey.begin(), gPairingKey.end());
    HGLOBAL memory = GlobalAlloc(GMEM_MOVEABLE, (text.size() + 1) * sizeof(wchar_t));
    if (!memory) return false;
    void* contents = GlobalLock(memory);
    if (!contents) {
        GlobalFree(memory);
        return false;
    }
    std::memcpy(contents, text.c_str(), (text.size() + 1) * sizeof(wchar_t));
    GlobalUnlock(memory);
    if (!OpenClipboard(hwnd)) {
        GlobalFree(memory);
        return false;
    }
    EmptyClipboard();
    if (!SetClipboardData(CF_UNICODETEXT, memory)) {
        CloseClipboard();
        GlobalFree(memory);
        return false;
    }
    CloseClipboard();  // Windows now owns the allocation.
    return true;
}
// Draw a tiny 32px phosphor-wave icon without shipping external art/assets.
static HICON CreateScopeIcon() {
    BITMAPV5HEADER header{};
    header.bV5Size = sizeof(header);
    header.bV5Width = 32;
    header.bV5Height = -32;
    header.bV5Planes = 1;
    header.bV5BitCount = 32;
    header.bV5Compression = BI_BITFIELDS;
    header.bV5RedMask = 0x00ff0000;
    header.bV5GreenMask = 0x0000ff00;
    header.bV5BlueMask = 0x000000ff;
    header.bV5AlphaMask = 0xff000000;
    void* pixels = nullptr;
    HDC dc = GetDC(nullptr);
    HBITMAP color = CreateDIBSection(dc, reinterpret_cast<BITMAPINFO*>(&header),
        DIB_RGB_COLORS, &pixels, nullptr, 0);
    ReleaseDC(nullptr, dc);
    if (!color || !pixels) {
        if (color) DeleteObject(color);
        return nullptr;
    }
    auto* bitmap = reinterpret_cast<DWORD*>(pixels);
    for (int y = 0; y < 32; ++y) {
        for (int x = 0; x < 32; ++x) {
            const int dx = std::max(0, std::abs(x - 15) - 10);
            const int dy = std::max(0, std::abs(y - 15) - 10);
            if (dx * dx + dy * dy > 36) continue;
            const bool frame = x == 3 || x == 28 || y == 3 || y == 28;
            bitmap[y * 32 + x] = frame ? 0xff4c926e : 0xff19352d;
            if (x >= 5 && x <= 26) {
                const float wave = std::sin((x - 5) * 0.57f);
                const int target = 16 - static_cast<int>(std::round(wave * 7));
                if (std::abs(y - target) <= 1)
                    bitmap[y * 32 + x] = 0xff9fe4a5;
            }
        }
    }
    HBITMAP mask = CreateBitmap(32, 32, 1, 1, nullptr);
    ICONINFO info{};
    info.fIcon = TRUE;
    info.hbmColor = color;
    info.hbmMask = mask;
    HICON icon = CreateIconIndirect(&info);
    DeleteObject(color);
    DeleteObject(mask);
    return icon;
}
static void AddOrUpdateTrayIcon(DWORD operation = NIM_ADD) {
    if (!gWindow) return;
    NOTIFYICONDATAW data{};
    data.cbSize = sizeof(data);
    data.hWnd = gWindow;
    data.uID = static_cast<UINT>(kTrayId);
    data.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP;
    data.uCallbackMessage = kTrayMessage;
    data.hIcon = gIcon ? gIcon : LoadIconW(nullptr, IDI_APPLICATION);
    const wchar_t* status = gConnected.load()
        ? L"NTU Scope - Firefox connected"
        : L"NTU Scope - running quietly";
    wcscpy_s(data.szTip, status);
    Shell_NotifyIconW(operation, &data);
}
static void RemoveTrayIcon() {
    NOTIFYICONDATAW data{};
    data.cbSize = sizeof(data);
    data.hWnd = gWindow;
    data.uID = static_cast<UINT>(kTrayId);
    Shell_NotifyIconW(NIM_DELETE, &data);
}
static void ShowTrayMenu(HWND hwnd) {
    HMENU menu = CreatePopupMenu();
    if (!menu) return;
    AppendMenuW(menu, MF_STRING | MF_DISABLED, 0,
        gConnected.load() ? L"Audio visualizer: Connected" : L"Audio visualizer: Ready");
    AppendMenuW(menu, MF_SEPARATOR, 0, nullptr);
    AppendMenuW(menu, MF_STRING, kMenuOpen, L"Open NTU Schedule");
    AppendMenuW(menu, MF_STRING, kMenuCopy, L"Copy pairing key");
    AppendMenuW(menu, MF_SEPARATOR, 0, nullptr);
    AppendMenuW(menu, MF_STRING | (StartupEntryExists() ? MF_CHECKED : 0),
        kMenuStartup, L"Start with Windows");
    AppendMenuW(menu, MF_STRING, kMenuExit, L"Exit NTU Scope");
    POINT point{};
    GetCursorPos(&point);
    SetForegroundWindow(hwnd);
    TrackPopupMenu(menu, TPM_RIGHTBUTTON | TPM_BOTTOMALIGN | TPM_LEFTALIGN,
        point.x, point.y, 0, hwnd, nullptr);
    PostMessageW(hwnd, WM_NULL, 0, 0);
    DestroyMenu(menu);
}
static LRESULT CALLBACK TrayWindowProc(HWND hwnd, UINT message, WPARAM wp, LPARAM lp) {
    if (gTaskbarCreated && message == gTaskbarCreated) {
        AddOrUpdateTrayIcon();
        return 0;
    }
    switch (message) {
    case kTrayMessage:
        if (lp == WM_RBUTTONUP || lp == WM_LBUTTONUP ||
            lp == WM_CONTEXTMENU) ShowTrayMenu(hwnd);
        return 0;
    case kNetworkStatusMessage:
        AddOrUpdateTrayIcon(NIM_MODIFY);
        return 0;
    case WM_COMMAND:
        switch (LOWORD(wp)) {
        case kMenuOpen:
            ShellExecuteW(nullptr, L"open", kDemoWide, nullptr, nullptr, SW_SHOWNORMAL);
            break;
        case kMenuCopy:
            if (!CopyPairingKey(hwnd))
                MessageBoxW(hwnd, L"Unable to copy the pairing key.", L"NTU Scope", MB_ICONERROR);
            break;
        case kMenuStartup:
            if (!SetStartup(!StartupEntryExists(), true))
                MessageBoxW(hwnd, L"Could not change Windows startup settings.",
                    L"NTU Scope", MB_ICONERROR);
            break;
        case kMenuExit:
            DestroyWindow(hwnd);
            break;
        }
        return 0;
    case WM_DESTROY:
        gRunning.store(false);
        RemoveTrayIcon();
        PostQuitMessage(0);
        return 0;
    default:
        return DefWindowProcW(hwnd, message, wp, lp);
    }
}
static HWND MakeTrayWindow(HINSTANCE instance) {
    WNDCLASSW cls{};
    cls.lpfnWndProc = TrayWindowProc;
    cls.hInstance = instance;
    cls.lpszClassName = L"NTUScopeTrayHidden";
    if (!RegisterClassW(&cls) && GetLastError() != ERROR_CLASS_ALREADY_EXISTS)
        return nullptr;
    return CreateWindowExW(WS_EX_TOOLWINDOW, cls.lpszClassName, L"NTUScope",
        WS_OVERLAPPED, 0, 0, 0, 0, nullptr, nullptr, instance, nullptr);
}

class LoopbackMeter {
public:
    bool Start() {
        std::promise<bool> ready;
        auto result = ready.get_future();
        running_.store(true);
        worker_ = std::thread([this, ready = std::move(ready)]() mutable {
            Run(std::move(ready));
        });
        return result.get();
    }
    Frame Latest() {
        std::lock_guard<std::mutex> lock(mutex_);
        Frame copy = current_;
        if (GetTickCount64() - copy.timestamp > 200) return {};
        return copy;
    }
    ~LoopbackMeter() {
        running_.store(false);
        if (worker_.joinable()) worker_.join();
    }
private:
    std::atomic<bool> running_{false};
    std::thread worker_;
    std::mutex mutex_;
    Frame current_;

    void Process(const BYTE* data, UINT32 frames, const WAVEFORMATEX* fmt, bool silent) {
        Frame value;
        value.timestamp = GetTickCount64();
        if (!frames || silent) {
            std::lock_guard<std::mutex> lock(mutex_);
            current_ = value;
            return;
        }
        const unsigned int channels = fmt->nChannels;
        const unsigned int bits = fmt->wBitsPerSample;
        const unsigned int bytes = bits / 8;
        const unsigned int stride = fmt->nBlockAlign;
        WORD codec = fmt->wFormatTag;
        if (codec == WAVE_FORMAT_EXTENSIBLE &&
            fmt->cbSize >= sizeof(WAVEFORMATEXTENSIBLE) - sizeof(WAVEFORMATEX)) {
            auto ext = reinterpret_cast<const WAVEFORMATEXTENSIBLE*>(fmt);
            // Both PCM and IEEE float share the standard wave subtype GUID suffix.
            codec = static_cast<WORD>(ext->SubFormat.Data1);
        }
        const bool floating = codec == WAVE_FORMAT_IEEE_FLOAT && bits == 32;
        const bool pcm = codec == WAVE_FORMAT_PCM &&
            (bits == 16 || bits == 24 || bits == 32);
        if ((!floating && !pcm) || channels == 0 || bytes * channels > stride)
            return;  // Unsupported mix format; never interpret compressed bytes as PCM.

        std::array<double, kBins> squared{};
        std::array<unsigned int, kBins> counts{};
        double total = 0;
        float previous = 0;
        int crossings = 0;
        for (UINT32 i = 0; i < frames; ++i) {
            double mono = 0;
            for (unsigned int ch = 0; ch < channels; ++ch) {
                const BYTE* ptr = data + static_cast<size_t>(i) * stride + ch * bytes;
                double sample = 0;
                if (floating) {
                    float n;
                    std::memcpy(&n, ptr, sizeof(n));
                    if (std::isfinite(n)) sample = std::clamp(static_cast<double>(n), -1.0, 1.0);
                } else if (bits == 16) {
                    std::int16_t n;
                    std::memcpy(&n, ptr, sizeof(n));
                    sample = n / 32768.0;
                } else if (bits == 24) {
                    std::int32_t n = ptr[0] | (ptr[1] << 8) | (ptr[2] << 16);
                    if (n & 0x800000) n |= static_cast<std::int32_t>(0xff000000u);
                    sample = n / 8388608.0;
                } else {
                    std::int32_t n;
                    std::memcpy(&n, ptr, sizeof(n));
                    sample = n / 2147483648.0;
                }
                mono += sample;
            }
            const float sample = static_cast<float>(mono / channels);
            const double sq = static_cast<double>(sample) * sample;
            const size_t b = static_cast<size_t>(i) * kBins / frames;
            squared[b] += sq;
            ++counts[b];
            total += sq;
            if (i && ((sample >= 0) != (previous >= 0))) ++crossings;
            previous = sample;
        }
        for (size_t b = 0; b < kBins; ++b) {
            const float root = counts[b]
                ? static_cast<float>(std::sqrt(squared[b] / counts[b])) : 0;
            value.bins[b] = Clamp(std::sqrt(root) * 2.2f);
        }
        const float rms = static_cast<float>(std::sqrt(total / frames));
        value.rms = Clamp(std::sqrt(rms) * 2.2f);
        const float frequency = crossings * static_cast<float>(fmt->nSamplesPerSec) / (2 * frames);
        value.pitch = Clamp((frequency - 80) / 1100);
        std::lock_guard<std::mutex> lock(mutex_);
        current_ = value;
    }

    void Run(std::promise<bool> ready) {
        bool signalled = false;
        auto signal = [&](bool ok) {
            if (!signalled) { ready.set_value(ok); signalled = true; }
        };
        const HRESULT initialized = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
        if (FAILED(initialized)) { signal(false); return; }
        {
            ComPtr<IMMDeviceEnumerator> enumerator;
            ComPtr<IMMDevice> device;
            ComPtr<IAudioClient> client;
            ComPtr<IAudioCaptureClient> capture;
            WAVEFORMATEX* raw = nullptr;
            HRESULT hr = CoCreateInstance(__uuidof(MMDeviceEnumerator),
                nullptr, CLSCTX_ALL, IID_PPV_ARGS(enumerator.GetAddressOf()));
            if (SUCCEEDED(hr)) hr = enumerator->GetDefaultAudioEndpoint(
                eRender, eConsole, device.GetAddressOf());
            if (SUCCEEDED(hr)) hr = device->Activate(__uuidof(IAudioClient),
                CLSCTX_ALL, nullptr, reinterpret_cast<void**>(client.GetAddressOf()));
            if (SUCCEEDED(hr)) hr = client->GetMixFormat(&raw);
            if (SUCCEEDED(hr)) hr = client->Initialize(AUDCLNT_SHAREMODE_SHARED,
                AUDCLNT_STREAMFLAGS_LOOPBACK, 0, 0, raw, nullptr);
            if (SUCCEEDED(hr)) hr = client->GetService(IID_PPV_ARGS(capture.GetAddressOf()));
            if (SUCCEEDED(hr)) hr = client->Start();
            if (FAILED(hr)) {
                std::cerr << "WASAPI initialization failed (HRESULT 0x"
                          << std::hex << static_cast<unsigned long>(hr)
                          << std::dec << "). Check the default audio output.\n";
                if (raw) CoTaskMemFree(raw);
                signal(false);
            } else {
                signal(true);
                while (running_.load()) {
                    Sleep(10);
                    UINT32 packets = 0;
                    hr = capture->GetNextPacketSize(&packets);
                    if (FAILED(hr)) break;
                    while (packets > 0 && running_.load()) {
                        BYTE* data = nullptr;
                        UINT32 frames = 0;
                        DWORD flags = 0;
                        hr = capture->GetBuffer(&data, &frames, &flags, nullptr, nullptr);
                        if (FAILED(hr)) break;
                        Process(data, frames, raw, (flags & AUDCLNT_BUFFERFLAGS_SILENT) != 0);
                        hr = capture->ReleaseBuffer(frames);
                        if (FAILED(hr)) break;
                        hr = capture->GetNextPacketSize(&packets);
                        if (FAILED(hr)) break;
                    }
                    if (FAILED(hr)) break;
                }
                client->Stop();
                if (FAILED(hr))
                    std::cerr << "Audio device disconnected. Restart after changing output devices.\n";
                if (raw) CoTaskMemFree(raw);
            }
        }
        CoUninitialize();
    }
};

static bool SendAll(SOCKET socket, const char* data, size_t size) {
    while (size) {
        int count = send(socket, data,
            static_cast<int>(std::min<size_t>(size, 16 * 1024)), 0);
        if (count <= 0) return false;
        data += count;
        size -= count;
    }
    return true;
}
static std::string Header(const std::string& request, const std::string& name) {
    size_t offset = request.find("\r\n");
    if (offset == std::string::npos) return "";
    offset += 2;
    while (offset < request.size()) {
        const size_t end = request.find("\r\n", offset);
        if (end == std::string::npos || end == offset) break;
        const auto colon = request.find(':', offset);
        if (colon != std::string::npos && colon < end &&
            Lower(request.substr(offset, colon - offset)) == name)
            return Trim(request.substr(colon + 1, end - colon - 1));
        offset = end + 2;
    }
    return "";
}
static bool Authorized(const std::string& request, const std::string& key) {
    const size_t eol = request.find("\r\n");
    if (eol == std::string::npos) return false;
    const std::string first = request.substr(0, eol);
    const std::string prefix = "GET /stream?key=";
    const std::string suffix = " HTTP/1.1";
    if (first.size() != prefix.size() + 32 + suffix.size() ||
        first.compare(0, prefix.size(), prefix) != 0 ||
        first.compare(first.size() - suffix.size(), suffix.size(), suffix) != 0)
        return false;
    const std::string supplied = Upper(first.substr(prefix.size(), 32));
    return ValidKey(supplied) && ConstantTimeEqual(supplied, key) &&
        Header(request, "origin") == kOrigin &&
        Lower(Header(request, "upgrade")) == "websocket" &&
        Lower(Header(request, "connection")).find("upgrade") != std::string::npos &&
        Header(request, "sec-websocket-version") == "13" &&
        Header(request, "sec-websocket-key").size() == 24;
}
static std::string WebSocketAccept(const std::string& clientKey) {
    const std::string material = clientKey + kWsGuid;
    std::array<UCHAR, 20> hash{};
    BCRYPT_ALG_HANDLE algorithm = nullptr;
    if (!BCRYPT_SUCCESS(BCryptOpenAlgorithmProvider(
        &algorithm, BCRYPT_SHA1_ALGORITHM, nullptr, 0)))
        return "";
    const NTSTATUS status = BCryptHash(algorithm, nullptr, 0,
        reinterpret_cast<PUCHAR>(const_cast<char*>(material.data())),
        static_cast<ULONG>(material.size()), hash.data(),
        static_cast<ULONG>(hash.size()));
    BCryptCloseAlgorithmProvider(algorithm, 0);
    if (!BCRYPT_SUCCESS(status)) return "";
    DWORD needed = 0;
    if (!CryptBinaryToStringA(hash.data(), static_cast<DWORD>(hash.size()),
        CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF, nullptr, &needed)) return "";
    std::string encoded(needed, '\0');
    if (!CryptBinaryToStringA(hash.data(), static_cast<DWORD>(hash.size()),
        CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF, encoded.data(), &needed)) return "";
    while (!encoded.empty() && encoded.back() == '\0') encoded.pop_back();
    return encoded;
}
static bool Handshake(SOCKET client, const std::string& secret) {
    std::string request;
    request.reserve(2048);
    char chunk[1024];
    while (request.size() < 8192 && request.find("\r\n\r\n") == std::string::npos) {
        const int got = recv(client, chunk, static_cast<int>(sizeof(chunk)), 0);
        if (got <= 0) return false;
        request.append(chunk, static_cast<size_t>(got));
    }
    if (request.find("\r\n\r\n") == std::string::npos || !Authorized(request, secret)) {
        constexpr char forbidden[] = "HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n";
        SendAll(client, forbidden, sizeof(forbidden) - 1);
        return false;
    }
    const std::string accept = WebSocketAccept(Header(request, "sec-websocket-key"));
    if (accept.empty()) return false;
    const std::string response =
        "HTTP/1.1 101 Switching Protocols\r\n"
        "Upgrade: websocket\r\nConnection: Upgrade\r\n"
        "Sec-WebSocket-Accept: " + accept + "\r\n\r\n";
    return SendAll(client, response.data(), response.size());
}
static std::string JsonFrame(const Frame& frame) {
    std::ostringstream stream;
    stream << std::fixed << std::setprecision(3)
           << "{\"type\":\"levels\",\"version\":1,\"rms\":" << Clamp(frame.rms)
           << ",\"pitch\":" << Clamp(frame.pitch) << ",\"bins\":[";
    for (size_t i = 0; i < frame.bins.size(); ++i) {
        if (i) stream << ',';
        stream << Clamp(frame.bins[i]);
    }
    stream << "]}";
    return stream.str();
}
static bool SendFrame(SOCKET socket, const std::string& payload) {
    // RFC 6455 server frames must NOT be masked.
    if (payload.size() >= 65536) return false;
    const auto size = static_cast<std::uint16_t>(payload.size());
    const std::array<char, 4> head{
        static_cast<char>(0x81), static_cast<char>(126),
        static_cast<char>((size >> 8) & 0xff), static_cast<char>(size & 0xff)
    };
    return SendAll(socket, head.data(), head.size()) &&
        SendAll(socket, payload.data(), payload.size());
}
// Browsers send a masked WebSocket CLOSE frame; if it isn't read, a single-client
// helper can block a new connection until the browser's close timeout. Handle
// CLOSE promptly, and respond to optional PING control frames.
static bool ContinueClient(SOCKET socket) {
    fd_set reads{};
    FD_ZERO(&reads);
    FD_SET(socket, &reads);
    timeval immediate{0, 0};
    const int selected = select(0, &reads, nullptr, nullptr, &immediate);
    if (selected == 0) return true;
    if (selected == SOCKET_ERROR) return false;

    std::array<unsigned char, 256> peek{};
    const int available = recv(socket, reinterpret_cast<char*>(peek.data()),
        static_cast<int>(peek.size()), MSG_PEEK);
    if (available <= 0) return false;
    if (available < 2) return true;  // Header still arriving.
    const unsigned int opcode = peek[0] & 0x0f;
    const bool mask = (peek[1] & 0x80) != 0;
    const size_t count = peek[1] & 0x7f;
    if ((peek[0] & 0x70) || !mask || count > 125) return false;
    const size_t size = 6 + count;
    if (static_cast<size_t>(available) < size) return true;

    std::array<unsigned char, 256> data{};
    const int received = recv(socket, reinterpret_cast<char*>(data.data()),
        static_cast<int>(size), 0);
    if (received != static_cast<int>(size)) return false;
    if (opcode == 8) {
        const std::array<char, 2> reply{static_cast<char>(0x88), 0};
        SendAll(socket, reply.data(), reply.size());
        return false;
    }
    if (opcode == 9) {
        std::array<char, 127> reply{};
        reply[0] = static_cast<char>(0x8a);
        reply[1] = static_cast<char>(count);
        for (size_t i = 0; i < count; ++i)
            reply[i + 2] = static_cast<char>(
                data[i + 6] ^ data[2 + i % 4]);
        return SendAll(socket, reply.data(), count + 2);
    }
    // A visualizer connection accepts no application uploads from the browser.
    return false;
}
static int SelfTest() {
    const std::string expected = "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=";
    const std::string challenge = "dGhlIHNhbXBsZSBub25jZQ==";
    const std::string secret = "0123456789ABCDEF0123456789ABCDEF";
    auto handshake = [&](const std::string& origin, const std::string& token) {
        return "GET /stream?key=" + token + " HTTP/1.1\r\n"
            "Host: 127.0.0.1:43187\r\n"
            "Origin: " + origin + "\r\nUpgrade: websocket\r\n"
            "Connection: keep-alive, Upgrade\r\nSec-WebSocket-Version: 13\r\n"
            "Sec-WebSocket-Key: " + challenge + "\r\n\r\n";
    };
    const std::string frame = JsonFrame(Frame{});
    const bool ok = WebSocketAccept(challenge) == expected &&
        Authorized(handshake(kOrigin, secret), secret) &&
        !Authorized(handshake("https://example.com", secret), secret) &&
        !Authorized(handshake(kOrigin, "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"), secret) &&
        !Authorized(handshake(kOrigin, secret + "BAD"), secret) &&
        frame.find("\"version\":1") != std::string::npos &&
        frame.find("\"bins\":[") != std::string::npos &&
        std::count(frame.begin(), frame.end(), ',') == 67;
    std::cout << (ok ? "Native self-test: PASS\n" : "Native self-test: FAIL\n");
    return ok ? 0 : 1;
}

static void ServeAudio(SOCKET listener, LoopbackMeter& meter, const std::string& secret) {
    while (gRunning.load()) {
        fd_set set{};
        FD_ZERO(&set);
        FD_SET(listener, &set);
        timeval interval{0, 200000};
        const int ready = select(0, &set, nullptr, nullptr, &interval);
        if (ready == SOCKET_ERROR) break;
        if (ready == 0) continue;
        SOCKET client = accept(listener, nullptr, nullptr);
        if (client == INVALID_SOCKET) continue;
        constexpr DWORD timeoutMs = 2500;
        setsockopt(client, SOL_SOCKET, SO_RCVTIMEO,
            reinterpret_cast<const char*>(&timeoutMs), sizeof(timeoutMs));
        setsockopt(client, SOL_SOCKET, SO_SNDTIMEO,
            reinterpret_cast<const char*>(&timeoutMs), sizeof(timeoutMs));
        if (Handshake(client, secret)) {
            gConnected.store(true);
            PostMessageW(gWindow, kNetworkStatusMessage, 0, 0);
            while (gRunning.load() && ContinueClient(client)) {
                if (!SendFrame(client, JsonFrame(meter.Latest()))) break;
                std::this_thread::sleep_for(std::chrono::milliseconds(50));
            }
            gConnected.store(false);
            PostMessageW(gWindow, kNetworkStatusMessage, 0, 0);
        }
        shutdown(client, SD_BOTH);
        closesocket(client);
    }
    if (gRunning.load())
        PostMessageW(gWindow, WM_CLOSE, 0, 0);
}
int WINAPI wWinMain(HINSTANCE instance, HINSTANCE, PWSTR, int) {
    int argc = 0;
    LPWSTR* argv = CommandLineToArgvW(GetCommandLineW(), &argc);
    const bool selfTest = argc == 2 && wcscmp(argv[1], L"--self-test") == 0;
    const bool versionCheck = argc == 2 && wcscmp(argv[1], L"--version") == 0;
    if (argv) LocalFree(argv);
    if (selfTest) return SelfTest();
    if (versionCheck) return 0;

    try {
        if (EnsureInstalled()) return 0;
        gPairingKey = PairingKey();
    } catch (const std::exception&) {
        MessageBoxW(nullptr,
            L"NTU Scope could not install to your local AppData directory.\n"
            L"Close any older NTUScope instance, then try again.",
            L"NTU Scope - Installation", MB_OK | MB_ICONERROR);
        return 1;
    }

    HANDLE singleton = CreateMutexW(nullptr, TRUE, L"Local\\NTUScopeNativeSingleton");
    if (!singleton) return 1;
    if (GetLastError() == ERROR_ALREADY_EXISTS) {
        CloseHandle(singleton);
        return 0;
    }

    gTaskbarCreated = RegisterWindowMessageW(L"TaskbarCreated");
    gWindow = MakeTrayWindow(instance);
    if (!gWindow) {
        CloseHandle(singleton);
        return 1;
    }
    gIcon = CreateScopeIcon();
    AddOrUpdateTrayIcon();
    // Persist the user's startup choice. On first launch it defaults to on;
    // manually launching after opting out will NOT switch it back on.
    if (!SetStartup(StartupPreference(), true))
        MessageBoxW(gWindow,
            L"NTU Scope started but Windows autostart could not be configured.\n"
            L"You can try enabling it later from the tray icon.",
            L"NTU Scope", MB_OK | MB_ICONWARNING);

    WSADATA wsa{};
    if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) {
        MessageBoxW(gWindow, L"Windows networking initialization failed.",
            L"NTU Scope", MB_OK | MB_ICONERROR);
        DestroyWindow(gWindow);
        if (gIcon) DestroyIcon(gIcon);
        ReleaseMutex(singleton);
        CloseHandle(singleton);
        return 1;
    }
    SOCKET listener = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    sockaddr_in endpoint{};
    endpoint.sin_family = AF_INET;
    endpoint.sin_port = htons(kPort);
    endpoint.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    const BOOL exclusive = TRUE;
    if (listener == INVALID_SOCKET ||
        setsockopt(listener, SOL_SOCKET, SO_EXCLUSIVEADDRUSE,
            reinterpret_cast<const char*>(&exclusive), sizeof(exclusive)) == SOCKET_ERROR ||
        bind(listener, reinterpret_cast<sockaddr*>(&endpoint),
            sizeof(endpoint)) == SOCKET_ERROR ||
        listen(listener, SOMAXCONN) == SOCKET_ERROR) {
        MessageBoxW(gWindow,
            L"NTU Scope could not use localhost port 43187.\n"
            L"Close the previous NTUScope console/tray app, then relaunch.",
            L"NTU Scope - Already running?", MB_OK | MB_ICONERROR);
        if (listener != INVALID_SOCKET) closesocket(listener);
        WSACleanup();
        DestroyWindow(gWindow);
        if (gIcon) DestroyIcon(gIcon);
        ReleaseMutex(singleton);
        CloseHandle(singleton);
        return 1;
    }

    {
        LoopbackMeter meter;
        if (!meter.Start()) {
            MessageBoxW(gWindow,
                L"NTU Scope could not capture the default Windows audio output.\n"
                L"Check that speakers or headphones are connected, then restart.",
                L"NTU Scope - Audio device", MB_OK | MB_ICONERROR);
            closesocket(listener);
            WSACleanup();
            DestroyWindow(gWindow);
            if (gIcon) DestroyIcon(gIcon);
            ReleaseMutex(singleton);
            CloseHandle(singleton);
            return 1;
        }
        std::thread server([&]() { ServeAudio(listener, meter, gPairingKey); });
        MSG message{};
        while (GetMessageW(&message, nullptr, 0, 0) > 0) {
            TranslateMessage(&message);
            DispatchMessageW(&message);
        }
        gRunning.store(false);
        server.join();
    }

    closesocket(listener);
    WSACleanup();
    if (gIcon) DestroyIcon(gIcon);
    ReleaseMutex(singleton);
    CloseHandle(singleton);
    return 0;
}
