using Bpb.Workflows.Llm.Activities;
using Bpb.Workflows.Llm.Client;
using Bpb.Workflows.Llm.Drivers;
using Bpb.Workflows.Llm.Options;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
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
        // One IChatClient (OpenAI SDK against {Endpoint}/v1 + OpenTelemetry + logging; no function invocation, no retry).
        // The request timeout is Bpb:Llm:TimeoutSeconds, enforced by MeaiLlmClient with a CancellationToken.
        services.AddSingleton<ILlmClient>(sp =>
        {
            var options = sp.GetRequiredService<IOptions<LlmOptions>>();
            return new MeaiLlmClient(
                LlmChatClientFactory.Create(options.Value, sp.GetRequiredService<ILoggerFactory>()),
                options,
                sp.GetRequiredService<ILogger<MeaiLlmClient>>());
        });
        services.AddActivity<LlmExtractTask, LlmExtractTaskDisplayDriver>();
    }
}
