using System.ClientModel;
using System.Text.Json;
using Bpb.Workflows.Llm.Options;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Bpb.Workflows.Llm.Client;

/// <summary>
/// <see cref="ILlmClient"/> over <see cref="IChatClient"/> (Microsoft.Extensions.AI). One request: the system prompt as system
/// message, the untrusted text as the only user message, temperature 0, <see cref="ChatToolMode.RequireAny"/> and the tools as
/// schema-only declarations. The tool is never run, no tool result is sent back and there is no retry: the pipeline built in
/// <see cref="LlmChatClientFactory"/> has no function invocation. The only time limit is <see cref="LlmOptions.TimeoutSeconds"/>
/// on a <see cref="CancellationTokenSource"/>.
/// </summary>
public sealed class MeaiLlmClient(IChatClient chat, IOptions<LlmOptions> options, ILogger<MeaiLlmClient> logger) : ILlmClient
{
    /// <summary>Stand-in for arguments that were not JSON; the activity's schema check then reports "arguments are not valid JSON".</summary>
    private const string NotJson = "<unparseable arguments>";

    public async Task<LlmCompletion> CompleteAsync(LlmRequest request, CancellationToken cancellationToken = default)
    {
        var o = options.Value;
        if (!LlmChatClientFactory.IsConfigured(o)) throw new LlmClientException("endpoint not configured");

        var messages = new List<ChatMessage>(2);
        if (!string.IsNullOrWhiteSpace(request.SystemPrompt)) messages.Add(new ChatMessage(ChatRole.System, request.SystemPrompt));
        messages.Add(new ChatMessage(ChatRole.User, request.UserPrompt));

        var chatOptions = new ChatOptions
        {
            ModelId = string.IsNullOrWhiteSpace(request.Model) ? o.Model : request.Model,
            Temperature = 0,
            ToolMode = ChatToolMode.RequireAny,
            Tools = [.. request.Tools.Select(t => (AITool)AIFunctionFactory.CreateDeclaration(
                t.Name, string.IsNullOrWhiteSpace(t.Description) ? null : t.Description, JsonSerializer.SerializeToElement(t.Parameters)))],
        };

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(o.Timeout);

        ChatResponse response;
        try
        {
            response = await chat.GetResponseAsync(messages, chatOptions, timeout.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            throw new LlmClientException($"timeout after {o.Timeout.TotalSeconds:0.##}s");
        }
        catch (ClientResultException e) when (e.Status > 0)
        {
            throw new LlmClientException($"HTTP {e.Status}", e);
        }
        catch (Exception e) when (e is HttpRequestException || e.InnerException is HttpRequestException)
        {
            throw new LlmClientException("connection failed: " + nameof(HttpRequestException), e);
        }
        catch (ArgumentOutOfRangeException e)
        {
            // The OpenAI adapter indexes choices[0]: a body without choices ({"choices":[]}) surfaces as this exception.
            throw new LlmClientException("empty response", e);
        }
        catch (Exception e) when (e is JsonException or FormatException || e.InnerException is JsonException)
        {
            throw new LlmClientException("unparseable response", e);
        }

        if (response.Messages.Count == 0) throw new LlmClientException("empty response");

        // Single shot: only the first call counts.
        var call = response.Messages.SelectMany(m => m.Contents).OfType<FunctionCallContent>().FirstOrDefault();
        if (call is null) return new LlmCompletion(null);
        if (string.IsNullOrEmpty(call.Name)) throw new LlmClientException("unparseable response");

        var args = call.Exception is not null ? NotJson
            : call.Arguments is null ? ""
            : JsonSerializer.Serialize(call.Arguments);
        logger.LogDebug("LLM replied with tool call {ToolName}", call.Name);
        return new LlmCompletion(new LlmToolCall(call.Name, args));
    }
}
