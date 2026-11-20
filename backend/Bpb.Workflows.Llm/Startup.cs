using Bpb.Workflows.Llm.Activities;
using Bpb.Workflows.Llm.Client;
using Bpb.Workflows.Llm.Drivers;
using Bpb.Workflows.Llm.Options;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using OrchardCore.Environment.Shell.Configuration;
using OrchardCore.Modules;
using OrchardCore.Workflows.Helpers;

namespace Bpb.Workflows.Llm;

[Feature("Bpb.Workflows.Llm")]
public sealed class Startup : StartupBase
{
    public override void ConfigureServices(IServiceCollection services)
    {
        services.AddOptions<LlmOptions>().Configure<IShellConfiguration>((o, shell) => shell.GetSection(LlmOptions.Section).Bind(o));
        // The request timeout is Bpb:Llm:TimeoutSeconds, enforced by the client with a CancellationToken; no HttpClient default (100 s).
        services.AddHttpClient<ILlmClient, ChatCompletionsClient>(c => c.Timeout = Timeout.InfiniteTimeSpan);
        services.AddActivity<LlmExtractTask, LlmExtractTaskDisplayDriver>();
    }
}
