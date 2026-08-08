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

type LinkResource struct{ client *client.Client }

type linkModel struct {
	ID              types.String `tfsdk:"id"`
	WorkspaceID     types.String `tfsdk:"workspace_id"`
	OrchestrationID types.String `tfsdk:"orchestration_id"`
	AgentID         types.String `tfsdk:"agent_id"`
	LinkName        types.String `tfsdk:"link_name"`
	LinkDescription types.String `tfsdk:"link_description"`
	LinkURL         types.String `tfsdk:"link_url"`
}

func NewLinkResource() resource.Resource { return &LinkResource{} }

func (r *LinkResource) Metadata(_ context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_link"
}

func (r *LinkResource) Schema(_ context.Context, _ resource.SchemaRequest, resp *resource.SchemaResponse) {
	resp.Schema = schema.Schema{
		Attributes: map[string]schema.Attribute{
			"id":               schema.StringAttribute{Computed: true, PlanModifiers: []planmodifier.String{stringplanmodifier.UseStateForUnknown()}},
			"workspace_id":     schema.StringAttribute{Required: true, PlanModifiers: []planmodifier.String{stringplanmodifier.RequiresReplace()}},
			"orchestration_id": schema.StringAttribute{Required: true, PlanModifiers: []planmodifier.String{stringplanmodifier.RequiresReplace()}},
			"agent_id":         schema.StringAttribute{Required: true, PlanModifiers: []planmodifier.String{stringplanmodifier.RequiresReplace()}},
			"link_name":        schema.StringAttribute{Required: true},
			"link_description": schema.StringAttribute{Required: true},
			"link_url":         schema.StringAttribute{Required: true},
		},
	}
}

func (r *LinkResource) Configure(_ context.Context, req resource.ConfigureRequest, _ *resource.ConfigureResponse) {
	if req.ProviderData != nil {
		r.client = req.ProviderData.(*client.Client)
	}
}

func (r *LinkResource) basePath(m linkModel) string {
	return fmt.Sprintf("/workspaces/%s/orchestrations/%s/agents/%s/links",
		m.WorkspaceID.ValueString(), m.OrchestrationID.ValueString(), m.AgentID.ValueString())
}

func (r *LinkResource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
	var plan linkModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}
	body := map[string]any{"link_name": plan.LinkName.ValueString(), "link_description": plan.LinkDescription.ValueString(), "link_url": plan.LinkURL.ValueString()}
	httpResp, err := r.client.Do(http.MethodPost, r.basePath(plan), body)
	if err != nil {
		resp.Diagnostics.AddError("Create link failed", err.Error())
		return
	}
	var result map[string]any
	if err := client.DecodeResponse(httpResp, &result); err != nil {
		resp.Diagnostics.AddError("Create link failed", err.Error())
		return
	}
	plan.ID = types.StringValue(fmt.Sprintf("%v", result["id"]))
	resp.Diagnostics.Append(resp.State.Set(ctx, &plan)...)
}

func (r *LinkResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	var state linkModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	httpResp, err := r.client.Do(http.MethodGet, r.basePath(state)+"/"+state.ID.ValueString(), nil)
	if err != nil {
		resp.Diagnostics.AddError("Read link failed", err.Error())
		return
	}
	var result map[string]any
	if err := client.DecodeResponse(httpResp, &result); err != nil {
		resp.Diagnostics.AddError("Read link failed", err.Error())
		return
	}
	state.LinkName = types.StringValue(fmt.Sprintf("%v", result["link_name"]))
	state.LinkDescription = types.StringValue(fmt.Sprintf("%v", result["link_description"]))
	state.LinkURL = types.StringValue(fmt.Sprintf("%v", result["link_url"]))
	resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
}

func (r *LinkResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	var plan linkModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}
	body := map[string]any{"link_name": plan.LinkName.ValueString(), "link_description": plan.LinkDescription.ValueString(), "link_url": plan.LinkURL.ValueString()}
	httpResp, err := r.client.Do(http.MethodPatch, r.basePath(plan)+"/"+plan.ID.ValueString(), body)
	if err != nil {
		resp.Diagnostics.AddError("Update link failed", err.Error())
		return
	}
	if err := client.DecodeResponse(httpResp, nil); err != nil {
		resp.Diagnostics.AddError("Update link failed", err.Error())
		return
	}
	resp.Diagnostics.Append(resp.State.Set(ctx, &plan)...)
}

func (r *LinkResource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
	var state linkModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	httpResp, err := r.client.Do(http.MethodDelete, r.basePath(state)+"/"+state.ID.ValueString(), nil)
	if err != nil {
		resp.Diagnostics.AddError("Delete link failed", err.Error())
		return
	}
	client.DecodeResponse(httpResp, nil)
}
