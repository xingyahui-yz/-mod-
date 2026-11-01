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
- Game `release_info.json` reports `v0.111.0` / commit `41cef1ea` dated 2026-08-13. The user's live game screenshot subsequently confirms **v0.111.0 / 2026.08.14**, and BaseLib's runtime log independently reports `Naive game version: v0.111.0`. Keep both the game version and Steam depot build ID `24724944`; the newer Steam manifest timestamp alone does not establish that the in-game version is stale.
- `sts2.xml` is present beside the actual game assembly and contains current API documentation. It can be used to inspect supported members without guessing against an older template.
- The user installed the Windows x86 SDK. `C:\Program Files (x86)\dotnet\dotnet.exe --list-sdks` reports `9.0.123`. A throwaway `net9.0` console project built successfully with 0 warnings and 0 errors. The Microsoft page screenshot showed SDK `9.0.320`, so the installed SDK version does not match that page's current version; it nevertheless passed the basic net9 compile check.
- The game bundle includes .NET 9 runtime files but not an SDK.
- At initial inspection, no MegaDot executable, STS2 `mods` directory, or BaseLib Workshop install was found at the standard paths. MegaDot and BaseLib were downloaded and extracted below.
- The Mod Studio Card template currently emits `RitsuMod.Content.CardComponent`; the app does not build or deploy the generated C# artifact. ADR-0008 requires proving content registration and Ironclad pool placement, not merely compilation.

## Dependencies downloaded (not installed)

Saved under the Card worktree's `dependency-downloads/` directory:

- `megadot-4.5.1-m.14-windows-x86_64-llvm-editor-csharp.zip` — 578,164,427 bytes; SHA-256 `bd42d2c8e41653b451a1ee714447c333c738a515ad2f554673b8960a364e5829`; verified against the checksum file linked from Mega Crit's MegaDot downloads page.
- `BaseLib.3.4.7.zip` — 467,794 bytes; SHA-256 `d28c649a3aea9ef4869050a06bfbadc4863016bcbd4c1740acc4cd07809e4bd8`; verified against the checksum published on the GitHub release page. The ZIP contains `BaseLib.dll`, `BaseLib.json`, and `BaseLib.pck`.

Both archives passed ZIP structure checks and SHA-256 verification before extraction. MegaDot 4.5.1-m.14 was the latest listed at download time; compare it with the current game/template before setup. MegaDot is extracted and has not been run. BaseLib is now installed and has been loaded by the game, as recorded below.

The user extracted both archives under `dependency-downloads/` and renamed the BaseLib folder to `BaseLib`. Its folder is a normal directory containing `BaseLib.dll`, `BaseLib.json`, and `BaseLib.pck`.

## Mod Manager compatibility fix

The user's screenshot showed `所选 Mod 目录无效`. In the prior implementation, that generic result came from an inaccessible/non-directory selection, a symbolic link, or selecting the game root; the UI did not distinguish these cases. The extracted `BaseLib` folder itself is a regular directory, so the screenshot alone does not reveal which path the native picker returned.

A second issue would have blocked the next step even with the correct folder: the installer only searched JSON filenames containing `mod`/`manifest` or a short legacy allowlist, while STS2 BaseLib uses the valid root manifest `BaseLib.json`. The Card branch now accepts root JSON manifests with an ID and name alongside a root `.dll` or `.pck`, reads those manifests for the installed-Mod list, and returns a specific message for each invalid path condition.

Validation after the fix: the new real-filesystem package test passes; all 58 test files / 749 tests pass when run outside the restricted filesystem sandbox; Electron TypeScript and Windows directory build pass. The built retryable app is under `dist-card-modmanager/win-unpacked/`.

The native install picker repeatedly returned the configured game root, causing the specific root-selection error. The user copied the extracted `BaseLib` folder into the game's `mods` directory. Files now exist directly at `mods/BaseLib/{BaseLib.dll,BaseLib.json,BaseLib.pck}`; the installed DLL SHA-256 matches the checked source (`55863ca6adc30a61a7544874e157a519ffe148ccf2b18025947609c4bff813ce`). Studio's list shows BaseLib enabled but still shows unknown author/version; the on-disk manifest contains `v3.4.7` / `Alchyr`, so that remaining display issue requires a separate check of the running Studio build.

The user opened BaseLib's configuration page inside the game. `%APPDATA%/SlayTheSpire2/logs/godot.log` confirms its manifest, DLL, PCK, and initializer loaded, and reports **282 patches succeeded, 0 failed**. Initial missing configuration fields were filled by BaseLib. Dependency loading has therefore passed; this is not yet a Card playtest.

## Standalone Card package

The experiment lives in [`spikes/card-smoke/`](../spikes/card-smoke/README.md), separate from the application's generator. It uses BaseLib v3.4.7's `CustomCardModel`, an explicit `Pool(typeof(IroncladCardPool))` attribute, and STS2's `DamageCmd.Attack` against the installed assemblies. The card is **工坊试击 / StudioStrike**: 1 energy, Common Ironclad attack, 6 base damage (9 upgraded), reusing the game's Ironclad Strike portrait. In-code localization means no PCK or new resource import is needed.

`build.ps1 -GamePath 'D:\Steam\steamapps\common\Slay the Spire 2'` completed with **0 warnings / 0 errors** using the installed x86 SDK 9.0.123. NuGet sources were cleared and there are no package dependencies; no new SDK, template, or editor was installed. The final DLL SHA-256 is `c0bd7617c14deee1db36ae2dd28209d93e40e3b2369fcbde9641314ff2aaa626`; the manifest SHA-256 is `dae5ef42a3ce9ae4d1c3fb4fb5a08053b033295a0ca719cdcc2a8c7c1105cf03`.

After the user confirmed the game had exited, `deploy.ps1` created `mods/ModStudioCardSmoke/` through a unique same-volume staging directory and checked both copied files' SHA-256 before publication. Existing Mod directories are rejected without replacement. **Build and deployment passed; test-Mod loading, normal-pool acquisition, and combat damage are pending.** The user has been asked to restart the game and enable **Mod Studio Card Smoke** alongside BaseLib.

## Compatibility route

1. The x86 .NET SDK 9.0.123 is installed and passed a basic `net9.0` compile. If MegaDot or the template rejects the x86 SDK, install the current Windows x64 .NET 9 SDK from Microsoft's official download page and verify with `dotnet --list-sdks`.
2. Follow the current STS2 community template setup only as a compatibility candidate: it calls for MegaDot matching its latest supported version, .NET SDK 9+, BaseLib, and its `Alchyr.Sts2.Templates`. Compare its `GodotPath`, `Sts2Path`, assembly references, and manifest conventions with the local installed game before adopting it.
3. Build one minimally invasive fixed-damage Ironclad common attack mod against the local game assemblies. Keep the experiment outside the Mod Studio application output until the API, content registration, and pool assignment are established.
4. Deploy only the experiment to the local game `mods` directory, verify the Mod Settings list and startup logs, then start a normal Ironclad run and obtain the card through the ordinary card pool. Play it against a known-HP enemy and record the expected versus observed damage.
5. Only after this end-to-end check passes, implement the reusable generator/build/deploy workflow in Mod Studio on this branch. Keep build, deploy, game-load, and in-combat evidence as separate statuses.

## Current status

The .NET SDK prerequisite is met, BaseLib is installed and running, and the standalone Card package has compiled and deployed. The installed game identifies itself as v0.111.0, Steam build ID 24724944. MegaDot is extracted but has not been run, and the template is not installed. The test Mod's game loading, display in Ironclad's library, ordinary reward/shop acquisition, and in-combat damage remain unverified. The application still generates the old `RitsuMod` API; migrate or integrate its generator/build/deploy flow only after the experiment's actual playtest provides evidence.

## References

- [ADR-0008: Card build and playtest](./adr/0008-card-build-and-playtest.md)
- [Microsoft .NET 9 downloads](https://dotnet.microsoft.com/en-us/download/dotnet/9.0)
- [Microsoft: install .NET on Windows](https://learn.microsoft.com/en-us/dotnet/core/install/windows)
- [STS2 community template setup](https://github.com/Alchyr/ModTemplate-StS2/wiki/Setup)
- [Mega Crit official STS2 mod support announcement](https://steamcommunity.com/games/2868840/announcements/detail/710026912607505281)
