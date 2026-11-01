param(
    [Parameter(Mandatory = $true)][string]$GamePath,
    [Parameter(Mandatory = $true)][string]$SessionRoot
)
$ErrorActionPreference = 'Stop'
if (Get-Process -Name 'SlayTheSpire2' -ErrorAction SilentlyContinue) { throw 'Exit the game before activation.' }
$session = (Resolve-Path -LiteralPath $SessionRoot).Path
$receipt = Get-Content -LiteralPath (Join-Path $session 'receipt.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$gameRoot = (Resolve-Path -LiteralPath $GamePath).Path
$mods = [IO.Path]::GetFullPath((Join-Path $gameRoot 'mods'))
$disabled = [IO.Path]::GetFullPath((Join-Path $gameRoot '.modstudio-disabled-mods'))
if ($receipt.Slot -ne 2) { throw 'Only dedicated modded slot 2 is supported.' }
foreach ($entry in $receipt.OriginalFiles) {
    if ((Get-FileHash -LiteralPath (Join-Path $receipt.AccountRoot $entry.Relative) -Algorithm SHA256).Hash -ne $entry.Hash) { throw 'Original profile changed after staging; take a fresh snapshot first.' }
}
$moves = foreach ($name in @('BaseLib','ModStudioCardSmoke')) {
    $source = [IO.Path]::GetFullPath((Join-Path $disabled $name))
    $destination = [IO.Path]::GetFullPath((Join-Path $mods $name))
    if (-not $source.StartsWith($disabled + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
        -not $destination.StartsWith($mods + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Mod activation path escaped the game root.' }
    if (-not (Test-Path -LiteralPath $source -PathType Container) -or (Test-Path -LiteralPath $destination)) { throw 'Mod source missing or active destination exists.' }
    [pscustomobject]@{ Name = $name; Source = $source; Destination = $destination }
}
$sourceManifest = Join-Path $PSScriptRoot 'out\ModStudioCardSmoke\ModStudioCardSmoke.json'
$newManifestHash = (Get-FileHash -LiteralPath $sourceManifest -Algorithm SHA256).Hash
if ($newManifestHash -ne '2F45CB25DCFB797E2B245F56650D7A42059A809E0F654806DA44623EC4B9D7D7') { throw 'Unexpected corrected manifest.' }
$oldManifest = Join-Path $disabled 'ModStudioCardSmoke\ModStudioCardSmoke.json'
$oldManifestHash = (Get-FileHash -LiteralPath $oldManifest -Algorithm SHA256).Hash
if ($oldManifestHash -notin @('DAE5EF42A3CE9AE4D1C3FB4FB5A08053B033295A0CA719CDCC2A8C7C1105CF03',$newManifestHash)) { throw 'Disabled manifest changed unexpectedly.' }
$builtDll = Join-Path $PSScriptRoot 'out\ModStudioCardSmoke\ModStudioCardSmoke.dll'
$disabledDll = Join-Path $disabled 'ModStudioCardSmoke\ModStudioCardSmoke.dll'
$builtHash = (Get-FileHash -LiteralPath $builtDll -Algorithm SHA256).Hash
$disabledHash = (Get-FileHash -LiteralPath $disabledDll -Algorithm SHA256).Hash
if ($disabledHash -notin @('C0BD7617C14DEEE1DB36AE2DD28209D93E40E3B2369FCBDE9641314FF2AAA626',$builtHash)) { throw 'Unexpected disabled test DLL; update that package explicitly before activation.' }
[IO.Directory]::CreateDirectory((Join-Path $session 'before\disabled-mods')) | Out-Null
foreach ($move in $moves) { Copy-Item -LiteralPath $move.Source -Destination (Join-Path $session ('before\disabled-mods\' + $move.Name)) -Recurse }
# Steam synchronization is authoritative. Create/select slot 2 inside the game;
# configure-test-profile-import.ps1 imports its private unlock snapshot after sync.
if ($disabledHash -ne $builtHash) {
    $temp = $disabledDll + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
    [IO.File]::Copy($builtDll, $temp, $false)
    [IO.File]::Replace($temp, $disabledDll, [System.Management.Automation.Language.NullString]::Value)
}
if ($oldManifestHash -ne $newManifestHash) {
    $temp = $oldManifest + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
    [IO.File]::Copy($sourceManifest, $temp, $false)
    [IO.File]::Replace($temp, $oldManifest, [System.Management.Automation.Language.NullString]::Value)
}
foreach ($move in $moves) { [IO.Directory]::Move($move.Source, $move.Destination) }
[DateTime]::UtcNow.ToString('o') | Set-Content -LiteralPath (Join-Path $session 'activated-at.txt') -Encoding UTF8
Write-Output 'PASS: test Mods activated without writing any save or profile selector. Create/select modded slot 2 inside the game, then configure its guarded import.'
