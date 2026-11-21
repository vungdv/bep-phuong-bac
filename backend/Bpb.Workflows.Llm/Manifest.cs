using OrchardCore.Modules.Manifest;

[assembly: Module(Name = "Bpb LLM Workflows", Author = "bpb", Version = "1.0.0", Category = "Workflows")]
[assembly: Feature(
    Id = "Bpb.Workflows.Llm",
    Name = "LLM Extract activity",
    Description = "A generic workflow task that sends configurable prompts and tool-call schemas to an OpenAI-compatible chat completions endpoint and branches on the tool the model calls.",
    Category = "Workflows",
    Dependencies = new[] { "OrchardCore.Workflows" })]
