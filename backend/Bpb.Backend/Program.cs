using Microsoft.Extensions.Logging;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddOrchardCms(oc => oc.AddSetupFeatures("OrchardCore.AutoSetup"));
// Structured, correlated logs (P23, AGENTS.md 3.1): one JSON object per line with the active scopes, including the
// TraceId and SpanId of the current Activity (standard Microsoft.Extensions.Logging activity tracking).
builder.Logging.Configure(o => o.ActivityTrackingOptions = ActivityTrackingOptions.TraceId | ActivityTrackingOptions.SpanId);
builder.Logging.AddJsonConsole(o => o.IncludeScopes = true);
var app = builder.Build();
app.UseStaticFiles();
app.UseOrchardCore();
app.Run();
