using System.Reflection;

var gameData = args[0];
var paths = Directory.GetFiles(gameData, "*.dll")
    .Concat(Directory.GetFiles(Path.GetDirectoryName(typeof(object).Assembly.Location)!, "*.dll"))
    .Append(args[1])
    .GroupBy(Path.GetFileName, StringComparer.OrdinalIgnoreCase)
    .Select(group => group.First());
using var context = new MetadataLoadContext(new PathAssemblyResolver(paths));
foreach (var assemblyPath in new[] { Path.Combine(gameData, "sts2.dll"), args[1] })
{
    var assembly = context.LoadFromAssemblyPath(assemblyPath);
    foreach (var type in assembly.GetTypes().Where(type => args.Skip(2).Any(term => type.FullName!.Contains(term))))
    {
        Console.WriteLine($"TYPE {type.FullName} : {type.BaseType}");
        foreach (var member in type.GetMembers(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.Static | BindingFlags.DeclaredOnly))
            if (member is ConstructorInfo or PropertyInfo || member is MethodInfo method && !method.IsSpecialName)
                Console.WriteLine($"  {member}");
    }
}
