param([Parameter(Mandatory = $true)][string]$SessionRoot, [switch]$RequireStartup, [switch]$RequireMenuReady, [switch]$RequireStartingDeck, [switch]$RequireCardPlayed)
$ErrorActionPreference = 'Stop'
$receipt = Get-Content -LiteralPath (Join-Path $SessionRoot 'receipt.json') -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($entry in $receipt.OriginalFiles) {
    if ((Get-FileHash -LiteralPath (Join-Path $receipt.AccountRoot $entry.Relative) -Algorithm SHA256).Hash -ne $entry.Hash) { throw 'FAIL: original profile data changed.' }
}
if ((Get-FileHash -LiteralPath (Join-Path $receipt.AccountRoot 'profile.save') -Algorithm SHA256).Hash -ne $receipt.OriginalSelectorHash) { throw 'FAIL: original profile selector changed.' }
$original = Get-Content -LiteralPath (Join-Path $receipt.AccountRoot 'profile1\saves\progress.save') -Raw -Encoding UTF8 | ConvertFrom-Json
$testPath = Join-Path $receipt.AccountRoot ("modded\profile$($receipt.Slot)\saves\progress.save")
if (-not (Test-Path -LiteralPath $testPath)) { throw 'FAIL: test progress file is missing; check cloud synchronization before continuing.' }
$test = Get-Content -LiteralPath $testPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($original.unique_id -eq $test.unique_id) { throw 'FAIL: source and test identities match.' }
$selector = Get-Content -LiteralPath (Join-Path $receipt.AccountRoot 'modded\profile.save') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($selector.last_profile_id -ne $receipt.Slot) { throw 'FAIL: modded selector is not the isolated test slot.' }
Write-Output "PASS: $($receipt.OriginalFiles.Count) original profile files and original selector unchanged; test identity is distinct; modded selector=$($receipt.Slot)."
if ($RequireStartup -or $RequireMenuReady -or $RequireStartingDeck -or $RequireCardPlayed) {
    $logPath = Join-Path $env:APPDATA 'SlayTheSpire2\logs\godot.log'
    $log = Get-Content -LiteralPath $logPath -Raw -Encoding UTF8
    $expected = 'user://steam/' + (Split-Path $receipt.AccountRoot -Leaf) + "/modded/profile$($receipt.Slot)"
    if (-not $log.Contains('Profile-scoped data path initialized: ' + $expected)) { throw 'FAIL: current startup log has not confirmed the isolated test slot.' }
    if (-not $log.Contains("Finished mod initialization for 'Mod Studio Card Smoke'")) { throw 'FAIL: Card Mod initializer has not completed.' }
    if ($log -match '\[ERROR\]') { throw 'FAIL: current game startup logged an ERROR; inspect before continuing.' }
    Write-Output "PASS: actual game startup selected modded/profile$($receipt.Slot); test Mod initialized; no [ERROR] entries."
}
if ($RequireMenuReady -or $RequireStartingDeck) {
    $auditPath = Join-Path $SessionRoot 'runtime-card-pool-check.json'
    if (-not (Test-Path -LiteralPath $auditPath)) { throw 'FAIL: no actual runtime pool audit has been recorded.' }
    $audit = Get-Content -LiteralPath $auditPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($audit.Slot -ne 2 -or $audit.Pool -ne 'IroncladCardPool' -or -not $audit.InPool -or -not $audit.Unlocked -or -not $audit.CompendiumAvailable) {
        throw 'FAIL: runtime pool membership, unlock state, or compendium availability is not ready.'
    }
    Write-Output 'PASS: actual Ironclad pool contains the unlocked test card; game reports compendium available. Confirm both menu entries visually.'
    if ($RequireStartingDeck -and ($audit.StartingDeckCopies -ne 1 -or -not $audit.Discovered)) { throw 'FAIL: one-copy starting-deck fixture and library discovery have not been verified in the actual game.' }
    if ($RequireStartingDeck) { Write-Output 'PASS: isolated test character starting deck contains exactly one StudioStrike; library discovery is recorded.' }
}
if ($RequireCardPlayed) {
    $cleanHit = $false
    foreach ($hit in [regex]::Matches($log, 'StudioStrike played: baseDamage=6, hp=([0-9.]+)->([0-9.]+), block=0->0\.')) {
        if ([decimal]$hit.Groups[1].Value - [decimal]$hit.Groups[2].Value -eq 6) { $cleanHit = $true }
    }
    if (-not $cleanHit) { throw 'FAIL: no actual unupgraded test-card hit with 6 HP loss and zero Block has been recorded.' }
    Write-Output 'PASS: actual StudioStrike play recorded 6 HP loss against zero Block. Normal reward/shop acquisition and modifier conditions still require observed evidence.'
}
