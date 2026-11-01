namespace ModStudioCardSmoke;

internal static class TestProfilePolicy
{
    public static bool AllowsImport(int slot, string scopedPath, string currentIdentity,
        string originalIdentity, string expectedTestIdentity, string importedIdentity) =>
        slot == 2
        && scopedPath.Replace('\\', '/').TrimEnd('/').EndsWith("/modded/profile2", StringComparison.Ordinal)
        && !string.IsNullOrWhiteSpace(currentIdentity)
        && !string.IsNullOrWhiteSpace(originalIdentity)
        && !string.IsNullOrWhiteSpace(importedIdentity)
        && currentIdentity != originalIdentity
        && importedIdentity != originalIdentity
        && (currentIdentity == expectedTestIdentity || currentIdentity == importedIdentity);
}
