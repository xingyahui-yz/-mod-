using System.Security.Cryptography;
using System.Text.Json;
using HarmonyLib;
using MegaCrit.Sts2.Core.Models;
using MegaCrit.Sts2.Core.Models.CardPools;
using MegaCrit.Sts2.Core.Models.Characters;
using MegaCrit.Sts2.Core.Saves;
using MegaCrit.Sts2.Core.Saves.Managers;
using MegaCrit.Sts2.Core.Saves.Validation;
using ModStudioCardSmoke.Cards;

namespace ModStudioCardSmoke;

// Test harness only: run after cloud synchronization and normal profile loading.
// No import is possible without a matching, explicitly prepared session for modded slot 2.
[HarmonyPatch(typeof(SaveManager), nameof(SaveManager.InitProgressData))]
internal static class TestProfileBootstrap
{
    private static string? _preparedIdentity;
    internal static bool IsActivePreparedTestProfile => _preparedIdentity is not null
        && SaveManager.Instance.CurrentProfileId == 2
        && SaveManager.Instance.GetProfileScopedPath("").Replace('\\', '/').TrimEnd('/').EndsWith("/modded/profile2", StringComparison.Ordinal)
        && SaveManager.Instance.Progress.UniqueId == _preparedIdentity;

    private sealed record Session(string SessionRoot, string ProgressFile, string Sha256,
        string ExpectedTargetIdentity, string OriginalIdentity, string SessionId);

    [HarmonyPostfix]
    private static void AfterProgressLoaded(SaveManager __instance)
    {
        _preparedIdentity = null;
        var configPath = Path.Combine(Godot.OS.GetUserDataDir(), "modstudio-card-test-session.json");
        if (!File.Exists(configPath)) return;
        try
        {
            var path = __instance.GetProfileScopedPath("").Replace('\\', '/').TrimEnd('/');
            if (__instance.CurrentProfileId != 2 || !path.EndsWith("/modded/profile2", StringComparison.Ordinal))
            {
                Main.Logger.Info("[CardTest] Import skipped: active profile is not isolated modded slot 2.");
                return;
            }
            var session = JsonSerializer.Deserialize<Session>(File.ReadAllText(configPath))
                ?? throw new InvalidDataException("Missing prepared test session.");
            var root = Path.GetFullPath(session.SessionRoot);
            if (!Path.GetFileName(root).StartsWith("card-test-session-", StringComparison.Ordinal)
                || Path.GetFileName(Path.GetDirectoryName(root)) != ".diagnostics"
                || !Path.GetFullPath(session.ProgressFile).StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("Prepared test data is outside the isolated workspace snapshot.");
            var marker = Path.Combine(session.SessionRoot, "import-completed.json");
            var bytes = File.ReadAllBytes(session.ProgressFile);
            if (!Convert.ToHexString(SHA256.HashData(bytes)).Equals(session.Sha256, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("Prepared progress checksum mismatch.");
            var parsed = SaveManager.FromJson<SerializableProgress>(System.Text.Encoding.UTF8.GetString(bytes));
            if (!parsed.Success || parsed.SaveData is null || parsed.SaveData.UniqueId == session.OriginalIdentity)
                throw new InvalidDataException("The game parser rejected the distinct test progress.");
            if (!TestProfilePolicy.AllowsImport(__instance.CurrentProfileId, path, __instance.Progress.UniqueId,
                    session.OriginalIdentity, session.ExpectedTargetIdentity, parsed.SaveData.UniqueId))
                throw new InvalidDataException("The active save is outside the prepared isolated test profile.");
            if (__instance.Progress.UniqueId == parsed.SaveData.UniqueId) { AuditPool(__instance, session.SessionRoot); return; }
            var context = new DeserializationContext();
            var imported = ProgressState.FromSerializable(parsed.SaveData, context);
            if (context.HasFatal) throw new InvalidDataException("Progress validation reported a fatal error.");
            var manager = GetProgressManager(__instance);
            var previous = __instance.Progress;
            File.WriteAllText(Path.Combine(session.SessionRoot, "runtime-test-progress-before-import.json"),
                SaveManager.ToJson(previous.ToSerializable()));
            try
            {
                __instance.Progress = imported;
                manager.SaveProgress(); // Use the game's ordinary local + cloud save backend.
            }
            catch { __instance.Progress = previous; throw; }
            File.WriteAllText(marker, JsonSerializer.Serialize(new
            {
                session.SessionId, Slot = 2, ImportedAtUtc = DateTime.UtcNow,
                DiscoveredCards = imported.DiscoveredCards.Count, Epochs = imported.Epochs.Count,
                OriginalIdentityDifferent = imported.UniqueId != session.OriginalIdentity
            }));
            Main.Logger.Info($"[CardTest] Imported prepared unlock progress into modded/profile2 using game save API: cards={imported.DiscoveredCards.Count}, epochs={imported.Epochs.Count}.");
            AuditPool(__instance, session.SessionRoot);
        }
        catch (Exception exception)
        {
            Main.Logger.Warn("[CardTest] Test-profile preparation did not pass: " + exception.Message);
        }
    }

    private static ProgressSaveManager GetProgressManager(SaveManager manager) =>
        AccessTools.Field(typeof(SaveManager), "_progressSaveManager")?.GetValue(manager) as ProgressSaveManager
        ?? throw new InvalidOperationException("Installed game has a different progress-manager contract.");

    private static void AuditPool(SaveManager manager, string sessionRoot)
    {
        _preparedIdentity = manager.Progress.UniqueId;
        var card = ModelDb.Card<StudioStrike>();
        if (manager.Progress.MarkCardAsSeen(card.Id))
        {
            GetProgressManager(manager).SaveProgress();
            Main.Logger.Info("[CardTest] Marked test card discovered for isolated profile's library preview.");
        }
        var pool = card.Pool;
        var inPool = pool is IroncladCardPool && pool.AllCards.Any(candidate => candidate is StudioStrike);
        var unlocked = pool.GetUnlockedCards(GetProgressManager(manager).GenerateUnlockState(), default)
            .Any(candidate => candidate is StudioStrike);
        File.WriteAllText(Path.Combine(sessionRoot, "runtime-card-pool-check.json"), JsonSerializer.Serialize(new
        {
            Slot = manager.CurrentProfileId, Pool = pool.GetType().Name, InPool = inPool,
            Unlocked = unlocked, Rarity = card.Rarity.ToString(), Type = card.Type.ToString(),
            CompendiumAvailable = manager.IsCompendiumAvailable(),
            Discovered = manager.Progress.DiscoveredCards.Contains(card.Id),
            StartingDeckCopies = ModelDb.Character<Ironclad>().StartingDeck.Count(candidate => candidate is StudioStrike),
            CheckedAtUtc = DateTime.UtcNow
        }));
        Main.Logger.Info($"[CardTest] Actual pool audit: pool={pool.GetType().Name}, contains={inPool}, unlocked={unlocked}, compendium={manager.IsCompendiumAvailable()}.");
    }
}
