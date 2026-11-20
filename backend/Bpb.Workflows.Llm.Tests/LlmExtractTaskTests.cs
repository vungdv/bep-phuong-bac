using System.Text.Json.Nodes;
using Bpb.Workflows.Llm.Activities;
using Bpb.Workflows.Llm.Client;
using Bpb.Workflows.Llm.Options;
using Microsoft.Extensions.Logging;
using OrchardCore.Workflows.Models;
using Xunit;

namespace Bpb.Workflows.Llm.Tests;

public class LlmExtractTaskTests
{
    private const string Tools = """
        [
          { "name": "record_order", "description": "A pre-order",
            "parameters": { "type": "object",
              "properties": { "customerName": {"type":"string"}, "qty": {"type":"integer"}, "kind": {"enum":["a","b"]}, "note": {"type":"string"} },
              "required": ["customerName","qty"], "additionalProperties": false } },
          { "name": "ignore_message", "description": "Not an order",
            "parameters": { "type": "object", "properties": { "reason": {"type":"string"} }, "required": ["reason"] } }
        ]
        """;

    private static LlmExtractTask Task(ILlmClient client, CapturingLogger<LlmExtractTask>? logger = null, string tools = Tools,
        string system = "System. Call one tool.", string user = "{{ Workflow.Input.ContentItem.Content.ChannelMessage.Text.Text }}") =>
        new(client, new FakeExpressionEvaluator(), new PassThroughLocalizer<LlmExtractTask>(), logger ?? new CapturingLogger<LlmExtractTask>())
        {
            Tools = tools,
            SystemPrompt = new WorkflowExpression<string>(system),
            UserPrompt = new WorkflowExpression<string>(user),
        };

    private static WorkflowExecutionContext MessageContext(string text, string type = "ChannelMessage", string field = "Text") =>
        Contexts.New(input: new Dictionary<string, object>
        {
            ["ContentItem"] = new JsonObject
            {
                ["ContentItemId"] = "4abc",
                ["Content"] = new JsonObject { [type] = new JsonObject { [field] = new JsonObject { ["Text"] = text } } },
            },
        });

    private static async Task<string> Run(LlmExtractTask task, WorkflowExecutionContext? context = null)
    {
        context ??= MessageContext("chị đặt 3 phần cơm gà");
        var result = await task.ExecuteAsync(context, new ActivityContext());
        return Assert.Single(result.Outcomes);
    }

    [Theory]
    [InlineData("record_order", """{"customerName":"Lan","qty":3,"note":"cơm gà"}""")]
    [InlineData("ignore_message", """{"reason":"not an order"}""")]
    public async Task Each_tool_has_its_own_outcome_and_the_arguments_land_in_workflow_properties(string tool, string args)
    {
        var context = MessageContext("x");
        var outcome = await Run(Task(FakeLlmClient.Calling(tool, args)), context);

        Assert.Equal(tool, outcome);
        Assert.Equal(tool, context.Properties["LlmTool"]);
        Assert.Equal(args, context.Properties["LlmArgsJson"]);
        Assert.Equal("", context.Properties["LlmError"]);
        Assert.Equal(JsonNode.Parse(args)!.ToJsonString(), JsonNode.Parse((string)context.Properties["LlmArgsJson"])!.ToJsonString());
    }

    [Fact]
    public void Possible_outcomes_are_one_per_tool_plus_Invalid_and_Failed()
    {
        var names = Task(new FakeLlmClient()).GetPossibleOutcomes(MessageContext("x"), new ActivityContext()).Select(o => o.Name);
        Assert.Equal(new[] { "record_order", "ignore_message", "Invalid", "Failed" }, names);
    }

    [Fact]
    public void Possible_outcomes_survive_unparseable_tools_in_the_editor()
    {
        var names = Task(new FakeLlmClient(), tools: "[ not json").GetPossibleOutcomes(MessageContext("x"), new ActivityContext()).Select(o => o.Name);
        Assert.Equal(new[] { "Invalid", "Failed" }, names);
    }

    [Fact]
    public async Task A_reply_without_a_tool_call_is_Invalid()
    {
        var context = MessageContext("x");
        var client = new FakeLlmClient { Reply = _ => new LlmCompletion(null) };
        Assert.Equal("Invalid", await Run(Task(client), context));
        Assert.Equal("no tool call", context.Properties["LlmError"]);
        Assert.Equal("", context.Properties["LlmTool"]);
        Assert.Equal("", context.Properties["LlmArgsJson"]);
    }

    [Fact]
    public async Task An_unknown_tool_is_Invalid()
    {
        var context = MessageContext("x");
        Assert.Equal("Invalid", await Run(Task(FakeLlmClient.Calling("delete_everything", "{}")), context));
        Assert.Equal("unknown tool", context.Properties["LlmError"]);
    }

    [Theory]
    [InlineData("""{"qty":3}""")]                                      // required property missing
    [InlineData("""{"customerName":"Lan","qty":"3"}""")]               // wrong type
    [InlineData("""{"customerName":"Lan","qty":3.5}""")]               // not an integer
    [InlineData("""{"customerName":"Lan","qty":3,"kind":"c"}""")]      // enum
    [InlineData("""{"customerName":"Lan","qty":3,"extra":1}""")]       // additionalProperties false
    [InlineData("""{"customerName":null,"qty":3}""")]                  // null for a string
    [InlineData("""[1,2]""")]                                          // not an object
    [InlineData("""not json""")]                                       // not JSON at all
    [InlineData("")]                                                   // empty arguments, required properties missing
    public async Task Arguments_that_break_the_tool_schema_are_Invalid(string args)
    {
        var context = MessageContext("x");
        Assert.Equal("Invalid", await Run(Task(FakeLlmClient.Calling("record_order", args)), context));
        Assert.NotEqual("", (string)context.Properties["LlmError"]);
        Assert.Equal("", context.Properties["LlmArgsJson"]); // invalid arguments are never handed on
    }

    [Fact]
    public async Task Empty_arguments_are_valid_for_a_tool_without_required_properties()
    {
        var tools = """[{"name":"ping","parameters":{"type":"object","properties":{}}}]""";
        var context = MessageContext("x");
        Assert.Equal("ping", await Run(Task(FakeLlmClient.Calling("ping", ""), tools: tools), context));
        Assert.Equal("{}", context.Properties["LlmArgsJson"]);
    }

    public static IEnumerable<object[]> ClientFailures()
    {
        yield return new object[] { new LlmClientException("timeout after 120s") };
        yield return new object[] { new LlmClientException("HTTP 500") };
        yield return new object[] { new LlmClientException("empty response") };
        yield return new object[] { new LlmClientException("unparseable response") };
        yield return new object[] { new LlmClientException("endpoint not configured") };
        yield return new object[] { new InvalidOperationException("anything else must not fault the workflow") };
    }

    [Theory]
    [MemberData(nameof(ClientFailures))]
    public async Task A_failing_client_is_Failed_with_a_reason_and_one_call(Exception failure)
    {
        var context = MessageContext("x");
        var client = new FakeLlmClient { Throw = failure };
        Assert.Equal("Failed", await Run(Task(client), context));
        Assert.Single(client.Requests); // no retry
        Assert.Equal("", context.Properties["LlmTool"]);
        Assert.Equal("", context.Properties["LlmArgsJson"]);
        Assert.NotEqual("", (string)context.Properties["LlmError"]);
    }

    [Theory]
    [InlineData("timeout")]
    [InlineData("500")]
    [InlineData("empty")]
    [InlineData("garbage")]
    [InlineData("unset")]
    public async Task Failed_through_the_real_client_for_timeout_500_empty_unparseable_and_unset_endpoint(string kind)
    {
        var options = new LlmOptions { Endpoint = "http://llm.test", TimeoutSeconds = 1 };
        var handler = kind switch
        {
            "timeout" => FakeHandler.Hanging(),
            "500" => FakeHandler.Json("{}", System.Net.HttpStatusCode.InternalServerError),
            "empty" => FakeHandler.Json(""),
            "garbage" => FakeHandler.Json("<html>nope"),
            _ => FakeHandler.Json("{}"),
        };
        if (kind == "unset") options.Endpoint = "";

        var context = MessageContext("x");
        Assert.Equal("Failed", await Run(Task(Clients.Create(handler, options)), context));
        Assert.Equal(kind == "unset" ? 0 : 1, handler.Requests.Count); // one attempt at most, never a retry
        Assert.NotEqual("", (string)context.Properties["LlmError"]);
    }

    [Theory]
    [InlineData("[ not json")]
    [InlineData("{}")]
    [InlineData("[]")]
    [InlineData("""[{"name":""}]""")]
    [InlineData("""[{"name":"a"},{"name":"a"}]""")]
    [InlineData("""[{"name":"a","parameters":{"type":"nonsense"}}]""")]
    public async Task Bad_tool_settings_are_Failed_and_call_nothing(string tools)
    {
        var client = new FakeLlmClient();
        Assert.Equal("Failed", await Run(Task(client, tools: tools)));
        Assert.Empty(client.Requests);
    }

    [Fact]
    public async Task An_empty_user_prompt_is_Failed_and_calls_nothing()
    {
        var client = new FakeLlmClient();
        Assert.Equal("Failed", await Run(Task(client, user: "{{ Workflow.Input.ContentItem.Content.ChannelMessage.Text.Text }}"), MessageContext("   ")));
        Assert.Empty(client.Requests);
    }

    [Fact]
    public async Task The_request_carries_the_rendered_prompts_the_tools_and_the_model_setting()
    {
        var client = FakeLlmClient.Calling("ignore_message", """{"reason":"r"}""");
        var task = Task(client, system: "Today is fixed. Call one tool.");
        task.Model = "  qwen-big  ";
        await Run(task, MessageContext("3 phần cơm gà"));

        var request = Assert.Single(client.Requests);
        Assert.Equal("Today is fixed. Call one tool.", request.SystemPrompt);
        Assert.Equal("3 phần cơm gà", request.UserPrompt);
        Assert.Equal("qwen-big", request.Model);
        Assert.Equal(new[] { "record_order", "ignore_message" }, request.Tools.Select(t => t.Name));
        Assert.Equal("A pre-order", request.Tools[0].Description);
    }

    [Fact]
    public async Task Without_a_model_setting_the_request_leaves_the_model_to_the_configuration()
    {
        var client = FakeLlmClient.Calling("ignore_message", """{"reason":"r"}""");
        await Run(Task(client));
        Assert.Null(client.Requests.Single().Model);
    }

    [Fact]
    public async Task The_result_key_setting_renames_the_workflow_properties()
    {
        var task = Task(FakeLlmClient.Calling("ignore_message", """{"reason":"r"}"""));
        task.ResultKey = "Extract";
        var context = MessageContext("x");
        await Run(task, context);
        Assert.Equal("ignore_message", context.Properties["ExtractTool"]);
        Assert.Equal("""{"reason":"r"}""", context.Properties["ExtractArgsJson"]);
        Assert.False(context.Properties.ContainsKey("LlmTool"));
    }

    [Fact]
    public async Task The_same_activity_renders_prompts_from_two_different_content_types()
    {
        var client = FakeLlmClient.Calling("ignore_message", """{"reason":"r"}""");

        await Run(Task(client, user: "{{ Workflow.Input.ContentItem.Content.ChannelMessage.Text.Text }}"), MessageContext("from a channel message"));
        await Run(Task(client, user: "{{ Workflow.Input.ContentItem.Content.EmailNote.Body.Text }}"), MessageContext("from an email note", type: "EmailNote", field: "Body"));

        Assert.Equal(new[] { "from a channel message", "from an email note" }, client.Requests.Select(r => r.UserPrompt));
    }

    [Fact]
    public async Task It_works_in_a_workflow_that_has_no_content_item()
    {
        var client = FakeLlmClient.Calling("ignore_message", """{"reason":"r"}""");
        var context = Contexts.New(properties: new Dictionary<string, object> { ["Text"] = "typed straight into a property" });

        var outcome = await Run(Task(client, user: "{{ Workflow.Properties.Text }}"), context);

        Assert.Equal("ignore_message", outcome);
        Assert.Equal("typed straight into a property", client.Requests.Single().UserPrompt);
        Assert.False(context.Input.ContainsKey("ContentItem"));
    }

    [Theory]
    [InlineData("ok")]
    [InlineData("invalid")]
    [InlineData("failed")]
    public async Task Prompts_message_text_and_arguments_are_never_logged(string path)
    {
        var logger = new CapturingLogger<LlmExtractTask>();
        var client = path switch
        {
            "ok" => FakeLlmClient.Calling("record_order", """{"customerName":"ARGS-NAME","qty":3}"""),
            "invalid" => FakeLlmClient.Calling("record_order", """{"customerName":"ARGS-NAME"}"""),
            _ => new FakeLlmClient { Throw = new LlmClientException("HTTP 500") },
        };
        await Run(Task(client, logger, system: "SYSTEM-SECRET-INSTRUCTIONS"), MessageContext("MESSAGE-TEXT-PRIVATE"));

        Assert.NotEmpty(logger.Entries);
        Assert.All(logger.Entries, l =>
        {
            Assert.DoesNotContain("SYSTEM-SECRET", l);
            Assert.DoesNotContain("MESSAGE-TEXT", l);
            Assert.DoesNotContain("ARGS-NAME", l);
        });
    }

    [Fact]
    public async Task A_cancelled_request_is_not_swallowed()
    {
        var client = new FakeLlmClient { Throw = new OperationCanceledException() };
        await Assert.ThrowsAsync<OperationCanceledException>(() => Run(Task(client)));
    }
}
