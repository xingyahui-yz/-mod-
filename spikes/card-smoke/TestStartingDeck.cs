using HarmonyLib;
using MegaCrit.Sts2.Core.Models;
using MegaCrit.Sts2.Core.Models.Characters;
using ModStudioCardSmoke.Cards;

namespace ModStudioCardSmoke;

// Explicit user-requested fixture. Regular reward-pool registration stays separate.
[HarmonyPatch(typeof(Ironclad), nameof(Ironclad.StartingDeck), MethodType.Getter)]
internal static class TestStartingDeck
{
    [HarmonyPostfix]
    private static void AddTestCard(ref IEnumerable<CardModel> __result)
    {
        if (!TestProfileBootstrap.IsActivePreparedTestProfile) return;
        var cards = __result.ToList();
        if (cards.All(card => card is not StudioStrike)) cards.Add(ModelDb.Card<StudioStrike>());
        __result = cards;
    }
}
