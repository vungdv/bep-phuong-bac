using System.Text.Json.Nodes;

namespace Bpb.Workflows.Llm.Client;

/// <summary>A tool the model may call: a name, a description and the JSON Schema of its arguments.</summary>
public sealed record LlmTool(string Name, string? Description, JsonNode Parameters);

public sealed record LlmRequest(string? Model, string SystemPrompt, string UserPrompt, IReadOnlyList<LlmTool> Tools);

/// <summary>The first tool call of the reply. <see cref="ArgumentsJson"/> is untrusted, as the server sent it.</summary>
public sealed record LlmToolCall(string Name, string ArgumentsJson);

/// <summary>The reply of one request. <see cref="ToolCall"/> is null when the model answered without calling a tool.</summary>
public sealed record LlmCompletion(LlmToolCall? ToolCall);

/// <summary>The request could not produce a reply (not configured, timeout, HTTP error, empty or unparseable body).</summary>
public sealed class LlmClientException(string reason, Exception? inner = null) : Exception(reason, inner)
{
    /// <summary>A short, safe reason: never contains prompts, message text, response bodies or secrets.</summary>
    public string Reason => Message;
}

/// <summary>One single-shot chat completion with forced tool calling. No retry and no follow-up turn.</summary>
public interface ILlmClient
{
    Task<LlmCompletion> CompleteAsync(LlmRequest request, CancellationToken cancellationToken = default);
}
