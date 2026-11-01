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

## Acceptance evidence (pending)

1. Restart the game and enable **BaseLib** and **Mod Studio Card Smoke** in its Mod settings.
2. Confirm **工坊试击** appears among Ironclad's cards in the card library. This confirms display/registration; it does not yet prove a normal reward or combat.
3. Start an ordinary Ironclad run and obtain **工坊试击** from a normal reward or shop. Record where it was obtained and the run seed; do not use a console grant or replace the starting deck for this check.
4. Play the unupgraded card against an enemy with no Block and no damage modifiers. Record before/after HP and the card's damage display. Expected HP loss: **6**. Upgrade verification, if performed in the run, expects **9** under the same conditions.
5. Check `%APPDATA%/SlayTheSpire2/logs/godot.log` for `ModStudioCardSmoke`. The initializer records registration; `StudioStrike played:` records base damage and HP/Block before and after the actual attack. Log output supplements the observed game result.

The Card stage remains **incomplete** until normal-pool acquisition and in-combat damage are both observed.

## API provenance

Compiled against the installed `sts2.dll`, `GodotSharp.dll`, and `mods/BaseLib/BaseLib.dll` rather than assuming the application's old `RitsuMod` template is compatible. `tools/ApiProbe` reads assembly metadata without executing game code; `api-snapshot.txt` records the inspected signatures.

- [BaseLib v3.4.7 CustomCardModel](https://github.com/Alchyr/BaseLib-StS2/blob/c070755d11ec062f6c97c4dda1a205d975ed066a/Abstracts/CustomCardModel.cs)
- [BaseLib pool registration](https://github.com/Alchyr/BaseLib-StS2/blob/c070755d11ec062f6c97c4dda1a205d975ed066a/Patches/Content/ContentPatches.cs)
- [BaseLib in-code localization](https://github.com/Alchyr/BaseLib-StS2/blob/c070755d11ec062f6c97c4dda1a205d975ed066a/Abstracts/ILocalizationProvider.cs)
- [Author's content template](https://github.com/Alchyr/ModTemplate-StS2/tree/48151e01a97be713286f27c7f00511d4dc1cacec/content/ContentModTemplate)
