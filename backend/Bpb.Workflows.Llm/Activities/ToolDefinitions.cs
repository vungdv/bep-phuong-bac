using System.Text.Json;
using System.Text.Json.Nodes;
using Bpb.Workflows.Llm.Client;
using Json.Schema;

namespace Bpb.Workflows.Llm.Activities;

/// <summary>
/// The tool definitions an author writes in the editor: a JSON array of
/// <c>{ "name": "...", "description": "...", "parameters": { JSON Schema of the arguments } }</c>.
/// </summary>
public sealed class ToolDefinitions
{
    private readonly Dictionary<string, JsonSchema> _schemas;

    private ToolDefinitions(IReadOnlyList<LlmTool> tools, Dictionary<string, JsonSchema> schemas)
    {
        Tools = tools;
        _schemas = schemas;
    }

    public IReadOnlyList<LlmTool> Tools { get; }

    public IEnumerable<string> Names => Tools.Select(t => t.Name);

    /// <summary>Parses the setting; throws <see cref="FormatException"/> with a message safe to show to the author.</summary>
    public static ToolDefinitions Parse(string? json)
    {
        JsonNode? root;
        try { root = JsonNode.Parse(string.IsNullOrWhiteSpace(json) ? "[]" : json); }
        catch (JsonException) { throw new FormatException("Tools must be valid JSON."); }
        if (root is not JsonArray array) throw new FormatException("Tools must be a JSON array.");

        var tools = new List<LlmTool>();
        var schemas = new Dictionary<string, JsonSchema>(StringComparer.Ordinal);
        foreach (var item in array)
        {
            if (item is not JsonObject o) throw new FormatException("Each tool must be a JSON object.");
            var name = o["name"] is JsonValue v && v.GetValueKind() == JsonValueKind.String ? v.GetValue<string>().Trim() : "";
            if (name.Length == 0) throw new FormatException("Each tool needs a non-empty name.");
            if (!schemas.TryAdd(name, null!)) throw new FormatException($"Tool name '{name}' is used twice.");
            var parameters = o["parameters"] ?? new JsonObject { ["type"] = "object", ["properties"] = new JsonObject() };
            if (parameters is not JsonObject) throw new FormatException($"Tool '{name}': parameters must be a JSON Schema object.");
            try { schemas[name] = JsonSchema.FromText(parameters.ToJsonString()); }
            catch (Exception e) when (e is JsonException or JsonSchemaException) { throw new FormatException($"Tool '{name}': parameters is not a valid JSON Schema."); }
            string? description = null;
            if (o["description"] is { } d)
            {
                if (d is not JsonValue dv || dv.GetValueKind() != JsonValueKind.String) throw new FormatException($"Tool '{name}': description must be a string.");
                description = dv.GetValue<string>();
            }
            tools.Add(new LlmTool(name, description, parameters));
        }
        return new ToolDefinitions(tools, schemas);
    }

    /// <summary>True when <paramref name="argumentsJson"/> is a JSON value that satisfies the schema of the named tool.</summary>
    public bool TryValidate(string toolName, string argumentsJson, out string? error)
    {
        error = null;
        if (!_schemas.TryGetValue(toolName, out var schema)) { error = "unknown tool"; return false; }
        JsonNode? args;
        try { args = JsonNode.Parse(string.IsNullOrWhiteSpace(argumentsJson) ? "{}" : argumentsJson); }
        catch (JsonException) { error = "arguments are not valid JSON"; return false; }
        if (args is not JsonObject) { error = "arguments are not a JSON object"; return false; }
        var result = schema.Evaluate(args, new EvaluationOptions { OutputFormat = OutputFormat.List });
        if (!result.IsValid) { error = "arguments do not match the tool schema"; return false; }
        return true;
    }
}
