using System.Collections;
using System.Reflection;
using System.Runtime.Loader;
using System.Text.Json;

var gameData = Path.GetFullPath(args[0]);
var manifestPath = Path.GetFullPath(args[1]);
using (var document = JsonDocument.Parse(File.ReadAllText(manifestPath)))
{
    foreach (var dependency in document.RootElement.GetProperty("dependencies").EnumerateArray())
        if (dependency.ValueKind != JsonValueKind.Object
            || !dependency.TryGetProperty("id", out var id) || string.IsNullOrWhiteSpace(id.GetString())
            || !dependency.TryGetProperty("min_version", out var version) || !Version.TryParse(version.GetString(), out _))
            throw new InvalidDataException("Dependencies must be objects with an ID and minimum version; string dependencies trigger a game startup error.");
}
AssemblyLoadContext.Default.Resolving += (context, name) =>
{
    var path = Path.Combine(gameData, name.Name + ".dll");
    return File.Exists(path) ? context.LoadFromAssemblyPath(path) : null;
};
var assembly = AssemblyLoadContext.Default.LoadFromAssemblyPath(Path.Combine(gameData, "sts2.dll"));
var type = assembly.GetType("MegaCrit.Sts2.Core.Modding.ModManifest", throwOnError: true)!;
var parser = type.GetMethod("ReadFromStream", BindingFlags.Public | BindingFlags.Static)!;
using var stream = File.OpenRead(manifestPath);
object?[] parameters = [stream, null];
var manifest = parser.Invoke(null, parameters) ?? throw new InvalidDataException("Game parser rejected the manifest.");
var errors = ((IEnumerable?)parameters[1])?.Cast<object>().ToArray() ?? [];
if (errors.Length != 0) throw new InvalidDataException($"Game manifest parser reported {errors.Length} errors.");
Console.WriteLine("PASS: versioned dependency objects; installed game's ModManifest parser accepted the manifest with 0 errors.");
