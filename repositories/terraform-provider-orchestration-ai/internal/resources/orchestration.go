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

type OrchestrationResource struct{ client *client.Client }

type orchestrationModel struct {
	ID                       types.String `tfsdk:"id"`
	WorkspaceID              types.String `tfsdk:"workspace_id"`
	OrchestrationName        types.String `tfsdk:"orchestration_name"`
	OrchestrationDescription types.String `tfsdk:"orchestration_description"`
}

func NewOrchestrationResource() resource.Resource { return &OrchestrationResource{} }

func (r *OrchestrationResource) Metadata(_ context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_orchestration"
}

func (r *OrchestrationResource) Schema(_ context.Context, _ resource.SchemaRequest, resp *resource.SchemaResponse) {
	resp.Schema = schema.Schema{
		Attributes: map[string]schema.Attribute{
			"id":                         schema.StringAttribute{Computed: true, PlanModifiers: []planmodifier.String{stringplanmodifier.UseStateForUnknown()}},
			"workspace_id":               schema.StringAttribute{Required: true, PlanModifiers: []planmodifier.String{stringplanmodifier.RequiresReplace()}},
			"orchestration_name":         schema.StringAttribute{Required: true},
			"orchestration_description":  schema.StringAttribute{Required: true},
		},
	}
}

func (r *OrchestrationResource) Configure(_ context.Context, req resource.ConfigureRequest, _ *resource.ConfigureResponse) {
	if req.ProviderData != nil {
		r.client = req.ProviderData.(*client.Client)
	}
}

func (r *OrchestrationResource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
	var plan orchestrationModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}
	body := map[string]any{
		"orchestration_name":        plan.OrchestrationName.ValueString(),
		"orchestration_description": plan.OrchestrationDescription.ValueString(),
	}
	httpResp, err := r.client.Do(http.MethodPost, "/workspaces/"+plan.WorkspaceID.ValueString()+"/orchestrations", body)
	if err != nil {
		resp.Diagnostics.AddError("Create orchestration failed", err.Error())
		return
	}
	var result map[string]any
	if err := client.DecodeResponse(httpResp, &result); err != nil {
		resp.Diagnostics.AddError("Create orchestration failed", err.Error())
		return
	}
	plan.ID = types.StringValue(fmt.Sprintf("%v", result["id"]))
	resp.Diagnostics.Append(resp.State.Set(ctx, &plan)...)
}

func (r *OrchestrationResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	var state orchestrationModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	httpResp, err := r.client.Do(http.MethodGet, "/workspaces/"+state.WorkspaceID.ValueString()+"/orchestrations/"+state.ID.ValueString(), nil)
	if err != nil {
		resp.Diagnostics.AddError("Read orchestration failed", err.Error())
		return
	}
	var result map[string]any
	if err := client.DecodeResponse(httpResp, &result); err != nil {
		resp.Diagnostics.AddError("Read orchestration failed", err.Error())
		return
	}
	state.OrchestrationName = types.StringValue(fmt.Sprintf("%v", result["orchestration_name"]))
	state.OrchestrationDescription = types.StringValue(fmt.Sprintf("%v", result["orchestration_description"]))
	resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
}

func (r *OrchestrationResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	var plan orchestrationModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}
	body := map[string]any{
		"orchestration_name":        plan.OrchestrationName.ValueString(),
		"orchestration_description": plan.OrchestrationDescription.ValueString(),
	}
	httpResp, err := r.client.Do(http.MethodPatch, "/workspaces/"+plan.WorkspaceID.ValueString()+"/orchestrations/"+plan.ID.ValueString(), body)
	if err != nil {
		resp.Diagnostics.AddError("Update orchestration failed", err.Error())
		return
	}
	if err := client.DecodeResponse(httpResp, nil); err != nil {
		resp.Diagnostics.AddError("Update orchestration failed", err.Error())
		return
	}
	resp.Diagnostics.Append(resp.State.Set(ctx, &plan)...)
}

func (r *OrchestrationResource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
	var state orchestrationModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	httpResp, err := r.client.Do(http.MethodDelete, "/workspaces/"+state.WorkspaceID.ValueString()+"/orchestrations/"+state.ID.ValueString(), nil)
	if err != nil {
		resp.Diagnostics.AddError("Delete orchestration failed", err.Error())
		return
	}
	client.DecodeResponse(httpResp, nil)
}
