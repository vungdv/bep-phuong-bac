using Bpb.Workflows.Llm.Activities;
using Xunit;

namespace Bpb.Workflows.Llm.Tests;

public class ToolDefinitionsTests
{
    [Fact]
    public void Missing_parameters_default_to_an_empty_object_schema()
    {
        var tools = ToolDefinitions.Parse("""[{"name":"ping"}]""");
        Assert.True(tools.TryValidate("ping", "{}", out _));
        Assert.Equal("object", (string?)tools.Tools[0].Parameters["type"]);
    }

    [Theory]
    [InlineData("""[{"name":"a","description":5}]""")]
    [InlineData("""[{"name":"a","description":{"x":1}}]""")]
    [InlineData("""[{"name":"a","description":[]}]""")]
    public void A_non_string_description_is_a_format_error(string json) =>
        Assert.Throws<FormatException>(() => ToolDefinitions.Parse(json));

    [Fact]
    public void A_null_description_is_allowed() => Assert.Null(ToolDefinitions.Parse("""[{"name":"a","description":null}]""").Tools[0].Description);

    [Fact]
    public void Blank_means_no_tools() => Assert.Empty(ToolDefinitions.Parse("  ").Tools);

    [Fact]
    public void Validation_of_an_unknown_tool_reports_it()
    {
        Assert.False(ToolDefinitions.Parse("[]").TryValidate("nope", "{}", out var error));
        Assert.Equal("unknown tool", error);
    }
}
