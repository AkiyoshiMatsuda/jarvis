$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $voice = $synth.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -eq 'ja-JP' } | Select-Object -First 1
    if (-not $voice) { throw 'Install a Japanese Windows speech voice before regenerating response.wav.' }
    $synth.SelectVoice($voice.VoiceInfo.Name)
    $synth.Rate = 0
    $synth.Volume = 100
    $phrase = -join ([char[]]@(0x306f,0x3044,0x3001,0x4f55,0x3067,0x3057,0x3087,0x3046,0xff1f))
    $folder = Join-Path $PSScriptRoot '..\ui\public'
    New-Item -ItemType Directory -Path $folder -Force | Out-Null
    $target = Join-Path $folder 'response.wav'
    $synth.SetOutputToWaveFile($target)
    $synth.Speak($phrase)
    $synth.SetOutputToNull()
    $hasher = [System.Security.Cryptography.SHA256]::Create()
    $stream = [System.IO.File]::OpenRead($target)
    try { $hash = [BitConverter]::ToString($hasher.ComputeHash($stream)).Replace('-', '') }
    finally { $stream.Dispose(); $hasher.Dispose() }
    @{text=$phrase; voice=$voice.VoiceInfo.Name; culture='ja-JP'; engine='Windows System.Speech'; sha256=$hash} |
        ConvertTo-Json | Set-Content -LiteralPath (Join-Path $folder 'response.json') -Encoding UTF8
    Write-Output "Created response.wav using $($voice.VoiceInfo.Name)"
} finally { $synth.Dispose() }
