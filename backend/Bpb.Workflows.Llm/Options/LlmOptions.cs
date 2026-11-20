namespace Bpb.Workflows.Llm.Options;

/// <summary>
/// Connection settings, bound from the shell configuration section <c>Bpb:Llm</c> (environment variables
/// <c>OrchardCore__Bpb__Llm__Endpoint</c>, ...). Nothing here comes from source except the non-secret defaults.
/// </summary>
public sealed class LlmOptions
{
    public const string Section = "Bpb:Llm";
    public const int DefaultTimeoutSeconds = 120;

    /// <summary>Base URL of an OpenAI-compatible server; <c>/v1/chat/completions</c> is appended. Empty means "not configured".</summary>
    public string? Endpoint { get; set; } = "http://ollama:11434";

    /// <summary>Default model id; a workflow can override it per activity.</summary>
    public string Model { get; set; } = "qwen2.5:7b-instruct";

    /// <summary>Time allowed for the one request. Values of zero or less fall back to the default.</summary>
    public int TimeoutSeconds { get; set; } = DefaultTimeoutSeconds;

    /// <summary>Optional bearer token for hosted servers. Configuration only; never logged.</summary>
    public string? ApiKey { get; set; }

    public TimeSpan Timeout => TimeSpan.FromSeconds(TimeoutSeconds > 0 ? TimeoutSeconds : DefaultTimeoutSeconds);
}
