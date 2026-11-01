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
- The user installed the Windows x86 SDK. `C:\Program Files (x86)\dotnet\dotnet.exe --list-sdks` reports `9.0.123`. A throwaway `net9.0` console project built successfully with 0 warnings and 0 errors. The Microsoft page screenshot showed SDK `9.0.320`, so the installed SDK version does not match that page's current version; it nevertheless passed the basic net9 compile check.
- The game bundle includes .NET 9 runtime files but not an SDK.
- At initial inspection, no MegaDot executable, STS2 `mods` directory, or BaseLib Workshop install was found at the standard paths. MegaDot and BaseLib were downloaded and extracted below.
- The Mod Studio Card template currently emits `RitsuMod.Content.CardComponent`; the app does not build or deploy the generated C# artifact. ADR-0008 requires proving content registration and Ironclad pool placement, not merely compilation.

## Dependencies downloaded (not installed)

Saved under the Card worktree's `dependency-downloads/` directory:

- `megadot-4.5.1-m.14-windows-x86_64-llvm-editor-csharp.zip` — 578,164,427 bytes; SHA-256 `bd42d2c8e41653b451a1ee714447c333c738a515ad2f554673b8960a364e5829`; verified against the checksum file linked from Mega Crit's MegaDot downloads page.
- `BaseLib.3.4.7.zip` — 467,794 bytes; SHA-256 `d28c649a3aea9ef4869050a06bfbadc4863016bcbd4c1740acc4cd07809e4bd8`; verified against the checksum published on the GitHub release page. The ZIP contains `BaseLib.dll`, `BaseLib.json`, and `BaseLib.pck`.

Both archives passed ZIP structure checks and SHA-256 verification before extraction. MegaDot 4.5.1-m.14 was the latest listed at download time; compare it with the current game/template before setup. Neither dependency has been installed.

The user extracted both archives under `dependency-downloads/` and renamed the BaseLib folder to `BaseLib`. Its folder is a normal directory containing `BaseLib.dll`, `BaseLib.json`, and `BaseLib.pck`.

## Mod Manager compatibility fix

The user's screenshot showed `所选 Mod 目录无效`. In the prior implementation, that generic result came from an inaccessible/non-directory selection, a symbolic link, or selecting the game root; the UI did not distinguish these cases. The extracted `BaseLib` folder itself is a regular directory, so the screenshot alone does not reveal which path the native picker returned.

A second issue would have blocked the next step even with the correct folder: the installer only searched JSON filenames containing `mod`/`manifest` or a short legacy allowlist, while STS2 BaseLib uses the valid root manifest `BaseLib.json`. The Card branch now accepts root JSON manifests with an ID and name alongside a root `.dll` or `.pck`, reads those manifests for the installed-Mod list, and returns a specific message for each invalid path condition.

Validation after the fix: the new real-filesystem package test passes; all 58 test files / 749 tests pass when run outside the restricted filesystem sandbox; Electron TypeScript and Windows directory build pass. The built retryable app is under `dist-card-modmanager/win-unpacked/`. BaseLib has not yet been installed into the game or tested in-game.

## Compatibility route

1. The x86 .NET SDK 9.0.123 is installed and passed a basic `net9.0` compile. If MegaDot or the template rejects the x86 SDK, install the current Windows x64 .NET 9 SDK from Microsoft's official download page and verify with `dotnet --list-sdks`.
2. Follow the current STS2 community template setup only as a compatibility candidate: it calls for MegaDot matching its latest supported version, .NET SDK 9+, BaseLib, and its `Alchyr.Sts2.Templates`. Compare its `GodotPath`, `Sts2Path`, assembly references, and manifest conventions with the local installed game before adopting it.
3. Build one minimally invasive fixed-damage Ironclad common attack mod against the local game assemblies. Keep the experiment outside the Mod Studio application output until the API, content registration, and pool assignment are established.
4. Deploy only the experiment to the local game `mods` directory, verify the Mod Settings list and startup logs, then start a normal Ironclad run and obtain the card through the ordinary card pool. Play it against a known-HP enemy and record the expected versus observed damage.
5. Only after this end-to-end check passes, implement the reusable generator/build/deploy workflow in Mod Studio on this branch. Keep build, deploy, game-load, and in-combat evidence as separate statuses.

## Current status

The .NET SDK prerequisite is met for basic `net9.0` compilation, and the MegaDot/BaseLib archives are downloaded and checksum-verified. The packages have been extracted but not installed; the current mod template is not installed. Mod-specific C# compilation, deployment, loading, card-pool appearance, and combat damage remain unverified. No installer or external dependency was run by this spike.

## References

- [ADR-0008: Card build and playtest](./adr/0008-card-build-and-playtest.md)
- [Microsoft .NET 9 downloads](https://dotnet.microsoft.com/en-us/download/dotnet/9.0)
- [Microsoft: install .NET on Windows](https://learn.microsoft.com/en-us/dotnet/core/install/windows)
- [STS2 community template setup](https://github.com/Alchyr/ModTemplate-StS2/wiki/Setup)
- [Mega Crit official STS2 mod support announcement](https://steamcommunity.com/games/2868840/announcements/detail/710026912607505281)
