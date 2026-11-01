using BaseLib.Patches.Content;
using HarmonyLib;
using MegaCrit.Sts2.Core.Logging;
using MegaCrit.Sts2.Core.Modding;
using ModStudioCardSmoke.Cards;

namespace ModStudioCardSmoke;

[ModInitializer(nameof(Initialize))]
public static class Main
{
    public const string ModId = "ModStudioCardSmoke";
    public static Logger Logger { get; } = new(ModId, LogType.Generic);

    public static void Initialize()
    {
        CustomContentDictionary.AddModel(typeof(StudioStrike));
        new Harmony(ModId).PatchAll(typeof(Main).Assembly);
        Logger.Info("Registered StudioStrike: Ironclad pool, Common, 1 energy, 6 base damage (9 upgraded).");
    }
}
