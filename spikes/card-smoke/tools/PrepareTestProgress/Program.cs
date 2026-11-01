using System.Reflection;
using System.Runtime.Loader;
using System.Text.Json;
using System.Text.Json.Nodes;

var gameData = Path.GetFullPath(args[0]);
var sourcePath = Path.GetFullPath(args[1]);
var outputPath = Path.GetFullPath(args[2]);
if (File.Exists(outputPath)) throw new IOException("Refusing to replace an existing staged test progress file.");
AssemblyLoadContext.Default.Resolving += (context, name) =>
{
    var path = Path.Combine(gameData, name.Name + ".dll");
    return File.Exists(path) ? context.LoadFromAssemblyPath(path) : null;
};
var assembly = AssemblyLoadContext.Default.LoadFromAssemblyPath(Path.Combine(gameData, "sts2.dll"));
var type = assembly.GetType("MegaCrit.Sts2.Core.Saves.SerializableProgress", throwOnError: true)!;
var fresh = Activator.CreateInstance(type)!;
var uniqueId = (string?)type.GetProperty("UniqueId")!.GetValue(fresh);
var source = JsonNode.Parse(File.ReadAllText(sourcePath))!.AsObject();
if (source["schema_version"]!.GetValue<int>() != 24 || string.IsNullOrWhiteSpace(uniqueId)
    || uniqueId == source["unique_id"]!.GetValue<string>())
    throw new InvalidDataException("Unexpected progress schema or duplicate generated profile identity.");
var copy = source.DeepClone().AsObject();
copy["unique_id"] = uniqueId;
var comparison = copy.DeepClone().AsObject();
comparison["unique_id"] = source["unique_id"]!.GetValue<string>();
if (!JsonNode.DeepEquals(source, comparison)) throw new InvalidDataException("The copy changed fields other than its identity.");
Directory.CreateDirectory(Path.GetDirectoryName(outputPath)!);
File.WriteAllText(outputPath, copy.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
Console.WriteLine($"PASS: isolated progress staged; game-generated identity is distinct; only unique_id changed; {copy["discovered_cards"]!.AsArray().Count} discovered cards and {copy["epochs"]!.AsArray().Count} epochs preserved.");
