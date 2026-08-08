package resources

import (
	"context"
	"fmt"
	"net/http"

	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/booldefault"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/stringdefault"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/planmodifier"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/stringplanmodifier"
	"github.com/hashicorp/terraform-plugin-framework/types"
	"github.com/make-orchestration-ai/terraform-provider-orchestration-ai/internal/client"
)

type AgentResource struct{ client *client.Client }

type agentModel struct {
	ID               types.String `tfsdk:"id"`
	WorkspaceID      types.String `tfsdk:"workspace_id"`
	OrchestrationID  types.String `tfsdk:"orchestration_id"`
	AgentName        types.String `tfsdk:"agent_name"`
	AgentDescription types.String `tfsdk:"agent_description"`
	VMEnabled        types.Bool   `tfsdk:"vm_enabled"`
	ScriptSource     types.String `tfsdk:"script_source"`
	ScriptPackageJSON types.String `tfsdk:"script_package_json"`
}

func NewAgentResource() resource.Resource { return &AgentResource{} }

func (r *AgentResource) Metadata(_ context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_agent"
}

func (r *AgentResource) Schema(_ context.Context, _ resource.SchemaRequest, resp *resource.SchemaResponse) {
	resp.Schema = schema.Schema{
		Attributes: map[string]schema.Attribute{
			"id":                schema.StringAttribute{Computed: true, PlanModifiers: []planmodifier.String{stringplanmodifier.UseStateForUnknown()}},
			"workspace_id":      schema.StringAttribute{Required: true, PlanModifiers: []planmodifier.String{stringplanmodifier.RequiresReplace()}},
			"orchestration_id":  schema.StringAttribute{Required: true, PlanModifiers: []planmodifier.String{stringplanmodifier.RequiresReplace()}},
			"agent_name":         schema.StringAttribute{Required: true},
			"agent_description":  schema.StringAttribute{Required: true},
			"vm_enabled":         schema.BoolAttribute{Optional: true, Computed: true, Default: booldefault.StaticBool(false)},
			"script_source":      schema.StringAttribute{Optional: true, Computed: true, Default: stringdefault.StaticString(""), Description: "JavaScript source code for the agent VM."},
			"script_package_json": schema.StringAttribute{Optional: true, Computed: true, Default: stringdefault.StaticString(""), Description: "package.json content for the agent VM script."},
		},
	}
}

func (r *AgentResource) Configure(_ context.Context, req resource.ConfigureRequest, _ *resource.ConfigureResponse) {
	if req.ProviderData != nil {
		r.client = req.ProviderData.(*client.Client)
	}
}

func (r *AgentResource) agentPath(workspaceID, orchestrationID, id string) string {
	base := "/workspaces/" + workspaceID + "/orchestrations/" + orchestrationID + "/agents"
	if id != "" {
		return base + "/" + id
	}
	return base
}

func (r *AgentResource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
	var plan agentModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}
	body := map[string]any{
		"agent_name":        plan.AgentName.ValueString(),
		"agent_description": plan.AgentDescription.ValueString(),
		"vm_enabled":        plan.VMEnabled.ValueBool(),
	}
	if !plan.ScriptSource.IsNull() && !plan.ScriptSource.IsUnknown() {
		script := map[string]any{}
		script["source"] = plan.ScriptSource.ValueString()
		if !plan.ScriptPackageJSON.IsNull() && !plan.ScriptPackageJSON.IsUnknown() {
			script["packageJson"] = plan.ScriptPackageJSON.ValueString()
		}
		body["script"] = script
	}
	httpResp, err := r.client.Do(http.MethodPost, r.agentPath(plan.WorkspaceID.ValueString(), plan.OrchestrationID.ValueString(), ""), body)
	if err != nil {
		resp.Diagnostics.AddError("Create agent failed", err.Error())
		return
	}
	var result map[string]any
	if err := client.DecodeResponse(httpResp, &result); err != nil {
		resp.Diagnostics.AddError("Create agent failed", err.Error())
		return
	}
	plan.ID = types.StringValue(fmt.Sprintf("%v", result["id"]))
	resp.Diagnostics.Append(resp.State.Set(ctx, &plan)...)
}

func (r *AgentResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	var state agentModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	httpResp, err := r.client.Do(http.MethodGet, r.agentPath(state.WorkspaceID.ValueString(), state.OrchestrationID.ValueString(), state.ID.ValueString()), nil)
	if err != nil {
		resp.Diagnostics.AddError("Read agent failed", err.Error())
		return
	}
	var result map[string]any
	if err := client.DecodeResponse(httpResp, &result); err != nil {
		resp.Diagnostics.AddError("Read agent failed", err.Error())
		return
	}
	state.AgentName = types.StringValue(fmt.Sprintf("%v", result["agent_name"]))
	state.AgentDescription = types.StringValue(fmt.Sprintf("%v", result["agent_description"]))
	if v, ok := result["vm_enabled"].(bool); ok {
		state.VMEnabled = types.BoolValue(v)
	}
	if script, ok := result["script"].(map[string]any); ok {
		if v, ok := script["source"].(string); ok {
			state.ScriptSource = types.StringValue(v)
		}
		if v, ok := script["packageJson"].(string); ok {
			state.ScriptPackageJSON = types.StringValue(v)
		}
	}
	resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
}

func (r *AgentResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	var plan agentModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}
	body := map[string]any{
		"agent_name":        plan.AgentName.ValueString(),
		"agent_description": plan.AgentDescription.ValueString(),
		"vm_enabled":        plan.VMEnabled.ValueBool(),
	}
	if !plan.ScriptSource.IsNull() && !plan.ScriptSource.IsUnknown() {
		script := map[string]any{}
		script["source"] = plan.ScriptSource.ValueString()
		if !plan.ScriptPackageJSON.IsNull() && !plan.ScriptPackageJSON.IsUnknown() {
			script["packageJson"] = plan.ScriptPackageJSON.ValueString()
		}
		body["script"] = script
	}
	httpResp, err := r.client.Do(http.MethodPatch, r.agentPath(plan.WorkspaceID.ValueString(), plan.OrchestrationID.ValueString(), plan.ID.ValueString()), body)
	if err != nil {
		resp.Diagnostics.AddError("Update agent failed", err.Error())
		return
	}
	if err := client.DecodeResponse(httpResp, nil); err != nil {
		resp.Diagnostics.AddError("Update agent failed", err.Error())
		return
	}
	resp.Diagnostics.Append(resp.State.Set(ctx, &plan)...)
}

func (r *AgentResource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
	var state agentModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	httpResp, err := r.client.Do(http.MethodDelete, r.agentPath(state.WorkspaceID.ValueString(), state.OrchestrationID.ValueString(), state.ID.ValueString()), nil)
	if err != nil {
		resp.Diagnostics.AddError("Delete agent failed", err.Error())
		return
	}
	client.DecodeResponse(httpResp, nil)
}
