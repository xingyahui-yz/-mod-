param(
    [Parameter(Mandatory = $true)][string]$GamePath,
    [string]$DotnetPath = 'C:\Program Files (x86)\dotnet\dotnet.exe'
)
$ErrorActionPreference = 'Stop'
$gameRoot = (Resolve-Path -LiteralPath $GamePath).Path
foreach ($relativePath in @('data_sts2_windows_x86_64\sts2.dll', 'data_sts2_windows_x86_64\GodotSharp.dll', 'mods\BaseLib\BaseLib.dll')) {
    if (-not (Test-Path -LiteralPath (Join-Path $gameRoot $relativePath) -PathType Leaf)) {
        throw "Missing prerequisite: $relativePath"
    }
}
$env:DOTNET_CLI_HOME = Join-Path $PSScriptRoot '.dotnet-home'
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$env:DOTNET_SKIP_FIRST_TIME_EXPERIENCE = '1'
$env:DOTNET_GENERATE_ASPNET_CERTIFICATE = 'false'
$env:MSBuildEnableWorkloadResolver = 'false'
& $DotnetPath build (Join-Path $PSScriptRoot 'ModStudioCardSmoke.csproj') --configfile (Join-Path $PSScriptRoot 'NuGet.Config') -c Release "-p:GamePath=$gameRoot" --nologo --verbosity minimal
if ($LASTEXITCODE -ne 0) { throw "Card mod build failed (exit $LASTEXITCODE)." }
$outputDirectory = Join-Path $PSScriptRoot 'out\ModStudioCardSmoke'
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'bin\Release\net9.0\ModStudioCardSmoke.dll') -Destination $outputDirectory
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'ModStudioCardSmoke.json') -Destination $outputDirectory
Write-Output "Built mod package: $outputDirectory"
Get-FileHash -LiteralPath (Join-Path $outputDirectory 'ModStudioCardSmoke.dll'), (Join-Path $outputDirectory 'ModStudioCardSmoke.json') -Algorithm SHA256
