param(
    [Parameter(Mandatory = $true)][string]$GamePath,
    [Parameter(Mandatory = $true)][string]$SessionRoot
)
$ErrorActionPreference = 'Stop'
if (Get-Process -Name 'SlayTheSpire2' -ErrorAction SilentlyContinue) { throw 'Save and exit the game before updating the test package.' }
$session = (Resolve-Path -LiteralPath $SessionRoot).Path
$receipt = Get-Content -LiteralPath (Join-Path $session 'receipt.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($receipt.Slot -ne 2) { throw 'This bootstrap only supports dedicated modded slot 2.' }
foreach ($entry in $receipt.OriginalFiles) {
    if ((Get-FileHash -LiteralPath (Join-Path $receipt.AccountRoot $entry.Relative) -Algorithm SHA256).Hash -ne $entry.Hash) { throw 'Original profile changed; preparation stopped.' }
}
$original = Get-Content -LiteralPath (Join-Path $receipt.AccountRoot 'profile1\saves\progress.save') -Raw -Encoding UTF8 | ConvertFrom-Json
$testPath = Join-Path $receipt.AccountRoot 'modded\profile2\saves\progress.save'
if (-not (Test-Path -LiteralPath $testPath)) { throw 'Create/select modded slot 2 inside the game before importing unlocks.' }
$test = Get-Content -LiteralPath $testPath -Raw -Encoding UTF8 | ConvertFrom-Json
$progressPath = (Resolve-Path -LiteralPath (Join-Path $session 'staged-profile\saves\progress.save')).Path
$copy = Get-Content -LiteralPath $progressPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($test.unique_id -eq $original.unique_id -or $copy.unique_id -eq $original.unique_id -or $copy.schema_version -ne 24) { throw 'Test and original profiles must have distinct identities.' }
$gameRoot = (Resolve-Path -LiteralPath $GamePath).Path
$modsRoot = [IO.Path]::GetFullPath((Join-Path $gameRoot 'mods'))
$installedDll = [IO.Path]::GetFullPath((Join-Path $modsRoot 'ModStudioCardSmoke\ModStudioCardSmoke.dll'))
if (-not $installedDll.StartsWith($modsRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Test package path escaped Mods root.' }
$builtDll = Join-Path $PSScriptRoot 'out\ModStudioCardSmoke\ModStudioCardSmoke.dll'
$newHash = (Get-FileHash -LiteralPath $builtDll -Algorithm SHA256).Hash
$oldHash = (Get-FileHash -LiteralPath $installedDll -Algorithm SHA256).Hash
$installedHashReceipt = Join-Path $session 'installed-test-dll.sha256'
$allowedHashes = @('C0BD7617C14DEEE1DB36AE2DD28209D93E40E3B2369FCBDE9641314FF2AAA626','42A321A2BE77AA6F0B431DFDA187BFA74496A2B63DFE14977DAF9C3C241C1765','1DC5743B092C8E290575D8DBBA9C4412339673D5787EBF1EF739396ED6A42051',$newHash)
if (Test-Path -LiteralPath $installedHashReceipt) { $allowedHashes += (Get-Content -LiteralPath $installedHashReceipt -Raw -Encoding UTF8).Trim() }
if ($oldHash -notin $allowedHashes) { throw 'The installed test package has unexpected changes.' }
$backup = Join-Path $session ('before-bootstrap-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
[IO.Directory]::CreateDirectory($backup) | Out-Null
$steamRoot = Split-Path $receipt.AccountRoot -Parent
$hashes = @(Get-ChildItem -LiteralPath $steamRoot -File -Recurse | ForEach-Object {
    [pscustomobject]@{ Relative = $_.FullName.Substring($steamRoot.Length + 1); Hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }
})
Copy-Item -LiteralPath $steamRoot -Destination (Join-Path $backup 'steam') -Recurse
foreach ($entry in $hashes) {
    if ((Get-FileHash -LiteralPath (Join-Path $backup ('steam\' + $entry.Relative)) -Algorithm SHA256).Hash -ne $entry.Hash) { throw 'Pre-import save backup mismatch.' }
}
$hashes | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $backup 'checksums.json') -Encoding UTF8
Copy-Item -LiteralPath $installedDll -Destination (Join-Path $backup 'ModStudioCardSmoke.dll')
$configPath = Join-Path $env:APPDATA 'SlayTheSpire2\modstudio-card-test-session.json'
if (Test-Path -LiteralPath $configPath) {
    $existing = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($existing.SessionRoot -ne $session) { throw 'A different prepared test session is configured.' }
    Copy-Item -LiteralPath $configPath -Destination (Join-Path $backup 'previous-test-session.json')
}
$config = [ordered]@{
    SessionRoot = $session; ProgressFile = $progressPath
    Sha256 = (Get-FileHash -LiteralPath $progressPath -Algorithm SHA256).Hash
    ExpectedTargetIdentity = $test.unique_id; OriginalIdentity = $original.unique_id
    SessionId = [Guid]::NewGuid().ToString('N')
}
$configTemp = $configPath + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
[IO.File]::WriteAllText($configTemp, ($config | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
if (Test-Path -LiteralPath $configPath) { [IO.File]::Replace($configTemp, $configPath, [System.Management.Automation.Language.NullString]::Value) }
else { [IO.File]::Move($configTemp, $configPath) }
if ($oldHash -ne $newHash) {
    $temp = $installedDll + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
    [IO.File]::Copy($builtDll, $temp, $false)
    [IO.File]::Replace($temp, $installedDll, [System.Management.Automation.Language.NullString]::Value)
}
if ((Get-FileHash -LiteralPath $installedDll -Algorithm SHA256).Hash -ne $newHash) { throw 'Updated test DLL checksum mismatch.' }
Set-Content -LiteralPath $installedHashReceipt -Value $newHash -Encoding UTF8
Write-Output "PASS: $($hashes.Count) save files backed up and verified; isolated slot-2 import configured; test package updated."
Write-Output "New test DLL SHA256: $newHash"
