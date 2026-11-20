using Bpb.Workflows.Llm.Client;
using Microsoft.Extensions.Localization;
using Microsoft.Extensions.Logging;
using OrchardCore.Workflows.Abstractions.Models;
using OrchardCore.Workflows.Activities;
using OrchardCore.Workflows.Models;
using OrchardCore.Workflows.Services;

namespace Bpb.Workflows.Llm.Activities;

/// <summary>
/// Generic, reusable "LLM Extract" step. Renders a System and a User prompt (Liquid), sends them once with the configured
/// tool definitions, and branches on the tool the model calls. Nothing here knows about orders or content items: the user
/// prompt decides what text is sent, so it works behind any start event.
/// <para>Outcomes: one per tool name, <c>Invalid</c> (no tool call, unknown tool, arguments fail the tool schema) and
/// <c>Failed</c> (not configured, timeout, HTTP error, empty or unparseable reply, bad settings).</para>
/// <para>Workflow properties written (prefix = <see cref="ResultKey"/>, default <c>Llm</c>): <c>{prefix}Tool</c> (called tool or
/// empty), <c>{prefix}ArgsJson</c> (the validated arguments as a JSON string, for <c>JSON.parse(property('LlmArgsJson'))</c>
/// in a ScriptTask) and <c>{prefix}Error</c> (short reason for <c>Invalid</c> and <c>Failed</c>, else empty).</para>
/// </summary>
public sealed class LlmExtractTask : TaskActivity<LlmExtractTask>
{
    public const string DefaultResultKey = "Llm";
    public const string Invalid = "Invalid";
    public const string Failed = "Failed";
    /// <summary>Structured log field shared by the run logs and the order log (spec P23).</summary>
    public const string SourceContentItemIdField = "SourceContentItemId";
    public static readonly System.Diagnostics.ActivitySource Telemetry = new("Bpb.Workflows.Llm");

    private readonly ILlmClient _client;
    private readonly IWorkflowExpressionEvaluator _expressions;
    private readonly ILogger<LlmExtractTask> _logger;
    private readonly IStringLocalizer S;

    public LlmExtractTask(ILlmClient client, IWorkflowExpressionEvaluator expressions, IStringLocalizer<LlmExtractTask> localizer, ILogger<LlmExtractTask> logger)
    {
        _client = client;
        _expressions = expressions;
        _logger = logger;
        S = localizer;
    }

    public override string Name => nameof(LlmExtractTask);
    public override LocalizedString DisplayText => S["LLM Extract Task"];
    public override LocalizedString Category => S["Task"];

    /// <summary>Liquid template of the system message (instructions, today's date, "call exactly one tool").</summary>
    public WorkflowExpression<string> SystemPrompt
    {
        get => GetProperty(() => new WorkflowExpression<string>());
        set => SetProperty(value);
    }

    /// <summary>Liquid template of the one user message: the untrusted text, mapped from the workflow's input or properties.</summary>
    public WorkflowExpression<string> UserPrompt
    {
        get => GetProperty(() => new WorkflowExpression<string>());
        set => SetProperty(value);
    }

    /// <summary>JSON array of <c>{ name, description, parameters (JSON Schema) }</c>; see <see cref="ToolDefinitions"/>.</summary>
    public string Tools
    {
        get => GetProperty(() => "[]");
        set => SetProperty(value);
    }

    /// <summary>Optional model id overriding <c>Bpb:Llm:Model</c> for this step.</summary>
    public string Model
    {
        get => GetProperty(() => string.Empty);
        set => SetProperty(value);
    }

    /// <summary>Prefix of the workflow properties written (default <c>Llm</c>); lets two steps of one workflow keep separate results.</summary>
    public string ResultKey
    {
        get => GetProperty(() => DefaultResultKey);
        set => SetProperty(value);
    }

    public override IEnumerable<Outcome> GetPossibleOutcomes(WorkflowExecutionContext workflowContext, ActivityContext activityContext)
    {
        var names = new List<string>();
        try { names.AddRange(ToolDefinitions.Parse(Tools).Names); }
        catch (FormatException) { /* the editor shows only Invalid and Failed until the tools parse */ }
        names.Add(Invalid);
        names.Add(Failed);
        return Outcomes(names.Distinct().Select(n => S[n]).ToArray());
    }

    public override async Task<ActivityExecutionResult> ExecuteAsync(WorkflowExecutionContext workflowContext, ActivityContext activityContext)
    {
        var key = string.IsNullOrWhiteSpace(ResultKey) ? DefaultResultKey : ResultKey.Trim();
        using var span = Telemetry.StartActivity("llm.extract");
        // P23: log under the run's correlation id (for ExtractOrder, the source content item id) as SourceContentItemId.
        // Optional: without a correlation id (E10) the activity logs as before.
        using var scope = string.IsNullOrWhiteSpace(workflowContext.CorrelationId)
            ? null
            : _logger.BeginScope("SourceContentItemId: {SourceContentItemId}", workflowContext.CorrelationId);

        string outcome, tool = "", argsJson = "", error = "";
        try
        {
            var tools = ToolDefinitions.Parse(Tools);
            if (tools.Tools.Count == 0) throw new LlmClientException("no tools defined");

            var system = await _expressions.EvaluateAsync(SystemPrompt, workflowContext, null) ?? "";
            var user = await _expressions.EvaluateAsync(UserPrompt, workflowContext, null) ?? "";
            if (string.IsNullOrWhiteSpace(user)) throw new LlmClientException("user prompt is empty");

            var completion = await _client.CompleteAsync(new LlmRequest(string.IsNullOrWhiteSpace(Model) ? null : Model.Trim(), system, user, tools.Tools));

            if (completion.ToolCall is not { } call) { outcome = Invalid; error = "no tool call"; }
            else if (!tools.TryValidate(call.Name, call.ArgumentsJson, out var why)) { outcome = Invalid; error = why!; }
            else { outcome = tool = call.Name; argsJson = string.IsNullOrWhiteSpace(call.ArgumentsJson) ? "{}" : call.ArgumentsJson; }
        }
        catch (FormatException e)
        {
            (outcome, error) = (Failed, "tools: " + e.Message);
        }
        catch (LlmClientException e)
        {
            (outcome, error) = (Failed, e.Reason);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            // Never let a failure here fault the workflow run (the engine cannot route it); report it as the Failed outcome.
            (outcome, error) = (Failed, "unexpected " + e.GetType().Name);
        }

        workflowContext.Properties[key + "Tool"] = tool;
        workflowContext.Properties[key + "ArgsJson"] = argsJson;
        workflowContext.Properties[key + "Error"] = error;

        span?.SetTag("llm.outcome", outcome);
        if (outcome == Failed) span?.SetStatus(System.Diagnostics.ActivityStatusCode.Error, error);
        // Reasons are our own short strings: no prompts, message text, response bodies or secrets.
        if (outcome is Failed or Invalid) _logger.LogWarning("LLM extract ended {Outcome}: {Reason}", outcome, error);
        else _logger.LogInformation("LLM extract called tool {Tool}", tool);

        return Outcomes(outcome);
    }
}
