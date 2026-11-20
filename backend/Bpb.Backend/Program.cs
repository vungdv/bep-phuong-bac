var builder = WebApplication.CreateBuilder(args);
builder.Services.AddOrchardCms(oc => oc.AddSetupFeatures("OrchardCore.AutoSetup"));
var app = builder.Build();
app.UseStaticFiles();
app.UseOrchardCore();
app.Run();
