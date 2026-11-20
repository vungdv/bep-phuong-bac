using System.ClientModel;
using System.ClientModel.Primitives;
using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;
using Bpb.Workflows.Llm.Client;
using Bpb.Workflows.Llm.Options;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.Logging;
using Xunit;

namespace Bpb.Workflows.Llm.Tests;

public class MeaiLlmClientTests
{
    private static readonly LlmTool RecordOrder = new("record_order", "An order", JsonNode.Parse("""{"type":"object","properties":{"qty":{"type":"integer"}},"required":["qty"]}""")!);
    private static readonly LlmRequest Request = new(null, "SYSTEM TEXT", "USER TEXT", [RecordOrder]);

    private static FunctionCallContent Call(string name, string argsJson) =>
        new("call_1", name, JsonSerializer.Deserialize<Dictionary<string, object?>>(argsJson));

    [Fact]
    public async Task Sends_one_request_with_the_documented_shape_and_maps_the_tool_call()
    {
        var chat = FakeChatClient.Returning(Call("record_order", """{"qty":3}"""));
        var result = await Clients.Create(chat, new LlmOptions { Endpoint = "http://llm.test/", Model = "default-model" }).CompleteAsync(Request);

        var (messages, options) = Assert.Single(chat.Calls);
        Assert.Equal(2, messages.Count);
        Assert.Equal(ChatRole.System, messages[0].Role);
        Assert.Equal("SYSTEM TEXT", messages[0].Text);
        Assert.Equal(ChatRole.User, messages[1].Role);
        Assert.Equal("USER TEXT", messages[1].Text);
        Assert.Equal("default-model", options!.ModelId);
        Assert.Equal(0, options.Temperature);
        Assert.IsType<RequiredChatToolMode>(options.ToolMode);
        var tool = Assert.IsAssignableFrom<AIFunctionDeclaration>(Assert.Single(options.Tools!));
        Assert.Equal("record_order", tool.Name);
        Assert.Equal("An order", tool.Description);
        Assert.Equal("object", tool.JsonSchema.GetProperty("type").GetString());
        Assert.Equal("record_order", result.ToolCall!.Name);
        Assert.Equal("""{"qty":3}""", result.ToolCall.ArgumentsJson);
    }

    [Fact]
    public async Task Request_model_overrides_the_configured_model_and_a_blank_system_prompt_is_left_out()
    {
        var chat = FakeChatClient.Returning(Call("record_order", "{}"));
        await Clients.Create(chat, new LlmOptions { Endpoint = "http://llm.test", Model = "default-model" })
            .CompleteAsync(Request with { Model = "other-model", SystemPrompt = " " });

        var (messages, options) = Assert.Single(chat.Calls);
        Assert.Equal("other-model", options!.ModelId);
        Assert.Equal(ChatRole.User, Assert.Single(messages).Role);
    }

    [Fact]
    public void Defaults_match_the_spec()
    {
        var o = new LlmOptions();
        Assert.Equal("http://ollama:11434", o.Endpoint);
        Assert.Equal("qwen2.5:7b-instruct", o.Model);
        Assert.Equal(120, o.TimeoutSeconds);
        Assert.Equal(TimeSpan.FromSeconds(120), o.Timeout);
        Assert.Null(o.ApiKey);
        Assert.Equal(TimeSpan.FromSeconds(120), new LlmOptions { TimeoutSeconds = 0 }.Timeout);
    }

    [Fact]
    public async Task Only_the_first_tool_call_counts()
    {
        var chat = FakeChatClient.Returning(Call("a", "{}"), Call("b", "{}"));
        Assert.Equal("a", (await Clients.Create(chat).CompleteAsync(Request)).ToolCall!.Name);
    }

    [Fact]
    public async Task A_reply_without_a_tool_call_is_not_a_failure()
    {
        var result = await Clients.Create(FakeChatClient.Returning(new TextContent("hello"))).CompleteAsync(Request);
        Assert.Null(result.ToolCall);
    }

    [Fact]
    public async Task A_reply_without_messages_is_an_empty_response()
    {
        var e = await Assert.ThrowsAsync<LlmClientException>(() => Clients.Create(new FakeChatClient()).CompleteAsync(Request));
        Assert.Equal("empty response", e.Reason);
    }

    [Fact]
    public async Task A_tool_call_without_a_name_is_unparseable()
    {
        var e = await Assert.ThrowsAsync<LlmClientException>(() => Clients.Create(FakeChatClient.Returning(new FunctionCallContent("c", "", null))).CompleteAsync(Request));
        Assert.Equal("unparseable response", e.Reason);
    }

    [Fact]
    public async Task Missing_arguments_become_empty_text_and_malformed_ones_are_not_json()
    {
        var none = await Clients.Create(FakeChatClient.Returning(new FunctionCallContent("c", "record_order", null))).CompleteAsync(Request);
        Assert.Equal("", none.ToolCall!.ArgumentsJson);

        var bad = await Clients.Create(FakeChatClient.Returning(new FunctionCallContent("c", "record_order", null) { Exception = new JsonException("x") })).CompleteAsync(Request);
        Assert.ThrowsAny<JsonException>(() => JsonNode.Parse(bad.ToolCall!.ArgumentsJson));
    }

    [Fact]
    public async Task A_slow_server_times_out_after_the_configured_seconds_with_one_call()
    {
        var chat = FakeChatClient.Hanging();
        var client = Clients.Create(chat, new LlmOptions { Endpoint = "http://llm.test", TimeoutSeconds = 1 });
        var started = DateTime.UtcNow;
        var e = await Assert.ThrowsAsync<LlmClientException>(() => client.CompleteAsync(Request));
        Assert.StartsWith("timeout", e.Reason);
        Assert.InRange(DateTime.UtcNow - started, TimeSpan.FromMilliseconds(800), TimeSpan.FromSeconds(10));
        Assert.Single(chat.Calls);
    }

    [Fact]
    public async Task A_cancelled_caller_is_not_reported_as_a_timeout()
    {
        using var cts = new CancellationTokenSource();
        var task = Clients.Create(FakeChatClient.Hanging()).CompleteAsync(Request, cts.Token);
        cts.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => task);
    }

    [Fact]
    public async Task An_http_error_is_a_failure_that_is_not_retried_and_does_not_expose_its_message()
    {
        var chat = FakeChatClient.Throwing(new ClientResultException("SECRET-BODY USER TEXT", new FakePipelineResponse(500)));
        var logger = new CapturingLogger<MeaiLlmClient>();
        var e = await Assert.ThrowsAsync<LlmClientException>(() => Clients.Create(chat, logger: logger).CompleteAsync(Request));
        Assert.Equal("HTTP 500", e.Reason);
        Assert.Single(chat.Calls);
        Assert.DoesNotContain("SECRET-BODY", e.Reason);
        Assert.DoesNotContain(logger.Entries, l => l.Contains("SECRET-BODY"));
    }

    [Theory]
    [InlineData(typeof(HttpRequestException))]
    public async Task A_connection_error_is_a_failure(Type type)
    {
        var inner = (Exception)Activator.CreateInstance(type, "boom with USER TEXT")!;
        var chat = FakeChatClient.Throwing(new ClientResultException("wrapped", null, inner));
        var e = await Assert.ThrowsAsync<LlmClientException>(() => Clients.Create(chat).CompleteAsync(Request));
        Assert.Equal("connection failed: HttpRequestException", e.Reason);
        Assert.DoesNotContain("USER TEXT", e.Reason);
    }

    [Fact]
    public async Task An_adapter_index_error_is_an_empty_response()
    {
        var e = await Assert.ThrowsAsync<LlmClientException>(() => Clients.Create(FakeChatClient.Throwing(new ArgumentOutOfRangeException("index"))).CompleteAsync(Request));
        Assert.Equal("empty response", e.Reason);
    }

    [Fact]
    public async Task A_json_error_is_unparseable()
    {
        var e = await Assert.ThrowsAsync<LlmClientException>(() => Clients.Create(FakeChatClient.Throwing(new JsonException("bad"))).CompleteAsync(Request));
        Assert.Equal("unparseable response", e.Reason);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("not a url")]
    public async Task An_unset_endpoint_fails_without_any_call(string? endpoint)
    {
        var chat = FakeChatClient.Returning(Call("record_order", "{}"));
        var e = await Assert.ThrowsAsync<LlmClientException>(() => Clients.Create(chat, new LlmOptions { Endpoint = endpoint }).CompleteAsync(Request));
        Assert.Equal("endpoint not configured", e.Reason);
        Assert.Empty(chat.Calls);
    }

    [Fact]
    public async Task Nothing_sensitive_is_logged_even_at_trace_level()
    {
        var logger = new CapturingLogger<MeaiLlmClient>();
        var chat = FakeChatClient.Returning(Call("record_order", """{"qty":3}"""));
        await Clients.Create(chat, new LlmOptions { Endpoint = "http://llm.test", ApiKey = "sk-test-key" }, logger).CompleteAsync(Request);
        Assert.All(logger.Entries, l =>
        {
            Assert.DoesNotContain("SYSTEM TEXT", l);
            Assert.DoesNotContain("USER TEXT", l);
            Assert.DoesNotContain("sk-test-key", l);
            Assert.DoesNotContain("qty", l);
        });
    }

    // ---- the real pipeline (OpenAI SDK + OpenTelemetry + logging) against a fake HTTP handler ----

    private static MeaiLlmClient RealPipeline(FakeHandler handler, LlmOptions o, ILoggerFactory? lf = null) =>
        Clients.Real(handler, o, lf ?? new FakeLoggerFactory(new CapturingLogger<MeaiLlmClient>()));

    [Fact]
    public async Task The_real_pipeline_posts_one_chat_completions_request_with_tool_choice_required()
    {
        var handler = FakeHandler.Json(Replies.ToolCall("record_order", """{"qty":3}"""));
        var o = new LlmOptions { Endpoint = "http://llm.test/", Model = "default-model", ApiKey = "sk-test-key" };

        var result = await RealPipeline(handler, o).CompleteAsync(Request with { Model = "other-model" });

        Assert.Single(handler.Requests);
        Assert.Equal(HttpMethod.Post, handler.Requests[0].Method);
        Assert.Equal("http://llm.test/v1/chat/completions", handler.Requests[0].RequestUri!.ToString());
        Assert.Equal("Bearer", handler.Requests[0].Headers.Authorization!.Scheme);
        Assert.Equal("sk-test-key", handler.Requests[0].Headers.Authorization!.Parameter);
        var body = JsonNode.Parse(handler.Bodies[0])!;
        Assert.Equal("other-model", (string?)body["model"]);
        Assert.Equal("required", (string?)body["tool_choice"]);
        Assert.Equal(0, (double?)body["temperature"]);
        var messages = body["messages"]!.AsArray();
        Assert.Equal(["system", "user"], messages.Select(m => (string?)m!["role"]));
        Assert.Equal("SYSTEM TEXT", (string?)messages[0]!["content"]);
        Assert.Equal("USER TEXT", (string?)messages[1]!["content"]);
        var tool = body["tools"]!.AsArray().Single()!;
        Assert.Equal("function", (string?)tool["type"]);
        Assert.Equal("record_order", (string?)tool["function"]!["name"]);
        Assert.Equal("An order", (string?)tool["function"]!["description"]);
        Assert.Equal("object", (string?)tool["function"]!["parameters"]!["type"]);
        Assert.Equal("record_order", result.ToolCall!.Name);
        Assert.Equal("""{"qty":3}""", result.ToolCall.ArgumentsJson);
    }

    [Fact]
    public async Task The_real_pipeline_sends_a_placeholder_key_when_none_is_configured_and_handles_a_plain_text_reply()
    {
        var handler = FakeHandler.Json("""{"choices":[{"message":{"role":"assistant","content":"hello"}}]}""");
        var result = await RealPipeline(handler, new LlmOptions { Endpoint = "http://llm.test" }).CompleteAsync(Request);
        Assert.Null(result.ToolCall);
        Assert.Equal("not-needed", handler.Requests[0].Headers.Authorization!.Parameter);
    }

    [Fact]
    public async Task The_real_pipeline_http_500_is_one_request_with_no_sdk_retry()
    {
        var handler = FakeHandler.Json("""{"error":"SECRET-BODY USER TEXT"}""", HttpStatusCode.InternalServerError);
        var e = await Assert.ThrowsAsync<LlmClientException>(() => RealPipeline(handler, new LlmOptions { Endpoint = "http://llm.test" }).CompleteAsync(Request));
        Assert.Equal("HTTP 500", e.Reason);
        Assert.Single(handler.Requests);
        Assert.DoesNotContain("SECRET-BODY", e.ToString());
    }

    [Theory]
    [InlineData("""{"choices":[]}""")]
    [InlineData("{}")]
    public async Task The_real_pipeline_reply_without_choices_is_an_empty_response(string body)
    {
        var e = await Assert.ThrowsAsync<LlmClientException>(() => RealPipeline(FakeHandler.Json(body), new LlmOptions { Endpoint = "http://llm.test" }).CompleteAsync(Request));
        Assert.Equal("empty response", e.Reason);
    }

    [Fact]
    public async Task The_real_pipeline_connection_error_and_garbage_body_are_failures()
    {
        var down = new FakeHandler((_, _) => throw new HttpRequestException("boom with USER TEXT"));
        var e1 = await Assert.ThrowsAsync<LlmClientException>(() => RealPipeline(down, new LlmOptions { Endpoint = "http://llm.test" }).CompleteAsync(Request));
        Assert.Equal("connection failed: HttpRequestException", e1.Reason);
        Assert.Single(down.Requests);

        var garbage = FakeHandler.Json("not json {{");
        var e2 = await Assert.ThrowsAsync<LlmClientException>(() => RealPipeline(garbage, new LlmOptions { Endpoint = "http://llm.test" }).CompleteAsync(Request));
        Assert.Equal("unparseable response", e2.Reason);
        Assert.Single(garbage.Requests);
    }

    [Fact]
    public async Task The_real_pipeline_times_out_and_logs_neither_prompts_nor_the_key_at_trace_level()
    {
        var logger = new CapturingLogger<MeaiLlmClient>();
        var ok = FakeHandler.Json(Replies.ToolCall("record_order", """{"qty":3}"""));
        await RealPipeline(ok, new LlmOptions { Endpoint = "http://llm.test", ApiKey = "sk-test-key" }, new FakeLoggerFactory(logger)).CompleteAsync(Request);
        Assert.NotEmpty(logger.Entries); // the logging middleware did log (Debug)
        Assert.All(logger.Entries, l =>
        {
            Assert.DoesNotContain("SYSTEM TEXT", l);
            Assert.DoesNotContain("USER TEXT", l);
            Assert.DoesNotContain("sk-test-key", l);
            Assert.DoesNotContain("qty", l);
        });

        var hang = FakeHandler.Hanging();
        var e = await Assert.ThrowsAsync<LlmClientException>(() => RealPipeline(hang, new LlmOptions { Endpoint = "http://llm.test", TimeoutSeconds = 1 }).CompleteAsync(Request));
        Assert.StartsWith("timeout", e.Reason);
        Assert.Single(hang.Requests);
    }

    [Theory]
    [InlineData("""{"choices":[{"message":{"tool_calls":[{"id":"c","type":"function","function":{"name":"record_order","arguments":"{oops"}}]}}]}""", null)]
    [InlineData("""{"choices":[{"message":{"tool_calls":[{"id":"c","type":"function","function":{"name":"record_order","arguments":"{\"qty\": 2}"}}]}}]}""", """{"qty":2}""")]
    public async Task The_real_pipeline_passes_malformed_arguments_on_as_non_json_and_good_ones_as_compact_json(string body, string? expected)
    {
        var result = await RealPipeline(FakeHandler.Json(body), new LlmOptions { Endpoint = "http://llm.test" }).CompleteAsync(Request);
        Assert.Equal("record_order", result.ToolCall!.Name);
        if (expected is null) Assert.ThrowsAny<JsonException>(() => JsonNode.Parse(result.ToolCall.ArgumentsJson));
        else Assert.Equal(expected, result.ToolCall.ArgumentsJson);
    }

    [Fact]
    public async Task The_real_pipeline_logs_a_failed_call_without_the_exception_message_prompt_or_response_body()
    {
        var logger = new CapturingLogger<MeaiLlmClient>();
        var handler = FakeHandler.Json("""{"error":"SECRET-BODY echoes SECRET-PROMPT"}""", HttpStatusCode.InternalServerError);
        var e = await Assert.ThrowsAsync<LlmClientException>(() =>
            RealPipeline(handler, new LlmOptions { Endpoint = "http://llm.test", ApiKey = "sk-test-key" }, new FakeLoggerFactory(logger))
                .CompleteAsync(Request with { UserPrompt = "SECRET-PROMPT" }));
        Assert.Equal("HTTP 500", e.Reason);
        Assert.DoesNotContain("SECRET", e.ToString());
        Assert.Contains(logger.Entries, l => l.StartsWith("Error"));
        Assert.All(logger.Entries, l =>
        {
            Assert.DoesNotContain("SECRET-BODY", l);
            Assert.DoesNotContain("SECRET-PROMPT", l);
            Assert.DoesNotContain("sk-test-key", l);
        });
    }

    private sealed class FakeLoggerFactory(ILogger logger) : ILoggerFactory
    {
        public ILogger CreateLogger(string categoryName) => logger;
        public void AddProvider(ILoggerProvider provider) { }
        public void Dispose() { }
    }

    private sealed class FakePipelineResponse(int status) : PipelineResponse
    {
        public override int Status => status;
        public override string ReasonPhrase => "x";
        public override Stream? ContentStream { get => null; set { } }
        public override BinaryData Content => BinaryData.Empty;
        protected override PipelineResponseHeaders HeadersCore => throw new NotSupportedException();
        public override BinaryData BufferContent(CancellationToken cancellationToken = default) => BinaryData.Empty;
        public override ValueTask<BinaryData> BufferContentAsync(CancellationToken cancellationToken = default) => new(BinaryData.Empty);
        public override void Dispose() { }
    }
}
