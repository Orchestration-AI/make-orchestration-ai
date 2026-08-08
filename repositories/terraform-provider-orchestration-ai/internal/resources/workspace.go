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

type WorkspaceResource struct{ client *client.Client }

type workspaceModel struct {
	ID            types.String `tfsdk:"id"`
	WorkspaceName types.String `tfsdk:"workspace_name"`
	Applications  types.Set    `tfsdk:"applications"`
}

func NewWorkspaceResource() resource.Resource { return &WorkspaceResource{} }

func (r *WorkspaceResource) Metadata(_ context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_workspace"
}

func (r *WorkspaceResource) Schema(_ context.Context, _ resource.SchemaRequest, resp *resource.SchemaResponse) {
	resp.Schema = schema.Schema{
		Attributes: map[string]schema.Attribute{
			"id":             schema.StringAttribute{Computed: true, PlanModifiers: []planmodifier.String{stringplanmodifier.UseStateForUnknown()}},
			"workspace_name": schema.StringAttribute{Required: true},
			"applications":   schema.SetAttribute{Optional: true, ElementType: types.StringType},
		},
	}
}

func (r *WorkspaceResource) Configure(_ context.Context, req resource.ConfigureRequest, _ *resource.ConfigureResponse) {
	if req.ProviderData != nil {
		r.client = req.ProviderData.(*client.Client)
	}
}

func (r *WorkspaceResource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
	var plan workspaceModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}
	body := map[string]any{"workspace_name": plan.WorkspaceName.ValueString()}
	if !plan.Applications.IsNull() && !plan.Applications.IsUnknown() {
		body["applications"] = toStringSlice(ctx, plan.Applications)
	}
	httpResp, err := r.client.Do(http.MethodPost, "/workspaces", body)
	if err != nil {
		resp.Diagnostics.AddError("Create workspace failed", err.Error())
		return
	}
	var result map[string]any
	if err := client.DecodeResponse(httpResp, &result); err != nil {
		resp.Diagnostics.AddError("Create workspace failed", err.Error())
		return
	}
	plan.ID = types.StringValue(fmt.Sprintf("%v", result["id"]))
	resp.Diagnostics.Append(resp.State.Set(ctx, &plan)...)
}

func (r *WorkspaceResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	var state workspaceModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	httpResp, err := r.client.Do(http.MethodGet, "/workspaces/"+state.ID.ValueString(), nil)
	if err != nil {
		resp.Diagnostics.AddError("Read workspace failed", err.Error())
		return
	}
	var result map[string]any
	if err := client.DecodeResponse(httpResp, &result); err != nil {
		resp.Diagnostics.AddError("Read workspace failed", err.Error())
		return
	}
	state.WorkspaceName = types.StringValue(fmt.Sprintf("%v", result["workspace_name"]))
	if apps, ok := result["applications"].([]any); ok {
		clientIDs := make([]string, 0, len(apps))
		for _, a := range apps {
			if m, ok := a.(map[string]any); ok {
				if cid, ok := m["client_id"].(string); ok {
					clientIDs = append(clientIDs, cid)
				}
			}
		}
		set, diags := types.SetValueFrom(ctx, types.StringType, clientIDs)
		resp.Diagnostics.Append(diags...)
		state.Applications = set
	}
	resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
}

func (r *WorkspaceResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	var plan workspaceModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}
	body := map[string]any{"workspace_name": plan.WorkspaceName.ValueString()}
	if !plan.Applications.IsNull() && !plan.Applications.IsUnknown() {
		body["applications"] = toStringSlice(ctx, plan.Applications)
	}
	httpResp, err := r.client.Do(http.MethodPatch, "/workspaces/"+plan.ID.ValueString(), body)
	if err != nil {
		resp.Diagnostics.AddError("Update workspace failed", err.Error())
		return
	}
	if err := client.DecodeResponse(httpResp, nil); err != nil {
		resp.Diagnostics.AddError("Update workspace failed", err.Error())
		return
	}
	resp.Diagnostics.Append(resp.State.Set(ctx, &plan)...)
}

func (r *WorkspaceResource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
	var state workspaceModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	httpResp, err := r.client.Do(http.MethodDelete, "/workspaces/"+state.ID.ValueString(), nil)
	if err != nil {
		resp.Diagnostics.AddError("Delete workspace failed", err.Error())
		return
	}
	client.DecodeResponse(httpResp, nil)
}

func toStringSlice(ctx context.Context, s types.Set) []string {
	var elems []string
	s.ElementsAs(ctx, &elems, false)
	return elems
}
