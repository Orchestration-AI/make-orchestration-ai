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
			"id":           schema.StringAttribute{Required: true},
			"service_name": schema.StringAttribute{Computed: true},
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
	httpResp, err := d.client.Do(http.MethodGet, "/services/"+state.ID.ValueString(), nil)
	if err != nil {
		resp.Diagnostics.AddError("Read service failed", err.Error())
		return
	}
	var result map[string]any
	if err := client.DecodeResponse(httpResp, &result); err != nil {
		resp.Diagnostics.AddError("Read service failed", err.Error())
		return
	}
	state.ServiceName = types.StringValue(fmt.Sprintf("%v", result["service_name"]))
	resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
}
