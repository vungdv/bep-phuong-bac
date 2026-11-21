using System.ClientModel.Primitives;
using Bpb.Workflows.Llm.Options;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.Logging;
using OpenAI;

namespace Bpb.Workflows.Llm.Client;

/// <summary>Builds the production <see cref="IChatClient"/>: the OpenAI SDK client against <c>{Endpoint}/v1</c> (Ollama, vLLM, llama.cpp, hosted providers) with OpenTelemetry and logging, and nothing else.</summary>
public static class LlmChatClientFactory
{
    /// <summary><see cref="System.Diagnostics.ActivitySource"/> / meter name of the GenAI spans; harmless until an exporter listens for it.</summary>
    public const string TelemetrySource = "Bpb.Workflows.Llm.GenAI";

    // Ollama ignores the key; the SDK refuses an empty one.
    private const string PlaceholderApiKey = "not-needed";
    private static readonly Uri Unconfigured = new("http://unconfigured.invalid/v1");

    public static bool IsConfigured(LlmOptions o) => TryEndpoint(o, out _);

    public static IChatClient Create(LlmOptions o, ILoggerFactory loggerFactory, HttpClient? http = null)
    {
        var sdk = new OpenAIClientOptions
        {
            Endpoint = TryEndpoint(o, out var uri) ? uri : Unconfigured,
            // MeaiLlmClient owns the one time limit and the no-retry rule: switch off the SDK's own timeout (100 s) and retries (3).
            NetworkTimeout = Timeout.InfiniteTimeSpan,
            RetryPolicy = new ClientRetryPolicy(0),
        };
        if (http is not null) sdk.Transport = new HttpClientPipelineTransport(http);

        var key = string.IsNullOrEmpty(o.ApiKey) ? PlaceholderApiKey : o.ApiKey;
        var inner = new OpenAIClient(new System.ClientModel.ApiKeyCredential(key), sdk).GetChatClient(o.Model).AsIChatClient();

        // No UseFunctionInvocation: the tool is never run (single shot).
        return new ChatClientBuilder(inner)
            .UseOpenTelemetry(loggerFactory, TelemetrySource) // prompts/replies are not recorded (EnableSensitiveData stays false)
            .UseLogging(new ContentFreeLoggerFactory(loggerFactory))
            .Build();
    }

    private static bool TryEndpoint(LlmOptions o, out Uri uri)
    {
        uri = Unconfigured;
        return !string.IsNullOrWhiteSpace(o.Endpoint)
            && Uri.TryCreate(o.Endpoint.TrimEnd('/') + "/v1", UriKind.Absolute, out uri!);
    }

    /// <summary>
    /// The logging middleware writes prompts and replies at Trace, and logs failures with the exception object, whose message can
    /// embed the HTTP response body (which may echo the prompt). Trace is reported as disabled; everything else is logged as its
    /// level and a fixed text, without the exception or any structured values.
    /// </summary>
    private sealed class ContentFreeLoggerFactory(ILoggerFactory inner) : ILoggerFactory
    {
        public ILogger CreateLogger(string categoryName) => new Capped(inner.CreateLogger(categoryName));
        public void AddProvider(ILoggerProvider provider) => inner.AddProvider(provider);
        public void Dispose() { }

        private sealed class Capped(ILogger inner) : ILogger
        {
            public IDisposable? BeginScope<TState>(TState state) where TState : notnull => inner.BeginScope(state);
            public bool IsEnabled(LogLevel logLevel) => logLevel != LogLevel.Trace && inner.IsEnabled(logLevel);
            public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
            {
                if (!IsEnabled(logLevel)) return;
                var text = logLevel >= LogLevel.Warning
                    ? "LLM chat client call failed" + (exception is null ? "" : " (" + exception.GetType().Name + ")")
                    : "LLM chat client call";
                inner.Log(logLevel, eventId, text, null, static (m, _) => m);
            }
        }
    }
}
