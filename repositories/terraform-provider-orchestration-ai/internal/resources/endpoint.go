package resources

import (
	"context"
	"fmt"
	"net/http"

	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/planmodifier"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/stringplanmodifier"
	"github.com/hashicorp/terraform-plugin-framework/types"
	"github.com/make-orchestration-ai/terraform-provider-orchestration-ai/internal/client"
)

type EndpointResource struct{ client *client.Client }

type endpointModel struct {
	ID              types.String `tfsdk:"id"`
	WorkspaceID     types.String `tfsdk:"workspace_id"`
	OrchestrationID types.String `tfsdk:"orchestration_id"`
	AgentID         types.String `tfsdk:"agent_id"`
	Description     types.String `tfsdk:"description"`
	Endpoint        types.String `tfsdk:"endpoint"`
}

func NewEndpointResource() resource.Resource { return &EndpointResource{} }

func (r *EndpointResource) Metadata(_ context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_endpoint"
}

func (r *EndpointResource) Schema(_ context.Context, _ resource.SchemaRequest, resp *resource.SchemaResponse) {
	resp.Schema = schema.Schema{
		Attributes: map[string]schema.Attribute{
			"id":               schema.StringAttribute{Computed: true, PlanModifiers: []planmodifier.String{stringplanmodifier.UseStateForUnknown()}},
			"workspace_id":     schema.StringAttribute{Required: true, PlanModifiers: []planmodifier.String{stringplanmodifier.RequiresReplace()}},
			"orchestration_id": schema.StringAttribute{Required: true, PlanModifiers: []planmodifier.String{stringplanmodifier.RequiresReplace()}},
			"agent_id":         schema.StringAttribute{Required: true, PlanModifiers: []planmodifier.String{stringplanmodifier.RequiresReplace()}},
			"description":      schema.StringAttribute{Required: true},
			"endpoint":         schema.StringAttribute{Required: true},
		},
	}
}

func (r *EndpointResource) Configure(_ context.Context, req resource.ConfigureRequest, _ *resource.ConfigureResponse) {
	if req.ProviderData != nil {
		r.client = req.ProviderData.(*client.Client)
	}
}

func (r *EndpointResource) basePath(m endpointModel) string {
	return fmt.Sprintf("/workspaces/%s/orchestrations/%s/agents/%s/endpoints",
		m.WorkspaceID.ValueString(), m.OrchestrationID.ValueString(), m.AgentID.ValueString())
}

func (r *EndpointResource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
	var plan endpointModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}
	body := map[string]any{
		"description": plan.Description.ValueString(),
		"endpoint":    plan.Endpoint.ValueString(),
	}
	httpResp, err := r.client.Do(http.MethodPost, r.basePath(plan), body)
	if err != nil {
		resp.Diagnostics.AddError("Create endpoint failed", err.Error())
		return
	}
	var result map[string]any
	if err := client.DecodeResponse(httpResp, &result); err != nil {
		resp.Diagnostics.AddError("Create endpoint failed", err.Error())
		return
	}
	plan.ID = types.StringValue(fmt.Sprintf("%v", result["id"]))
	resp.Diagnostics.Append(resp.State.Set(ctx, &plan)...)
}

func (r *EndpointResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	var state endpointModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	httpResp, err := r.client.Do(http.MethodGet, r.basePath(state)+"/"+state.ID.ValueString(), nil)
	if err != nil {
		resp.Diagnostics.AddError("Read endpoint failed", err.Error())
		return
	}
	var result map[string]any
	if err := client.DecodeResponse(httpResp, &result); err != nil {
		resp.Diagnostics.AddError("Read endpoint failed", err.Error())
		return
	}
	state.Description = types.StringValue(fmt.Sprintf("%v", result["description"]))
	state.Endpoint = types.StringValue(fmt.Sprintf("%v", result["endpoint"]))
	resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
}

func (r *EndpointResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	var plan endpointModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}
	body := map[string]any{
		"description": plan.Description.ValueString(),
		"endpoint":    plan.Endpoint.ValueString(),
	}
	httpResp, err := r.client.Do(http.MethodPatch, r.basePath(plan)+"/"+plan.ID.ValueString(), body)
	if err != nil {
		resp.Diagnostics.AddError("Update endpoint failed", err.Error())
		return
	}
	if err := client.DecodeResponse(httpResp, nil); err != nil {
		resp.Diagnostics.AddError("Update endpoint failed", err.Error())
		return
	}
	resp.Diagnostics.Append(resp.State.Set(ctx, &plan)...)
}

func (r *EndpointResource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
	var state endpointModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	httpResp, err := r.client.Do(http.MethodDelete, r.basePath(state)+"/"+state.ID.ValueString(), nil)
	if err != nil {
		resp.Diagnostics.AddError("Delete endpoint failed", err.Error())
		return
	}
	client.DecodeResponse(httpResp, nil)
}
