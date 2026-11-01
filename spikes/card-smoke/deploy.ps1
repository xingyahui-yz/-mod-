param([Parameter(Mandatory = $true)][string]$GamePath)
$ErrorActionPreference = 'Stop'
$gameRoot = (Resolve-Path -LiteralPath $GamePath).Path
if (-not (Test-Path -LiteralPath (Join-Path $gameRoot 'SlayTheSpire2.exe') -PathType Leaf)) {
    throw 'Game executable not found in the selected root.'
}
if (Get-Process -Name 'SlayTheSpire2' -ErrorAction SilentlyContinue) {
    throw 'Exit Slay the Spire 2 before deploying the test mod.'
}
$source = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'out\ModStudioCardSmoke')).Path
$files = @('ModStudioCardSmoke.dll', 'ModStudioCardSmoke.json')
foreach ($name in $files) {
    if (-not (Test-Path -LiteralPath (Join-Path $source $name) -PathType Leaf)) { throw "Missing package file: $name" }
}
$manifest = Get-Content -LiteralPath (Join-Path $source 'ModStudioCardSmoke.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.id -ne 'ModStudioCardSmoke' -or -not $manifest.has_dll -or $manifest.has_pck -or @($manifest.dependencies).Count -ne 1 -or $manifest.dependencies[0].id -ne 'BaseLib' -or $manifest.dependencies[0].min_version -ne '3.4.7') {
    throw 'Unexpected test mod manifest.'
}
if (-not (Test-Path -LiteralPath (Join-Path $gameRoot 'mods\BaseLib\BaseLib.dll') -PathType Leaf)) { throw 'Install BaseLib first.' }
$modsRoot = [IO.Path]::GetFullPath((Join-Path $gameRoot 'mods'))
$destination = [IO.Path]::GetFullPath((Join-Path $modsRoot 'ModStudioCardSmoke'))
$staging = [IO.Path]::GetFullPath((Join-Path $modsRoot ('.modstudio-card-smoke-install-' + [Guid]::NewGuid().ToString('N'))))
foreach ($candidate in @($destination, $staging)) {
    if (-not $candidate.StartsWith($modsRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Deployment path escaped the game Mods directory.'
    }
}
if (Test-Path -LiteralPath $destination) { throw "Already exists; no files overwritten: $destination" }
[IO.Directory]::CreateDirectory($staging) | Out-Null
foreach ($name in $files) {
    $from = Join-Path $source $name
    $to = Join-Path $staging $name
    [IO.File]::Copy($from, $to, $false)
    if ((Get-FileHash -LiteralPath $from -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $to -Algorithm SHA256).Hash) {
        throw "Copied file checksum mismatch; staging retained at $staging"
    }
}
[IO.Directory]::Move($staging, $destination)
Write-Output "Deployed test mod: $destination"
Get-FileHash -LiteralPath ($files | ForEach-Object { Join-Path $destination $_ }) -Algorithm SHA256
