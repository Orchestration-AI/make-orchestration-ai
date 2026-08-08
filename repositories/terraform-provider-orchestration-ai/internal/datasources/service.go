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

type ServiceDataSource struct{ client *client.Client }

type serviceDataModel struct {
	ID          types.String `tfsdk:"id"`
	ServiceName types.String `tfsdk:"service_name"`
}

func NewServiceDataSource() datasource.DataSource { return &ServiceDataSource{} }

func (d *ServiceDataSource) Metadata(_ context.Context, req datasource.MetadataRequest, resp *datasource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_service"
}

func (d *ServiceDataSource) Schema(_ context.Context, _ datasource.SchemaRequest, resp *datasource.SchemaResponse) {
	resp.Schema = schema.Schema{
		Attributes: map[string]schema.Attribute{
			"id":           schema.StringAttribute{Computed: true},
			"service_name": schema.StringAttribute{Required: true},
		},
	}
}

func (d *ServiceDataSource) Configure(_ context.Context, req datasource.ConfigureRequest, _ *datasource.ConfigureResponse) {
	if req.ProviderData != nil {
		d.client = req.ProviderData.(*client.Client)
	}
}

func (d *ServiceDataSource) Read(ctx context.Context, req datasource.ReadRequest, resp *datasource.ReadResponse) {
	var state serviceDataModel
	resp.Diagnostics.Append(req.Config.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	httpResp, err := d.client.Do(http.MethodGet, "/services", nil)
	if err != nil {
		resp.Diagnostics.AddError("Read services failed", err.Error())
		return
	}
	var results []map[string]any
	if err := client.DecodeResponse(httpResp, &results); err != nil {
		resp.Diagnostics.AddError("Read services failed", err.Error())
		return
	}

	for _, r := range results {
		if fmt.Sprintf("%v", r["service_name"]) == state.ServiceName.ValueString() {
			state.ID = types.StringValue(fmt.Sprintf("%v", r["id"]))
			resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
			return
		}
	}

	resp.Diagnostics.AddError(
		"Service not found",
		fmt.Sprintf("No service with name %q was found.", state.ServiceName.ValueString()),
	)
}
