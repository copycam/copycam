param([Parameter(Mandatory=$true)][string]$Path)
# Windows.Media.Ocr via WinRT — ships with Windows 10/11, no install needed.
# Prints one recognized line of text per output line.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
  $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]

function Await($WinRtTask, $ResultType) {
  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
  $netTask = $asTask.Invoke($null, @($WinRtTask))
  $netTask.Wait(-1) | Out-Null
  $netTask.Result
}

$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]

$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($Path)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$bgra = [Windows.Graphics.Imaging.SoftwareBitmap]::Convert($bitmap, [Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8)

$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new('en-US')) }
if ($null -eq $engine) { throw 'no OCR language available' }

$result = Await ($engine.RecognizeAsync($bgra)) ([Windows.Media.Ocr.OcrResult])

# Emit words with bounding boxes as JSON; the Node side reassembles visual
# rows (OcrEngine splits wide gaps in one row into separate "lines").
$words = @()
foreach ($line in $result.Lines) {
  foreach ($word in $line.Words) {
    $words += [pscustomobject]@{
      t = $word.Text
      x = [math]::Round($word.BoundingRect.X, 1)
      y = [math]::Round($word.BoundingRect.Y, 1)
      w = [math]::Round($word.BoundingRect.Width, 1)
      h = [math]::Round($word.BoundingRect.Height, 1)
    }
  }
}
if ($words.Count -eq 0) { '[]' } else { ConvertTo-Json -Compress -InputObject @($words) }
