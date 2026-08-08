package datasources

import (
	"context"
	"fmt"
	"net/http"

	"github.com/hashicorp/terraform-plugin-framework/datasource"
	"github.com/hashicorp/terraform-plugin-framework/datasource/schema"
	"github.com/hashicorp/terraform-plugin-framework/types"
	"github.com/make-orchestration-ai/terraform-provider-orchestration-ai/internal/client"
)

type LlmDataSource struct{ client *client.Client }

type llmDataModel struct {
	ID      types.String `tfsdk:"id"`
	LlmName types.String `tfsdk:"llm_name"`
}

func NewLlmDataSource() datasource.DataSource { return &LlmDataSource{} }

func (d *LlmDataSource) Metadata(_ context.Context, req datasource.MetadataRequest, resp *datasource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_llm"
}

func (d *LlmDataSource) Schema(_ context.Context, _ datasource.SchemaRequest, resp *datasource.SchemaResponse) {
	resp.Schema = schema.Schema{
		Attributes: map[string]schema.Attribute{
			"id":       schema.StringAttribute{Required: true},
			"llm_name": schema.StringAttribute{Computed: true},
		},
	}
}

func (d *LlmDataSource) Configure(_ context.Context, req datasource.ConfigureRequest, _ *datasource.ConfigureResponse) {
	if req.ProviderData != nil {
		d.client = req.ProviderData.(*client.Client)
	}
}

func (d *LlmDataSource) Read(ctx context.Context, req datasource.ReadRequest, resp *datasource.ReadResponse) {
	var state llmDataModel
	resp.Diagnostics.Append(req.Config.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	httpResp, err := d.client.Do(http.MethodGet, "/llms/"+state.ID.ValueString(), nil)
	if err != nil {
		resp.Diagnostics.AddError("Read llm failed", err.Error())
		return
	}
	var result map[string]any
	if err := client.DecodeResponse(httpResp, &result); err != nil {
		resp.Diagnostics.AddError("Read llm failed", err.Error())
		return
	}
	state.LlmName = types.StringValue(fmt.Sprintf("%v", result["llm_name"]))
	resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
}
