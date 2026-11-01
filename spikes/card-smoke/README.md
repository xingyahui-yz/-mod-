# Card compatibility smoke package

Standalone experiment for the locally installed STS2 **v0.111.0** (Steam build ID `24724944`) with **BaseLib v3.4.7**. The screenshot of BaseLib's in-game configuration page confirms that the dependency runs; the Card experiment still requires game validation.

## Card

- ID/class: `StudioStrike`; title: **工坊试击**.
- Pool: `IroncladCardPool`, rarity: `Common`, target: one enemy.
- Cost: 1 energy. Base damage: 6; upgraded base damage: 9.
- Uses the game's normal attack command, so Strength, Weak, Vulnerable, enemy Block, and other normal modifiers apply. Use an unupgraded card against an enemy with no Block and no damage modifiers to expect a 6-HP reduction.
- Uses the existing Ironclad Strike portrait at runtime. No copied game assets, external image, PCK, installed template, or NuGet package is required.
- Adds the card to the regular Ironclad pool.
- At the user's explicit request, a guarded fixture adds **exactly one** copy to Ironclad's starting deck in prepared **modded profile 2**. It also marks the card discovered for that test profile's library preview. These fixture actions are separate from natural reward/shop acquisition.

## Build and deploy

Use Windows PowerShell from this directory, with the installed .NET 9 SDK:

```powershell
./build.ps1 -GamePath 'D:\Steam\steamapps\common\Slay the Spire 2'
# After completely exiting the game:
./deploy.ps1 -GamePath 'D:\Steam\steamapps\common\Slay the Spire 2'
```

Build uses only local framework references and the installed game/BaseLib assemblies. `NuGet.Config` clears remote sources. Output is `out/ModStudioCardSmoke/`, containing exactly the DLL and manifest. Deploy stages those files in the game's `mods/` directory, checks SHA-256, and publishes a new `ModStudioCardSmoke/` directory without replacing any existing directory. An existing test-Mod directory stops deployment.

To roll back, exit the game and move `mods/ModStudioCardSmoke/` outside the game's `mods/` directory, or disable it in Mod Studio. Keep a run using the test card separate until its test is complete.

## Save-profile incident and test prerequisite

Enabling this gameplay-affecting test Mod initially switched the game to `steam/<account>/modded/profile1`. That profile had only 1,166 bytes of progress and no run history, while the original `profile1` retained a 273,359-byte progress file and 88 runs. Both save trees were backed up (174 files, 17,830,592 bytes, all SHA-256 verified), both Mods were temporarily disabled, and the user confirmed original progress and the card-library entry recovered. No save was restored over the original profile.

The resumed experiment uses **modded/profile2** with a distinct identity. Directly copying its files before startup failed: Steam synchronization overwrote the selector and deleted local-only progress missing from the remote store. The corrected flow creates/selects slot 2 inside the game, then imports a private prepared progress copy **after cloud synchronization** using the game's `SaveManager`/`ProgressSaveManager.SaveProgress` APIs. Original and test progress have different identities; current-run files and run-history files are not cloned. Both save trees and the current test run are backed up again before each package update (182 files in the latest snapshots).

`TestProfilePolicy` permits imports only for the prepared identity in modded slot 2 and rejects the original profile, non-modded slots, other slots, and foreign identities. Eleven invariant cases pass. Runtime import revalidates the prepared file's SHA-256, parses and validates it with the installed game, and checks the actual active profile path before changing progress. Original profile1's **141 files plus its selector** continue to match their pre-test hashes. The original copy's 901 discovery records were validated to 560 records by the game's normal validation; the original file is unchanged.

Do not mark this content Mod as cosmetic to bypass save separation. An unavailable library entry in a fresh profile does not establish a pool defect; an undiscovered card can also appear as unknown even while eligible for rewards.

## Repeatable test setup

For a new, unused modded slot 2, exit the game, build the package, and run `stage-test-profile.ps1 -GamePath <game root>`. It writes its clone and checksum-verified backups only under the worktree's ignored `.diagnostics/` directory. The snapshot gets a game-generated identity distinct from the original. The script rejects a slot that already contains user data; reuse the existing session receipt for this ongoing test.

Install or enable BaseLib and the test package. `activate-test-profile.ps1` can reactivate previously disabled owned packages; it deliberately writes no save or selector. Launch **through Steam**, create/select modded slot 2 in the game's own profile screen, then save and exit. Cloud synchronization must have a game-created slot to work with.

Read the session directory from `.diagnostics/active-card-test-session.txt`, then run:

```powershell
./configure-test-profile-import.ps1 -GamePath 'D:\Steam\steamapps\common\Slay the Spire 2' -SessionRoot '<prepared session directory>'
# Restart through Steam, then from this directory:
./verify-test-profile.ps1 -SessionRoot '<prepared session directory>' -RequireStartingDeck
```

The configuration is local to `%APPDATA%/SlayTheSpire2/modstudio-card-test-session.json`; private save data and identities stay out of Git. The import runs only when the actual active save is the prepared `modded/profile2`. Once that copy is loaded, subsequent startups preserve its progress. The pool audit records actual runtime membership, reward unlock eligibility, library availability/discovery, and the one-copy starting deck in the ignored session directory. A new Ironclad run is required to get the new starting deck; a previously saved deck is not rebuilt.

## Acceptance evidence

Passed on 2026-11-01:

- Build: 0 warnings / 0 errors. Profile guard checks: 11 passed. Corrected manifest accepted by the actual game parser.
- Steam startup uses `modded/profile2`, both Mods initialized, no `[ERROR]` entries.
- Timeline page opened through UI. User confirmed the card-library page opens.
- Actual `IroncladCardPool` contains `StudioStrike`, its unlocked-card query includes it, rarity is Common, type is Attack.
- Prepared test character's starting deck contains exactly one `StudioStrike`; the user confirmed seeing and playing it.
- Actual combat log: `StudioStrike played: baseDamage=6, hp=32->26, block=0->0.` The HP loss is **6**, with zero enemy Block. The user was asked to test without Strength/Weak/Vulnerable.
- Original profile1's 141 files and selector still match the pre-test snapshot.

The combat check used the **explicitly requested starting-deck fixture**. Natural reward/shop acquisition has **not been observed** and must remain a separate pending result under the original acceptance plan. Upgraded 9-damage play is also unverified. See [`docs/card-smoke-acceptance-2026-11-01.json`](../../docs/card-smoke-acceptance-2026-11-01.json) for the concise evidence record.

After acceptance, the user requested the original game state. Both Mods are currently disabled, the active bootstrap configuration is archived, and Steam startup is verified on **original/profile1** with zero local Mods and no modded-running marker or startup errors. Timeline and Encyclopedia are visible. All original profile files/selector remain hash-identical; the isolated test save and backups are retained.

## Manifest validation

The initial package used legacy string dependencies. The game loaded it but logged an ERROR, causing the red "loaded mods but detected errors" status. The source manifest now requires `{"id":"BaseLib","min_version":"3.4.7"}`. `tools/ManifestCheck` rejects legacy strings and invokes the **installed game's own `ModManifest.ReadFromStream`** parser; the corrected manifest passes with zero parser errors.

Build the validator with the same offline SDK setup as `build.ps1`, then run it with an installed **x64** .NET 9 or later runtime. This machine has an x64 .NET 10 host, so the validation command is:

```powershell
& 'C:\Program Files (x86)\dotnet\dotnet.exe' build tools/ManifestCheck/ManifestCheck.csproj --configfile NuGet.Config -p:MSBuildEnableWorkloadResolver=false
& 'C:\Program Files\dotnet\dotnet.exe' exec --roll-forward Major tools/ManifestCheck/bin/Debug/net9.0/ManifestCheck.dll 'D:\Steam\steamapps\common\Slay the Spire 2\data_sts2_windows_x86_64' ModStudioCardSmoke.json
```

The x86 SDK can compile the Mod, but an x86 process cannot execute the game's x64 assembly for this parser check. The Sentry GDExtension notice from the standalone check is expected outside a running Godot game. The corrected manifest is deployed in the active game package.

## API provenance

Compiled against the installed `sts2.dll`, `GodotSharp.dll`, and `mods/BaseLib/BaseLib.dll` rather than assuming the application's old `RitsuMod` template is compatible. `tools/ApiProbe` reads assembly metadata without executing game code; `api-snapshot.txt` records the inspected signatures.

- [BaseLib v3.4.7 CustomCardModel](https://github.com/Alchyr/BaseLib-StS2/blob/c070755d11ec062f6c97c4dda1a205d975ed066a/Abstracts/CustomCardModel.cs)
- [BaseLib pool registration](https://github.com/Alchyr/BaseLib-StS2/blob/c070755d11ec062f6c97c4dda1a205d975ed066a/Patches/Content/ContentPatches.cs)
- [BaseLib in-code localization](https://github.com/Alchyr/BaseLib-StS2/blob/c070755d11ec062f6c97c4dda1a205d975ed066a/Abstracts/ILocalizationProvider.cs)
- [Author's content template](https://github.com/Alchyr/ModTemplate-StS2/tree/48151e01a97be713286f27c7f00511d4dc1cacec/content/ContentModTemplate)
