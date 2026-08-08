package provider

import (
	"context"
	"os"

	"github.com/hashicorp/terraform-plugin-framework/datasource"
	"github.com/hashicorp/terraform-plugin-framework/provider"
	"github.com/hashicorp/terraform-plugin-framework/provider/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/types"
	"github.com/make-orchestration-ai/terraform-provider-orchestration-ai/internal/client"
	"github.com/make-orchestration-ai/terraform-provider-orchestration-ai/internal/datasources"
	"github.com/make-orchestration-ai/terraform-provider-orchestration-ai/internal/resources"
)

type OAIProvider struct{}

type oaiProviderModel struct {
	ClientID     types.String `tfsdk:"client_id"`
	ClientSecret types.String `tfsdk:"client_secret"`
	BaseURL      types.String `tfsdk:"base_url"`
}

func New() provider.Provider { return &OAIProvider{} }

func (p *OAIProvider) Metadata(_ context.Context, _ provider.MetadataRequest, resp *provider.MetadataResponse) {
	resp.TypeName = "oai"
}

func (p *OAIProvider) Schema(_ context.Context, _ provider.SchemaRequest, resp *provider.SchemaResponse) {
	resp.Schema = schema.Schema{
		Attributes: map[string]schema.Attribute{
			"client_id": schema.StringAttribute{
				Optional:    true,
				Description: "OAuth client ID (appId:userId). Falls back to ORCHESTRATION_AI_CLIENT_ID env var.",
			},
			"client_secret": schema.StringAttribute{
				Optional:    true,
				Sensitive:   true,
				Description: "OAuth client secret. Falls back to ORCHESTRATION_AI_CLIENT_SECRET env var.",
			},
			"base_url": schema.StringAttribute{
				Optional:    true,
				Description: "API base URL. Defaults to https://api.orchestration-ai.com.",
			},
		},
	}
}

func (p *OAIProvider) Configure(ctx context.Context, req provider.ConfigureRequest, resp *provider.ConfigureResponse) {
	var config oaiProviderModel
	resp.Diagnostics.Append(req.Config.Get(ctx, &config)...)
	if resp.Diagnostics.HasError() {
		return
	}

	clientID := os.Getenv("ORCHESTRATION_AI_CLIENT_ID")
	if !config.ClientID.IsNull() && !config.ClientID.IsUnknown() {
		clientID = config.ClientID.ValueString()
	}

	clientSecret := os.Getenv("ORCHESTRATION_AI_CLIENT_SECRET")
	if !config.ClientSecret.IsNull() && !config.ClientSecret.IsUnknown() {
		clientSecret = config.ClientSecret.ValueString()
	}

	baseURL := ""
	if !config.BaseURL.IsNull() && !config.BaseURL.IsUnknown() {
		baseURL = config.BaseURL.ValueString()
	}

	if clientID == "" {
		resp.Diagnostics.AddError("Missing client_id", "Set client_id in provider config or ORCHESTRATION_AI_CLIENT_ID env var.")
		return
	}
	if clientSecret == "" {
		resp.Diagnostics.AddError("Missing client_secret", "Set client_secret in provider config or ORCHESTRATION_AI_CLIENT_SECRET env var.")
		return
	}

	c := client.New(baseURL, clientID, clientSecret)
	resp.DataSourceData = c
	resp.ResourceData = c
}

func (p *OAIProvider) Resources(_ context.Context) []func() resource.Resource {
	return []func() resource.Resource{
		resources.NewWorkspaceResource,
		resources.NewOrchestrationResource,
		resources.NewAgentResource,
		resources.NewApplicationResource,
		resources.NewEndpointResource,
		resources.NewLayerResource,
		resources.NewLinkResource,
		resources.NewSettingResource,
		resources.NewTaskResource,
		resources.NewLlmKeyResource,
		resources.NewAccessResource,
		resources.NewTickerConfigResource,
		resources.NewStorageFileResource,
		resources.NewStorageDirResource,
	}
}

func (p *OAIProvider) DataSources(_ context.Context) []func() datasource.DataSource {
	return []func() datasource.DataSource{
		datasources.NewLlmDataSource,
		datasources.NewLlmsDataSource,
		datasources.NewServiceDataSource,
	}
}
