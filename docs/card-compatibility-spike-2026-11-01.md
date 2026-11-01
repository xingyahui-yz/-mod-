---
kind: project
scope: card-compatibility-spike
project: 杀戮尖塔mod
topics: [sts2, card, mod-build, windows]
source: local environment inspection and accepted ADR-0008
status: incomplete
updated: 2026-11-01
---

# Card compatibility spike: Windows environment snapshot

## Decision

Start a separate Card compatibility branch from PR #4 head `033b313`. Verify the actual installed game and toolchain before changing the generated-card framework. Do not install missing tools automatically.

## Detected environment (2026-11-01)

- Steam install: `D:\Steam\steamapps\common\Slay the Spire 2`.
- Steam appmanifest: app `2868840`, branch `public-beta`, build ID `24724944`; Steam last-updated epoch corresponds to 2026-10-30.
- `data_sts2_windows_x86_64\sts2.runtimeconfig.json` targets `net9.0`, bundled `Microsoft.NETCore.App` version `9.0.7`.
- `sts2.dll` is 9,757,184 bytes, last modified 2026-09-30 21:03:09, SHA-256 `0861BFA1DF347538D932F22D580E75420F08082792EB914E53B4882764ACDBE9`.
- Game `release_info.json` reports `v0.111.0` / commit `41cef1ea` dated 2026-08-13. This conflicts with the newer Steam manifest and DLL timestamp, so treat `24724944` as the installed depot build identifier and the release-info version as stale until matched to an official beta build announcement.
- `sts2.xml` is present beside the actual game assembly and contains current API documentation. It can be used to inspect supported members without guessing against an older template.
- `dotnet --info` reports no SDKs installed. Only runtimes 7.0.20, 8.0.29, and 10.0.12 are globally installed. The game bundle contains its own .NET 9 runtime but not an SDK.
- After the user installed the Windows x86 SDK, `C:\Program Files (x86)\dotnet\dotnet.exe --list-sdks` reports `9.0.123`. A throwaway `net9.0` console project built successfully with 0 warnings and 0 errors. The Microsoft page screenshot showed SDK `9.0.320`, so the installed SDK version does not match that page's current version; it nevertheless passed the basic net9 compile check.
- No MegaDot executable, STS2 `mods` directory, or BaseLib Workshop install was found at the standard paths checked.
- The Mod Studio Card template currently emits `RitsuMod.Content.CardComponent`; the app does not build or deploy the generated C# artifact. ADR-0008 requires proving content registration and Ironclad pool placement, not merely compilation.

## Compatibility route

1. Install a .NET 9 SDK for Windows x64 from Microsoft's official .NET 9 download page (or `winget install Microsoft.DotNet.SDK.9`), then verify with `dotnet --list-sdks`. SDK 9 matches the game target framework; the currently installed .NET 10 runtime is not a compiler SDK.
2. Follow the current STS2 community template setup only as a compatibility candidate: it calls for MegaDot matching its latest supported version, .NET SDK 9+, BaseLib, and its `Alchyr.Sts2.Templates`. Compare its `GodotPath`, `Sts2Path`, assembly references, and manifest conventions with the local installed game before adopting it.
3. Build one minimally invasive fixed-damage Ironclad common attack mod against the local game assemblies. Keep the experiment outside the Mod Studio application output until the API, content registration, and pool assignment are established.
4. Deploy only the experiment to the local game `mods` directory, verify the Mod Settings list and startup logs, then start a normal Ironclad run and obtain the card through the ordinary card pool. Play it against a known-HP enemy and record the expected versus observed damage.
5. Only after this end-to-end check passes, implement the reusable generator/build/deploy workflow in Mod Studio on this branch. Keep build, deploy, game-load, and in-combat evidence as separate statuses.

## Current status

The .NET SDK prerequisite is met for basic `net9.0` compilation. Compatibility discovery is not yet complete: MegaDot, BaseLib, and the current mod template are not installed at the checked paths. Mod-specific C# compilation, deployment, loading, card-pool appearance, and combat damage remain unverified. No installer or external dependency was run by this spike.

## References

- [ADR-0008: Card build and playtest](./adr/0008-card-build-and-playtest.md)
- [Microsoft .NET 9 downloads](https://dotnet.microsoft.com/en-us/download/dotnet/9.0)
- [Microsoft: install .NET on Windows](https://learn.microsoft.com/en-us/dotnet/core/install/windows)
- [STS2 community template setup](https://github.com/Alchyr/ModTemplate-StS2/wiki/Setup)
- [Mega Crit official STS2 mod support announcement](https://steamcommunity.com/games/2868840/announcements/detail/710026912607505281)
