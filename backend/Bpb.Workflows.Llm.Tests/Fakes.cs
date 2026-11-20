using System.Net;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json.Nodes;
using Bpb.Workflows.Llm.Client;
using Bpb.Workflows.Llm.Options;
using Microsoft.Extensions.Localization;
using Microsoft.Extensions.Logging;
using OrchardCore.Workflows.Models;
using OrchardCore.Workflows.Services;

namespace Bpb.Workflows.Llm.Tests;

/// <summary>Records the requests and replies with a scripted completion or exception. Counts calls.</summary>
public sealed class FakeLlmClient : ILlmClient
{
    public List<LlmRequest> Requests { get; } = new();
    public Func<LlmRequest, LlmCompletion> Reply { get; set; } = _ => new LlmCompletion(null);
    public Exception? Throw { get; set; }

    public Task<LlmCompletion> CompleteAsync(LlmRequest request, CancellationToken cancellationToken = default)
    {
        Requests.Add(request);
        if (Throw is not null) throw Throw;
        return Task.FromResult(Reply(request));
    }

    public static FakeLlmClient Calling(string tool, string args) => new() { Reply = _ => new LlmCompletion(new LlmToolCall(tool, args)) };
}

/// <summary>A fake HttpMessageHandler: records every request (with body) and answers through a delegate.</summary>
public sealed class FakeHandler(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> respond) : HttpMessageHandler
{
    public List<HttpRequestMessage> Requests { get; } = new();
    public List<string> Bodies { get; } = new();

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        Requests.Add(request);
        Bodies.Add(request.Content is null ? "" : await request.Content.ReadAsStringAsync(cancellationToken));
        return await respond(request, cancellationToken);
    }

    public static FakeHandler Json(string body, HttpStatusCode status = HttpStatusCode.OK) =>
        new((_, _) => Task.FromResult(new HttpResponseMessage(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") }));

    public static FakeHandler Hanging() =>
        new(async (_, ct) => { await Task.Delay(Timeout.Infinite, ct); return new HttpResponseMessage(); });
}

public static class Replies
{
    public static string ToolCall(string name, string arguments) => new JsonObject
    {
        ["choices"] = new JsonArray(new JsonObject
        {
            ["message"] = new JsonObject
            {
                ["role"] = "assistant",
                ["content"] = "",
                ["tool_calls"] = new JsonArray(new JsonObject
                {
                    ["id"] = "call_1", ["type"] = "function",
                    ["function"] = new JsonObject { ["name"] = name, ["arguments"] = arguments },
                }),
            },
        }),
    }.ToJsonString();
}

public static class Clients
{
    public static ChatCompletionsClient Create(FakeHandler handler, LlmOptions? options = null, ILogger<ChatCompletionsClient>? logger = null) =>
        new(new HttpClient(handler) { Timeout = Timeout.InfiniteTimeSpan },
            Microsoft.Extensions.Options.Options.Create(options ?? new LlmOptions { Endpoint = "http://llm.test" }),
            logger ?? new CapturingLogger<ChatCompletionsClient>());
}

/// <summary>Collects every log entry at every level, message and structured values, so tests can prove nothing sensitive is logged.</summary>
public sealed class CapturingLogger<T> : ILogger<T>
{
    public List<string> Entries { get; } = new();
    private readonly List<string> _scopes = new();
    public IDisposable? BeginScope<TState>(TState state) where TState : notnull
    {
        var text = state is IEnumerable<KeyValuePair<string, object>> kv ? string.Join(" ", kv.Select(p => $"{p.Key}={p.Value}")) : state.ToString() ?? "";
        _scopes.Add(text);
        return new Scope(() => _scopes.Remove(text));
    }
    public bool IsEnabled(LogLevel logLevel) => true;

    private sealed class Scope(Action end) : IDisposable { public void Dispose() => end(); }

    public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
    {
        var text = formatter(state, exception);
        if (state is IEnumerable<KeyValuePair<string, object?>> kv) text += " " + string.Join(" ", kv.Select(p => $"{p.Key}={p.Value}"));
        if (exception is not null) text += " " + exception;
        if (_scopes.Count > 0) text += " [scope " + string.Join(" ", _scopes) + "]";
        Entries.Add($"{logLevel}: {text}");
    }
}

public sealed class PassThroughLocalizer<T> : IStringLocalizer<T>
{
    public LocalizedString this[string name] => new(name, name);
    public LocalizedString this[string name, params object[] arguments] => new(name, string.Format(name, arguments));
    public IEnumerable<LocalizedString> GetAllStrings(bool includeParentCultures) => Enumerable.Empty<LocalizedString>();
}

/// <summary>
/// Stands in for the Liquid evaluator: replaces <c>{{ Workflow.Input.X.Y }}</c> and <c>{{ Workflow.Properties.X }}</c> by walking
/// the workflow context. Real Liquid is Orchard's own and is covered by the k6 test through the running site.
/// </summary>
public sealed class FakeExpressionEvaluator : IWorkflowExpressionEvaluator
{
    private static readonly System.Text.RegularExpressions.Regex Token = new(@"\{\{\s*Workflow\.(Input|Properties)\.([\w.]+)\s*\}\}");

    public Task<T> EvaluateAsync<T>(WorkflowExpression<T> expression, WorkflowExecutionContext workflowContext, TextEncoder? encoder)
    {
        var text = Token.Replace(expression.Expression ?? "", m =>
        {
            var parts = m.Groups[2].Value.Split('.');
            object? current = (m.Groups[1].Value == "Input" ? workflowContext.Input : workflowContext.Properties).TryGetValue(parts[0], out var root) ? root : null;
            foreach (var p in parts.Skip(1))
                current = current is JsonNode n && n is JsonObject o ? o[p] : null;
            return current switch { null => "", JsonValue v => v.ToString(), var other => other.ToString() ?? "" };
        });
        return Task.FromResult((T)(object)text);
    }
}

public static class Contexts
{
    public static WorkflowExecutionContext New(IDictionary<string, object>? input = null, IDictionary<string, object>? properties = null, string? correlationId = null) =>
        new(new WorkflowType(), new Workflow { CorrelationId = correlationId! }, input ?? new Dictionary<string, object>(), new Dictionary<string, object>(),
            properties ?? new Dictionary<string, object>(), new List<ExecutedActivity>(), null, Enumerable.Empty<ActivityContext>());
}
