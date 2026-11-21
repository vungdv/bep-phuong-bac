using Bpb.Workflows.Llm.Activities;
using Bpb.Workflows.Llm.ViewModels;
using OrchardCore.DisplayManagement.Handlers;
using OrchardCore.DisplayManagement.Views;
using OrchardCore.Workflows.Display;
using OrchardCore.Workflows.Models;

namespace Bpb.Workflows.Llm.Drivers;

public sealed class LlmExtractTaskDisplayDriver : ActivityDisplayDriver<LlmExtractTask, LlmExtractTaskViewModel>
{
    protected override void EditActivity(LlmExtractTask activity, LlmExtractTaskViewModel model)
    {
        model.SystemPrompt = activity.SystemPrompt.Expression;
        model.UserPrompt = activity.UserPrompt.Expression;
        model.Tools = activity.Tools;
        model.ModelOverride = activity.Model;
        model.ResultKey = activity.ResultKey;
    }

    public override async Task<IDisplayResult> UpdateAsync(LlmExtractTask activity, UpdateEditorContext context)
    {
        var result = await base.UpdateAsync(activity, context);
        try { ToolDefinitions.Parse(activity.Tools); }
        catch (FormatException e) { context.Updater.ModelState.AddModelError(Prefix + "." + nameof(LlmExtractTaskViewModel.Tools), e.Message); }
        return result;
    }

    protected override void UpdateActivity(LlmExtractTaskViewModel model, LlmExtractTask activity)
    {
        activity.SystemPrompt = new WorkflowExpression<string>(model.SystemPrompt ?? "");
        activity.UserPrompt = new WorkflowExpression<string>(model.UserPrompt ?? "");
        activity.Tools = string.IsNullOrWhiteSpace(model.Tools) ? "[]" : model.Tools.Trim();
        activity.Model = model.ModelOverride?.Trim() ?? "";
        activity.ResultKey = string.IsNullOrWhiteSpace(model.ResultKey) ? LlmExtractTask.DefaultResultKey : model.ResultKey.Trim();
    }
}
