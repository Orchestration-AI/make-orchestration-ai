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
			"id":       schema.StringAttribute{Computed: true},
			"llm_name": schema.StringAttribute{Required: true},
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

	httpResp, err := d.client.Do(http.MethodGet, "/llms", nil)
	if err != nil {
		resp.Diagnostics.AddError("Read llms failed", err.Error())
		return
	}
	var results []map[string]any
	if err := client.DecodeResponse(httpResp, &results); err != nil {
		resp.Diagnostics.AddError("Read llms failed", err.Error())
		return
	}

	for _, r := range results {
		if fmt.Sprintf("%v", r["llm_name"]) == state.LlmName.ValueString() {
			state.ID = types.StringValue(fmt.Sprintf("%v", r["id"]))
			resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
			return
		}
	}

	resp.Diagnostics.AddError(
		"LLM not found",
		fmt.Sprintf("No LLM with name %q was found. Make sure the oai_llm_key has been created and allow up to 1 minute for discovery.", state.LlmName.ValueString()),
	)
}
