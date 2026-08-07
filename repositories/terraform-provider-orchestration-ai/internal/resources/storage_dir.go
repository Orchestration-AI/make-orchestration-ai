package resources

import (
	"context"
	"fmt"
	"net/http"

	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/planmodifier"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/stringdefault"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/stringplanmodifier"
	"github.com/hashicorp/terraform-plugin-framework/types"
	"github.com/make-orchestration-ai/terraform-provider-orchestration-ai/internal/client"
)

type StorageDirResource struct{ client *client.Client }

type storageDirModel struct {
	ID              types.String `tfsdk:"id"`
	Scope           types.String `tfsdk:"scope"`            // agent | layer | orchestration | workspace
	WorkspaceID     types.String `tfsdk:"workspace_id"`
	OrchestrationID types.String `tfsdk:"orchestration_id"`
	AgentID         types.String `tfsdk:"agent_id"`
	LayerID         types.String `tfsdk:"layer_id"`
	Path            types.String `tfsdk:"path"`
}

func NewStorageDirResource() resource.Resource { return &StorageDirResource{} }

func (r *StorageDirResource) Metadata(_ context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_storage_dir"
}

func (r *StorageDirResource) Schema(_ context.Context, _ resource.SchemaRequest, resp *resource.SchemaResponse) {
	resp.Schema = schema.Schema{
		Attributes: map[string]schema.Attribute{
			"id":               schema.StringAttribute{Computed: true, PlanModifiers: []planmodifier.String{stringplanmodifier.UseStateForUnknown()}},
			"scope":            schema.StringAttribute{Required: true, PlanModifiers: []planmodifier.String{stringplanmodifier.RequiresReplace()}, Description: "agent | layer | orchestration | workspace"},
			"workspace_id":     schema.StringAttribute{Required: true, PlanModifiers: []planmodifier.String{stringplanmodifier.RequiresReplace()}},
			"orchestration_id": schema.StringAttribute{Optional: true, Computed: true, Default: stringdefault.StaticString(""), PlanModifiers: []planmodifier.String{stringplanmodifier.RequiresReplace()}},
			"agent_id":         schema.StringAttribute{Optional: true, Computed: true, Default: stringdefault.StaticString(""), PlanModifiers: []planmodifier.String{stringplanmodifier.RequiresReplace()}},
			"layer_id":         schema.StringAttribute{Optional: true, Computed: true, Default: stringdefault.StaticString(""), PlanModifiers: []planmodifier.String{stringplanmodifier.RequiresReplace()}},
			"path":             schema.StringAttribute{Required: true, PlanModifiers: []planmodifier.String{stringplanmodifier.RequiresReplace()}},
		},
	}
}

func (r *StorageDirResource) Configure(_ context.Context, req resource.ConfigureRequest, _ *resource.ConfigureResponse) {
	if req.ProviderData != nil {
		r.client = req.ProviderData.(*client.Client)
	}
}

func (r *StorageDirResource) dirBasePath(m storageDirModel) (string, error) {
	switch m.Scope.ValueString() {
	case "workspace":
		return fmt.Sprintf("/workspaces/%s/storage/directories", m.WorkspaceID.ValueString()), nil
	case "orchestration":
		return fmt.Sprintf("/workspaces/%s/orchestrations/%s/storage/directories",
			m.WorkspaceID.ValueString(), m.OrchestrationID.ValueString()), nil
	case "agent":
		return fmt.Sprintf("/workspaces/%s/orchestrations/%s/agents/%s/storage/directories",
			m.WorkspaceID.ValueString(), m.OrchestrationID.ValueString(), m.AgentID.ValueString()), nil
	case "layer":
		return fmt.Sprintf("/workspaces/%s/orchestrations/%s/agents/%s/layers/%s/storage/directories",
			m.WorkspaceID.ValueString(), m.OrchestrationID.ValueString(), m.AgentID.ValueString(), m.LayerID.ValueString()), nil
	}
	return "", fmt.Errorf("invalid scope %q: must be workspace, orchestration, agent, or layer", m.Scope.ValueString())
}

func (r *StorageDirResource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
	var plan storageDirModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}
	path, err := r.dirBasePath(plan)
	if err != nil {
		resp.Diagnostics.AddError("Invalid storage scope", err.Error())
		return
	}
	httpResp, err := r.client.Do(http.MethodPost, path, map[string]any{"path": plan.Path.ValueString()})
	if err != nil {
		resp.Diagnostics.AddError("Create dir failed", err.Error())
		return
	}
	if err := client.DecodeResponse(httpResp, nil); err != nil {
		resp.Diagnostics.AddError("Create dir failed", err.Error())
		return
	}
	plan.ID = types.StringValue(plan.Scope.ValueString() + ":" + plan.Path.ValueString())
	resp.Diagnostics.Append(resp.State.Set(ctx, &plan)...)
}

// Dirs have no meaningful read — just preserve state.
func (r *StorageDirResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	var state storageDirModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
}

// Dirs are immutable (path is RequiresReplace) — no update needed.
func (r *StorageDirResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	var plan storageDirModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	resp.Diagnostics.Append(resp.State.Set(ctx, &plan)...)
}

func (r *StorageDirResource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
	var state storageDirModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	path, err := r.dirBasePath(state)
	if err != nil {
		resp.Diagnostics.AddError("Invalid storage scope", err.Error())
		return
	}
	httpResp, err := r.client.Do(http.MethodDelete, path+"?path="+state.Path.ValueString(), nil)
	if err != nil {
		resp.Diagnostics.AddError("Delete dir failed", err.Error())
		return
	}
	client.DecodeResponse(httpResp, nil)
}
