package datasources

import (
	"context"
	"fmt"
	"net/http"

	"github.com/hashicorp/terraform-plugin-framework/attr"
	"github.com/hashicorp/terraform-plugin-framework/datasource"
	"github.com/hashicorp/terraform-plugin-framework/datasource/schema"
	"github.com/hashicorp/terraform-plugin-framework/types"
	"github.com/make-orchestration-ai/terraform-provider-orchestration-ai/internal/client"
)

type LlmsDataSource struct{ client *client.Client }

type llmsDataModel struct {
	LLMs types.List `tfsdk:"llms"`
}

var llmItemAttrTypes = map[string]attr.Type{
	"id":       types.StringType,
	"llm_name": types.StringType,
}

func NewLlmsDataSource() datasource.DataSource { return &LlmsDataSource{} }

func (d *LlmsDataSource) Metadata(_ context.Context, req datasource.MetadataRequest, resp *datasource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_llms"
}

func (d *LlmsDataSource) Schema(_ context.Context, _ datasource.SchemaRequest, resp *datasource.SchemaResponse) {
	resp.Schema = schema.Schema{
		Attributes: map[string]schema.Attribute{
			"llms": schema.ListNestedAttribute{
				Computed: true,
				NestedObject: schema.NestedAttributeObject{
					Attributes: map[string]schema.Attribute{
						"id":       schema.StringAttribute{Computed: true},
						"llm_name": schema.StringAttribute{Computed: true},
					},
				},
			},
		},
	}
}

func (d *LlmsDataSource) Configure(_ context.Context, req datasource.ConfigureRequest, _ *datasource.ConfigureResponse) {
	if req.ProviderData != nil {
		d.client = req.ProviderData.(*client.Client)
	}
}

func (d *LlmsDataSource) Read(ctx context.Context, req datasource.ReadRequest, resp *datasource.ReadResponse) {
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

	items := make([]attr.Value, 0, len(results))
	for _, r := range results {
		obj, diags := types.ObjectValue(llmItemAttrTypes, map[string]attr.Value{
			"id":       types.StringValue(fmt.Sprintf("%v", r["id"])),
			"llm_name": types.StringValue(fmt.Sprintf("%v", r["llm_name"])),
		})
		resp.Diagnostics.Append(diags...)
		items = append(items, obj)
	}

	list, diags := types.ListValue(types.ObjectType{AttrTypes: llmItemAttrTypes}, items)
	resp.Diagnostics.Append(diags...)
	if resp.Diagnostics.HasError() {
		return
	}

	resp.Diagnostics.Append(resp.State.Set(ctx, &llmsDataModel{LLMs: list})...)
}
