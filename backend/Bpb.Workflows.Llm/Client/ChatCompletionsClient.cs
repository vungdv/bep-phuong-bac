using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Bpb.Workflows.Llm.Options;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Bpb.Workflows.Llm.Client;

/// <summary>
/// POST {Endpoint}/v1/chat/completions (the OpenAI-compatible API served by Ollama, vLLM, llama.cpp and hosted providers).
/// One request: <c>tool_choice: required</c>, temperature 0, the system prompt as system message and the untrusted text as
/// the only user message. The tool is never run and no tool result is sent back. The only time limit is
/// <see cref="LlmOptions.TimeoutSeconds"/> on a <see cref="CancellationTokenSource"/>.
/// </summary>
public sealed class ChatCompletionsClient(HttpClient http, IOptions<LlmOptions> options, ILogger<ChatCompletionsClient> logger)
    : ILlmClient
{
    public async Task<LlmCompletion> CompleteAsync(LlmRequest request, CancellationToken cancellationToken = default)
    {
        var o = options.Value;
        if (string.IsNullOrWhiteSpace(o.Endpoint) || !Uri.TryCreate(o.Endpoint.TrimEnd('/') + "/v1/chat/completions", UriKind.Absolute, out var uri))
            throw new LlmClientException("endpoint not configured");

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(o.Timeout);

        using var message = new HttpRequestMessage(HttpMethod.Post, uri)
        {
            Content = new StringContent(BuildBody(request, string.IsNullOrWhiteSpace(request.Model) ? o.Model : request.Model), Encoding.UTF8, "application/json"),
        };
        if (!string.IsNullOrEmpty(o.ApiKey)) message.Headers.Authorization = new AuthenticationHeaderValue("Bearer", o.ApiKey);

        string body;
        try
        {
            using var response = await http.SendAsync(message, HttpCompletionOption.ResponseHeadersRead, timeout.Token).ConfigureAwait(false);
            if (!response.IsSuccessStatusCode) throw new LlmClientException($"HTTP {(int)response.StatusCode}");
            body = await response.Content.ReadAsStringAsync(timeout.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            throw new LlmClientException($"timeout after {o.Timeout.TotalSeconds:0.##}s");
        }
        catch (HttpRequestException e)
        {
            throw new LlmClientException("connection failed: " + e.GetType().Name, e);
        }

        var completion = Parse(body);
        logger.LogDebug("LLM replied with tool call {ToolName}", completion.ToolCall?.Name ?? "(none)");
        return completion;
    }

    private static string BuildBody(LlmRequest request, string model)
    {
        var messages = new JsonArray();
        if (!string.IsNullOrWhiteSpace(request.SystemPrompt))
            messages.Add(new JsonObject { ["role"] = "system", ["content"] = request.SystemPrompt });
        messages.Add(new JsonObject { ["role"] = "user", ["content"] = request.UserPrompt });

        var tools = new JsonArray();
        foreach (var t in request.Tools)
        {
            var fn = new JsonObject { ["name"] = t.Name };
            if (!string.IsNullOrWhiteSpace(t.Description)) fn["description"] = t.Description;
            fn["parameters"] = t.Parameters.DeepClone();
            tools.Add(new JsonObject { ["type"] = "function", ["function"] = fn });
        }

        return new JsonObject
        {
            ["model"] = model,
            ["messages"] = messages,
            ["tools"] = tools,
            ["tool_choice"] = "required",
            ["temperature"] = 0,
            ["stream"] = false,
        }.ToJsonString();
    }

    private static LlmCompletion Parse(string body)
    {
        if (string.IsNullOrWhiteSpace(body)) throw new LlmClientException("empty response");
        JsonNode? root;
        try { root = JsonNode.Parse(body); }
        catch (JsonException e) { throw new LlmClientException("unparseable response", e); }

        if (root is not JsonObject obj) throw new LlmClientException("unparseable response");
        if (obj["choices"] is not JsonArray { Count: > 0 } choices) throw new LlmClientException("empty response");
        if (choices[0]?["message"] is not JsonObject msg) throw new LlmClientException("unparseable response");

        if (msg["tool_calls"] is not JsonArray { Count: > 0 } calls) return new LlmCompletion(null);

        // Single shot: only the first call counts.
        var fn = calls[0]?["function"] as JsonObject;
        var name = fn?["name"]?.GetValueKind() == JsonValueKind.String ? fn["name"]!.GetValue<string>() : null;
        if (string.IsNullOrEmpty(name)) throw new LlmClientException("unparseable response");
        var args = fn!["arguments"] switch
        {
            null => "",
            JsonValue v when v.GetValueKind() == JsonValueKind.String => v.GetValue<string>(),
            var other => other.ToJsonString(), // some servers send an object instead of a string
        };
        return new LlmCompletion(new LlmToolCall(name, args));
    }
}
