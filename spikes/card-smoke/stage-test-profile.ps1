param(
    [Parameter(Mandatory = $true)][string]$GamePath,
    [ValidateSet(2)][int]$Slot = 2
)
$ErrorActionPreference = 'Stop'
$worktree = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$saveRoot = Join-Path $env:APPDATA 'SlayTheSpire2\steam'
$accounts = @(Get-ChildItem -LiteralPath $saveRoot -Directory | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'profile1\saves\progress.save') })
if ($accounts.Count -ne 1) { throw 'Expected exactly one account with an original profile1.' }
$accountRoot = $accounts[0].FullName
foreach ($relative in @("profile$Slot", "modded\profile$Slot")) {
    $candidate = Join-Path $accountRoot $relative
    if ((Test-Path -LiteralPath $candidate) -and @(Get-ChildItem -LiteralPath $candidate -File -Recurse).Count -ne 0) {
        throw 'The selected slot already contains files; no data overwritten.'
    }
}
$sessionRoot = Join-Path $worktree ('.diagnostics\card-test-session-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
if (Test-Path -LiteralPath $sessionRoot) { throw 'Session already exists.' }
[IO.Directory]::CreateDirectory((Join-Path $sessionRoot 'before')) | Out-Null
$env:DOTNET_CLI_HOME = Join-Path $PSScriptRoot '.dotnet-home'
$env:DOTNET_GENERATE_ASPNET_CERTIFICATE = 'false'
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$env:MSBuildEnableWorkloadResolver = 'false'
$sdk = 'C:\Program Files (x86)\dotnet\dotnet.exe'
$host64 = 'C:\Program Files\dotnet\dotnet.exe'
$gameData = Join-Path (Resolve-Path -LiteralPath $GamePath).Path 'data_sts2_windows_x86_64'
& $sdk build (Join-Path $PSScriptRoot 'tools\PrepareTestProgress\PrepareTestProgress.csproj') --configfile (Join-Path $PSScriptRoot 'NuGet.Config') -p:UseSharedCompilation=false --nologo --verbosity minimal
if ($LASTEXITCODE -ne 0) { throw 'Profile helper build failed.' }
& $sdk build (Join-Path $PSScriptRoot 'tools\ManifestCheck\ManifestCheck.csproj') --configfile (Join-Path $PSScriptRoot 'NuGet.Config') -p:UseSharedCompilation=false --nologo --verbosity minimal
if ($LASTEXITCODE -ne 0) { throw 'Manifest checker build failed.' }
& $host64 exec --roll-forward Major (Join-Path $PSScriptRoot 'tools\ManifestCheck\bin\Debug\net9.0\ManifestCheck.dll') $gameData (Join-Path $PSScriptRoot 'out\ModStudioCardSmoke\ModStudioCardSmoke.json')
if ($LASTEXITCODE -ne 0) { throw 'The game rejected the staged Mod manifest.' }
$stagedSaves = Join-Path $sessionRoot 'staged-profile\saves'
& $host64 exec --roll-forward Major (Join-Path $PSScriptRoot 'tools\PrepareTestProgress\bin\Debug\net9.0\PrepareTestProgress.dll') $gameData (Join-Path $accountRoot 'profile1\saves\progress.save') (Join-Path $stagedSaves 'progress.save')
if ($LASTEXITCODE -ne 0) { throw 'Profile clone validation failed.' }
Copy-Item -LiteralPath (Join-Path $accountRoot 'profile1\saves\prefs.save') -Destination (Join-Path $stagedSaves 'prefs.save')
foreach ($name in @('progress.save','prefs.save')) { Copy-Item -LiteralPath (Join-Path $stagedSaves $name) -Destination (Join-Path $stagedSaves ($name + '.backup')) }
$hashes = @(Get-ChildItem -LiteralPath $saveRoot -File -Recurse | ForEach-Object {
    [pscustomobject]@{ Relative = $_.FullName.Substring($saveRoot.Length + 1); Length = $_.Length; Hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }
})
Copy-Item -LiteralPath $saveRoot -Destination (Join-Path $sessionRoot 'before\steam') -Recurse
foreach ($entry in $hashes) {
    if ((Get-FileHash -LiteralPath (Join-Path $sessionRoot ('before\steam\' + $entry.Relative)) -Algorithm SHA256).Hash -ne $entry.Hash) { throw 'Backup checksum mismatch.' }
}
$originalFiles = @(Get-ChildItem -LiteralPath (Join-Path $accountRoot 'profile1') -File -Recurse | ForEach-Object {
    [pscustomobject]@{ Relative = $_.FullName.Substring($accountRoot.Length + 1); Hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }
})
$receipt = [ordered]@{
    AccountRoot = $accountRoot; SessionRoot = $sessionRoot; Slot = $Slot; OriginalFiles = $originalFiles; BackupFiles = $hashes
    OriginalSelectorHash = (Get-FileHash -LiteralPath (Join-Path $accountRoot 'profile.save') -Algorithm SHA256).Hash
    PreparedAt = [DateTime]::UtcNow.ToString('o')
}
$receipt | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $sessionRoot 'receipt.json') -Encoding UTF8
Set-Content -LiteralPath (Join-Path $worktree '.diagnostics\active-card-test-session.txt') -Value $sessionRoot -Encoding UTF8
Write-Output "PASS: staged isolated modded profile $Slot with a distinct identity, no current run, and $($hashes.Count) checksum-verified backup files."
Write-Output "Session: $sessionRoot"
