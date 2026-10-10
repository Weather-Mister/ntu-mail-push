using System.Net;
using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Text.Json;
using NAudio.Wave;

const int port = 43187;
const string allowedOrigin = "https://weather-mister.github.io";

var keyDirectory = Path.Combine(
    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "NTUScope");
Directory.CreateDirectory(keyDirectory);
var keyPath = Path.Combine(keyDirectory, "pairing-key.txt");
string pairingKey;
if (File.Exists(keyPath))
{
    pairingKey = File.ReadAllText(keyPath).Trim();
    if (pairingKey.Length != 32 || !pairingKey.All(Uri.IsHexDigit))
        pairingKey = Convert.ToHexString(RandomNumberGenerator.GetBytes(16));
}
else
{
    pairingKey = Convert.ToHexString(RandomNumberGenerator.GetBytes(16));
}
File.WriteAllText(keyPath, pairingKey);

Console.Title = "NTU Schedule - PC Audio Companion";
Console.WriteLine("NTU SCHEDULE / PC AUDIO");
Console.WriteLine("=======================");
Console.WriteLine("Captures the audio playing through your DEFAULT Windows output.");
Console.WriteLine("Only audio level/envelope measurements are sent to the site.");
Console.WriteLine("No audio file, recording, or internet upload is created.");
Console.WriteLine();
Console.WriteLine("1. Open https://weather-mister.github.io/ntu-mail-push/skeuo-demo.html");
Console.WriteLine("2. Click AUX next to the oscilloscope.");
Console.WriteLine("3. Paste this pairing key:");
Console.WriteLine();
Console.WriteLine("   " + pairingKey);
Console.WriteLine();
Console.WriteLine("This window must stay open. Press Ctrl+C or close it to stop.");
Console.WriteLine();

using var meter = new LoopbackMeter();
try
{
    meter.Start();
    Console.WriteLine("Audio capture: ACTIVE");
}
catch (Exception e)
{
    Console.Error.WriteLine("Cannot start Windows output capture: " + e.Message);
    Console.Error.WriteLine("Check your default output device, then restart the companion.");
    Environment.ExitCode = 1;
    return;
}

var builder = WebApplication.CreateBuilder(args);
builder.Logging.ClearProviders();
builder.WebHost.ConfigureKestrel(options =>
    options.Listen(IPAddress.Loopback, port));

var app = builder.Build();
app.UseWebSockets(new WebSocketOptions { KeepAliveInterval = TimeSpan.FromSeconds(15) });
app.Map("/stream", async (HttpContext context) =>
{
    // Localhost alone is not authorization: websites can also attempt localhost connections.
    // Restrict the requesting site AND compare a per-install random pairing secret.
    var origin = context.Request.Headers.Origin.ToString();
    var supplied = context.Request.Query["key"].ToString();
    var authorized = origin == allowedOrigin
        && supplied.Length == 32
        && CryptographicOperations.FixedTimeEquals(
            System.Text.Encoding.ASCII.GetBytes(supplied),
            System.Text.Encoding.ASCII.GetBytes(pairingKey));
    if (!authorized)
    {
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        return;
    }
    if (!context.WebSockets.IsWebSocketRequest)
    {
        context.Response.StatusCode = StatusCodes.Status400BadRequest;
        return;
    }

    using var socket = await context.WebSockets.AcceptWebSocketAsync();
    Console.WriteLine("Website connected: " + DateTime.Now.ToString("HH:mm:ss"));
    try
    {
        while (!context.RequestAborted.IsCancellationRequested
               && socket.State == WebSocketState.Open)
        {
            var frame = meter.ReadFrame();
            var message = JsonSerializer.SerializeToUtf8Bytes(new
            {
                type = "levels",
                version = 1,
                rms = frame.Rms,
                pitch = frame.Pitch,
                bins = frame.Bins
            });
            await socket.SendAsync(
                message.AsMemory(), WebSocketMessageType.Text, true,
                context.RequestAborted);
            await Task.Delay(50, context.RequestAborted);
        }
    }
    catch (OperationCanceledException) { }
    catch (WebSocketException) { }
    catch (IOException) { }
    finally
    {
        Console.WriteLine("Website disconnected: " + DateTime.Now.ToString("HH:mm:ss"));
    }
});

Console.CancelKeyPress += (_, e) =>
{
    e.Cancel = true;
    _ = app.StopAsync();
};
try
{
    await app.RunAsync();
}
catch (IOException e)
{
    Console.Error.WriteLine("Could not bind localhost port " + port + ": " + e.Message);
    Console.Error.WriteLine("Another copy of the companion may already be running.");
    Environment.ExitCode = 1;
}

sealed record MeterFrame(float Rms, float Pitch, float[] Bins, long Timestamp)
{
    public static readonly MeterFrame Silent = new(0, 0, new float[64], 0);
}

sealed class LoopbackMeter : IDisposable
{
    private WasapiLoopbackCapture? capture;
    private MeterFrame current = MeterFrame.Silent;
    private readonly Guid floatGuid = Guid.Parse("00000003-0000-0010-8000-00AA00389B71");

    public void Start()
    {
        capture = new WasapiLoopbackCapture();
        capture.DataAvailable += OnAudio;
        capture.StartRecording();
    }

    public MeterFrame ReadFrame()
    {
        var frame = Volatile.Read(ref current);
        // NAudio doesn't call DataAvailable during silence. Never freeze the last beat.
        return Environment.TickCount64 - frame.Timestamp < 200
            ? frame : MeterFrame.Silent;
    }

    private void OnAudio(object? sender, WaveInEventArgs args)
    {
        var format = capture?.WaveFormat;
        if (format is null || args.BytesRecorded <= 0) return;

        int bytes = (format.BitsPerSample + 7) / 8;
        int channels = format.Channels;
        int stride = bytes * channels;
        if (channels <= 0 || stride <= 0) return;
        int frames = args.BytesRecorded / stride;
        if (frames < 1) return;

        bool isFloat = format.Encoding == WaveFormatEncoding.IeeeFloat
            || (format is WaveFormatExtensible extended && extended.SubFormat == floatGuid);
        if (!isFloat && format.BitsPerSample is not (16 or 24 or 32)) return;
        if (isFloat && bytes != 4) return;

        const int binCount = 64;
        var sums = new double[binCount];
        var counts = new int[binCount];
        double total = 0;
        float previous = 0;
        int crossings = 0;

        for (int i = 0; i < frames; i++)
        {
            double mono = 0;
            for (int channel = 0; channel < channels; channel++)
            {
                int offset = i * stride + channel * bytes;
                double sample;
                if (isFloat)
                    sample = BitConverter.ToSingle(args.Buffer, offset);
                else if (bytes == 2)
                    sample = BitConverter.ToInt16(args.Buffer, offset) / 32768.0;
                else if (bytes == 3)
                {
                    int value = args.Buffer[offset] | (args.Buffer[offset + 1] << 8)
                        | (args.Buffer[offset + 2] << 16);
                    if ((value & 0x800000) != 0) value |= unchecked((int)0xFF000000);
                    sample = value / 8388608.0;
                }
                else
                    sample = BitConverter.ToInt32(args.Buffer, offset) / 2147483648.0;
                mono += double.IsFinite(sample) ? Math.Clamp(sample, -1, 1) : 0;
            }
            float value = (float)(mono / channels);
            double sq = value * value;
            int bin = Math.Min(binCount - 1, (int)((long)i * binCount / frames));
            sums[bin] += sq;
            counts[bin]++;
            total += sq;
            if (i > 0 && (value >= 0) != (previous >= 0)) crossings++;
            previous = value;
        }

        var bins = new float[binCount];
        for (int i = 0; i < binCount; i++)
        {
            // Gentle compression reveals quiet audio without clipping loud music.
            float rms = counts[i] > 0 ? (float)Math.Sqrt(sums[i] / counts[i]) : 0;
            bins[i] = Math.Clamp((float)Math.Sqrt(rms) * 2.2f, 0, 1);
        }
        float overall = (float)Math.Sqrt(total / frames);
        float intensity = Math.Clamp((float)Math.Sqrt(overall) * 2.2f, 0, 1);
        float crossingFrequency = crossings * (float)format.SampleRate / (2 * frames);
        float pitch = Math.Clamp((crossingFrequency - 80) / 1100, 0, 1);
        Volatile.Write(ref current, new MeterFrame(
            intensity, pitch, bins, Environment.TickCount64));
    }

    public void Dispose()
    {
        if (capture is null) return;
        capture.DataAvailable -= OnAudio;
        capture.StopRecording();
        capture.Dispose();
    }
}
