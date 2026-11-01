using ModStudioCardSmoke;

var cases = new (int Slot, string Path, string Current, string Original, string Expected, string Imported, bool Allowed)[]
{
    (2, "user://steam/test/modded/profile2", "test-before", "original", "test-before", "test-copy", true),
    (2, "user://steam/test/modded/profile2", "test-copy", "original", "test-before", "test-copy", true),
    (1, "user://steam/test/profile1", "original", "original", "test-before", "test-copy", false),
    (2, "user://steam/test/profile2", "test-before", "original", "test-before", "test-copy", false),
    (1, "user://steam/test/modded/profile1", "test-before", "original", "test-before", "test-copy", false),
    (3, "user://steam/test/modded/profile3", "test-before", "original", "test-before", "test-copy", false),
    (2, "user://steam/test/modded/profile2", "original", "original", "original", "test-copy", false),
    (2, "user://steam/test/modded/profile2", "other-profile", "original", "test-before", "test-copy", false),
    (2, "user://steam/test/modded/profile2", "test-before", "original", "test-before", "original", false),
    (2, "user://steam/test/modded/profile20", "test-before", "original", "test-before", "test-copy", false),
    (2, "user://steam/test/modded/profile2", "", "original", "test-before", "test-copy", false)
};
foreach (var test in cases)
    if (TestProfilePolicy.AllowsImport(test.Slot, test.Path, test.Current, test.Original, test.Expected, test.Imported) != test.Allowed)
        throw new InvalidOperationException($"Profile isolation invariant failed for slot {test.Slot}, path {test.Path}.");
Console.WriteLine($"PASS: {cases.Length} profile-isolation cases; original/non-modded/other-slot/foreign-identity imports rejected.");
