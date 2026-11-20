using System.Net;
using System.Text.Json.Nodes;
using Bpb.Workflows.Llm.Client;
using Bpb.Workflows.Llm.Options;
using Xunit;

namespace Bpb.Workflows.Llm.Tests;

public class ChatCompletionsClientTests
{
    private static readonly LlmTool RecordOrder = new("record_order", "An order", JsonNode.Parse("""{"type":"object","properties":{"qty":{"type":"integer"}},"required":["qty"]}""")!);
    private static readonly LlmRequest Request = new(null, "SYSTEM TEXT", "USER TEXT", [RecordOrder]);

    [Fact]
    public async Task Sends_one_chat_completions_request_with_the_documented_shape()
    {
        var handler = FakeHandler.Json(Replies.ToolCall("record_order", """{"qty":3}"""));
        var client = Clients.Create(handler, new LlmOptions { Endpoint = "http://llm.test/", Model = "default-model" });

        var result = await client.CompleteAsync(Request);

        Assert.Single(handler.Requests);
        Assert.Equal(HttpMethod.Post, handler.Requests[0].Method);
        Assert.Equal("http://llm.test/v1/chat/completions", handler.Requests[0].RequestUri!.ToString());
        Assert.Null(handler.Requests[0].Headers.Authorization);
        var body = JsonNode.Parse(handler.Bodies[0])!;
        Assert.Equal("default-model", (string?)body["model"]);
        Assert.Equal("required", (string?)body["tool_choice"]);
        Assert.Equal(0, (int?)body["temperature"]);
        var messages = body["messages"]!.AsArray();
        Assert.Equal(2, messages.Count);
        Assert.Equal("system", (string?)messages[0]!["role"]);
        Assert.Equal("SYSTEM TEXT", (string?)messages[0]!["content"]);
        Assert.Equal("user", (string?)messages[1]!["role"]);
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
    public async Task Request_model_overrides_the_configured_model_and_api_key_is_sent_as_bearer()
    {
        var handler = FakeHandler.Json(Replies.ToolCall("record_order", "{}"));
        var client = Clients.Create(handler, new LlmOptions { Endpoint = "http://llm.test", Model = "default-model", ApiKey = "sk-test-key" });

        await client.CompleteAsync(Request with { Model = "other-model" });

        Assert.Equal("other-model", (string?)JsonNode.Parse(handler.Bodies[0])!["model"]);
        Assert.Equal("Bearer", handler.Requests[0].Headers.Authorization!.Scheme);
        Assert.Equal("sk-test-key", handler.Requests[0].Headers.Authorization!.Parameter);
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
    public async Task Object_valued_arguments_are_passed_on_as_json_text()
    {
        var body = """{"choices":[{"message":{"tool_calls":[{"function":{"name":"record_order","arguments":{"qty":2}}}]}}]}""";
        var result = await Clients.Create(FakeHandler.Json(body)).CompleteAsync(Request);
        Assert.Equal("""{"qty":2}""", result.ToolCall!.ArgumentsJson);
    }

    [Fact]
    public async Task Only_the_first_tool_call_counts()
    {
        var body = """{"choices":[{"message":{"tool_calls":[{"function":{"name":"a","arguments":"{}"}},{"function":{"name":"b","arguments":"{}"}}]}}]}""";
        var result = await Clients.Create(FakeHandler.Json(body)).CompleteAsync(Request);
        Assert.Equal("a", result.ToolCall!.Name);
    }

    [Fact]
    public async Task A_reply_without_a_tool_call_is_not_a_failure()
    {
        var body = """{"choices":[{"message":{"role":"assistant","content":"hello"}}]}""";
        var result = await Clients.Create(FakeHandler.Json(body)).CompleteAsync(Request);
        Assert.Null(result.ToolCall);
    }

    [Theory]
    [InlineData("", "empty response")]
    [InlineData("   ", "empty response")]
    [InlineData("""{"choices":[]}""", "empty response")]
    [InlineData("""{}""", "empty response")]
    [InlineData("not json {{", "unparseable response")]
    [InlineData("[1,2]", "unparseable response")]
    [InlineData("""{"choices":[{"nomessage":1}]}""", "unparseable response")]
    [InlineData("""{"choices":[{"message":{"tool_calls":[{"function":{"arguments":"{}"}}]}}]}""", "unparseable response")]
    public async Task Bad_bodies_are_failures_with_a_safe_reason(string body, string reason)
    {
        var handler = FakeHandler.Json(body);
        var e = await Assert.ThrowsAsync<LlmClientException>(() => Clients.Create(handler).CompleteAsync(Request));
        Assert.Equal(reason, e.Reason);
        Assert.Single(handler.Requests);
    }

    [Fact]
    public async Task Http_500_is_a_failure_and_is_not_retried_and_its_body_is_not_exposed()
    {
        var handler = FakeHandler.Json("""{"error":"SECRET-BODY USER TEXT"}""", HttpStatusCode.InternalServerError);
        var logger = new CapturingLogger<ChatCompletionsClient>();
        var e = await Assert.ThrowsAsync<LlmClientException>(() => Clients.Create(handler, logger: logger).CompleteAsync(Request));
        Assert.Equal("HTTP 500", e.Reason);
        Assert.Single(handler.Requests); // no retry
        Assert.DoesNotContain("SECRET-BODY", e.ToString());
        Assert.DoesNotContain(logger.Entries, l => l.Contains("SECRET-BODY"));
    }

    [Fact]
    public async Task A_slow_server_times_out_after_the_configured_seconds_with_one_request()
    {
        var handler = FakeHandler.Hanging();
        var client = Clients.Create(handler, new LlmOptions { Endpoint = "http://llm.test", TimeoutSeconds = 1 });
        var started = DateTime.UtcNow;
        var e = await Assert.ThrowsAsync<LlmClientException>(() => client.CompleteAsync(Request));
        Assert.StartsWith("timeout", e.Reason);
        Assert.InRange(DateTime.UtcNow - started, TimeSpan.FromMilliseconds(800), TimeSpan.FromSeconds(10));
        Assert.Single(handler.Requests);
    }

    [Fact]
    public async Task A_cancelled_caller_is_not_reported_as_a_timeout()
    {
        using var cts = new CancellationTokenSource();
        var client = Clients.Create(FakeHandler.Hanging());
        var task = client.CompleteAsync(Request, cts.Token);
        cts.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => task);
    }

    [Fact]
    public async Task A_connection_error_is_a_failure()
    {
        var handler = new FakeHandler((_, _) => throw new HttpRequestException("boom with USER TEXT"));
        var e = await Assert.ThrowsAsync<LlmClientException>(() => Clients.Create(handler).CompleteAsync(Request));
        Assert.Equal("connection failed: HttpRequestException", e.Reason);
        Assert.DoesNotContain("USER TEXT", e.Reason);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("not a url")]
    public async Task An_unset_endpoint_fails_without_any_request(string? endpoint)
    {
        var handler = FakeHandler.Json("{}");
        var e = await Assert.ThrowsAsync<LlmClientException>(() => Clients.Create(handler, new LlmOptions { Endpoint = endpoint }).CompleteAsync(Request));
        Assert.Equal("endpoint not configured", e.Reason);
        Assert.Empty(handler.Requests);
    }

    [Fact]
    public async Task Nothing_sensitive_is_logged_even_at_trace_level()
    {
        var logger = new CapturingLogger<ChatCompletionsClient>();
        var handler = FakeHandler.Json(Replies.ToolCall("record_order", """{"qty":3}"""));
        await Clients.Create(handler, new LlmOptions { Endpoint = "http://llm.test", ApiKey = "sk-test-key" }, logger).CompleteAsync(Request);
        Assert.All(logger.Entries, l =>
        {
            Assert.DoesNotContain("SYSTEM TEXT", l);
            Assert.DoesNotContain("USER TEXT", l);
            Assert.DoesNotContain("sk-test-key", l);
            Assert.DoesNotContain("qty", l);
        });
    }
}
