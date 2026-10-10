# Synthetic speech only; run from the repository root.
New-Item -ItemType Directory -Force validation/stt-numbers | Out-Null
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$phrases = @('1分測って','3分測って','5分測って','10分測って','15分測って','30秒測って','1分30秒測って','2時間測って','こんにちは','明日の予定を教えて')
$rows = @()
foreach ($voice in $synth.GetInstalledVoices()) {
  if ($voice.Enabled -and $voice.VoiceInfo.Culture.Name -eq 'ja-JP') {
    $synth.SelectVoice($voice.VoiceInfo.Name)
    for ($i=0; $i -lt $phrases.Count; $i++) {
      $file = "validation/stt-numbers/$($rows.Count).wav"
      $synth.SetOutputToWaveFile((Join-Path (Get-Location) $file))
      $synth.Speak($phrases[$i])
      $synth.SetOutputToNull()
      $rows += @{file=$file;phrase=$phrases[$i];voice=$voice.VoiceInfo.Name;seconds=@(60,180,300,600,900,30,90,7200,0,0)[$i]}
    }
  }
}
$synth.Dispose()
$rows | ConvertTo-Json | Set-Content -Encoding utf8 validation/stt-numbers/corpus.json
$rows.Count
