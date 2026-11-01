# Card compatibility smoke package

Standalone experiment for the locally installed STS2 **v0.111.0** (Steam build ID `24724944`) with **BaseLib v3.4.7**. The screenshot of BaseLib's in-game configuration page confirms that the dependency runs; the Card experiment still requires game validation.

## Card

- ID/class: `StudioStrike`; title: **工坊试击**.
- Pool: `IroncladCardPool`, rarity: `Common`, target: one enemy.
- Cost: 1 energy. Base damage: 6; upgraded base damage: 9.
- Uses the game's normal attack command, so Strength, Weak, Vulnerable, enemy Block, and other normal modifiers apply. Use an unupgraded card against an enemy with no Block and no damage modifiers to expect a 6-HP reduction.
- Uses the existing Ironclad Strike portrait at runtime. No copied game assets, external image, PCK, installed template, or NuGet package is required.
- Adds the card to the regular pool. It does not insert cards into starting decks or force rewards.

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

Enabling this gameplay-affecting test Mod switched the game to `steam/<account>/modded/profile1`. That profile had only 1,166 bytes of progress and no run history, while the original `profile1` retained a 273,359-byte progress file and 88 runs. The user reported missing progress and the card-library entry, so the experiment was stopped. Both save trees were backed up (174 files, 17,830,592 bytes, all SHA-256 verified), and the test Mod and BaseLib were moved to `.modstudio-disabled-mods/`. No save was copied over another save. The next startup log returned to the original `profile1`, and the user confirmed original progress and the card-library entry both recovered. The experiment remains disabled until a separate test save is prepared.

Future playtests must explicitly prepare a separate test profile and back up both original and modded data before enabling gameplay Mods. Do not mark this content Mod as cosmetic to bypass save separation. An unavailable card-library entry in a new modded profile does not establish that card-pool registration failed.

## Acceptance evidence (pending; currently disabled)

1. Restart the game and enable **BaseLib** and **Mod Studio Card Smoke** in its Mod settings.
2. Confirm **工坊试击** appears among Ironclad's cards in the card library. This confirms display/registration; it does not yet prove a normal reward or combat.
3. Start an ordinary Ironclad run and obtain **工坊试击** from a normal reward or shop. Record where it was obtained and the run seed; do not use a console grant or replace the starting deck for this check.
4. Play the unupgraded card against an enemy with no Block and no damage modifiers. Record before/after HP and the card's damage display. Expected HP loss: **6**. Upgrade verification, if performed in the run, expects **9** under the same conditions.
5. Check `%APPDATA%/SlayTheSpire2/logs/godot.log` for `ModStudioCardSmoke`. The initializer records registration; `StudioStrike played:` records base damage and HP/Block before and after the actual attack. Log output supplements the observed game result.

The Card stage remains **incomplete** until normal-pool acquisition and in-combat damage are both observed.

## Manifest validation

The initial package used legacy string dependencies. The game loaded it but logged an ERROR, causing the red "loaded mods but detected errors" status. The source manifest now requires `{"id":"BaseLib","min_version":"3.4.7"}`. `tools/ManifestCheck` rejects legacy strings and invokes the **installed game's own `ModManifest.ReadFromStream`** parser; the corrected manifest passes with zero parser errors.

Build the validator with the same offline SDK setup as `build.ps1`, then run it with an installed **x64** .NET 9 or later runtime. This machine has an x64 .NET 10 host, so the validation command is:

```powershell
& 'C:\Program Files (x86)\dotnet\dotnet.exe' build tools/ManifestCheck/ManifestCheck.csproj --configfile NuGet.Config -p:MSBuildEnableWorkloadResolver=false
& 'C:\Program Files\dotnet\dotnet.exe' exec --roll-forward Major tools/ManifestCheck/bin/Debug/net9.0/ManifestCheck.dll 'D:\Steam\steamapps\common\Slay the Spire 2\data_sts2_windows_x86_64' ModStudioCardSmoke.json
```

The x86 SDK can compile the Mod, but an x86 process cannot execute the game's x64 assembly for this parser check. The Sentry GDExtension notice from the standalone check is expected outside a running Godot game. The corrected manifest is in the source/output package; the disabled game package is retained as it was when the incident occurred.

## API provenance

Compiled against the installed `sts2.dll`, `GodotSharp.dll`, and `mods/BaseLib/BaseLib.dll` rather than assuming the application's old `RitsuMod` template is compatible. `tools/ApiProbe` reads assembly metadata without executing game code; `api-snapshot.txt` records the inspected signatures.

- [BaseLib v3.4.7 CustomCardModel](https://github.com/Alchyr/BaseLib-StS2/blob/c070755d11ec062f6c97c4dda1a205d975ed066a/Abstracts/CustomCardModel.cs)
- [BaseLib pool registration](https://github.com/Alchyr/BaseLib-StS2/blob/c070755d11ec062f6c97c4dda1a205d975ed066a/Patches/Content/ContentPatches.cs)
- [BaseLib in-code localization](https://github.com/Alchyr/BaseLib-StS2/blob/c070755d11ec062f6c97c4dda1a205d975ed066a/Abstracts/ILocalizationProvider.cs)
- [Author's content template](https://github.com/Alchyr/ModTemplate-StS2/tree/48151e01a97be713286f27c7f00511d4dc1cacec/content/ContentModTemplate)
