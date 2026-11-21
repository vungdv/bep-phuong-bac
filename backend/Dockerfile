FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY Bpb.Backend/Bpb.Backend.csproj Bpb.Backend/
COPY Bpb.Workflows.Llm/Bpb.Workflows.Llm.csproj Bpb.Workflows.Llm/
RUN dotnet restore Bpb.Backend/Bpb.Backend.csproj
COPY Bpb.Backend/ Bpb.Backend/
COPY Bpb.Workflows.Llm/ Bpb.Workflows.Llm/
RUN dotnet publish Bpb.Backend/Bpb.Backend.csproj -c Release -o /app --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app .
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080
HEALTHCHECK --interval=5s --timeout=3s --start-period=20s --retries=40 CMD curl -fsS http://localhost:8080/health/live || exit 1
ENTRYPOINT ["dotnet", "Bpb.Backend.dll"]
