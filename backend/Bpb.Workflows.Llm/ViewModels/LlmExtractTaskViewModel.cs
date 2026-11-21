using System.ComponentModel.DataAnnotations;
using Bpb.Workflows.Llm.Activities;
using OrchardCore.Workflows.ViewModels;

namespace Bpb.Workflows.Llm.ViewModels;

// Must stay public and NOT sealed: the shape system proxies it (a sealed model renders an empty edit form).
public class LlmExtractTaskViewModel : ActivityViewModel<LlmExtractTask>
{
    public string? SystemPrompt { get; set; }
    public string? UserPrompt { get; set; }
    public string? Tools { get; set; }
    public string? ModelOverride { get; set; }
    [Required] public string ResultKey { get; set; } = LlmExtractTask.DefaultResultKey;
}
